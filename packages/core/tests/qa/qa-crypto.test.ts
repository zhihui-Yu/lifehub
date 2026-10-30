/**
 * QA 独立补测 · A-07 加密封装（加密层独立验证）。
 *
 * 覆盖需求：A-07 ①②③④⑤⑥⑦；NF-S-3 / NF-S-4；系统设计 §5 假设 A-6（Web 与 Node 交叉一致）。
 *
 * 【本文件与工程师自写用例的差异】
 * 工程师的 `tests/unit/crypto-service.test.ts` 已在同 Provider 内验证了
 * 「篡改 ciphertext / iv / tag 抛错」与「三 Provider 派生结果一致」。
 * 但 **AAD 篡改** 与 **「Web 派生 → Node 派生 → 交叉解密」** 这两条
 * 尚未被充分验证，本文件补上：
 * 1. 篡改 **AAD** 必须导致解密失败（A-07 ①「AAD 必填且参与认证」）；
 * 2. 交叉一致性必须走完「派生 → 加密 → 跨 Provider 解密 → 得到原文」全链路，
 *    而不只是比较派生出的字节是否相等。
 */
import { describe, expect, it } from 'vitest';
import { CryptoService } from '../../src/crypto/service';
import { WebCryptoProvider } from '../../src/crypto/providers/web-crypto-provider';
import { NodeCryptoProvider } from '../../src/crypto/providers/node-crypto-provider';
import { NobleCryptoProvider } from '../../src/crypto/providers/noble-fallback-provider';
import { createKdfParams } from '../../src/crypto/kdf';
import { VAULT_VERIFIER_ID, VAULT_VERIFIER_PLAINTEXT } from '../../src/constants';

const web = new WebCryptoProvider();
const node = new NodeCryptoProvider();
const noble = new NobleCryptoProvider();

/** 使用较低 KDF 参数的快速测试配置（仅用于缩短测试耗时，不影响一致性结论）。 */
const fastKdf = (salt: Uint8Array) => createKdfParams(salt, { n: 1024 });

/**
 * 翻转字节数组的第一个字节，用于构造「被篡改」的载荷。
 *
 * @param bytes 原始字节数组
 * @returns 篡改后的新数组
 */
function tamper(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes);
  copy[0] = (copy[0] ?? 0) ^ 0xff;
  return copy;
}

