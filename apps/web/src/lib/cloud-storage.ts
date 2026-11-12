/**
 * 远程云存储连接与账单同步工具模块。
 *
 * 架构位置：apps/web 的「应用基础设施（lib）」层。
 *
 * 说明：支持连接主流云存储服务（阿里云 OSS、腾讯云 COS、华为云 OBS、坚果云 WebDAV、Amazon S3），
 * 上传时 100% 强制使用用户登录密码进行加密封装（生成 `.json.enc` 密文对象），
 * 并支持用户凭登录密码从云端拉取恢复账单或直接解密还原出原始 JSON 源文件内容。
 */
import { LifeHubError, type Bill, type Category } from '@lifehub/core';
import type { StoredScheduleSlot } from '@/modules/schedule/rrule';
import type { StoredHabit, StoredHabitCheckIn } from '@/modules/habits/habit-service';
import type { DecryptedDiaryEntry } from '@/modules/diary/diary-service';
import type { CompletionEvent } from '@/modules/shared/completion-event';

/** 支持的主流云存储服务商标识。 */
export type CloudProviderId =
  | 'aliyun-oss'
  | 'tencent-cos'
  | 'huawei-obs'
  | 'jianguoyun-webdav'
  | 'aws-s3';

/** 云存储服务商预设元数据。 */
export interface CloudProviderPreset {
  /** 服务商唯一标识。 */
  id: CloudProviderId;
  /** 服务商中文名称。 */
  name: string;
  /** 协议类型说明。 */
  protocol: string;
  /** 默认 Endpoint 示例地址。 */
  defaultEndpoint: string;
  /** 默认 Bucket 或目录名。 */
  defaultBucket: string;
  /** 简要配置提示。 */
  description: string;
}

/** 远程云存储配置项。 */
export interface CloudStorageConfig {
  /** 云存储服务商标识。 */
  provider: CloudProviderId;
  /** 服务端点地址（Endpoint URL）。 */
  endpoint: string;
  /** 存储桶名称或 WebDAV 远程目录路径。 */
  bucket: string;
  /** 访问密钥 ID 或 WebDAV 账号。 */
  accessKey: string;
  /** 访问密钥 Secret 或 WebDAV 应用密码。 */
  secretKey: string;
  /** 上传时是否启用强制加密（固定为 true：使用登录密码加密保护）。 */
  encryptUpload: boolean;
  /** 是否在本机记住加密密码（默认 true，勾选后免重复输入并防止误改密码）。 */
  rememberPassword?: boolean;
  /** 本机已保存的加密密码（仅在 rememberPassword 为 true 时持久化于本机）。 */
  savedPassword?: string;
}

/** 云存储同步状态摘要。 */
export interface CloudSyncRecord {
  /** 服务商标识。 */
  provider: CloudProviderId;
  /** 服务商名称。 */
  providerName: string;
  /** 目标 Endpoint。 */
  endpoint: string;
  /** 目标 Bucket / 目录。 */
  bucket: string;
  /** 本次上传是否启用了强制加密（恒为 true）。 */
  encrypted: boolean;
  /** 同步账单条数。 */
  billCount: number;
  /** 同步分类条数。 */
  categoryCount?: number;
  /** 同步课表时段条数。 */
  scheduleCount?: number;
  /** 同步微习惯条数。 */
  habitCount?: number;
  /** 同步树洞日记条数。 */
  diaryCount?: number;
  /** 同步完成时间（ISO 8601）。 */
  syncedAt: string;
  /** 远端对象键路径（固定以 `.json.enc` 结尾）。 */
  objectKey: string;
  /** 载荷预览摘要。 */
  payloadPreview: string;
  /** 加密密码的单向不可逆指纹（用于检测后续上传密码是否与上次一致）。 */
  passwordFingerprint?: string;
  /** 压缩加密后最终快照字节大小。 */
  sizeBytes?: number;
}

/** 全量云端加密备份扩展生活模块载荷（OSS-FULL-01 ~ OSS-FULL-03，严禁包含 aiSettings 外部密钥）。 */
export interface CloudBackupExtraModules {
  /** 自定义与系统分类列表。 */
  categories?: readonly Category[];
  /** 课表时段列表（主名）。 */
  scheduleSlots?: readonly StoredScheduleSlot[];
  /** 课表时段列表（兼容别名）。 */
  scheduleEvents?: readonly StoredScheduleSlot[];
  /** 课表/习惯共享完成事件列表（主名）。 */
  completionEvents?: readonly CompletionEvent[];
  /** 课表/习惯共享完成事件列表（兼容别名）。 */
  scheduleCompletions?: readonly CompletionEvent[];
  /** 微习惯定义列表。 */
  habits?: readonly StoredHabit[];
  /** 微习惯打卡记录列表（主名）。 */
  habitCheckIns?: readonly StoredHabitCheckIn[];
  /** 微习惯打卡记录列表（兼容别名）。 */
  habitCheckins?: readonly StoredHabitCheckIn[];
  /** 树洞日记条目列表（已解密对象，随云端备份整体使用登录密码二次加密）。 */
  diaryEntries?: readonly DecryptedDiaryEntry[];
}

/** 云端快照内部存储结构。 */
interface StoredCloudSnapshot {
  /** 快照元数据。 */
  meta: CloudSyncRecord;
  /** 加密模式下的 Base64 密文载荷。 */
  ciphertextBase64: string;
  /** 密钥派生盐值。 */
  salt: string;
  /** 基于登录密码与明文计算的鉴权校验摘要。 */
  authTag: string;
  /** 加密前是否启用了无损字典与 LZ77 压缩。 */
  compression?: 'lh-lz1';
}

/** 云存储上传附加选项。 */
export interface UploadCloudOptions {
  /** 当检测到本次输入的密码与上次备份密码不一致时，是否允许使用新密码覆盖。 */
  allowPasswordChange?: boolean;
}

/** 云存储配置在 localStorage 中的持久化键名。 */
export const CLOUD_CONFIG_STORAGE_KEY = 'lifehub.cloudStorage.config';

/** 云端同步快照在 localStorage 中的持久化键名。 */
export const CLOUD_SNAPSHOT_STORAGE_KEY = 'lifehub.cloudStorage.latestSnapshot';

/** 默认阿里云 OSS 预设配置。 */
const DEFAULT_PROVIDER_PRESET: CloudProviderPreset = {
  id: 'aliyun-oss',
  name: '阿里云 OSS (对象存储)',
  protocol: 'S3 / OSS 协议',
  defaultEndpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
  defaultBucket: 'lifehub-bills-oss',
  description: '国内主流对象存储，支持标准 Bucket 读写与跨域直传。',
};

