/**
 * 模型运行时校验单测。
 *
 * 覆盖需求：A-01 ④；系统设计 §7 T02 交付内容第 1 条。
 */
import { describe, expect, it } from 'vitest';
import { validateBill } from '../../src/models/bill';
import { validateCategory } from '../../src/models/category';
import { validateRuleTemplate } from '../../src/models/rule-template';
import { validateImportBatch } from '../../src/models/import-batch';
import { validateVaultParams, validateRecoveryMeta } from '../../src/models/vault';
import { validateAuditLog } from '../../src/models/audit';
import { validateEncryptedBlob } from '../../src/models/encrypted-blob';

/** 构造一条合法账单。 */
function bill(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'bill-1',
    amountMinor: 1234,
    currency: 'CNY',
    direction: 'expense',
    occurredAt: '2024-01-15T08:12:00.000Z',
    localDate: '2024-01-15',
    sourceTimeZone: 'Asia/Shanghai',
    counterparty: '星巴克',
    categoryId: null,
    note: '',
    sourceFileId: 'batch-1',
    sourceRowIndex: 0,
    createdAt: '2024-01-15T08:12:00.000Z',
    updatedAt: '2024-01-15T08:12:00.000Z',
    version: 1,
    deviceId: 'device-1',
    ...partial,
  };
}

describe('validateBill', () => {
  it('接受合法账单', () => {
    expect(validateBill(bill()).id).toBe('bill-1');
  });

  it('拒绝非整数金额', () => {
    expect(() => validateBill(bill({ amountMinor: 12.34 }))).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  });

  it('拒绝负金额（方向由 direction 表达，金额恒为正）', () => {
    expect(() => validateBill(bill({ amountMinor: -1 }))).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  });

  it('拒绝非法币种', () => {
    expect(() => validateBill(bill({ currency: 'USD' }))).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  });

  it('拒绝非法方向', () => {
    expect(() => validateBill(bill({ direction: 'transfer' }))).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  });

  it('接受 refund 方向（PRD Q8 裁决）', () => {
    expect(validateBill(bill({ direction: 'refund' })).direction).toBe('refund');
  });

  it('拒绝非 ISO UTC 时间戳', () => {
    expect(() => validateBill(bill({ occurredAt: '2024-01-15 08:12:00' }))).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  });

  it('拒绝非法 localDate', () => {
    expect(() => validateBill(bill({ localDate: '2024/01/15' }))).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  });

  it('拒绝负的 sourceRowIndex 与 version', () => {
    expect(() => validateBill(bill({ sourceRowIndex: -1 }))).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
    expect(() => validateBill(bill({ version: 0 }))).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  });
});

describe('validateCategory', () => {
  const category = {
    id: 'cat-1',
    name: '餐饮',
    kind: 'expense',
    parentId: null,
    color: '#DC2626',
    icon: 'restaurant',
    isSystem: true,
    sortOrder: 100,
    createdAt: '2024-01-15T08:12:00.000Z',
    updatedAt: '2024-01-15T08:12:00.000Z',
    version: 1,
    deviceId: 'device-1',
  };

  it('接受合法分类', () => {
    expect(validateCategory(category).name).toBe('餐饮');
  });

  it('拒绝非法颜色与空名称', () => {
    expect(() => validateCategory({ ...category, color: 'red' })).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
    expect(() => validateCategory({ ...category, name: '  ' })).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  });
});

describe('validateRuleTemplate', () => {
  const template = {
    id: 'tpl-1',
    name: '微信支付模板',
    fileSignature: 'abc',
    columnMapping: { 0: 'occurredAt', 1: 'amount' },
    directionRule: { mode: 'auto', incomeKeywords: ['收入'], expenseKeywords: ['支出'] },
    categoryRules: [
      { id: 'r1', priority: 10, matchType: 'contains', pattern: '咖啡', categoryId: 'cat-1' },
    ],
    dateFormatHints: ['ymd'],
    createdAt: '2024-01-15T08:12:00.000Z',
    updatedAt: '2024-01-15T08:12:00.000Z',
    version: 1,
    deviceId: 'device-1',
  };

  it('接受合法模板', () => {
    expect(validateRuleTemplate(template).name).toBe('微信支付模板');
  });

  it('拒绝非法列映射与匹配类型', () => {
    expect(() => validateRuleTemplate({ ...template, columnMapping: { 0: 'unknown' } })).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
    expect(() =>
      validateRuleTemplate({
        ...template,
        categoryRules: [{ id: 'r', priority: 1, matchType: 'fuzzy', pattern: 'x', categoryId: 'c' }],
      }),
    ).toThrowError(expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }));
  });
});

