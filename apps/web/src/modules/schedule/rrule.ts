/**
 * 课表时段重复规则（RFC 5545 RRULE 子集与固定星期）解析与展开器（模块 B：B-01 / B-03 / B-05）。
 *
 * 架构位置：apps/web 的「生活课表模块」领域层。
 *
 * 核心设计约束（ADR-006 / X-09）：
 * 1. 课表时段的开始时间 `startTime` 与结束时间 `endTime` 均为墙上时间 `'HH:mm'` 字符串，
 *    直接按字面值存储、展示与排序，**严禁做 UTC 转换**，保证跨时区旅行或夏令时切换时课表不漂移；
 * 2. 日期展开完全基于 `localDate`（`'YYYY-MM-DD'`）日历日推进，正确处理跨月、跨年与闰年 `2024-02-29`。
 */
import { addDays, LifeHubError } from '@lifehub/core';
import { weekdayOf } from '@/modules/shared/date-utils';

/** 支持的 RFC 5545 重复频率。 */
export type RRuleFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

/** RFC 5545 星期缩写到 0..6（0=周日，1=周一 … 6=周六）的映射。 */
const BYDAY_MAP: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

/**
 * 解析后的 RRULE 结构。
 *
 * 说明：覆盖常用 RFC 5545 子集字段，供课表按日/周/月/年展开。
 */
export interface ParsedRRule {
  /** 重复频率。 */
  freq: RRuleFreq;
  /** 步长间隔（默认 1）。 */
  interval: number;
  /** 指定星期几列表（0=周日 … 6=周六）。 */
  byDay?: number[];
  /** 指定每月的第几天（正数 1..31 或负数 -1..-31 表示倒数第几天）。 */
  byMonthDay?: number[];
  /** 截止日期（含），格式 'YYYY-MM-DD'。 */
  until?: string;
  /** 最大发生次数（正整数）。 */
  count?: number;
}

/**
 * 本地持久化与运行时的课表时段模型（对应 Dexie `scheduleSlots` 表）。
 *
 * 说明：同时支持 `dayOfWeek`（0..6 固定按周循环）与 `rrule`（RFC 5545 子集字符串）。
 */
export interface StoredScheduleSlot {
  /** 主键 ID。 */
  id: string;
  /** 时段标题（如「高等数学」「晨间阅读」）。 */
  title: string;
  /** 开始墙上时间 'HH:mm'（不做 UTC 换算）。 */
  startTime: string;
  /** 结束墙上时间 'HH:mm'（不做 UTC 换算）。 */
  endTime: string;
  /** 固定按周重复的星期几（0=周日，1=周一 … 6=周六）。 */
  dayOfWeek?: number;
  /** 可选 RFC 5545 子集规则字符串，如 'FREQ=WEEKLY;BYDAY=MO,WE,FR'。 */
  rrule?: string;
  /** 生效起始日 'YYYY-MM-DD'（含）。 */
  validFrom?: string;
  /** 生效截止日 'YYYY-MM-DD'（含）。 */
  validUntil?: string;
  /** 地点描述。 */
  location?: string;
  /** 分类标签。 */
  category?: string;
  /** 主题颜色 '#RRGGBB'。 */
  color?: string;
  /** 备注说明。 */
  note?: string;
  /** 创建时间 ISO 8601 UTC。 */
  createdAt: string;
  /** 更新时间 ISO 8601 UTC。 */
  updatedAt: string;
}

/**
 * 展开到具体日历日后的课表实例。
 *
 * 说明：用于日视图、周视图渲染及完成率统计。
 */
export interface ExpandedScheduleInstance {
  /** 所属课表时段 ID。 */
  slotId: string;
  /** 原始课表时段对象。 */
  slot: StoredScheduleSlot;
  /** 展开后的本地日历日 'YYYY-MM-DD'。 */
  localDate: string;
  /** 开始墙上时间 'HH:mm'。 */
  startTime: string;
  /** 结束墙上时间 'HH:mm'。 */
  endTime: string;
  /** 时段标题。 */
  title: string;
  /** 地点。 */
  location?: string;
  /** 颜色。 */
  color?: string;
  /** 备注。 */
  note?: string;
}

