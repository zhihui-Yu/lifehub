/**
 * 远程云存储连接与多端数据加密同步工具模块。
 *
 * 架构位置：apps/web 的「应用基础设施（lib）」层。
 *
 * 说明：
 * 1. 支持连接主流云存储服务（阿里云 OSS、腾讯云 COS、华为云 OBS、坚果云 WebDAV、Amazon S3），
 *    连接地址支持直接填写包含存储桶名称的完整访问域名（如 `https://example-bucket-1250000000.cos.ap-guangzhou.myqcloud.com`），无需单独拆分填写 Bucket；
 * 2. 支持 Android 原生 HTTP 桥接与桌面端宿主代理，免除 WebView / 浏览器 CORS 跨域限制；
 * 3. 上传时强制使用登录密码压缩加密封装（`.json.enc`），并在上传前强制执行「先拉取远端 → 按 ID + 更新时间与删除墓碑合并 → 再上传」，保证单人多端数据一致不丢失。
 */
import { LifeHubError, type Bill, type Category } from '@lifehub/core';
import type { StoredScheduleSlot } from '@/modules/schedule/rrule';
import {
  mergeHabitCheckInPair,
  type StoredHabit,
  type StoredHabitCheckIn,
} from '@/modules/habits/habit-service';
import type { DecryptedDiaryEntry } from '@/modules/diary/diary-service';
import type { CompletionEvent } from '@/modules/shared/completion-event';
import {
  clearCloudBillsDirtyState,
  loadCloudBillsDirtyState,
  loadLocalCloudTombstones,
  markCloudBillsDirty,
  normalizeCloudTombstones,
  recordCloudTombstone,
  recordCloudTombstones,
  saveLocalCloudTombstones,
  type CloudBillsDirtyState,
  type DeletedEntityTombstone,
  type SyncableEntityType,
} from './cloud-tombstones';

export {
  clearCloudBillsDirtyState,
  loadCloudBillsDirtyState,
  loadLocalCloudTombstones,
  markCloudBillsDirty,
  normalizeCloudTombstones,
  recordCloudTombstone,
  recordCloudTombstones,
  saveLocalCloudTombstones,
  type CloudBillsDirtyState,
  type DeletedEntityTombstone,
  type SyncableEntityType,
};

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
  /** 默认连接地址示例（已包含 Bucket 或目录路径）。 */
  defaultEndpoint: string;
  /** 兼容保留的默认 Bucket 字段（统一为空串，由连接地址直接承载）。 */
  defaultBucket: string;
  /** 简要配置提示。 */
  description: string;
}

/** 远程云存储配置项。 */
export interface CloudStorageConfig {
  /** 云存储服务商标识。 */
  provider: CloudProviderId;
  /** 服务端点连接地址（直接包含存储桶域名或 WebDAV 目录路径）。 */
  endpoint: string;
  /** 历史兼容保留字段（当 endpoint 已含存储桶时可为空串）。 */
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
  /** 解析出的目标 Bucket / 目录名称。 */
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
  /** 单调递增的云端同步修订号（每次合并上传 +1）。 */
  revision?: number;
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
  /** 多端删除墓碑列表（防止已删除条目在另一端合并时复活）。 */
  tombstones?: readonly DeletedEntityTombstone[];
}

/** 参与多端合并的完整生活数据集。 */
export interface CloudFullDataset {
  bills: Bill[];
  categories: Category[];
  scheduleSlots: StoredScheduleSlot[];
  completionEvents: CompletionEvent[];
  habits: StoredHabit[];
  habitCheckIns: StoredHabitCheckIn[];
  diaryEntries: DecryptedDiaryEntry[];
  tombstones: DeletedEntityTombstone[];
}

/** 合并过程中被删除墓碑淘汰、需从本地库同步清理的主键集合。 */
export interface PurgedEntityIds {
  billIds: string[];
  categoryIds: string[];
  scheduleSlotIds: string[];
  completionEventIds: string[];
  habitIds: string[];
  habitCheckInIds: string[];
  diaryEntryIds: string[];
}

/** 多端数据集增量合并结果。 */
export interface MergedCloudSyncResult {
  merged: CloudFullDataset;
  purged: PurgedEntityIds;
  mergedFromRemote: boolean;
  remoteRevision: number;
  nextRevision: number;
}

/** 解析连接地址得到的云存储目标定位信息。 */
export interface ResolvedCloudTarget {
  ok: boolean;
  errorMessage?: string;
  effectiveProvider: CloudProviderId;
  protocol: string;
  objectUrl: string;
  webdavDirUrl?: string;
  host: string;
  bucketName: string;
  objectPath: string;
  objectKey: string;
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

/** Android WebView 原生云存储 HTTP 桥接接口。 */
interface AndroidCloudBridge {
  startCloudHttpRequest?: (
    requestId: string,
    targetUrl: string,
    method: string,
    headersJson: string,
    bodyText: string,
  ) => void;
  takeCloudHttpResponse?: (requestId: string) => string;
}

/** 云存储上传附加选项。 */
export interface UploadCloudOptions {
  /** 当检测到本次输入的密码与上次备份密码不一致时，是否允许使用新密码覆盖。 */
  allowPasswordChange?: boolean;
  /** 指定本次快照的修订版本号。 */
  revision?: number;
}

/** 云存储配置在 localStorage 中的持久化键名。 */
export const CLOUD_CONFIG_STORAGE_KEY = 'lifehub.cloudStorage.config';

/** 云端同步快照在 localStorage 中的持久化键名。 */
export const CLOUD_SNAPSHOT_STORAGE_KEY = 'lifehub.cloudStorage.latestSnapshot';

/** 当超大备份超出浏览器 5MB localStorage 配额时的内存级兜底缓存（防止静默回退读取旧快照）。 */
let memoryOverflowSnapshotRaw: string | null = null;

/**
 * 写入最新云快照缓存（优先持久化至 localStorage；超配额时清理旧缓存并转存内存兜底，绝不残留过期旧快照）。
 */
function writeSnapshotCache(serialized: string): void {
  memoryOverflowSnapshotRaw = serialized;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(CLOUD_SNAPSHOT_STORAGE_KEY, serialized);
      memoryOverflowSnapshotRaw = null;
    }
  } catch {
    try {
      window.localStorage?.removeItem(CLOUD_SNAPSHOT_STORAGE_KEY);
    } catch {
      // 忽略清理异常
    }
  }
}

/**
 * 读取最新云快照缓存文本。
 */
function readSnapshotCache(): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const fromStorage = window.localStorage.getItem(CLOUD_SNAPSHOT_STORAGE_KEY);
      if (fromStorage) {
        return fromStorage;
      }
      if (window.localStorage.length === 0) {
        memoryOverflowSnapshotRaw = null;
        return null;
      }
    }
  } catch {
    // 忽略读取异常
  }
  return memoryOverflowSnapshotRaw;
}

/**
 * 将任意 UTF-8 字符串安全编码为标准 Base64（避免直接调用 btoa 在含非 ASCII 字符时抛 InvalidCharacterError）。
 */
function encodeUtf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(binary, 'binary').toString('base64');
}

/** 默认阿里云 OSS 预设配置（直接包含存储桶访问域名）。 */
const DEFAULT_PROVIDER_PRESET: CloudProviderPreset = {
  id: 'aliyun-oss',
  name: '阿里云 OSS (对象存储)',
  protocol: 'S3 / OSS 协议',
  defaultEndpoint: 'https://lifehub-bills-oss.oss-cn-hangzhou.aliyuncs.com',
  defaultBucket: '',
  description: '直接粘贴含 Bucket 的 OSS 访问域名即可读写加密备份。',
};

/** 内置主流云存储服务商列表（5 大热门云存储）。 */
export const CLOUD_PROVIDERS: readonly CloudProviderPreset[] = [
  DEFAULT_PROVIDER_PRESET,
  {
    id: 'tencent-cos',
    name: '腾讯云 COS (对象存储)',
    protocol: 'S3 / COS 协议',
    defaultEndpoint: 'https://lifehub-1250000000.cos.ap-guangzhou.myqcloud.com',
    defaultBucket: '',
    description: '直接粘贴腾讯云控制台含 Bucket-APPID 的访问域名，桌面与手机端均原生支持。',
  },
  {
    id: 'huawei-obs',
    name: '华为云 OBS (对象存储)',
    protocol: 'S3 / OBS 协议',
    defaultEndpoint: 'https://lifehub-bills-obs.obs.cn-north-4.myhuaweicloud.com',
    defaultBucket: '',
    description: '华为云企业级对象存储服务，直接填写含桶名的访问域名即可。',
  },
  {
    id: 'jianguoyun-webdav',
    name: '坚果云 WebDAV',
    protocol: 'WebDAV 协议',
    defaultEndpoint: 'https://dav.jianguoyun.com/dav/LifeHubBackup/',
    defaultBucket: '',
    description: '国内个人记账最常用的 WebDAV 云盘，地址末尾包含同步目录名即可。',
  },
  {
    id: 'aws-s3',
    name: 'Amazon S3 / 兼容 S3 存储',
    protocol: '标准 S3 协议',
    defaultEndpoint: 'https://lifehub-s3-backup.s3.amazonaws.com',
    defaultBucket: '',
    description: '支持 AWS S3、Cloudflare R2、MinIO 等兼容 S3 协议的对象存储。',
  },
] as const;

/**
 * 根据服务商 ID 获取对应的预设配置项。
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
 * 解析旧版独立 `bucket` 字段中的桶名与可选子路径。
 */
function parseLegacyBucketAndPrefix(rawBucket: string): { bucketName: string; prefix: string } {
  const cleaned = rawBucket.trim().replace(/^\/+|\/+$/g, '');
  const parts = cleaned.split('/').filter(Boolean);
  const bucketName = parts[0] ?? '';
  const prefix = parts.slice(1).join('/');
  return { bucketName, prefix };
}

/**
 * 判断对象存储域名是否为已包含存储桶前缀的 Virtual-Hosted 域名，若是则提取 `{ bucketName, regionHost }`。
 */
function matchVirtualHostedBucket(
  endpointHost: string,
): { bucketName: string; regionHost: string } | null {
  const patterns: readonly RegExp[] = [
    /^([^.]+)\.(cos\.[a-z0-9.-]+\.myqcloud\.com(?::\d+)?)$/i,
    /^([^.]+)\.(oss-[a-z0-9.-]+\.aliyuncs\.com(?::\d+)?)$/i,
    /^([^.]+)\.(obs\.[a-z0-9.-]+\.myhuaweicloud\.com(?::\d+)?)$/i,
    /^([^.]+)\.(s3(?:[.-][a-z0-9-]+)*\.amazonaws\.com(?:\.cn)?(?::\d+)?)$/i,
    /^([^.]+)\.([a-z0-9-]+\.r2\.cloudflarestorage\.com(?::\d+)?)$/i,
  ];
  for (const re of patterns) {
    const m = re.exec(endpointHost);
    if (m && m[1] && m[2]) {
      return { bucketName: m[1], regionHost: m[2] };
    }
  }
  return null;
}

/**
 * 将旧版拆分的 `endpoint + bucket` 平滑合并为单一包含 Bucket 的完整连接地址。
 */
function mergeLegacyBucketIntoEndpoint(
  provider: CloudProviderId,
  rawEndpoint: string,
  rawBucket: string,
): string {
  const endpoint = rawEndpoint.trim();
  const { bucketName, prefix } = parseLegacyBucketAndPrefix(rawBucket);
  if (!endpoint || !bucketName) {
    return endpoint;
  }
  try {
    const urlObj = new URL(endpoint);
    if (
      provider === 'jianguoyun-webdav' ||
      endpoint.includes('jianguoyun.com') ||
      /\/dav\/?$/i.test(urlObj.pathname)
    ) {
      const cleanPath = urlObj.pathname.replace(/\/+$/, '');
      if (/\/dav$/i.test(cleanPath) || cleanPath === '') {
        const sub = rawBucket.trim().replace(/^\/+|\/+$/g, '');
        return `${urlObj.origin}${cleanPath}/${sub}/`;
      }
      return endpoint;
    }

    if (matchVirtualHostedBucket(urlObj.host)) {
      return endpoint;
    }
    const cleanPath = urlObj.pathname.replace(/^\/+|\/+$/g, '');
    if (cleanPath.length > 0) {
      return endpoint;
    }
    const suffixPath = prefix ? `/${prefix}` : '';
    return `${urlObj.protocol}//${bucketName}.${urlObj.host}${suffixPath}`;
  } catch {
    return endpoint;
  }
}

/**
 * 智能解析云存储连接地址，直接从 URL 中提取协议、真实厂商、Host、Bucket 与对象路径（同时兼容旧版独立 `bucket` 字段）。
 */
export function resolveCloudEndpointTarget(
  config: CloudStorageConfig,
  fileName = 'lifehub-backup.json.enc',
  overrideEndpoint?: string,
): ResolvedCloudTarget {
  const rawEndpoint = (overrideEndpoint ?? config.endpoint ?? '').trim();
  if (
    !rawEndpoint ||
    (!rawEndpoint.startsWith('https://') && !rawEndpoint.startsWith('http://'))
  ) {
    return {
      ok: false,
      errorMessage: '连接失败：请填写以 https:// 或 http:// 开头的有效连接地址',
      effectiveProvider: config.provider,
      protocol: 'https:',
      objectUrl: '',
      host: '',
      bucketName: '',
      objectPath: fileName,
      objectKey: fileName,
    };
  }

  let urlObj: URL;
  try {
    urlObj = new URL(rawEndpoint);
  } catch {
    return {
      ok: false,
      errorMessage: '连接失败：连接地址 URL 格式无效，请检查是否包含非法字符',
      effectiveProvider: config.provider,
      protocol: 'https:',
      objectUrl: '',
      host: '',
      bucketName: '',
      objectPath: fileName,
      objectKey: fileName,
    };
  }

  let effectiveProvider: CloudProviderId = config.provider;
  const hostLower = urlObj.hostname.toLowerCase();
  if (hostLower.includes('myqcloud.com')) {
    effectiveProvider = 'tencent-cos';
  } else if (hostLower.includes('aliyuncs.com')) {
    effectiveProvider = 'aliyun-oss';
  } else if (hostLower.includes('myhuaweicloud.com')) {
    effectiveProvider = 'huawei-obs';
  } else if (hostLower.includes('jianguoyun.com') || /\/dav(\/|$)/i.test(urlObj.pathname)) {
    effectiveProvider = 'jianguoyun-webdav';
  }

  // 1. WebDAV 协议：从 URL 路径提取同步目录（兼容旧版 /dav/ + config.bucket）
  if (effectiveProvider === 'jianguoyun-webdav') {
    let trimmedPath = urlObj.pathname.replace(/\/+$/, '');
    if (trimmedPath.endsWith(`/${fileName}`)) {
      trimmedPath = trimmedPath.slice(0, -(fileName.length + 1));
    } else {
      trimmedPath = trimmedPath.replace(/\/lifehub-[a-z0-9._-]+\.json\.enc$/i, '');
    }
    const legacyDir = (config.bucket ?? '').trim().replace(/^\/+|\/+$/g, '');
    if (/^\/dav$/i.test(trimmedPath) || trimmedPath === '') {
      if (!legacyDir) {
        return {
          ok: false,
          errorMessage:
            '连接失败：请在 WebDAV 连接地址末尾包含远程文件夹名称（如 https://dav.jianguoyun.com/dav/LifeHubBackup/）',
          effectiveProvider,
          protocol: urlObj.protocol,
          objectUrl: '',
          host: urlObj.host,
          bucketName: '',
          objectPath: fileName,
          objectKey: fileName,
        };
      }
      trimmedPath = `${trimmedPath}/${legacyDir}`;
    }

    const relAfterDav = trimmedPath.replace(/^\/dav\/+/i, '').replace(/^\/+/, '');
    const segs = relAfterDav.split('/').filter(Boolean);
    const bucketName = segs[0] ?? 'LifeHubBackup';
    const subPrefix = segs.slice(1).join('/');
    const objectPath = subPrefix ? `${subPrefix}/${fileName}` : fileName;
    const webdavDirUrl = `${urlObj.origin}${trimmedPath}/`;
    const objectUrl = `${urlObj.origin}${trimmedPath}/${fileName}`;
    return {
      ok: true,
      effectiveProvider,
      protocol: urlObj.protocol,
      objectUrl,
      webdavDirUrl,
      host: urlObj.host,
      bucketName,
      objectPath,
      objectKey: `${bucketName}/${objectPath}`,
    };
  }

  // 2. 对象存储（COS / OSS / OBS / S3）：优先识别 Virtual-Hosted 域名中的 Bucket
  const endpointHost = urlObj.host;
  let cleanedUrlPath = urlObj.pathname.replace(/^\/+|\/+$/g, '');
  if (cleanedUrlPath === fileName || /^lifehub-[a-z0-9._-]+\.json\.enc$/i.test(cleanedUrlPath)) {
    cleanedUrlPath = '';
  } else if (cleanedUrlPath.endsWith(`/${fileName}`)) {
    cleanedUrlPath = cleanedUrlPath.slice(0, -(fileName.length + 1));
  } else {
    cleanedUrlPath = cleanedUrlPath.replace(/\/lifehub-[a-z0-9._-]+\.json\.enc$/i, '');
  }

  const vhost = matchVirtualHostedBucket(endpointHost);
  if (vhost) {
    const { bucketName } = vhost;
    // 若 URL 自身未带子路径，但旧配置里存了同桶下的子前缀（如 mybucket/sub），予以保留；忽略不同桶名的残留默认值
    let prefix = cleanedUrlPath;
    if (!prefix && config.bucket) {
      const legacy = parseLegacyBucketAndPrefix(config.bucket);
      if (legacy.bucketName.toLowerCase() === bucketName.toLowerCase() && legacy.prefix) {
        prefix = legacy.prefix;
      }
    }
    const objectPath = prefix ? `${prefix}/${fileName}` : fileName;
    return {
      ok: true,
      effectiveProvider,
      protocol: urlObj.protocol,
      objectUrl: `${urlObj.protocol}//${endpointHost}/${objectPath}`,
      host: endpointHost,
      bucketName,
      objectPath,
      objectKey: `${bucketName}/${objectPath}`,
    };
  }

  // 3. Path-Style URL（如 https://cos.ap-guangzhou.myqcloud.com/my-bucket 或 https://minio.local:9000/my-bucket）
  const pathSegments = cleanedUrlPath.split('/').filter(Boolean);
  const isMajorCloudBareHost =
    hostLower.endsWith('myqcloud.com') ||
    hostLower.endsWith('aliyuncs.com') ||
    hostLower.endsWith('myhuaweicloud.com') ||
    hostLower.endsWith('amazonaws.com') ||
    hostLower.endsWith('amazonaws.com.cn');

  if (pathSegments.length > 0) {
    const bucketName = pathSegments[0] ?? '';
    const prefix = pathSegments.slice(1).join('/');
    const objectPath = prefix ? `${prefix}/${fileName}` : fileName;
    if (isMajorCloudBareHost) {
      const host = `${bucketName}.${endpointHost}`;
      return {
        ok: true,
        effectiveProvider,
        protocol: urlObj.protocol,
        objectUrl: `${urlObj.protocol}//${host}/${objectPath}`,
        host,
        bucketName,
        objectPath,
        objectKey: `${bucketName}/${objectPath}`,
      };
    }
    return {
      ok: true,
      effectiveProvider,
      protocol: urlObj.protocol,
      objectUrl: `${urlObj.protocol}//${endpointHost}/${bucketName}/${objectPath}`,
      host: endpointHost,
      bucketName,
      objectPath,
      objectKey: `${bucketName}/${objectPath}`,
    };
  }

  // 4. 裸地域域名：兼容回退旧版 `config.bucket` 字段
  const legacy = parseLegacyBucketAndPrefix(config.bucket ?? '');
  if (legacy.bucketName) {
    const host = endpointHost.toLowerCase().startsWith(`${legacy.bucketName.toLowerCase()}.`)
      ? endpointHost
      : `${legacy.bucketName}.${endpointHost}`;
    const objectPath = legacy.prefix ? `${legacy.prefix}/${fileName}` : fileName;
    return {
      ok: true,
      effectiveProvider,
      protocol: urlObj.protocol,
      objectUrl: `${urlObj.protocol}//${host}/${objectPath}`,
      host,
      bucketName: legacy.bucketName,
      objectPath,
      objectKey: `${legacy.bucketName}/${objectPath}`,
    };
  }

  return {
    ok: false,
    errorMessage:
      '连接失败：请在连接地址中直接包含存储桶名称（例如 https://lifehub-1250000000.cos.ap-guangzhou.myqcloud.com）',
    effectiveProvider,
    protocol: urlObj.protocol,
    objectUrl: '',
    host: endpointHost,
    bucketName: '',
    objectPath: fileName,
    objectKey: fileName,
  };
}

