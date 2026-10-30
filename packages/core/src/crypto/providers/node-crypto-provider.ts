/**
 * Node.js 密码学实现（加速路径）。
 *
 * 架构位置：core 包的「适配器」层，实现 `CryptoProvider` 端口。
 *
 * 说明：本模块**仅通过 `@lifehub/core/node` 子路径导出**，浏览器构建不会打进 `node:crypto`。
 * 相比 Web 端纯 JS scrypt，Node 原生 `scryptSync` 显著更快（解锁耗时约 0.8s → 0.25s），
 * 因此用于测试与将来的同步服务（系统设计 §1.3）。
 *
 * 注意：本文件是 core 包中唯一允许 `import 'node:crypto'` 的地方。
 */
import { createHash, randomFillSync, scryptSync, webcrypto } from 'node:crypto';
import { GCM_TAG_LENGTH, IV_LENGTH } from '../../constants';
import { LifeHubError } from '../../errors';
import type { EncryptedPayload } from '../../models/common';
import { utf8Encode } from '../../utils/bytes';
import type { KdfParams } from '../kdf';
import type { CryptoProvider } from '../provider';

/**
 * WebCrypto 接受的数据源类型。
 *
 * 说明：`BufferSource` 属于 DOM 类型，核心包在 `lib: ["ES2022"]` 下没有它，
 * 因此这里用本地等价类型（`Uint8Array` 即可满足 webcrypto 的要求）。
 */
type BinarySource = Uint8Array;

/**
 * Node 密码学能力实现。
 *
 * 说明：scrypt 走 `node:crypto` 原生实现，AES-GCM 与 SHA-256 仍走 `webcrypto.subtle`，
 * 保证与 Web 端产生**完全一致**的密文与摘要（可交叉验证，系统设计 §5 假设 A-6）。
 */
export class NodeCryptoProvider implements CryptoProvider {
  /** 实现标识。 */
  readonly name = 'node-crypto';

  /**
   * 构造 Node 实现。
   */
  constructor() {
    // 仅做一次可用性探测，构造失败时由 isAvailable 反映。
  }

  /** 当前环境是否可用。 */
  get isAvailable(): boolean {
    return typeof scryptSync === 'function' && typeof webcrypto?.subtle?.encrypt === 'function';
  }

  /**
   * 生成密码学安全随机字节。
   *
   * @param length 字节长度，必须 ≥ 1
   * @returns 随机字节数组
   * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 长度非法
   */
  randomBytes(length: number): Uint8Array {
    if (!Number.isInteger(length) || length < 1) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', '随机字节长度必须是不小于 1 的整数');
    }
    return randomFillSync(new Uint8Array(length));
  }

  /**
   * 由口令派生密钥（scrypt，原生实现）。
   *
   * @param params KDF 参数
   * @param password 用户口令
   * @returns 派生出的密钥字节数组
   * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 参数非法
   */
  async deriveKey(params: KdfParams, password: string): Promise<Uint8Array> {
    const maxmem = 64 * 1024 * 1024;
    return scryptSync(utf8Encode(password), params.salt, params.keyLength, {
      N: params.n,
      r: params.r,
      p: params.p,
      maxmem,
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
    const cryptoKey = await webcrypto.subtle.importKey(
      'raw',
      key as unknown as BinarySource,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    const combined = await webcrypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as unknown as BinarySource, additionalData: aad as unknown as BinarySource },
      cryptoKey,
      plaintext as unknown as BinarySource,
    );
    const bytes = new Uint8Array(combined);
    const tag = bytes.slice(bytes.length - GCM_TAG_LENGTH);
    const ciphertext = bytes.slice(0, bytes.length - GCM_TAG_LENGTH);
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
    const cryptoKey = await webcrypto.subtle.importKey(
      'raw',
      key as unknown as BinarySource,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    const merged = new Uint8Array(payload.ciphertext.length + payload.tag.length);
    merged.set(payload.ciphertext, 0);
    merged.set(payload.tag, payload.ciphertext.length);
    const plaintext = await webcrypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: payload.iv as unknown as BinarySource,
        additionalData: aad as unknown as BinarySource,
      },
      cryptoKey,
      merged as unknown as BinarySource,
    );
    return new Uint8Array(plaintext);
  }

  /**
   * 计算 SHA-256 摘要。
   *
   * @param data 待摘要数据
   * @returns 32 字节摘要
   */
  async sha256(data: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(createHash('sha256').update(data).digest());
  }
}