/**
 * 判断某年是否为闰年。
 *
 * 说明：能被 4 整除且不能被 100 整除，或能被 400 整除的年份为闰年。
 *
 * @param year 四位年份
 * @returns 闰年返回 true
 * @throws 无
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * 获取指定年月的总天数。
 *
 * 说明：2 月在闰年返回 29 天，平年返回 28 天。
 *
 * @param year 四位年份
 * @param month 月份（1..12）
 * @returns 该月总天数（28..31）
 * @throws 无
 */
export function getDaysInMonth(year: number, month: number): number {
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return isLeapYear(year) ? 29 : 28;
    default:
      return 30;
  }
}

/**
 * 校验墙上时间字符串是否为合法的 'HH:mm'（00:00 .. 23:59）。
 *
 * 说明：课表墙上时间统一使用 24 小时制两位零填充格式。
 *
 * @param wallTime 待校验的墙上时间字符串
 * @returns 合法返回 true
 * @throws 无
 */
export function isValidWallTime(wallTime: string): boolean {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(wallTime.trim());
  return match !== null;
}

/**
 * 将 UNTIL 字符串归一化为 'YYYY-MM-DD'。
 *
 * 说明：兼容 '2026-12-31'、'20261231' 以及 '20261231T235959Z' 格式。
 *
 * @param raw 原始 UNTIL 值
 * @returns 归一化后的 'YYYY-MM-DD'
 * @throws {LifeHubError} 格式非法时抛出异常
 */
function normalizeUntilDate(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const compactMatch = /^(\d{4})(\d{2})(\d{2})(?:T\d{6}Z?)?$/i.exec(trimmed);
  if (compactMatch) {
    return `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`;
  }
  throw new LifeHubError(
    'LIFEHUB_E_VALIDATION',
    `RRULE UNTIL 日期格式非法：${raw}`,
  );
}

/**
 * 解析 RFC 5545 子集 RRULE 字符串。
 *
 * 说明：支持可选的 `RRULE:` 前缀，解析 `FREQ`、`INTERVAL`、`BYDAY`、`BYMONTHDAY`、`UNTIL`、`COUNT`。
 *
 * @param rruleStr RRULE 字符串，如 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR'
 * @returns 解析后的 `ParsedRRule` 对象
 * @throws {LifeHubError} 当缺少 FREQ 或参数值非法时抛出 `LIFEHUB_E_VALIDATION`
 */
export function parseRRule(rruleStr: string): ParsedRRule {
  const cleaned = rruleStr.trim().replace(/^RRULE:/i, '').trim();
  if (!cleaned) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', 'RRULE 字符串不能为空');
  }

  let freq: RRuleFreq | undefined;
  let interval = 1;
  let byDay: number[] | undefined;
  let byMonthDay: number[] | undefined;
  let until: string | undefined;
  let count: number | undefined;

  const parts = cleaned.split(';').map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', `RRULE 键值对格式错误：${part}`);
    }
    const key = part.slice(0, eqIdx).trim().toUpperCase();
    const val = part.slice(eqIdx + 1).trim().toUpperCase();

    switch (key) {
      case 'FREQ': {
        if (val === 'DAILY' || val === 'WEEKLY' || val === 'MONTHLY' || val === 'YEARLY') {
          freq = val;
        } else {
          throw new LifeHubError('LIFEHUB_E_VALIDATION', `不支持的 RRULE FREQ：${val}`);
        }
        break;
      }
      case 'INTERVAL': {
        const parsed = Number.parseInt(val, 10);
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new LifeHubError('LIFEHUB_E_VALIDATION', `RRULE INTERVAL 必须为正整数：${val}`);
        }
        interval = parsed;
        break;
      }
      case 'BYDAY': {
        const tokens = val.split(',').map((t) => t.trim()).filter(Boolean);
        if (tokens.length === 0) {
          throw new LifeHubError('LIFEHUB_E_VALIDATION', 'RRULE BYDAY 不能为空');
        }
        byDay = tokens.map((token) => {
          // 兼容形如 1MO 或 MO 的写法，取最后两位星期缩写
          const code = token.slice(-2);
          const wd = BYDAY_MAP[code];
          if (wd === undefined) {
            throw new LifeHubError('LIFEHUB_E_VALIDATION', `不支持的 BYDAY 星期标识：${token}`);
          }
          return wd;
        });
        break;
      }
      case 'BYMONTHDAY': {
        const tokens = val.split(',').map((t) => t.trim()).filter(Boolean);
        if (tokens.length === 0) {
          throw new LifeHubError('LIFEHUB_E_VALIDATION', 'RRULE BYMONTHDAY 不能为空');
        }
        byMonthDay = tokens.map((token) => {
          const num = Number.parseInt(token, 10);
          if (!Number.isInteger(num) || num === 0 || num < -31 || num > 31) {
            throw new LifeHubError('LIFEHUB_E_VALIDATION', `非法的 BYMONTHDAY 日期：${token}`);
          }
          return num;
        });
        break;
      }
      case 'UNTIL': {
        until = normalizeUntilDate(val);
        break;
      }
      case 'COUNT': {
        const parsed = Number.parseInt(val, 10);
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new LifeHubError('LIFEHUB_E_VALIDATION', `RRULE COUNT 必须为正整数：${val}`);
        }
        count = parsed;
        break;
      }
      default:
        break;
    }
  }

  if (!freq) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', `RRULE 缺少 FREQ 定义：${rruleStr}`);
  }

  return {
    freq,
    interval,
    ...(byDay ? { byDay } : {}),
    ...(byMonthDay ? { byMonthDay } : {}),
    ...(until ? { until } : {}),
    ...(count !== undefined ? { count } : {}),
  };
}

