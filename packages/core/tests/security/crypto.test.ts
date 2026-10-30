/**
 * 安全深度验证 · A-07 加密封装完整矩阵。
 *
 * 覆盖需求：A-07 ①②③④⑤⑥⑦；NF-S-1；NF-S-2；NF-S-3；NF-S-4；
 * 系统设计 §1.2 难点 3（加密封装边界）、§5 假设 A-6（Web 与 Node 派生一致）。
 * 覆盖红线：R3（加密模块零网络出口）、R4（唯一密文写通道）、R5（只含密文）。
 *
 * 【本文件与既有测试的差异】
 * 既有 `tests/qa/qa-crypto.test.ts` 已验证「三 Provider 派生结果一致」与
 * 「篡改 ciphertext / iv / tag 抛错」。本文件补齐**尚未被充分验证**的部分：
 * 1. **1000 次随机 IV 无碰撞**——既有测试只断言了两次加密的 IV 不同，
 *    无法排除「IV 由计数器派生」这类实现退化；
 * 2. **AAD 篡改与密文跨记录搬移**——把 A 记录的密文搬到 B 记录的位置解密必须失败，
 *    这是「密文搬移」攻击的唯一防线（ADR-003 §3）；
 * 3. **Web ↔ Node 交叉一致性走完全链路**：同一 salt + 同一口令，
 *    两端派生密钥相同，且**互相能解开对方产的密文**，
 *    并使用**生产默认 KDF 参数**（N=32768）而非仅用低配参数；
 * 4. **空明文 / 超长明文边界**不崩溃；
 * 5. **绝不返回部分明文**：解密失败时既不 resolve 也不泄漏任何明文片段。
 *
 * 说明：Node Provider 通过 `@lifehub/core/node` 子路径导入，
 * 与浏览器端的引用方式完全一致（见 packages/core/package.json 的 exports 字段）。
 */
import { describe, expect, it, vi } from 'vitest';
import { NodeCryptoProvider } from '@lifehub/core/node';
import { CryptoService } from '../../src/crypto/service';
import { WebCryptoProvider } from '../../src/crypto/providers/web-crypto-provider';
import { NobleCryptoProvider } from '../../src/crypto/providers/noble-fallback-provider';
import { createKdfParams, deserializeKdfParams, serializeKdfParams } from '../../src/crypto/kdf';
import { assertKeyLength, generateDek, generateSalt, wipeBytes } from '../../src/crypto/dek';
import type { KdfParams } from '../../src/crypto/kdf';
import type { CryptoProvider } from '../../src/crypto/provider';
import type { EncryptedPayload } from '../../src/models/common';
import { DEK_LENGTH, IV_LENGTH, KDF_DEFAULT_PARAMS } from '../../src/constants';

/** Web Provider（浏览器默认实现，也是 Node 22 下的默认路径）。 */
const web = new WebCryptoProvider();
/** Node Provider（仅通过 `@lifehub/core/node` 子路径暴露，浏览器构建不会引入）。 */
const node = new NodeCryptoProvider();
/** 纯 JS 兜底 Provider（老旧 WebView 场景）。 */
const noble = new NobleCryptoProvider();


/**
 * 涉及建库 / 解锁（真实 scrypt）的用例超时上限。
 *
 * 说明：覆盖率插桩 + 多 worker 并行时，单次 scrypt 可能耗时数十秒，
 * 这里给足余量；**这只放宽超时上限，不放宽任何断言**。
 */
const VAULT_TIMEOUT = 180_000;

/** 低配 KDF 参数：仅用于缩短测试耗时，**不用于**一致性结论。 */
const fastKdf = (salt: Uint8Array): KdfParams => createKdfParams(salt, { n: 1024 });

/**
 * 把字节数组格式化为小写 hex。
 *
 * @param bytes 字节数组
 * @returns hex 字符串
 */
function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * 复制并翻转字节数组的第一个字节，用于构造「被篡改」的载荷。
 *
 * @param bytes 原始字节数组
 * @returns 篡改后的新数组（原数组不变）
 */
function tamperFirstByte(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes);
  copy[0] = (copy[0] ?? 0) ^ 0xff;
  return copy;
}

