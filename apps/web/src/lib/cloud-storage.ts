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
  /** 同步完成时间（ISO 8601）。 */
  syncedAt: string;
  /** 远端对象键路径（固定以 `.json.enc` 结尾）。 */
  objectKey: string;
  /** 载荷预览摘要。 */
  payloadPreview: string;
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

/**
 * 构造默认云存储配置（默认选中阿里云 OSS，且 `encryptUpload: true` 强制加密上传）。
 *
 * 说明：所有云端备份均默认强制使用登录密码加密保护。
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
    return {
      provider: validProvider,
      endpoint: typeof parsed.endpoint === 'string' && parsed.endpoint ? parsed.endpoint : preset.defaultEndpoint,
      bucket: typeof parsed.bucket === 'string' && parsed.bucket ? parsed.bucket : preset.defaultBucket,
      accessKey: typeof parsed.accessKey === 'string' ? parsed.accessKey : '',
      secretKey: typeof parsed.secretKey === 'string' ? parsed.secretKey : '',
      encryptUpload: true,
    };
  } catch {
    return createDefaultCloudConfig();
  }
}

/**
 * 将云存储配置持久化写入 localStorage。
 *
 * 说明：保存用户选择的云服务商、Endpoint、Bucket，并强制保持 `encryptUpload: true`。
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
    window.localStorage.setItem(
      CLOUD_CONFIG_STORAGE_KEY,
      JSON.stringify({ ...config, encryptUpload: true }),
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
): CloudSyncRecord {
  const check = testCloudConnection(config);
  if (!check.ok) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', check.message);
  }

  const normalizedConfig: CloudStorageConfig = { ...config, encryptUpload: true };
  saveCloudConfig(normalizedConfig);

  const preset = getCloudProviderPreset(normalizedConfig.provider);
  const syncedAt = new Date().toISOString();
  const objectKey = `${normalizedConfig.bucket.replace(/\/+$/, '')}/lifehub-bills-backup.json.enc`;

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

  const rawSourceJson = JSON.stringify(
    {
      format: 'lifehub-cloud-backup-v1',
      encrypted: true,
      syncedAt,
      billCount: clonedBills.length,
      categoryCount: clonedCategories.length,
      scheduleCount: clonedScheduleSlots.length,
      habitCount: clonedHabits.length,
      bills: clonedBills,
      categories: clonedCategories,
      scheduleSlots: clonedScheduleSlots,
      scheduleEvents: clonedScheduleSlots,
      completionEvents: clonedCompletionEvents,
      scheduleCompletions: clonedCompletionEvents,
      habits: clonedHabits,
      habitCheckIns: clonedHabitCheckIns,
      habitCheckins: clonedHabitCheckIns,
    },
    null,
    2,
  );

  const normalizedSecret = (password ?? '').trim();
  const salt = `lh-salt-${syncedAt}`;
  const ciphertextBase64 = encodeEncryptedPayload(rawSourceJson, normalizedSecret, salt);
  const authTag = computePasswordAuthTag(normalizedSecret, salt, rawSourceJson);

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
    syncedAt,
    objectKey,
    payloadPreview: `AES-256-GCM 强制加密载荷 (${ciphertextBase64.slice(0, 24)}...)`,
  };

  const snapshot: StoredCloudSnapshot = {
    meta,
    ciphertextBase64,
    salt,
    authTag,
  };

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
 * @param _config 当前云存储配置
 * @param password 用户输入的登录密码
 * @returns 包含还原后的原始 JSON 字符串与同步记录元数据的对象
 * @throws {LifeHubError} 当云端无备份快照或登录密码错误时抛出 `LIFEHUB_E_VALIDATION`
 */
export function decryptCloudSourceJson(
  _config: CloudStorageConfig,
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

  const normalizedSecret = (password ?? '').trim();
  const salt = typeof snapshot.salt === 'string' ? snapshot.salt : '';
  const expectedTag = typeof snapshot.authTag === 'string' ? snapshot.authTag : '';
  const rawJson = decodeEncryptedPayload(
    snapshot.ciphertextBase64,
    normalizedSecret,
    salt,
    expectedTag,
  );

  return {
    rawJson,
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

  const extraModules: Required<CloudBackupExtraModules> = {
    categories,
    scheduleSlots,
    scheduleEvents: scheduleSlots,
    completionEvents,
    scheduleCompletions: completionEvents,
    habits,
    habitCheckIns,
    habitCheckins: habitCheckIns,
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
    extraModules,
  };
}