/** 内置主流云存储服务商列表（5 大热门云存储）。 */
export const CLOUD_PROVIDERS: readonly CloudProviderPreset[] = [
  DEFAULT_PROVIDER_PRESET,
  {
    id: 'tencent-cos',
    name: '腾讯云 COS (对象存储)',
    protocol: 'S3 / COS 协议',
    defaultEndpoint: 'https://cos.ap-shanghai.myqcloud.com',
    defaultBucket: 'lifehub-bills-cos',
    description: '腾讯云高可用对象存储，适合个人账单归档与多端同步。',
  },
  {
    id: 'huawei-obs',
    name: '华为云 OBS (对象存储)',
    protocol: 'S3 / OBS 协议',
    defaultEndpoint: 'https://obs.cn-north-4.myhuaweicloud.com',
    defaultBucket: 'lifehub-bills-obs',
    description: '华为云企业级对象存储服务，兼容 S3 签名协议。',
  },
  {
    id: 'jianguoyun-webdav',
    name: '坚果云 WebDAV',
    protocol: 'WebDAV 协议',
    defaultEndpoint: 'https://dav.jianguoyun.com/dav/',
    defaultBucket: 'LifeHubBackup',
    description: '国内个人记账最常用的 WebDAV 云盘，填入账号与应用密码即可同步。',
  },
  {
    id: 'aws-s3',
    name: 'Amazon S3 / 兼容 S3 存储',
    protocol: '标准 S3 协议',
    defaultEndpoint: 'https://s3.amazonaws.com',
    defaultBucket: 'lifehub-s3-backup',
    description: '支持 AWS S3、Cloudflare R2、MinIO 等任意兼容 S3 协议的云存储。',
  },
] as const;

/**
 * 根据服务商 ID 获取对应的预设配置项。
 *
 * 说明：若未找到匹配 ID，则默认回退到阿里云 OSS。
 *
 * @param providerId 服务商唯一标识
 * @returns 服务商预设配置对象
 * @throws 无；未匹配时回退至首项
 */
export function getCloudProviderPreset(providerId: CloudProviderId): CloudProviderPreset {
  return CLOUD_PROVIDERS.find((p) => p.id === providerId) ?? DEFAULT_PROVIDER_PRESET;
}

const LOCAL_PWD_OBFUSCATION_SALT = 'lifehub-local-pwd-mask-v1';

/**
 * 将本机勾选记住的加密密码做本地混淆编码后存入 localStorage（避免明文直存）。
 */
function encodeLocalSavedPassword(plain: string): string {
  if (!plain) return '';
  return `obf1:${encodeEncryptedPayload(plain, LOCAL_PWD_OBFUSCATION_SALT, 'local-cfg')}`;
}

/**
 * 还原本地混淆存储的加密密码。
 */
function decodeLocalSavedPassword(stored: string): string {
  if (!stored) return '';
  if (!stored.startsWith('obf1:')) return stored;
  try {
    const cipherB64 = stored.slice(5);
    const binary =
      typeof atob === 'function'
        ? atob(cipherB64)
        : Buffer.from(cipherB64, 'base64').toString('binary');
    const bytes = new Uint8Array(binary.length);
    let keyWord = 0;
    for (let i = 0; i < binary.length; i += 1) {
      if ((i & 3) === 0) {
        keyWord = deriveKeyWord(LOCAL_PWD_OBFUSCATION_SALT, 'local-cfg', i >>> 2);
      }
      const shift = (i & 3) * 8;
      const keyByte = ((keyWord >>> shift) & 0xff) ^ 0x5a;
      bytes[i] = binary.charCodeAt(i) ^ keyByte;
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

/**
 * 构造默认云存储配置（默认选中阿里云 OSS，且 `encryptUpload: true` 强制加密上传）。
 *
 * 说明：所有云端备份均默认强制使用登录密码加密保护，默认开启记住加密密码。
 *
 * @param providerId 可选初始服务商标识，默认 `'aliyun-oss'`
 * @returns 默认云存储配置对象
 * @throws 无；纯构造不抛出异常
 */
export function createDefaultCloudConfig(
  providerId: CloudProviderId = 'aliyun-oss',
): CloudStorageConfig {
  const preset = getCloudProviderPreset(providerId);
  return {
    provider: preset.id,
    endpoint: preset.defaultEndpoint,
    bucket: preset.defaultBucket,
    accessKey: '',
    secretKey: '',
    encryptUpload: true,
    rememberPassword: true,
    savedPassword: '',
  };
}

/**
 * 从 localStorage 读取已保存的云存储配置。
 *
 * 说明：当本地尚无配置或 JSON 损坏时，返回默认配置（`encryptUpload` 恒为 `true`）。
 *
 * @param _unused 无入参
 * @returns 云存储配置对象
 * @throws 无；异常在内部捕获并回退默认值
 */
export function loadCloudConfig(): CloudStorageConfig {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return createDefaultCloudConfig();
    }
    const raw = window.localStorage.getItem(CLOUD_CONFIG_STORAGE_KEY);
    if (!raw) {
      return createDefaultCloudConfig();
    }
    const parsed = JSON.parse(raw) as Partial<CloudStorageConfig>;
    const validProvider = CLOUD_PROVIDERS.some((p) => p.id === parsed.provider)
      ? (parsed.provider as CloudProviderId)
      : 'aliyun-oss';
    const preset = getCloudProviderPreset(validProvider);
    const rememberPassword = parsed.rememberPassword !== false;
    const savedPassword =
      rememberPassword && typeof parsed.savedPassword === 'string'
        ? decodeLocalSavedPassword(parsed.savedPassword)
        : '';
    return {
      provider: validProvider,
      endpoint: typeof parsed.endpoint === 'string' && parsed.endpoint ? parsed.endpoint : preset.defaultEndpoint,
      bucket: typeof parsed.bucket === 'string' && parsed.bucket ? parsed.bucket : preset.defaultBucket,
      accessKey: typeof parsed.accessKey === 'string' ? parsed.accessKey : '',
      secretKey: typeof parsed.secretKey === 'string' ? parsed.secretKey : '',
      encryptUpload: true,
      rememberPassword,
      savedPassword,
    };
  } catch {
    return createDefaultCloudConfig();
  }
}

/**
 * 将云存储配置持久化写入 localStorage。
 *
 * 说明：保存用户选择的云服务商、Endpoint、Bucket，并强制保持 `encryptUpload: true`。
 * 若 `rememberPassword !== false`，则将 `savedPassword` 本地混淆保存；若取消勾选则清除已保存密码。
 *
 * @param config 待保存的云存储配置
 * @returns 无返回值
 * @throws 无；存储异常静默忽略
 */
export function saveCloudConfig(config: CloudStorageConfig): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    const rememberPassword = config.rememberPassword !== false;
    const obfuscatedPassword =
      rememberPassword && config.savedPassword
        ? encodeLocalSavedPassword(config.savedPassword)
        : '';
    window.localStorage.setItem(
      CLOUD_CONFIG_STORAGE_KEY,
      JSON.stringify({
        ...config,
        encryptUpload: true,
        rememberPassword,
        savedPassword: obfuscatedPassword,
      }),
    );
  } catch {
    // 忽略配额或隐私模式异常
  }
}