describe('A-07 · 三个 CryptoProvider 的派生结果完全一致（可复现）', () => {
  it('同口令 + 同 salt：Web / Node / Noble 派生出完全相同的 32 字节密钥（A-07 ③）', async () => {
    const salt = web.randomBytes(16);
    const params = fastKdf(salt);

    const fromWeb = await web.deriveKey(params, 'correct horse battery staple');
    const fromNode = await node.deriveKey(params, 'correct horse battery staple');
    const fromNoble = await noble.deriveKey(params, 'correct horse battery staple');

    expect(fromWeb).toHaveLength(32);
    expect(Array.from(fromWeb)).toEqual(Array.from(fromNode));
    expect(Array.from(fromWeb)).toEqual(Array.from(fromNoble));
  });

  it('同一 Provider 内同参数重复派生两次结果完全一致（可复现性）', async () => {
    const salt = web.randomBytes(16);
    const params = fastKdf(salt);

    const first = await web.deriveKey(params, 'repeatable-passphrase');
    const second = await web.deriveKey(params, 'repeatable-passphrase');

    expect(Array.from(first)).toEqual(Array.from(second));
  });

  it('不同 salt 派生出不同密钥（盐值确实参与派生）', async () => {
    const password = 'same-password-different-salt';
    const a = await web.deriveKey(fastKdf(web.randomBytes(16)), password);
    const b = await web.deriveKey(fastKdf(web.randomBytes(16)), password);

    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});

describe('A-07 · Web 与 Node 两个 Provider 交叉一致（重点补测）', () => {
  it('Web 派生出的密钥可解开 Node 加密的密文，反之亦然', async () => {
    const salt = web.randomBytes(16);
    const params = fastKdf(salt);
    const password = 'cross-provider-passphrase';

    // 两端各自独立派生密钥（真实跨端场景：Web 端与 Node 端各算各的）。
    const webKey = await web.deriveKey(params, password);
    const nodeKey = await node.deriveKey(params, password);

    const aad = utf8('bill|cross-1|1');
    const plaintext = utf8('美团外卖 35.50');

    // Node 端加密，Web 端解密。
    const byNode = await node.encrypt(nodeKey, plaintext, aad);
    const decodedByWeb = await web.decrypt(webKey, byNode, aad);
    expect(utf8ToString(decodedByWeb)).toBe('美团外卖 35.50');

    // Web 端加密，Node 端解密。
    const byWeb = await web.encrypt(webKey, plaintext, aad);
    const decodedByNode = await node.decrypt(nodeKey, byWeb, aad);
    expect(utf8ToString(decodedByNode)).toBe('美团外卖 35.50');
  });

  it('Noble 兜底实现同样能与 Web / Node 交叉解密', async () => {
    const salt = web.randomBytes(16);
    const params = fastKdf(salt);
    const webKey = await web.deriveKey(params, 'noble-cross');
    const nobleKey = await noble.deriveKey(params, 'noble-cross');
    const aad = utf8('bill|noble-1|1');
    const plaintext = utf8('星巴克 咖啡 32.00');

    const byWeb = await web.encrypt(webKey, plaintext, aad);
    expect(utf8ToString(await noble.decrypt(nobleKey, byWeb, aad))).toBe('星巴克 咖啡 32.00');

    const byNoble = await noble.encrypt(nobleKey, plaintext, aad);
    expect(utf8ToString(await web.decrypt(webKey, byNoble, aad))).toBe('星巴克 咖啡 32.00');
  });

  it('三端 SHA-256 摘要一致（文件哈希 / 表头签名可跨端比对）', async () => {
    const data = utf8('LifeHub 表头签名样本');
    const [a, b, c] = await Promise.all([
      web.sha256(data),
      node.sha256(data),
      noble.sha256(data),
    ]);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).toEqual(Array.from(c));
  });
});

describe('A-07 · 篡改检测：ciphertext / IV / AAD 任一被改都不得返回明文（NF-S-4）', () => {
  it('篡改 ciphertext 后解密抛 LIFEHUB_E_CRYPTO_AUTH_FAILED', async () => {
    const crypto = new CryptoService(web);
    const key = web.randomBytes(32);
    const payload = await crypto.encryptRecord(key, 'bill', 'bill-1', 1, { amountMinor: 1234 });

    await expect(
      crypto.decryptRecord(key, 'bill', 'bill-1', 1, { ...payload, ciphertext: tamper(payload.ciphertext) }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'LIFEHUB_E_CRYPTO_AUTH_FAILED' }));
  });

  it('篡改 IV 后解密抛 LIFEHUB_E_CRYPTO_AUTH_FAILED', async () => {
    const crypto = new CryptoService(web);
    const key = web.randomBytes(32);
    const payload = await crypto.encryptRecord(key, 'bill', 'bill-1', 1, { amountMinor: 1234 });

    await expect(
      crypto.decryptRecord(key, 'bill', 'bill-1', 1, { ...payload, iv: tamper(payload.iv) }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'LIFEHUB_E_CRYPTO_AUTH_FAILED' }));
  });

  it('篡改 GCM tag 后解密抛 LIFEHUB_E_CRYPTO_AUTH_FAILED', async () => {
    const crypto = new CryptoService(web);
    const key = web.randomBytes(32);
    const payload = await crypto.encryptRecord(key, 'bill', 'bill-1', 1, { amountMinor: 1234 });

    await expect(
      crypto.decryptRecord(key, 'bill', 'bill-1', 1, { ...payload, tag: tamper(payload.tag) }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'LIFEHUB_E_CRYPTO_AUTH_FAILED' }));
  });

  it('篡改 AAD（改实体 id）后解密抛 LIFEHUB_E_CRYPTO_AUTH_FAILED —— AAD 确实参与认证', async () => {
    const crypto = new CryptoService(web);
    const key = web.randomBytes(32);
    const payload = await crypto.encryptRecord(key, 'bill', 'bill-1', 1, { amountMinor: 1234 });

    // 同一份密文，改用另一个实体 id 去解密 —— 相当于把 AAD 改了。
    await expect(crypto.decryptRecord(key, 'bill', 'bill-tampered', 1, payload)).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_CRYPTO_AUTH_FAILED' }),
    );
    // 改 keyVersion 同理。
    await expect(crypto.decryptRecord(key, 'bill', 'bill-1', 2, payload)).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_CRYPTO_AUTH_FAILED' }),
    );
    // 改实体类型同理。
    await expect(crypto.decryptRecord(key, 'category', 'bill-1', 1, payload)).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_CRYPTO_AUTH_FAILED' }),
    );
  });

  it('底层 Provider 层面：直接篡改 AAD 字节同样导致解密失败', async () => {
    const key = web.randomBytes(32);
    const aad = utf8('bill|direct|1');
    const payload = await web.encrypt(key, utf8('机密内容'), aad);

    await expect(web.decrypt(key, payload, utf8('bill|direct|2'))).rejects.toThrow();
  });

  it('解密失败时绝不返回部分明文（返回值不是明文片段）', async () => {
    const crypto = new CryptoService(web);
    const key = web.randomBytes(32);
    const payload = await crypto.encryptRecord(key, 'bill', 'bill-1', 1, {
      counterparty: '美团外卖',
      amountMinor: 3550,
    });

    // 捕获异常并断言：抛出的不是「部分明文对象」，而是带错误码的 LifeHubError。
    let caught: unknown = null;
    try {
      const result = await crypto.decryptRecord(
        key,
        'bill',
        'bill-1',
        1,
        { ...payload, ciphertext: tamper(payload.ciphertext) },
      );
      // 若实现错误地返回了部分明文，这里 result 会有值，下面的断言会失败。
      expect(result).toBeUndefined();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeTruthy();
    expect(caught).toMatchObject({ code: 'LIFEHUB_E_CRYPTO_AUTH_FAILED' });
    // 异常消息里不得夹带原始明文。
    expect(String((caught as Error).message)).not.toContain('美团外卖');
  });
});

