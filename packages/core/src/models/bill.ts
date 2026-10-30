/**
 * 账单实体。
 *
 * 架构位置：core 包的领域模型层，是模块 A（记账）的主实体。
 * 字段逐条对齐系统设计 §3.1.1。
 */
import { CURRENCY_EXPONENT, CurrencyCode } from '../money/currency';
import { ISO_UTC_PATTERN, LOCAL_DATE_PATTERN } from '../constants';
import { LifeHubError } from '../errors';
import type { BaseEntity } from '../types/common';

/**
 * 收支方向。
 *
 * 取值依据：PRD Q8「新增 refund，金额为正」，与设计 §5 假设 A-1 一致。
 */
export type Direction = 'income' | 'expense' | 'refund';

/** 全部合法方向值。 */
export const DIRECTIONS: readonly Direction[] = ['income', 'expense', 'refund'];

/** 账单实体。 */
export interface Bill extends BaseEntity {
  /** UUIDv7，全局唯一。 */
  id: string;
  /** 以「分」为单位的整数金额，恒为正数（refund 亦为正）。 */
  amountMinor: number;
  /** ISO 4217 货币代码，v1 仅 'CNY'。 */
  currency: CurrencyCode;
  /** 收支方向。 */
  direction: Direction;
  /** ISO 8601 UTC 时间戳，形如 '2024-06-03T08:12:00.000Z'。 */
  occurredAt: string;
  /** 用户本地时区下的日历日 'YYYY-MM-DD'，跨天 / 分组 / 连续天数判定一律用它。 */
  localDate: string;
  /** 来源 IANA 时区名，保留账单文件原始语义。 */
  sourceTimeZone: string;
  /** 交易对方，可为空串。 */
  counterparty: string;
  /** 分类 id；未分类为 null。 */
  categoryId: string | null;
  /** 备注，可为空串。 */
  note: string;
  /** 导入批次 id。 */
  sourceFileId: string;
  /** 源文件内数据行的 0 基行号（不含表头）。 */
  sourceRowIndex: number;
}

/**
 * 类型守卫：判断未知值是否为合法方向。
 *
 * @param value 待判定的未知值
 * @returns 合法方向返回 true
 */
export function isDirection(value: unknown): value is Direction {
  return typeof value === 'string' && (DIRECTIONS as readonly string[]).includes(value);
}

/**
 * 校验并返回一个合法的 Bill。
 *
 * 说明：所有外部输入（CSV 行、导入摘要、备份还原）都必须经过本函数，
 * 禁止把未校验对象直接写入存储（系统设计 §8.4 类型纪律）。
 *
 * @param bill 待校验的未知值
 * @returns 校验通过的 Bill 对象
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 任一字段不满足约束
 */
export function validateBill(bill: unknown): Bill {
  if (typeof bill !== 'object' || bill === null) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '账单必须是对象');
  }
  const candidate = bill as Record<string, unknown>;

  const id = candidate['id'];
  if (typeof id !== 'string' || id === '') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '账单 id 非法');
  }

  const amountMinor = candidate['amountMinor'];
  if (typeof amountMinor !== 'number' || !Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '账单金额必须是非负整数分');
  }

  const currency = candidate['currency'];
  if (typeof currency !== 'string' || !Object.prototype.hasOwnProperty.call(CURRENCY_EXPONENT, currency)) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '账单币种非法');
  }

  const direction = candidate['direction'];
  if (!isDirection(direction)) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '账单方向非法');
  }

  const occurredAt = candidate['occurredAt'];
  if (typeof occurredAt !== 'string' || !ISO_UTC_PATTERN.test(occurredAt)) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '账单时间戳必须是 ISO 8601 UTC');
  }

  const localDate = candidate['localDate'];
  if (typeof localDate !== 'string' || !LOCAL_DATE_PATTERN.test(localDate)) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '账单本地日期必须是 YYYY-MM-DD');
  }

  const sourceTimeZone = candidate['sourceTimeZone'];
  if (typeof sourceTimeZone !== 'string' || sourceTimeZone === '') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '账单来源时区非法');
  }

  const counterparty = candidate['counterparty'];
  if (typeof counterparty !== 'string') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '账单交易对方必须是字符串');
  }

  const categoryId = candidate['categoryId'];
  if (categoryId !== null && typeof categoryId !== 'string') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '账单分类 id 非法');
  }

  const note = candidate['note'];
  if (typeof note !== 'string') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '账单备注必须是字符串');
  }

  const sourceFileId = candidate['sourceFileId'];
  if (typeof sourceFileId !== 'string' || sourceFileId === '') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '账单来源文件 id 非法');
  }

  const sourceRowIndex = candidate['sourceRowIndex'];
  if (typeof sourceRowIndex !== 'number' || !Number.isInteger(sourceRowIndex) || sourceRowIndex < 0) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '账单来源行号必须是非负整数');
  }

  const createdAt = candidate['createdAt'];
  const updatedAt = candidate['updatedAt'];
  if (typeof createdAt !== 'string' || !ISO_UTC_PATTERN.test(createdAt)) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '账单创建时间必须是 ISO 8601 UTC');
  }
  if (typeof updatedAt !== 'string' || !ISO_UTC_PATTERN.test(updatedAt)) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '账单更新时间必须是 ISO 8601 UTC');
  }

  const version = candidate['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '账单版本号必须是从 1 开始的整数');
  }

  const deviceId = candidate['deviceId'];
  if (typeof deviceId !== 'string' || deviceId === '') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '账单设备 id 非法');
  }

  return candidate as unknown as Bill;
}