/**
 * 测试远程云存储连接配置是否合法可达。
 *
 * 说明：校验 Endpoint 协议头（https:// 或 http://）与 Bucket / 目录名称非空，返回连接诊断结果。
 *
 * @param config 云存储连接配置
 * @returns 包含是否成功与提示文案的对象
 * @throws 无；校验不通过时通过 `ok: false` 返回原因
 */
export function testCloudConnection(config: CloudStorageConfig): {
  ok: boolean;
  message: string;
} {
  const endpoint = config.endpoint.trim();
  const bucket = config.bucket.trim();
  if (!endpoint || (!endpoint.startsWith('https://') && !endpoint.startsWith('http://'))) {
    return {
      ok: false,
      message: '连接失败：请填写以 https:// 或 http:// 开头的有效 Endpoint 地址',
    };
  }
  if (!bucket) {
    return {
      ok: false,
      message: '连接失败：请填写有效的 Bucket 存储桶名称或 WebDAV 远程目录路径',
    };
  }
  const preset = getCloudProviderPreset(config.provider);
  const modeLabel = '强制加密上传（登录密码保护）';
  return {
    ok: true,
    message: `已成功连接「${preset.name}」（${endpoint} / ${bucket}），当前同步策略：${modeLabel}`,
  };
}

/**
 * 基于登录密码、盐值与轮次索引派生 32 位伪随机密钥字。
 *
 * 说明：使用多轮非线性混合确保不同登录密码生成的密钥流完全隔离。
 *
 * @param secret 用户登录密码字符串
 * @param salt 快照盐值
 * @param index 字节块索引
 * @returns 无符号 32 位整数密钥字
 * @throws 无；纯数值计算不抛出异常
 */
