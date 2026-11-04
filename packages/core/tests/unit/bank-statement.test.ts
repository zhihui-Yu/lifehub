/**
 * 银行流水文本解析器单元测试。
 *
 * 覆盖需求：A-25（多格式导入）/ A-21（跨来源去重的数据来源）。
 *
 * 说明：用真实 PDF 文本 fixture（`bank-cib-20261031.txt`）做断言，
 * 同时用合成用例覆盖「主行先于日期行」重构日期、同行内交易用途、
 * 与噪声（页眉 / 页脚 / 订单号）过滤等边界。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBankStatementText } from '../../src/index';

/** 读取夹具文件文本。 */
function fixtureText(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8');
}

describe('parseBankStatementText（兴业银行脱敏 fixture）', () => {
  it('产出 5 行规整记录，表头与微信 / CSV 同源', () => {
    const text = fixtureText('bank-cib-20261031.txt');
    const table = parseBankStatementText(text.split(/\r\n|\r|\n/));
    expect(table.headers).toEqual(['交易时间', '记账日期', '摘要', '收支方向', '交易金额', '交易用途']);
    // 脱敏夹具共有 5 条主交易行（3 笔支出 + 2 笔收入），页眉 / 页脚 / 订单号均被过滤。
    expect(table.rows).toHaveLength(5);
  });

  it('首笔交易被正确拼回：日期 + 时间 + 金额绝对值 + 方向 + 对方碎片', () => {
    const text = fixtureText('bank-cib-20261031.txt');
    const table = parseBankStatementText(text.split(/\r\n|\r|\n/));
    const first = table.rows[0] ?? [];
    expect(first[0]).toBe('2026-08-01 11:03:18'); // 交易时间
    expect(first[1]).toBe('2026-08-01'); // 记账日期
    expect(first[2]).toBe('快捷支付'); // 摘要
    expect(first[3]).toBe('支出'); // 收支方向（统一为两字中文，便于下游复用方向关键字）
    expect(first[4]).toBe('6000.00'); // 交易金额（绝对值，千分位已剥离）
    expect(first[5]).toContain('蚂蚁'); // 被拆行的对方户名碎片已并入交易用途
    expect(first[5]).toContain('基金销售');
  });

  it('同行内带有交易用途时直接取用（不漏、不重复）', () => {
    const lines = [
      '2026-08-01',
      '11:03:36 20260801 跨行代付 收 6,000.00 ****** 银联转账（云闪付）',
      '2026-08-02',
    ];
    const table = parseBankStatementText(lines);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]?.[3]).toBe('收入');
    expect(table.rows[0]?.[4]).toBe('6000.00');
    expect(table.rows[0]?.[5]).toBe('银联转账（云闪付）');
  });
});