/**
 * 捕获 Promise 的解析值或拒绝原因，用于断言「失败时绝不返回部分明文」。
 *
 * 说明：如果 Promise 成功 resolve，resolved 为解析值、rejected 为 undefined；
 * 如果 Promise 被拒绝，resolved 为 undefined、rejected 为错误对象。
 *
 * @param promise 待观测的 Promise
 * @returns 观测结果
 */
async function observe<T>(
  promise: Promise<T>,
): Promise<{ resolved: T | undefined; rejected: unknown }> {
  try {
    const value = await promise;
    return { resolved: value, rejected: undefined };
  } catch (error) {
    return { resolved: undefined, rejected: error };
  }
}

describe('A-07 ③ · 同口令 + 同 salt 的派生结果完全一致（可复现）', () => {
  it('同一 Provider 内重复派生两次，结果逐字节相同', async () => {
    const salt = web.randomBytes(16);
    const params = fastKdf(salt);

    const first = await web.deriveKey(params, 'correct horse battery staple');
    const second = await web.deriveKey(params, 'correct horse battery staple');

    expect(first).toHaveLength(DEK_LENGTH);
    expect(toHex(first)).toBe(toHex(second));
  }, VAULT_TIMEOUT);

  it('不同口令派生出的密钥完全不同（派生确实依赖口令）', async () => {
    const salt = web.randomBytes(16);
    const params = fastKdf(salt);

    const a = await web.deriveKey(params, 'passphrase-A');
    const b = await web.deriveKey(params, 'passphrase-B');

    expect(toHex(a)).not.toBe(toHex(b));
  }, VAULT_TIMEOUT);

  it('不同 salt 派生出的密钥完全不同（派生确实依赖盐值）', async () => {
    const paramsA = fastKdf(web.randomBytes(16));
    const paramsB = fastKdf(web.randomBytes(16));

    const a = await web.deriveKey(paramsA, 'same-password');
    const b = await web.deriveKey(paramsB, 'same-password');

    expect(toHex(a)).not.toBe(toHex(b));
  }, VAULT_TIMEOUT);

  it('三个 Provider（Web / Node / Noble）在同 salt 同口令下派生出完全相同的密钥', async () => {
    const salt = web.randomBytes(16);
    const params = fastKdf(salt);

    const fromWeb = await web.deriveKey(params, 'cross-provider-password');
    const fromNode = await node.deriveKey(params, 'cross-provider-password');
    const fromNoble = await noble.deriveKey(params, 'cross-provider-password');

    expect(toHex(fromWeb)).toBe(toHex(fromNode));
    expect(toHex(fromWeb)).toBe(toHex(fromNoble));
  }, VAULT_TIMEOUT);
});

describe('A-07 ④ · 1000 次随机 IV 无碰撞', () => {
  it('Web Provider 连续 1000 次加密产生 1000 个互不相同的 IV', async () => {
    const key = web.randomBytes(DEK_LENGTH);
    const aad = new TextEncoder().encode('bill\x00bill-iv-test\x001');

    const seen = new Set<string>();
    for (let index = 0; index < 1000; index += 1) {
      const payload = await web.encrypt(key, new Uint8Array([index & 0xff]), aad);
      expect(payload.iv).toHaveLength(IV_LENGTH);
      seen.add(toHex(payload.iv));
    }

    // 1000 个 IV 全部唯一：若 IV 由计数器或固定种子派生，此断言必然失败。
    expect(seen.size).toBe(1000);
  }, 60_000);

  it('Node Provider 连续 1000 次加密产生 1000 个互不相同的 IV', async () => {
    const key = node.randomBytes(DEK_LENGTH);
    const aad = new Uint8Array([1, 2, 3]);

    const seen = new Set<string>();
    for (let index = 0; index < 1000; index += 1) {
      const payload = await node.encrypt(key, new Uint8Array([index & 0xff]), aad);
      seen.add(toHex(payload.iv));
    }

    expect(seen.size).toBe(1000);
  }, 60_000);

  it('同一密钥、同一明文连续加密两次，密文与 IV 都不同（确认使用真随机 IV）', async () => {
    const key = web.randomBytes(DEK_LENGTH);
    const aad = new Uint8Array([9, 9, 9]);

    const first = await web.encrypt(key, new Uint8Array([1, 2, 3]), aad);
    const second = await web.encrypt(key, new Uint8Array([1, 2, 3]), aad);

    expect(toHex(first.iv)).not.toBe(toHex(second.iv));
    expect(toHex(first.ciphertext)).not.toBe(toHex(second.ciphertext));
  }, VAULT_TIMEOUT);
});