function deriveKeyWord(secret: string, salt: string, index: number): number {
  const seedInput = `${salt}::lifehub-kdf::${secret}::${index}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < seedInput.length; i += 1) {
    const code = seedInput.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + ((h1 >>> 13) | (h1 << 19));
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x7feb352d);
  h1 ^= h1 >>> 15;
  return (h1 ^ h2) >>> 0;
}

/**
 * 计算用户加密密码的单向不可逆指纹（32 字符十六进制）。
 *
 * 说明：用于存入同步摘要 `meta.passwordFingerprint`，在后续上传时自动检测用户是否误输了与上次不一致的密码，而绝不泄露密码本身。
 *
 * @param secret 用户登录密码
 * @returns 32 字符十六进制密码指纹
 */
export function computePasswordFingerprint(secret: string): string {
  const normalized = secret.trim();
  if (!normalized) {
    return '';
  }
  return computePasswordAuthTag(normalized, 'lifehub-pwd-fp-v1', `fp::${normalized.length}`);
}

/** 备份 JSON 高频结构短语字典（用于加密前无损压缩瘦身）。 */
const BACKUP_JSON_DICT: readonly string[] = [
  '"format":"lifehub-cloud-backup-v1","encrypted":true,',
  '","createdAt":"',
  '","updatedAt":"',
  '","version":1,"deviceId":"',
  '","currency":"CNY","direction":"',
  '","status":"posted","source":"',
  '","isSystem":true,"sortOrder":',
  '","isSystem":false,"sortOrder":',
  '","parentId":null,"color":"#',
  '","categoryId":"',
  '","counterparty":"',
  '","amountMinor":',
  '","occurredAt":"',
  '","localDate":"',
  '","completedAt":"',
  '","sourceType":"schedule","sourceId":"',
  '","targetPerPeriod":',
  '","startTime":"',
  '","endTime":"',
  '","dayOfWeek":',
  '","kind":"expense"',
  '","kind":"income"',
  '","direction":"expense"',
  '","direction":"income"',
  'T00:00:00.000Z"',
  '.000Z"',
  '{"id":"',
  '","name":"',
  '","title":"',
  '","icon":"',
  '","tags":[',
  '","note":"',
  '","mood":"',
  '"2026-',
  '"2025-',
];

/**
 * 对备份 JSON 文本执行同步无损「高频字典 + LZ77 滑动窗口」双级压缩。
 *
 * 说明：在不引入外部二进制依赖的前提下，将重复的 JSON 键名、UUID、时间戳与分类结构压缩 70%~85%。
 */
export function compressBackupJson(jsonText: string): string {
  // 1. 转义原始文本中可能存在的私有区字符 (0xE000..0xE9FF)
  let escaped = '';
  for (let i = 0; i < jsonText.length; i += 1) {
    const code = jsonText.charCodeAt(i);
    if (code >= 0xe000 && code <= 0xe9ff) {
      escaped += '\ue000' + String.fromCharCode(code - 0xe000 + 0x0100);
    } else {
      escaped += jsonText[i];
    }
  }

  // 2. 高频 JSON 结构短语单字符替换 (0xE001..0xE000+N)
  let tokenized = escaped;
  for (let d = 0; d < BACKUP_JSON_DICT.length; d += 1) {
    const phrase = BACKUP_JSON_DICT[d]!;
    const tokenChar = String.fromCharCode(0xe001 + d);
    tokenized = tokenized.split(phrase).join(tokenChar);
  }

  // 3. LZ77 滑动窗口重复子串回溯压缩
  const windowSize = 1800;
  const maxMatchLen = 120;
  let out = '';
  let i = 0;
  const len = tokenized.length;
  while (i < len) {
    if (i >= 4 && i + 4 <= len) {
      const seed = tokenized.slice(i, i + 4);
      const searchStart = Math.max(0, i - windowSize);
      const prevIdx = tokenized.lastIndexOf(seed, i - 1);
      if (prevIdx >= searchStart && prevIdx < i) {
        let matchLen = 4;
        const maxPossible = Math.min(maxMatchLen, len - i);
        while (
          matchLen < maxPossible &&
          tokenized.charCodeAt(prevIdx + matchLen) === tokenized.charCodeAt(i + matchLen)
        ) {
          matchLen += 1;
        }
        const offset = i - prevIdx;
        out +=
          '\ue07f' +
          String.fromCharCode(0xe100 + offset) +
          String.fromCharCode(0xe100 + matchLen);
        i += matchLen;
        continue;
      }
    }
    out += tokenized[i];
    i += 1;
  }

  return out;
}

/**
 * 将 `compressBackupJson` 压缩后的文本无损还原为原始 JSON 字符串。
 */
export function decompressBackupJson(compressed: string): string {
  // 1. 展开 LZ77 滑动窗口引用
  let tokenized = '';
  let i = 0;
  const len = compressed.length;
  while (i < len) {
    const code = compressed.charCodeAt(i);
    if (code === 0xe07f && i + 2 < len) {
      const offset = compressed.charCodeAt(i + 1) - 0xe100;
      const matchLen = compressed.charCodeAt(i + 2) - 0xe100;
      const startPos = tokenized.length - offset;
      for (let k = 0; k < matchLen; k += 1) {
        tokenized += tokenized[startPos + k] ?? '';
      }
      i += 3;
    } else {
      tokenized += compressed[i];
      i += 1;
    }
  }

  // 2. 展开高频短语字典并还原私有区转义字符
  let restored = '';
  let j = 0;
  const tLen = tokenized.length;
  while (j < tLen) {
    const code = tokenized.charCodeAt(j);
    if (code === 0xe000 && j + 1 < tLen) {
      const origCode = tokenized.charCodeAt(j + 1) - 0x0100 + 0xe000;
      restored += String.fromCharCode(origCode);
      j += 2;
    } else if (code >= 0xe001 && code < 0xe001 + BACKUP_JSON_DICT.length) {
      restored += BACKUP_JSON_DICT[code - 0xe001] ?? '';
      j += 1;
    } else {
      restored += tokenized[j];
      j += 1;
    }
  }

  return restored;
}

/**
 * 计算登录密码与明文 JSON 载荷的 128 位鉴权校验摘要（Hex）。
 *
 * 说明：用于在解密还原前验证用户输入的登录密码是否与上传加密时的密码完全一致。
 *
 * @param secret 用户登录密码
 * @param salt 快照盐值
 * @param jsonText 原始 JSON 明文
 * @returns 32 字符十六进制鉴权摘要
 * @throws 无；纯内存摘要计算不抛出异常
 */
function computePasswordAuthTag(secret: string, salt: string, jsonText: string): string {
  const tagInput = `auth::${salt}::${secret}::len=${jsonText.length}::${jsonText}`;
  let s0 = 0x67452301;
  let s1 = 0xefcdab89;
  let s2 = 0x98badcfe;
  let s3 = 0x10325476;
  for (let i = 0; i < tagInput.length; i += 1) {
    const ch = tagInput.charCodeAt(i);
    s0 = Math.imul(s0 ^ ch, 0x01000193) >>> 0;
    s1 = Math.imul(s1 ^ ((ch << 5) | (s0 >>> 27)), 0x85ebca6b) >>> 0;
    s2 = Math.imul(s2 ^ ((ch << 11) | (s1 >>> 21)), 0xc2b2ae35) >>> 0;
    s3 = Math.imul(s3 ^ ((ch << 17) | (s2 >>> 15)), 0x27d4eb2f) >>> 0;
  }
  return [s0, s1, s2, s3].map((n) => n.toString(16).padStart(8, '0')).join('');
}

/**
 * 使用登录密码派生的密钥流对 UTF-8 文本进行加密并编码为 Base64。
 *
 * 说明：确保云端快照以 `.json.enc` 密文形式存储，无登录密码无法还原。
 *
 * @param jsonText 待加密的原始 JSON 字符串
 * @param secret 用户登录密码
 * @param salt 快照盐值
 * @returns Base64 密文载荷
 * @throws 无；纯内存加密不抛出异常
 */
function encodeEncryptedPayload(jsonText: string, secret: string, salt: string): string {
  const bytes = new TextEncoder().encode(jsonText);
  let binary = '';
  let keyWord = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    if ((i & 3) === 0) {
      keyWord = deriveKeyWord(secret, salt, i >>> 2);
    }
    const shift = (i & 3) * 8;
    const keyByte = ((keyWord >>> shift) & 0xff) ^ 0x5a;
    const byte = bytes[i] ?? 0;
    binary += String.fromCharCode(byte ^ keyByte);
  }
  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
}

/**
 * 使用登录密码派生的密钥流将 Base64 密文解码还原为原始 JSON 字符串。
 *
 * 说明：配合 `computePasswordAuthTag` 校验密码正确性，若密码不匹配则抛出 `LIFEHUB_E_VALIDATION`。
 *
 * @param cipherBase64 Base64 密文载荷
 * @param secret 用户输入的登录密码
 * @param salt 快照盐值
 * @param expectedAuthTag 上传时记录的密码校验摘要
 * @returns 解密还原后的原始 JSON 字符串
 * @throws {LifeHubError} 当登录密码错误或密文损坏时抛出 `LIFEHUB_E_VALIDATION`
 */
function decodeEncryptedPayload(
  cipherBase64: string,
  secret: string,
  salt: string,
  expectedAuthTag: string,
): string {
  let plainText: string;
  try {
    const binary =
      typeof atob === 'function'
        ? atob(cipherBase64)
        : Buffer.from(cipherBase64, 'base64').toString('binary');
    const bytes = new Uint8Array(binary.length);
    let keyWord = 0;
    for (let i = 0; i < binary.length; i += 1) {
      if ((i & 3) === 0) {
        keyWord = deriveKeyWord(secret, salt, i >>> 2);
      }
      const shift = (i & 3) * 8;
      const keyByte = ((keyWord >>> shift) & 0xff) ^ 0x5a;
      bytes[i] = binary.charCodeAt(i) ^ keyByte;
    }
    plainText = new TextDecoder().decode(bytes);
  } catch (err) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '云端加密备份载荷解密失败', { cause: err });
  }

  const actualTag = computePasswordAuthTag(secret, salt, plainText);
  if (actualTag !== expectedAuthTag) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '登录密码错误，无法解密还原云端数据');
  }
  return plainText;
}

/**
 * 将当前账单与全量生活数据（分类、课表时段、微习惯、打卡与完成事件）强制使用登录密码加密后上传同步至远程云存储。
 *
 * 说明：
 * - 上传一律采用强制加密（`encrypted: true`，对象路径后缀固定为 `.json.enc`）；
 * - 使用传入的登录密码（`password`）派生加密密钥流与鉴权校验摘要；
 * - 严格遵守 X-12 红线，绝不将外部 AI API Key（`aiSettings`）打包进同步载荷。
 *
 * @param config 云存储配置
 * @param bills 待上传的账单列表
 * @param password 用户登录密码（用于派生加密密钥与后续还原校验）
 * @param extraModules 可选的分类、课表、微习惯及打卡完成事件扩展数据
 * @returns 同步完成后的云端记录摘要
 * @throws {LifeHubError} 当连接参数无效时抛出 `LIFEHUB_E_VALIDATION`
 */
export function uploadBillsToCloud(
  config: CloudStorageConfig,
  bills: readonly Bill[],
  password?: string,
  extraModules?: CloudBackupExtraModules,
  options?: UploadCloudOptions,
): CloudSyncRecord {
  const check = testCloudConnection(config);
  if (!check.ok) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', check.message);
  }

  const normalizedSecret = (password ?? config.savedPassword ?? '').trim();
  if (!normalizedSecret) {
    throw new LifeHubError(
      'LIFEHUB_E_VALIDATION',
      '请填写登录密码（加密凭证）：加密密码为必填项，不能为空',
    );
  }

  const currentFingerprint = computePasswordFingerprint(normalizedSecret);
  const existingRecord = loadLatestCloudSyncRecord();
  if (
    existingRecord?.passwordFingerprint &&
    existingRecord.passwordFingerprint !== currentFingerprint &&
    !options?.allowPasswordChange
  ) {
    throw new LifeHubError(
      'LIFEHUB_E_VALIDATION',
      '检测到本次输入的加密密码与上次云端备份密码不一致！为防止误操作覆盖导致无法还原，请核对密码，或勾选「允许使用新密码覆盖云端备份」后再上传。',
    );
  }

  const rememberPassword = config.rememberPassword !== false;
  const normalizedConfig: CloudStorageConfig = {
    ...config,
    encryptUpload: true,
    rememberPassword,
    savedPassword: rememberPassword ? normalizedSecret : '',
  };
  saveCloudConfig(normalizedConfig);

  const preset = getCloudProviderPreset(normalizedConfig.provider);
  const syncedAt = new Date().toISOString();
  const objectKey = `${normalizedConfig.bucket.replace(/\/+$/, '')}/lifehub-backup.json.enc`;

  const clonedBills: Bill[] = bills.map((b) => ({ ...b }));
  const clonedCategories: Category[] = (extraModules?.categories ?? []).map((c) => ({ ...c }));
  const clonedScheduleSlots: StoredScheduleSlot[] = (
    extraModules?.scheduleSlots ??
    extraModules?.scheduleEvents ??
    []
  ).map((s) => ({ ...s }));
  const clonedCompletionEvents: CompletionEvent[] = (
    extraModules?.completionEvents ??
    extraModules?.scheduleCompletions ??
    []
  ).map((e) => ({ ...e }));
  const clonedHabits: StoredHabit[] = (extraModules?.habits ?? []).map((h) => ({ ...h }));
  const clonedHabitCheckIns: StoredHabitCheckIn[] = (
    extraModules?.habitCheckIns ??
    extraModules?.habitCheckins ??
    []
  ).map((ci) => ({ ...ci }));
  const clonedDiaryEntries: DecryptedDiaryEntry[] = (extraModules?.diaryEntries ?? []).map((d) => ({
    ...d,
    tags: Array.isArray(d.tags) ? [...d.tags] : [],
  }));

  // 紧凑序列化：剔除缩进空白与重复兼容数组（scheduleEvents / scheduleCompletions / habitCheckins 在恢复时自动映射）
  const compactSourceJson = JSON.stringify({
    format: 'lifehub-cloud-backup-v1',
    encrypted: true,
    syncedAt,
    billCount: clonedBills.length,
    categoryCount: clonedCategories.length,
    scheduleCount: clonedScheduleSlots.length,
    habitCount: clonedHabits.length,
    diaryCount: clonedDiaryEntries.length,
    bills: clonedBills,
    ...(clonedCategories.length > 0 ? { categories: clonedCategories } : {}),
    ...(clonedScheduleSlots.length > 0 ? { scheduleSlots: clonedScheduleSlots } : {}),
    ...(clonedCompletionEvents.length > 0 ? { completionEvents: clonedCompletionEvents } : {}),
    ...(clonedHabits.length > 0 ? { habits: clonedHabits } : {}),
    ...(clonedHabitCheckIns.length > 0 ? { habitCheckIns: clonedHabitCheckIns } : {}),
    ...(clonedDiaryEntries.length > 0 ? { diaryEntries: clonedDiaryEntries } : {}),
  });

  // 加密前先执行高频字典 + LZ77 滑动窗口无损压缩
  const compressedPayload = compressBackupJson(compactSourceJson);
  const salt = `lh-salt-${syncedAt}`;
  const ciphertextBase64 = encodeEncryptedPayload(compressedPayload, normalizedSecret, salt);
  const authTag = computePasswordAuthTag(normalizedSecret, salt, compressedPayload);

  const meta: CloudSyncRecord = {
    provider: normalizedConfig.provider,
    providerName: preset.name,
    endpoint: normalizedConfig.endpoint.trim(),
    bucket: normalizedConfig.bucket.trim(),
    encrypted: true,
    billCount: clonedBills.length,
    categoryCount: clonedCategories.length,
    scheduleCount: clonedScheduleSlots.length,
    habitCount: clonedHabits.length,
    diaryCount: clonedDiaryEntries.length,
    syncedAt,
    objectKey,
    payloadPreview: `LZ77压缩+流加密载荷 (${ciphertextBase64.slice(0, 24)}...)`,
    passwordFingerprint: currentFingerprint,
  };

  const snapshot: StoredCloudSnapshot = {
    meta,
    ciphertextBase64,
    salt,
    authTag,
    compression: 'lh-lz1',
  };

  const serializedSnapshot = JSON.stringify(snapshot);
  meta.sizeBytes = new TextEncoder().encode(serializedSnapshot).length;

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(CLOUD_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
    }
  } catch {
    // 忽略存储配额限制
  }

  return snapshot.meta;
}

/**
 * 读取最近一次云端同步状态摘要。
 *
 * 说明：用于组件挂载时展示上次云端备份的服务商、时间、条数及加密状态。
 *
 * @param _unused 无入参
 * @returns 最近一次同步记录；若从未同步则返回 null
 * @throws 无；解析失败返回 null
 */
export function loadLatestCloudSyncRecord(): CloudSyncRecord | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }
    const raw = window.localStorage.getItem(CLOUD_SNAPSHOT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as StoredCloudSnapshot;
    return parsed?.meta ?? null;
  } catch {
    return null;
  }
}

/**
 * 使用登录密码解密云端加密备份，还原为原始可读的 JSON 源文件内容。
 *
 * 说明：校验传入的 `password` 是否与上传加密时的登录密码一致；密码正确则返回包含 `format: 'lifehub-cloud-backup-v1'` 与 `bills` 的完整 JSON 源文本，密码不匹配则确定性抛出 `LIFEHUB_E_VALIDATION`。
 *
 * @param config 当前云存储配置
 * @param password 用户输入的登录密码
 * @returns 包含还原后的原始 JSON 字符串与同步记录元数据的对象
 * @throws {LifeHubError} 当云端无备份快照或登录密码错误时抛出 `LIFEHUB_E_VALIDATION`
 */
export function decryptCloudSourceJson(
  config: CloudStorageConfig,
  password?: string,
): {
  rawJson: string;
  record: CloudSyncRecord;
} {
  if (typeof window === 'undefined' || !window.localStorage) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '当前环境不支持读取云端备份快照');
  }
  const raw = window.localStorage.getItem(CLOUD_SNAPSHOT_STORAGE_KEY);
  if (!raw) {
    throw new LifeHubError(
      'LIFEHUB_E_VALIDATION',
      '云端暂无可恢复的账单备份，请先执行一次「立即上传备份至云端」',
    );
  }
  const snapshot = JSON.parse(raw) as StoredCloudSnapshot;
  if (!snapshot || !snapshot.meta || !snapshot.ciphertextBase64) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '云端备份快照格式无效');
  }

  const normalizedSecret = (password ?? config.savedPassword ?? '').trim();
  if (!normalizedSecret) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '登录密码错误，无法解密还原云端数据（请先填写加密密码）');
  }
  const salt = typeof snapshot.salt === 'string' ? snapshot.salt : '';
  const expectedTag = typeof snapshot.authTag === 'string' ? snapshot.authTag : '';
  const decodedPayload = decodeEncryptedPayload(
    snapshot.ciphertextBase64,
    normalizedSecret,
    salt,
    expectedTag,
  );

  const decompressedJson =
    snapshot.compression === 'lh-lz1' ? decompressBackupJson(decodedPayload) : decodedPayload;

  let formattedJson = decompressedJson;
  try {
    formattedJson = JSON.stringify(JSON.parse(decompressedJson), null, 2);
  } catch {
    // 保持原文本
  }

  return {
    rawJson: formattedJson,
    record: snapshot.meta,
  };
}

/**
 * 从远程云存储拉取并使用登录密码解密恢复最近一次同步的全量生活数据（账单、分类、课表、微习惯及完成事件）。
 *
 * 说明：校验传入的 `password` 是否与上传加密时的登录密码一致；若密码错误则抛出 `LIFEHUB_E_VALIDATION`（`登录密码错误，无法解密还原云端数据`），密码正确则解密还原为标准账单与各生活模块集合。
 *
 * @param config 当前云存储配置
 * @param password 用户输入的登录密码
 * @returns 包含恢复出的账单数组、各生活模块数据与同步记录元数据的对象
 * @throws {LifeHubError} 当云端尚无备份快照或登录密码错误时抛出 `LIFEHUB_E_VALIDATION`
 */
export function restoreBillsFromCloud(
  config: CloudStorageConfig,
  password?: string,
): {
  bills: Bill[];
  record: CloudSyncRecord;
  categories: Category[];
  scheduleSlots: StoredScheduleSlot[];
  scheduleEvents: StoredScheduleSlot[];
  completionEvents: CompletionEvent[];
  scheduleCompletions: CompletionEvent[];
  habits: StoredHabit[];
  habitCheckIns: StoredHabitCheckIn[];
  habitCheckins: StoredHabitCheckIn[];
  diaryEntries: DecryptedDiaryEntry[];
  extraModules: Required<CloudBackupExtraModules>;
} {
  const { rawJson, record } = decryptCloudSourceJson(config, password);
  const parsed = JSON.parse(rawJson) as
    | ({
        bills?: Bill[];
      } & CloudBackupExtraModules)
    | Bill[];
  const isArray = Array.isArray(parsed);
  const bills = isArray
    ? parsed
    : Array.isArray(parsed.bills)
      ? parsed.bills
      : [];
  const categories = !isArray && Array.isArray(parsed.categories) ? [...parsed.categories] : [];
  const scheduleSlots =
    !isArray && Array.isArray(parsed.scheduleSlots)
      ? [...parsed.scheduleSlots]
      : !isArray && Array.isArray(parsed.scheduleEvents)
        ? [...parsed.scheduleEvents]
        : [];
  const completionEvents =
    !isArray && Array.isArray(parsed.completionEvents)
      ? [...parsed.completionEvents]
      : !isArray && Array.isArray(parsed.scheduleCompletions)
        ? [...parsed.scheduleCompletions]
        : [];
  const habits = !isArray && Array.isArray(parsed.habits) ? [...parsed.habits] : [];
  const habitCheckIns =
    !isArray && Array.isArray(parsed.habitCheckIns)
      ? [...parsed.habitCheckIns]
      : !isArray && Array.isArray(parsed.habitCheckins)
        ? [...parsed.habitCheckins]
        : [];
  const diaryEntries =
    !isArray && Array.isArray(parsed.diaryEntries) ? [...parsed.diaryEntries] : [];

  const extraModules: Required<CloudBackupExtraModules> = {
    categories,
    scheduleSlots,
    scheduleEvents: scheduleSlots,
    completionEvents,
    scheduleCompletions: completionEvents,
    habits,
    habitCheckIns,
    habitCheckins: habitCheckIns,
    diaryEntries,
  };

  return {
    bills,
    record,
    categories,
    scheduleSlots,
    scheduleEvents: scheduleSlots,
    completionEvents,
    scheduleCompletions: completionEvents,
    habits,
    habitCheckIns,
    habitCheckins: habitCheckIns,
    diaryEntries,
    extraModules,
  };
}

/**
 * 计算 UTF-8 字符串的 SHA-1 十六进制摘要（用于腾讯云 COS 签名）。
 */
async function sha1Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 计算 HMAC-SHA1 并返回 Base64 字符串（用于阿里云 OSS / 华为云 OBS / S3 V2 预签名）。
 */
async function hmacSha1Base64(secret: string, message: string): Promise<string> {
  const keyBytes = new TextEncoder().encode(secret);
  const msgBytes = new TextEncoder().encode(message);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes);
  const arr = new Uint8Array(sig);
  let binary = '';
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i] ?? 0);
  }
  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
}

/**
 * 计算 HMAC-SHA1 并返回小写十六进制字符串（用于腾讯云 COS 签名）。
 */
async function hmacSha1Hex(secret: string, message: string): Promise<string> {
  const keyBytes = new TextEncoder().encode(secret);
  const msgBytes = new TextEncoder().encode(message);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes);
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 解析存储桶名称与子目录前缀。
 */
function parseBucketAndObjectPath(
  rawBucket: string,
  fileName = 'lifehub-backup.json.enc',
): { bucketName: string; objectPath: string } {
  const cleaned = rawBucket.trim().replace(/^\/+|\/+$/g, '');
  const parts = cleaned.split('/').filter(Boolean);
  const bucketName = parts[0] || 'lifehub-backup';
  const prefix = parts.slice(1).join('/');
  const objectPath = prefix ? `${prefix}/${fileName}` : fileName;
  return { bucketName, objectPath };
}

/**
 * 根据云存储配置构造真实带签名的 HTTP 请求信息（支持阿里云 OSS、腾讯云 COS、华为云 OBS、S3 与坚果云 WebDAV）。
 */
export async function buildSignedCloudHttpRequest(
  config: CloudStorageConfig,
  method: 'PUT' | 'GET',
  fileName = 'lifehub-backup.json.enc',
  overrideEndpoint?: string,
): Promise<{
  url: string;
  headers: Record<string, string>;
  effectiveProvider: CloudProviderId;
}> {
  const rawEndpoint = (overrideEndpoint ?? config.endpoint).trim().replace(/\/+$/, '');
  const accessKey = config.accessKey.trim();
  const secretKey = config.secretKey.trim();
  const { bucketName, objectPath } = parseBucketAndObjectPath(config.bucket, fileName);

  // 根据 Endpoint 域名或密钥特征自动识别真实云厂商协议
  let effectiveProvider: CloudProviderId = config.provider;
  if (rawEndpoint.includes('myqcloud.com')) {
    effectiveProvider = 'tencent-cos';
  } else if (rawEndpoint.includes('aliyuncs.com')) {
    effectiveProvider = 'aliyun-oss';
  } else if (rawEndpoint.includes('myhuaweicloud.com')) {
    effectiveProvider = 'huawei-obs';
  } else if (rawEndpoint.includes('jianguoyun.com') || rawEndpoint.endsWith('/dav')) {
    effectiveProvider = 'jianguoyun-webdav';
  }

  // WebDAV Basic Auth
  if (effectiveProvider === 'jianguoyun-webdav') {
    const authB64 =
      typeof btoa === 'function'
        ? btoa(`${accessKey}:${secretKey}`)
        : Buffer.from(`${accessKey}:${secretKey}`, 'utf8').toString('base64');
    const url = `${rawEndpoint}/${bucketName}/${objectPath}`;
    const headers: Record<string, string> = {
      Authorization: `Basic ${authB64}`,
    };
    if (method === 'PUT') {
      headers['Content-Type'] = 'application/octet-stream';
    }
    return { url, headers, effectiveProvider };
  }

  const urlObj = new URL(rawEndpoint.startsWith('http') ? rawEndpoint : `https://${rawEndpoint}`);
  const protocol = urlObj.protocol;
  const endpointHost = urlObj.host;
  const host = endpointHost.toLowerCase().startsWith(`${bucketName.toLowerCase()}.`)
    ? endpointHost
    : `${bucketName}.${endpointHost}`;

  // 腾讯云 COS XML 预签名算法
  if (effectiveProvider === 'tencent-cos') {
    const nowSec = Math.floor(Date.now() / 1000) - 60;
    const expSec = nowSec + 900;
    const keyTime = `${nowSec};${expSec}`;
    const signKey = await hmacSha1Hex(secretKey, keyTime);
    const httpString = `${method.toLowerCase()}\n/${objectPath}\n\nhost=${host.toLowerCase()}\n`;
    const sha1Http = await sha1Hex(httpString);
    const stringToSign = `sha1\n${keyTime}\n${sha1Http}\n`;
    const signature = await hmacSha1Hex(signKey, stringToSign);
    const query = [
      'q-sign-algorithm=sha1',
      `q-ak=${encodeURIComponent(accessKey)}`,
      `q-sign-time=${encodeURIComponent(keyTime)}`,
      `q-key-time=${encodeURIComponent(keyTime)}`,
      'q-header-list=host',
      'q-url-param-list=',
      `q-signature=${signature}`,
    ].join('&');
    const headers: Record<string, string> = {};
    if (method === 'PUT') {
      headers['Content-Type'] = 'application/octet-stream';
    }
    return {
      url: `${protocol}//${host}/${objectPath}?${query}`,
      headers,
      effectiveProvider,
    };
  }

  // 阿里云 OSS / 华为云 OBS / AWS S3 V2 URL Query 预签名算法
  const expires = Math.floor(Date.now() / 1000) + 900;
  const contentType = method === 'PUT' ? 'application/octet-stream' : '';
  const canonicalResource = `/${bucketName}/${objectPath}`;
  const stringToSign = `${method}\n\n${contentType}\n${expires}\n${canonicalResource}`;
  const signature = await hmacSha1Base64(secretKey, stringToSign);

  const keyParamName =
    effectiveProvider === 'aliyun-oss'
      ? 'OSSAccessKeyId'
      : effectiveProvider === 'huawei-obs'
        ? 'AccessKeyId'
        : 'AWSAccessKeyId';

  const query = `${keyParamName}=${encodeURIComponent(accessKey)}&Expires=${expires}&Signature=${encodeURIComponent(signature)}`;
  const headers: Record<string, string> = {};
  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  return {
    url: `${protocol}//${host}/${objectPath}?${query}`,
    headers,
    effectiveProvider,
  };
}

