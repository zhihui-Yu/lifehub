/**
 * 跨来源去重集成测试。
 *
 * 覆盖需求：A-21 / 用户需求「微信 / 支付宝 绑定银行卡付款，是同一笔，不应重复计算」。
 *
 * 场景：先把一笔「银行流水」导入（渠道 = bank），再把与之「同日 + 同额 + 同方向」的
 * 一笔「微信支付」导入（渠道 = wechat）。后者应被识别为跨来源重复并跳过（默认）；
 * 且该判断在 plan() 阶段就会通过 `crossSourceCandidates` 预告，由用户确认而非静默丢弃。
 */
import { describe, expect, it } from 'vitest';
import type { ColumnMapping } from '../../src/index';
import { createUnlockedRuntime } from '../helpers/runtime';

/** 微信支付导出（4 笔），第 1 笔与下方银行流水是同一笔（2026-08-01 35.50 支出）。 */
const WECHAT_CSV = [
  '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注',
  '2026-08-01 11:03:18,商户消费,星巴克,拿铁,支出,35.50,零钱,支付成功,123,456,',
  '2026-08-02 09:00:00,商户消费,麦当劳,套餐,支出,20.00,零钱,支付成功,124,457,',
  '2026-08-03 12:00:00,转账,张三,还款,收入,100.00,零钱,支付成功,125,458,',
  '2026-08-04 18:00:00,商户消费,便利店,水,支出,5.00,零钱,支付成功,126,459,',
].join('\n');

/** 兴业银行流水（仅含与微信第 1 笔对应的那笔）。 */
const BANK_TEXT = [
  '2026-08-01',
  '11:03:18 20260801 快捷支付 支 -35.50 ******',
  '0992299674,蚂蚁（杭州',
  '）基金销售有',
].join('\n');

/** 另一份银行流水：同一笔 35.50 支出，但对方户名（交易用途）不同，用于验证 bank 与 bank 不构成跨来源组合。 */
const BANK_TEXT_B = [
  '2026-08-01',
  '11:03:18 20260801 快捷支付 支 -35.50 ******',
  '另一家商户名碎片',
].join('\n');

/** 银行流水的列映射：交易时间 / 收支方向 / 交易金额。 */
const BANK_MAPPING: ColumnMapping = { 0: 'occurredAt', 3: 'direction', 4: 'amount' };

/** 微信导出的列映射：交易时间 / 交易对方 / 收/支 / 金额。 */
const WECHAT_MAPPING: ColumnMapping = { 0: 'occurredAt', 2: 'counterparty', 4: 'direction', 5: 'amount' };

