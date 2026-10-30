/**
 * LifeHub 自托管同步服务 —— HTTP 层。
 *
 * 架构位置：apps/sync-server —— **只存密文**的极简同步后端。
 *
 * 红线（X-01 ④ / R5 / X-12）：
 * - 服务端**只接受密文 blob**（ciphertext / iv / tag / algorithm / keyVersion 等）；
 * - 服务端**永不接触**主口令、DEK、盐值与任何业务明文（金额 / 对方 / 备注）；
 * - 请求体一旦出现明文字段名，服务端直接拒绝并返回 400，**且绝不落盘**；
 * - 服务端没有「解密」能力，也没有密钥材料——即使拿到数据库也无法还原任何业务数据；
 * - 设备级令牌鉴权：令牌只来自环境变量，进程内只保留其 SHA-256 摘要。
 *
 * 端点：
 * 1. `POST   /v1/blobs`      —— 幂等 upsert 一条密文 blob；
 * 2. `GET    /v1/blobs`      —— 按 `since` 增量拉取密文 blob；
 * 3. `GET    /v1/blobs/:id`  —— 查询单条密文 blob；
 * 4. `DELETE /v1/blobs/:id`  —— 删除单条密文 blob；
 * 5. `GET    /health`        —— 健康检查（供容器编排探活）。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DeviceAuthorizer } from './auth.ts';
import { loadConfig, type SyncServerConfig } from './config.ts';
import { SqliteBlobStore, type StoredBlob } from './store.ts';
import { ValidationError, normalizeTimestamp, validateBlobBody } from './validation.ts';

/** 增量拉取的默认条数。 */
const DEFAULT_PAGE_SIZE = 100;

/** 增量拉取的最大条数。 */
const MAX_PAGE_SIZE = 500;

/** 服务启动时间（用于计算运行时长）。 */
const STARTED_AT = Date.now();

/**
 * 把 blob 转成对外的 JSON 表示。
 *
 * 说明：返回的字段与 `EncryptedBlob` 完全一致——**只有密文与元信息，没有任何明文**。
 *
 * @param blob 库中的 blob
 * @returns 对外的 JSON 对象
 */
function toPublicJson(blob: StoredBlob): Record<string, unknown> {
  return {
    id: blob.id,
    entityType: blob.entityType,
    entityId: blob.entityId,
    ciphertext: blob.ciphertext,
    iv: blob.iv,
    tag: blob.tag,
    algorithm: blob.algorithm,
    keyVersion: blob.keyVersion,
    updatedAt: blob.updatedAt,
    version: blob.version,
  };
}

/**
 * 写出 JSON 响应。
 *
 * @param response HTTP 响应对象
 * @param status HTTP 状态码
 * @param payload 响应体
 * @param headers 附加响应头
 * @returns 无异常
 */
function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(body);
}

/**
 * 读取并解析 JSON 请求体。
 *
 * @param request HTTP 请求
 * @param maxBytes 请求体大小上限（字节）
 * @returns 解析后的 JSON
 * @throws {ValidationError} 请求体过大或不是合法 JSON 时抛出
 */
async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    // 单条 blob 体积很小，限制上限足够，防止恶意大包。
    if (size > maxBytes) {
      throw new ValidationError('请求体过大');
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ValidationError('请求体不是合法 JSON');
  }
}

/**
 * 解析增量拉取的时间游标。
 *
 * @param raw `since` 查询参数原始值
 * @returns 归一化后的 ISO 时间串
 * @throws {ValidationError} 不是合法时间戳时抛出
 */
function parseSince(raw: string | null): string {
  if (raw === null || raw.trim() === '') {
    return '1970-01-01T00:00:00.000Z';
  }
  return normalizeTimestamp(raw, 'since');
}

/**
 * 解析分页条数。
 *
 * @param raw `limit` 查询参数原始值
 * @returns 落在 [1, MAX_PAGE_SIZE] 区间内的条数
 */
function parseLimit(raw: string | null): number {
  if (raw === null || raw.trim() === '') {
    return DEFAULT_PAGE_SIZE;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.max(parsed, 1), MAX_PAGE_SIZE);
}

/** 同步服务的运行期上下文。 */
export interface SyncServerContext {
  /** 密文 blob 存储。 */
  store: SqliteBlobStore;
  /** 设备令牌鉴权器。 */
  authorizer: DeviceAuthorizer;
  /** 运行时配置。 */
  config: SyncServerConfig;
}

/**
 * 创建同步服务实例。
 *
 * @param context 运行期上下文
 * @returns HTTP 服务实例
 */
export function createSyncServer(context: SyncServerContext): Server {
  return createServer((request, response) => {
    void handleRequest(request, response, context);
  });
}

