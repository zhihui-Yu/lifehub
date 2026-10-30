/**
 * 同步载荷明文断言单测。
 *
 * 覆盖需求：X-01 ④、R5；对应 `scripts/check-sync-payload.mjs` 的运行时等价断言。
 */
import { describe, expect, it } from 'vitest';
import { assertCiphertextOnly, buildSyncPayload } from '../../src/services/sync/sync-payload';
import type { EncryptedBlob } from '../../src/models/encrypted-blob';

/** 构造一个只含密文字段的 blob。 */
function blob(partial: Partial<EncryptedBlob> = {}): EncryptedBlob {
  return {
    id: 'blob-1',
    entityType: 'bill',
    entityId: 'bill-1',
    ciphertext: new Uint8Array([1, 2, 3, 4]),
    iv: new Uint8Array([9, 8, 7, 6]),
    tag: new Uint8Array([5, 4, 3, 2]),
    algorithm: 'AES-256-GCM',
    keyVersion: 1,
    updatedAt: '2024-01-15T08:12:00.000Z',
    version: 1,
    ...partial,
  };
}

describe('buildSyncPayload', () => {
  it('只接受 EncryptedBlob 列表', () => {
    const payload = buildSyncPayload([blob()]);
    expect(payload.version).toBe(1);
    expect(payload.blobs).toHaveLength(1);
  });

  it('序列化后全文不含明文样本', () => {
    const payload = buildSyncPayload([blob()]);
    const json = JSON.stringify(payload, (_key, value: unknown) =>
      value instanceof Uint8Array ? Array.from(value) : value,
    );
    for (const sample of ['美团', '128.50', '星巴克', 'amountMinor', 'counterparty', 'note', 'localDate']) {
      expect(json).not.toContain(sample);
    }
  });

  it('拒绝不合法的 blob', () => {
    expect(() => buildSyncPayload([{ ...blob(), algorithm: 'AES-128-GCM' } as unknown as EncryptedBlob])).toThrow();
  });
});

describe('assertCiphertextOnly', () => {
  it('拒绝出现明文字段的对象', () => {
    expect(() => assertCiphertextOnly({ blobs: [{ ...blob(), amountMinor: 100 }] })).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  });

  it('接受合法的密文载荷', () => {
    expect(() => assertCiphertextOnly({ version: 1, createdAt: 'x', blobs: [blob()] })).not.toThrow();
  });
});
