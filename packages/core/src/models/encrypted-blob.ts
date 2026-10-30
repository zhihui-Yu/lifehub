/**
 * 加密 blob 模型。
 *
 * 架构位置：core 包的领域模型层，是同步载荷与加密备份文件的最小单元。
 *
 * 红线（X-01 ④ / R5）：本结构**只允许**密文字段，
 * 不含 localDate 等索引明文列，也不含任何业务语义字段（ADR-006）。
 */
import { ISO_UTC_PATTERN } from '../constants';
import { LifeHubError } from '../errors';
import type { EntityType } from '../types/entity-type';

/** 加密 blob。 */
export interface EncryptedBlob {
  /** blob id（通常等于实体 id）。 */
  id: string;
  /** 实体类型。 */
  entityType: EntityType;
  /** 实体 id。 */
  entityId: string;
  /** 密文正文。 */
  ciphertext: Uint8Array;
  /** 随机 IV。 */
  iv: Uint8Array;
  /** GCM 认证标签。 */
  tag: Uint8Array;
  /** 加密算法，固定 'AES-256-GCM'。 */
  algorithm: 'AES-256-GCM';
  /** 加密时使用的密钥版本。 */
  keyVersion: number;
  /** 最后更新时间，ISO 8601 UTC。 */
  updatedAt: string;
  /** 单调递增版本号。 */
  version: number;
}

/** 同步载荷（只含密文）。 */
export interface SyncPayload {
  /** 协议版本号。 */
  version: 1;
  /** 构造时间，ISO 8601 UTC。 */
  createdAt: string;
  /** 待同步的密文 blob 列表。 */
  blobs: EncryptedBlob[];
}

/**
 * 校验并返回一个合法的 EncryptedBlob。
 *
 * @param blob 待校验的未知值
 * @returns 校验通过的 EncryptedBlob 对象
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 任一字段不满足约束
 */
export function validateEncryptedBlob(blob: unknown): EncryptedBlob {
  if (typeof blob !== 'object' || blob === null) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '加密 blob 必须是对象');
  }
  const candidate = blob as Record<string, unknown>;
  for (const key of ['ciphertext', 'iv', 'tag'] as const) {
    if (!(candidate[key] instanceof Uint8Array)) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', `加密 blob 的 ${key} 必须是 Uint8Array`);
    }
  }
  if (candidate['algorithm'] !== 'AES-256-GCM') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '加密算法必须是 AES-256-GCM');
  }
  if (typeof candidate['keyVersion'] !== 'number' || typeof candidate['version'] !== 'number') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '加密 blob 版本号非法');
  }
  if (typeof candidate['updatedAt'] !== 'string' || !ISO_UTC_PATTERN.test(candidate['updatedAt'])) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '加密 blob 更新时间必须是 ISO 8601 UTC');
  }
  if (typeof candidate['entityType'] !== 'string' || typeof candidate['entityId'] !== 'string') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '加密 blob 实体标识非法');
  }
  return candidate as unknown as EncryptedBlob;
}
