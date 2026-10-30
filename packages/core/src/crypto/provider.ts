/**
 * 密码学能力端口（Port）。
 *
 * 架构位置：core 包的「端口」层。核心层只依赖此接口，**绝不直接访问**
 * `window.crypto` / `node:crypto`（系统设计 §1.2 难点 3）。
 *
 * 实现由外部注入：
 * - `WebCryptoProvider`（默认：WebCrypto + @noble/hashes scrypt，浏览器与 Node 22 通用）
 * - `NodeCryptoProvider`（Node 加速：node:crypto.scrypt，仅通过 `@lifehub/core/node` 子路径导出）
 * - `NobleCryptoProvider`（兜底：@noble/ciphers 纯 JS AES-GCM）
 *
 * 该边界保证了 `packages/core` 在未来 Flutter 端可原样复用（PRD X-08）。
 */
import type { EncryptedPayload } from '../models/common';
import type { KdfParams } from './kdf';

/**
 * 密码学能力端口。
 *
 * 说明：所有方法均为异步或同步的纯计算，**不含任何网络出口**（X-01 ①）。
 */
export interface CryptoProvider {
  /** 实现标识，写入审计日志，如 'web-crypto' | 'node-crypto' | 'noble'。 */
  readonly name: string;
  /** 当前环境是否可用（不可用时上层应给出中文提示而非崩溃）。 */
  readonly isAvailable: boolean;

  /**
   * 生成密码学安全随机字节。
   *
   * @param length 字节长度，必须 ≥ 1
   * @returns 随机字节数组
   * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 长度非法
   */
  randomBytes(length: number): Uint8Array;

  /**
   * 由口令派生密钥。
   *
   * 说明：同一 `(params, password)` 必须产出**完全一致**的结果（可复现，A-07 ③）；
   * Web 与 Node 两个实现必须交叉一致（系统设计 §5 假设 A-6）。
   *
   * @param params KDF 参数
   * @param password 用户口令
   * @returns 派生出的密钥字节数组
   */
  deriveKey(params: KdfParams, password: string): Promise<Uint8Array>;

  /**
   * AES-256-GCM 加密。
   *
   * @param key 加密密钥（32 字节）
   * @param plaintext 明文数据
   * @param aad 附加认证数据（参与认证，篡改即解密失败）
   * @returns 含独立随机 96 位 IV 的加密载荷
   */
  encrypt(key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Promise<EncryptedPayload>;

  /**
   * AES-256-GCM 解密。
   *
   * 说明：`ciphertext` / `iv` / `aad` 任一被篡改必须抛错，且**绝不返回部分明文**（NF-S-4）。
   *
   * @param key 解密密钥（32 字节）
   * @param payload 加密载荷
   * @param aad 附加认证数据
   * @returns 解密后的明文
   */
  decrypt(key: Uint8Array, payload: EncryptedPayload, aad: Uint8Array): Promise<Uint8Array>;

  /**
   * 计算 SHA-256 摘要。
   *
   * @param data 待摘要数据
   * @returns 32 字节摘要
   */
  sha256(data: Uint8Array): Promise<Uint8Array>;
}

export type { EncryptedPayload } from '../models/common';
export type { KdfParams } from './kdf';
