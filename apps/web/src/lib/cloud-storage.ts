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
  loadLocalCloudTombstones,
  normalizeCloudTombstones,
  recordCloudTombstone,
  recordCloudTombstones,
  saveLocalCloudTombstones,
  type DeletedEntityTombstone,
  type SyncableEntityType,
} from './cloud-tombstones';

export {
  loadLocalCloudTombstones,
  normalizeCloudTombstones,
  recordCloudTombstone,
  recordCloudTombstones,
  saveLocalCloudTombstones,
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
  if (cleanedUrlPath === fileName) {
    cleanedUrlPath = '';
  } else if (cleanedUrlPath.endsWith(`/${fileName}`)) {
    cleanedUrlPath = cleanedUrlPath.slice(0, -(fileName.length + 1));
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
 * 对备份 JSON 文本执行同步无损「高频字典 + LZ77 滑动窗口」双级压缩。
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
 * 使用登录密码派生的密钥流对 UTF-8 文本进行加密并编码为 Base64。
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
  const decodedPayload = decodeEncryptedPayload(
    snapshot.ciphertextBase64,
    normalizedSecret,
    salt,
    expectedTag,
  );
  const decompressedJson =
    snapshot.compression === 'lh-lz1' ? decompressBackupJson(decodedPayload) : decodedPayload;

  const parsed = JSON.parse(decompressedJson) as
    | ({
        bills?: Bill[];
      } & CloudBackupExtraModules)
    | Bill[];
  const isArray = Array.isArray(parsed);
  const bills = isArray ? parsed : Array.isArray(parsed.bills) ? parsed.bills : [];
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
  const tombstones =
    !isArray && Array.isArray(parsed.tombstones)
      ? normalizeCloudTombstones(parsed.tombstones)
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

  const compressedPayload = compressBackupJson(compactSourceJson);
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

  // WebDAV Basic Auth
  if (effectiveProvider === 'jianguoyun-webdav') {
    const authB64 =
      typeof btoa === 'function'
        ? btoa(`${accessKey}:${secretKey}`)
        : Buffer.from(`${accessKey}:${secretKey}`, 'utf8').toString('base64');
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

/**
 * 拉取远端云存储上的当前备份快照（区分「桶内尚无备份文件 404」与「网络/鉴权/桶不存在异常」）。
 */
async function fetchRemoteSnapshotStatus(config: CloudStorageConfig): Promise<{
  exists: boolean;
  snapshot?: StoredCloudSnapshot;
  rawBody?: string;
  correctedEndpoint?: string;
}> {
  const signed = await buildSignedCloudHttpRequest(config, 'GET', 'lifehub-backup.json.enc');
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
        'lifehub-backup.json.enc',
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
 * 发起真实网络请求探测云存储连通性与密钥鉴权（若未填密钥则仅做本地地址校验）。
 */
export async function probeRemoteCloudConnection(config: CloudStorageConfig): Promise<{
  ok: boolean;
  message: string;
  correctedEndpoint?: string;
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
    const remote = await fetchRemoteSnapshotStatus(config);
    if (remote.exists && remote.snapshot) {
      const rev = remote.snapshot.meta.revision ?? 1;
      return {
        ok: true,
        message: `已成功连接「${preset.name}」并通过密钥鉴权校验（存储桶：${resolved.bucketName} · 云端已有备份 v${rev}，含 ${remote.snapshot.meta.billCount} 条账单）`,
        ...(remote.correctedEndpoint ? { correctedEndpoint: remote.correctedEndpoint } : {}),
      };
    }
    return {
      ok: true,
      message: `已成功连接「${preset.name}」并通过密钥鉴权校验（存储桶：${resolved.bucketName} 可达，云端暂未上传过备份文件）`,
      ...(remote.correctedEndpoint ? { correctedEndpoint: remote.correctedEndpoint } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? `连接失败：${err.message}` : '连接失败：远程对象存储不可达',
    };
  }
}

/**
 * 将本地已生成的加密备份快照真正通过 HTTP PUT 上传至远程 OSS / COS / OBS / WebDAV / S3 存储桶。
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

  const signed = await buildSignedCloudHttpRequest(config, 'PUT', 'lifehub-backup.json.enc');

  // 若为 WebDAV，先尝试创建目录（MKCOL）
  if (signed.effectiveProvider === 'jianguoyun-webdav' && signed.webdavDirUrl) {
    try {
      await executeCloudHttpRequest(signed.webdavDirUrl, 'MKCOL', signed.headers);
    } catch {
      // 目录已存在或服务端不支持 MKCOL 时忽略
    }
  }

  let result = await executeCloudHttpRequest(signed.url, 'PUT', signed.headers, rawSnapshot);
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
        'lifehub-backup.json.enc',
        correctedEndpoint,
      );
      result = await executeCloudHttpRequest(
        retrySigned.url,
        'PUT',
        retrySigned.headers,
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
 * 上传前强制执行「先拉取远端 → 按 ID + 更新时间与删除墓碑合并 → 加密上传新版本」（Pull-Merge-Push）。
 *
 * 说明：
 * - 不在启动或关闭时轮询远端，仅在执行远程上传前强制拉取检查；
 * - 若远端已存在快照，自动使用登录密码解密并与本机数据取最新并集（同时应用删除墓碑），
 *   返回合并后的数据集供调用方写回本机数据库，保证两端数据 100% 一致、绝不误覆盖。
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
}> {
  const normalizedSecret = (password || config.savedPassword || '').trim();
  if (!normalizedSecret) {
    throw new LifeHubError(
      'LIFEHUB_E_VALIDATION',
      '请填写登录密码（加密凭证）：加密密码为必填项，不能为空',
    );
  }

  const localPrevRecord = loadLatestCloudSyncRecord();
  const localRevision = localPrevRecord?.revision ?? 0;

  // 第一步：强制先从远端拉取当前最新快照
  const remoteStatus = await fetchRemoteSnapshotStatus(config);
  const effectiveConfig = remoteStatus.correctedEndpoint
    ? { ...config, endpoint: remoteStatus.correctedEndpoint }
    : config;

  let finalDataset: CloudFullDataset = {
    ...localDataset,
    tombstones: normalizeCloudTombstones(localDataset.tombstones),
  };
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

  if (remoteStatus.exists && remoteStatus.snapshot) {
    const remoteSnap = remoteStatus.snapshot;
    const remoteRev = remoteSnap.meta.revision ?? 1;
    const currentFp = computePasswordFingerprint(normalizedSecret);
    const remoteFp = remoteSnap.meta.passwordFingerprint;

    if (remoteFp && remoteFp !== currentFp && !options?.allowPasswordChange) {
      throw new LifeHubError(
        'LIFEHUB_E_VALIDATION',
        '云端已有备份且加密密码与当前输入不一致！为防止覆盖另一端数据，请输入正确的云端备份密码以合并数据，或勾选「允许使用新密码覆盖云端备份」。',
      );
    }

    // 密码一致（或未记录指纹但可解密）时，强制解密远端快照并与本地增量合并
    if (!remoteFp || remoteFp === currentFp) {
      const { dataset: remoteDataset } = decryptSnapshotToDataset(remoteSnap, normalizedSecret);
      const mergeRes = mergeCloudDatasets(finalDataset, remoteDataset, localRevision, remoteRev);
      finalDataset = mergeRes.merged;
      purged = mergeRes.purged;
      mergedFromRemote = true;
      nextRevision = mergeRes.nextRevision;
    } else {
      // 用户显式勾选 allowPasswordChange 更换新密码覆盖：仍保持版本号单调递增
      nextRevision = Math.max(localRevision, remoteRev) + 1;
    }
  }

  // 第二步：将合并后的完整数据与删除墓碑加密写入本地快照缓存
  saveLocalCloudTombstones(finalDataset.tombstones);
  const record = uploadBillsToCloud(
    effectiveConfig,
    finalDataset.bills,
    normalizedSecret,
    {
      categories: finalDataset.categories,
      scheduleSlots: finalDataset.scheduleSlots,
      completionEvents: finalDataset.completionEvents,
      habits: finalDataset.habits,
      habitCheckIns: finalDataset.habitCheckIns,
      diaryEntries: finalDataset.diaryEntries,
      tombstones: finalDataset.tombstones,
    },
    {
      allowPasswordChange: true,
      revision: nextRevision,
    },
  );

  // 第三步：将新版本快照推送至远程对象存储
  const pushRes = await pushSnapshotToRemoteCloud(effectiveConfig);
  const finalCorrected = pushRes.correctedEndpoint ?? remoteStatus.correctedEndpoint;

  return {
    record,
    remoteUrl: pushRes.remoteUrl,
    ...(finalCorrected ? { correctedEndpoint: finalCorrected } : {}),
    mergedDataset: finalDataset,
    purged,
    mergedFromRemote,
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

  const remote = await fetchRemoteSnapshotStatus(config);
  if (remote.exists && remote.rawBody) {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(CLOUD_SNAPSHOT_STORAGE_KEY, remote.rawBody);
    }
  } else if (!remote.exists) {
    throw new LifeHubError(
      'LIFEHUB_E_STORAGE',
      '远程存储桶中暂无备份文件（lifehub-backup.json.enc），请先在有数据的设备上执行一次上传',
    );
  }
}
