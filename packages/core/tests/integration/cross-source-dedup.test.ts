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
    // 银行 1 笔 + 微信 3 笔 = 4 笔入账（绝不重复计入第 5 笔）；且银行原本缺失的商户与商品明细已被微信的「星巴克 / 拿铁」自动补全。
    expect(bills).toHaveLength(4);
    const mergedBill = bills.find((b) => b.amountMinor === 3550 && b.direction === 'expense');
    expect(mergedBill).toBeDefined();
    expect(mergedBill?.counterparty).toBe('星巴克');

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

  it('微信使用银行卡转账或消费时：银行流水仅有「快捷支付 + 支行」而微信含收款方与转账备注，导入后自动补全明细且不误吞同日同额零钱消费', async () => {
    const runtime = await createUnlockedRuntime();
    const bankQuickPayText = [
      '2026-11-10',
      '13:40:25 20261110 快捷支付 支 -65.00 ******',
      '兴业银行某支行作业中心',
    ].join('\n');
    const wechatMixedCsv = [
      '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注',
      '2026-11-10 13:40:25,转账,示例收款人,转账备注:微信转账,支出,65.00,某银行储蓄卡(1234),对方已收钱,t1,m1,/',
      '2026-11-10 19:15:00,商户消费,示例面馆,牛肉面,支出,65.00,零钱,支付成功,t2,m2,/',
    ].join('\n');

    // 先导入银行流水（仅有「快捷支付」与支行名）
    await runtime.importService.run(
      {
        fileName: '1234_TRANS_DETAIL.pdf',
        sizeBytes: toBytes(bankQuickPayText).length,
        bytes: toBytes(bankQuickPayText),
        format: 'pdf',
        text: bankQuickPayText,
      },
      { 0: 'occurredAt', 2: 'note', 3: 'direction', 4: 'amount', 5: 'counterparty' },
      { sourceChannel: 'bank', userTimeZone: 'Asia/Shanghai' },
    );

    // 后导入微信账单（含 1 笔绑卡微信转账 + 1 笔同日同金额零钱消费）
    const wxSummary = await runtime.importService.run(
      {
        fileName: '微信支付账单流水文件.csv',
        sizeBytes: toBytes(wechatMixedCsv).length,
        bytes: toBytes(wechatMixedCsv),
      },
      { 0: 'occurredAt', 1: 'category', 2: 'counterparty', 4: 'direction', 5: 'amount', 10: 'note' },
      { sourceChannel: 'wechat', userTimeZone: 'Asia/Shanghai' },
    );

    // 绑卡转账 1 对 1 命中跨来源去重，同日同金额的「零钱」消费不被误吞，正常入库！
    expect(wxSummary.rowCrossSourceDuplicate).toBe(1);
    expect(wxSummary.rowImported).toBe(1);

    const bills = await runtime.bills.list();
    expect(bills).toHaveLength(2);
    const enrichedTransferBill = bills.find((b) => b.occurredAt === '2026-11-10T05:40:25.000Z');
    expect(enrichedTransferBill?.counterparty).toBe('示例收款人');
    expect(enrichedTransferBill?.note).toBe('转账备注:微信转账');
    const walletMealBill = bills.find((b) => b.counterparty === '示例面馆');
    expect(walletMealBill?.note).toBe('牛肉面');
  });
});
