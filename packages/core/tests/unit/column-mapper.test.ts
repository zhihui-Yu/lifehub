/**
 * 列映射器单测。
 *
 * 覆盖需求：A-05 ①②③⑤；系统设计 §7 T03 验收「必填未映射时 message 为指定中文」。
 */
import { describe, expect, it } from 'vitest';
import { ColumnMapper } from '../../src/csv/column-mapper';
import { WebCryptoProvider } from '../../src/crypto/providers/web-crypto-provider';

const provider = new WebCryptoProvider();

describe('ColumnMapper.suggest', () => {
  it('按表头关键词识别日期 / 金额 / 对方 / 方向 / 备注列', () => {
    const mapper = new ColumnMapper(['交易时间', '交易类型', '交易对方', '收/支', '金额(元)', '备注']);
    const mapping = mapper.suggest();
    expect(mapping[0]).toBe('occurredAt');
    expect(mapping[2]).toBe('counterparty');
    expect(mapping[3]).toBe('direction');
    expect(mapping[4]).toBe('amount');
    expect(mapping[5]).toBe('note');
  });

  it('同一个字段只绑定一列', () => {
    const mapper = new ColumnMapper(['日期', '交易日期']);
    const mapping = mapper.suggest();
    const assigned = Object.values(mapping).filter((field) => field === 'occurredAt');
    expect(assigned).toHaveLength(1);
  });
});

describe('ColumnMapper.validate', () => {
  it('必填字段缺失时返回 missingRequired 与指定中文提示', () => {
    const mapper = new ColumnMapper(['日期', '金额']);
    const result = mapper.validate({});
    expect(result.ok).toBe(false);
    expect(result.missingRequired).toEqual(['occurredAt', 'amount']);
    expect(result.message).toBe('请先映射『日期』和『金额』两列');
  });

  it('映射完整时校验通过', () => {
    const mapper = new ColumnMapper(['日期', '金额']);
    const result = mapper.validate({ 0: 'occurredAt', 1: 'amount' });
    expect(result.ok).toBe(true);
    expect(result.missingRequired).toHaveLength(0);
  });

  it('同一字段被两列占用时返回 duplicatedFields', () => {
    const mapper = new ColumnMapper(['日期1', '日期2', '金额']);
    const result = mapper.validate({ 0: 'occurredAt', 1: 'occurredAt', 2: 'amount' });
    expect(result.ok).toBe(false);
    expect(result.duplicatedFields).toEqual(['occurredAt']);
  });

  it('assertValid 对缺失与冲突抛不同错误码', () => {
    const mapper = new ColumnMapper(['日期1', '日期2', '金额']);
    expect(() => mapper.assertValid({})).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_MAPPING_INCOMPLETE' }),
    );
    expect(() => mapper.assertValid({ 0: 'occurredAt', 1: 'occurredAt', 2: 'amount' })).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_MAPPING_CONFLICT' }),
    );
  });
});

describe('ColumnMapper.mapRow', () => {
  it('按映射抽取语义字段', () => {
    const mapper = new ColumnMapper(['日期', '金额', '对方', '备注']);
    const row = mapper.mapRow(['2024-01-15', '35.50', '星巴克', '咖啡'], {
      0: 'occurredAt',
      1: 'amount',
      2: 'counterparty',
      3: 'note',
    });
    expect(row.occurredAt).toBe('2024-01-15');
    expect(row.amount).toBe('35.50');
    expect(row.counterparty).toBe('星巴克');
    expect(row.note).toBe('咖啡');
  });

  it('未映射列视为 ignore', () => {
    const mapper = new ColumnMapper(['日期', '金额', '多余列']);
    const row = mapper.mapRow(['2024-01-15', '35.50', 'x'], { 0: 'occurredAt', 1: 'amount' });
    expect(row.counterparty).toBe('');
  });
});

describe('ColumnMapper.buildSignature', () => {
  it('相同表头产出相同签名，空格与大小写差异被归一', async () => {
    const a = await new ColumnMapper([]).buildSignature(['交易时间', '金额'], provider);
    const b = await new ColumnMapper([]).buildSignature([' 交易时间 ', '金额'], provider);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('不同表头产出不同签名', async () => {
    const a = await new ColumnMapper([]).buildSignature(['交易时间', '金额'], provider);
    const b = await new ColumnMapper([]).buildSignature(['交易时间', '对方'], provider);
    expect(a).not.toBe(b);
  });
});