/**
 * 拆分 'YYYY-MM-DD' 为年月日数字元组。
 *
 * @param localDate 'YYYY-MM-DD'
 * @returns [year, month, day]
 */
function splitDate(localDate: string): [number, number, number] {
  const parts = localDate.split('-').map((p) => Number.parseInt(p, 10));
  return [parts[0] ?? 1970, parts[1] ?? 1, parts[2] ?? 1];
}

/**
 * 计算两个 'YYYY-MM-DD' 日历日之间的整天数差（target - anchor）。
 *
 * 说明：把两个日历日视为 UTC 零点做差除以 86400000，完全不受本地时区与夏令时影响。
 *
 * @param anchor 锚点日历日
 * @param target 目标日历日
 * @returns 整天数差
 */
function diffCalendarDays(anchor: string, target: string): number {
  const msA = Date.parse(`${anchor}T00:00:00Z`);
  const msB = Date.parse(`${target}T00:00:00Z`);
  return Math.round((msB - msA) / 86_400_000);
}

/**
 * 判断候选日历日是否命中解析后的 RRULE（不含 COUNT 与 UNTIL 裁剪）。
 *
 * @param rule 解析后的 RRULE
 * @param anchorDate 规则起始锚点日 'YYYY-MM-DD'
 * @param candidateDate 待判断日历日 'YYYY-MM-DD'
 * @returns 命中返回 true
 */
