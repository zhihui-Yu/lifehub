/**
 * 请求体字段白名单 / 黑名单校验测试。
 *
 * 架构位置：apps/sync-server/tests —— 验证「服务端只见密文」这条红线的判定逻辑。
 */
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_BLOB_FIELDS,
  FORBIDDEN_FIELDS,
  SUPPORTED_ALGORITHMS,
  ValidationError,
  normalizeTimestamp,
  validateBlobBody,
} from '../src/validation.ts';

/**
 * 构造一条合法的请求体。
 *
 * @param overrides 需要覆盖的字段
 * @returns 请求体对象
 */
function makeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'b1',
    entityType: 'bill',
    entityId: 'e1',
    ciphertext: 'Y2lwaGVydGV4dA==',
    iv: 'aXYxMjM0NTY3ODkw',
    tag: 'dGFnMTIzNDU2Nzg5MA==',
    algorithm: 'AES-256-GCM',
    keyVersion: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

describe('密文 blob 请求体校验', () => {
  it('合法请求体通过校验', () => {
    const blob = validateBlobBody(makeBody());
    expect(blob.id).toBe('b1');
    expect(blob.entityType).toBe('bill');
    expect(blob.version).toBe(1);
  });

  it('非对象请求体被拒绝', () => {
    expect(() => validateBlobBody('string')).toThrow(ValidationError);
    expect(() => validateBlobBody(null)).toThrow(ValidationError);
    expect(() => validateBlobBody([])).toThrow(ValidationError);
  });

  it('白名单恰好是 EncryptedBlob 的 10 个字段', () => {
    expect(ALLOWED_BLOB_FIELDS).toHaveLength(10);
    expect([...ALLOWED_BLOB_FIELDS].sort()).toEqual([
      'algorithm',
      'ciphertext',
      'entityId',
      'entityType',
      'id',
      'iv',
      'keyVersion',
      'tag',
      'updatedAt',
      'version',
    ]);
  });

  it('黑名单覆盖金额 / 对方 / 备注 / 盐值 / DEK / 主密钥 / 恢复码', () => {
    for (const field of [
      'amount',
      'amountMinor',
      'counterparty',
      'note',
      'title',
      'body',
      'salt',
      'dek',
      'masterKey',
      'recoveryCode',
    ]) {
      expect(FORBIDDEN_FIELDS).toContain(field);
    }
  });

  it('命中黑名单字段时报错并点名该字段', () => {
    expect(() => validateBlobBody(makeBody({ amount: 100 }))).toThrow(/拒绝明文字段：amount/);
    expect(() => validateBlobBody(makeBody({ masterKey: 'x' }))).toThrow(/拒绝明文字段：masterKey/);
  });

  it('嵌套对象里的明文字段同样被拒绝', () => {
    expect(() => validateBlobBody(makeBody({ meta: { note: 'x' } }))).toThrow(/拒绝明文字段：note/);
  });

  it('数组里的明文字段同样被拒绝', () => {
    expect(() => validateBlobBody(makeBody({ items: [{ salt: 'x' }] }))).toThrow(
      /拒绝明文字段：salt/,
    );
  });

  it('白名单之外的字段被拒绝', () => {
    expect(() => validateBlobBody(makeBody({ extra: 1 }))).toThrow(/未允许的字段：extra/);
  });

  it('缺少必填字段被拒绝', () => {
    const body = makeBody();
    delete body['iv'];
    expect(() => validateBlobBody(body)).toThrow(/缺少必填字段：iv/);
  });

  it('空字符串字段被拒绝', () => {
    expect(() => validateBlobBody(makeBody({ ciphertext: '' }))).toThrow(
      /缺少必填字段：ciphertext/,
    );
  });

  it('非字符串字段被拒绝', () => {
    expect(() => validateBlobBody(makeBody({ ciphertext: 123 }))).toThrow(
      /ciphertext 必须是字符串/,
    );
  });

  it('版本号必须是非负整数', () => {
    expect(() => validateBlobBody(makeBody({ version: 1.5 }))).toThrow(/version 必须是非负整数/);
    expect(() => validateBlobBody(makeBody({ version: -1 }))).toThrow(/version 必须是非负整数/);
    expect(() => validateBlobBody(makeBody({ keyVersion: -1 }))).toThrow(
      /keyVersion 必须是非负整数/,
    );
  });

  it('不支持的算法被拒绝', () => {
    expect(() => validateBlobBody(makeBody({ algorithm: 'AES-128-CBC' }))).toThrow(
      /不支持的加密算法/,
    );
    expect(SUPPORTED_ALGORITHMS).toEqual(['AES-256-GCM']);
  });

  it('超长字段被拒绝', () => {
    expect(() => validateBlobBody(makeBody({ id: 'x'.repeat(500) }))).toThrow(/长度超过上限/);
  });

  it('updatedAt 被归一化为定宽 UTC 格式', () => {
    const blob = validateBlobBody(makeBody({ updatedAt: '2026-01-01T08:00:00+08:00' }));
    expect(blob.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('非法时间戳被拒绝', () => {
    expect(() => validateBlobBody(makeBody({ updatedAt: 'not-a-date' }))).toThrow(/ISO-8601/);
  });
});

describe('时间戳归一化', () => {
  it('带时区偏移的时间被换算为 UTC', () => {
    expect(normalizeTimestamp('2026-01-01T08:00:00+08:00', 'updatedAt')).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('已带毫秒的 UTC 时间保持不变', () => {
    expect(normalizeTimestamp('2026-01-01T00:00:00.000Z', 'updatedAt')).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('非法值抛出校验错误', () => {
    expect(() => normalizeTimestamp('nonsense', 'since')).toThrow(ValidationError);
  });
});
