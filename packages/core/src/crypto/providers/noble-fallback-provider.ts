/**
 * 纯 JS 兜底密码学实现。
 *
 * 架构位置：core 包的「适配器」层，实现 `CryptoProvider` 端口。
 *
 * 说明：仅用于极少数没有 WebCrypto 的环境（如老旧 WebView）。
 * **不作为默认路径**（NF-P-4：加密吞吐优先走平台原生实现）。
 */
import { gcm } from '@noble/ciphers/aes';
import { scryptAsync } from '@noble/hashes/scrypt';
import { GCM_TAG_LENGTH, IV_LENGTH } from '../../constants';
import { LifeHubError } from '../../errors';
import type { EncryptedPayload } from '../../models/common';
import { utf8Encode } from '../../utils/bytes';
import type { KdfParams } from '../kdf';
import type { CryptoProvider } from '../provider';

/**
 * 纯 JS 兜底实现。
 *
 * 说明：AES-GCM 走 `@noble/ciphers` 的 `gcm` 模式；SHA-256 走 `@noble/hashes`。
 */
export class NobleCryptoProvider implements CryptoProvider {
  /** 实现标识。 */
  readonly name = 'noble';

  /**
   * 构造兜底实现。
   */
  constructor() {
    // 纯 JS 实现无需任何平台能力探测。
  }

  /**
   * 当前环境是否可用。
   *
   * @returns 存在 subtle 与随机源时返回 true
   */
  get isAvailable(): boolean {
    return true;
  }

  /**
   * 生成密码学安全随机字节。
   *
   * @param length 字节长度，必须 ≥ 1
   * @returns 随机字节数组
   * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 长度非法或无随机源
   */
  randomBytes(length: number): Uint8Array {
    if (!Number.isInteger(length) || length < 1) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', '随机字节长度必须是不小于 1 的整数');
    }
    const scope = globalThis as unknown as {
      crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array };
    };
    const source = scope.crypto?.getRandomValues;
    if (!source) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', '当前环境没有可用的密码学随机源');
    }
    // 绑定 this：某些实现要求调用者是 crypto 对象本身。
    return source.bind(scope.crypto)(new Uint8Array(length));
  }

  /**
   * 由口令派生密钥（scrypt）。
   *
   * @param params KDF 参数
   * @param password 用户口令
   * @returns 派生出的密钥字节数组
   */
  async deriveKey(params: KdfParams, password: string): Promise<Uint8Array> {
    return scryptAsync(utf8Encode(password), params.salt, {
      N: params.n,
      r: params.r,
      p: params.p,
      dkLen: params.keyLength,
      maxmem: 64 * 1024 * 1024,
    });
  }

  /**
   * AES-256-GCM 加密。
   *
   * @param key 加密密钥（32 字节）
   * @param plaintext 明文数据
   * @param aad 附加认证数据
   * @returns 含独立随机 96 位 IV 的加密载荷
   */
  async encrypt(key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Promise<EncryptedPayload> {
    const iv = this.randomBytes(IV_LENGTH);
    // noble 的 gcm 输出 ciphertext || tag，需要与 WebCrypto 保持同样的切分方式。
    const combined = gcm(key, iv, aad).encrypt(plaintext);
    const tag = combined.slice(combined.length - GCM_TAG_LENGTH);
    const ciphertext = combined.slice(0, combined.length - GCM_TAG_LENGTH);
    return { kind: 'encrypted', algorithm: 'AES-256-GCM', iv, ciphertext, tag, keyVersion: 1 };
  }

  /**
   * AES-256-GCM 解密。
   *
   * @param key 解密密钥（32 字节）
   * @param payload 加密载荷
   * @param aad 附加认证数据
   * @returns 解密后的明文
   */
  async decrypt(key: Uint8Array, payload: EncryptedPayload, aad: Uint8Array): Promise<Uint8Array> {
    const merged = new Uint8Array(payload.ciphertext.length + payload.tag.length);
    merged.set(payload.ciphertext, 0);
    merged.set(payload.tag, payload.ciphertext.length);
    return gcm(key, payload.iv, aad).decrypt(merged);
  }

  /**
   * 计算 SHA-256 摘要。
   *
   * @param data 待摘要数据
   * @returns 32 字节摘要
   */
  async sha256(data: Uint8Array): Promise<Uint8Array> {
    const { sha256 } = await import('@noble/hashes/sha256');
    return sha256(data);
  }
}