function matchesRRulePattern(
  rule: ParsedRRule,
  anchorDate: string,
  candidateDate: string,
): boolean {
  if (candidateDate < anchorDate) {
    return false;
  }

  const [anchorY, anchorM, anchorD] = splitDate(anchorDate);
  const [candY, candM, candD] = splitDate(candidateDate);

  switch (rule.freq) {
    case 'DAILY': {
      const daysDiff = diffCalendarDays(anchorDate, candidateDate);
      if (daysDiff % rule.interval !== 0) {
        return false;
      }
      if (rule.byDay && !rule.byDay.includes(weekdayOf(candidateDate))) {
        return false;
      }
      return true;
    }
    case 'WEEKLY': {
      // 以锚点日所在自然周（周一为起点）计算周步长间隔
      const anchorWd = weekdayOf(anchorDate);
      const anchorDaysFromMon = anchorWd === 0 ? 6 : anchorWd - 1;
      const anchorMonday = addDays(anchorDate, -anchorDaysFromMon);

      const candWd = weekdayOf(candidateDate);
      const candDaysFromMon = candWd === 0 ? 6 : candWd - 1;
      const candMonday = addDays(candidateDate, -candDaysFromMon);

      const weeksDiff = Math.round(diffCalendarDays(anchorMonday, candMonday) / 7);
      if (weeksDiff < 0 || weeksDiff % rule.interval !== 0) {
        return false;
      }
      const targetDays = rule.byDay && rule.byDay.length > 0 ? rule.byDay : [anchorWd];
      return targetDays.includes(candWd);
    }
    case 'MONTHLY': {
      const monthsDiff = (candY - anchorY) * 12 + (candM - anchorM);
      if (monthsDiff < 0 || monthsDiff % rule.interval !== 0) {
        return false;
      }
      const totalDaysInCandMonth = getDaysInMonth(candY, candM);
      if (rule.byMonthDay && rule.byMonthDay.length > 0) {
        const matchedMonthDay = rule.byMonthDay.some((md) => {
          const resolvedDay = md > 0 ? md : totalDaysInCandMonth + 1 + md;
          return resolvedDay === candD;
        });
        if (!matchedMonthDay) {
          return false;
        }
      } else if (candD !== anchorD) {
        return false;
      }
      if (rule.byDay && !rule.byDay.includes(weekdayOf(candidateDate))) {
        return false;
      }
      return true;
    }
    case 'YEARLY': {
      const yearsDiff = candY - anchorY;
      if (yearsDiff < 0 || yearsDiff % rule.interval !== 0) {
        return false;
      }
      if (candM !== anchorM) {
        return false;
      }
      const totalDaysInCandMonth = getDaysInMonth(candY, candM);
      if (rule.byMonthDay && rule.byMonthDay.length > 0) {
        const matched = rule.byMonthDay.some((md) => {
          const resolvedDay = md > 0 ? md : totalDaysInCandMonth + 1 + md;
          return resolvedDay === candD;
        });
        if (!matched) {
          return false;
        }
      } else if (candD !== anchorD) {
        return false;
      }
      return true;
    }
  }
}

/**
 * 展开单条 RRULE 在指定闭区间 `[fromDate, toDate]` 内的所有命中日历日。
 *
 * 说明：
 * - 当规则包含 `COUNT` 或 `INTERVAL > 1` 时，从 `startDate` 起算累计次数与步长；
 * - 正确处理跨月、跨年与闰年 `2024-02-29`（仅在真实存在的日历日上迭代）。
 *
 * @param rruleStr RRULE 字符串
 * @param startDate 规则起始锚点日 'YYYY-MM-DD'
 * @param fromDate 查询起始日 'YYYY-MM-DD'（含）
 * @param toDate 查询结束日 'YYYY-MM-DD'（含）
 * @returns 命中的 'YYYY-MM-DD' 升序列表
 * @throws {LifeHubError} RRULE 语法非法时抛出异常
 */
export function expandRRuleDates(
  rruleStr: string,
  startDate: string,
  fromDate: string,
  toDate: string,
): string[] {
  if (toDate < fromDate) {
    return [];
  }
  const rule = parseRRule(rruleStr);
  const effectiveEnd = rule.until && rule.until < toDate ? rule.until : toDate;
  if (effectiveEnd < startDate || effectiveEnd < fromDate) {
    return [];
  }

  // 若包含 COUNT，必须从 startDate 开始逐日累计次数；否则可从 max(startDate, fromDate) 开始扫描。
  const scanStart = rule.count !== undefined ? startDate : startDate > fromDate ? startDate : fromDate;
  const matchedInRange: string[] = [];
  let totalOccurrences = 0;
  let cursor = scanStart;

  // 安全上限：最多推进 4000 天（约 11 年），防止极端跨度死循环
  for (let i = 0; i < 4000; i++) {
    if (cursor > effectiveEnd) {
      break;
    }
    if (matchesRRulePattern(rule, startDate, cursor)) {
      totalOccurrences += 1;
      if (cursor >= fromDate && cursor <= effectiveEnd) {
        matchedInRange.push(cursor);
      }
      if (rule.count !== undefined && totalOccurrences >= rule.count) {
        break;
      }
    }
    cursor = addDays(cursor, 1);
  }

  return matchedInRange;
}

/**
 * 展开单个课表时段在闭区间 `[fromDate, toDate]` 内命中的日历日列表。
 *
 * 说明：
 * - 若时段配置了非空 `rrule`，按 RFC 5545 子集规则展开；
 * - 否则若配置了 `dayOfWeek`（0..6），按每周固定星期展开；
 * - 同时遵守时段的 `validFrom` 与 `validUntil` 边界。
 *
 * @param slot 课表时段对象
 * @param fromDate 查询区间起点 'YYYY-MM-DD'（含）
 * @param toDate 查询区间终点 'YYYY-MM-DD'（含）
 * @returns 命中的日历日升序数组
 * @throws {LifeHubError} 当 rrule 非法时抛出异常
 */