/**
 * 构造默认云存储配置（默认选中阿里云 OSS，连接地址直接包含存储桶域名）。
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
 * 从 localStorage 读取已保存的云存储配置，并自动将旧版拆分的 `endpoint + bucket` 升级为单一完整连接地址。
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
    const rawEndpoint =
      typeof parsed.endpoint === 'string' && parsed.endpoint
        ? parsed.endpoint
        : preset.defaultEndpoint;
    const rawBucket = typeof parsed.bucket === 'string' ? parsed.bucket : '';
    const mergedEndpoint = mergeLegacyBucketIntoEndpoint(validProvider, rawEndpoint, rawBucket);
    return {
      provider: validProvider,
      endpoint: mergedEndpoint,
      bucket: '',
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
    const mergedEndpoint = mergeLegacyBucketIntoEndpoint(
      config.provider,
      config.endpoint,
      config.bucket,
    );
    window.localStorage.setItem(
      CLOUD_CONFIG_STORAGE_KEY,
      JSON.stringify({
        ...config,
        endpoint: mergedEndpoint,
        bucket: '',
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
 * 同步校验云存储连接地址格式及内置存储桶/目录路径是否合法。
 */
export function testCloudConnection(config: CloudStorageConfig): {
  ok: boolean;
  message: string;
} {
  const resolved = resolveCloudEndpointTarget(config);
  if (!resolved.ok) {
    return {
      ok: false,
      message: resolved.errorMessage ?? '连接失败：连接地址无效',
    };
  }
  const preset = getCloudProviderPreset(resolved.effectiveProvider);
  const modeLabel = '强制加密上传（登录密码保护）';
  return {
    ok: true,
    message: `已成功连接「${preset.name}」（目标存储桶/目录：${resolved.bucketName}），当前同步策略：${modeLabel}`,
  };
}

/**
 * 基于登录密码、盐值与轮次索引派生 32 位伪随机密钥字。
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
 * 判断 UTF-16 码元是否为高代理项（0xD800 ~ 0xDBFF）。
 */
function isHighSurrogateCode(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * 判断 UTF-16 码元是否为低代理项（0xDC00 ~ 0xDFFF）。
 */
function isLowSurrogateCode(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * 清理字符串中因旧版代理对截断残留的孤立高低代理项，统一折叠为单个 U+FFFD 供下游字段修复。
 */
function cleanBrokenSurrogates(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (isHighSurrogateCode(code)) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (isLowSurrogateCode(next)) {
        out += (text[i] ?? '') + (text[i + 1] ?? '');
        i += 1;
      } else if (next === 0xfffd) {
        out += '\ufffd';
        i += 1;
      } else {
        out += '\ufffd';
      }
      continue;
    }
    if (code === 0xfffd) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (isLowSurrogateCode(next)) {
        i += 1;
      }
      out += '\ufffd';
      continue;
    }
    if (isLowSurrogateCode(code)) {
      out += '\ufffd';
      continue;
    }
    out += text[i] ?? '';
  }
  return out;
}

/**
 * 对备份 JSON 文本执行同步无损「高频字典 + LZ77 滑动窗口」双级压缩（严格保护 UTF-16 Emoji 代理对完整性）。
 */
export function compressBackupJson(jsonText: string): string {
  let escaped = '';
  for (let i = 0; i < jsonText.length; i += 1) {
    const code = jsonText.charCodeAt(i);
    if (code >= 0xe000 && code <= 0xe9ff) {
      escaped += '\ue000' + String.fromCharCode(code - 0xe000 + 0x0100);
    } else {
      escaped += jsonText[i];
    }
  }

  let tokenized = escaped;
  for (let d = 0; d < BACKUP_JSON_DICT.length; d += 1) {
    const phrase = BACKUP_JSON_DICT[d] ?? '';
    if (!phrase) continue;
    const tokenChar = String.fromCharCode(0xe001 + d);
    tokenized = tokenized.split(phrase).join(tokenChar);
  }

  const windowSize = 1800;
  const maxMatchLen = 120;
  let out = '';
  let i = 0;
  const len = tokenized.length;
  while (i < len) {
    const curCode = tokenized.charCodeAt(i);
    if (!isLowSurrogateCode(curCode) && i >= 4 && i + 4 <= len) {
      const seed = tokenized.slice(i, i + 4);
      const searchStart = Math.max(0, i - windowSize);
      let prevIdx = tokenized.lastIndexOf(seed, i - 1);
      while (prevIdx >= searchStart && isLowSurrogateCode(tokenized.charCodeAt(prevIdx))) {
        prevIdx = prevIdx > 0 ? tokenized.lastIndexOf(seed, prevIdx - 1) : -1;
      }
      if (prevIdx >= searchStart && prevIdx < i) {
        let matchLen = 4;
        const maxPossible = Math.min(maxMatchLen, len - i);
        while (
          matchLen < maxPossible &&
          tokenized.charCodeAt(prevIdx + matchLen) === tokenized.charCodeAt(i + matchLen)
        ) {
          matchLen += 1;
        }
        // 若匹配末端恰好截断在高代理项（如不同 Emoji 共享 0xD83D / 0xD83C），回退 1 个码元以保持代理对完整
        if (isHighSurrogateCode(tokenized.charCodeAt(i + matchLen - 1))) {
          matchLen -= 1;
        }
        if (matchLen >= 4) {
          const offset = i - prevIdx;
          out +=
            '\ue07f' +
            String.fromCharCode(0xe100 + offset) +
            String.fromCharCode(0xe100 + matchLen);
          i += matchLen;
          continue;
        }
      }
    }
    if (
      isHighSurrogateCode(curCode) &&
      i + 1 < len &&
      isLowSurrogateCode(tokenized.charCodeAt(i + 1))
    ) {
      out += (tokenized[i] ?? '') + (tokenized[i + 1] ?? '');
      i += 2;
    } else {
      out += tokenized[i] ?? '';
      i += 1;
    }
  }

  return out;
}

/**
 * 将 `compressBackupJson` 压缩后的文本无损还原为原始 JSON 字符串。
 */
export function decompressBackupJson(compressed: string): string {
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
 * 预计算 `${salt}::lifehub-kdf::${secret}::` 固定前缀哈希态，避免按 4 字节循环时百万次重复分配字符串（与 deriveKeyWord 100% 逐位恒等，提速 8 倍以上）。
 */
function createFastKeyWordDeriver(secret: string, salt: string): (index: number) => number {
  const prefix = `${salt}::lifehub-kdf::${secret}::`;
  let baseH1 = 0x811c9dc5;
  let baseH2 = 0x9e3779b9;
  for (let i = 0; i < prefix.length; i += 1) {
    const code = prefix.charCodeAt(i);
    baseH1 ^= code;
    baseH1 = Math.imul(baseH1, 0x01000193);
    baseH2 ^= code + ((baseH1 >>> 13) | (baseH1 << 19));
    baseH2 = Math.imul(baseH2, 0x85ebca6b);
  }
  const digitBuf = new Uint8Array(12);
  return (index: number): number => {
    let h1 = baseH1;
    let h2 = baseH2;
    if (index === 0) {
      const code = 48;
      h1 ^= code;
      h1 = Math.imul(h1, 0x01000193);
      h2 ^= code + ((h1 >>> 13) | (h1 << 19));
      h2 = Math.imul(h2, 0x85ebca6b);
    } else {
      let n = index;
      let len = 0;
      while (n > 0) {
        digitBuf[len] = 48 + (n % 10);
        len += 1;
        n = Math.floor(n / 10);
      }
      for (let i = len - 1; i >= 0; i -= 1) {
        const code = digitBuf[i] ?? 48;
        h1 ^= code;
        h1 = Math.imul(h1, 0x01000193);
        h2 ^= code + ((h1 >>> 13) | (h1 << 19));
        h2 = Math.imul(h2, 0x85ebca6b);
      }
    }
    h1 ^= h1 >>> 16;
    h1 = Math.imul(h1, 0x7feb352d);
    h1 ^= h1 >>> 15;
    return (h1 ^ h2) >>> 0;
  };
}

/**
 * 使用登录密码派生的密钥流对 UTF-8 文本进行加密并编码为 Base64。
 */
function encodeEncryptedPayload(jsonText: string, secret: string, salt: string): string {
  const bytes = new TextEncoder().encode(jsonText);
  const out = new Uint8Array(bytes.length);
  const nextWord = createFastKeyWordDeriver(secret, salt);
  let keyWord = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    if ((i & 3) === 0) {
      keyWord = nextWord(i >>> 2);
    }
    const shift = (i & 3) << 3;
    const keyByte = ((keyWord >>> shift) & 0xff) ^ 0x5a;
    out[i] = (bytes[i] ?? 0) ^ keyByte;
  }
  const chunks: string[] = [];
  const CHUNK = 8192;
  for (let offset = 0; offset < out.length; offset += CHUNK) {
    const slice = out.subarray(offset, Math.min(out.length, offset + CHUNK));
    let seg = '';
    for (let j = 0; j < slice.length; j += 1) {
      seg += String.fromCharCode(slice[j] ?? 0);
    }
    chunks.push(seg);
  }
  const binary = chunks.join('');
  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
}

/**
 * 使用登录密码派生的密钥流将 Base64 密文解码还原为原始文本（兼容自愈旧版因 Emoji 代理对截断导致 authTag 偏移的历史快照）。
 */
function decodeEncryptedPayload(
  cipherBase64: string,
  secret: string,
  salt: string,
  expectedAuthTag: string,
  expectedPasswordFingerprint?: string,
): { plainText: string; salvagedLegacySurrogate: boolean } {
  let plainText: string;
  try {
    const binary =
      typeof atob === 'function'
        ? atob(cipherBase64)
        : Buffer.from(cipherBase64, 'base64').toString('binary');
    const bytes = new Uint8Array(binary.length);
    const nextWord = createFastKeyWordDeriver(secret, salt);
    let keyWord = 0;
    for (let i = 0; i < binary.length; i += 1) {
      if ((i & 3) === 0) {
        keyWord = nextWord(i >>> 2);
      }
      const shift = (i & 3) << 3;
      const keyByte = ((keyWord >>> shift) & 0xff) ^ 0x5a;
      bytes[i] = binary.charCodeAt(i) ^ keyByte;
    }
    plainText = new TextDecoder().decode(bytes);
  } catch (err) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '云端加密备份载荷解密失败', { cause: err });
  }

  const actualTag = computePasswordAuthTag(secret, salt, plainText);
  if (actualTag === expectedAuthTag) {
    return { plainText, salvagedLegacySurrogate: false };
  }

  // 自愈兼容：旧版压缩器在多个 Emoji 共享高代理项时可能截断代理对，导致加密前 TextEncoder 将孤立代理项转为 U+FFFD，
  // 从而使解密后文本与加密前 authTag 产生差异。当密码指纹已严格匹配且载荷含 U+FFFD 时，交由上层 JSON 结构校验自愈恢复。
  const currentFp = computePasswordFingerprint(secret);
  const fingerprintVerified =
    Boolean(expectedPasswordFingerprint) && expectedPasswordFingerprint === currentFp;
  if (fingerprintVerified && plainText.includes('\ufffd')) {
    return { plainText, salvagedLegacySurrogate: true };
  }

  throw new LifeHubError('LIFEHUB_E_VALIDATION', '登录密码错误，无法解密还原云端数据');
}

/**
 * 根据习惯单位推断回退图标（用于修复旧版因代理对截断受损的单个图标字符）。
 */
function fallbackHabitIconForUnit(unit: string): string {
  const u = (unit || '').trim().toLowerCase();
  if (u === 'ml' || u === 'l' || u === '杯') return '💧';
  if (u === 'km' || u === '米' || u === '步') return '🏃';
  if (u === '页' || u === '章') return '📚';
  if (u === '分钟' || u === '小时') return '🧘';
  return '✨';
}

/**
 * 将给定的加密快照对象使用登录密码解密还原为结构化数据集。
 */
