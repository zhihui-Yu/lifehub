/**
 * 日期时间工具。
 *
 * 架构位置：core 包「值对象」模块，是账单时间语义的唯一入口。
 *
 * 核心红线（系统设计 §1.2 难点 1、PRD A-03）：
 * 1. 时间戳统一为 ISO 8601 UTC（`occurredAt`）；
 * 2. 额外存 `localDate`（用户时区下的 `YYYY-MM-DD`），**所有跨天判定一律比较 localDate 字符串**，
 *    绝不做时刻差运算——UTC 20:30 在 Asia/Shanghai 已是次日，直接截取 occurredAt 前 10 位会算错；
 * 3. 不引入 moment / dayjs / date-fns，使用 ECMAScript 内置 `Intl.DateTimeFormat`，
 *    Node 22 与浏览器行为一致，且 Flutter/Dart 侧有等价实现。
 */
import { ISO_UTC_PATTERN, LOCAL_DATE_PATTERN } from '../constants';
import { LifeHubError } from '../errors';
import {
  DATE_FORMATS,
  DateFormatDescriptor,
  buildUtcDate,
  excelSerialToDate,
  isExcelSerialDate,
  isValidDateParts,
  parseOffsetMinutes,
  throwDateInvalid,
} from './date-formats';

/** 灵活日期解析选项。 */
export interface ParseDateOptions {
  /** 用于计算 localDate 的 IANA 时区，默认 'UTC'。 */
  timeZone?: string;
  /** 来源时区（账单文件自身携带的时区语义），默认与 `timeZone` 相同。 */
  sourceTimeZone?: string;
  /** 优先尝试的日期格式标识列表（来自 RuleTemplate.dateFormatHints）。 */
  dateFormatHints?: readonly string[];
}

/** 灵活日期解析结果。 */
export interface ParsedDate {
  /** ISO 8601 UTC 时间戳，如 '2024-06-03T08:12:00.000Z'。 */
  occurredAt: string;
  /** 用户时区下的日历日 'YYYY-MM-DD'，跨天 / 分组 / 连续天数判定一律用它。 */
  localDate: string;
  /** 来源时区 IANA 名，保留账单文件原始语义。 */
  sourceTimeZone: string;
  /** 命中的格式标识，用于回填 dateFormatHints。 */
  matchedFormat: string;
}

/**
 * 把时刻格式化为 ISO 8601 UTC 字符串（毫秒精度）。
 *
 * @param instant 目标时刻
 * @returns 形如 '2024-06-03T08:12:00.000Z' 的字符串
 */
export function formatIsoUtc(instant: Date): string {
  return instant.toISOString();
}

/**
 * 把时刻换算为指定时区下的日历日。
 *
 * 说明：用 `formatToParts()` 拼装 `YYYY-MM-DD`，而不是依赖 `en-CA` 区域格式，
 * 因为个别运行时下 `en-CA` 会退化成别的格式。
 *
 * @param instant 目标时刻
 * @param timeZone IANA 时区名，如 'Asia/Shanghai'
 * @returns 'YYYY-MM-DD' 形式的日历日
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 时区名不被 Intl 接受
 */
export function toLocalDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);

  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  if (year === '' || month === '' || day === '') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', `无法解析时区 ${timeZone} 下的日历日`);
  }
  return `${year}-${month}-${day}`;
}

/**
 * 把时刻换算为指定时区下的墙钟时间。
 *
 * @param instant 目标时刻
 * @param timeZone IANA 时区名
 * @returns 'HH:mm' 形式的墙钟时间
 */
export function toWallClock(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);

  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

/**
 * 给日历日加减天数。
 *
 * 说明：按日历日加减（而非按 24 小时），保证「今天」「连续天数」类判定不受时区与夏令时影响。
 *
 * @param localDate 'YYYY-MM-DD' 形式的日历日
 * @param days 要加减的天数，可为负
 * @returns 新的 'YYYY-MM-DD' 字符串
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 入参不是合法日历日
 */
