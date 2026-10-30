/**
 * LifeHub 自托管同步服务。
 *
 * 架构位置：apps/sync-server —— **只存密文**的极简同步后端。
 *
 * 红线（X-01 ④ / R5）：
 * - 服务端**只接受密文 blob**（ciphertext / iv / tag / algorithm / keyVersion 等）；
 * - 服务端**永不接触**主口令、DEK、盐值与任何业务明文（金额 / 对方 / 备注）；
 * - 请求体一旦出现明文字段名，服务端直接拒绝并返回 400；
 * - 服务端没有「解密」能力，也没有密钥material——即使拿到数据库也无法还原任何业务数据。
 *
 * 提供两个端点：
 * 1. `POST /v1/blobs` —— 上传 / 覆盖一条密文 blob（upsert 语义）；
 * 2. `GET  /v1/blobs` —— 按游标增量拉取密文 blob。
 *
 * 说明：本实现用内存 Map 存储，进程重启即丢失；
 * 生产部署请把 `BlobStore` 换成持久化实现（SQLite / 文件 / 对象存储均可），
 * 接口保持不变。
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';

/** 服务端监听端口（可用环境变量 `LIFEHUB_SYNC_PORT` 覆盖）。 */
const DEFAULT_PORT = 8787;

/** 单次增量拉取的最大条数。 */
const MAX_PAGE_SIZE = 500;

/** 默认页大小。 */
const DEFAULT_PAGE_SIZE = 100;

/** 允许出现在请求体中的 blob 字段白名单。 */
const ALLOWED_BLOB_FIELDS: readonly string[] = [
  'id',
  'entityType',
  'entityId',
  'ciphertext',
  'iv',
  'tag',
  'algorithm',
  'keyVersion',
  'updatedAt',
  'version',
];

/** 明文字段黑名单：出现即拒绝（服务端只存密文）。 */
const FORBIDDEN_FIELDS: readonly string[] = [
  'amountMinor',
  'amount',
  'counterparty',
  'categoryId',
  'localDate',
  'note',
  'title',
  'body',
  'content',
  'password',
  'salt',
  'dek',
  'masterKey',
  'recoveryCode',
];

/** 服务端存储的一条密文 blob。 */
export interface StoredBlob {
  /** blob id（全局唯一）。 */
  id: string;
  /** 实体类型。 */
  entityType: string;
  /** 实体 id。 */
  entityId: string;
  /** 密文正文（base64）。 */
  ciphertext: string;
  /** 随机 IV（base64）。 */
  iv: string;
  /** GCM 认证标签（base64）。 */
  tag: string;
  /** 加密算法标识。 */
  algorithm: string;
  /** 密钥版本。 */
  keyVersion: number;
  /** 最后更新时间，ISO 8601 UTC。 */
  updatedAt: string;
  /** 版本号。 */
  version: number;
  /** 服务端写入序号（增量游标）。 */
  seq: number;
}

/**
 * 密文 blob 存储。
 *
 * 说明：接口刻意保持极简，替换成持久化实现时无需改动 HTTP 层。
 */
export interface BlobStore {
  /**
   * 写入或覆盖一条密文 blob。
   *
   * @param blob 待写入的密文 blob（不含 seq）
   * @returns 写入后的 blob（含服务端分配的 seq）
   */
  upsert(blob: Omit<StoredBlob, 'seq'>): Promise<StoredBlob>;
  /**
   * 按游标增量拉取。
   *
   * @param cursor 起始游标（不含该序号）；从 0 开始表示全量
   * @param limit 最多返回条数
   * @returns 密文 blob 列表（按 seq 升序）
   */
  listSince(cursor: number, limit: number): Promise<StoredBlob[]>;
}

/**
 * 内存版密文存储。
 *
 * 说明：仅用于自托管单机场景与开发调试；生产环境请换成持久化实现。
 */
export class MemoryBlobStore implements BlobStore {
  /** blob id → blob。 */
  private readonly blobs = new Map<string, StoredBlob>();
  /** 自增序号（增量游标）。 */
  private sequence = 0;

  /**
   * 写入或覆盖一条密文 blob。
   *
   * @param blob 待写入的密文 blob
   * @returns 写入后的 blob
   */
  async upsert(blob: Omit<StoredBlob, 'seq'>): Promise<StoredBlob> {
    this.sequence += 1;
    const stored: StoredBlob = { ...blob, seq: this.sequence };
    this.blobs.set(blob.id, stored);
    return stored;
  }

  /**
   * 按游标增量拉取。
   *
   * @param cursor 起始游标（不含该序号）
   * @param limit 最多返回条数
   * @returns 密文 blob 列表（按 seq 升序）
   */
  async listSince(cursor: number, limit: number): Promise<StoredBlob[]> {
    return [...this.blobs.values()]
      .filter((blob) => blob.seq > cursor)
      .sort((left, right) => left.seq - right.seq)
      .slice(0, limit);
  }
}