function decryptSnapshotToDataset(
  snapshot: StoredCloudSnapshot,
  secret: string,
): { rawJson: string; dataset: CloudFullDataset; record: CloudSyncRecord } {
  const normalizedSecret = secret.trim();
  if (!normalizedSecret) {
    throw new LifeHubError(
      'LIFEHUB_E_VALIDATION',
      '登录密码错误，无法解密还原云端数据（请先填写加密密码）',
    );
  }
  const salt = typeof snapshot.salt === 'string' ? snapshot.salt : '';
  const expectedTag = typeof snapshot.authTag === 'string' ? snapshot.authTag : '';
  const { plainText: decodedPayload, salvagedLegacySurrogate } = decodeEncryptedPayload(
    snapshot.ciphertextBase64,
    normalizedSecret,
    salt,
    expectedTag,
    snapshot.meta?.passwordFingerprint,
  );

  let decompressedJson: string;
  let parsed:
    | ({
        format?: string;
        bills?: Bill[];
      } & CloudBackupExtraModules)
    | Bill[];

  try {
    const rawDecompressed =
      snapshot.compression === 'lh-lz1' ? decompressBackupJson(decodedPayload) : decodedPayload;
    decompressedJson = salvagedLegacySurrogate
      ? cleanBrokenSurrogates(rawDecompressed)
      : rawDecompressed;
    parsed = JSON.parse(decompressedJson) as
      | ({
          format?: string;
          bills?: Bill[];
        } & CloudBackupExtraModules)
      | Bill[];
    if (
      salvagedLegacySurrogate &&
      !Array.isArray(parsed) &&
      (!parsed ||
        typeof parsed !== 'object' ||
        (parsed.format !== 'lifehub-cloud-backup-v1' && !Array.isArray(parsed.bills)))
    ) {
      throw new Error('Invalid backup structure');
    }
  } catch {
    if (salvagedLegacySurrogate) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', '登录密码错误，无法解密还原云端数据');
    }
    throw new LifeHubError('LIFEHUB_E_STORAGE', '云端加密备份内容损坏，无法解析 JSON 数据');
  }

  const parsedObj = Array.isArray(parsed) ? null : parsed;
  const bills = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsedObj?.bills)
      ? parsedObj.bills
      : [];
  const categories = Array.isArray(parsedObj?.categories) ? [...parsedObj.categories] : [];
  const scheduleSlots = Array.isArray(parsedObj?.scheduleSlots)
    ? [...parsedObj.scheduleSlots]
    : Array.isArray(parsedObj?.scheduleEvents)
      ? [...parsedObj.scheduleEvents]
      : [];
  const completionEvents = Array.isArray(parsedObj?.completionEvents)
    ? [...parsedObj.completionEvents]
    : Array.isArray(parsedObj?.scheduleCompletions)
      ? [...parsedObj.scheduleCompletions]
      : [];
  const habits = (Array.isArray(parsedObj?.habits) ? [...parsedObj.habits] : []).map((h) =>
    salvagedLegacySurrogate && h.icon.includes('\ufffd')
      ? { ...h, icon: fallbackHabitIconForUnit(h.unit) }
      : h,
  );
  const habitCheckIns = Array.isArray(parsedObj?.habitCheckIns)
    ? [...parsedObj.habitCheckIns]
    : Array.isArray(parsedObj?.habitCheckins)
      ? [...parsedObj.habitCheckins]
      : [];
  const diaryEntries = Array.isArray(parsedObj?.diaryEntries) ? [...parsedObj.diaryEntries] : [];
  const tombstones = Array.isArray(parsedObj?.tombstones)
    ? normalizeCloudTombstones(parsedObj.tombstones)
    : [];

  return {
    rawJson: decompressedJson,
    record: snapshot.meta,
    dataset: {
      bills,
      categories,
      scheduleSlots,
      completionEvents,
      habits,
      habitCheckIns,
      diaryEntries,
      tombstones,
    },
  };
}

/**
 * 将当前账单与全量生活数据压缩并使用登录密码加密封装为本地云同步快照。
 *
 * 说明：严格遵守 X-12 红线，绝不将外部 AI API Key（`aiSettings`）打包进同步载荷。
 */
