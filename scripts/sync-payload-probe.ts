/**
 * 同步载荷运行时探针（仅供 scripts/check-sync-payload.mjs 调用，不属于生产代码）。
 *
 * 目的：用真实的 buildSyncPayload() 构造一份同步载荷，序列化后输出到 stdout，
 * 由 check-sync-payload.mjs 断言其中不含任何明文字段名与明文样本值。
 */
import { buildSyncPayload } from '../packages/core/src/services/sync/sync-payload';
import type { EncryptedBlob } from '../packages/core/src/models/encrypted-blob';

/** 构造一个只含密文字段的合法 blob。 */
const blob: EncryptedBlob = {
  id: 'blob-1',
  entityType: 'bill',
  entityId: 'bill-1',
  ciphertext: new Uint8Array([1, 2, 3, 4]),
  iv: new Uint8Array([9, 8, 7, 6]),
  tag: new Uint8Array([5, 4, 3, 2]),
  algorithm: 'AES-256-GCM',
  keyVersion: 1,
  updatedAt: '2024-06-03T08:12:00.000Z',
  version: 1,
};

const payload = buildSyncPayload([blob]);
const json = JSON.stringify(payload, (_key, value: unknown) => {
  if (value instanceof Uint8Array) {
    return Array.from(value);
  }
  return value;
});

const forbiddenFields = [
  'amountMinor',
  'counterparty',
  'categoryId',
  'localDate',
  'note',
  'title',
  'body',
  'content',
  'password',
  'salt',
  'dek',
  'masterKey',
];
const samples = ['美团', '128.50', '星巴克', 'LIFEHUB-SAMPLE-NOTE'];

for (const field of forbiddenFields) {
  if (json.includes(`"${field}"`)) {
    process.stdout.write(`field:${field}\n`);
  }
}
for (const sample of samples) {
  if (json.includes(sample)) {
    process.stdout.write(`sample:${sample}\n`);
  }
}
process.stdout.write(`probe:ok bytes=${json.length}\n`);
