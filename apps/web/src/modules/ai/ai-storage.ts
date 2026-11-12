/**
 * AI 分析层本地加密配置存储与请求指标审计仓库（模块 E：E-01 / E-04 / X-12 / X-13）。
 *
 * 架构位置：apps/web 的「AI 分析模块」存储与审计层。
 *
 * 核心安全与合规红线：
 * 1. **API Key 本地 AES-GCM 加密存储（E-01 / X-12）**：
 *    用户输入的 API Key 必须经由 WebCrypto `AES-GCM`（256-bit 密钥 + 96-bit 随机 IV）加密为密文后，
 *    仅存入本地 `aiSettings` 表，绝不以明文落盘，且绝不写入同步/备份所用的 `records` 表；
 * 2. **请求审计记录只存指标不存明文（E-04 / X-13）**：
 *    `aiAnalysisRequests` 表仅保存 `payloadDigest`（SHA-256 64 位十六进制摘要）、`provider`、`model`、
 *    `latencyMs`、`tokenUsage`、`status` 等遥测指标，严禁包含 `prompt`、`response`、`messages` 等明文字段。
 */
import { LifeHubError } from '@lifehub/core';
import type { LifeHubDatabase } from '@/platform/db';
import { createDatabase } from '@/platform/db';

/** 支持的远程或本地 AI 接口提供方类型。 */
export type AiProviderType = 'deepseek' | 'openai-compatible' | 'ollama';

/** 本地设备专属包装密钥在 localStorage 中的键名（不参与任何同步或备份）。 */
const LOCAL_WRAPPING_KEY_STORAGE_KEY = 'lifehub:ai:local-wrapping-key:v1';

/** 进程内后备包装密钥（无 localStorage 环境兜底）。 */
let memoryWrappingKeyBytes: Uint8Array | null = null;

/**
 * 存储在 Dexie `aiSettings` 表中的加密配置记录（不含明文 apiKey）。
 */
export interface StoredAiSettingsRecord {
  /** 固定主键 'default'。 */
  id: 'default';
  /** AI 接口提供方类型。 */
  provider: AiProviderType;
  /** 接口基础 URL（如 'https://api.openai.com/v1' 或 'http://localhost:11434'）。 */
  baseUrl: string;
  /** 模型名称（如 'gpt-4o-mini' 或 'qwen2.5:7b'）。 */
  model: string;
  /** AES-GCM 加密后的 API Key 密文（Base64 编码）。 */
  encryptedApiKeyCiphertext: string;
  /** AES-GCM 加密使用的 12 字节随机 IV（Base64 编码）。 */
  encryptedApiKeyIv: string;
  /** 是否已配置非空 API Key。 */
  hasApiKey: boolean;
  /** 最后更新时间 ISO 8601 UTC。 */
  updatedAt: string;
}

/**
 * 供业务层读取或保存的 AI 配置输入/输出模型。
 */
export interface AiConfigInput {
  /** 接口提供方。 */
  provider: AiProviderType;
  /** 接口基础地址。 */
  baseUrl: string;
  /** 模型标识。 */
  model: string;
  /** 明文 API Key（保存时在内存加密后即丢弃明文）。 */
  apiKey?: string;
}

/**
 * Token 消耗明细结构。
 */
export interface AiTokenUsage {
  /** 提示词 Token 数。 */
  promptTokens: number;
  /** 生成回复 Token 数。 */
  completionTokens: number;
  /** 总 Token 数。 */
  totalTokens: number;
}

/**
 * AI 分析请求审计记录（E-04 / X-13：只存指标与 SHA-256 摘要，严禁存明文）。
 */