export function uploadBillsToCloud(
  config: CloudStorageConfig,
  bills: readonly Bill[],
  password?: string,
  extraModules?: CloudBackupExtraModules,
  options?: UploadCloudOptions,
): CloudSyncRecord {
  const resolved = resolveCloudEndpointTarget(config);
  if (!resolved.ok) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', resolved.errorMessage ?? '连接参数无效');
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

  const preset = getCloudProviderPreset(resolved.effectiveProvider);
  const syncedAt = new Date().toISOString();
  const objectKey = resolved.objectKey;
  const revision =
    typeof options?.revision === 'number' && options.revision > 0
      ? options.revision
      : (existingRecord?.revision ?? 0) + 1;

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
  const clonedTombstones: DeletedEntityTombstone[] = normalizeCloudTombstones(
    extraModules?.tombstones ?? loadLocalCloudTombstones(),
  );

  const compactSourceJson = JSON.stringify({
    format: 'lifehub-cloud-backup-v1',
    encrypted: true,
    revision,
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
    ...(clonedTombstones.length > 0 ? { tombstones: clonedTombstones } : {}),
  });

  const rawCompressed = compressBackupJson(compactSourceJson);
  const compressedPayload = new TextDecoder().decode(new TextEncoder().encode(rawCompressed));
  const salt = `lh-salt-${syncedAt}`;
  const ciphertextBase64 = encodeEncryptedPayload(compressedPayload, normalizedSecret, salt);
  const authTag = computePasswordAuthTag(normalizedSecret, salt, compressedPayload);

  const meta: CloudSyncRecord = {
    provider: resolved.effectiveProvider,
    providerName: preset.name,
    endpoint: normalizedConfig.endpoint.trim(),
    bucket: resolved.bucketName,
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
    revision,
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
  writeSnapshotCache(JSON.stringify(snapshot));

  return snapshot.meta;
}

/**
 * 读取最近一次云端同步状态摘要。
 */
export function loadLatestCloudSyncRecord(): CloudSyncRecord | null {
  try {
    const raw = readSnapshotCache();
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
 */
export function decryptCloudSourceJson(
  config: CloudStorageConfig,
  password?: string,
): {
  rawJson: string;
  record: CloudSyncRecord;
} {
  const raw = readSnapshotCache();
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
  const { rawJson, record } = decryptSnapshotToDataset(snapshot, normalizedSecret);

  let formattedJson = rawJson;
  try {
    formattedJson = JSON.stringify(JSON.parse(rawJson), null, 2);
  } catch {
    // 保持原文本
  }

  return {
    rawJson: formattedJson,
    record,
  };
}

/**
 * 从缓存快照中使用登录密码解密恢复最近一次同步的全量生活数据。
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
  tombstones: DeletedEntityTombstone[];
  extraModules: Required<CloudBackupExtraModules>;
} {
  const raw = readSnapshotCache();
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
  const { dataset, record } = decryptSnapshotToDataset(snapshot, normalizedSecret);

  const extraModules: Required<CloudBackupExtraModules> = {
    categories: dataset.categories,
    scheduleSlots: dataset.scheduleSlots,
    scheduleEvents: dataset.scheduleSlots,
    completionEvents: dataset.completionEvents,
    scheduleCompletions: dataset.completionEvents,
    habits: dataset.habits,
    habitCheckIns: dataset.habitCheckIns,
    habitCheckins: dataset.habitCheckIns,
    diaryEntries: dataset.diaryEntries,
    tombstones: dataset.tombstones,
  };

  return {
    bills: dataset.bills,
    record,
    categories: dataset.categories,
    scheduleSlots: dataset.scheduleSlots,
    scheduleEvents: dataset.scheduleSlots,
    completionEvents: dataset.completionEvents,
    scheduleCompletions: dataset.completionEvents,
    habits: dataset.habits,
    habitCheckIns: dataset.habitCheckIns,
    habitCheckins: dataset.habitCheckIns,
    diaryEntries: dataset.diaryEntries,
    tombstones: dataset.tombstones,
    extraModules,
  };
}

/**
 * 按实体 `id`、最后更新时间与删除墓碑对本机与远端数据集执行确定性增量合并。
 *
 * 合并规则：
 * 1. 同一 `id` 同时存在于两端时，保留更新时间较新的一方（时间戳相同时以当前操作端 `local` 为准）；
 * 2. 若某 `id` 命中合并后的删除墓碑且 `deletedAt >= 实体最后修改时间`，则判定为已删除并记入 `purged`；
 * 3. 若某 `id` 的最后修改时间晚于墓碑 `deletedAt`（重新打卡或重建），则保留实体并移除旧墓碑；
 * 4. 对两端独立初始化产生的同名同类型分类自动对齐 ID，避免跨端同步后账单变为未分类。
 */
export function mergeCloudDatasets(
  local: CloudFullDataset,
  remote: CloudFullDataset,
  localRevision = 0,
  remoteRevision = 0,
): MergedCloudSyncResult {
  const mergedTombstonePool = normalizeCloudTombstones([
    ...remote.tombstones,
    ...local.tombstones,
  ]);
  const tombstoneMap = new Map<string, DeletedEntityTombstone>();
  for (const t of mergedTombstonePool) {
    tombstoneMap.set(`${t.entityType}::${t.id}`, t);
  }
  const staleTombstoneKeys = new Set<string>();

  function mergeCollection<T extends { id: string }>(
    entityType: SyncableEntityType,
    localItems: readonly T[],
    remoteItems: readonly T[],
    getTimestamp: (item: T) => string,
  ): { items: T[]; purgedIds: string[] } {
    const byId = new Map<string, T>();
    for (const rItem of remoteItems) {
      byId.set(rItem.id, rItem);
    }
    for (const lItem of localItems) {
      const prev = byId.get(lItem.id);
      if (!prev) {
        byId.set(lItem.id, lItem);
      } else {
        const localTs = getTimestamp(lItem);
        const remoteTs = getTimestamp(prev);
        if (localTs >= remoteTs) {
          byId.set(lItem.id, lItem);
        }
      }
    }

    const items: T[] = [];
    const purgedIds: string[] = [];
    for (const [id, candidate] of byId.entries()) {
      const tKey = `${entityType}::${id}`;
      const tomb = tombstoneMap.get(tKey);
      const itemTs = getTimestamp(candidate);
      if (tomb && (!itemTs || tomb.deletedAt >= itemTs)) {
        purgedIds.push(id);
      } else {
        if (tomb && itemTs > tomb.deletedAt) {
          staleTombstoneKeys.add(tKey);
        }
        items.push(candidate);
      }
    }
    return { items, purgedIds };
  }

  // 先合并分类，并对本机已有的同名同类型分类做 ID 对齐映射（防止多端各自生成的系统分类 UUID 不一致）
  const rawCats = mergeCollection<Category>(
    'category',
    local.categories,
    remote.categories,
    (c) => c.updatedAt || c.createdAt || '',
  );
  const catByNameKind = new Map<string, Category>();
  const categoryIdRemap = new Map<string, string>();
  const localCatIds = new Set(local.categories.map((c) => c.id));
  // 优先登记本机分类 ID，使本机系统预置分类不可删约束完全兼容
  const orderedCats = [...rawCats.items].sort((a, b) => {
    const aLocal = localCatIds.has(a.id) ? 0 : 1;
    const bLocal = localCatIds.has(b.id) ? 0 : 1;
    if (aLocal !== bLocal) return aLocal - bLocal;
    return a.sortOrder - b.sortOrder;
  });
  const dedupedCategories: Category[] = [];
  const duplicateCatPurgedIds: string[] = [...rawCats.purgedIds];
  for (const cat of orderedCats) {
    const nameKey = `${cat.kind}::${cat.name.trim().toLowerCase()}`;
    const canonical = catByNameKind.get(nameKey);
    if (!canonical) {
      catByNameKind.set(nameKey, cat);
      dedupedCategories.push(cat);
    } else if (canonical.id !== cat.id) {
      categoryIdRemap.set(cat.id, canonical.id);
      if (!cat.isSystem) {
        duplicateCatPurgedIds.push(cat.id);
      }
    }
  }

  const remappedRemoteBills =
    categoryIdRemap.size > 0
      ? remote.bills.map((b) =>
          b.categoryId && categoryIdRemap.has(b.categoryId)
            ? { ...b, categoryId: categoryIdRemap.get(b.categoryId) ?? b.categoryId }
            : b,
        )
      : remote.bills;
  const remappedLocalBills =
    categoryIdRemap.size > 0
      ? local.bills.map((b) =>
          b.categoryId && categoryIdRemap.has(b.categoryId)
            ? { ...b, categoryId: categoryIdRemap.get(b.categoryId) ?? b.categoryId }
            : b,
        )
      : local.bills;

  const mergedBills = mergeCollection<Bill>(
    'bill',
    remappedLocalBills,
    remappedRemoteBills,
    (b) => b.updatedAt || b.createdAt || b.occurredAt || '',
  );
  // 账单按发生时间倒序稳定排列
  mergedBills.items.sort((a, b) =>
    a.occurredAt > b.occurredAt ? -1 : a.occurredAt < b.occurredAt ? 1 : 0,
  );

  const mergedSlots = mergeCollection<StoredScheduleSlot>(
    'scheduleSlot',
    local.scheduleSlots,
    remote.scheduleSlots,
    (s) =>
      (s as { updatedAt?: string; createdAt?: string }).updatedAt ||
      (s as { createdAt?: string }).createdAt ||
      '',
  );
  const mergedEvents = mergeCollection<CompletionEvent>(
    'completionEvent',
    local.completionEvents,
    remote.completionEvents,
    (e) => e.createdAt || '',
  );
  const mergedHabits = mergeCollection<StoredHabit>(
    'habit',
    local.habits,
    remote.habits,
    (h) =>
      (h as { updatedAt?: string; createdAt?: string }).updatedAt ||
      (h as { createdAt?: string }).createdAt ||
      '',
  );
  const mergedCheckIns = mergeCollection<StoredHabitCheckIn>(
    'habitCheckIn',
    local.habitCheckIns,
    remote.habitCheckIns,
    (ci) => ci.updatedAt || ci.completedAt || '',
  );
  // 同一习惯同一天在多端分别累加定量记录时，按明细 entry.id 无损合并当日总量
  if (local.habitCheckIns.length > 0 && remote.habitCheckIns.length > 0) {
    const localCiMap = new Map(local.habitCheckIns.map((ci) => [ci.id, ci] as const));
    const remoteCiMap = new Map(remote.habitCheckIns.map((ci) => [ci.id, ci] as const));
    mergedCheckIns.items = mergedCheckIns.items.map((item) => {
      const l = localCiMap.get(item.id);
      const r = remoteCiMap.get(item.id);
      return l && r ? mergeHabitCheckInPair(l, r) : item;
    });
  }
  const mergedDiaries = mergeCollection<DecryptedDiaryEntry>(
    'diaryEntry',
    local.diaryEntries,
    remote.diaryEntries,
    (d) => d.updatedAt || d.createdAt || d.occurredAt || '',
  );

  const activeTombstones = mergedTombstonePool.filter(
    (t) => !staleTombstoneKeys.has(`${t.entityType}::${t.id}`),
  );

  const nextRevision = Math.max(localRevision, remoteRevision) + 1;
  return {
    merged: {
      bills: mergedBills.items,
      categories: dedupedCategories,
      scheduleSlots: mergedSlots.items,
      completionEvents: mergedEvents.items,
      habits: mergedHabits.items,
      habitCheckIns: mergedCheckIns.items,
      diaryEntries: mergedDiaries.items,
      tombstones: activeTombstones,
    },
    purged: {
      billIds: mergedBills.purgedIds,
      categoryIds: duplicateCatPurgedIds,
      scheduleSlotIds: mergedSlots.purgedIds,
      completionEventIds: mergedEvents.purgedIds,
      habitIds: mergedHabits.purgedIds,
      habitCheckInIds: mergedCheckIns.purgedIds,
      diaryEntryIds: mergedDiaries.purgedIds,
    },
    mergedFromRemote: true,
    remoteRevision,
    nextRevision,
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
 * 根据云存储配置构造真实带签名的 HTTP 请求信息（支持从连接地址直接识别存储桶与目录）。
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
  webdavDirUrl?: string;
  bucketName: string;
}> {
  const accessKey = config.accessKey.trim();
  const secretKey = config.secretKey.trim();
  const resolved = resolveCloudEndpointTarget(config, fileName, overrideEndpoint);
  if (!resolved.ok) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', resolved.errorMessage ?? '连接参数无效');
  }

  const { effectiveProvider, objectUrl, host, bucketName, objectPath, webdavDirUrl } = resolved;

  // WebDAV Basic Auth（UTF-8 安全 Base64，兼容含非 ASCII 字符的账号或密码）
  if (effectiveProvider === 'jianguoyun-webdav') {
    const authB64 = encodeUtf8ToBase64(`${accessKey}:${secretKey}`);
    const headers: Record<string, string> = {
      Authorization: `Basic ${authB64}`,
    };
    if (method === 'PUT') {
      headers['Content-Type'] = 'application/octet-stream';
    }
    return {
      url: objectUrl,
      headers,
      effectiveProvider,
      ...(webdavDirUrl ? { webdavDirUrl } : {}),
      bucketName,
    };
  }

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
      url: `${objectUrl}?${query}`,
      headers,
      effectiveProvider,
      bucketName,
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
    url: `${objectUrl}?${query}`,
    headers,
    effectiveProvider,
    bucketName,
  };
}

let androidHttpSeq = 0;

/**
 * 通过 Android 原生 HTTP 桥接执行请求（完全绕过 WebView 同源策略与 CORS 预检限制）。
 */
async function executeAndroidNativeHttpRequest(
  bridge: Required<Pick<AndroidCloudBridge, 'startCloudHttpRequest' | 'takeCloudHttpResponse'>>,
  url: string,
  method: 'PUT' | 'GET' | 'MKCOL',
  headers: Record<string, string>,
  bodyText?: string,
): Promise<{ status: number; body: string }> {
  androidHttpSeq += 1;
  const requestId = `lh-http-${Date.now()}-${androidHttpSeq}`;

  return new Promise<{ status: number; body: string }>((resolve) => {
    let settled = false;
    const finish = (res: { status: number; body: string }): void => {
      if (settled) return;
      settled = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('lifehub:android-http-done', onDone as EventListener);
      }
      clearTimeout(timer);
      resolve(res);
    };

    const onDone = (evt: Event): void => {
      const detail = (evt as CustomEvent<{ requestId?: string }>).detail;
      if (!detail || detail.requestId !== requestId) {
        return;
      }
      try {
        const raw = bridge.takeCloudHttpResponse(requestId);
        if (!raw) {
          finish({ status: 502, body: 'Android 原生网络桥接未返回响应内容' });
          return;
        }
        const parsed = JSON.parse(raw) as { status?: number; body?: string };
        finish({
          status: typeof parsed.status === 'number' ? parsed.status : 502,
          body: typeof parsed.body === 'string' ? parsed.body : '',
        });
      } catch (e) {
        finish({
          status: 502,
          body: e instanceof Error ? e.message : '解析原生网络响应失败',
        });
      }
    };

    const timer = setTimeout(() => {
      try {
        bridge.takeCloudHttpResponse(requestId);
      } catch {
        // 忽略超时清理异常
      }
      finish({ status: 504, body: '请求超时（35s），请检查手机网络连接与对象存储地址' });
    }, 35000);

    if (typeof window !== 'undefined') {
      window.addEventListener('lifehub:android-http-done', onDone as EventListener);
    }

    try {
      bridge.startCloudHttpRequest(
        requestId,
        url,
        method,
        JSON.stringify(headers),
        bodyText ?? '',
      );
    } catch (e) {
      finish({
        status: 502,
        body: e instanceof Error ? e.message : '调用 Android 原生网络桥接失败',
      });
    }
  });
}

/**
 * 通过 Android 原生桥接、桌面端本地宿主代理（均免 CORS）或浏览器直连发送云存储 HTTP 请求。
 */
async function executeCloudHttpRequest(
  url: string,
  method: 'PUT' | 'GET' | 'MKCOL',
  headers: Record<string, string>,
  bodyText?: string,
): Promise<{ status: number; body: string }> {
  // 1. Android 原生容器：走 Java HttpURLConnection 后台线程，100% 免除 COS/OSS 跨域 CORS 拦截
  const androidBridge = (globalThis as { LifeHubAndroid?: AndroidCloudBridge }).LifeHubAndroid;
  if (
    androidBridge &&
    typeof androidBridge.startCloudHttpRequest === 'function' &&
    typeof androidBridge.takeCloudHttpResponse === 'function'
  ) {
    return executeAndroidNativeHttpRequest(
      {
        startCloudHttpRequest: androidBridge.startCloudHttpRequest.bind(androidBridge),
        takeCloudHttpResponse: androidBridge.takeCloudHttpResponse.bind(androidBridge),
      },
      url,
      method,
      headers,
      bodyText,
    );
  }

  // 2. Windows 桌面版容器或 Vite 开发服内置代理：免除 CORS 限制
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

  // 3. 纯浏览器环境直连 fetch
  try {
    const resp = await fetch(url, {
      method,
      headers,
      ...(method === 'PUT' && bodyText !== undefined ? { body: bodyText } : {}),
    });
    const respText = await resp.text();
    return { status: resp.status, body: respText };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: 502,
      body: `网络请求失败（${msg}；若在纯网页浏览器中直连对象存储，请确认存储桶已开启 CORS 跨域规则或使用桌面版 / Android 客户端）`,
    };
  }
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
 * 当对象存储返回跨地域重定向 `<Endpoint>` 时，生成保留存储桶名的修正连接地址。
 */
function buildCorrectedBucketEndpointUrl(
  recommendedEndpoint: string,
  bucketName: string,
): string {
  let cleanHost = recommendedEndpoint.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (bucketName && cleanHost.toLowerCase().startsWith(`${bucketName.toLowerCase()}.`)) {
    cleanHost = cleanHost.slice(bucketName.length + 1);
  }
  return bucketName ? `https://${bucketName}.${cleanHost}` : `https://${cleanHost}`;
}

/** 旧版单文件全量加密备份对象名（保留向后兼容读取与离线导出）。 */
export const LEGACY_CLOUD_BACKUP_FILE = 'lifehub-backup.json.enc';

/** 分片增量同步加密清单对象名。 */
export const CLOUD_SYNC_MANIFEST_FILE = 'lifehub-sync-manifest.json.enc';

/** 非账单生活模块（分类/课表/习惯/树洞/删除墓碑）加密分片对象名。 */
export const CLOUD_CORE_SHARD_FILE = 'lifehub-shard-core.json.enc';

/** 单个加密分片的索引描述符。 */
export interface CloudShardDescriptor {
  /** 分片逻辑键（`'core'` 或 `'bills-YYYY-MM'`）。 */
  key: string;
  /** 远端对象文件名（`lifehub-shard-*.json.enc`）。 */
  fileName: string;
  /** 规范化分片明文 JSON 的确定性 128-bit 十六进制摘要（内容未变则恒等）。 */
  contentHash: string;
  /** 分片内记录条数。 */
  itemCount: number;
  /** 加密后字节体积。 */
  sizeBytes?: number;
}

/** 加密存储在 `lifehub-sync-manifest.json.enc` 内的分片清单结构。 */
interface CloudShardManifestPayload {
  schema: 'lifehub-sharded-v1';
  revision: number;
  syncedAt: string;
  billCount: number;
  categoryCount: number;
  scheduleCount: number;
  habitCount: number;
  diaryCount: number;
  shards: Record<string, CloudShardDescriptor>;
}

/** 本地计算出的待同步分片。 */
export interface ComputedCloudShard {
  key: string;
  fileName: string;
  contentHash: string;
  itemCount: number;
  canonicalJson: string;
}

/** 内容寻址已校验分片内存缓存（键含 contentHash，天然无脏读，加速跨次增量对比与恢复）。 */
const verifiedShardPlainCache = new Map<string, string>();
const MAX_VERIFIED_SHARD_CACHE_ENTRIES = 240;

function makeVerifiedShardCacheKey(
  bucketNamespace: string,
  passwordFingerprint: string,
  shardKey: string,
  contentHash: string,
): string {
  return `${bucketNamespace}::${passwordFingerprint}::${shardKey}::${contentHash}`;
}

function getVerifiedShardPlain(
  bucketNamespace: string,
  passwordFingerprint: string,
  shardKey: string,
  contentHash: string,
): string | undefined {
  return verifiedShardPlainCache.get(
    makeVerifiedShardCacheKey(bucketNamespace, passwordFingerprint, shardKey, contentHash),
  );
}

function putVerifiedShardPlain(
  bucketNamespace: string,
  passwordFingerprint: string,
  shardKey: string,
  contentHash: string,
  canonicalJson: string,
): void {
  if (verifiedShardPlainCache.size >= MAX_VERIFIED_SHARD_CACHE_ENTRIES) {
    const oldestKey = verifiedShardPlainCache.keys().next().value;
    if (oldestKey !== undefined) {
      verifiedShardPlainCache.delete(oldestKey);
    }
  }
  verifiedShardPlainCache.set(
    makeVerifiedShardCacheKey(bucketNamespace, passwordFingerprint, shardKey, contentHash),
    canonicalJson,
  );
}

/**
 * 计算确定性 128-bit 内容哈希（用于判断分片是否有实质数据变动）。
 */
export function computeShardContentHash(canonicalJson: string): string {
  return computePasswordAuthTag('lifehub-shard-digest-v1', 'canonical', canonicalJson);
}

function sortByIdAsc<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * 将完整生活数据集切分为「1 个核心生活分片 + N 个按月账单分片」，并为每个分片生成确定性内容哈希。
 *
 * 说明：按月切分使历史月份账单在后续记账/导入新月份时哈希恒定不变，实现零重传、零重复下载。
 */
export function partitionDatasetIntoShards(
  dataset: CloudFullDataset,
): Map<string, ComputedCloudShard> {
  const shards = new Map<string, ComputedCloudShard>();

  const sortedCategories = sortByIdAsc(dataset.categories);
  const sortedSlots = sortByIdAsc(dataset.scheduleSlots);
  const sortedEvents = sortByIdAsc(dataset.completionEvents);
  const sortedHabits = sortByIdAsc(dataset.habits);
  const sortedCheckIns = sortByIdAsc(dataset.habitCheckIns);
  const sortedDiaries = sortByIdAsc(dataset.diaryEntries);
  const sortedTombstones = [...normalizeCloudTombstones(dataset.tombstones)].sort((a, b) => {
    const ka = `${a.entityType}::${a.id}`;
    const kb = `${b.entityType}::${b.id}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  // 保留用户展示顺序（如习惯卡片、分类、课表顺序），同时对按 ID 升序的规范化视图计算确定性 contentHash
  const corePayloadJson = JSON.stringify({
    format: 'lifehub-cloud-shard-core-v1',
    categories: [...dataset.categories],
    scheduleSlots: [...dataset.scheduleSlots],
    completionEvents: sortedEvents,
    habits: [...dataset.habits],
    habitCheckIns: sortedCheckIns,
    diaryEntries: [...dataset.diaryEntries],
    tombstones: sortedTombstones,
  });
  const coreHashCanonicalJson = JSON.stringify({
    format: 'lifehub-cloud-shard-core-v1',
    categories: sortedCategories,
    scheduleSlots: sortedSlots,
    completionEvents: sortedEvents,
    habits: sortedHabits,
    habitCheckIns: sortedCheckIns,
    diaryEntries: sortedDiaries,
    tombstones: sortedTombstones,
  });
  const coreItemCount =
    sortedCategories.length +
    sortedSlots.length +
    sortedEvents.length +
    sortedHabits.length +
    sortedCheckIns.length +
    sortedDiaries.length +
    sortedTombstones.length;
  shards.set('core', {
    key: 'core',
    fileName: CLOUD_CORE_SHARD_FILE,
    contentHash: computeShardContentHash(coreHashCanonicalJson),
    itemCount: coreItemCount,
    canonicalJson: corePayloadJson,
  });

  const billsByMonth = new Map<string, Bill[]>();
  for (const bill of dataset.bills) {
    const month = /^\d{4}-\d{2}/.test(bill.localDate) ? bill.localDate.slice(0, 7) : 'unknown';
    const bucket = billsByMonth.get(month);
    if (bucket) {
      bucket.push(bill);
    } else {
      billsByMonth.set(month, [bill]);
    }
  }

  const sortedMonths = [...billsByMonth.keys()].sort();
  for (const month of sortedMonths) {
    const monthBills = sortByIdAsc(billsByMonth.get(month) ?? []);
    if (monthBills.length === 0) {
      continue;
    }
    const shardKey = `bills-${month}`;
    const fileName = `lifehub-shard-bills-${month}.json.enc`;
    const canonicalJson = JSON.stringify({
      format: 'lifehub-cloud-shard-bills-v1',
      month,
      bills: monthBills,
    });
    shards.set(shardKey, {
      key: shardKey,
      fileName,
      contentHash: computeShardContentHash(canonicalJson),
      itemCount: monthBills.length,
      canonicalJson,
    });
  }

  return shards;
}

/**
 * 将单个分片或清单明文 JSON 压缩并加密封装为标准 `StoredCloudSnapshot` 文本。
 */
function sealEncryptedCloudObject(
  plainJson: string,
  secret: string,
  meta: CloudSyncRecord,
  enableCompression = true,
): { serialized: string; sizeBytes: number } {
  const payloadToEncrypt = enableCompression
    ? new TextDecoder().decode(new TextEncoder().encode(compressBackupJson(plainJson)))
    : plainJson;
  const salt = `lh-salt-${meta.syncedAt}-${meta.objectKey.slice(-16)}`;
  const ciphertextBase64 = encodeEncryptedPayload(payloadToEncrypt, secret, salt);
  const authTag = computePasswordAuthTag(secret, salt, payloadToEncrypt);
  const snapshot: StoredCloudSnapshot = {
    meta: {
      ...meta,
      payloadPreview: `${enableCompression ? 'LZ77压缩+' : ''}流加密载荷 (${ciphertextBase64.slice(0, 24)}...)`,
    },
    ciphertextBase64,
    salt,
    authTag,
    ...(enableCompression ? { compression: 'lh-lz1' as const } : {}),
  };
  const serialized = JSON.stringify(snapshot);
  const sizeBytes = new TextEncoder().encode(serialized).length;
  snapshot.meta.sizeBytes = sizeBytes;
  return { serialized: JSON.stringify(snapshot), sizeBytes };
}

/**
 * 解密单个远端分片或清单快照，返回还原后的明文 JSON 字符串。
 */
function unsealEncryptedCloudObject(snapshot: StoredCloudSnapshot, secret: string): string {
  const normalizedSecret = secret.trim();
  if (!normalizedSecret) {
    throw new LifeHubError(
      'LIFEHUB_E_VALIDATION',
      '登录密码错误，无法解密还原云端数据（请先填写加密密码）',
    );
  }
  const { plainText, salvagedLegacySurrogate } = decodeEncryptedPayload(
    snapshot.ciphertextBase64,
    normalizedSecret,
    snapshot.salt ?? '',
    snapshot.authTag ?? '',
    snapshot.meta?.passwordFingerprint,
  );
  const rawDecompressed =
    snapshot.compression === 'lh-lz1' ? decompressBackupJson(plainText) : plainText;
  return salvagedLegacySurrogate ? cleanBrokenSurrogates(rawDecompressed) : rawDecompressed;
}

/**
 * 从已解密的分片 JSON 映射表组装完整 `CloudFullDataset`。
 */
function assembleDatasetFromShardJsons(shardJsonByKey: ReadonlyMap<string, string>): CloudFullDataset {
  const bills: Bill[] = [];
  let categories: Category[] = [];
  let scheduleSlots: StoredScheduleSlot[] = [];
  let completionEvents: CompletionEvent[] = [];
  let habits: StoredHabit[] = [];
  let habitCheckIns: StoredHabitCheckIn[] = [];
  let diaryEntries: DecryptedDiaryEntry[] = [];
  let tombstones: DeletedEntityTombstone[] = [];

  for (const [key, rawJson] of shardJsonByKey.entries()) {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    if (key === 'core' || parsed.format === 'lifehub-cloud-shard-core-v1') {
      categories = Array.isArray(parsed.categories) ? (parsed.categories as Category[]) : [];
      scheduleSlots = Array.isArray(parsed.scheduleSlots)
        ? (parsed.scheduleSlots as StoredScheduleSlot[])
        : [];
      completionEvents = Array.isArray(parsed.completionEvents)
        ? (parsed.completionEvents as CompletionEvent[])
        : [];
      habits = Array.isArray(parsed.habits) ? (parsed.habits as StoredHabit[]) : [];
      habitCheckIns = Array.isArray(parsed.habitCheckIns)
        ? (parsed.habitCheckIns as StoredHabitCheckIn[])
        : [];
      diaryEntries = Array.isArray(parsed.diaryEntries)
        ? (parsed.diaryEntries as DecryptedDiaryEntry[])
        : [];
      tombstones = Array.isArray(parsed.tombstones)
        ? normalizeCloudTombstones(parsed.tombstones as DeletedEntityTombstone[])
        : [];
    } else if (key.startsWith('bills-') || parsed.format === 'lifehub-cloud-shard-bills-v1') {
      if (Array.isArray(parsed.bills)) {
        for (const b of parsed.bills as Bill[]) {
          bills.push(b);
        }
      }
    }
  }

  bills.sort((a, b) => (a.occurredAt > b.occurredAt ? -1 : a.occurredAt < b.occurredAt ? 1 : 0));
  return {
    bills,
    categories,
    scheduleSlots,
    completionEvents,
    habits,
    habitCheckIns,
    diaryEntries,
    tombstones,
  };
}

/** 本机持久化的最近一次已同步分片清单索引键名（仅约 1KB，用于跨重启秒判无变动分片）。 */
export const CLOUD_SYNCED_SHARDS_INDEX_KEY = 'lifehub.cloudStorage.syncedShards:v1';

interface PersistedSyncedShardsState {
  bucketNamespace: string;
  passwordFingerprint: string;
  revision: number;
  syncedAt: string;
  billCount: number;
  shards: Record<string, CloudShardDescriptor>;
}

function loadSyncedShardsState(
  bucketNamespace: string,
  passwordFingerprint: string,
): PersistedSyncedShardsState | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }
    const raw = window.localStorage.getItem(CLOUD_SYNCED_SHARDS_INDEX_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as PersistedSyncedShardsState;
    if (
      !parsed ||
      parsed.bucketNamespace !== bucketNamespace ||
      parsed.passwordFingerprint !== passwordFingerprint ||
      !parsed.shards ||
      typeof parsed.shards !== 'object'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveSyncedShardsState(state: PersistedSyncedShardsState): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(CLOUD_SYNCED_SHARDS_INDEX_KEY, JSON.stringify(state));
    }
  } catch {
    // 忽略配额异常
  }
}

/** 仅将轻量同步摘要记录写入本地快照缓存（跳过万级账单 6MB 全量重编码，消除同步尾延迟）。 */
function writeLightweightRecordCache(
  config: CloudStorageConfig,
  secret: string,
  meta: CloudSyncRecord,
): CloudSyncRecord {
  const normalizedSecret = secret.trim();
  const rememberPassword = config.rememberPassword !== false;
  saveCloudConfig({
    ...config,
    encryptUpload: true,
    rememberPassword,
    savedPassword: rememberPassword ? normalizedSecret : '',
  });
  const existingRaw = readSnapshotCache();
  if (existingRaw) {
    try {
      const existingSnap = JSON.parse(existingRaw) as StoredCloudSnapshot;
      if (existingSnap && existingSnap.ciphertextBase64) {
        existingSnap.meta = meta;
        writeSnapshotCache(JSON.stringify(existingSnap));
        return meta;
      }
    } catch {
      // 继续写入最小合法占位快照
    }
  }
  const minimalJson = JSON.stringify({
    format: 'lifehub-cloud-backup-v1',
    encrypted: true,
    revision: meta.revision ?? 1,
    syncedAt: meta.syncedAt,
    billCount: meta.billCount,
    bills: [],
  });
  const sealed = sealEncryptedCloudObject(minimalJson, normalizedSecret, meta, false);
  const parsed = JSON.parse(sealed.serialized) as StoredCloudSnapshot;
  if (typeof meta.sizeBytes === 'number') {
    parsed.meta.sizeBytes = meta.sizeBytes;
  }
  writeSnapshotCache(JSON.stringify(parsed));
  return parsed.meta;
}

/**
 * 将合并或拉取后的完整数据集快速写入本机快照缓存（超 500 条账单的远程同步走轻量元信息更新，避免 6MB 全量编码阻塞主线程）。
 */
function writeLocalDatasetSnapshotCache(
  config: CloudStorageConfig,
  dataset: CloudFullDataset,
  secret: string,
  revision: number,
  syncedAt: string,
  totalRemoteSizeBytes?: number,
): CloudSyncRecord {
  const resolved = resolveCloudEndpointTarget(config);
  const preset = getCloudProviderPreset(resolved.effectiveProvider);
  const normalizedSecret = secret.trim();
  const currentFingerprint = computePasswordFingerprint(normalizedSecret);
  const rememberPassword = config.rememberPassword !== false;
  saveCloudConfig({
    ...config,
    encryptUpload: true,
    rememberPassword,
    savedPassword: rememberPassword ? normalizedSecret : '',
  });

  const baseMeta: CloudSyncRecord = {
    provider: resolved.effectiveProvider,
    providerName: preset.name,
    endpoint: config.endpoint.trim(),
    bucket: resolved.bucketName,
    encrypted: true,
    billCount: dataset.bills.length,
    categoryCount: dataset.categories.length,
    scheduleCount: dataset.scheduleSlots.length,
    habitCount: dataset.habits.length,
    diaryCount: dataset.diaryEntries.length,
    syncedAt,
    objectKey: resolved.objectKey,
    payloadPreview: '分片增量加密快照',
    passwordFingerprint: currentFingerprint,
    revision,
    ...(typeof totalRemoteSizeBytes === 'number' && totalRemoteSizeBytes > 0
      ? { sizeBytes: totalRemoteSizeBytes }
      : {}),
  };

  if (dataset.bills.length > 500) {
    return writeLightweightRecordCache(config, normalizedSecret, baseMeta);
  }

  const compactSourceJson = JSON.stringify({
    format: 'lifehub-cloud-backup-v1',
    encrypted: true,
    revision,
    syncedAt,
    billCount: dataset.bills.length,
    categoryCount: dataset.categories.length,
    scheduleCount: dataset.scheduleSlots.length,
    habitCount: dataset.habits.length,
    diaryCount: dataset.diaryEntries.length,
    bills: dataset.bills,
    ...(dataset.categories.length > 0 ? { categories: dataset.categories } : {}),
    ...(dataset.scheduleSlots.length > 0 ? { scheduleSlots: dataset.scheduleSlots } : {}),
    ...(dataset.completionEvents.length > 0 ? { completionEvents: dataset.completionEvents } : {}),
    ...(dataset.habits.length > 0 ? { habits: dataset.habits } : {}),
    ...(dataset.habitCheckIns.length > 0 ? { habitCheckIns: dataset.habitCheckIns } : {}),
    ...(dataset.diaryEntries.length > 0 ? { diaryEntries: dataset.diaryEntries } : {}),
    ...(dataset.tombstones.length > 0 ? { tombstones: dataset.tombstones } : {}),
  });

  const shouldCompressLocal = dataset.bills.length <= 300;
  const sealed = sealEncryptedCloudObject(
    compactSourceJson,
    normalizedSecret,
    baseMeta,
    shouldCompressLocal,
  );
  const parsedSnap = JSON.parse(sealed.serialized) as StoredCloudSnapshot;
  if (typeof totalRemoteSizeBytes === 'number' && totalRemoteSizeBytes > 0) {
    parsedSnap.meta.sizeBytes = totalRemoteSizeBytes;
  }
  writeSnapshotCache(JSON.stringify(parsedSnap));
  return parsedSnap.meta;
}

/**
 * 拉取远端指定对象文件并解析为 `StoredCloudSnapshot`（区分「对象不存在 404」与「网络/鉴权/桶不存在异常」）。
 */
async function fetchRemoteObjectSnapshot(
  config: CloudStorageConfig,
  fileName: string,
): Promise<{
  exists: boolean;
  snapshot?: StoredCloudSnapshot;
  rawBody?: string;
  correctedEndpoint?: string;
}> {
  const signed = await buildSignedCloudHttpRequest(config, 'GET', fileName);
  let result = await executeCloudHttpRequest(signed.url, 'GET', signed.headers);
  let correctedEndpoint: string | undefined;

  if (result.status >= 300) {
    const errInfo = parseCloudXmlError(result.body);
    if (errInfo.recommendedEndpoint) {
      correctedEndpoint = buildCorrectedBucketEndpointUrl(
        errInfo.recommendedEndpoint,
        signed.bucketName,
      );
      const retrySigned = await buildSignedCloudHttpRequest(
        config,
        'GET',
        fileName,
        correctedEndpoint,
      );
      result = await executeCloudHttpRequest(retrySigned.url, 'GET', retrySigned.headers);
      if ((result.status >= 200 && result.status < 300) || result.status === 404) {
        saveCloudConfig({ ...config, endpoint: correctedEndpoint });
      }
    }
  }

  if (result.status >= 200 && result.status < 300) {
    const trimmed = result.body.trim();
    if (!trimmed.startsWith('{')) {
      throw new LifeHubError('LIFEHUB_E_STORAGE', '远端备份文件格式异常，非有效的加密快照 JSON');
    }
    const parsed = JSON.parse(trimmed) as StoredCloudSnapshot;
    if (!parsed || !parsed.meta || !parsed.ciphertextBase64) {
      throw new LifeHubError('LIFEHUB_E_STORAGE', '远端备份快照结构缺失必要字段');
    }
    return {
      exists: true,
      snapshot: parsed,
      rawBody: trimmed,
      ...(correctedEndpoint ? { correctedEndpoint } : {}),
    };
  }

  if (result.status === 404) {
    const errInfo = parseCloudXmlError(result.body);
    if (errInfo.code === 'NoSuchBucket') {
      throw new LifeHubError(
        'LIFEHUB_E_STORAGE',
        `存储桶「${signed.bucketName}」不存在（NoSuchBucket），请核对连接地址中的 Bucket 名称与所属地域`,
      );
    }
    return {
      exists: false,
      ...(correctedEndpoint ? { correctedEndpoint } : {}),
    };
  }

  const errInfo = parseCloudXmlError(result.body);
  const detail = errInfo.code
    ? `${errInfo.code}: ${errInfo.message ?? ''}`
    : result.body.slice(0, 180) || `HTTP ${result.status}`;
  throw new LifeHubError(
    'LIFEHUB_E_STORAGE',
    `访问远程云存储失败（HTTP ${result.status} · ${detail}）`,
  );
}

/**
 * 将单个序列化加密对象通过 HTTP PUT 写入远端指定 `fileName`。
 */
async function putRemoteObjectSnapshot(
  config: CloudStorageConfig,
  fileName: string,
  serializedBody: string,
  skipWebdavMkcol = false,
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

  const signed = await buildSignedCloudHttpRequest(config, 'PUT', fileName);
  if (!skipWebdavMkcol && signed.effectiveProvider === 'jianguoyun-webdav' && signed.webdavDirUrl) {
    try {
      await executeCloudHttpRequest(signed.webdavDirUrl, 'MKCOL', signed.headers);
    } catch {
      // 目录已存在或服务端不支持 MKCOL 时忽略
    }
  }

  let result = await executeCloudHttpRequest(signed.url, 'PUT', signed.headers, serializedBody);
  let correctedEndpoint: string | undefined;

  if (result.status >= 300) {
    const errInfo = parseCloudXmlError(result.body);
    if (errInfo.recommendedEndpoint) {
      correctedEndpoint = buildCorrectedBucketEndpointUrl(
        errInfo.recommendedEndpoint,
        signed.bucketName,
      );
      const retrySigned = await buildSignedCloudHttpRequest(
        config,
        'PUT',
        fileName,
        correctedEndpoint,
      );
      result = await executeCloudHttpRequest(
        retrySigned.url,
        'PUT',
        retrySigned.headers,
        serializedBody,
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
    const detail = errInfo.code
      ? `${errInfo.code}: ${errInfo.message ?? ''}`
      : result.body.slice(0, 180) || `HTTP ${result.status}`;
    throw new LifeHubError(
      'LIFEHUB_E_STORAGE',
      `远程对象存储拒绝了上传请求（HTTP ${result.status} · ${detail}）`,
    );
  }

  return {
    remoteUrl: signed.url.split('?')[0] ?? signed.url,
    ...(correctedEndpoint ? { correctedEndpoint } : {}),
  };
}

/**
 * 按分片清单增量拉取远端数据集：本机已有相同 `contentHash` 的分片直接复用，仅网络下载有变动的分片。
 */
async function resolveShardedRemoteDataset(
  config: CloudStorageConfig,
  manifest: CloudShardManifestPayload,
  secret: string,
  localShards?: ReadonlyMap<string, ComputedCloudShard>,
): Promise<{ dataset: CloudFullDataset; downloadedShardCount: number }> {
  const resolvedTarget = resolveCloudEndpointTarget(config, CLOUD_SYNC_MANIFEST_FILE);
  const bucketNamespace = `${resolvedTarget.host}/${resolvedTarget.bucketName}`;
  const passwordFp = computePasswordFingerprint(secret);
  const shardJsonByKey = new Map<string, string>();
  const toDownload: CloudShardDescriptor[] = [];

  for (const [shardKey, desc] of Object.entries(manifest.shards ?? {})) {
    const localMatch = localShards?.get(shardKey);
    if (localMatch && localMatch.contentHash === desc.contentHash) {
      // 本机内存分片内容哈希与云端完全一致：零下载、零解密直接复用
      shardJsonByKey.set(shardKey, localMatch.canonicalJson);
      putVerifiedShardPlain(
        bucketNamespace,
        passwordFp,
        shardKey,
        desc.contentHash,
        localMatch.canonicalJson,
      );
      continue;
    }
    const cachedPlain = getVerifiedShardPlain(
      bucketNamespace,
      passwordFp,
      shardKey,
      desc.contentHash,
    );
    if (cachedPlain !== undefined) {
      shardJsonByKey.set(shardKey, cachedPlain);
      continue;
    }
    toDownload.push(desc);
  }

  const DOWNLOAD_CONCURRENCY = 4;
  for (let i = 0; i < toDownload.length; i += DOWNLOAD_CONCURRENCY) {
    const batch = toDownload.slice(i, i + DOWNLOAD_CONCURRENCY);
    const fetched = await Promise.all(
      batch.map(async (desc) => {
        const res = await fetchRemoteObjectSnapshot(config, desc.fileName);
        if (!res.exists || !res.snapshot) {
          throw new LifeHubError(
            'LIFEHUB_E_STORAGE',
            `云端分片文件缺失（${desc.fileName}），请重新完整上传一次云端备份`,
          );
        }
        const plainJson = unsealEncryptedCloudObject(res.snapshot, secret);
        putVerifiedShardPlain(bucketNamespace, passwordFp, desc.key, desc.contentHash, plainJson);
        return { key: desc.key, plainJson };
      }),
    );
    for (const item of fetched) {
      shardJsonByKey.set(item.key, item.plainJson);
    }
  }

  return {
    dataset: assembleDatasetFromShardJsons(shardJsonByKey),
    downloadedShardCount: toDownload.length,
  };
}

/**
 * 发起真实网络请求探测云存储连通性与密钥鉴权（优先检查约 1KB 的分片清单，向后兼容旧版单文件备份）。
 */
export async function probeRemoteCloudConnection(config: CloudStorageConfig): Promise<{
  ok: boolean;
  message: string;
  correctedEndpoint?: string;
  remoteRecord?: CloudSyncRecord;
}> {
  const localCheck = testCloudConnection(config);
  if (!localCheck.ok) {
    return localCheck;
  }
  const hasCredentials =
    config.accessKey.trim().length > 0 && config.secretKey.trim().length > 0;
  if (!hasCredentials) {
    return localCheck;
  }

  try {
    const resolved = resolveCloudEndpointTarget(config);
    const preset = getCloudProviderPreset(resolved.effectiveProvider);
    const manifestRemote = await fetchRemoteObjectSnapshot(config, CLOUD_SYNC_MANIFEST_FILE);
    const effectiveCfg = manifestRemote.correctedEndpoint
      ? { ...config, endpoint: manifestRemote.correctedEndpoint }
      : config;

    if (manifestRemote.exists && manifestRemote.snapshot) {
      const rev = manifestRemote.snapshot.meta.revision ?? 1;
      return {
        ok: true,
        message: `已成功连接「${preset.name}」并通过密钥鉴权校验（存储桶：${resolved.bucketName} · 云端已有分片备份 v${rev}，含 ${manifestRemote.snapshot.meta.billCount} 条账单）`,
        remoteRecord: manifestRemote.snapshot.meta,
        ...(manifestRemote.correctedEndpoint
          ? { correctedEndpoint: manifestRemote.correctedEndpoint }
          : {}),
      };
    }

    const legacyRemote = await fetchRemoteObjectSnapshot(effectiveCfg, LEGACY_CLOUD_BACKUP_FILE);
    const finalCorrected = legacyRemote.correctedEndpoint ?? manifestRemote.correctedEndpoint;
    if (legacyRemote.exists && legacyRemote.snapshot) {
      const rev = legacyRemote.snapshot.meta.revision ?? 1;
      return {
        ok: true,
        message: `已成功连接「${preset.name}」并通过密钥鉴权校验（存储桶：${resolved.bucketName} · 云端已有备份 v${rev}，含 ${legacyRemote.snapshot.meta.billCount} 条账单）`,
        remoteRecord: legacyRemote.snapshot.meta,
        ...(finalCorrected ? { correctedEndpoint: finalCorrected } : {}),
      };
    }

    return {
      ok: true,
      message: `已成功连接「${preset.name}」并通过密钥鉴权校验（存储桶：${resolved.bucketName} 可达，云端暂未上传过备份文件）`,
      ...(finalCorrected ? { correctedEndpoint: finalCorrected } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? `连接失败：${err.message}` : '连接失败：远程对象存储不可达',
    };
  }
}

/**
 * 将本地已生成的加密备份快照真正通过 HTTP PUT 上传至远程存储桶（单文件兼容入口）。
 */
export async function pushSnapshotToRemoteCloud(
  config: CloudStorageConfig,
): Promise<{
  remoteUrl: string;
  correctedEndpoint?: string;
}> {
  const rawSnapshot = readSnapshotCache();
  if (!rawSnapshot) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '本地尚无待上传的加密备份快照');
  }
  return putRemoteObjectSnapshot(config, LEGACY_CLOUD_BACKUP_FILE, rawSnapshot);
}

/**
 * 分片按哈希增量同步上传（Incremental Sharded Pull-Merge-Diff-Push）：
 * 1. 先拉取轻量加密清单 `lifehub-sync-manifest.json.enc`（若尚不存在则兼容拉取旧版 `lifehub-backup.json.enc` 并平滑升级）；
 * 2. 对比每个分片（核心模块 + 按月账单 `YYYY-MM`）的内容哈希，仅下载哈希有变动的远端分片参与合并；
 * 3. 合并后再次对比分片内容哈希：
 *    - 若所有分片哈希与云端完全一致，则 **跳过全部上传（0 次 PUT）**；
 *    - 若仅部分月份/模块有变动，则 **仅压缩加密并重传变动的分片 + 清单**，历史未改动月份分片原封不动。
 */
export async function syncUploadWithRemoteMerge(
  config: CloudStorageConfig,
  localDataset: CloudFullDataset,
  password: string,
  options?: UploadCloudOptions,
): Promise<{
  record: CloudSyncRecord;
  remoteUrl: string;
  correctedEndpoint?: string;
  mergedDataset: CloudFullDataset;
  purged: PurgedEntityIds;
  mergedFromRemote: boolean;
  uploadedShardCount: number;
  totalShardCount: number;
  downloadedShardCount: number;
  skippedUnchangedUpload: boolean;
}> {
  const normalizedSecret = (password || config.savedPassword || '').trim();
  if (!normalizedSecret) {
    throw new LifeHubError(
      'LIFEHUB_E_VALIDATION',
      '请填写登录密码（加密凭证）：加密密码为必填项，不能为空',
    );
  }

  const currentFp = computePasswordFingerprint(normalizedSecret);
  const localPrevRecord = loadLatestCloudSyncRecord();
  const localRevision = localPrevRecord?.revision ?? 0;

  const normalizedLocal: CloudFullDataset = {
    ...localDataset,
    tombstones: normalizeCloudTombstones(localDataset.tombstones),
  };
  const localShards = partitionDatasetIntoShards(normalizedLocal);

  // 第一步：优先拉取远端分片清单（~1KB），若无清单则回退检查旧版单文件快照
  const manifestStatus = await fetchRemoteObjectSnapshot(config, CLOUD_SYNC_MANIFEST_FILE);
  let effectiveConfig = manifestStatus.correctedEndpoint
    ? { ...config, endpoint: manifestStatus.correctedEndpoint }
    : config;
  let initialCorrectedEndpoint = manifestStatus.correctedEndpoint;

  let finalDataset: CloudFullDataset = normalizedLocal;
  let purged: PurgedEntityIds = {
    billIds: [],
    categoryIds: [],
    scheduleSlotIds: [],
    completionEventIds: [],
    habitIds: [],
    habitCheckInIds: [],
    diaryEntryIds: [],
  };
  let mergedFromRemote = false;
  let nextRevision = localRevision + 1;
  let remoteManifest: CloudShardManifestPayload | null = null;
  let remoteManifestMeta: CloudSyncRecord | null = null;
  let passwordChanged = false;
  let downloadedShardCount = 0;

  if (manifestStatus.exists && manifestStatus.snapshot) {
    const remoteSnap = manifestStatus.snapshot;
    remoteManifestMeta = remoteSnap.meta;
    const remoteRev = remoteSnap.meta.revision ?? 1;
    const remoteFp = remoteSnap.meta.passwordFingerprint;

    if (remoteFp && remoteFp !== currentFp && !options?.allowPasswordChange) {
      throw new LifeHubError(
        'LIFEHUB_E_VALIDATION',
        '云端已有备份且加密密码与当前输入不一致！为防止覆盖另一端数据，请输入正确的云端备份密码以合并数据，或勾选「允许用新密码覆盖云端备份」。',
      );
    }

    if (!remoteFp || remoteFp === currentFp) {
      try {
        const manifestJson = unsealEncryptedCloudObject(remoteSnap, normalizedSecret);
        const parsedManifest = JSON.parse(manifestJson) as CloudShardManifestPayload;
        if (parsedManifest && parsedManifest.schema === 'lifehub-sharded-v1') {
          remoteManifest = parsedManifest;
          const resolvedRemote = await resolveShardedRemoteDataset(
            effectiveConfig,
            parsedManifest,
            normalizedSecret,
            localShards,
          );
          downloadedShardCount = resolvedRemote.downloadedShardCount;
          const mergeRes = mergeCloudDatasets(
            normalizedLocal,
            resolvedRemote.dataset,
            localRevision,
            remoteRev,
          );
          finalDataset = mergeRes.merged;
          purged = mergeRes.purged;
          mergedFromRemote = true;
          nextRevision = mergeRes.nextRevision;
        }
      } catch (err) {
        if (!remoteFp && options?.allowPasswordChange) {
          passwordChanged = true;
          nextRevision = Math.max(localRevision, remoteRev) + 1;
        } else {
          throw err;
        }
      }
    } else {
      passwordChanged = true;
      nextRevision = Math.max(localRevision, remoteRev) + 1;
    }
  } else {
    // 远端尚无分片清单：向后兼容检查旧版单文件 `lifehub-backup.json.enc`
    const legacyStatus = await fetchRemoteObjectSnapshot(effectiveConfig, LEGACY_CLOUD_BACKUP_FILE);
    if (legacyStatus.correctedEndpoint) {
      effectiveConfig = { ...effectiveConfig, endpoint: legacyStatus.correctedEndpoint };
      initialCorrectedEndpoint = legacyStatus.correctedEndpoint;
    }
    if (legacyStatus.exists && legacyStatus.snapshot) {
      const remoteSnap = legacyStatus.snapshot;
      const remoteRev = remoteSnap.meta.revision ?? 1;
      const remoteFp = remoteSnap.meta.passwordFingerprint;

      if (remoteFp && remoteFp !== currentFp && !options?.allowPasswordChange) {
        if (legacyStatus.rawBody) {
          writeSnapshotCache(legacyStatus.rawBody);
        }
        throw new LifeHubError(
          'LIFEHUB_E_VALIDATION',
          '云端已有备份且加密密码与当前输入不一致！为防止覆盖另一端数据，请输入正确的云端备份密码以合并数据，或勾选「允许用新密码覆盖云端备份」。',
        );
      }

      if (!remoteFp || remoteFp === currentFp) {
        try {
          const { dataset: remoteDataset } = decryptSnapshotToDataset(remoteSnap, normalizedSecret);
          downloadedShardCount = 1;
          const mergeRes = mergeCloudDatasets(
            normalizedLocal,
            remoteDataset,
            localRevision,
            remoteRev,
          );
          finalDataset = mergeRes.merged;
          purged = mergeRes.purged;
          mergedFromRemote = true;
          nextRevision = mergeRes.nextRevision;
        } catch (err) {
          if (!remoteFp && options?.allowPasswordChange) {
            passwordChanged = true;
            nextRevision = Math.max(localRevision, remoteRev) + 1;
          } else {
            throw err;
          }
        }
      } else {
        passwordChanged = true;
        nextRevision = Math.max(localRevision, remoteRev) + 1;
      }
    }
  }

  // 第二步：切分合并后的最终数据集，并与远端分片清单逐一比对内容哈希
  saveLocalCloudTombstones(finalDataset.tombstones);
  const mergedShards = partitionDatasetIntoShards(finalDataset);
  const resolvedManifestTarget = resolveCloudEndpointTarget(
    effectiveConfig,
    CLOUD_SYNC_MANIFEST_FILE,
  );
  const preset = getCloudProviderPreset(resolvedManifestTarget.effectiveProvider);
  const bucketNamespace = `${resolvedManifestTarget.host}/${resolvedManifestTarget.bucketName}`;

  const canDiffAgainstRemote = Boolean(remoteManifest) && !passwordChanged;
  const shardsToUpload: ComputedCloudShard[] = [];
  for (const shard of mergedShards.values()) {
    const remoteDesc = canDiffAgainstRemote ? remoteManifest?.shards[shard.key] : undefined;
    if (!remoteDesc || remoteDesc.contentHash !== shard.contentHash) {
      shardsToUpload.push(shard);
    }
  }
  const removedShardKeys = canDiffAgainstRemote
    ? Object.keys(remoteManifest?.shards ?? {}).filter((k) => !mergedShards.has(k))
    : [];

  // 快速短路：所有分片哈希均未变化且无删除分片 -> 0 次 PUT 网络请求！
  if (canDiffAgainstRemote && shardsToUpload.length === 0 && removedShardKeys.length === 0) {
    const unchangedRev = remoteManifest?.revision ?? remoteManifestMeta?.revision ?? localRevision;
    const unchangedSyncedAt =
      remoteManifest?.syncedAt ?? remoteManifestMeta?.syncedAt ?? new Date().toISOString();
    const totalExistingBytes = Object.values(remoteManifest?.shards ?? {}).reduce(
      (acc, d) => acc + (d.sizeBytes ?? 0),
      remoteManifestMeta?.sizeBytes ?? 0,
    );
    const localRecord = writeLocalDatasetSnapshotCache(
      effectiveConfig,
      finalDataset,
      normalizedSecret,
      unchangedRev,
      unchangedSyncedAt,
      totalExistingBytes,
    );
    for (const shard of mergedShards.values()) {
      putVerifiedShardPlain(
        bucketNamespace,
        currentFp,
        shard.key,
        shard.contentHash,
        shard.canonicalJson,
      );
    }
    return {
      record: localRecord,
      remoteUrl: resolvedManifestTarget.objectUrl,
      ...(initialCorrectedEndpoint ? { correctedEndpoint: initialCorrectedEndpoint } : {}),
      mergedDataset: finalDataset,
      purged,
      mergedFromRemote,
      uploadedShardCount: 0,
      totalShardCount: mergedShards.size,
      downloadedShardCount,
      skippedUnchangedUpload: true,
    };
  }

  // 第三步：仅压缩加密并上传有变动的分片（未变动的历史月份分片直接复用远端描述符，不重传）
  const syncedAt = new Date().toISOString();
  if (
    resolvedManifestTarget.effectiveProvider === 'jianguoyun-webdav' &&
    resolvedManifestTarget.webdavDirUrl
  ) {
    try {
      const signedDir = await buildSignedCloudHttpRequest(
        effectiveConfig,
        'PUT',
        CLOUD_SYNC_MANIFEST_FILE,
      );
      if (signedDir.webdavDirUrl) {
        await executeCloudHttpRequest(signedDir.webdavDirUrl, 'MKCOL', signedDir.headers);
      }
    } catch {
      // 忽略目录已存在
    }
  }

  const uploadedSizeByKey = new Map<string, number>();
  let latestCorrectedEndpoint = initialCorrectedEndpoint;
  const UPLOAD_CONCURRENCY = 4;

  for (let i = 0; i < shardsToUpload.length; i += UPLOAD_CONCURRENCY) {
    const batch = shardsToUpload.slice(i, i + UPLOAD_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (shard) => {
        const shardTarget = resolveCloudEndpointTarget(effectiveConfig, shard.fileName);
        const shardMeta: CloudSyncRecord = {
          provider: shardTarget.effectiveProvider,
          providerName: preset.name,
          endpoint: effectiveConfig.endpoint.trim(),
          bucket: shardTarget.bucketName,
          encrypted: true,
          billCount: shard.key.startsWith('bills-') ? shard.itemCount : 0,
          syncedAt,
          objectKey: shardTarget.objectKey,
          payloadPreview: '',
          passwordFingerprint: currentFp,
          revision: nextRevision,
        };
        const sealed = sealEncryptedCloudObject(
          shard.canonicalJson,
          normalizedSecret,
          shardMeta,
          true,
        );
        const putRes = await putRemoteObjectSnapshot(
          effectiveConfig,
          shard.fileName,
          sealed.serialized,
          true,
        );
        putVerifiedShardPlain(
          bucketNamespace,
          currentFp,
          shard.key,
          shard.contentHash,
          shard.canonicalJson,
        );
        return { key: shard.key, sizeBytes: sealed.sizeBytes, corrected: putRes.correctedEndpoint };
      }),
    );
    for (const r of results) {
      uploadedSizeByKey.set(r.key, r.sizeBytes);
      if (r.corrected) {
        latestCorrectedEndpoint = r.corrected;
        effectiveConfig = { ...effectiveConfig, endpoint: r.corrected };
      }
    }
  }

  // 第四步：构建最新分片清单并原子提交写入 `lifehub-sync-manifest.json.enc`
  const nextShardDescriptors: Record<string, CloudShardDescriptor> = {};
  let totalShardsBytes = 0;
  for (const shard of mergedShards.values()) {
    const sizeBytes =
      uploadedSizeByKey.get(shard.key) ?? remoteManifest?.shards[shard.key]?.sizeBytes;
    if (typeof sizeBytes === 'number') {
      totalShardsBytes += sizeBytes;
    }
    nextShardDescriptors[shard.key] = {
      key: shard.key,
      fileName: shard.fileName,
      contentHash: shard.contentHash,
      itemCount: shard.itemCount,
      ...(typeof sizeBytes === 'number' ? { sizeBytes } : {}),
    };
    putVerifiedShardPlain(
      bucketNamespace,
      currentFp,
      shard.key,
      shard.contentHash,
      shard.canonicalJson,
    );
  }

  const manifestPayload: CloudShardManifestPayload = {
    schema: 'lifehub-sharded-v1',
    revision: nextRevision,
    syncedAt,
    billCount: finalDataset.bills.length,
    categoryCount: finalDataset.categories.length,
    scheduleCount: finalDataset.scheduleSlots.length,
    habitCount: finalDataset.habits.length,
    diaryCount: finalDataset.diaryEntries.length,
    shards: nextShardDescriptors,
  };

  const manifestMeta: CloudSyncRecord = {
    provider: resolvedManifestTarget.effectiveProvider,
    providerName: preset.name,
    endpoint: effectiveConfig.endpoint.trim(),
    bucket: resolvedManifestTarget.bucketName,
    encrypted: true,
    billCount: finalDataset.bills.length,
    categoryCount: finalDataset.categories.length,
    scheduleCount: finalDataset.scheduleSlots.length,
    habitCount: finalDataset.habits.length,
    diaryCount: finalDataset.diaryEntries.length,
    syncedAt,
    objectKey: resolvedManifestTarget.objectKey,
    payloadPreview: '',
    passwordFingerprint: currentFp,
    revision: nextRevision,
  };

  const sealedManifest = sealEncryptedCloudObject(
    JSON.stringify(manifestPayload),
    normalizedSecret,
    manifestMeta,
    true,
  );
  const manifestPutRes = await putRemoteObjectSnapshot(
    effectiveConfig,
    CLOUD_SYNC_MANIFEST_FILE,
    sealedManifest.serialized,
    true,
  );
  if (manifestPutRes.correctedEndpoint) {
    latestCorrectedEndpoint = manifestPutRes.correctedEndpoint;
    effectiveConfig = { ...effectiveConfig, endpoint: manifestPutRes.correctedEndpoint };
  }

  const totalRemoteSizeBytes = totalShardsBytes + sealedManifest.sizeBytes;
  saveSyncedShardsState({
    bucketNamespace,
    passwordFingerprint: currentFp,
    revision: nextRevision,
    syncedAt,
    billCount: finalDataset.bills.length,
    shards: nextShardDescriptors,
  });
  clearCloudBillsDirtyState();
  const record = writeLocalDatasetSnapshotCache(
    effectiveConfig,
    finalDataset,
    normalizedSecret,
    nextRevision,
    syncedAt,
    totalRemoteSizeBytes,
  );

  return {
    record,
    remoteUrl: manifestPutRes.remoteUrl,
    ...(latestCorrectedEndpoint ? { correctedEndpoint: latestCorrectedEndpoint } : {}),
    mergedDataset: finalDataset,
    purged,
    mergedFromRemote,
    uploadedShardCount: shardsToUpload.length,
    totalShardCount: mergedShards.size,
    downloadedShardCount,
    skippedUnchangedUpload: false,
  };
}

/** 供按需增量云同步使用的本机账单按月/全量读取端口（避免依赖懒加载下为空的内存数组）。 */
export interface LocalBillSyncDataSource {
  /** 快速返回本机库内账单总条数（如通过 IndexedDB 复合索引键统计，< 3ms）。 */
  getLocalBillCount: () => Promise<number>;
  /** 按月份 `YYYY-MM` 读取本机该月账单（仅在局部月份有改动时按需调用）。 */
  loadMonthLocalBills?: (month: string) => Promise<Bill[]>;
  /** 读取本机全量账单（仅在首次同步或跨多月批量导入后调用）。 */
  loadAllLocalBills: () => Promise<Bill[]>;
}

function diffChangedBillsAgainstBaseline(
  mergedBills: readonly Bill[],
  baselineBills: readonly Bill[],
): Bill[] {
  const baseMap = new Map(baselineBills.map((b) => [b.id, b] as const));
  return mergedBills.filter((bill) => {
    const prev = baseMap.get(bill.id);
    if (!prev) return true;
    return (
      prev.updatedAt !== bill.updatedAt ||
      prev.version !== bill.version ||
      prev.categoryId !== bill.categoryId ||
      prev.note !== bill.note ||
      prev.counterparty !== bill.counterparty ||
      prev.amountMinor !== bill.amountMinor ||
      prev.localDate !== bill.localDate
    );
  });
}

/**
 * 面向万级懒加载账单库的极速智能增量上传：
 * 1. 先拉取 ~1KB 远端分片清单，结合本机持久化的 `syncedShards` 与 `dirtyMonths` 判定变更范围；
 * 2. 若本机与远端均无任何分片变动：**0 次本地账单解密、0 次分片下载、0 次 PUT 上传，~100ms 瞬时完成**；
 * 3. 若仅单月/少数月份发生增改：仅按月从 IndexedDB 读取改动月份账单参与分片合并与重传，未改动历史月份零读取、零重传；
 * 4. 仅返回真正由远端合并带来的新增/变更账单 `billsToPut`，杜绝将本机未变动的上万条账单重复写回 IndexedDB。
 */
export async function syncCloudUploadSmart(
  config: CloudStorageConfig,
  password: string,
  localExtra: CloudBackupExtraModules,
  billSource: LocalBillSyncDataSource,
  options?: UploadCloudOptions,
): Promise<{
  record: CloudSyncRecord;
  remoteUrl: string;
  correctedEndpoint?: string;
  billsToPut: Bill[];
  mergedCore: Omit<CloudFullDataset, 'bills'>;
  purged: PurgedEntityIds;
  mergedFromRemote: boolean;
  uploadedShardCount: number;
  totalShardCount: number;
  downloadedShardCount: number;
  skippedUnchangedUpload: boolean;
}> {
  const normalizedSecret = (password || config.savedPassword || '').trim();
  if (!normalizedSecret) {
    throw new LifeHubError(
      'LIFEHUB_E_VALIDATION',
      '请填写登录密码（加密凭证）：加密密码为必填项，不能为空',
    );
  }
  const currentFp = computePasswordFingerprint(normalizedSecret);
  const localCoreOnly: CloudFullDataset = {
    bills: [],
    categories: [...(localExtra.categories ?? [])],
    scheduleSlots: [...(localExtra.scheduleSlots ?? localExtra.scheduleEvents ?? [])],
    completionEvents: [...(localExtra.completionEvents ?? localExtra.scheduleCompletions ?? [])],
    habits: [...(localExtra.habits ?? [])],
    habitCheckIns: [...(localExtra.habitCheckIns ?? localExtra.habitCheckins ?? [])],
    diaryEntries: [...(localExtra.diaryEntries ?? [])],
    tombstones: normalizeCloudTombstones(localExtra.tombstones ?? loadLocalCloudTombstones()),
  };

  // 先探测远端清单（~1KB）与本机索引计数（~2ms）
  const [manifestStatus, localBillCount] = await Promise.all([
    fetchRemoteObjectSnapshot(config, CLOUD_SYNC_MANIFEST_FILE),
    billSource.getLocalBillCount(),
  ]);
  const effectiveConfig = manifestStatus.correctedEndpoint
    ? { ...config, endpoint: manifestStatus.correctedEndpoint }
    : config;
  const resolvedTarget = resolveCloudEndpointTarget(effectiveConfig, CLOUD_SYNC_MANIFEST_FILE);
  const preset = getCloudProviderPreset(resolvedTarget.effectiveProvider);
  const bucketNamespace = `${resolvedTarget.host}/${resolvedTarget.bucketName}`;

  const syncedState = loadSyncedShardsState(bucketNamespace, currentFp);
  const dirtyState = loadCloudBillsDirtyState();

  const loadMonthFn = billSource.loadMonthLocalBills;
  // 快速通道：远端已是分片结构 + 本机存在可信已同步分片索引 + 非全表脏态
  if (
    manifestStatus.exists &&
    manifestStatus.snapshot &&
    syncedState &&
    !dirtyState.allBillsDirty &&
    typeof loadMonthFn === 'function'
  ) {
    const remoteSnap = manifestStatus.snapshot;
    const remoteFp = remoteSnap.meta.passwordFingerprint;
    if (!remoteFp || remoteFp === currentFp) {
      const manifestJson = unsealEncryptedCloudObject(remoteSnap, normalizedSecret);
      const parsedManifest = JSON.parse(manifestJson) as CloudShardManifestPayload;
      if (parsedManifest && parsedManifest.schema === 'lifehub-sharded-v1') {
        const remoteChangedKeys = Object.keys(parsedManifest.shards ?? {}).filter(
          (k) => syncedState.shards[k]?.contentHash !== parsedManifest.shards[k]?.contentHash,
        );
        const remoteRemovedKeys = Object.keys(syncedState.shards).filter(
          (k) => !parsedManifest.shards[k],
        );
        const localCoreShard = partitionDatasetIntoShards(localCoreOnly).get('core');

        // 通道 A：本机无脏月 + 总数一致 + 远端无改动 + 核心模块哈希一致 -> 0 次解密、0 次下载、0 次上传！
        if (
          dirtyState.dirtyMonths.length === 0 &&
          localBillCount === syncedState.billCount &&
          remoteChangedKeys.length === 0 &&
          remoteRemovedKeys.length === 0 &&
          localCoreShard &&
          localCoreShard.contentHash === parsedManifest.shards['core']?.contentHash
        ) {
          const totalBytes = Object.values(parsedManifest.shards).reduce(
            (acc, d) => acc + (d.sizeBytes ?? 0),
            remoteSnap.meta.sizeBytes ?? 0,
          );
          const meta: CloudSyncRecord = {
            ...remoteSnap.meta,
            provider: resolvedTarget.effectiveProvider,
            providerName: preset.name,
            endpoint: effectiveConfig.endpoint.trim(),
            bucket: resolvedTarget.bucketName,
            billCount: parsedManifest.billCount,
            sizeBytes: totalBytes,
          };
          writeLightweightRecordCache(effectiveConfig, normalizedSecret, meta);
          return {
            record: meta,
            remoteUrl: resolvedTarget.objectUrl,
            ...(manifestStatus.correctedEndpoint
              ? { correctedEndpoint: manifestStatus.correctedEndpoint }
              : {}),
            billsToPut: [],
            mergedCore: {
              categories: localCoreOnly.categories,
              scheduleSlots: localCoreOnly.scheduleSlots,
              completionEvents: localCoreOnly.completionEvents,
              habits: localCoreOnly.habits,
              habitCheckIns: localCoreOnly.habitCheckIns,
              diaryEntries: localCoreOnly.diaryEntries,
              tombstones: localCoreOnly.tombstones,
            },
            purged: {
              billIds: [],
              categoryIds: [],
              scheduleSlotIds: [],
              completionEventIds: [],
              habitIds: [],
              habitCheckInIds: [],
              diaryEntryIds: [],
            },
            mergedFromRemote: false,
            uploadedShardCount: 0,
            totalShardCount: Object.keys(parsedManifest.shards).length,
            downloadedShardCount: 0,
            skippedUnchangedUpload: true,
          };
        }

        // 通道 B：仅局部月份发生改动（且不含未知月份），仅按月加载对应本地账单与变动的远端分片！
        const activeMonths = new Set<string>(dirtyState.dirtyMonths);
        for (const k of [...remoteChangedKeys, ...remoteRemovedKeys]) {
          if (k.startsWith('bills-')) {
            activeMonths.add(k.slice(6));
          }
        }
        if (!activeMonths.has('unknown')) {
          const monthArrays = await Promise.all(
            [...activeMonths].map((m) => loadMonthFn(m)),
          );
          const loadedLocalSliceBills = monthArrays.flat();

          // 下载远端变动的分片（及若分类可能重映射则拉取 core）
          const keysToFetch = new Set<string>(remoteChangedKeys);
          if (parsedManifest.shards['core']) {
            keysToFetch.add('core');
          }
          const fetchedShardJsons = new Map<string, string>();
          let downloadedCount = 0;
          const fetchList = [...keysToFetch]
            .map((k) => parsedManifest.shards[k])
            .filter((d): d is CloudShardDescriptor => Boolean(d));
          for (let i = 0; i < fetchList.length; i += 4) {
            const batch = fetchList.slice(i, i + 4);
            const resBatch = await Promise.all(
              batch.map(async (desc) => {
                const cached = getVerifiedShardPlain(
                  bucketNamespace,
                  currentFp,
                  desc.key,
                  desc.contentHash,
                );
                if (cached !== undefined) {
                  return { key: desc.key, plain: cached, fromNet: false };
                }
                const obj = await fetchRemoteObjectSnapshot(effectiveConfig, desc.fileName);
                if (!obj.exists || !obj.snapshot) {
                  throw new LifeHubError('LIFEHUB_E_STORAGE', `云端分片缺失：${desc.fileName}`);
                }
                const plain = unsealEncryptedCloudObject(obj.snapshot, normalizedSecret);
                putVerifiedShardPlain(bucketNamespace, currentFp, desc.key, desc.contentHash, plain);
                return { key: desc.key, plain, fromNet: true };
              }),
            );
            for (const item of resBatch) {
              fetchedShardJsons.set(item.key, item.plain);
              if (item.fromNet) downloadedCount += 1;
            }
          }

          const partialRemoteDataset = assembleDatasetFromShardJsons(fetchedShardJsons);
          const partialLocalDataset: CloudFullDataset = {
            ...localCoreOnly,
            bills: loadedLocalSliceBills,
          };
          const mergeRes = mergeCloudDatasets(
            partialLocalDataset,
            partialRemoteDataset,
            syncedState.revision,
            parsedManifest.revision ?? 1,
          );

          saveLocalCloudTombstones(mergeRes.merged.tombstones);
          const recomputedSliceShards = partitionDatasetIntoShards(mergeRes.merged);

          // 组装完整分片表：未涉及的历史月份直接继承云端已同步描述符，无需读取或重传
          const nextShardsMap = new Map<string, CloudShardDescriptor>();
          for (const [k, desc] of Object.entries(parsedManifest.shards)) {
            if (k !== 'core' && k.startsWith('bills-') && !activeMonths.has(k.slice(6))) {
              nextShardsMap.set(k, desc);
            }
          }

          const shardsToPut: ComputedCloudShard[] = [];
          const coreComputed = recomputedSliceShards.get('core');
          if (coreComputed && parsedManifest.shards['core']?.contentHash !== coreComputed.contentHash) {
            shardsToPut.push(coreComputed);
          } else if (parsedManifest.shards['core']) {
            nextShardsMap.set('core', parsedManifest.shards['core']);
          }
          for (const m of activeMonths) {
            const k = `bills-${m}`;
            const computed = recomputedSliceShards.get(k);
            const existingDesc = parsedManifest.shards[k];
            if (computed) {
              if (!existingDesc || existingDesc.contentHash !== computed.contentHash) {
                shardsToPut.push(computed);
              } else {
                nextShardsMap.set(k, existingDesc);
              }
            }
          }

          const removedOnPush = Object.keys(parsedManifest.shards).filter(
            (k) =>
              k.startsWith('bills-') &&
              activeMonths.has(k.slice(6)) &&
              !recomputedSliceShards.has(k),
          );

          const billsToPut = diffChangedBillsAgainstBaseline(
            mergeRes.merged.bills,
            loadedLocalSliceBills,
          );

          // 若合并后云端分片无任何差异，无需 PUT！
          if (shardsToPut.length === 0 && removedOnPush.length === 0) {
            const unchangedTotalCount = [...nextShardsMap.values()]
              .filter((d) => d.key.startsWith('bills-'))
              .reduce((acc, d) => acc + d.itemCount, 0);
            const finalShardsObj = Object.fromEntries(nextShardsMap.entries());
            saveSyncedShardsState({
              bucketNamespace,
              passwordFingerprint: currentFp,
              revision: parsedManifest.revision,
              syncedAt: parsedManifest.syncedAt,
              billCount: unchangedTotalCount,
              shards: finalShardsObj,
            });
            clearCloudBillsDirtyState();
            const meta: CloudSyncRecord = {
              ...remoteSnap.meta,
              billCount: unchangedTotalCount,
            };
            writeLightweightRecordCache(effectiveConfig, normalizedSecret, meta);
            return {
              record: meta,
              remoteUrl: resolvedTarget.objectUrl,
              billsToPut,
              mergedCore: {
                categories: mergeRes.merged.categories,
                scheduleSlots: mergeRes.merged.scheduleSlots,
                completionEvents: mergeRes.merged.completionEvents,
                habits: mergeRes.merged.habits,
                habitCheckIns: mergeRes.merged.habitCheckIns,
                diaryEntries: mergeRes.merged.diaryEntries,
                tombstones: mergeRes.merged.tombstones,
              },
              purged: mergeRes.purged,
              mergedFromRemote: true,
              uploadedShardCount: 0,
              totalShardCount: nextShardsMap.size,
              downloadedShardCount: downloadedCount,
              skippedUnchangedUpload: true,
            };
          }

          const syncedAt = new Date().toISOString();
          const nextRev = mergeRes.nextRevision;
          for (let i = 0; i < shardsToPut.length; i += 4) {
            const batch = shardsToPut.slice(i, i + 4);
            const putResults = await Promise.all(
              batch.map(async (shard) => {
                const st = resolveCloudEndpointTarget(effectiveConfig, shard.fileName);
                const sMeta: CloudSyncRecord = {
                  provider: st.effectiveProvider,
                  providerName: preset.name,
                  endpoint: effectiveConfig.endpoint.trim(),
                  bucket: st.bucketName,
                  encrypted: true,
                  billCount: shard.key.startsWith('bills-') ? shard.itemCount : 0,
                  syncedAt,
                  objectKey: st.objectKey,
                  payloadPreview: '',
                  passwordFingerprint: currentFp,
                  revision: nextRev,
                };
                const sealed = sealEncryptedCloudObject(
                  shard.canonicalJson,
                  normalizedSecret,
                  sMeta,
                  true,
                );
                await putRemoteObjectSnapshot(
                  effectiveConfig,
                  shard.fileName,
                  sealed.serialized,
                  true,
                );
                putVerifiedShardPlain(
                  bucketNamespace,
                  currentFp,
                  shard.key,
                  shard.contentHash,
                  shard.canonicalJson,
                );
                return {
                  key: shard.key,
                  desc: {
                    key: shard.key,
                    fileName: shard.fileName,
                    contentHash: shard.contentHash,
                    itemCount: shard.itemCount,
                    sizeBytes: sealed.sizeBytes,
                  } satisfies CloudShardDescriptor,
                };
              }),
            );
            for (const pr of putResults) {
              nextShardsMap.set(pr.key, pr.desc);
            }
          }

          const finalShardsObj = Object.fromEntries(nextShardsMap.entries());
          const newTotalBillCount = [...nextShardsMap.values()]
            .filter((d) => d.key.startsWith('bills-'))
            .reduce((acc, d) => acc + d.itemCount, 0);
          const totalShardBytes = [...nextShardsMap.values()].reduce(
            (acc, d) => acc + (d.sizeBytes ?? 0),
            0,
          );

          const nextManifestPayload: CloudShardManifestPayload = {
            schema: 'lifehub-sharded-v1',
            revision: nextRev,
            syncedAt,
            billCount: newTotalBillCount,
            categoryCount: mergeRes.merged.categories.length,
            scheduleCount: mergeRes.merged.scheduleSlots.length,
            habitCount: mergeRes.merged.habits.length,
            diaryCount: mergeRes.merged.diaryEntries.length,
            shards: finalShardsObj,
          };
          const mMeta: CloudSyncRecord = {
            provider: resolvedTarget.effectiveProvider,
            providerName: preset.name,
            endpoint: effectiveConfig.endpoint.trim(),
            bucket: resolvedTarget.bucketName,
            encrypted: true,
            billCount: newTotalBillCount,
            categoryCount: mergeRes.merged.categories.length,
            scheduleCount: mergeRes.merged.scheduleSlots.length,
            habitCount: mergeRes.merged.habits.length,
            diaryCount: mergeRes.merged.diaryEntries.length,
            syncedAt,
            objectKey: resolvedTarget.objectKey,
            payloadPreview: '',
            passwordFingerprint: currentFp,
            revision: nextRev,
          };
          const sealedManifest = sealEncryptedCloudObject(
            JSON.stringify(nextManifestPayload),
            normalizedSecret,
            mMeta,
            true,
          );
          const mPut = await putRemoteObjectSnapshot(
            effectiveConfig,
            CLOUD_SYNC_MANIFEST_FILE,
            sealedManifest.serialized,
            true,
          );
          mMeta.sizeBytes = totalShardBytes + sealedManifest.sizeBytes;

          saveSyncedShardsState({
            bucketNamespace,
            passwordFingerprint: currentFp,
            revision: nextRev,
            syncedAt,
            billCount: newTotalBillCount,
            shards: finalShardsObj,
          });
          clearCloudBillsDirtyState();
          writeLightweightRecordCache(effectiveConfig, normalizedSecret, mMeta);

          return {
            record: mMeta,
            remoteUrl: mPut.remoteUrl,
            billsToPut,
            mergedCore: {
              categories: mergeRes.merged.categories,
              scheduleSlots: mergeRes.merged.scheduleSlots,
              completionEvents: mergeRes.merged.completionEvents,
              habits: mergeRes.merged.habits,
              habitCheckIns: mergeRes.merged.habitCheckIns,
              diaryEntries: mergeRes.merged.diaryEntries,
              tombstones: mergeRes.merged.tombstones,
            },
            purged: mergeRes.purged,
            mergedFromRemote: true,
            uploadedShardCount: shardsToPut.length,
            totalShardCount: nextShardsMap.size,
            downloadedShardCount: downloadedCount,
            skippedUnchangedUpload: false,
          };
        }
      }
    }
  }

  // 完整对账通道（首次同步、迁移旧单文件或批量导入后）：从真实本地库读取全量账单，并精确过滤仅远端带来的差异账单写库
  const allLocalBills = await billSource.loadAllLocalBills();
  const fullLocalDataset: CloudFullDataset = {
    ...localCoreOnly,
    bills: allLocalBills,
  };
  const syncRes = await syncUploadWithRemoteMerge(
    effectiveConfig,
    fullLocalDataset,
    normalizedSecret,
    options,
  );
  const billsToPut = syncRes.mergedFromRemote
    ? diffChangedBillsAgainstBaseline(syncRes.mergedDataset.bills, allLocalBills)
    : [];

  // 若无改动跳过上传时也确保持久化 syncedShards 索引，使下次直接走快速通道
  if (syncRes.skippedUnchangedUpload) {
    const computedShards = partitionDatasetIntoShards(syncRes.mergedDataset);
    const descObj: Record<string, CloudShardDescriptor> = {};
    for (const [k, s] of computedShards.entries()) {
      descObj[k] = {
        key: s.key,
        fileName: s.fileName,
        contentHash: s.contentHash,
        itemCount: s.itemCount,
      };
    }
    saveSyncedShardsState({
      bucketNamespace,
      passwordFingerprint: currentFp,
      revision: syncRes.record.revision ?? 1,
      syncedAt: syncRes.record.syncedAt,
      billCount: syncRes.mergedDataset.bills.length,
      shards: descObj,
    });
    clearCloudBillsDirtyState();
  }

  return {
    record: syncRes.record,
    remoteUrl: syncRes.remoteUrl,
    ...(syncRes.correctedEndpoint
      ? { correctedEndpoint: syncRes.correctedEndpoint }
      : manifestStatus.correctedEndpoint
        ? { correctedEndpoint: manifestStatus.correctedEndpoint }
        : {}),
    billsToPut,
    mergedCore: {
      categories: syncRes.mergedDataset.categories,
      scheduleSlots: syncRes.mergedDataset.scheduleSlots,
      completionEvents: syncRes.mergedDataset.completionEvents,
      habits: syncRes.mergedDataset.habits,
      habitCheckIns: syncRes.mergedDataset.habitCheckIns,
      diaryEntries: syncRes.mergedDataset.diaryEntries,
      tombstones: syncRes.mergedDataset.tombstones,
    },
    purged: syncRes.purged,
    mergedFromRemote: syncRes.mergedFromRemote,
    uploadedShardCount: syncRes.uploadedShardCount,
    totalShardCount: syncRes.totalShardCount,
    downloadedShardCount: syncRes.downloadedShardCount,
    skippedUnchangedUpload: syncRes.skippedUnchangedUpload,
  };
}

/**
 * 面向万级懒加载账单库的极速智能增量拉取恢复：
 * 1. 先拉取 ~1KB 清单比对本机持久化 `syncedShards`：若所有分片哈希未变，**0 次分片下载、0 次本地库读写，~100ms 完成**；
 * 2. 若仅部分月份分片在另一台设备更新：仅下载变动的分片并按月读取对应本地账单合并，未变动历史月份零下载、零写库；
 * 3. 新设备首次恢复时：读取真实本地库账单去重比对，仅向 IndexedDB 写入本机缺失或版本较旧的账单。
 */
export async function syncCloudPullSmart(
  config: CloudStorageConfig,
  password: string | undefined,
  localExtra: CloudBackupExtraModules,
  billSource: LocalBillSyncDataSource,
): Promise<{
  unchanged: boolean;
  record: CloudSyncRecord;
  billsToPut: Bill[];
  mergedCore: Omit<CloudFullDataset, 'bills'>;
  purged: PurgedEntityIds;
  totalBillCount: number;
  downloadedShardCount: number;
  totalShardCount: number;
}> {
  const secret = (password ?? config.savedPassword ?? '').trim();
  if (!secret) {
    throw new LifeHubError(
      'LIFEHUB_E_VALIDATION',
      '登录密码错误，无法解密还原云端数据（请先填写加密密码）',
    );
  }
  const currentFp = computePasswordFingerprint(secret);
  const localCoreOnly: CloudFullDataset = {
    bills: [],
    categories: [...(localExtra.categories ?? [])],
    scheduleSlots: [...(localExtra.scheduleSlots ?? localExtra.scheduleEvents ?? [])],
    completionEvents: [...(localExtra.completionEvents ?? localExtra.scheduleCompletions ?? [])],
    habits: [...(localExtra.habits ?? [])],
    habitCheckIns: [...(localExtra.habitCheckIns ?? localExtra.habitCheckins ?? [])],
    diaryEntries: [...(localExtra.diaryEntries ?? [])],
    tombstones: normalizeCloudTombstones(localExtra.tombstones ?? loadLocalCloudTombstones()),
  };

  const [manifestStatus, localBillCount] = await Promise.all([
    fetchRemoteObjectSnapshot(config, CLOUD_SYNC_MANIFEST_FILE),
    billSource.getLocalBillCount(),
  ]);
  const effectiveConfig = manifestStatus.correctedEndpoint
    ? { ...config, endpoint: manifestStatus.correctedEndpoint }
    : config;
  const resolvedTarget = resolveCloudEndpointTarget(effectiveConfig, CLOUD_SYNC_MANIFEST_FILE);
  const preset = getCloudProviderPreset(resolvedTarget.effectiveProvider);
  const bucketNamespace = `${resolvedTarget.host}/${resolvedTarget.bucketName}`;

  if (manifestStatus.exists && manifestStatus.snapshot) {
    const manifestJson = unsealEncryptedCloudObject(manifestStatus.snapshot, secret);
    const parsedManifest = JSON.parse(manifestJson) as CloudShardManifestPayload;
    const syncedState = loadSyncedShardsState(bucketNamespace, currentFp);
    const dirtyState = loadCloudBillsDirtyState();
    const totalShardCount = Object.keys(parsedManifest.shards ?? {}).length;
    const totalRemoteSizeBytes = Object.values(parsedManifest.shards ?? {}).reduce(
      (acc, d) => acc + (d.sizeBytes ?? 0),
      manifestStatus.snapshot.meta.sizeBytes ?? 0,
    );
    const recordMeta: CloudSyncRecord = {
      ...manifestStatus.snapshot.meta,
      provider: resolvedTarget.effectiveProvider,
      providerName: preset.name,
      endpoint: effectiveConfig.endpoint.trim(),
      bucket: resolvedTarget.bucketName,
      billCount: parsedManifest.billCount,
      sizeBytes: totalRemoteSizeBytes,
    };

    if (
      syncedState &&
      !dirtyState.allBillsDirty &&
      dirtyState.dirtyMonths.length === 0 &&
      localBillCount === syncedState.billCount
    ) {
      const remoteChangedKeys = Object.keys(parsedManifest.shards ?? {}).filter(
        (k) => syncedState.shards[k]?.contentHash !== parsedManifest.shards[k]?.contentHash,
      );
      const remoteRemovedKeys = Object.keys(syncedState.shards).filter(
        (k) => !parsedManifest.shards[k],
      );

      // 快速通道 A：云端无任何分片变动 -> 0 下载、0 读写，瞬时返回！
      if (remoteChangedKeys.length === 0 && remoteRemovedKeys.length === 0) {
        writeLightweightRecordCache(effectiveConfig, secret, recordMeta);
        return {
          unchanged: true,
          record: recordMeta,
          billsToPut: [],
          mergedCore: {
            categories: localCoreOnly.categories,
            scheduleSlots: localCoreOnly.scheduleSlots,
            completionEvents: localCoreOnly.completionEvents,
            habits: localCoreOnly.habits,
            habitCheckIns: localCoreOnly.habitCheckIns,
            diaryEntries: localCoreOnly.diaryEntries,
            tombstones: localCoreOnly.tombstones,
          },
          purged: {
            billIds: [],
            categoryIds: [],
            scheduleSlotIds: [],
            completionEventIds: [],
            habitIds: [],
            habitCheckInIds: [],
            diaryEntryIds: [],
          },
          totalBillCount: parsedManifest.billCount,
          downloadedShardCount: 0,
          totalShardCount,
        };
      }

      // 快速通道 B：仅下载远端变动的分片 + 按月读取对应本地账单合并
      const pullMonthFn = billSource.loadMonthLocalBills;
      if (typeof pullMonthFn === 'function') {
        const changedMonths = new Set<string>();
        for (const k of [...remoteChangedKeys, ...remoteRemovedKeys]) {
          if (k.startsWith('bills-')) changedMonths.add(k.slice(6));
        }
        if (!changedMonths.has('unknown')) {
          const keysToFetch = new Set<string>(remoteChangedKeys);
          if (parsedManifest.shards['core']) keysToFetch.add('core');

          const fetchedJsons = new Map<string, string>();
          let downloadedCount = 0;
          const fetchList = [...keysToFetch]
            .map((k) => parsedManifest.shards[k])
            .filter((d): d is CloudShardDescriptor => Boolean(d));
          for (let i = 0; i < fetchList.length; i += 4) {
            const batch = fetchList.slice(i, i + 4);
            const resBatch = await Promise.all(
              batch.map(async (desc) => {
                const obj = await fetchRemoteObjectSnapshot(effectiveConfig, desc.fileName);
                if (!obj.exists || !obj.snapshot) {
                  throw new LifeHubError('LIFEHUB_E_STORAGE', `云端分片缺失：${desc.fileName}`);
                }
                const plain = unsealEncryptedCloudObject(obj.snapshot, secret);
                putVerifiedShardPlain(bucketNamespace, currentFp, desc.key, desc.contentHash, plain);
                return { key: desc.key, plain };
              }),
            );
            for (const item of resBatch) {
              fetchedJsons.set(item.key, item.plain);
              downloadedCount += 1;
            }
          }

          const localSliceArrays = await Promise.all(
            [...changedMonths].map((m) => pullMonthFn(m)),
          );
          const localSliceBills = localSliceArrays.flat();
          const remoteSliceDataset = assembleDatasetFromShardJsons(fetchedJsons);
          const mergeRes = mergeCloudDatasets(
            { ...localCoreOnly, bills: localSliceBills },
            remoteSliceDataset,
            syncedState.revision,
            parsedManifest.revision ?? 1,
          );
          const billsToPut = diffChangedBillsAgainstBaseline(
            mergeRes.merged.bills,
            localSliceBills,
          );
          const unchangedMonthsCount = Object.entries(parsedManifest.shards)
            .filter(([k]) => k.startsWith('bills-') && !changedMonths.has(k.slice(6)))
            .reduce((acc, [, d]) => acc + d.itemCount, 0);
          const finalTotalCount = unchangedMonthsCount + mergeRes.merged.bills.length;

          saveSyncedShardsState({
            bucketNamespace,
            passwordFingerprint: currentFp,
            revision: parsedManifest.revision ?? 1,
            syncedAt: parsedManifest.syncedAt,
            billCount: finalTotalCount,
            shards: parsedManifest.shards,
          });
          clearCloudBillsDirtyState();
          writeLightweightRecordCache(effectiveConfig, secret, {
            ...recordMeta,
            billCount: finalTotalCount,
          });

          return {
            unchanged: false,
            record: { ...recordMeta, billCount: finalTotalCount },
            billsToPut,
            mergedCore: {
              categories: mergeRes.merged.categories,
              scheduleSlots: mergeRes.merged.scheduleSlots,
              completionEvents: mergeRes.merged.completionEvents,
              habits: mergeRes.merged.habits,
              habitCheckIns: mergeRes.merged.habitCheckIns,
              diaryEntries: mergeRes.merged.diaryEntries,
              tombstones: mergeRes.merged.tombstones,
            },
            purged: mergeRes.purged,
            totalBillCount: finalTotalCount,
            downloadedShardCount: downloadedCount,
            totalShardCount,
          };
        }
      }
    }

    // 首次拉取通道：读取本地真实账单做分片哈希去重下载，并仅写回差异账单
    const allLocalBills = await billSource.loadAllLocalBills();
    const fullLocal: CloudFullDataset = { ...localCoreOnly, bills: allLocalBills };
    const localShards = partitionDatasetIntoShards(fullLocal);
    const resolvedRemote = await resolveShardedRemoteDataset(
      effectiveConfig,
      parsedManifest,
      secret,
      localShards,
    );
    const mergeRes = mergeCloudDatasets(
      fullLocal,
      resolvedRemote.dataset,
      loadLatestCloudSyncRecord()?.revision ?? 0,
      parsedManifest.revision ?? 1,
    );
    const billsToPut = diffChangedBillsAgainstBaseline(mergeRes.merged.bills, allLocalBills);
    const computedFinalShards = partitionDatasetIntoShards(mergeRes.merged);
    const finalShardDescs: Record<string, CloudShardDescriptor> = {};
    for (const [k, s] of computedFinalShards.entries()) {
      finalShardDescs[k] = {
        key: s.key,
        fileName: s.fileName,
        contentHash: s.contentHash,
        itemCount: s.itemCount,
        sizeBytes: parsedManifest.shards[k]?.sizeBytes,
      };
    }
    if (
      billsToPut.length === 0 &&
      mergeRes.merged.bills.length === parsedManifest.billCount &&
      Object.keys(finalShardDescs).every(
        (k) => finalShardDescs[k]?.contentHash === parsedManifest.shards[k]?.contentHash,
      )
    ) {
      saveSyncedShardsState({
        bucketNamespace,
        passwordFingerprint: currentFp,
        revision: parsedManifest.revision ?? 1,
        syncedAt: parsedManifest.syncedAt,
        billCount: mergeRes.merged.bills.length,
        shards: parsedManifest.shards,
      });
      clearCloudBillsDirtyState();
    }
    const savedMeta = writeLocalDatasetSnapshotCache(
      effectiveConfig,
      mergeRes.merged,
      secret,
      parsedManifest.revision ?? 1,
      parsedManifest.syncedAt,
      totalRemoteSizeBytes,
    );
    return {
      unchanged: false,
      record: savedMeta,
      billsToPut,
      mergedCore: {
        categories: mergeRes.merged.categories,
        scheduleSlots: mergeRes.merged.scheduleSlots,
        completionEvents: mergeRes.merged.completionEvents,
        habits: mergeRes.merged.habits,
        habitCheckIns: mergeRes.merged.habitCheckIns,
        diaryEntries: mergeRes.merged.diaryEntries,
        tombstones: mergeRes.merged.tombstones,
      },
      purged: mergeRes.purged,
      totalBillCount: mergeRes.merged.bills.length,
      downloadedShardCount: resolvedRemote.downloadedShardCount,
      totalShardCount,
    };
  }

  // 回退兼容旧版单文件 `lifehub-backup.json.enc`
  const legacyRemote = await fetchRemoteObjectSnapshot(effectiveConfig, LEGACY_CLOUD_BACKUP_FILE);
  if (legacyRemote.exists && legacyRemote.snapshot && legacyRemote.rawBody) {
    writeSnapshotCache(legacyRemote.rawBody);
    const { dataset: remoteDataset, record } = decryptSnapshotToDataset(
      legacyRemote.snapshot,
      secret,
    );
    const allLocalBills = await billSource.loadAllLocalBills();
    const mergeRes = mergeCloudDatasets(
      { ...localCoreOnly, bills: allLocalBills },
      remoteDataset,
      loadLatestCloudSyncRecord()?.revision ?? 0,
      record.revision ?? 1,
    );
    const billsToPut = diffChangedBillsAgainstBaseline(mergeRes.merged.bills, allLocalBills);
    return {
      unchanged: false,
      record,
      billsToPut,
      mergedCore: {
        categories: mergeRes.merged.categories,
        scheduleSlots: mergeRes.merged.scheduleSlots,
        completionEvents: mergeRes.merged.completionEvents,
        habits: mergeRes.merged.habits,
        habitCheckIns: mergeRes.merged.habitCheckIns,
        diaryEntries: mergeRes.merged.diaryEntries,
        tombstones: mergeRes.merged.tombstones,
      },
      purged: mergeRes.purged,
      totalBillCount: mergeRes.merged.bills.length,
      downloadedShardCount: 1,
      totalShardCount: 1,
    };
  }

  throw new LifeHubError(
    'LIFEHUB_E_STORAGE',
    '远程存储桶中暂无备份文件，请先在有数据的设备上执行一次上传',
  );
}

/**
 * 从远程存储桶按需增量拉取最新的分片备份（或兼容拉取旧版单文件备份）并写入本机快照缓存。
 */
export async function pullSnapshotFromRemoteCloud(
  config: CloudStorageConfig,
  password?: string,
  localDatasetHint?: CloudFullDataset,
): Promise<{ downloadedShardCount: number; totalShardCount: number }> {
  const accessKey = config.accessKey.trim();
  const secretKey = config.secretKey.trim();
  if (!accessKey || !secretKey) {
    return { downloadedShardCount: 0, totalShardCount: 0 };
  }

  const manifestStatus = await fetchRemoteObjectSnapshot(config, CLOUD_SYNC_MANIFEST_FILE);
  const effectiveConfig = manifestStatus.correctedEndpoint
    ? { ...config, endpoint: manifestStatus.correctedEndpoint }
    : config;

  if (manifestStatus.exists && manifestStatus.snapshot) {
    const secret = (password ?? effectiveConfig.savedPassword ?? '').trim();
    if (!secret) {
      throw new LifeHubError(
        'LIFEHUB_E_VALIDATION',
        '登录密码错误，无法解密还原云端数据（请先填写加密密码）',
      );
    }
    const manifestJson = unsealEncryptedCloudObject(manifestStatus.snapshot, secret);
    const parsedManifest = JSON.parse(manifestJson) as CloudShardManifestPayload;
    const localShards = localDatasetHint
      ? partitionDatasetIntoShards({
          ...localDatasetHint,
          tombstones: normalizeCloudTombstones(localDatasetHint.tombstones),
        })
      : undefined;
    const resolvedRemote = await resolveShardedRemoteDataset(
      effectiveConfig,
      parsedManifest,
      secret,
      localShards,
    );
    const totalRemoteSizeBytes = Object.values(parsedManifest.shards ?? {}).reduce(
      (acc, d) => acc + (d.sizeBytes ?? 0),
      manifestStatus.snapshot.meta.sizeBytes ?? 0,
    );
    writeLocalDatasetSnapshotCache(
      effectiveConfig,
      resolvedRemote.dataset,
      secret,
      parsedManifest.revision ?? manifestStatus.snapshot.meta.revision ?? 1,
      parsedManifest.syncedAt ?? manifestStatus.snapshot.meta.syncedAt,
      totalRemoteSizeBytes,
    );
    return {
      downloadedShardCount: resolvedRemote.downloadedShardCount,
      totalShardCount: Object.keys(parsedManifest.shards ?? {}).length,
    };
  }

  const legacyRemote = await fetchRemoteObjectSnapshot(effectiveConfig, LEGACY_CLOUD_BACKUP_FILE);
  if (legacyRemote.exists && legacyRemote.rawBody) {
    writeSnapshotCache(legacyRemote.rawBody);
    return { downloadedShardCount: 1, totalShardCount: 1 };
  }

  throw new LifeHubError(
    'LIFEHUB_E_STORAGE',
    '远程存储桶中暂无备份文件，请先在有数据的设备上执行一次上传',
  );
}