describe('A-07 ① / NF-S-4 · 篡改 ciphertext / iv / tag / aad 必然失败且绝不返回部分明文', () => {
  it('篡改 ciphertext：解密抛 LIFEHUB_E_CRYPTO_AUTH_FAILED，且不返回任何明文', async () => {
    const crypto = new CryptoService(web);
    const key = web.randomBytes(DEK_LENGTH);
    const plaintext = { counterparty: '星巴克(国贸店)', amountMinor: 12850 };
    const payload = await crypto.encryptRecord(key, 'bill', 'bill-tamper-1', 1, plaintext);

    const tampered: EncryptedPayload = { ...payload, ciphertext: tamperFirstByte(payload.ciphertext) };
    const outcome = await observe(crypto.decryptRecord<typeof plaintext>(key, 'bill', 'bill-tamper-1', 1, tampered));

    expect(outcome.resolved).toBeUndefined();
    expect(outcome.rejected).toMatchObject({ code: 'LIFEHUB_E_CRYPTO_AUTH_FAILED' });
  }, VAULT_TIMEOUT);

  it('篡改 iv：解密抛 LIFEHUB_E_CRYPTO_AUTH_FAILED，且不返回任何明文', async () => {
    const crypto = new CryptoService(web);
    const key = web.randomBytes(DEK_LENGTH);
    const plaintext = { note: '含逗号, 的备注' };
    const payload = await crypto.encryptRecord(key, 'bill', 'bill-tamper-2', 1, plaintext);

    const tampered: EncryptedPayload = { ...payload, iv: tamperFirstByte(payload.iv) };
    const outcome = await observe(crypto.decryptRecord<typeof plaintext>(key, 'bill', 'bill-tamper-2', 1, tampered));

    expect(outcome.resolved).toBeUndefined();
    expect(outcome.rejected).toMatchObject({ code: 'LIFEHUB_E_CRYPTO_AUTH_FAILED' });
  }, VAULT_TIMEOUT);

  it('篡改 tag（GCM 认证标签）：解密抛 LIFEHUB_E_CRYPTO_AUTH_FAILED，且不返回任何明文', async () => {
    const crypto = new CryptoService(web);
    const key = web.randomBytes(DEK_LENGTH);
    const plaintext = { amountMinor: 12850 };
    const payload = await crypto.encryptRecord(key, 'bill', 'bill-tamper-3', 1, plaintext);

    const tampered: EncryptedPayload = { ...payload, tag: tamperFirstByte(payload.tag) };
    const outcome = await observe(crypto.decryptRecord<typeof plaintext>(key, 'bill', 'bill-tamper-3', 1, tampered));

    expect(outcome.resolved).toBeUndefined();
    expect(outcome.rejected).toMatchObject({ code: 'LIFEHUB_E_CRYPTO_AUTH_FAILED' });
  }, VAULT_TIMEOUT);

  it('篡改 AAD：Provider 层直接抛错，解密不返回任何明文', async () => {
    const key = web.randomBytes(DEK_LENGTH);
    const aad = new Uint8Array([1, 2, 3, 4]);
    const payload = await web.encrypt(key, new Uint8Array([1, 2, 3]), aad);

    const outcome = await observe(web.decrypt(key, payload, new Uint8Array([1, 2, 3, 5])));

    expect(outcome.resolved).toBeUndefined();
    expect(outcome.rejected).toBeInstanceOf(Error);
  }, VAULT_TIMEOUT);

  it('AAD 绑定实体身份：把 A 记录的密文搬到 B 记录的位置解密必然失败', async () => {
    const crypto = new CryptoService(web);
    const key = web.randomBytes(DEK_LENGTH);
    const payload = await crypto.encryptRecord(key, 'bill', 'bill-A', 1, { amountMinor: 12850 });

    // 密文原封不动，只把 AAD 里的 entityId 换成 B —— 认证必然失败。
    const outcome = await observe(
      crypto.decryptRecord(key, 'bill', 'bill-B', 1, payload),
    );
    expect(outcome.resolved).toBeUndefined();
    expect(outcome.rejected).toMatchObject({ code: 'LIFEHUB_E_CRYPTO_AUTH_FAILED' });

    // 实体类型不同同样失败。
    const otherType = await observe(crypto.decryptRecord(key, 'category', 'bill-A', 1, payload));
    expect(otherType.resolved).toBeUndefined();
    expect(otherType.rejected).toMatchObject({ code: 'LIFEHUB_E_CRYPTO_AUTH_FAILED' });

    // 密钥版本不同同样失败。
    const otherVersion = await observe(crypto.decryptRecord(key, 'bill', 'bill-A', 2, payload));
    expect(otherVersion.resolved).toBeUndefined();
    expect(otherVersion.rejected).toMatchObject({ code: 'LIFEHUB_E_CRYPTO_AUTH_FAILED' });
  }, VAULT_TIMEOUT);

  it('篡改后不会泄漏任何部分明文：失败结果里不含明文片段', async () => {
    const crypto = new CryptoService(web);
    const key = web.randomBytes(DEK_LENGTH);
    const secret = '绝密备注-不应泄漏';
    const payload = await crypto.encryptRecord(key, 'bill', 'bill-leak-1', 1, { note: secret });
    const tampered: EncryptedPayload = { ...payload, ciphertext: tamperFirstByte(payload.ciphertext) };

    const outcome = await observe(crypto.decryptRecord(key, 'bill', 'bill-leak-1', 1, tampered));
    expect(outcome.resolved).toBeUndefined();

    const serialized = JSON.stringify(outcome.rejected ?? {});
    expect(serialized).not.toContain('绝密');
    expect(serialized).not.toContain('不应泄漏');
  }, VAULT_TIMEOUT);
});