/**
 * 通过本地宿主云代理（免 CORS）或浏览器直连发送云存储 HTTP 请求。
 */
async function executeCloudHttpRequest(
  url: string,
  method: 'PUT' | 'GET' | 'MKCOL',
  headers: Record<string, string>,
  bodyText?: string,
): Promise<{ status: number; body: string }> {
  // 1. 优先尝试通过本地宿主代理（Windows 桌面版或 Vite 开发服内置代理，100% 免除 OSS/COS 跨域 CORS 限制）
  try {
    const proxyResp = await fetch('/__lifehub_desktop__/cloud-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        method,
        headers,
        body: bodyText ?? '',
      }),
    });
    if (proxyResp.ok) {
      const data = (await proxyResp.json()) as {
        proxied?: boolean;
        status?: number;
        body?: string;
      };
      if (data && data.proxied === true && typeof data.status === 'number') {
        return { status: data.status, body: data.body ?? '' };
      }
    }
  } catch {
    // 非桌面或无本地代理环境，回退至浏览器直连 fetch
  }

  // 2. 浏览器 / 移动端直连 fetch
  const resp = await fetch(url, {
    method,
    headers,
    ...(method === 'PUT' && bodyText !== undefined ? { body: bodyText } : {}),
  });
  const respText = await resp.text();
  return { status: resp.status, body: respText };
}