describe('parseBankStatementText（合成边界用例）', () => {
  it('主行先于日期行出现时，用记账日期（8 位）反推交易日期', () => {
    const lines = [
      '11:03:18 20260801 快捷支付 支 -35.50 ******',
      '2026-08-01',
    ];
    const table = parseBankStatementText(lines);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]?.[0]).toBe('2026-08-01 11:03:18');
    expect(table.rows[0]?.[1]).toBe('2026-08-01');
    expect(table.rows[0]?.[3]).toBe('支出');
    expect(table.rows[0]?.[4]).toBe('35.50');
  });

  it('页眉 / 页脚 / 订单号等噪声不生成记录', () => {
    const lines = [
      '兴业银行交易明细',
      'Industrial Bank Transaction Details',
      '说明：交易明细涉及您的个人隐私',
      '打印日期：2026-10-31 00:22:08',
      '2026-08-01',
      '11:03:18 20260801 快捷支付 支 -23.00 ******',
      '订单',
      '2026080111010001053461',
      '2026-08-02',
      '19:15:49 20260802 跨行代付 收 1,000.00 ****** 银联转账（云闪付）',
    ];
    const table = parseBankStatementText(lines);
    expect(table.rows).toHaveLength(2);
    // 噪声行（订单 / 长订单号）未污染交易用途。
    expect(table.rows[0]?.[5]).toBe('');
    expect(table.rows[1]?.[5]).toBe('银联转账（云闪付）');
  });

  it('时间缺失时仅用日期作为交易时间', () => {
    const lines = ['2026-08-01', '11:03:18 20260801 快捷支付 支 -9.90 ******'];
    const table = parseBankStatementText(lines);
    expect(table.rows[0]?.[0]).toBe('2026-08-01 11:03:18');
  });

  it('中国建设银行格式：支持带符号千分位金额、8位日期标准化、跨行对方户名无缝拼接与表头页脚过滤', () => {
    const lines = [
      '中国建设银行个人活期账户交易明细',
      '当前时间段收支金额合计：人民币元； 总支出：1,540.73',
      '序号 摘要 交易日期 交易金额 账户余额 交易地点/附言 对方账号与户名',
      '100000000000001/示例网络科技有限',
      '1 消费 20261011 -3.99 531.65 ***',
      '公司',
      '2 消费退货 20261011 11.90 543.55 *** 100000000000001/示例网络科技有限公司',
      '9 银联入账 20261014 1,000.00 1,528.88 *** 银联入账',
      '21 银联代收 20261020 -501.05 1,106.04 *** 800000000000002/某银行（信用卡',
      '还款）',
      '生成时间：2026-10-31 00:00:00 第1页/共1页',
      '温馨提示：仅供您核对账务使用',
    ];
    const table = parseBankStatementText(lines);
    expect(table.headers).toEqual(['交易时间', '记账日期', '摘要', '收支方向', '交易金额', '交易用途']);
    expect(table.rows).toHaveLength(4);
    expect(table.rows[0]).toEqual(['2026-10-11', '2026-10-11', '消费', '支出', '3.99', '公司']);
    expect(table.rows[1]).toEqual([
      '2026-10-11',
      '2026-10-11',
      '消费退货',
      '收入',
      '11.90',
      '100000000000001/示例网络科技有限公司',
    ]);
    expect(table.rows[2]).toEqual(['2026-10-14', '2026-10-14', '银联入账', '收入', '1000.00', '银联入账']);
    expect(table.rows[3]).toEqual([
      '2026-10-20',
      '2026-10-20',
      '银联代收',
      '支出',
      '501.05',
      '800000000000002/某银行（信用卡还款）',
    ]);
  });

  it('中国银行格式：支持带时间交易主行、收支符号识别、跨行对方账户名无缝拼接与表头页脚过滤（T-BOC-PdfImport-1）', () => {
    const lines = [
      '中国银行交易流水明细清单',
      '交易区间：2026-10-01 至 2026-10-31 借记卡号：621700*********0000 页数: 第1页/共2页',
      '借方发生数：325.22 贷方发生数：21.18 行数: 15',
      '2026-10-05 12:12:41 人民币 -20.51 542.59 网上快捷支付 财付通-示例快餐门',
      '店中心店',
      '2026-10-27 16:14:57 人民币 21.18 550.27 银联入账 张三',
      '----------------END----------------',
      '温馨提示：1.交易流水明细清单并非最终的记账凭证，仅供您核对账务使用。',
    ];
    const table = parseBankStatementText(lines);
    expect(table.headers).toEqual(['交易时间', '记账日期', '摘要', '收支方向', '交易金额', '交易用途']);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]).toEqual([
      '2026-10-05 12:12:41',
      '2026-10-05',
      '网上快捷支付',
      '支出',
      '20.51',
      '财付通-示例快餐门店中心店',
    ]);
    expect(table.rows[1]).toEqual([
      '2026-10-27 16:14:57',
      '2026-10-27',
      '银联入账',
      '收入',
      '21.18',
      '张三',
    ]);
  });
});
