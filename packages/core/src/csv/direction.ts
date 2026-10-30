/**
 * 收支方向推断器。
 *
 * 架构位置：core 包「CSV 解析」模块，服务于 A-06（收支方向推断）。
 *
 * 优先级（PRD A-06 ①）：**显式收/支列 > 正负号 > 关键词**。
 *
 * 金额符号约定（依据 PRD Q8 / A-02 ② 裁决）：
 * `amountMinor` 恒为正数，方向由 `direction` 表达；
 * `income` / `refund` 为收入侧，`expense` 为支出侧。
 */
import { DIRECTION_EXPENSE_KEYWORDS, DIRECTION_INCOME_KEYWORDS } from '../constants';
import type { DirectionRule } from '../models/rule-template';
import type { Direction } from '../models/bill';
import { detectAmountSign } from '../money/amount-sign';
import type { MappedRow } from './column-mapper';

/** 方向推断结果。 */
export interface DirectionResult {
  /** 推断出的方向；null 表示无法判定（该行应跳过并记入错误明细）。 */
  direction: Direction | null;
  /** 命中的判定来源。 */
  source: 'sign' | 'column' | 'keyword' | 'none';
  /** 中文原因说明。 */
  reason: string;
}

/** 退款相关关键词（独立于收支，因为退款在统计上属于收入侧但语义不同）。 */
const REFUND_KEYWORDS: readonly string[] = ['退款', '退货', '返现', '退回', '已退款'];

/**
 * 收支方向推断器。
 */
export class DirectionResolver {
  /** 方向判定规则。 */
  private readonly rule: DirectionRule;

  /**
   * 构造方向推断器。
   *
   * @param rule 方向判定规则
   */
  constructor(rule: DirectionRule) {
    this.rule = rule;
  }

  /**
   * 推断一行的收支方向。
   *
   * @param row 已映射的语义字段
   * @returns 推断结果
   */
  resolve(row: MappedRow): DirectionResult {
    switch (this.rule.mode) {
      case 'column':
        return this.resolveByColumn(row);
      case 'sign':
        return this.resolveBySign(row);
      case 'keyword':
        return this.resolveByKeyword(row);
      case 'auto':
      default:
        return this.resolveAuto(row);
    }
  }

  /**
   * 自动模式：按「显式收/支列 > 正负号 > 关键词」优先级依次尝试。
   *
   * @param row 已映射的语义字段
   * @returns 推断结果
   */
  private resolveAuto(row: MappedRow): DirectionResult {
    const column = this.resolveByColumn(row);
    if (column.direction !== null) {
      return column;
    }
    // 自动模式下要求「显式负号」：无符号的正数金额不构成方向证据。
    const sign = this.resolveBySign(row, true);
    if (sign.direction !== null) {
      return sign;
    }
    return this.resolveByKeyword(row);
  }

  /**
   * 按显式收/支列判定。
   *
   * 说明：候选列按优先级取：
   * 1. `column` 模式下用规则里**显式配置**的列索引；
   * 2. `auto` 模式下优先用「映射到 `direction` 语义字段的那一列」——
   *    那是用户在映射页确认过的列，比规则的默认列索引更贴近用户意图（PRD A-06 ①）；
   * 3. 两者都取不到时再回退到规则里配置的列索引。
   *
   * 候选值无法归类时返回 `direction: null`，
   * `auto` 模式会继续尝试「金额正负号 → 关键词」，不会被一个无法归类的列卡住。
   *
   * @param row 已映射的语义字段
   * @returns 推断结果
   */
  private resolveByColumn(row: MappedRow): DirectionResult {
    const candidates = this.columnCandidates(row);
    if (candidates.length === 0) {
      return { direction: null, source: 'none', reason: '未指定收/支列' };
    }
    let reason = '收/支列为空';
    for (const candidate of candidates) {
      if (candidate === '') {
        continue;
      }
      const classified = classifyByKeywords(candidate, this.rule.incomeKeywords, this.rule.expenseKeywords);
      if (classified.direction !== null) {
        return { ...classified, source: 'column' };
      }
      reason = `收/支列「${candidate}」无法归类`;
    }
    return { direction: null, source: 'none', reason };
  }

  /**
   * 收集收/支列的候选文本（按优先级排列）。
   *
   * @param row 已映射的语义字段
   * @returns 候选文本列表（已去空白，可能含空串）
   */
  private columnCandidates(row: MappedRow): string[] {
    const ruleColumn = this.rule.columnIndex === undefined ? '' : (row.cells[this.rule.columnIndex] ?? '').trim();
    // 映射到 `direction` 语义字段的那一列——用户在映射页确认过的列。
    const mappedColumn = (row.direction ?? '').trim();
    if (this.rule.mode === 'column') {
      // 'column' 模式是用户显式指定列的，规则列优先于映射列。
      return [ruleColumn, mappedColumn];
    }
    return [mappedColumn, ruleColumn];
  }

