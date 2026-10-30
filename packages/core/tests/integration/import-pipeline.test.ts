/**
 * 导入流水线集成测试。
 *
 * 覆盖需求：A-04、A-05、A-06、A-10、A-11、A-12、A-13。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ColumnMapping } from '../../src/index';
import { createUnlockedRuntime, standardMapping } from '../helpers/runtime';

/** 读取夹具文件内容。 */
function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/csv/${name}`, import.meta.url)), 'utf8');
}

/** 把文本转成 UTF-8 字节。 */
function toBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * 微信支付导出文件的列映射。
 *
 * 说明：表头为
 * `交易时间(0) / 交易类型(1) / 交易对方(2) / 商品(3) / 收/支(4) / 金额(元)(5) /
 *  支付方式(6) / 当前状态(7) / 交易单号(8) / 商户单号(9) / 备注(10)`。
 */
const WECHAT_MAPPING: ColumnMapping = {
  0: 'occurredAt',
  2: 'counterparty',
  4: 'direction',
  5: 'amount',
};

/** 含方向列的简单夹具映射（`simple-with-direction.csv`）。 */
const SIMPLE_DIRECTION_MAPPING: ColumnMapping = {
  0: 'occurredAt',
  1: 'amount',
  2: 'counterparty',
  3: 'direction',
};

describe('ImportService.plan', () => {
  it('探查文件得到表头、行数、签名与建议映射', async () => {
    const runtime = await createUnlockedRuntime();
    const bytes = toBytes(fixture('wechat-pay.csv'));
    const plan = await runtime.importService.plan({ fileName: 'wechat-pay.csv', sizeBytes: bytes.length, bytes });

    expect(plan.headers).toContain('交易时间');
    expect(plan.rowCount).toBe(5);
    expect(plan.fileSignature).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.suggestedMapping[0]).toBe('occurredAt');
    // 「收/支」列（第 4 列）建议映射为 direction，「金额(元)」列（第 5 列）建议映射为 amount。
    expect(plan.suggestedMapping[4]).toBe('direction');
    expect(plan.suggestedMapping[5]).toBe('amount');
    expect(plan.preview.length).toBeGreaterThan(0);
  });

  it('plan 不落库（只读探查）', async () => {
    const runtime = await createUnlockedRuntime();
    const bytes = toBytes(fixture('wechat-pay.csv'));
    await runtime.importService.plan({ fileName: 'wechat-pay.csv', sizeBytes: bytes.length, bytes });
    expect(await runtime.bills.list()).toHaveLength(0);
    expect(await runtime.batches.list()).toHaveLength(0);
  });
});

describe('ImportService.run', () => {
  it('导入账单并按 localDate 分组可查', async () => {
    const runtime = await createUnlockedRuntime();
    const bytes = toBytes(fixture('wechat-pay.csv'));
    const summary = await runtime.importService.run(
      { fileName: 'wechat-pay.csv', sizeBytes: bytes.length, bytes },
      WECHAT_MAPPING,
      { userTimeZone: 'Asia/Shanghai' },
    );

    expect(summary.rowImported).toBe(5);
    expect(summary.rowSkipped).toBe(0);
    expect(summary.duplicateFile).toBe(false);

    const bills = await runtime.bills.list();
    expect(bills).toHaveLength(5);
    // 第一行是星巴克 35.50 元。
    const starbucks = bills.find((bill) => bill.counterparty.includes('星巴克'));
    expect(starbucks?.amountMinor).toBe(3550);
    expect(starbucks?.direction).toBe('expense');
    expect(starbucks?.localDate).toBe('2024-01-15');
  });

  it('带引号的备注与带逗号的备注被完整解析', async () => {
    const runtime = await createUnlockedRuntime();
    const bytes = toBytes(fixture('wechat-pay.csv'));
    await runtime.importService.run(
      { fileName: 'wechat-pay.csv', sizeBytes: bytes.length, bytes },
      { ...WECHAT_MAPPING, 10: 'note' },
      { userTimeZone: 'Asia/Shanghai' },
    );
    const notes = (await runtime.bills.list()).map((bill) => bill.note);
    expect(notes).toContain('含逗号, 的备注');
    expect(notes).toContain('含"引号"的备注');
  });

  it('坏行不中断导入，记入错误明细（A-11 ①③）', async () => {
    const runtime = await createUnlockedRuntime();
    const text = '日期,金额,对方,方向\n' + '2024-01-15,abc,星巴克,支出\n' + '2024-01-16,12.00,便利店,支出\n';
    const bytes = toBytes(text);
    const summary = await runtime.importService.run(
      { fileName: 'bad-row.csv', sizeBytes: bytes.length, bytes },
      standardMapping(),
      { userTimeZone: 'Asia/Shanghai' },
    );

    expect(summary.rowTotal).toBe(2);
    expect(summary.rowImported).toBe(1);
    expect(summary.rowSkipped).toBe(1);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]?.rowIndex).toBe(0);
    expect(summary.errors[0]?.reason).toContain('金额');
  });

  it('方向无法判定时该行被跳过（A-06 ②）', async () => {
    const runtime = await createUnlockedRuntime();
    const text = '日期,金额,对方,方向\n2024-01-15,12.00,某某,不明\n';
    const bytes = toBytes(text);
    const summary = await runtime.importService.run(
      { fileName: 'unknown-direction.csv', sizeBytes: bytes.length, bytes },
      standardMapping(),
      { userTimeZone: 'Asia/Shanghai' },
    );
    expect(summary.rowImported).toBe(0);
    expect(summary.errors[0]?.reason).toContain('收支方向');
  });

  it('写入 ImportBatch 记录行数统计与文件哈希（A-11 ③）', async () => {
    const runtime = await createUnlockedRuntime();
    const bytes = toBytes(fixture('simple-with-direction.csv'));
    await runtime.importService.run(
      { fileName: 'simple-with-direction.csv', sizeBytes: bytes.length, bytes },
      SIMPLE_DIRECTION_MAPPING,
      { userTimeZone: 'Asia/Shanghai' },
    );
    const batches = await runtime.batches.list();
    expect(batches).toHaveLength(1);
    expect(batches[0]?.fileName).toBe('simple-with-direction.csv');
    expect(batches[0]?.rowImported).toBe(3);
    expect(batches[0]?.fileHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('写审计日志 import 动作（X-07）', async () => {
    const runtime = await createUnlockedRuntime();
    const bytes = toBytes(fixture('simple-with-direction.csv'));
    await runtime.importService.run(
      { fileName: 'simple-with-direction.csv', sizeBytes: bytes.length, bytes },
      SIMPLE_DIRECTION_MAPPING,
      { userTimeZone: 'Asia/Shanghai' },
    );
    const logs = await runtime.audit.list();
    expect(logs.some((log) => log.action === 'import' && log.target === 'simple-with-direction.csv')).toBe(true);
  });

  it('必填字段未映射时抛 LIFEHUB_E_MAPPING_INCOMPLETE', async () => {
    const runtime = await createUnlockedRuntime();
    const bytes = toBytes(fixture('simple.csv'));
    await expect(
      runtime.importService.run(
        { fileName: 'simple.csv', sizeBytes: bytes.length, bytes },
        {},
        { userTimeZone: 'Asia/Shanghai' },
      ),
    ).rejects.toThrowError(expect.objectContaining({ code: 'LIFEHUB_E_MAPPING_INCOMPLETE' }));
  });

  it('同一文件重复导入被识别（A-12 ②）', async () => {
    const runtime = await createUnlockedRuntime();
    const bytes = toBytes(fixture('simple-with-direction.csv'));
    const mapping: ColumnMapping = SIMPLE_DIRECTION_MAPPING;
    await runtime.importService.run(
      { fileName: 'simple-with-direction.csv', sizeBytes: bytes.length, bytes },
      mapping,
      { userTimeZone: 'Asia/Shanghai' },
    );
    const second = await runtime.importService.run(
      { fileName: 'simple-with-direction.csv', sizeBytes: bytes.length, bytes },
      mapping,
      { userTimeZone: 'Asia/Shanghai' },
    );
    expect(second.duplicateFile).toBe(true);
    expect(second.rowImported).toBe(0);
  });

  it('命中已有规则模板时自动匹配签名并预填映射（A-13）', async () => {
    const runtime = await createUnlockedRuntime();
    const bytes = toBytes(fixture('simple.csv'));
    const plan = await runtime.importService.plan({ fileName: 'simple.csv', sizeBytes: bytes.length, bytes });

    await runtime.templates.save({
      id: 'tpl-1',
      name: '简单模板',
      fileSignature: plan.fileSignature,
      columnMapping: { 0: 'occurredAt', 1: 'amount', 2: 'counterparty' },
      directionRule: { mode: 'auto', incomeKeywords: ['收入'], expenseKeywords: ['支出'] },
      categoryRules: [],
      dateFormatHints: [],
      createdAt: '2024-01-15T08:12:00.000Z',
      updatedAt: '2024-01-15T08:12:00.000Z',
      version: 1,
      deviceId: 'test-device',
    });

    const second = await runtime.importService.plan({ fileName: 'simple.csv', sizeBytes: bytes.length, bytes });
    expect(second.matchedTemplateId).toBe('tpl-1');
    expect(second.suggestedMapping).toEqual({ 0: 'occurredAt', 1: 'amount', 2: 'counterparty' });
  });

  it('Excel 序列号日期能被解析', async () => {
    const runtime = await createUnlockedRuntime();
    const text = '日期,金额,对方,方向\n45306,35.50,星巴克,支出\n';
    const bytes = toBytes(text);
    await runtime.importService.run(
      { fileName: 'excel.csv', sizeBytes: bytes.length, bytes },
      SIMPLE_DIRECTION_MAPPING,
      { userTimeZone: 'UTC' },
    );
    const bills = await runtime.bills.list();
    expect(bills[0]?.localDate).toBe('2024-01-15');
  });
});
