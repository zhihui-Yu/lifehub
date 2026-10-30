/**
 * 账单日期格式识别表。
 *
 * 架构位置：core 包「值对象」模块，为 csv/row-mapper 提供多种账单导出格式的解析能力。
 *
 * 覆盖格式（系统设计 §7 T02 交付内容第 3 条）：
 * 'ymd'（2024-01-15）、'ymdCompact'（20240115）、'ymdSlash'（2024/01/15）、
 * 'ymdCn'（2024年01月15日）、'iso'（2024-01-15T08:30:00+08:00）、
 * 'datetimeSlash'（2024/01/15 08:30:00）、'excelSerial'（Excel 日期序列号）。
 */
import { LifeHubError } from '../errors';

/** 单个日期格式描述符。 */
export interface DateFormatDescriptor {
  /** 格式标识，写入 ParsedDate.matchedFormat 与 RuleTemplate.dateFormatHints。 */
  id: string;
  /** 匹配该格式的正则。 */
  pattern: RegExp;
  /** 是否是「日期 + 时刻」型格式（否则只提供日期部分，时刻取 00:00）。 */
  hasTime: boolean;
}

/**
 * 日期格式识别表，按匹配优先级排列。
 *
 * 说明：`iso` 必须排在 `ymd` 之前，否则 '2024-01-15T08:30:00+08:00' 会被
 * 只匹配日期部分的 `ymd` 抢先命中，导致时刻信息丢失。
 */
export const DATE_FORMATS: readonly DateFormatDescriptor[] = [
  {
    id: 'iso',
    pattern: /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/,
    hasTime: true,
  },
  { id: 'ymdCn', pattern: /^(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/, hasTime: true },
  { id: 'ymdCompact', pattern: /^(\d{4})(\d{2})(\d{2})$/, hasTime: false },
  { id: 'ymdSlash', pattern: /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/, hasTime: true },
  { id: 'ymdDash', pattern: /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/, hasTime: true },
  { id: 'ymd', pattern: /^(\d{4})-(\d{2})-(\d{2})$/, hasTime: false },
];

/**
 * Excel 日期序列号的起始纪元：1899-12-30。
 *
 * 取值依据：Excel 1900 日期系统存在 1900-02-29 这一历史闰年 bug，
 * 业界通行做法是把纪元定在 1899-12-30 以保证序列号连续。
 */
export const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

/**
 * 判断字符串是否为 Excel 日期序列号（纯数字且落在合理区间）。
 *
 * @param raw 待判定的字符串
 * @returns 是序列号返回 true
 */
export function isExcelSerialDate(raw: string): boolean {
  if (!/^\d+(\.\d+)?$/.test(raw.trim())) {
    return false;
  }
  const value = Number.parseFloat(raw.trim());
  // Excel 有效日期范围约为 1900-01-01 ~ 9999-12-31，对应序列号 1 ~ 2958465。
  return value >= 1 && value <= 2_958_465;
}

/**
 * 把 Excel 日期序列号转换为 UTC 时刻。
 *
 * @param serial 日期序列号
 * @returns 对应的 UTC 时刻
 */
export function excelSerialToDate(serial: number): Date {
  const wholeDays = Math.floor(serial);
  const fraction = serial - wholeDays;
  return new Date(EXCEL_EPOCH_UTC + wholeDays * 86_400_000 + Math.round(fraction * 86_400_000));
}

/**
 * 把解析出的日期片段组装为 UTC 时刻。
 *
 * 说明：没有时区信息的「本地时间」按 UTC 解释，最终仍会按用户时区重算 localDate，
 * 避免「把本地时间当 UTC」导致的跨天偏差（系统设计 §1.2 难点 1）。
 *
 * @param year 年
 * @param month 月（1-12）
 * @param day 日（1-31）
 * @param hour 时（0-23）
 * @param minute 分（0-59）
 * @param second 秒（0-59）
 * @param offsetMinutes 相对 UTC 的分钟偏移，null 表示无时区信息
 * @returns 对应的 UTC 时刻
 */
export function buildUtcDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  offsetMinutes: number | null,
): Date {
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const shifted = offsetMinutes === null ? utcMs : utcMs - offsetMinutes * 60_000;
  return new Date(shifted);
}

/**
 * 把形如 '+08:00' / 'Z' 的时区偏移文本转换为分钟数。
 *
 * @param raw 偏移文本
 * @returns 相对 UTC 的分钟偏移；无时区信息时返回 null
 */
export function parseOffsetMinutes(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') {
    return null;
  }
  if (raw === 'Z' || raw === 'z') {
    return 0;
  }
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(raw);
  if (!match) {
    return null;
  }
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number.parseInt(match[2] ?? '0', 10);
  const minutes = Number.parseInt(match[3] ?? '0', 10);
  return sign * (hours * 60 + minutes);
}

/**
 * 校验日期片段是否构成一个真实存在的日期。
 *
 * @param year 年
 * @param month 月（1-12）
 * @param day 日（1-31）
 * @returns 合法返回 true
 */
export function isValidDateParts(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * 抛出统一的日期非法异常。
 *
 * @param raw 原始日期文本
 * @throws {LifeHubError} `LIFEHUB_E_DATE_INVALID`
 */
export function throwDateInvalid(raw: string): never {
  throw new LifeHubError('LIFEHUB_E_DATE_INVALID', undefined, { raw });
}
