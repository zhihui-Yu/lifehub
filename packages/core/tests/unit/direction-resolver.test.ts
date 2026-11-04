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

  it('支付宝「收/支 = 不计收支」且属投资理财：余额宝收益发放判定为收入（T-Alipay-Investment-1）', () => {
    const result = resolver.resolve(
      row({
        direction: '不计收支',
        category: '投资理财',
        counterparty: '中欧基金管理有限公司',
        note: '余额宝-2026.10.30-收益发放',
        amount: '0.73',
      }),
    );
    expect(result.direction).toBe('income');
    expect(result.source).toBe('keyword');
  });

  it('支付宝「收/支 = 不计收支」且属投资理财：基金买入与余额宝单次转入判定为支出（T-Alipay-Investment-1）', () => {
    const buyFund = resolver.resolve(
      row({
        direction: '不计收支',
        category: '投资理财',
        counterparty: '蚂蚁（杭州）基金销售有限公司',
        note: '蚂蚁财富-广发医疗保健股票A-买入',
        amount: '10.00',
      }),
    );
    expect(buyFund.direction).toBe('expense');
    expect(buyFund.source).toBe('keyword');

    const yuebaoIn = resolver.resolve(
      row({
        direction: '不计收支',
        category: '投资理财',
        counterparty: '天弘基金管理有限公司',
        note: '余额宝-单次转入',
        amount: '6.35',
      }),
    );
    expect(yuebaoIn.direction).toBe('expense');
    expect(yuebaoIn.source).toBe('keyword');
  });

  it('微信「收/支 = /」且为转入零钱通时保持中性交易跳过契约（direction = null）', () => {
    const wechatNeutral = resolver.resolve(
      row({
        direction: '/',
        category: '转入零钱通-来自零钱',
        counterparty: '/',
        note: '转入零钱通-来自零钱',
        amount: '38.79',
      }),
    );
    expect(wechatNeutral.direction).toBeNull();
    expect(wechatNeutral.source).toBe('column');
  });
});

describe('DirectionResolver · 默认关键词表', () => {
  it('收入与支出关键词表各至少 6 个词条（PRD A-06 ②）', () => {
    expect(DirectionResolver.defaultIncomeKeywords().length).toBeGreaterThanOrEqual(6);
    expect(DirectionResolver.defaultExpenseKeywords().length).toBeGreaterThanOrEqual(6);
  });
});