describe('A-07 · 边界条件不崩溃（A-07 ⑥）', () => {
  it('空明文可加解密', async () => {
    const key = web.randomBytes(32);
    const aad = utf8('bill|empty|1');
    const payload = await web.encrypt(key, new Uint8Array(0), aad);
    expect((await web.decrypt(key, payload, aad)).length).toBe(0);
  });

  it('超长明文（1MB）可加解密', async () => {
    const key = web.randomBytes(32);
    const aad = utf8('bill|big|1');
    const big = web.randomBytes(1024 * 1024);
    const payload = await web.encrypt(key, big, aad);
    const decoded = await web.decrypt(key, payload, aad);
    expect(decoded.length).toBe(big.length);
    expect(Array.from(decoded.subarray(0, 16))).toEqual(Array.from(big.subarray(0, 16)));
  });

  it('每次加密都使用独立随机 IV（1000 次无碰撞，A-07 ④）', async () => {
    const seen = new Set<string>();
    for (let index = 0; index < 1000; index += 1) {
      seen.add(Array.from(web.randomBytes(12)).join(','));
    }
    expect(seen.size).toBe(1000);
  });

  it('同一明文多次加密得到不同密文（IV 不复用）', async () => {
    const key = web.randomBytes(32);
    const aad = utf8('bill|iv|1');
    const first = await web.encrypt(key, utf8('同样内容'), aad);
    const second = await web.encrypt(key, utf8('同样内容'), aad);
    expect(Array.from(first.iv)).not.toEqual(Array.from(second.iv));
    expect(Array.from(first.ciphertext)).not.toEqual(Array.from(second.ciphertext));
  });

  it('口令哨兵只认正确口令解出的明文，且不存口令哈希（A-07 ⑦）', async () => {
    const crypto = new CryptoService(web);
    const masterKey = web.randomBytes(32);
    const verifier = await crypto.encryptRecord(
      masterKey,
      'vaultParams',
      VAULT_VERIFIER_ID,
      1,
      VAULT_VERIFIER_PLAINTEXT,
    );

    await expect(crypto.verifyPassword(masterKey, verifier)).resolves.toBe(true);
    await expect(crypto.verifyPassword(web.randomBytes(32), verifier)).resolves.toBe(false);

    // 哨兵载荷里不含口令明文，也不含口令哈希字段。
    const serialized = JSON.stringify({
      iv: Array.from(verifier.iv),
      ciphertext: Array.from(verifier.ciphertext),
      tag: Array.from(verifier.tag),
    });
    expect(serialized).not.toContain('correct');
    expect(serialized).not.toContain('password');
  });
});

describe('A-07 · DEK 包裹与解包', () => {
  it('wrapDek / unwrapDek 往返一致，且 AAD 绑定 keyVersion', async () => {
    const crypto = new CryptoService(web);
    const masterKey = web.randomBytes(32);
    const dek = web.randomBytes(32);

    const wrapped = await crypto.wrapDek(masterKey, dek, 1);
    expect(wrapped.keyVersion).toBe(1);
    expect(Array.from(await crypto.unwrapDek(masterKey, wrapped))).toEqual(Array.from(dek));

    // keyVersion 不同 → AAD 不同 → 解包失败。
    const wrongVersion: typeof wrapped = { ...wrapped, keyVersion: 2 };
    await expect(crypto.unwrapDek(masterKey, wrongVersion)).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_CRYPTO_AUTH_FAILED' }),
    );
  });

  it('用错误主密钥解包 DEK 抛 LIFEHUB_E_CRYPTO_AUTH_FAILED', async () => {
    const crypto = new CryptoService(web);
    const masterKey = web.randomBytes(32);
    const wrapped = await crypto.wrapDek(masterKey, web.randomBytes(32), 1);

    await expect(crypto.unwrapDek(web.randomBytes(32), wrapped)).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_CRYPTO_AUTH_FAILED' }),
    );
  });
});

/**
 * 把字符串编码为 UTF-8 字节数组。
 *
 * @param text 原始字符串
 * @returns UTF-8 字节数组
 */
function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * 把 UTF-8 字节数组解码为字符串。
 *
 * @param bytes UTF-8 字节数组
 * @returns 解码后的字符串
 */
function utf8ToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