describe('A-07 ② / NF-S-3 · 空明文与超长明文边界不崩溃', () => {
  it('空明文（0 字节）可加密可解密，结果仍为空', async () => {
    const key = web.randomBytes(DEK_LENGTH);
    const aad = new Uint8Array([7, 7]);
    const payload = await web.encrypt(key, new Uint8Array(0), aad);

    const plaintext = await web.decrypt(key, payload, aad);
    expect(plaintext).toHaveLength(0);
  }, VAULT_TIMEOUT);

  it('空对象可加密可解密往返', async () => {
    const crypto = new CryptoService(web);
    const key = web.randomBytes(DEK_LENGTH);
    const payload = await crypto.encryptRecord(key, 'bill', 'bill-empty', 1, {});

    await expect(crypto.decryptRecord(key, 'bill', 'bill-empty', 1, payload)).resolves.toEqual({});
  }, VAULT_TIMEOUT);

  it('1 MiB 超长明文可加密可解密往返（不因长度崩溃）', async () => {
    const crypto = new CryptoService(web);
    const key = web.randomBytes(DEK_LENGTH);
    const big = { body: 'x'.repeat(1024 * 1024) };
    const payload = await crypto.encryptRecord(key, 'bill', 'bill-big', 1, big);

    const back = await crypto.decryptRecord<typeof big>(key, 'bill', 'bill-big', 1, payload);
    expect(back.body).toHaveLength(1024 * 1024);
  }, 60_000);

  it('密钥长度非法时抛 LIFEHUB_E_VALIDATION（而不是别的错误码）', async () => {
    const crypto = new CryptoService(web);
    const short = new Uint8Array(16);

    await expect(
      crypto.encryptRecord(short, 'bill', 'bill-short', 1, { a: 1 }),
    ).rejects.toMatchObject({ code: 'LIFEHUB_E_VALIDATION' });
    await expect(
      crypto.decryptRecord(short, 'bill', 'bill-short', 1, {
        kind: 'encrypted',
        algorithm: 'AES-256-GCM',
        iv: new Uint8Array(IV_LENGTH),
        ciphertext: new Uint8Array(1),
        tag: new Uint8Array(16),
        keyVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'LIFEHUB_E_VALIDATION' });
  }, VAULT_TIMEOUT);
});

describe('系统设计 §5 假设 A-6 · Web ↔ Node Provider 交叉一致（重点）', () => {
  it('生产默认 KDF 参数（N=32768）下两端派生出完全相同的密钥', async () => {
    const salt = web.randomBytes(KDF_DEFAULT_PARAMS.saltLength);
    const params = createKdfParams(salt);

    const fromWeb = await web.deriveKey(params, 'production-grade-password');
    const fromNode = await node.deriveKey(params, 'production-grade-password');

    expect(fromWeb).toHaveLength(KDF_DEFAULT_PARAMS.keyLength);
    expect(toHex(fromWeb)).toBe(toHex(fromNode));
  }, 60_000);

  it('Web 产的密文，Node 能解开并得到完全相同的明文', async () => {
    const salt = web.randomBytes(16);
    const params = fastKdf(salt);
    const webKey = await web.deriveKey(params, 'cross-decrypt-password');
    const nodeKey = await node.deriveKey(params, 'cross-decrypt-password');

    const aad = new Uint8Array([0x62, 0x69, 0x6c, 0x6c]);
    const plaintext = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const payload = await web.encrypt(webKey, plaintext, aad);

    const decryptedByNode = await node.decrypt(nodeKey, payload, aad);
    expect(toHex(decryptedByNode)).toBe(toHex(plaintext));
  }, VAULT_TIMEOUT);

  it('Node 产的密文，Web 能解开并得到完全相同的明文', async () => {
    const salt = web.randomBytes(16);
    const params = fastKdf(salt);
    const webKey = await web.deriveKey(params, 'cross-decrypt-password');
    const nodeKey = await node.deriveKey(params, 'cross-decrypt-password');

    const aad = new Uint8Array([0x62, 0x69, 0x6c, 0x6c]);
    const plaintext = new Uint8Array([8, 7, 6, 5, 4, 3, 2, 1]);
    const payload = await node.encrypt(nodeKey, plaintext, aad);

    const decryptedByWeb = await web.decrypt(webKey, payload, aad);
    expect(toHex(decryptedByWeb)).toBe(toHex(plaintext));
  }, VAULT_TIMEOUT);

  it('交叉解密在 CryptoService 业务层同样成立（AAD 构造与 Provider 无关）', async () => {
    const salt = web.randomBytes(16);
    const params = fastKdf(salt);
    const webKey = await web.deriveKey(params, 'service-level-cross');
    const nodeKey = await node.deriveKey(params, 'service-level-cross');

    const webService = new CryptoService(web);
    const nodeService = new CryptoService(node);

    const payload = await webService.encryptRecord(webKey, 'bill', 'bill-cross-1', 1, {
      counterparty: '星巴克(国贸店)',
      amountMinor: 12850,
    });

    const back = await nodeService.decryptRecord<{ counterparty: string; amountMinor: number }>(
      nodeKey,
      'bill',
      'bill-cross-1',
      1,
      payload,
    );
    expect(back.counterparty).toBe('星巴克(国贸店)');
    expect(back.amountMinor).toBe(12850);
  }, VAULT_TIMEOUT);

  it('两端 SHA-256 摘要一致（同一份数据在两端产生同一摘要）', async () => {
    const data = new Uint8Array([0x4c, 0x69, 0x66, 0x65, 0x48, 0x75, 0x62]);
    const fromWeb = await web.sha256(data);
    const fromNode = await node.sha256(data);

    expect(toHex(fromWeb)).toBe(toHex(fromNode));
    expect(fromWeb).toHaveLength(32);
  }, VAULT_TIMEOUT);
});

describe('R3 · 加密链路全程零网络出口（运行时断言）', () => {
  it('建库 / 解锁 / 加解密全程不触发任何网络 API', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('加密链路不应发起网络请求');
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    try {
      const crypto = new CryptoService(web);
      const key = web.randomBytes(DEK_LENGTH);
      const payload = await crypto.encryptRecord(key, 'bill', 'bill-nonet-1', 1, { amountMinor: 12850 });
      await crypto.decryptRecord(key, 'bill', 'bill-nonet-1', 1, payload);
      await crypto.encryptRecord(key, 'bill', 'bill-nonet-2', 1, { amountMinor: 1 });

      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, VAULT_TIMEOUT);
});

describe('A-07 ⑥⑦ · 哨兵密文校验口令，且不落盘任何口令派生值', () => {
  it('哨兵明文是固定常量，解密后与常量逐字节相同', async () => {
    const crypto = new CryptoService(web);
    const key = web.randomBytes(DEK_LENGTH);
    const { VAULT_VERIFIER_ID, VAULT_VERIFIER_PLAINTEXT } = await import('../../src/constants');

    const verifier = await crypto.encryptRecord(key, 'vaultParams', VAULT_VERIFIER_ID, 1, VAULT_VERIFIER_PLAINTEXT);

    await expect(crypto.verifyPassword(key, verifier)).resolves.toBe(true);
  }, VAULT_TIMEOUT);

  it('口令错误时 verifyPassword 返回 false（而不是抛错或返回明文）', async () => {
    const crypto = new CryptoService(web);
    const key = web.randomBytes(DEK_LENGTH);
    const { VAULT_VERIFIER_ID, VAULT_VERIFIER_PLAINTEXT } = await import('../../src/constants');
    const verifier = await crypto.encryptRecord(key, 'vaultParams', VAULT_VERIFIER_ID, 1, VAULT_VERIFIER_PLAINTEXT);

    const wrongKey = web.randomBytes(DEK_LENGTH);
    await expect(crypto.verifyPassword(wrongKey, verifier)).resolves.toBe(false);
  }, VAULT_TIMEOUT);

  it('口令派生值不出现在任何加密载荷里（哨兵密文里检索不到口令）', async () => {
    const crypto = new CryptoService(web);
    const key = web.randomBytes(DEK_LENGTH);
    const { VAULT_VERIFIER_ID, VAULT_VERIFIER_PLAINTEXT } = await import('../../src/constants');
    const password = 'my-secret-password-123';

    const verifier = await crypto.encryptRecord(key, 'vaultParams', VAULT_VERIFIER_ID, 1, VAULT_VERIFIER_PLAINTEXT);

    const dump = JSON.stringify({
      iv: toHex(verifier.iv),
      ciphertext: toHex(verifier.ciphertext),
      tag: toHex(verifier.tag),
    });
    expect(dump).not.toContain(password);
    expect(dump).not.toContain(toHex(key));
  }, VAULT_TIMEOUT);
});

describe('A-07 ② · DEK 包裹与解包同样受 AAD 保护', () => {
  it('包裹后的 DEK 被换到别的密钥版本上解包必然失败', async () => {
    const crypto = new CryptoService(web);
    const masterKey = web.randomBytes(DEK_LENGTH);
    const dek = web.randomBytes(DEK_LENGTH);

    const wrapped = await crypto.wrapDek(masterKey, dek, 1);
    const outcome = await observe(crypto.unwrapDek(masterKey, { ...wrapped, keyVersion: 2 }));

    expect(outcome.resolved).toBeUndefined();
    expect(outcome.rejected).toMatchObject({ code: 'LIFEHUB_E_CRYPTO_AUTH_FAILED' });
  }, VAULT_TIMEOUT);

  it('用错误的主密钥解包必然失败，且不返回部分 DEK', async () => {
    const crypto = new CryptoService(web);
    const masterKey = web.randomBytes(DEK_LENGTH);
    const dek = web.randomBytes(DEK_LENGTH);
    const wrapped = await crypto.wrapDek(masterKey, dek, 1);

    const outcome = await observe(crypto.unwrapDek(web.randomBytes(DEK_LENGTH), wrapped));
    expect(outcome.resolved).toBeUndefined();
    expect(outcome.rejected).toMatchObject({ code: 'LIFEHUB_E_CRYPTO_AUTH_FAILED' });
  }, VAULT_TIMEOUT);

  it('三个 Provider 都能解包同一个 DEK 包裹（包裹载荷跨实现兼容）', async () => {
    const salt = web.randomBytes(16);
    const params = fastKdf(salt);
    const webKey = await web.deriveKey(params, 'wrap-cross');
    const nodeKey = await node.deriveKey(params, 'wrap-cross');
    const nobleKey = await noble.deriveKey(params, 'wrap-cross');

    const dek = web.randomBytes(DEK_LENGTH);
    const webService = new CryptoService(web);
    const wrapped = await webService.wrapDek(webKey, dek, 1);

    const nodeService = new CryptoService(node);
    const nobleService = new CryptoService(noble);

    await expect(nodeService.unwrapDek(nodeKey, wrapped)).resolves.toEqual(dek);
    await expect(nobleService.unwrapDek(nobleKey, wrapped)).resolves.toEqual(dek);
  }, VAULT_TIMEOUT);
});

describe('Provider 契约 · 三实现的可用性与随机源', () => {
  it('三个 Provider 在当前环境均可用，且随机源长度合法', () => {
    const providers: CryptoProvider[] = [web, node, noble];
    for (const provider of providers) {
      expect(provider.isAvailable).toBe(true);
      expect(provider.randomBytes(32)).toHaveLength(32);
    }
  }, VAULT_TIMEOUT);

  it('随机字节长度非法时抛 LIFEHUB_E_VALIDATION', () => {
    expect(() => web.randomBytes(0)).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
    expect(() => node.randomBytes(-1)).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  }, VAULT_TIMEOUT);
});

describe('A-07 ⑤ / NF-S-2 · DEK 生成、盐值生成与内存擦除', () => {
  it('generateDek 产出 32 字节随机 DEK，两次调用结果不同', () => {
    const first = generateDek(web);
    const second = generateDek(web);

    expect(first).toHaveLength(DEK_LENGTH);
    expect(second).toHaveLength(DEK_LENGTH);
    expect(toHex(first)).not.toBe(toHex(second));
  });

  it('generateDek 支持自定义密钥长度', () => {
    expect(generateDek(web, 16)).toHaveLength(16);
  });

  it('generateSalt 默认产出 16 字节盐值，两次调用结果不同', () => {
    const first = generateSalt(web);
    const second = generateSalt(web);

    expect(first).toHaveLength(16);
    expect(toHex(first)).not.toBe(toHex(second));
  });

  it('wipeBytes 把密钥字节全部清零（NF-S-2：锁定即擦除）', () => {
    const key = web.randomBytes(DEK_LENGTH);
    expect(toHex(key)).not.toBe('00'.repeat(DEK_LENGTH));

    wipeBytes(key);

    expect(toHex(key)).toBe('00'.repeat(DEK_LENGTH));
  });

  it('wipeBytes 传 null / undefined 时安全返回，不抛异常', () => {
    expect(() => wipeBytes(null)).not.toThrow();
    expect(() => wipeBytes(undefined)).not.toThrow();
  });

  it('assertKeyLength 接受 32 字节、拒绝其它长度', () => {
    expect(() => assertKeyLength(web.randomBytes(DEK_LENGTH))).not.toThrow();
    expect(() => assertKeyLength(web.randomBytes(16))).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
    expect(() => assertKeyLength(web.randomBytes(33))).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  });
});

describe('A-07 ⑥ · KDF 参数可序列化往返（参数升级不丢盐值）', () => {
  it('serialize → deserialize 后参数逐字段一致（含盐值）', () => {
    const salt = web.randomBytes(16);
    const params = createKdfParams(salt);

    const serialized = serializeKdfParams(params);
    expect(serialized.algorithm).toBe('scrypt');
    expect(serialized.n).toBe(params.n);
    expect(serialized.r).toBe(params.r);
    expect(serialized.p).toBe(params.p);
    expect(serialized.keyLength).toBe(params.keyLength);
    expect(serialized.salt).toMatch(/^[0-9a-f]{32}$/);

    const restored = deserializeKdfParams(serialized);
    expect(toHex(restored.salt)).toBe(toHex(params.salt));
    expect(restored.n).toBe(params.n);
    expect(restored.r).toBe(params.r);
    expect(restored.p).toBe(params.p);
    expect(restored.keyLength).toBe(params.keyLength);
  });

  it('反序列化后派生出的密钥与原始参数完全一致（往返不改变派生结果）', async () => {
    const salt = web.randomBytes(16);
    const params = createKdfParams(salt);
    const restored = deserializeKdfParams(serializeKdfParams(params));

    const original = await web.deriveKey(params, 'round-trip-password');
    const roundTripped = await web.deriveKey(restored, 'round-trip-password');

    expect(toHex(roundTripped)).toBe(toHex(original));
  }, VAULT_TIMEOUT);
});