  /**
   * 按金额正负号判定。
   *
   * @param row 已映射的语义字段
   * @param requireExplicitSign 是否要求「显式负号」才算方向证据
   * @returns 推断结果
   */
  private resolveBySign(row: MappedRow, requireExplicitSign = false): DirectionResult {
    const raw = (row.amount ?? '').trim();
    if (raw === '') {
      return { direction: null, source: 'none', reason: '金额为空' };
    }
    const negative = detectNegative(raw);
    if (negative === null) {
      return { direction: null, source: 'none', reason: `金额「${raw}」没有正负号` };
    }
    // 约定：负号表示支出，正号（含无符号）表示收入。
    // 这样「-35.00」这类银行导出写法可以零配置识别。
    if (negative) {
      return { direction: 'expense', source: 'sign', reason: '金额带负号，判定为支出' };
    }
    if (requireExplicitSign) {
      // 自动模式下「没有符号的正数」不构成方向证据：
      // 很多支付平台导出的金额列恒为正，收入支出靠独立的「收/支」列区分。
      // 这种情况下应继续尝试关键词，而不是把所有行都判成收入。
      return { direction: null, source: 'none', reason: `金额「${raw}」无正负号，不足以判定方向` };
    }
    return { direction: 'income', source: 'sign', reason: '金额为正，判定为收入' };
  }

  /**
   * 按关键词判定。
   *
   * @param row 已映射的语义字段
   * @returns 推断结果
   */
  private resolveByKeyword(row: MappedRow): DirectionResult {
    const text = [row.direction, row.counterparty, row.category, row.note]
      .filter((part) => part !== '')
      .join(' ');
    if (text.trim() === '') {
      return { direction: null, source: 'none', reason: '没有可用于关键词判定的文本' };
    }
    if (matchesAny(text, REFUND_KEYWORDS)) {
      return { direction: 'refund', source: 'keyword', reason: '命中退款关键词' };
    }
    if (matchesAny(text, this.rule.incomeKeywords)) {
      return { direction: 'income', source: 'keyword', reason: '命中收入关键词' };
    }
    if (matchesAny(text, this.rule.expenseKeywords)) {
      return { direction: 'expense', source: 'keyword', reason: '命中支出关键词' };
    }
    return { direction: null, source: 'none', reason: '未命中任何方向关键词' };
  }

  /**
   * 取默认收入关键词表。
   *
   * @returns 收入关键词数组副本
   */
  static defaultIncomeKeywords(): string[] {
    return [...DIRECTION_INCOME_KEYWORDS];
  }

  /**
   * 取默认支出关键词表。
   *
   * @returns 支出关键词数组副本
   */
  static defaultExpenseKeywords(): string[] {
    return [...DIRECTION_EXPENSE_KEYWORDS];
  }
}

/**
 * 判断文本是否命中关键词表中的任一词条。
 *
 * @param text 待检查文本
 * @param keywords 关键词表
 * @returns 命中返回 true
 */
function matchesAny(text: string, keywords: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}

/**
 * 按关键词把收/支列的取值归类为方向。
 *
 * 说明：退款关键词优先于收入 / 支出关键词——
 * 「退款」在语义上属于收入侧，但统计口径上要与普通收入区分（PRD Q8）。
 *
 * @param text 收/支列的取值
 * @param incomeKeywords 收入关键词表
 * @param expenseKeywords 支出关键词表
 * @returns 归类结果；无法归类时 `direction` 为 null
 */
function classifyByKeywords(
  text: string,
  incomeKeywords: readonly string[],
  expenseKeywords: readonly string[],
): DirectionResult {
  if (matchesAny(text, REFUND_KEYWORDS)) {
    return { direction: 'refund', source: 'column', reason: `收/支列「${text}」命中退款关键词` };
  }
  if (matchesAny(text, incomeKeywords)) {
    return { direction: 'income', source: 'column', reason: `收/支列「${text}」命中收入关键词` };
  }
  if (matchesAny(text, expenseKeywords)) {
    return { direction: 'expense', source: 'column', reason: `收/支列「${text}」命中支出关键词` };
  }
  return { direction: null, source: 'none', reason: `收/支列「${text}」无法归类` };
}

/**
 * 判断金额文本是否带负号。
 *
 * 说明：与 `money/amount.ts` 的解析口径**共用** `detectAmountSign()`，
 * 因此「金额能被解析成负数」与「方向能判定为支出」永远一致；
 * `￥-35.00` 这类「货币符号在负号之前」的写法也不会漏判。
 *
 * @param raw 金额文本
 * @returns 带负号返回 true，明确为正返回 false，无法判断返回 null
 */
function detectNegative(raw: string): boolean | null {
  return detectAmountSign(raw);
}
