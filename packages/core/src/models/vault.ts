/**
 * 保险库参数与恢复码相关模型。
 *
 * 架构位置：core 包的领域模型层，是 X-03（恢复码 + 盐值备份）与
 * X-04（口令与档案本地安全存储）的数据结构定义。
 *
 * 安全红线：
 * - `VaultParams` 落盘内容 = 公开 KDF 参数 + 哨兵密文 + 被包裹的 DEK，**无任何明文密钥**；
 * - 恢复码明文**绝不写入本地库**，本地只存 `RecoveryMeta`（X-03 ⑤）。
 */
import { ISO_UTC_PATTERN } from '../constants';
import { LifeHubError } from '../errors';
import type { EncryptedPayload } from './common';

/** KDF 参数（与 crypto/kdf.ts 的 KdfParams 结构一致，此处为落盘形态）。 */
export interface VaultKdfParams {
  /** KDF 算法，固定为 'scrypt'。 */
  kdf: 'scrypt';
  /** scrypt 的 CPU/内存成本参数 N。 */
  n: number;
  /** scrypt 的块大小参数 r。 */
  r: number;
  /** scrypt 的并行度参数 p。 */
  p: number;
  /** 派生密钥字节长度。 */
  keyLength: number;
  /** 盐值（16 字节）。 */
  salt: Uint8Array;
}

/** 被主密钥包裹的数据加密密钥（DEK）。 */
export interface WrappedDek {
  /** 被包裹的 DEK 版本号。 */
  keyVersion: number;
  /** 包裹它的主密钥版本号。 */
  wrappedByKeyVersion: number;
  /** 包裹后的密文载荷。 */
  wrapped: EncryptedPayload;
}

/** 保险库参数（本地明文存储的实体）。 */
export interface VaultParams {
  /** KDF 参数。 */
  kdf: 'scrypt';
  /** scrypt 的 N 参数。 */
  n: number;
  /** scrypt 的 r 参数。 */
  r: number;
  /** scrypt 的 p 参数。 */
  p: number;
  /** 派生密钥字节长度。 */
  keyLength: number;
  /** 盐值（16 字节）。 */
  salt: Uint8Array;
  /** 哨兵密文，明文为 'lifehub:verify:v1'；**不存储口令哈希**（A-07 ⑦）。 */
  verifier: EncryptedPayload;
  /** KDF 参数版本，用于未来参数升级后仍可用旧参数校验（A-07 ⑥）。 */
  paramsVersion: number;
  /** 当前密钥版本。 */
  keyVersion: number;
  /** 当前 DEK（被主密钥包裹）。 */
  currentDek: WrappedDek;
  /** 轮换期间的双包裹（S5 使用）。 */
  previousDek: WrappedDek | null;
  /** 创建时间，ISO 8601 UTC。 */
  createdAt: string;
  /** 最后更新时间，ISO 8601 UTC。 */
  updatedAt: string;
}

/** 恢复码包（用户持有并导出的文件内容）。 */
export interface RecoveryBundle {
  /** 结构版本号，固定为 1。 */
  version: 1;
  /** 恢复码明文，'XXXXXX-XXXXXX-...-XXXXXX'（12 组 × 6 字符 Base32）。 */
  recoveryCode: string;
  /** 盐值。 */
  salt: Uint8Array;
  /** KDF 参数（不含盐值，因为盐值单独列出）。 */
  kdfParams: Omit<VaultKdfParams, 'salt'>;
  /** 哨兵密文，用于校验恢复码正确性。 */
  verifier: EncryptedPayload;
  /** 恢复码 + 盐值的 sha256 hex 校验和。 */
  checksum: string;
  /** 创建时间，ISO 8601 UTC。 */
  createdAt: string;
}

/**
 * 恢复码本地元数据。
 *
 * 说明：**只存元数据**，恢复码明文绝不落本地库（X-03 ⑤）。
 *
 * 设计增量（主理人批准，PRD §3.3「恢复码等价于一把『恢复 DEK』」）：
 * 恢复码先用 `salt` + `kdfParams` 派生出「恢复密钥」，再用它包裹 DEK 得到 `wrappedDek`。
 * 因此恢复码本身就等价于一把能解开 DEK 的钥匙——恢复路径不再依赖「恢复码派生出主密钥」
 * 这一不成立的假设。
 */
