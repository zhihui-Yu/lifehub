/**
 * 同步服务运行时配置。
 *
 * 架构位置：apps/sync-server —— 进程启动时从环境变量读取的**全部**可调参数。
 *
 * 设计要点：
 * - 配置**只**来自环境变量或令牌文件，绝不来自代码常量（避免把密钥写进仓库）；
 * - 设备令牌在解析后立即交给鉴权模块做哈希，进程内不保留明文（见 `auth.ts`）；
 * - 任何非法取值都在启动阶段就报错退出，而不是在第一次请求时才暴露问题。
 */
import { readFileSync } from 'node:fs';

/** 默认监听端口。 */
export const DEFAULT_PORT = 8787;

/** 默认监听地址（仅本机可访问；容器内请覆盖为 0.0.0.0）。 */
export const DEFAULT_HOST = '127.0.0.1';

/** 默认 SQLite 文件路径（相对当前工作目录）。 */
export const DEFAULT_DATABASE_PATH = './data/lifehub-sync.db';

/** 单次增量拉取的默认条数。 */
export const DEFAULT_PAGE_SIZE = 100;

/** 单次增量拉取的最大条数。 */
export const MAX_PAGE_SIZE = 500;

/** 请求体大小上限（字节）；单条密文 blob 很小，1MB 足够。 */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/** 一台设备的接入凭据。 */
export interface DeviceCredential {
  /** 设备标识（用于日志与审计，不含任何密钥材料）。 */
  deviceId: string;
  /** 设备令牌明文；仅在解析瞬间存在，构造鉴权器后即被哈希取代。 */
  secret: string;
}

/** 同步服务的完整运行时配置。 */
export interface SyncServerConfig {
  /** 监听地址。 */
  host: string;
  /** 监听端口。 */
  port: number;
  /** SQLite 数据库文件路径。 */
  databasePath: string;
  /** 设备接入凭据列表。 */
  credentials: readonly DeviceCredential[];
  /** 增量拉取默认条数。 */
  defaultPageSize: number;
  /** 增量拉取最大条数。 */
  maxPageSize: number;
  /** 请求体大小上限（字节）。 */
  maxBodyBytes: number;
  /** 允许的跨域来源；空字符串表示不启用 CORS。 */
  corsOrigin: string;
}

/**
 * 把字符串解析为正整数。
 *
 * @param raw 环境变量原始值
 * @param fallback 取值非法时使用的默认值
 * @param min 允许的最小值
 * @param max 允许的最大值
 * @returns 落在 [min, max] 区间内的整数
 */
function parseBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

/**
 * 解析一行设备凭据。
 *
 * 说明：支持 `标签=令牌` 与裸令牌两种写法；裸令牌按出现顺序生成 `device-N` 标识。
 * 令牌本身允许包含 `=`（例如 base64 填充），因此只在**第一个** `=` 处切分。
 *
 * @param line 单行凭据文本
 * @param index 该行在列表中的序号（用于生成默认设备标识）
 * @returns 解析出的设备凭据
 */
function parseCredentialLine(line: string, index: number): DeviceCredential | null {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) {
    return null;
  }
  const separator = trimmed.indexOf('=');
  if (separator < 0) {
    return { deviceId: `device-${index + 1}`, secret: trimmed };
  }
  const deviceId = trimmed.slice(0, separator).trim();
  const secret = trimmed.slice(separator + 1).trim();
  if (deviceId === '' || secret === '') {
    return null;
  }
  return { deviceId, secret };
}

/**
 * 从文本内容解析设备凭据列表。
 *
 * @param content 多行凭据文本
 * @returns 解析出的凭据列表（忽略空行与 `#` 注释行）
 */
export function parseCredentialText(content: string): DeviceCredential[] {
  const out: DeviceCredential[] = [];
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseCredentialLine(line, out.length);
    if (parsed !== null) {
      out.push(parsed);
    }
  }
  return out;
}

/**
 * 从环境变量装配同步服务配置。
 *
 * 说明：令牌来源二选一——`LIFEHUB_SYNC_TOKENS`（内联，逗号分隔）或
 * `LIFEHUB_SYNC_TOKEN_FILE`（文件，一行一条，便于 Docker Secret / NAS 挂载）。
 *
 * @param env 环境变量表
 * @returns 装配好的运行时配置
 * @throws {Error} 未配置任何设备令牌时抛出（**失败即关闭**，绝不退化成匿名访问）
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): SyncServerConfig {
  const inline = env['LIFEHUB_SYNC_TOKENS'];
  const tokenFile = env['LIFEHUB_SYNC_TOKEN_FILE'];
  const credentials: DeviceCredential[] = [];

  if (inline !== undefined && inline.trim() !== '') {
    credentials.push(...parseCredentialText(inline.replace(/,/g, '\n')));
  }
  if (tokenFile !== undefined && tokenFile.trim() !== '') {
    credentials.push(...parseCredentialText(readFileSync(tokenFile, 'utf8')));
  }
  if (credentials.length === 0) {
    throw new Error(
      '未配置设备令牌：请设置环境变量 LIFEHUB_SYNC_TOKENS（逗号分隔）或 LIFEHUB_SYNC_TOKEN_FILE（令牌文件）。' +
        '服务端拒绝以匿名模式启动。',
    );
  }

  return {
    host: env['LIFEHUB_SYNC_HOST']?.trim() || DEFAULT_HOST,
    port: parseBoundedInt(env['LIFEHUB_SYNC_PORT'], DEFAULT_PORT, 1, 65535),
    databasePath: env['LIFEHUB_SYNC_DB_PATH']?.trim() || DEFAULT_DATABASE_PATH,
    credentials,
    defaultPageSize: parseBoundedInt(
      env['LIFEHUB_SYNC_DEFAULT_PAGE_SIZE'],
      DEFAULT_PAGE_SIZE,
      1,
      MAX_PAGE_SIZE,
    ),
    maxPageSize: parseBoundedInt(
      env['LIFEHUB_SYNC_MAX_PAGE_SIZE'],
      MAX_PAGE_SIZE,
      1,
      MAX_PAGE_SIZE,
    ),
    maxBodyBytes: parseBoundedInt(
      env['LIFEHUB_SYNC_MAX_BODY_BYTES'],
      DEFAULT_MAX_BODY_BYTES,
      1024,
      64 * 1024 * 1024,
    ),
    corsOrigin: env['LIFEHUB_SYNC_CORS_ORIGIN']?.trim() || '',
  };
}