/** 把文本转成 UTF-8 字节（供文件哈希 / 落库使用）。 */
function toBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('跨来源去重（微信 / 支付宝 与 银行 视为同一笔）', () => {
  it('plan() 在银行已存在时，预告微信导入的跨来源重复候选', async () => {
    const runtime = await createUnlockedRuntime();
    // 先导入银行流水（渠道 bank）。
    await runtime.importService.run(
      { fileName: 'cib-2026.pdf', sizeBytes: toBytes(BANK_TEXT).length, bytes: toBytes(BANK_TEXT), format: 'pdf', text: BANK_TEXT },
      BANK_MAPPING,
      { sourceChannel: 'bank', userTimeZone: 'Asia/Shanghai' },
    );
    // 再探查微信导入（渠道 wechat）。
    const plan = await runtime.importService.plan(
      { fileName: 'wechat-2026.csv', sizeBytes: toBytes(WECHAT_CSV).length, bytes: toBytes(WECHAT_CSV) },
      { sourceChannel: 'wechat' },
    );
    expect(plan.sourceChannel).toBe('wechat');
    expect(plan.crossSourceCandidates.length).toBeGreaterThanOrEqual(1);
    expect(plan.crossSourceCandidates[0]?.amountMinor).toBe(3550);
    expect(plan.crossSourceCandidates[0]?.direction).toBe('expense');
    expect(plan.crossSourceCandidates[0]?.existingChannel).toBe('bank');
  });

  it('默认跳过跨来源重复：同一笔不会被重复计入', async () => {
    const runtime = await createUnlockedRuntime();
    await runtime.importService.run(
      { fileName: 'cib-2026.pdf', sizeBytes: toBytes(BANK_TEXT).length, bytes: toBytes(BANK_TEXT), format: 'pdf', text: BANK_TEXT },
      BANK_MAPPING,
      { sourceChannel: 'bank', userTimeZone: 'Asia/Shanghai' },
    );
    const summary = await runtime.importService.run(
      { fileName: 'wechat-2026.csv', sizeBytes: toBytes(WECHAT_CSV).length, bytes: toBytes(WECHAT_CSV) },
      WECHAT_MAPPING,
      { sourceChannel: 'wechat', userTimeZone: 'Asia/Shanghai' },
    );
    expect(summary.rowTotal).toBe(4);
    expect(summary.rowImported).toBe(3); // 第 1 笔被跨来源去重跳过
    expect(summary.rowCrossSourceDuplicate).toBe(1);
    expect(summary.duplicateFile).toBe(false);

    const bills = await runtime.bills.list();
    // 银行 1 笔 + 微信 3 笔 = 4 笔入账；星巴克那一笔只来自银行（对方户名不同，内容指纹不重复）。
    expect(bills).toHaveLength(4);
    expect(bills.filter((b) => b.counterparty.includes('星巴克'))).toHaveLength(0);
    expect(bills.some((b) => b.amountMinor === 3550 && b.direction === 'expense')).toBe(true);

    const wechatBatch = (await runtime.batches.list()).find((b) => b.fileName === 'wechat-2026.csv');
    expect(wechatBatch?.rowImported).toBe(3);
  });

  it('skipCrossSourceDuplicates=false 时，同一笔会被当作普通账单导入（可重复计入）', async () => {
    const runtime = await createUnlockedRuntime();
    await runtime.importService.run(
      { fileName: 'cib-2026.pdf', sizeBytes: toBytes(BANK_TEXT).length, bytes: toBytes(BANK_TEXT), format: 'pdf', text: BANK_TEXT },
      BANK_MAPPING,
      { sourceChannel: 'bank', userTimeZone: 'Asia/Shanghai' },
    );
    const summary = await runtime.importService.run(
      { fileName: 'wechat-2026.csv', sizeBytes: toBytes(WECHAT_CSV).length, bytes: toBytes(WECHAT_CSV) },
      WECHAT_MAPPING,
      { sourceChannel: 'wechat', userTimeZone: 'Asia/Shanghai', skipCrossSourceDuplicates: false },
    );
    expect(summary.rowImported).toBe(4);
    expect(summary.rowCrossSourceDuplicate).toBe(0);

    const bills = await runtime.bills.list();
    // 银行 1 + 微信 4 = 5 笔，星巴克出现在微信侧（被重复计入，符合「用户主动关闭去重」的预期）。
    expect(bills).toHaveLength(5);
    expect(bills.filter((b) => b.amountMinor === 3550 && b.direction === 'expense')).toHaveLength(2);
  });

  it('同渠道（bank 与 bank）之间的重复不触发跨来源去重，交由内容指纹处理', async () => {
    const runtime = await createUnlockedRuntime();
    // 第一份银行流水（渠道 bank），不映射对方户名。
    await runtime.importService.run(
      { fileName: 'cib-2026.pdf', sizeBytes: toBytes(BANK_TEXT).length, bytes: toBytes(BANK_TEXT), format: 'pdf', text: BANK_TEXT },
      BANK_MAPPING,
      { sourceChannel: 'bank', userTimeZone: 'Asia/Shanghai' },
    );
    // 第二份银行流水（渠道仍是 bank），含同一笔 35.50 支出，但对方户名（交易用途）不同。
    const summary = await runtime.importService.run(
      { fileName: 'cib-2026b.pdf', sizeBytes: toBytes(BANK_TEXT_B).length, bytes: toBytes(BANK_TEXT_B), format: 'pdf', text: BANK_TEXT_B },
      { 0: 'occurredAt', 3: 'direction', 4: 'amount', 5: 'counterparty' },
      { sourceChannel: 'bank', userTimeZone: 'Asia/Shanghai' },
    );
    // 两端都是 bank → 不构成跨来源组合 → 不会被跨来源去重跳过；
    // 且对方户名不同 → 内容指纹也不重复 → 正常导入。
    expect(summary.rowCrossSourceDuplicate).toBe(0);
    expect(summary.rowImported).toBe(1);
  });
});
