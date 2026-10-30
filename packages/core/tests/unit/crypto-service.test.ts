/**
 * 加密服务单测。
 *
 * 覆盖需求：A-07 ③④⑤；NF-S-3 / NF-S-4；系统设计 §5 假设 A-6（Web 与 Node 交叉一致）。
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

/** 使用较低 KDF 参数的快速测试配置。 */
const fastKdf = (salt: Uint8Array) => createKdfParams(salt, { n: 1024 });

describe('CryptoProvider 实现一致性', () => {
  it('同口令 + 同 salt 在 Web / Node / Noble 三个实现下派生结果完全一致（A-07 ③、A-6）', async () => {
    const salt = web.randomBytes(16);
    const params = fastKdf(salt);
    const [a, b, c] = await Promise.all([
      web.deriveKey(params, 'correct horse battery staple'),
      node.deriveKey(params, 'correct horse battery staple'),
      noble.deriveKey(params, 'correct horse battery staple'),
    ]);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).toEqual(Array.from(c));
  });

  it('三个实现都能加解密并互相兼容', async () => {
    const key = web.randomBytes(32);
    const aad = web.randomBytes(16);
    const plaintext = web.randomBytes(64);

    const byWeb = await web.encrypt(key, plaintext, aad);
    const byNode = await node.encrypt(key, plaintext, aad);
    const byNoble = await noble.encrypt(key, plaintext, aad);

    expect(Array.from(await web.decrypt(key, byWeb, aad))).toEqual(Array.from(plaintext));
    expect(Array.from(await web.decrypt(key, byNode, aad))).toEqual(Array.from(plaintext));
    expect(Array.from(await web.decrypt(key, byNoble, aad))).toEqual(Array.from(plaintext));
  });

  it('三个实现算出的 SHA-256 一致', async () => {
    const data = web.randomBytes(100);
    const [a, b, c] = await Promise.all([web.sha256(data), node.sha256(data), noble.sha256(data)]);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).toEqual(Array.from(c));
  });

  it('1000 次 randomBytes(12) 无碰撞（A-07 ④）', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 1000; index += 1) {
      seen.add(Array.from(web.randomBytes(12)).join(','));
    }
    expect(seen.size).toBe(1000);
  });

  it('randomBytes 拒绝非法长度', () => {
    expect(() => web.randomBytes(0)).toThrow();
    expect(() => web.randomBytes(-1)).toThrow();
  });
});

describe('CryptoService', () => {
  const crypto = new CryptoService(web);

  it('AAD 绑定实体身份，密文跨记录搬移后解密失败', async () => {
    const key = web.randomBytes(32);
    const payload = await crypto.encryptRecord(key, 'bill', 'bill-1', 1, { amountMinor: 1234 });

    await expect(crypto.decryptRecord(key, 'bill', 'bill-2', 1, payload)).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_CRYPTO_AUTH_FAILED' }),
    );
    await expect(crypto.decryptRecord(key, 'bill', 'bill-1', 2, payload)).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_CRYPTO_AUTH_FAILED' }),
    );
  });

  it('篡改 ciphertext / iv / tag 任一者都抛 LIFEHUB_E_CRYPTO_AUTH_FAILED 且不返回部分明文（NF-S-4）', async () => {
    const key = web.randomBytes(32);
    const payload = await crypto.encryptRecord(key, 'bill', 'bill-1', 1, { secret: 'x' });

    const tamperedCiphertext = {
      ...payload,
      ciphertext: (() => {
        const copy = new Uint8Array(payload.ciphertext);
        copy[0] = (copy[0] ?? 0) ^ 0xff;
        return copy;
      })(),
    };
    const tamperedIv = { ...payload, iv: (() => {
      const copy = new Uint8Array(payload.iv);
      copy[0] = (copy[0] ?? 0) ^ 0xff;
      return copy;
    })() };
    const tamperedTag = { ...payload, tag: (() => {
      const copy = new Uint8Array(payload.tag);
      copy[0] = (copy[0] ?? 0) ^ 0xff;
      return copy;
    })() };

    for (const tampered of [tamperedCiphertext, tamperedIv, tamperedTag]) {
      await expect(crypto.decryptRecord(key, 'bill', 'bill-1', 1, tampered)).rejects.toThrowError(
        expect.objectContaining({ code: 'LIFEHUB_E_CRYPTO_AUTH_FAILED' }),
      );
    }
  });

  it('wrapDek / unwrapDek 往返一致', async () => {
    const masterKey = web.randomBytes(32);
    const dek = web.randomBytes(32);
    const wrapped = await crypto.wrapDek(masterKey, dek, 1);
    expect(wrapped.keyVersion).toBe(1);
    const unwrapped = await crypto.unwrapDek(masterKey, wrapped);
    expect(Array.from(unwrapped)).toEqual(Array.from(dek));
  });

  it('用错误主密钥解包 DEK 抛 LIFEHUB_E_CRYPTO_AUTH_FAILED', async () => {
    const masterKey = web.randomBytes(32);
    const wrongKey = web.randomBytes(32);
    const wrapped = await crypto.wrapDek(masterKey, web.randomBytes(32), 1);
    await expect(crypto.unwrapDek(wrongKey, wrapped)).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_CRYPTO_AUTH_FAILED' }),
    );
  });

  it('verifyPassword 只认正确口令解出的哨兵明文（A-07 ⑦）', async () => {
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
  });

  it('拒绝非法长度密钥', async () => {
    await expect(
      crypto.encryptRecord(new Uint8Array(16), 'bill', 'bill-1', 1, {}),
    ).rejects.toThrow();
  });
});
