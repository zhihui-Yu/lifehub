/**
 * 去重器单测。
 *
 * 覆盖需求：A-12 ①、A-21；系统设计 §4.2 关键点 4。
 */
import { describe, expect, it } from 'vitest';
import { Deduplicator } from '../../src/rules/dedupe';
import type { Bill } from '../../src/models/bill';

/** 构造一条账单。 */
function bill(partial: Partial<Bill>): Bill {
  return {
    id: 'bill-1',
    amountMinor: 1234,
    currency: 'CNY',
    direction: 'expense',
    occurredAt: '2024-01-15T00:00:00.000Z',
    localDate: '2024-01-15',
    sourceTimeZone: 'Asia/Shanghai',
    counterparty: '星巴克',
    categoryId: null,
    note: '',
    sourceFileId: 'batch-1',
    sourceRowIndex: 0,
    createdAt: '2024-01-15T00:00:00.000Z',
    updatedAt: '2024-01-15T00:00:00.000Z',
    version: 1,
    deviceId: 'device-1',
    ...partial,
  };
}

describe('Deduplicator.computeFingerprint', () => {
  it('指纹由 localDate|amountMinor|counterparty|currency 组成', () => {
    const deduper = new Deduplicator();
    expect(deduper.computeFingerprint(bill({}))).toBe('2024-01-15|1234|星巴克|CNY');
  });

  it('方向不同但其余相同时指纹相同', () => {
    const deduper = new Deduplicator();
    const a = deduper.computeFingerprint(bill({ direction: 'expense' }));
    const b = deduper.computeFingerprint(bill({ direction: 'income' }));
    expect(a).toBe(b);
  });
});

describe('Deduplicator.isDuplicate', () => {
  it('指纹命中时判定为重复', () => {
    const deduper = new Deduplicator();
    const fingerprints = new Set([deduper.computeFingerprint(bill({}))]);
    expect(deduper.isDuplicate(bill({ id: 'bill-2' }), fingerprints)).toBe(true);
    expect(deduper.isDuplicate(bill({ amountMinor: 9999 }), fingerprints)).toBe(false);
  });
});

describe('Deduplicator.merge', () => {
  it('保留最早 createdAt 与最新 updatedAt', () => {
    const deduper = new Deduplicator();
    const existing = bill({
      id: 'bill-old',
      createdAt: '2024-01-15T00:00:00.000Z',
      updatedAt: '2024-01-16T00:00:00.000Z',
      version: 3,
      note: '旧备注',
    });
    const incoming = bill({
      id: 'bill-new',
      createdAt: '2024-01-17T00:00:00.000Z',
      updatedAt: '2024-01-18T00:00:00.000Z',
      version: 1,
      note: '新备注',
    });
    const merged = deduper.merge(existing, incoming);
    expect(merged.id).toBe('bill-old');
    expect(merged.createdAt).toBe('2024-01-15T00:00:00.000Z');
    expect(merged.updatedAt).toBe('2024-01-18T00:00:00.000Z');
    expect(merged.version).toBe(4);
    expect(merged.note).toBe('新备注');
  });
});

describe('Deduplicator.dedupe', () => {
  it('相同指纹的多条账单合并为一条', () => {
    const deduper = new Deduplicator();
    const result = deduper.dedupe([
      bill({ id: 'a' }),
      bill({ id: 'b', note: '不同备注但指纹相同' }),
      bill({ id: 'c', amountMinor: 4321 }),
    ]);
    expect(result).toHaveLength(2);
  });
});
