/**
 * 极简滚轮时间与日期选择器的纯函数工具。
 *
 * 架构位置：apps/web 的「通用组件」工具层。
 */

/** 解析后的时分结构。 */
export interface ParsedHm {
  /** 小时（0 ~ 23）。 */
  hour: number;
  /** 分钟（0 ~ 59）。 */
  minute: number;
}

/** 解析后的年月日结构。 */
export interface ParsedYmd {
  /** 四位年份。 */
  year: number;
  /** 月份（1 ~ 12）。 */
  month: number;
  /** 日（1 ~ 当月最大天数）。 */
  day: number;
}

/**
 * 将小时与分钟格式化为标准两位数 `HH:mm`。
 *
 * @param hour 小时（0 ~ 23）
 * @param minute 分钟（0 ~ 59）
 * @returns 标准 `HH:mm` 字符串
 * @throws 无
 */
export function formatHm(hour: number, minute: number): string {
  const safeH = Math.max(0, Math.min(23, Math.trunc(Number.isFinite(hour) ? hour : 0)));
  const safeM = Math.max(0, Math.min(59, Math.trunc(Number.isFinite(minute) ? minute : 0)));
  return `${String(safeH).padStart(2, '0')}:${String(safeM).padStart(2, '0')}`;
}

/**
 * 解析 `HH:mm` 字符串为 `{ hour, minute }`，异常输入平滑回退。
 *
 * @param raw 原始时间字符串
 * @param fallbackHm 回退时间字符串，默认 `'09:00'`
 * @returns 合法的 `{ hour, minute }`
 * @throws 无
 */
export function parseHm(raw: string, fallbackHm = '09:00'): ParsedHm {
  const normalized = raw.trim().replace('：', ':');
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(normalized);
  if (match) {
    const h = Number.parseInt(match[1] ?? '0', 10);
    const m = Number.parseInt(match[2] ?? '0', 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return { hour: h, minute: m };
    }
  }
  if (fallbackHm !== raw) {
    const fb = /^(\d{1,2}):(\d{1,2})$/.exec(fallbackHm.trim());
    if (fb) {
      const fh = Number.parseInt(fb[1] ?? '9', 10);
      const fm = Number.parseInt(fb[2] ?? '0', 10);
      if (fh >= 0 && fh <= 23 && fm >= 0 && fm <= 59) {
        return { hour: fh, minute: fm };
      }
    }
  }
  return { hour: 9, minute: 0 };
}

/**
 * 将 `HH:mm` 换算为当日分钟总数（0 ~ 1439）。
 *
 * @param hm 时间字符串
 * @returns 分钟总数
 * @throws 无
 */
export function hmToMinutes(hm: string): number {
  const { hour, minute } = parseHm(hm);
  return hour * 60 + minute;
}

/**
 * 将当日分钟总数换算为 `HH:mm`。
 *
 * @param totalMinutes 分钟总数
 * @returns 标准 `HH:mm` 字符串
 * @throws 无
 */
export function minutesToHm(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMinutes)));
  return formatHm(Math.floor(clamped / 60), clamped % 60);
}

/**
 * 调整开始时间时自动保持或顺延结束时间，确保 `startTime < endTime`。
 *
 * @param nextStart 新开始时间
 * @param prevStart 原开始时间
 * @param prevEnd 原结束时间
 * @returns 合法有序的 `{ startTime, endTime }`
 * @throws 无
 */
export function adjustTimeRangeOnStartChange(
  nextStart: string,
  prevStart: string,
  prevEnd: string,
): { startTime: string; endTime: string } {
  const prevStartMin = hmToMinutes(prevStart);
  const prevEndMin = hmToMinutes(prevEnd);
  const prevDuration = prevEndMin > prevStartMin ? prevEndMin - prevStartMin : 60;

  const safeStartMin = Math.min(23 * 60 + 58, Math.max(0, hmToMinutes(nextStart)));
  const nextStartHm = minutesToHm(safeStartMin);

  if (prevEndMin > safeStartMin) {
    return { startTime: nextStartHm, endTime: minutesToHm(prevEndMin) };
  }

  const targetEndMin = Math.min(23 * 60 + 59, safeStartMin + Math.max(1, prevDuration));
  return {
    startTime: nextStartHm,
    endTime: minutesToHm(Math.max(safeStartMin + 1, targetEndMin)),
  };
}

