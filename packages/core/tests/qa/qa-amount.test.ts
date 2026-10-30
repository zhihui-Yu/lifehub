/**
 * QA 独立补测 · A-02 金额精度（分为单位整数）。
 *
 * 覆盖需求：A-02 ①②③④；Q3 / Q8 裁决；系统设计 §1.2 难点 2、§7 T02 交付内容 2。
 *
 * 【本文件与工程师自写用例的差异】
 * 工程师的 `tests/unit/amount.test.ts` 覆盖了基本解析、千分位、全角、括号负数与 JPY。
 * 但以下三条**未被验证**：
 * 1. `parseAmountToMinor` 的实现里**是否真的没有 parseFloat**（源码级断言）；
 * 2. `￥-35.00 元` / `¥-35.00` 这类「货币符号在负号之前」的写法
 *    （系统设计 §7 T02 交付内容 2 明确点名要求支持）；
 * 3. **负号金额能否真正走完导入链路**（PRD A-06 ① 要求「金额正负号」是一条生效的推断策略）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatMinor, parseAmountToMinor, sumMinor } from '../../src/money/amount';
import { createTestRuntime, standardMapping } from '../helpers/runtime';

/** 读取金额模块源码，用于做「未使用 parseFloat」的源码级断言。 */
const amountSource = readFileSync(
  fileURLToPath(new URL('../../src/money/amount.ts', import.meta.url)),
  'utf8',
);

describe('A-02 · 解析全程不经过 parseFloat', () => {
  it('金额模块源码中不含 parseFloat 调用', () => {
    // 0.1 + 0.2 !== 0.3 的浮点误差会让账单求和对不上账，
    // 因此金额解析必须全程走字符串切分（系统设计 §1.2 难点 2）。
    expect(amountSource).not.toMatch(/parseFloat\s*\(/);
    // 也不允许用 Number() 直接转换含小数点的字符串。
    expect(amountSource).not.toMatch(/Number\s*\(\s*(text|digits|intPart|fracPart)\s*\)/);
  });

  it('0.1 + 0.2 类误差场景：100 次累加结果恒等于精确分值（A-02 ③）', () => {
    // 若用浮点，0.1 元 + 0.2 元 累加 100 次会得到 30.000000000000004 元。
    let total = 0;
    for (let index = 0; index < 100; index += 1) {
      total = sumMinor([total, parseAmountToMinor('0.30')]);
    }
    expect(total).toBe(3000);

    // 12.34 元累加 100 次（系统设计 §7 T02 验收原文）。
    let amountTotal = 0;
    for (let index = 0; index < 100; index += 1) {
      amountTotal = sumMinor([amountTotal, parseAmountToMinor('12.34')]);
    }
    expect(amountTotal).toBe(123_400);
  });

  it('12.34 元导入后存储值为 1234 分（A-02 ④）', () => {
    expect(parseAmountToMinor('12.34')).toBe(1234);
    expect(parseAmountToMinor('12.34 元')).toBe(1234);
    expect(parseAmountToMinor('￥12.34')).toBe(1234);
  });

  it('formatMinor 是 formatMinor 的逆运算，且不产生浮点误差', () => {
    for (const cents of [0, 1, 5, 99, 100, 1234, 999_999, 12_345_678]) {
      expect(parseAmountToMinor(formatMinor(cents))).toBe(cents);
    }
  });
});

describe('A-02 · 负数与括号负数', () => {
  it('前导负号在 allowNegative 打开时返回负分值', () => {
    expect(parseAmountToMinor('-35.00', { allowNegative: true })).toBe(-3500);
    expect(parseAmountToMinor('-35.00 元', { allowNegative: true })).toBe(-3500);
  });

  it('括号负数在 allowNegative 打开时返回负分值', () => {
    expect(parseAmountToMinor('(35.00)', { allowNegative: true })).toBe(-3500);
    expect(parseAmountToMinor('（35.00）', { allowNegative: true })).toBe(-3500);
  });

  it('allowNegative 关闭时负数被判非法（金额恒为正，方向由 direction 表达）', () => {
    expect(() => parseAmountToMinor('-35.00')).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_AMOUNT_INVALID' }),
    );
    expect(() => parseAmountToMinor('(35.00)')).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_AMOUNT_INVALID' }),
    );
  });

  it('货币符号在负号之前的写法（￥-35.00 元）可解析（系统设计 §7 T02 交付内容 2）', () => {
    // 该写法在系统设计 §7 T02「金额」条目中被明确点名要求支持。
    expect(parseAmountToMinor('￥-35.00 元', { allowNegative: true })).toBe(-3500);
    expect(parseAmountToMinor('¥-35.00', { allowNegative: true })).toBe(-3500);
    expect(parseAmountToMinor('$-35.00', { allowNegative: true })).toBe(-3500);
  });
});

