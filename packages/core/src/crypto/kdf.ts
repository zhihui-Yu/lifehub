/**
 * KDF（密钥派生函数）参数定义。
 *
 * 架构位置：core 包「加密层」的参数模块，被 CryptoProvider 端口与 CryptoService 共用。
 *
 * 取值依据（PRD Q4 / Q5、系统设计 §1.3）：
 * - 算法选 scrypt：WebCrypto 无原生 Argon2/scrypt，scrypt 有成熟纯 JS 实现且跨端行为一致；
 * - N=32768 / r=8 / p=1：抗爆破强度与解锁耗时（NF-P-3 P95 ≤ 1s）之间的平衡点；
 * - keyLength=32：对应 AES-256 密钥长度。
 */
import { KDF_DEFAULT_PARAMS, KDF_FALLBACK_PARAMS, KDF_PARAMS_VERSION } from '../constants';
import { LifeHubError } from '../errors';
import { fromHex, toHex } from '../utils/bytes';

/** KDF 参数结构。 */
export interface KdfParams {
  /** 算法标识，固定为 'scrypt'。 */
  algorithm: 'scrypt';
  /** CPU / 内存成本参数 N。 */
  n: number;
  /** 块大小参数 r。 */
  r: number;
  /** 并行度参数 p。 */
  p: number;
  /** 派生密钥字节长度。 */
  keyLength: number;
  /** 盐值。 */
  salt: Uint8Array;
}

/** KDF 参数的可序列化形态（盐值以 hex 存储，便于 JSON 落盘）。 */
export interface SerializedKdfParams {
  /** 算法标识。 */
  algorithm: 'scrypt';
  /** N 参数。 */
  n: number;
  /** r 参数。 */
  r: number;
  /** p 参数。 */
  p: number;
  /** 派生密钥长度。 */
  keyLength: number;
  /** 盐值 hex。 */
  salt: string;
  /** 参数版本号。 */
  paramsVersion: number;
}

/**
 * 构造一组默认 KDF 参数。
 *
 * @param salt 盐值字节数组，长度应为 16 字节
 * @param overrides 可选覆盖项，用于低性能设备降级
 * @returns KDF 参数对象
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 盐值长度非法或覆盖项非法
 */
export function createKdfParams(
  salt: Uint8Array,
  overrides?: Partial<Pick<KdfParams, 'n' | 'r' | 'p' | 'keyLength'>>,
): KdfParams {
  if (!(salt instanceof Uint8Array) || salt.length < 16) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '盐值至少需要 16 字节');
  }
  const params: KdfParams = {
    algorithm: 'scrypt',
    n: overrides?.n ?? KDF_DEFAULT_PARAMS.n,
    r: overrides?.r ?? KDF_DEFAULT_PARAMS.r,
    p: overrides?.p ?? KDF_DEFAULT_PARAMS.p,
    keyLength: overrides?.keyLength ?? KDF_DEFAULT_PARAMS.keyLength,
    salt,
  };
  validateKdfParams(params);
  return params;
}

/**
 * 构造降级用的 KDF 参数（低性能设备 / 老旧浏览器）。
 *
 * 说明：N 降到 2^14 后解锁更快但抗爆破强度下降，
 * UI 需提示「强度不足，建议调高参数」（NF-P-3）。
 *
 * @param salt 盐值字节数组
 * @returns 降级 KDF 参数
 */
export function createFallbackKdfParams(salt: Uint8Array): KdfParams {
  return createKdfParams(salt, {
    n: KDF_FALLBACK_PARAMS.n,
    r: KDF_FALLBACK_PARAMS.r,
    p: KDF_FALLBACK_PARAMS.p,
    keyLength: KDF_FALLBACK_PARAMS.keyLength,
  });
}

/**
 * 校验 KDF 参数是否在安全范围内。
 *
 * @param params 待校验的 KDF 参数
 * @returns 无异常
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 参数非法（N 非 2 的幂、过小或过大）
 */
export function validateKdfParams(params: KdfParams): void {
  if (params.algorithm !== 'scrypt') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '仅支持 scrypt 密钥派生');
  }
  if (!Number.isInteger(params.n) || params.n < 1024 || (params.n & (params.n - 1)) !== 0) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', 'scrypt 的 N 必须是 ≥ 1024 的 2 的幂');
  }
  if (!Number.isInteger(params.r) || params.r < 1) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', 'scrypt 的 r 非法');
  }
  if (!Number.isInteger(params.p) || params.p < 1) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', 'scrypt 的 p 非法');
  }
  if (!Number.isInteger(params.keyLength) || params.keyLength < 16 || params.keyLength > 64) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '派生密钥长度非法');
  }
  if (!(params.salt instanceof Uint8Array) || params.salt.length < 16) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '盐值至少需要 16 字节');
  }
}

/**
 * 把 KDF 参数序列化为可 JSON 落盘的形态。
 *
 * @param params KDF 参数
 * @returns 序列化后的参数对象
 */
export function serializeKdfParams(params: KdfParams): SerializedKdfParams {
  validateKdfParams(params);
  return {
    algorithm: 'scrypt',
    n: params.n,
    r: params.r,
    p: params.p,
    keyLength: params.keyLength,
    salt: toHex(params.salt),
    paramsVersion: KDF_PARAMS_VERSION,
  };
}

/**
 * 把序列化的 KDF 参数反序列化回结构体。
 *
 * @param raw 待反序列化的对象
 * @returns KDF 参数
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 结构非法或盐值 hex 非法
 */
export function deserializeKdfParams(raw: unknown): KdfParams {
  if (typeof raw !== 'object' || raw === null) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', 'KDF 参数必须是对象');
  }
  const candidate = raw as Record<string, unknown>;
  const saltHex = candidate['salt'];
  if (typeof saltHex !== 'string') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', 'KDF 盐值必须是 hex 字符串');
  }
  let salt: Uint8Array;
  try {
    salt = fromHex(saltHex);
  } catch {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', 'KDF 盐值 hex 非法');
  }
  return createKdfParams(salt, {
    n: Number(candidate['n']),
    r: Number(candidate['r']),
    p: Number(candidate['p']),
    keyLength: Number(candidate['keyLength']),
  });
}

/**
 * 判断现有参数是否可以在不重新派生密钥的前提下升级到目标参数。
 *
 * 说明：KDF 参数升级会改变派生结果，因此**必须**重新派生主密钥并重新包裹 DEK，
 * 不能原地升级（A-07 ⑥、S5 阶段实现完整流程）。
 *
 * @param current 当前参数
 * @param target 目标参数
 * @returns 可以直接升级返回 true
 */
export function isKdfUpgradable(current: KdfParams, target: KdfParams): boolean {
  return (
    current.n === target.n &&
    current.r === target.r &&
    current.p === target.p &&
    current.keyLength === target.keyLength &&
    toHex(current.salt) === toHex(target.salt)
  );
}

/**
 * 取当前 KDF 参数版本号。
 *
 * @returns 参数版本号
 */
export function getKdfParamsVersion(): number {
  return KDF_PARAMS_VERSION;
}