export interface AIAnalysisRequestRecord {
  /** 记录唯一主键。 */
  id: string;
  /** 请求发生时间 ISO 8601 UTC。 */
  at: string;
  /** 创建时间 ISO 8601 UTC（索引字段）。 */
  createdAt: string;
  /** 触发分析的模块名（如 'life-review'）。 */
  module: string;
  /** 接口提供方标识。 */
  provider: AiProviderType | 'local';
  /** 模型名称。 */
  model: string;
  /** Prompt 模板版本 ID。 */
  promptTemplateId: string;
  /** 请求载荷的 SHA-256 十六进制摘要（64 字符 hex）。 */
  payloadDigest: string;
  /** 请求状态。 */
  status: 'success' | 'error';
  /** 是否成功布尔标记（兼容 core 模型）。 */
  success: boolean;
  /** 请求耗时（毫秒）。 */
  latencyMs: number;
  /** Token 用量结构。 */
  tokenUsage: AiTokenUsage;
  /** 总消耗 Token 数（兼容 core 模型）。 */
  tokensUsed: number;
  /** 失败时的错误码。 */
  errorCode?: string;
}

/** 审计记录中严禁出现的明文字段黑名单（X-13）。 */
const FORBIDDEN_AUDIT_KEYS = [
  'prompt',
  'userPrompt',
  'systemPrompt',
  'fullPreviewText',
  'response',
  'replyText',
  'messages',
  'content',
  'rawPrompt',
  'rawResponse',
  'apiKey',
] as const;

/**
 * 将 `Uint8Array` 编码为 Base64 字符串。
 *
 * @param bytes 字节数组
 * @returns Base64 字符串
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

/**
 * 将 Base64 字符串解码为 `Uint8Array`。
 *
 * @param base64 Base64 字符串
 * @returns 字节数组
 */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * 获取或生成本机专属的 256-bit AES-GCM 包装密钥。
 *
 * @returns WebCrypto `CryptoKey`
 */
async function getOrCreateLocalWrappingKey(): Promise<CryptoKey> {
  let keyBytes: Uint8Array | null = null;
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(LOCAL_WRAPPING_KEY_STORAGE_KEY);
    if (saved) {
      try {
        const decoded = base64ToBytes(saved);
        if (decoded.byteLength === 32) {
          keyBytes = decoded;
        }
      } catch {
        keyBytes = null;
      }
    }
    if (!keyBytes) {
      keyBytes = new Uint8Array(32);
      crypto.getRandomValues(keyBytes);
      localStorage.setItem(LOCAL_WRAPPING_KEY_STORAGE_KEY, bytesToBase64(keyBytes));
    }
  } else {
    if (!memoryWrappingKeyBytes) {
      memoryWrappingKeyBytes = new Uint8Array(32);
      crypto.getRandomValues(memoryWrappingKeyBytes);
    }
    keyBytes = memoryWrappingKeyBytes;
  }

  const rawBuffer = keyBytes.buffer.slice(
    keyBytes.byteOffset,
    keyBytes.byteOffset + keyBytes.byteLength,
  ) as ArrayBuffer;

  return crypto.subtle.importKey('raw', rawBuffer, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * 使用 WebCrypto AES-GCM 加密明文 API Key（E-01）。
 *
 * @param plaintextApiKey 明文 API Key
 * @returns 包含密文 Base64 与 IV Base64 的对象
 * @throws 无
 */
export async function encryptApiKeyWithAesGcm(plaintextApiKey: string): Promise<{
  ciphertextBase64: string;
  ivBase64: string;
}> {
  if (!plaintextApiKey) {
    return { ciphertextBase64: '', ivBase64: '' };
  }
  const key = await getOrCreateLocalWrappingKey();
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encoded = new TextEncoder().encode(plaintextApiKey);
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded,
  );
  return {
    ciphertextBase64: bytesToBase64(new Uint8Array(encryptedBuffer)),
    ivBase64: bytesToBase64(iv),
  };
}

/**
 * 使用 WebCrypto AES-GCM 解密已加密的 API Key（E-01）。
 *
 * @param ciphertextBase64 密文 Base64
 * @param ivBase64 IV Base64
 * @returns 还原后的明文 API Key
 * @throws {LifeHubError} 解密失败或认证标签不匹配时抛出 `LIFEHUB_E_CRYPTO_AUTH_FAILED`
 */