/**
 * 调整结束时间时保证严格晚于开始时间。
 *
 * @param startTime 开始时间
 * @param candidateEnd 候选结束时间
 * @returns 合法结束时间 `HH:mm`
 * @throws 无
 */
export function clampEndTimeAfterStart(startTime: string, candidateEnd: string): string {
  const startMin = Math.min(23 * 60 + 58, hmToMinutes(startTime));
  const endMin = hmToMinutes(candidateEnd);
  if (endMin > startMin) {
    return minutesToHm(endMin);
  }
  return minutesToHm(Math.min(23 * 60 + 59, startMin + (startMin <= 23 * 60 + 54 ? 5 : 1)));
}

/**
 * 计算指定年月的天数（处理闰年 2 月）。
 *
 * @param year 四位年份
 * @param month 月份（1 ~ 12）
 * @returns 当月最大天数
 * @throws 无
 */
export function getDaysInYearMonth(year: number, month: number): number {
  const safeMonth = Math.max(1, Math.min(12, Math.trunc(month)));
  if (safeMonth === 2) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return isLeap ? 29 : 28;
  }
  if (safeMonth === 4 || safeMonth === 6 || safeMonth === 9 || safeMonth === 11) {
    return 30;
  }
  return 31;
}

/**
 * 将年月日格式化为 `YYYY-MM-DD` 并自动钳制当月最大天数。
 *
 * @param year 年份
 * @param month 月份（1 ~ 12）
 * @param day 日
 * @returns 标准 `YYYY-MM-DD`
 * @throws 无
 */
export function formatYmd(year: number, month: number, day: number): string {
  const safeY = Math.max(1970, Math.min(2099, Math.trunc(Number.isFinite(year) ? year : 2026)));
  const safeM = Math.max(1, Math.min(12, Math.trunc(Number.isFinite(month) ? month : 1)));
  const maxDay = getDaysInYearMonth(safeY, safeM);
  const safeD = Math.max(1, Math.min(maxDay, Math.trunc(Number.isFinite(day) ? day : 1)));
  return `${String(safeY).padStart(4, '0')}-${String(safeM).padStart(2, '0')}-${String(safeD).padStart(2, '0')}`;
}

/**
 * 解析 `YYYY-MM-DD` 字符串，无效或空串时回退至默认日期或今日。
 *
 * @param raw 原始日期字符串
 * @param fallbackYmd 可选回退日期
 * @returns `{ year, month, day }`
 * @throws 无
 */
export function parseYmd(raw: string, fallbackYmd?: string): ParsedYmd {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw.trim());
  if (match) {
    const y = Number.parseInt(match[1] ?? '2026', 10);
    const m = Number.parseInt(match[2] ?? '1', 10);
    const d = Number.parseInt(match[3] ?? '1', 10);
    if (m >= 1 && m <= 12) {
      return { year: y, month: m, day: Math.max(1, Math.min(getDaysInYearMonth(y, m), d)) };
    }
  }
  if (fallbackYmd && fallbackYmd !== raw) {
    const fb = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(fallbackYmd.trim());
    if (fb) {
      const fy = Number.parseInt(fb[1] ?? '2026', 10);
      const fm = Number.parseInt(fb[2] ?? '1', 10);
      const fd = Number.parseInt(fb[3] ?? '1', 10);
      if (fm >= 1 && fm <= 12) {
        return { year: fy, month: fm, day: Math.max(1, Math.min(getDaysInYearMonth(fy, fm), fd)) };
      }
    }
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/**
 * 归一化起止日期顺序：若起止均非空且 `dateFrom > dateTo`，自动调换为升序。
 *
 * @param dateFrom 开始日期
 * @param dateTo 结束日期
 * @returns 有序的 `{ dateFrom, dateTo }`
 * @throws 无
 */
export function normalizeDateRangeOrder(
  dateFrom: string,
  dateTo: string,
): { dateFrom: string; dateTo: string } {
  const from = dateFrom.trim();
  const to = dateTo.trim();
  if (from && to && from > to) {
    return { dateFrom: to, dateTo: from };
  }
  return { dateFrom: from, dateTo: to };
}
