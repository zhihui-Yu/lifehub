/**
 * 课表 / 习惯模块共用的本地日历日工具。
 *
 * 架构位置：apps/web 的「S4 模块共享层」，是课表与习惯判定跨天 / 连续天数的唯一时间入口。
 *
 * 核心红线（与 core 包 `time` 一致）：
 * 1. 所有跨天 / 连续天数 / 分组判定**只比较 `localDate` 字符串（YYYY-MM-DD）**，绝不做时刻差运算；
 * 2. 不引入任何日期库，仅用原生 `Date` 与 `@lifehub/core` 的 `toLocalDate` / `addDays`；
 * 3. 星期计算把日历日当作 UTC 零点解析，避免时区 / 夏令时导致星期漂移。
 */
import { addDays, toLocalDate } from '@lifehub/core';
import { getDaysInMonth } from '@/modules/schedule/rrule';

/**
 * 在本地日历日 `'YYYY-MM-DD'` 基础上向后推算指定月数。
 *
 * @param baseDate 基准日历日 `'YYYY-MM-DD'`
 * @param months 向后推算的月数（正整数）
 * @returns 推算后的 `'YYYY-MM-DD'`
 */
export function addMonthsToLocalDate(baseDate: string, months: number): string {
  const parts = baseDate.split('-').map((n) => Number(n));
  const y0 = parts[0] ?? 2026;
  const m0 = parts[1] ?? 1;
  const d0 = parts[2] ?? 1;
  const totalMonths = y0 * 12 + (m0 - 1) + Math.max(1, Math.trunc(months));
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;
  const maxDay = getDaysInMonth(targetYear, targetMonth);
  const targetDay = Math.min(d0, maxDay);
  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
}

/**
 * 取「今天」的本地日历日。
 *
 * 说明：以设备当前时区（IANA）换算，与个人本地优先的应用语义一致；
 * 跨天判定一律基于返回的 `localDate` 字符串，不依赖具体时刻。
 *
 * @param timeZone 可选 IANA 时区，默认取设备当前时区；非法时回落到 UTC
 * @returns 形如 '2024-06-03' 的本地日历日
 */
export function getTodayLocalDate(timeZone?: string): string {
  const tz = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  try {
    return toLocalDate(new Date(), tz);
  } catch {
    return toLocalDate(new Date(), 'UTC');
  }
}

/**
 * 计算某个本地日历日是一周中的星期几。
 *
 * 说明：把 `localDate` 当作 UTC 零点解析后取 `getUTCDay()`，
 * 使星期一恒为 1、星期日为 0，且与用户所在时区无关（日历日本身已确定星期）。
 *
 * @param localDate 'YYYY-MM-DD' 形式的日历日
 * @returns 星期序号：0=星期日，1=星期一，……，6=星期六
 */
export function weekdayOf(localDate: string): number {
  return new Date(`${localDate}T00:00:00Z`).getUTCDay();
}

/**
 * 枚举闭区间 [from, to] 内的全部本地日历日（含两端）。
 *
 * 说明：按日历日逐日推进（非按 24 小时），保证不受时区 / 夏令时影响；
 * 若 `to` 早于 `from`，返回空数组。
 *
 * @param from 起始日历日 'YYYY-MM-DD'
 * @param to 结束日历日 'YYYY-MM-DD'
 * @returns 按时间升序排列的日历日数组
 */
export function listLocalDates(from: string, to: string): string[] {
  const result: string[] = [];
  let current = from;
  // 防御：最多迭代一年（366 天），避免 from > to 之外的异常输入导致死循环。
  for (let i = 0; i < 367; i++) {
    if (current > to) break;
    result.push(current);
    current = addDays(current, 1);
  }
  return result;
}

/**
 * 取某日历日所在「自然周」的起止（周一为一周起点）。
 *
 * 说明：用于周视图 / 周统计的边界计算；返回 [周一, 周日] 两个闭区间端点。
 *
 * @param localDate 任意一天 'YYYY-MM-DD'
 * @returns 包含该天的自然周 [周一起点, 周日止点]
 */
export function getWeekRange(localDate: string): [string, string] {
  const wd = weekdayOf(localDate); // 0=周日
  // 距周一的天数：周一(1)->0，周日(0)->6。
  const daysFromMonday = wd === 0 ? 6 : wd - 1;
  const monday = addDays(localDate, -daysFromMonday);
  const sunday = addDays(monday, 6);
  return [monday, sunday];
}

/**
 * 取某日历日所在「自然月」的起止。
 *
 * @param localDate 任意一天 'YYYY-MM-DD'
 * @returns 该月 [1 日, 月末日]
 */
export function getMonthRange(localDate: string): [string, string] {
  const [year = 1970, month = 1] = localDate.split('-').map(Number);
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  // 下月 1 日减一天即本月月末。
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nextFirst = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  const last = addDays(nextFirst, -1);
  return [first, last];
}