export async function decryptApiKeyWithAesGcm(
  ciphertextBase64: string,
  ivBase64: string,
): Promise<string> {
  if (!ciphertextBase64 || !ivBase64) {
    return '';
  }
  try {
    const key = await getOrCreateLocalWrappingKey();
    const iv = base64ToBytes(ivBase64);
    const cipherBytes = base64ToBytes(ciphertextBase64);
    const cipherBuffer = cipherBytes.buffer.slice(
      cipherBytes.byteOffset,
      cipherBytes.byteOffset + cipherBytes.byteLength,
    ) as ArrayBuffer;
    const ivBuffer = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBuffer },
      key,
      cipherBuffer,
    );
    return new TextDecoder().decode(decryptedBuffer);
  } catch (err) {
    throw new LifeHubError(
      'LIFEHUB_E_CRYPTO_AUTH_FAILED',
      'AI API Key 解密失败，本地包装密钥可能已变更',
      { cause: err },
    );
  }
}

/**
 * 计算任意请求载荷字符串的 SHA-256 十六进制摘要（E-04 / X-13）。
 *
 * @param payload 待计算摘要的请求体文本
 * @returns 64 位小写十六进制 SHA-256 字符串
 * @throws 无
 */
export async function computePayloadSha256Hex(payload: string): Promise<string> {
  const bytes = new TextEncoder().encode(payload);
  const digestBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const digestArray = new Uint8Array(digestBuffer);
  let hex = '';
  for (let i = 0; i < digestArray.length; i++) {
    hex += (digestArray[i] ?? 0).toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * 运行时断言：校验 `AIAnalysisRequestRecord` 仅包含指标与 SHA-256 摘要，绝不含任何明文 Prompt 或回复（X-13）。
 *
 * @param record 待校验的记录对象
 * @returns 无（通过断言收窄类型）
 * @throws {LifeHubError} 当记录包含禁用明文字段或 `payloadDigest` 非 64 位 hex 时抛出异常
 */
export function assertMetricsOnlyRequestRecord(
  record: unknown,
): asserts record is AIAnalysisRequestRecord {
  if (!record || typeof record !== 'object') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', 'AI 请求审计记录必须为对象');
  }
  const obj = record as Record<string, unknown>;
  for (const forbiddenKey of FORBIDDEN_AUDIT_KEYS) {
    if (forbiddenKey in obj && obj[forbiddenKey] !== undefined) {
      throw new LifeHubError(
        'LIFEHUB_E_VALIDATION',
        `违反 X-13 红线：AI 请求审计记录禁止包含明文字段 "${forbiddenKey}"`,
      );
    }
  }
  const digest = obj['payloadDigest'];
  if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/i.test(digest)) {
    throw new LifeHubError(
      'LIFEHUB_E_VALIDATION',
      'AI 请求审计记录必须包含合法的 64 位十六进制 SHA-256 payloadDigest',
    );
  }
}

/**
 * AI 配置与请求审计存储服务。
 */
export class AiStorageService {
  /** 数据库实例。 */
  private readonly db: LifeHubDatabase;

  /**
   * 构造 AI 存储服务。
   *
   * @param database 数据库实例，默认调用 `createDatabase()`
   */
  constructor(database: LifeHubDatabase = createDatabase()) {
    this.db = database;
  }