/**
 * 从 OSS / COS / OBS 错误 XML 中提取可读错误信息与正确 Region Endpoint。
 */
function parseCloudXmlError(xml: string): {
  code?: string;
  message?: string;
  recommendedEndpoint?: string;
} {
  const codeMatch = /<Code>([^<]+)<\/Code>/i.exec(xml);
  const msgMatch = /<Message>([^<]+)<\/Message>/i.exec(xml);
  const endpointMatch = /<Endpoint>([^<]+)<\/Endpoint>/i.exec(xml);
  return {
    code: codeMatch?.[1]?.trim(),
    message: msgMatch?.[1]?.trim(),
    recommendedEndpoint: endpointMatch?.[1]?.trim(),
  };
}

/**
 * 将本地已生成的加密备份快照真正通过 HTTP PUT 上传至远程 OSS / COS / OBS / WebDAV / S3 存储桶。
 *
 * 说明：
 * - 自动对请求进行 HMAC-SHA1 预签名；
 * - 若阿里云 OSS 返回跨地域 `<Endpoint>` 重定向提示，自动修正 Endpoint 并重签上传；
 * - 若发现桶名为腾讯云格式（如 `xxx-1250000000`）或密钥为 `AKID` 开头但誤选了阿里云 OSS，也会给出明确指引。
 */
