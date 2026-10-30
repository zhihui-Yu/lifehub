/**
 * WebCrypto 密码学实现（默认实现）。
 *
 * 架构位置：core 包的「适配器」层，实现 `CryptoProvider` 端口。
 *
 * 设计要点（系统设计 §1.3）：
 * - AES-GCM 与 SHA-256 走**平台原生** `crypto.subtle`（浏览器与 Node 22 均有），性能最好；
 * - scrypt 走 `@noble/hashes/scrypt`（纯 JS），因为 WebCrypto 不支持 scrypt；
 * - 通过 `globalThis.crypto` 访问密码学能力，而不是 `window.crypto`，
 *   这样同一份实现可在 Node 测试环境复用，且核心层保持零 DOM 依赖（架构红线 R1）。
 */
import { scryptAsync } from '@noble/hashes/scrypt';
import { GCM_TAG_LENGTH, IV_LENGTH } from '../../constants';
import { LifeHubError } from '../../errors';
import type { EncryptedPayload } from '../../models/common';
import { utf8Encode } from '../../utils/bytes';
import type { KdfParams } from '../kdf';
import type { CryptoProvider } from '../provider';

/**
 * 极小的 SubtleCrypto 结构类型。
 *
 * 说明：自行声明而非依赖 DOM 类型，是为了让核心包在 `lib: ["ES2022"]`（无 DOM）下
 * 也能通过 `tsc --noEmit`（架构红线 R1 / PRD A-01 ②）。
 */
interface SubtleLike {
  importKey(
    format: 'raw',
    keyData: Uint8Array,
    algorithm: { name: 'AES-GCM'; length: number },
    extractable: boolean,
    keyUsages: string[],
  ): Promise<unknown>;
  encrypt(
    algorithm: { name: 'AES-GCM'; iv: Uint8Array; additionalData: Uint8Array; tagLength: number },
    key: unknown,
    data: Uint8Array,
  ): Promise<ArrayBuffer>;
  decrypt(
    algorithm: { name: 'AES-GCM'; iv: Uint8Array; additionalData: Uint8Array; tagLength: number },
    key: unknown,
    data: Uint8Array,
  ): Promise<ArrayBuffer>;
  digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer>;
}

/** 平台密码学能力的最小结构类型。 */
interface CryptoLike {
  subtle?: SubtleLike;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
}

/**
 * WebCrypto 密码学能力实现。
 *
 * 说明：默认路径。浏览器与 Node 22 均可直接使用。
 */
export class WebCryptoProvider implements CryptoProvider {
  /** 实现标识。 */
  readonly name = 'web-crypto';

  /** 平台密码学能力对象。 */
  private readonly scope: CryptoLike;

  /** 随机字节源（已绑定 this，避免脱离宿主对象调用）。 */
  private readonly randomSource: ((array: Uint8Array) => Uint8Array) | undefined;

  /**
   * 构造 WebCrypto 实现。
   *
   * @param scope 可选的密码学能力对象（测试时注入替身）
   */
  constructor(scope?: CryptoLike) {
    const global = globalThis as unknown as { crypto?: CryptoLike };
    this.scope = scope ?? global.crypto ?? {};
    const source = this.scope.getRandomValues;
    // 绑定 this：某些实现（Node 的 webcrypto）要求调用者是 crypto 对象本身。
    this.randomSource = source ? source.bind(this.scope) : undefined;
  }

  /**
   * 当前环境是否可用。
   *
   * @returns 存在 subtle 与随机源时返回 true
   */
  get isAvailable(): boolean {
    return Boolean(this.scope.subtle) && typeof this.randomSource === 'function';
  }

  /**
   * 生成密码学安全随机字节。
   *
   * @param length 字节长度，必须 ≥ 1
   * @returns 随机字节数组
   * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 长度非法或当前环境无随机源
   */
  randomBytes(length: number): Uint8Array {
    if (!Number.isInteger(length) || length < 1) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', '随机字节长度必须是不小于 1 的整数');
    }
    if (!this.randomSource) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', '当前环境没有可用的密码学随机源');
    }
    const bytes = new Uint8Array(length);
    // getRandomValues 单次上限为 65536 字节，超长时需要分段填充。
    const chunkSize = 65_536;
    for (let offset = 0; offset < length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, length));
      this.randomSource(chunk);
    }
    return bytes;
  }

  /**
   * 由口令派生密钥（scrypt）。
   *
   * 说明：`@noble/hashes` 的 scrypt 需要 `maxmem` 足够大——
   * N=32768、r=8 时约需 33.5MB 内存，不设置会在部分环境直接抛错。
   *
   * @param params KDF 参数
   * @param password 用户口令
   * @returns 派生出的密钥字节数组
   * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 参数非法
   */
  async deriveKey(params: KdfParams, password: string): Promise<Uint8Array> {
    const maxmem = 64 * 1024 * 1024;
    return scryptAsync(utf8Encode(password), params.salt, {
      N: params.n,
      r: params.r,
      p: params.p,
      dkLen: params.keyLength,
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
   * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 当前环境无 WebCrypto
   */
  async encrypt(key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Promise<EncryptedPayload> {
    const subtle = this.requireSubtle();
    const iv = this.randomBytes(IV_LENGTH);
    const cryptoKey = await subtle.importKey('raw', key, { name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    const combined = await subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad, tagLength: GCM_TAG_LENGTH * 8 },
      cryptoKey,
      plaintext,
    );
    // WebCrypto 输出的是 ciphertext || tag 合并体，需要拆成独立字段以保持 EncryptedPayload 契约稳定。
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
   * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 当前环境无 WebCrypto（认证失败由调用方归一）
   */
  async decrypt(key: Uint8Array, payload: EncryptedPayload, aad: Uint8Array): Promise<Uint8Array> {
    const subtle = this.requireSubtle();
    const cryptoKey = await subtle.importKey('raw', key, { name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    const merged = new Uint8Array(payload.ciphertext.length + payload.tag.length);
    merged.set(payload.ciphertext, 0);
    merged.set(payload.tag, payload.ciphertext.length);
    const plaintext = await subtle.decrypt(
      { name: 'AES-GCM', iv: payload.iv, additionalData: aad, tagLength: GCM_TAG_LENGTH * 8 },
      cryptoKey,
      merged,
    );
    return new Uint8Array(plaintext);
  }

  /**
   * 计算 SHA-256 摘要。
   *
   * @param data 待摘要数据
   * @returns 32 字节摘要
   * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 当前环境无 WebCrypto
   */
  async sha256(data: Uint8Array): Promise<Uint8Array> {
    const subtle = this.requireSubtle();
    const digest = await subtle.digest('SHA-256', data);
    return new Uint8Array(digest);
  }

  /**
   * 取出 SubtleCrypto，缺失时抛出中文异常。
   *
   * @returns SubtleCrypto 结构对象
   * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 当前环境不支持 WebCrypto
   */
  private requireSubtle(): SubtleLike {
    const subtle = this.scope.subtle;
    if (!subtle) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', '当前环境不支持 WebCrypto，请改用兜底实现');
    }
    return subtle;
  }
}