export interface RecoveryMeta {
  /** 固定 id，本地仅一份恢复码元数据。 */
  id: 'default';
  /** 恢复码 + 盐值的 sha256 hex 校验和。 */
  checksum: string;
  /** 用户是否已导出盐值备份文件。 */
  exported: boolean;
  /** 创建时间，ISO 8601 UTC。 */
  createdAt: string;
  /** 恢复盐值（至少 16 字节），用于派生恢复密钥与计算校验和。 */
  salt: Uint8Array;
  /** 恢复 KDF 参数（不含盐值，因为盐值单独列出）。 */
  kdfParams: Omit<VaultKdfParams, 'salt'>;
  /** 用恢复密钥包裹的 DEK；只有恢复码能解包。 */
  wrappedDek: WrappedDek;
}

/**
 * 校验并返回一个合法的 VaultParams。
 *
 * @param params 待校验的未知值
 * @returns 校验通过的 VaultParams 对象
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 任一字段不满足约束
 */
export function validateVaultParams(params: unknown): VaultParams {
  if (typeof params !== 'object' || params === null) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '保险库参数必须是对象');
  }
  const candidate = params as Record<string, unknown>;

  if (candidate['kdf'] !== 'scrypt') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '仅支持 scrypt 密钥派生');
  }
  for (const key of ['n', 'r', 'p', 'keyLength'] as const) {
    const value = candidate[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', 'KDF 参数非法');
    }
  }
  const salt = candidate['salt'];
  if (!(salt instanceof Uint8Array) || salt.length < 16) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '盐值必须是至少 16 字节的 Uint8Array');
  }
  const verifier = candidate['verifier'];
  if (typeof verifier !== 'object' || verifier === null) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '哨兵密文非法');
  }
  if (typeof candidate['paramsVersion'] !== 'number' || typeof candidate['keyVersion'] !== 'number') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '参数版本号非法');
  }
  const currentDek = candidate['currentDek'];
  if (typeof currentDek !== 'object' || currentDek === null) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '当前 DEK 非法');
  }
  const previousDek = candidate['previousDek'];
  if (previousDek !== null && (typeof previousDek !== 'object' || previousDek === null)) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '上一版本 DEK 非法');
  }
  if (typeof candidate['createdAt'] !== 'string' || !ISO_UTC_PATTERN.test(candidate['createdAt'])) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '保险库创建时间必须是 ISO 8601 UTC');
  }
  if (typeof candidate['updatedAt'] !== 'string' || !ISO_UTC_PATTERN.test(candidate['updatedAt'])) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '保险库更新时间必须是 ISO 8601 UTC');
  }

  return candidate as unknown as VaultParams;
}

/**
 * 校验并返回一个合法的 RecoveryMeta。
 *
 * 说明：除老字段（checksum / exported / createdAt）外，
 * 还必须校验「恢复盐值 + 恢复 KDF 参数 + 被恢复密钥包裹的 DEK」三件套，
 * 否则恢复路径在设计上不成立（PRD §3.3）。
 *
 * @param meta 待校验的未知值
 * @returns 校验通过的 RecoveryMeta 对象
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 任一字段不满足约束
 */
export function validateRecoveryMeta(meta: unknown): RecoveryMeta {
  if (typeof meta !== 'object' || meta === null) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '恢复码元数据必须是对象');
  }
  const candidate = meta as Record<string, unknown>;
  if (candidate['id'] !== 'default') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '恢复码元数据 id 必须是 default');
  }
  if (typeof candidate['checksum'] !== 'string' || candidate['checksum'] === '') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '恢复码校验和非法');
  }
  if (typeof candidate['exported'] !== 'boolean') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '恢复码导出标记必须是布尔值');
  }
  if (typeof candidate['createdAt'] !== 'string' || !ISO_UTC_PATTERN.test(candidate['createdAt'])) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '恢复码创建时间必须是 ISO 8601 UTC');
  }

  const salt = candidate['salt'];
  if (!(salt instanceof Uint8Array) || salt.length < 16) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '恢复码盐值必须是至少 16 字节的 Uint8Array');
  }

  const kdfParams = candidate['kdfParams'];
  if (typeof kdfParams !== 'object' || kdfParams === null) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '恢复码 KDF 参数非法');
  }
  const kdfRecord = kdfParams as Record<string, unknown>;
  if (kdfRecord['kdf'] !== 'scrypt') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '仅支持 scrypt 密钥派生');
  }
  for (const key of ['n', 'r', 'p', 'keyLength'] as const) {
    const value = kdfRecord[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', '恢复码 KDF 参数非法');
    }
  }

  const wrappedDek = candidate['wrappedDek'];
  if (typeof wrappedDek !== 'object' || wrappedDek === null) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '恢复码包裹的 DEK 非法');
  }
  const wrappedRecord = wrappedDek as Record<string, unknown>;
  if (typeof wrappedRecord['keyVersion'] !== 'number' || typeof wrappedRecord['wrapped'] !== 'object') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '恢复码包裹的 DEK 非法');
  }

  return candidate as unknown as RecoveryMeta;
}