/**
 * 处理一次 HTTP 请求。
 *
 * @param request HTTP 请求
 * @param response HTTP 响应
 * @param context 运行期上下文
 * @returns 无异常
 */
async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: SyncServerContext,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const method = request.method ?? 'GET';
  const corsOrigin = context.config.corsOrigin;
  const corsHeaders: Record<string, string> =
    corsOrigin === ''
      ? {}
      : {
          'access-control-allow-origin': corsOrigin,
          'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
          'access-control-allow-headers': 'authorization,content-type',
          'access-control-max-age': '600',
        };

  // 预检请求：直接放行，不触碰数据。
  if (method === 'OPTIONS') {
    response.writeHead(204, corsHeaders);
    response.end();
    return;
  }

  // 健康检查：供容器编排探活，不暴露任何业务信息。
  if (method === 'GET' && url.pathname === '/health') {
    sendJson(
      response,
      200,
      {
        ok: true,
        service: 'lifehub-sync-server',
        uptimeSeconds: Math.floor((Date.now() - STARTED_AT) / 1000),
      },
      corsHeaders,
    );
    return;
  }

  // 以下端点都需要设备级令牌。
  const auth = context.authorizer.authorize(request.headers.authorization);
  if (!auth.ok) {
    sendJson(
      response,
      401,
      { error: auth.reason },
      { ...corsHeaders, 'www-authenticate': 'Bearer' },
    );
    return;
  }

  try {
    // 上传 / 覆盖一条密文 blob（幂等 upsert）。
    if (method === 'POST' && url.pathname === '/v1/blobs') {
      const body = await readJsonBody(request, context.config.maxBodyBytes);
      const blob = validateBlobBody(body);
      const result = context.store.upsert(blob);
      sendJson(
        response,
        200,
        {
          id: result.blob.id,
          status: result.status,
          version: result.blob.version,
          updatedAt: result.blob.updatedAt,
        },
        corsHeaders,
      );
      return;
    }

    // 按 since 增量拉取密文 blob。
    if (method === 'GET' && url.pathname === '/v1/blobs') {
      const since = parseSince(url.searchParams.get('since'));
      const sinceId = url.searchParams.get('sinceId');
      const limit = parseLimit(url.searchParams.get('limit'));
      const result = context.store.listSince(since, sinceId, limit);
      sendJson(
        response,
        200,
        {
          blobs: result.blobs.map(toPublicJson),
          count: result.blobs.length,
          nextSince: result.nextSince,
          nextSinceId: result.nextSinceId,
        },
        corsHeaders,
      );
      return;
    }

    // 查询单条密文 blob。
    const single = /^\/v1\/blobs\/([^/]+)$/.exec(url.pathname);
    if (single !== null) {
      const id = decodeURIComponent(single[1] ?? '');
      if (method === 'GET') {
        const blob = context.store.get(id);
        if (blob === null) {
          sendJson(response, 404, { error: '未找到该 blob' }, corsHeaders);
          return;
        }
        sendJson(response, 200, toPublicJson(blob), corsHeaders);
        return;
      }
      if (method === 'DELETE') {
        const removed = context.store.remove(id);
        if (!removed) {
          sendJson(response, 404, { error: '未找到该 blob' }, corsHeaders);
          return;
        }
        sendJson(response, 200, { id, deleted: true }, corsHeaders);
        return;
      }
    }

    sendJson(response, 404, { error: '接口不存在' }, corsHeaders);
  } catch (error) {
    if (error instanceof ValidationError) {
      // 校验失败（含明文字段）——**绝不落盘**，直接 400。
      sendJson(response, 400, { error: error.message }, corsHeaders);
      return;
    }
    sendJson(response, 500, { error: '服务端内部错误' }, corsHeaders);
  }
}

/**
 * 启动同步服务。
 *
 * @returns 无异常
 * @throws {Error} 配置非法（例如未配置设备令牌）时抛出
 */
function main(): void {
  const config = loadConfig();
  const authorizer = new DeviceAuthorizer(config.credentials);
  const databasePath = config.databasePath;
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true });
  }
  const store = new SqliteBlobStore(databasePath);
  const server = createSyncServer({ store, authorizer, config });
  server.listen(config.port, config.host, () => {
    console.log(
      `[lifehub-sync] 同步服务已启动：http://${config.host}:${config.port}` +
        `（只存密文；数据库 ${databasePath}；已授权设备 ${config.credentials.length} 台）`,
    );
  });
}

// 仅在直接以脚本方式运行时启动服务；被 import 时（例如测试）不自动监听。
const executedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executedDirectly) {
  main();
}
