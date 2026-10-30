/**
 * 数据加密密钥（DEK）的生成、包裹与内存擦除。
 *
 * 架构位置：core 包「加密层」的服务模块。
 *
 * 密钥体系说明（系统设计 §1.2 难点 6）：
 * - 用户口令 → scrypt → **主密钥（masterKey）**；
 * - 主密钥只用于**包裹** DEK，不直接加密业务数据；
 * - **DEK** 才用于加密业务记录；
 * 这样改主密码时只需重新包裹 DEK + 重加密存量密文，而不是把全部数据重新绑定到口令上。
 */
import { DEK_LENGTH } from '../constants';
import { LifeHubError } from '../errors';
import type { WrappedDek } from '../models/vault';
import type { CryptoService } from './service';
import type { CryptoProvider } from './provider';

/**
 * 生成一份随机的数据加密密钥（DEK）。
 *
 * @param provider 密码学能力端口
 * @param keyLength 密钥字节长度，默认 32（AES-256）
 * @returns DEK 字节数组
 */
export function generateDek(provider: CryptoProvider, keyLength: number = DEK_LENGTH): Uint8Array {
  return provider.randomBytes(keyLength);
}

/**
 * 生成一份随机盐值。
 *
 * @param provider 密码学能力端口
 * @param length 盐值字节长度，默认 16
 * @returns 盐值字节数组
 */
export function generateSalt(provider: CryptoProvider, length: number = 16): Uint8Array {
  return provider.randomBytes(length);
}

/**
 * 用主密钥包裹 DEK。
 *
 * @param crypto CryptoService 实例
 * @param masterKey 主密钥
 * @param dek 待包裹的 DEK
 * @param keyVersion DEK 版本号
 * @returns 被包裹的 DEK 结构
 */
export async function wrapDek(
  crypto: CryptoService,
  masterKey: Uint8Array,
  dek: Uint8Array,
  keyVersion: number,
): Promise<WrappedDek> {
  return crypto.wrapDek(masterKey, dek, keyVersion);
}

/**
 * 解包 DEK。
 *
 * @param crypto CryptoService 实例
 * @param masterKey 主密钥
 * @param wrapped 被包裹的 DEK 结构
 * @returns 解包出的 DEK 字节数组
 * @throws {LifeHubError} `LIFEHUB_E_CRYPTO_AUTH_FAILED` —— 包裹数据被篡改
 */
export async function unwrapDek(
  crypto: CryptoService,
  masterKey: Uint8Array,
  wrapped: WrappedDek,
): Promise<Uint8Array> {
  return crypto.unwrapDek(masterKey, wrapped);
}

/**
 * 擦除内存中的密钥字节。
 *
 * 说明：锁定保险库时调用，尽量缩短密钥在内存中的驻留时间（NF-S-2）。
 * 注意：JavaScript 引擎可能对 ArrayBuffer 做拷贝或压缩，
 * 因此这只是**尽力而为**的降噪措施，真正的保障是「密钥永不落盘」。
 *
 * @param bytes 待擦除的字节数组；为空时不做任何事
 * @returns 无
 */
export function wipeBytes(bytes: Uint8Array | null | undefined): void {
  if (!bytes) {
    return;
  }
  bytes.fill(0);
}

/**
 * 校验密钥长度是否合法（AES-256 需要 32 字节）。
 *
 * @param key 待校验的密钥
 * @returns 无异常
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 密钥长度非法
 */
export function assertKeyLength(key: Uint8Array): void {
  if (!(key instanceof Uint8Array) || key.length !== DEK_LENGTH) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', `密钥必须是 ${DEK_LENGTH} 字节`);
  }
}
