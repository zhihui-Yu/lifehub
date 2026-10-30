/**
 * 规则模板实体。
 *
 * 架构位置：core 包的领域模型层，服务于 A-05（自定义列头映射）、A-06（方向推断）
 * 与 A-13（规则模板持久化与自动匹配）。
 */
import { DIRECTION_EXPENSE_KEYWORDS, DIRECTION_INCOME_KEYWORDS } from '../constants';
import { LifeHubError } from '../errors';
import type { BaseEntity } from '../types/common';

/**
 * 语义字段枚举。
 *
 * 取值依据：A-05「支持自定义列头映射」，这里定义可被映射到的账单语义字段。
 */
export type BillField =
  | 'occurredAt'
  | 'amount'
  | 'counterparty'
  | 'category'
  | 'direction'
  | 'balance'
  | 'note'
  | 'ignore';

/** 全部语义字段值。 */
export const BILL_FIELDS: readonly BillField[] = [
  'occurredAt',
  'amount',
  'counterparty',
  'category',
  'direction',
  'balance',
  'note',
  'ignore',
];

/** 必填语义字段：日期与金额。 */
export const REQUIRED_BILL_FIELDS: readonly BillField[] = ['occurredAt', 'amount'];

/**
 * 列映射：0 基列索引 → 语义字段。
 *
 * 说明：不依赖表头文字（表头改版不失效），未被映射的列视为 'ignore'。
 */
export type ColumnMapping = Record<number, BillField>;

/** 方向判定策略模式。 */
export type DirectionRuleMode = 'auto' | 'sign' | 'column' | 'keyword';

/** 方向判定规则。 */
export interface DirectionRule {
  /** 判定模式；'auto' 时按「显式收/支列 > 正负号 > 关键词」优先级执行。 */
  mode: DirectionRuleMode;
  /** mode='column' 时生效：收 / 支列的 0 基索引。 */
  columnIndex?: number;
  /** 收入关键词表。 */
  incomeKeywords: string[];
  /** 支出关键词表。 */
  expenseKeywords: string[];
}

/** 分类规则匹配类型。 */
export type CategoryMatchType = 'contains' | 'prefix' | 'exact' | 'regex';

/** 单条分类规则。 */
export interface CategoryRule {
  /** 规则 id。 */
  id: string;
  /** 优先级，数值越大越先匹配。 */
  priority: number;
  /** 匹配类型。 */
  matchType: CategoryMatchType;
  /** 匹配模式串。 */
  pattern: string;
  /** 命中后写入的分类 id。 */
  categoryId: string;
}

/** 规则模板实体。 */
export interface RuleTemplate extends BaseEntity {
  /** 模板 id。 */
  id: string;
  /** 模板名称。 */
  name: string;
  /** 表头行哈希（sha256 of 归一化后的表头行），用于自动匹配同格式文件。 */
  fileSignature: string;
  /** 0 基列索引 → 语义字段。 */
  columnMapping: ColumnMapping;
  /** 方向判定策略。 */
  directionRule: DirectionRule;
  /** 分类规则，按 priority 降序匹配，命中即停。 */
  categoryRules: CategoryRule[];
  /** 命中的日期格式标识列表，用于下次导入时优先尝试。 */
  dateFormatHints: string[];
}

/**
 * 构造默认方向判定规则。
 *
 * 说明：关键词表取自全局常量，便于用户在 UI 中扩展后保存到模板。
 *
 * @param mode 判定模式，默认 'auto'
 * @returns 默认方向规则
 */
export function createDefaultDirectionRule(mode: DirectionRuleMode = 'auto'): DirectionRule {
  return {
    mode,
    incomeKeywords: [...DIRECTION_INCOME_KEYWORDS],
    expenseKeywords: [...DIRECTION_EXPENSE_KEYWORDS],
  };
}

/**
 * 校验并返回一个合法的 RuleTemplate。
 *
 * @param template 待校验的未知值
 * @returns 校验通过的 RuleTemplate 对象
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 任一字段不满足约束
 */
export function validateRuleTemplate(template: unknown): RuleTemplate {
  if (typeof template !== 'object' || template === null) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '规则模板必须是对象');
  }
  const candidate = template as Record<string, unknown>;

  if (typeof candidate['id'] !== 'string' || candidate['id'] === '') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '规则模板 id 非法');
  }
  if (typeof candidate['name'] !== 'string' || candidate['name'].trim() === '') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '规则模板名称不能为空');
  }
  if (typeof candidate['fileSignature'] !== 'string') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '规则模板签名非法');
  }

  const mapping = candidate['columnMapping'];
  if (typeof mapping !== 'object' || mapping === null) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '规则模板列映射非法');
  }
  for (const [key, value] of Object.entries(mapping as Record<string, unknown>)) {
    if (!/^\d+$/.test(key) || typeof value !== 'string' || !(BILL_FIELDS as readonly string[]).includes(value)) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', '规则模板列映射包含非法项');
    }
  }

  const rule = candidate['directionRule'];
  if (typeof rule !== 'object' || rule === null) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '规则模板方向规则非法');
  }
  const ruleRecord = rule as Record<string, unknown>;
  const mode = ruleRecord['mode'];
  if (mode !== 'auto' && mode !== 'sign' && mode !== 'column' && mode !== 'keyword') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '规则模板方向模式非法');
  }
  if (!Array.isArray(ruleRecord['incomeKeywords']) || !Array.isArray(ruleRecord['expenseKeywords'])) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '规则模板关键词表非法');
  }

  if (!Array.isArray(candidate['categoryRules'])) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '规则模板分类规则非法');
  }
  for (const item of candidate['categoryRules'] as unknown[]) {
    if (typeof item !== 'object' || item === null) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', '分类规则必须是对象');
    }
    const ruleItem = item as Record<string, unknown>;
    if (typeof ruleItem['id'] !== 'string' || typeof ruleItem['pattern'] !== 'string') {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', '分类规则字段非法');
    }
    if (typeof ruleItem['priority'] !== 'number' || typeof ruleItem['categoryId'] !== 'string') {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', '分类规则字段非法');
    }
    const matchType = ruleItem['matchType'];
    if (matchType !== 'contains' && matchType !== 'prefix' && matchType !== 'exact' && matchType !== 'regex') {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', '分类规则匹配类型非法');
    }
  }

  if (!Array.isArray(candidate['dateFormatHints'])) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '规则模板日期格式提示非法');
  }

  return candidate as unknown as RuleTemplate;
}