export function addDays(localDate: string, days: number): string {
  if (!LOCAL_DATE_PATTERN.test(localDate)) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', `非法日历日：${localDate}`);
  }
  const [year = 0, month = 1, day = 1] = localDate.split('-').map((part) => Number.parseInt(part, 10));
  // 用 UTC 计算避免本地时区偏移导致跨日误差。
  const base = Date.UTC(year, month - 1, day);
  const shifted = new Date(base + days * 86_400_000);
  const y = shifted.getUTCFullYear().toString().padStart(4, '0');
  const m = (shifted.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = shifted.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 计算两个日历日之间的天数差（to - from）。
 *
 * @param from 起始日历日 'YYYY-MM-DD'
 * @param to 结束日历日 'YYYY-MM-DD'
 * @returns 相差天数，to 早于 from 时为负
 */
export function diffDays(from: string, to: string): number {
  const toUtc = (value: string): number => {
    const [year = 0, month = 1, day = 1] = value.split('-').map((part) => Number.parseInt(part, 10));
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

/**
 * 判断字符串是否为合法的 ISO 8601 UTC 时间戳（毫秒精度）。
 *
 * @param value 待判定的字符串
 * @returns 合法返回 true
 */
export function isIsoUtc(value: string): boolean {
  return ISO_UTC_PATTERN.test(value);
}

/**
 * 按单个格式描述符解析日期文本。
 *
 * @param raw 已归一（去空白）的日期文本
 * @param descriptor 格式描述符
 * @returns 解析出的 UTC 时刻；不匹配返回 null
 */
function parseByDescriptor(raw: string, descriptor: DateFormatDescriptor): Date | null {
  const match = descriptor.pattern.exec(raw);
  if (!match) {
    return null;
  }
  const year = Number.parseInt(match[1] ?? '0', 10);
  const month = Number.parseInt(match[2] ?? '1', 10);
  const day = Number.parseInt(match[3] ?? '1', 10);
  const hour = Number.parseInt(match[4] ?? '0', 10);
  const minute = Number.parseInt(match[5] ?? '0', 10);
  const second = Number.parseInt(match[6] ?? '0', 10);
  const offsetMinutes = parseOffsetMinutes(match[7]);

  if (!isValidDateParts(year, month, day)) {
    throwDateInvalid(raw);
  }
  if (hour > 23 || minute > 59 || second > 59) {
    throwDateInvalid(raw);
  }
  return buildUtcDate(year, month, day, hour, minute, second, offsetMinutes);
}

/**
 * 解析多种常见账单日期格式。
 *
 * 说明：优先尝试 `dateFormatHints` 中记录的格式（来自上一次导入的经验），
 * 再回落到通用格式表；Excel 序列号单独识别。
 * 无论命中哪种格式，最终都会按 `opts.timeZone` 重算 localDate，
 * 保证「今天 / 本周」类判定始终基于用户本地日历日。
 *
 * @param raw 原始日期文本，如 '20240115'、'2024/01/15 08:30:00'、'2024年01月15日'
 * @param opts 解析选项；`timeZone` 决定 localDate；`sourceTimeZone` 记录来源时区
 * @returns 解析结果，含 occurredAt / localDate / sourceTimeZone / matchedFormat
 * @throws {LifeHubError} `LIFEHUB_E_DATE_INVALID` —— 无法识别任何已知格式
 */
export function parseFlexibleDate(raw: string, opts?: ParseDateOptions): ParsedDate {
  const timeZone = opts?.timeZone ?? 'UTC';
  const sourceTimeZone = opts?.sourceTimeZone ?? timeZone;

  if (typeof raw !== 'string') {
    throw new LifeHubError('LIFEHUB_E_DATE_INVALID');
  }
  // 归一化：去首尾空白、把全角空格换成半角；账单导出里这两种写法都很常见。
  // 全角空格（U+3000）用 Unicode 转义书写，避免源码里出现不可见字符影响代码评审与 lint。
  const text = raw.trim().replace(/\u3000/g, ' ');
  if (text === '') {
    throwDateInvalid(raw);
  }

  // Excel 序列号：纯数字且在有效区间内时优先按序列号处理，
  // 否则 '20240115' 这类紧凑日期会被误判成序列号（它远大于 Excel 上限，实际不会命中）。
  if (isExcelSerialDate(text)) {
    const instant = excelSerialToDate(Number.parseFloat(text));
    return {
      occurredAt: formatIsoUtc(instant),
      localDate: toLocalDate(instant, timeZone),
      sourceTimeZone,
      matchedFormat: 'excelSerial',
    };
  }

  const hints = opts?.dateFormatHints ?? [];
  const ordered: DateFormatDescriptor[] = [
    ...DATE_FORMATS.filter((format) => hints.includes(format.id)),
    ...DATE_FORMATS.filter((format) => !hints.includes(format.id)),
  ];

  for (const descriptor of ordered) {
    const instant = parseByDescriptor(text, descriptor);
    if (instant) {
      return {
        occurredAt: formatIsoUtc(instant),
        localDate: toLocalDate(instant, timeZone),
        sourceTimeZone,
        matchedFormat: descriptor.id,
      };
    }
  }

  throwDateInvalid(raw);
}