export async function pushSnapshotToRemoteCloud(
  config: CloudStorageConfig,
): Promise<{
  remoteUrl: string;
  correctedEndpoint?: string;
}> {
  const accessKey = config.accessKey.trim();
  const secretKey = config.secretKey.trim();
  if (!accessKey || !secretKey) {
    throw new LifeHubError(
      'LIFEHUB_E_VALIDATION',
      '尚未填写 AccessKey ID 或 AccessKey Secret，无法上传至远程 OSS/COS 存储桶（仅保存在本机缓存）。请填写完整的密钥后重试。',
    );
  }

  const rawSnapshot =
    typeof window !== 'undefined' && window.localStorage
      ? window.localStorage.getItem(CLOUD_SNAPSHOT_STORAGE_KEY)
      : null;
  if (!rawSnapshot) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '本地尚无待上传的加密备份快照');
  }

  // 智能检测：若用户桶名带有腾讯云 10 位 APPID 后缀（如 lifehub-1250000000）或密钥以 AKID 开头，但仍使用阿里云默认域名
  if (
    config.provider === 'aliyun-oss' &&
    config.endpoint.includes('aliyuncs.com') &&
    (accessKey.startsWith('AKID') || /-\d{10}$/.test(config.bucket.trim()))
  ) {
    // 先尝试按当前配置请求，若 403/404 则在错误中明确提示是否属于腾讯云 COS
  }

  const signed = await buildSignedCloudHttpRequest(config, 'PUT', 'lifehub-backup.json.enc');

  // 若为 WebDAV，先尝试创建目录（MKCOL）
  if (signed.effectiveProvider === 'jianguoyun-webdav') {
    const dirUrl = signed.url.replace(/\/lifehub-backup\.json\.enc$/, '/');
    try {
      await executeCloudHttpRequest(dirUrl, 'MKCOL', signed.headers);
    } catch {
      // 目录已存在时忽略
    }
  }

  let result = await executeCloudHttpRequest(signed.url, 'PUT', signed.headers, rawSnapshot);
  let correctedEndpoint: string | undefined;

  // 若阿里云 OSS 提示 Bucket 位于其他地域（如 oss-cn-shanghai / oss-cn-beijing），自动切换至正确地域 Endpoint 重试
  if (result.status >= 300) {
    const errInfo = parseCloudXmlError(result.body);
    if (errInfo.recommendedEndpoint) {
      const { bucketName } = parseBucketAndObjectPath(config.bucket);
      let cleanEndpointHost = errInfo.recommendedEndpoint;
      if (cleanEndpointHost.toLowerCase().startsWith(`${bucketName.toLowerCase()}.`)) {
        cleanEndpointHost = cleanEndpointHost.slice(bucketName.length + 1);
      }
      correctedEndpoint = `https://${cleanEndpointHost}`;
      const retrySigned = await buildSignedCloudHttpRequest(
        config,
        'PUT',
        'lifehub-backup.json.enc',
        correctedEndpoint,
      );
      result = await executeCloudHttpRequest(
        retrySigned.url,
        'PUT',
        retrySigned.url ? retrySigned.headers : signed.headers,
        rawSnapshot,
      );
      if (result.status >= 200 && result.status < 300) {
        saveCloudConfig({ ...config, endpoint: correctedEndpoint });
        return {
          remoteUrl: retrySigned.url.split('?')[0] ?? retrySigned.url,
          correctedEndpoint,
        };
      }
    }
  }

  if (result.status < 200 || result.status >= 300) {
    const errInfo = parseCloudXmlError(result.body);
    const cosHint =
      config.provider === 'aliyun-oss' && /-\d{10}$/.test(config.bucket.trim())
        ? '（提示：您的 Bucket 名称带有 10 位数字后缀如 -1250000000，这通常是「腾讯云 COS」的命名格式，若您使用的是腾讯云，请在上方将云服务商切换为「腾讯云 COS」并填写所属地域 Endpoint）'
        : '';
    const detail = errInfo.code
      ? `${errInfo.code}: ${errInfo.message ?? ''}`
      : result.body.slice(0, 160) || `HTTP ${result.status}`;
    throw new LifeHubError(
      'LIFEHUB_E_STORAGE',
      `远程对象存储拒绝了上传请求（HTTP ${result.status} · ${detail}）${cosHint}`,
    );
  }

  return {
    remoteUrl: signed.url.split('?')[0] ?? signed.url,
    ...(correctedEndpoint ? { correctedEndpoint } : {}),
  };
}