describe('A-02 · 多币种小数位', () => {
  it('JPY 为 0 位小数（§8.2 币种小数位查表）', () => {
    expect(parseAmountToMinor('1234', { currency: 'JPY' })).toBe(1234);
    expect(parseAmountToMinor('0', { currency: 'JPY' })).toBe(0);
    expect(formatMinor(1234, 'JPY')).toBe('1234');
  });

  it('KWD 为 3 位小数（预留位）', () => {
    expect(parseAmountToMinor('1.234', { currency: 'KWD' })).toBe(1234);
    expect(formatMinor(1234, 'KWD')).toBe('1.234');
  });

  it('小数位超出币种精度时判非法，不做静默截断（防止金额失真）', () => {
    expect(() => parseAmountToMinor('12.34', { currency: 'JPY' })).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_AMOUNT_INVALID' }),
    );
    expect(() => parseAmountToMinor('1.2345', { currency: 'KWD' })).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_AMOUNT_INVALID' }),
    );
  });
});

describe('A-02 · 负号金额走完导入链路（PRD A-06 ①「金额正负号」策略）', () => {
  it('CSV 中带负号的金额行能成功导入，方向判为支出，金额取绝对值', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault('test-password-123');
    await runtime.vault.unlock('test-password-123');

    const csv = '时间,金额,对方,收支\n2024-01-15 08:30:00,-35.00,美团,支出\n';
    const bytes = new TextEncoder().encode(csv);
    const summary = await runtime.importService.run(
      { fileName: 'negative.csv', sizeBytes: bytes.length, bytes },
      standardMapping(),
      {},
    );

    // PRD A-06 ① 要求「金额正负号」是一条**生效**的推断策略：
    // 负号行必须能入库，而不是被当成「金额无法解析」整行跳过。
    expect(summary.errors).toEqual([]);
    expect(summary.rowImported).toBe(1);
    expect(summary.rowSkipped).toBe(0);

    const bills = await runtime.bills.list();
    expect(bills).toHaveLength(1);
    // A-02 ②：amountMinor 恒为正数，方向由 direction 表达。
    // 35.00 元 = 3500 分。
    expect(bills[0]?.amountMinor).toBe(3500);
    expect(bills[0]?.direction).toBe('expense');
    expect(bills[0]?.counterparty).toBe('美团');
  });

  it('directionRule.mode = "sign" 时，仅凭金额正负号即可判定方向', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault('test-password-123');
    await runtime.vault.unlock('test-password-123');

    const csv = '时间,金额,对方\n2024-01-15 08:30:00,-35.00,美团\n';
    const bytes = new TextEncoder().encode(csv);
    const summary = await runtime.importService.run(
      { fileName: 'sign-only.csv', sizeBytes: bytes.length, bytes },
      { 0: 'occurredAt', 1: 'amount', 2: 'counterparty' },
      { directionRule: { mode: 'sign', incomeKeywords: [], expenseKeywords: [] } },
    );

    expect(summary.errors).toEqual([]);
    expect(summary.rowImported).toBe(1);

    const bills = await runtime.bills.list();
    expect(bills[0]?.direction).toBe('expense');
    expect(bills[0]?.amountMinor).toBe(3500);
  });
});