/**
 * 校验请求体：只允许密文字段，且不得出现任何明文字段名。
 *
 * @param body 已解析的请求体
 * @returns 校验通过返回规范化后的 blob
 * @throws {Error} 字段非法时抛出，消息为中文提示
 */
export function validateBlobBody(body: unknown): Omit<StoredBlob, 'seq'> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('请求体必须是对象');
  }
  const candidate = body as Record<string, unknown>;

  // 明文字段一律拒绝——服务端只见密文。
  for (const field of FORBIDDEN_FIELDS) {
    if (field in candidate) {
      throw new Error(`服务端只接受密文，拒绝明文字段：${field}`);
    }
  }
  // 白名单之外的字段也拒绝，避免夹带。
  for (const key of Object.keys(candidate)) {
    if (!ALLOWED_BLOB_FIELDS.includes(key)) {
      throw new Error(`出现未允许的字段：${key}`);
    }
  }

  const required = ['id', 'entityType', 'entityId', 'ciphertext', 'iv', 'tag', 'algorithm', 'keyVersion', 'updatedAt', 'version'];
  for (const key of required) {
    if (candidate[key] === undefined || candidate[key] === null || candidate[key] === '') {
      throw new Error(`缺少必填字段：${key}`);
    }
  }
  if (typeof candidate['keyVersion'] !== 'number' || typeof candidate['version'] !== 'number') {
    throw new Error('keyVersion 与 version 必须是数字');
  }

  return {
    id: String(candidate['id']),
    entityType: String(candidate['entityType']),
    entityId: String(candidate['entityId']),
    ciphertext: String(candidate['ciphertext']),
    iv: String(candidate['iv']),
    tag: String(candidate['tag']),
    algorithm: String(candidate['algorithm']),
    keyVersion: Number(candidate['keyVersion']),
    updatedAt: String(candidate['updatedAt']),
    version: Number(candidate['version']),
  };
}

/**
 * 读取并解析请求体。
 *
 * @param request HTTP 请求
 * @returns 解析后的 JSON
 * @throws {Error} 请求体非法时抛出
 */
async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    // 单条 blob 体积很小，限制 1MB 足够，防止恶意大包。
    if (size > 1024 * 1024) {
      throw new Error('请求体过大');
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
    throw new Error('请求体不是合法 JSON');
  }
}

/**
 * 写出 JSON 响应。
 *
 * @param response HTTP 响应
 * @param status HTTP 状态码
 * @param payload 响应体
 * @returns 无异常
 */
function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(body);
}

/**
 * 创建同步服务实例。
 *
 * @param store 密文 blob 存储
 * @returns HTTP 服务实例
 */
export function createSyncServer(store: BlobStore = new MemoryBlobStore()) {
  return createServer((request, response) => {
    void handleRequest(request, response, store);
  });
}

/**
 * 处理一次 HTTP 请求。
 *
 * @param request HTTP 请求
 * @param response HTTP 响应
 * @param store 密文 blob 存储
 * @returns 无异常
 */
async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: BlobStore,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');

  // 健康检查：便于容器编排探活。
  if (request.method === 'GET' && url.pathname === '/healthz') {
    sendJson(response, 200, { ok: true, service: 'lifehub-sync-server' });
    return;
  }

  // 增量拉取。
  if (request.method === 'GET' && url.pathname === '/v1/blobs') {
    const cursor = Number.parseInt(url.searchParams.get('cursor') ?? '0', 10);
    const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? String(DEFAULT_PAGE_SIZE), 10);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const blobs = await store.listSince(Number.isFinite(cursor) ? cursor : 0, limit);
    const nextCursor = blobs.length > 0 ? blobs[blobs.length - 1]?.seq ?? cursor : cursor;
    sendJson(response, 200, { blobs, nextCursor });
    return;
  }

  // 上传 / 覆盖一条密文 blob。
  if (request.method === 'POST' && url.pathname === '/v1/blobs') {
    try {
      const body = await readJsonBody(request);
      const blob = validateBlobBody(body);
      const stored = await store.upsert(blob);
      sendJson(response, 200, { id: stored.id, seq: stored.seq, updatedAt: stored.updatedAt });
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : '请求无法处理',
      });
    }
    return;
  }

  sendJson(response, 404, { error: '接口不存在' });
}

/**
 * 启动同步服务。
 *
 * @returns 无异常
 */
function main(): void {
  const port = Number.parseInt(process.env['LIFEHUB_SYNC_PORT'] ?? String(DEFAULT_PORT), 10);
  const server = createSyncServer();
  server.listen(port, () => {
    console.log(`[lifehub-sync] 同步服务已启动：http://127.0.0.1:${port}（只存密文）`);
  });
}

// 仅在直接以脚本方式运行时启动服务；被 import 时（例如测试）不自动监听。
const executedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executedDirectly) {
  main();
}