export function expandSlotDates(
  slot: Pick<StoredScheduleSlot, 'dayOfWeek' | 'rrule' | 'validFrom' | 'validUntil' | 'createdAt'>,
  fromDate: string,
  toDate: string,
): string[] {
  const effectiveFrom = slot.validFrom && slot.validFrom > fromDate ? slot.validFrom : fromDate;
  const effectiveTo = slot.validUntil && slot.validUntil < toDate ? slot.validUntil : toDate;
  if (effectiveTo < effectiveFrom) {
    return [];
  }

  const anchorDate =
    slot.validFrom ||
    (slot.createdAt && /^\d{4}-\d{2}-\d{2}/.test(slot.createdAt)
      ? slot.createdAt.slice(0, 10)
      : effectiveFrom);

  if (slot.rrule && slot.rrule.trim().length > 0) {
    return expandRRuleDates(slot.rrule, anchorDate, effectiveFrom, effectiveTo);
  }

  if (slot.dayOfWeek !== undefined && slot.dayOfWeek >= 0 && slot.dayOfWeek <= 6) {
    const targetWd = slot.dayOfWeek;
    const dates: string[] = [];
    let cursor = effectiveFrom;
    for (let i = 0; i < 4000; i++) {
      if (cursor > effectiveTo) {
        break;
      }
      if (weekdayOf(cursor) === targetWd) {
        dates.push(cursor);
      }
      cursor = addDays(cursor, 1);
    }
    return dates;
  }

  // 若既无 rrule 也无 dayOfWeek，但有 validFrom，则视为单次日程
  if (slot.validFrom && slot.validFrom >= effectiveFrom && slot.validFrom <= effectiveTo) {
    return [slot.validFrom];
  }

  return [];
}

/**
 * 展开一组课表时段在指定单日 `localDate` 的全部课表实例。
 *
 * 说明：结果按墙上时间 `startTime` 升序排列，再按 `endTime` 与 `title` 稳定排序。
 *
 * @param slots 课表时段集合
 * @param localDate 目标本地日历日 'YYYY-MM-DD'
 * @returns 当天命中的课表实例列表
 * @throws {LifeHubError} 当某个时段的 RRULE 非法时抛出异常
 */
export function expandScheduleForDate(
  slots: readonly StoredScheduleSlot[],
  localDate: string,
): ExpandedScheduleInstance[] {
  return expandScheduleForRange(slots, localDate, localDate);
}

/**
 * 展开一组课表时段在指定闭区间 `[fromDate, toDate]` 内的全部课表实例。
 *
 * 说明：按 `localDate` 升序、同一天内按墙上时间 `startTime` 升序排列。
 *
 * @param slots 课表时段集合
 * @param fromDate 起始日历日 'YYYY-MM-DD'（含）
 * @param toDate 结束日历日 'YYYY-MM-DD'（含）
 * @returns 区间内展开的全部课表实例
 * @throws {LifeHubError} 当某个时段的 RRULE 非法时抛出异常
 */
export function expandScheduleForRange(
  slots: readonly StoredScheduleSlot[],
  fromDate: string,
  toDate: string,
): ExpandedScheduleInstance[] {
  if (toDate < fromDate) {
    return [];
  }
  const instances: ExpandedScheduleInstance[] = [];
  for (const slot of slots) {
    const dates = expandSlotDates(slot, fromDate, toDate);
    for (const date of dates) {
      instances.push({
        slotId: slot.id,
        slot,
        localDate: date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        title: slot.title,
        ...(slot.location ? { location: slot.location } : {}),
        ...(slot.color ? { color: slot.color } : {}),
        ...(slot.note ? { note: slot.note } : {}),
      });
    }
  }

  return instances.sort((a, b) => {
    const dateCmp = a.localDate.localeCompare(b.localDate);
    if (dateCmp !== 0) {
      return dateCmp;
    }
    const startCmp = a.startTime.localeCompare(b.startTime);
    if (startCmp !== 0) {
      return startCmp;
    }
    return a.title.localeCompare(b.title);
  });
}