describe('validateImportBatch', () => {
  const batch = {
    id: 'batch-1',
    fileName: 'wechat.csv',
    fileSize: 1024,
    fileHash: 'a'.repeat(64),
    encoding: 'utf-8',
    rowTotal: 10,
    rowImported: 9,
    rowSkipped: 1,
    templateId: null,
    createdAt: '2024-01-15T08:12:00.000Z',
    updatedAt: '2024-01-15T08:12:00.000Z',
    version: 1,
    deviceId: 'device-1',
  };

  it('接受合法批次', () => {
    expect(validateImportBatch(batch).rowImported).toBe(9);
  });

  it('拒绝非法哈希与编码', () => {
    expect(() => validateImportBatch({ ...batch, fileHash: 'short' })).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
    expect(() => validateImportBatch({ ...batch, encoding: 'latin-1' })).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  });
});

describe('validateVaultParams / validateRecoveryMeta', () => {
  const params = {
    kdf: 'scrypt',
    n: 32768,
    r: 8,
    p: 1,
    keyLength: 32,
    salt: new Uint8Array(16),
    verifier: {
      kind: 'encrypted',
      algorithm: 'AES-256-GCM',
      iv: new Uint8Array(12),
      ciphertext: new Uint8Array(8),
      tag: new Uint8Array(16),
      keyVersion: 1,
    },
    paramsVersion: 1,
    keyVersion: 1,
    currentDek: {
      keyVersion: 1,
      wrappedByKeyVersion: 1,
      wrapped: {
        kind: 'encrypted',
        algorithm: 'AES-256-GCM',
        iv: new Uint8Array(12),
        ciphertext: new Uint8Array(8),
        tag: new Uint8Array(16),
        keyVersion: 1,
      },
    },
    previousDek: null,
    createdAt: '2024-01-15T08:12:00.000Z',
    updatedAt: '2024-01-15T08:12:00.000Z',
  };

  it('接受合法保险库参数', () => {
    expect(validateVaultParams(params).keyVersion).toBe(1);
  });

  it('拒绝非 scrypt 的 KDF 与过短盐值', () => {
    expect(() => validateVaultParams({ ...params, kdf: 'pbkdf2' })).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
    expect(() => validateVaultParams({ ...params, salt: new Uint8Array(4) })).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  });

  it('恢复码元数据只允许 default id', () => {
    const meta = {
      id: 'default',
      checksum: 'abc',
      exported: false,
      createdAt: '2024-01-15T08:12:00.000Z',
      // 恢复路径三件套：恢复盐值 + 恢复 KDF 参数 + 被恢复密钥包裹的 DEK。
      salt: new Uint8Array(16),
      kdfParams: { kdf: 'scrypt', n: 32768, r: 8, p: 1, keyLength: 32 },
      wrappedDek: {
        keyVersion: 1,
        wrappedByKeyVersion: 1,
        wrapped: {
          kind: 'encrypted',
          algorithm: 'AES-256-GCM',
          iv: new Uint8Array(12),
          ciphertext: new Uint8Array(8),
          tag: new Uint8Array(16),
          keyVersion: 1,
        },
      },
    };
    expect(validateRecoveryMeta(meta).exported).toBe(false);
    expect(() => validateRecoveryMeta({ ...meta, id: 'other' })).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
    // 缺字段 / 字段非法都必须被拒绝，否则恢复路径在设计上不成立。
    expect(() => validateRecoveryMeta({ ...meta, salt: new Uint8Array(4) })).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
    expect(() =>
      validateRecoveryMeta({ ...meta, kdfParams: { ...meta.kdfParams, kdf: 'pbkdf2' } }),
    ).toThrowError(expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }));
    expect(() => validateRecoveryMeta({ ...meta, wrappedDek: null })).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  });
});

describe('validateAuditLog / validateEncryptedBlob', () => {
  it('接受合法审计日志', () => {
    const log = {
      id: 'log-1',
      at: '2024-01-15T08:12:00.000Z',
      action: 'unlock',
      target: '',
      deviceLabel: '本机 · Chrome',
      success: true,
    };
    expect(validateAuditLog(log).action).toBe('unlock');
    expect(() => validateAuditLog({ ...log, action: 'nope' })).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  });

  it('接受合法加密 blob', () => {
    const blob = {
      id: 'blob-1',
      entityType: 'bill',
      entityId: 'bill-1',
      ciphertext: new Uint8Array(8),
      iv: new Uint8Array(12),
      tag: new Uint8Array(16),
      algorithm: 'AES-256-GCM',
      keyVersion: 1,
      updatedAt: '2024-01-15T08:12:00.000Z',
      version: 1,
    };
    expect(validateEncryptedBlob(blob).entityType).toBe('bill');
    expect(() => validateEncryptedBlob({ ...blob, algorithm: 'AES-128-GCM' })).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  });
});