  /**
   * 保存 AI 接口配置并将 API Key 使用 AES-GCM 加密后写入 IndexedDB `aiSettings` 表（E-01）。
   *
   * @param input AI 配置输入
   * @returns 持久化后的加密配置记录（不含明文 apiKey）
   * @throws {LifeHubError} 参数非法时抛出异常
   */
  async saveConfig(input: AiConfigInput): Promise<StoredAiSettingsRecord> {
    const table = this.db.table<StoredAiSettingsRecord>('aiSettings');
    const existing = await table.get('default');

    let encryptedApiKeyCiphertext = existing?.encryptedApiKeyCiphertext ?? '';
    let encryptedApiKeyIv = existing?.encryptedApiKeyIv ?? '';
    let hasApiKey = existing?.hasApiKey ?? false;

    if (input.apiKey !== undefined) {
      const trimmedKey = input.apiKey.trim();
      if (trimmedKey.length > 0) {
        const encrypted = await encryptApiKeyWithAesGcm(trimmedKey);
        encryptedApiKeyCiphertext = encrypted.ciphertextBase64;
        encryptedApiKeyIv = encrypted.ivBase64;
        hasApiKey = true;
      } else {
        encryptedApiKeyCiphertext = '';
        encryptedApiKeyIv = '';
        hasApiKey = false;
      }
    }

    const rawBaseUrl = input.baseUrl.trim();
    const rawModel = input.model.trim();
    const normalizedBaseUrl =
      input.provider === 'deepseek' &&
      (!rawBaseUrl || rawBaseUrl === 'https://api.openai.com/v1' || rawBaseUrl === 'http://localhost:11434')
        ? 'https://api.deepseek.com'
        : rawBaseUrl ||
          (input.provider === 'ollama'
            ? 'http://localhost:11434'
            : input.provider === 'deepseek'
              ? 'https://api.deepseek.com'
              : 'https://api.openai.com/v1');

    const normalizedModel =
      input.provider === 'deepseek' &&
      (!rawModel || rawModel === 'gpt-4o-mini' || rawModel === 'qwen2.5:7b')
        ? 'deepseek-chat'
        : rawModel ||
          (input.provider === 'ollama'
            ? 'qwen2.5:7b'
            : input.provider === 'deepseek'
              ? 'deepseek-chat'
              : 'gpt-4o-mini');

    const record: StoredAiSettingsRecord = {
      id: 'default',
      provider: input.provider,
      baseUrl: normalizedBaseUrl,
      model: normalizedModel,
      encryptedApiKeyCiphertext,
      encryptedApiKeyIv,
      hasApiKey,
      updatedAt: new Date().toISOString(),
    };

    await table.put(record);
    return record;
  }

  /**
   * 读取已保存的 AI 加密配置记录（不解密 API Key）。
   *
   * @returns 加密配置记录；若尚未配置则返回默认配置（默认 DeepSeek 官方接口）
   * @throws 无
   */
  async getConfigRecord(): Promise<StoredAiSettingsRecord> {
    const existing = await this.db.table<StoredAiSettingsRecord>('aiSettings').get('default');
    if (existing) {
      return existing;
    }
    return {
      id: 'default',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      encryptedApiKeyCiphertext: '',
      encryptedApiKeyIv: '',
      hasApiKey: false,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 解密并返回当前保存的明文 API Key（仅在发起请求瞬间于内存中使用，E-01）。
   *
   * @returns 解密后的 API Key 字符串（未配置时返回空字符串）
   * @throws {LifeHubError} 解密失败时抛出异常
   */
  async getDecryptedApiKey(): Promise<string> {
    const record = await this.getConfigRecord();
    if (!record.hasApiKey || !record.encryptedApiKeyCiphertext) {
      return '';
    }
    return decryptApiKeyWithAesGcm(
      record.encryptedApiKeyCiphertext,
      record.encryptedApiKeyIv,
    );
  }

  /**
   * 记录一次 AI 分析请求的审计指标（严格执行 `assertMetricsOnlyRequestRecord` 校验，E-04 / X-13）。
   *
   * @param record 待保存的审计指标记录
   * @returns 保存后的记录
   * @throws {LifeHubError} 若记录含有任何明文 Prompt/Response 字段则拒绝写入并抛出异常
   */
  async saveRequestAudit(record: AIAnalysisRequestRecord): Promise<AIAnalysisRequestRecord> {
    assertMetricsOnlyRequestRecord(record);
    await this.db.table<AIAnalysisRequestRecord>('aiAnalysisRequests').put(record);
    return record;
  }

  /**
   * 按时间倒序列出全部 AI 请求审计指标记录（E-04）。
   *
   * @returns 审计指标记录数组
   * @throws 无
   */
  async listRequestAudits(): Promise<AIAnalysisRequestRecord[]> {
    const all = await this.db.table<AIAnalysisRequestRecord>('aiAnalysisRequests').toArray();
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