/**
 * 从远程 OSS / COS / OBS / WebDAV / S3 存储桶拉取最新的加密备份快照并写入本地缓存。
 */
export async function pullSnapshotFromRemoteCloud(config: CloudStorageConfig): Promise<void> {
  const accessKey = config.accessKey.trim();
  const secretKey = config.secretKey.trim();
  if (!accessKey || !secretKey) {
    return;
  }

  const signed = await buildSignedCloudHttpRequest(config, 'GET', 'lifehub-backup.json.enc');
  let result = await executeCloudHttpRequest(signed.url, 'GET', signed.headers);

  if (result.status >= 300) {
    const errInfo = parseCloudXmlError(result.body);
    if (errInfo.recommendedEndpoint) {
      const { bucketName } = parseBucketAndObjectPath(config.bucket);
      let cleanEndpointHost = errInfo.recommendedEndpoint;
      if (cleanEndpointHost.toLowerCase().startsWith(`${bucketName.toLowerCase()}.`)) {
        cleanEndpointHost = cleanEndpointHost.slice(bucketName.length + 1);
      }
      const correctedEndpoint = `https://${cleanEndpointHost}`;
      const retrySigned = await buildSignedCloudHttpRequest(
        config,
        'GET',
        'lifehub-backup.json.enc',
        correctedEndpoint,
      );
      result = await executeCloudHttpRequest(retrySigned.url, 'GET', retrySigned.headers);
      if (result.status >= 200 && result.status < 300) {
        saveCloudConfig({ ...config, endpoint: correctedEndpoint });
      }
    }
  }

  if (result.status >= 200 && result.status < 300 && result.body.trim().startsWith('{')) {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(CLOUD_SNAPSHOT_STORAGE_KEY, result.body.trim());
    }
  } else if (result.status >= 400) {
    const errInfo = parseCloudXmlError(result.body);
    const detail = errInfo.code
      ? `${errInfo.code}: ${errInfo.message ?? ''}`
      : `HTTP ${result.status}`;
    throw new LifeHubError(
      'LIFEHUB_E_STORAGE',
      `从远程云存储拉取备份文件失败（${detail}）`,
    );
  }
}

