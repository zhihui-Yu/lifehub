/**
 * 收支方向推断单测。
 *
 * 覆盖需求：A-06 ①②③；系统设计 §7 T03 验收「3 种策略各 ≥ 3 个用例，auto 优先级正确」。
 */
import { describe, expect, it } from 'vitest';
import { DirectionResolver } from '../../src/csv/direction';
import { createDefaultDirectionRule } from '../../src/models/rule-template';
import type { MappedRow } from '../../src/csv/column-mapper';

/** 构造一个映射行。 */
function row(partial: Partial<MappedRow>): MappedRow {
  return {
    cells: [],
    occurredAt: '',
    amount: '',
    counterparty: '',
    category: '',
    direction: '',
    balance: '',
    note: '',
    ...partial,
  };
}

describe('DirectionResolver · sign 策略', () => {
  const resolver = new DirectionResolver({ ...createDefaultDirectionRule(), mode: 'sign' });

  it('负号判定为支出', () => {
    expect(resolver.resolve(row({ amount: '-35.00' })).direction).toBe('expense');
  });

  it('正数判定为收入', () => {
    expect(resolver.resolve(row({ amount: '12000.00' })).direction).toBe('income');
  });

  it('括号负数判定为支出', () => {
    expect(resolver.resolve(row({ amount: '(35.00)' })).direction).toBe('expense');
  });

  it('金额为空时无法判定', () => {
    const result = resolver.resolve(row({ amount: '' }));
    expect(result.direction).toBeNull();
    expect(result.source).toBe('none');
  });
});

describe('DirectionResolver · column 策略', () => {
  const resolver = new DirectionResolver({ ...createDefaultDirectionRule(), mode: 'column', columnIndex: 1 });

  it('列值为「支出」判定为支出', () => {
    const result = resolver.resolve(row({ cells: ['', '支出'] }));
    expect(result.direction).toBe('expense');
    expect(result.source).toBe('column');
  });

  it('列值为「收入」判定为收入', () => {
    expect(resolver.resolve(row({ cells: ['', '收入'] })).direction).toBe('income');
  });

  it('列值为「退款」判定为退款', () => {
    expect(resolver.resolve(row({ cells: ['', '退款'] })).direction).toBe('refund');
  });

  it('列值无法归类时返回 null', () => {
    expect(resolver.resolve(row({ cells: ['', '不明'] })).direction).toBeNull();
  });
});

describe('DirectionResolver · keyword 策略', () => {
  const resolver = new DirectionResolver({ ...createDefaultDirectionRule(), mode: 'keyword' });

  it('对方含「工资」判定为收入', () => {
    expect(resolver.resolve(row({ counterparty: '公司工资' })).direction).toBe('income');
  });

  it('对方含「消费」判定为支出', () => {
    expect(resolver.resolve(row({ counterparty: '超市消费' })).direction).toBe('expense');
  });

  it('备注含「退款」判定为退款', () => {
    expect(resolver.resolve(row({ note: '订单退款' })).direction).toBe('refund');
  });

  it('无关键词命中时返回 null', () => {
    expect(resolver.resolve(row({ counterparty: '某某' })).direction).toBeNull();
  });
});

describe('DirectionResolver · auto 优先级', () => {
  const resolver = new DirectionResolver({ ...createDefaultDirectionRule(), mode: 'auto', columnIndex: 1 });

  it('显式收/支列优先于金额正负号', () => {
    // 金额是负数，但收/支列明确写着「收入」——按优先级取列。
    const result = resolver.resolve(row({ amount: '-100.00', cells: ['', '收入'] }));
    expect(result.direction).toBe('income');
    expect(result.source).toBe('column');
  });

  it('无收/支列时退回金额正负号', () => {
    const result = resolver.resolve(row({ amount: '-100.00', cells: ['', ''] }));
    expect(result.direction).toBe('expense');
    expect(result.source).toBe('sign');
  });

  it('两者都不可用时退回关键词', () => {
    const result = resolver.resolve(row({ amount: '100.00', cells: ['', ''], counterparty: '工资收入' }));
    expect(result.direction).toBe('income');
    expect(result.source).toBe('keyword');
  });
});

describe('DirectionResolver · 默认关键词表', () => {
  it('收入与支出关键词表各至少 6 个词条（PRD A-06 ②）', () => {
    expect(DirectionResolver.defaultIncomeKeywords().length).toBeGreaterThanOrEqual(6);
    expect(DirectionResolver.defaultExpenseKeywords().length).toBeGreaterThanOrEqual(6);
  });
});
