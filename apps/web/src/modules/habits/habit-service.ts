/**
 * 微习惯打卡领域服务、定量累加记录、连续天数计算、全年热力图与跨模块统计（模块 C：C-01 ~ C-04）。
 *
 * 架构位置：apps/web 的「微习惯模块」服务层。
 *
 * 核心设计约束（ADR-006 / X-09）：
 * 1. 所有连续天数（Streak）、漏打重置、跨天分组计算**严格只比较 `localDate`（`'YYYY-MM-DD'`）字符串**，
 *    通过 `@lifehub/core` 的 `addDays` 判断日历日相邻性，绝不做 UTC 时间戳毫秒差运算；
 * 2. 支持「按次打勾（`check`）」与「定量累加（`quantity`）」双模式：
 *    - 同一天内多次累加（如喝水 +250ml、+300ml，或跑步 3km、3.5km）汇总为该日一个总数值 `value`；
 *    - **每天只要完成（累计量 > 0）即计为当日打卡完成 1 次**，写入共享 `CompletionEventRepository`（`sourceType: 'habit'`），
 *      使连续天数、达成率与课表合并统计保持统一口径，同时按周/月/年及任意区间聚合各习惯累计总量。
 */
import { addDays, LifeHubError } from '@lifehub/core';
import type { LifeHubDatabase } from '@/platform/db';
import { createDatabase } from '@/platform/db';
import {
  CompletionEventRepository,
  type CompletionEvent,
} from '@/modules/shared/completion-event';
import {
  getMonthRange,
  getTodayLocalDate,
  getWeekRange,
  weekdayOf,
} from '@/modules/shared/date-utils';
import { recordCloudTombstone, recordCloudTombstones } from '@/lib/cloud-tombstones';
import { syncAutoSnapshotToStorageDir } from '@/utils/download';

/** 习惯记录模式：`check` 为每日单次打勾，`quantity` 为数值定量累加（支持整数与小数）。 */
export type HabitTrackingMode = 'check' | 'quantity';

/**
 * 持久化在 Dexie `habits` 表中的微习惯模型。
 */
export interface StoredHabit {
  /** 习惯唯一主键 ID。 */
  id: string;
  /** 习惯名称（如「喝水」「跑步」「早睡」）。 */
  name: string;
  /** 计量单位（如「次」「ml」「km」「分钟」「页」）。 */
  unit: string;
  /** 记录模式（未设置时默认按 `'check'` 处理，保持旧数据 100% 兼容）。 */
  trackingMode?: HabitTrackingMode;
  /** 定量模式下的单次快捷累加步长（可选，如喝水每次 250 ml；不设则点击时输入本次数值，如跑步 3.5 km）。 */
  defaultIncrement?: number;
  /** 每日参考目标量（可选，如每日 2000 ml 或 5 km，仅作进度参考；当日总量 > 0 即算完成当日打卡 1 次）。 */
  dailyTarget?: number;
  /** 每周期目标次数（兼容旧字段，默认每天 1 次）。 */
  targetPerPeriod: number;
  /** 主题颜色 '#RRGGBB'。 */
  color: string;
  /** 习惯图标（Emoji 或图标标识）。 */
  icon: string;
  /** 归档时间 ISO 8601 UTC（未归档时为 undefined）。 */
  archivedAt?: string;
  /** 创建时间 ISO 8601 UTC。 */
  createdAt: string;
  /** 更新时间 ISO 8601 UTC。 */
  updatedAt: string;
}

/**
 * 同一日内单次定量累加明细项。
 */
export interface HabitQuantityEntry {
  /** 单次累加记录唯一 ID（用于单条撤销与多端去重合并）。 */
  id: string;
  /** 本次记录数值（正数，支持小数如 3.5、250）。 */
  amount: number;
  /** 记录时刻 ISO 8601 UTC。 */
  createdAt: string;
  /** 可选备注。 */
  note?: string;
}

/**
 * 持久化在 Dexie `habitCheckIns` 表中的每日打卡汇总记录。
 *
 * 说明：每个习惯每天最多一条记录（主键 `habit:${habitId}:${localDate}`），
 * 当天多次累加保存在 `entries` 中，当日总量汇总在 `value` 中。
 */
export interface StoredHabitCheckIn {
  /** 主键，格式为 `habit:${habitId}:${localDate}`。 */
  id: string;
  /** 所属习惯 ID。 */
  habitId: string;
  /** 打卡本地日历日 'YYYY-MM-DD'。 */
  localDate: string;
  /** 首次完成时刻 ISO 8601 UTC。 */
  completedAt: string;
  /** 最后更新时刻 ISO 8601 UTC（多次累加或修改当日总量时刷新）。 */
  updatedAt?: string;
  /** 当日累计总数值（未填的旧打勾记录默认按 1 计）。 */
  value?: number;
  /** 当日分次累加明细列表（定量模式下保存每次累加记录）。 */
  entries?: HabitQuantityEntry[];
  /** 当日已手动删除的明细 ID 列表（用于多端云同步合并时防止已删单条明细复活）。 */
  deletedEntryIds?: string[];
}

/**
 * 创建或更新微习惯的输入载荷。
 */
export interface HabitInput {
  /** 习惯名称（必填）。 */
  name: string;
  /** 单位（默认「次」）。 */
  unit?: string;
  /** 记录模式（'check' | 'quantity'）。 */
  trackingMode?: HabitTrackingMode;
  /** 定量模式单次快捷步长（可选，> 0 时展示一键 +N 按钮；传 null 或 0 可清除）。 */
  defaultIncrement?: number | null;
  /** 每日参考目标量（可选，> 0 时展示今日进度；传 null 或 0 可清除）。 */
  dailyTarget?: number | null;
  /** 周期目标（默认 1）。 */
  targetPerPeriod?: number;
  /** 颜色（默认 '#16A34A'）。 */
  color?: string;
  /** 图标（默认 '✨'）。 */
  icon?: string;
}

/**
 * 习惯连续天数与累计统计结果（C-01）。
 */
export interface HabitStreakResult {
  /** 截至参考日的当前连续打卡天数（若参考日未打卡则为 0）。 */
  currentStreak: number;
  /** 历史最长连续打卡天数。 */
  longestStreak: number;
  /** 累计打卡总天数（每天完成算 1 次，去重后）。 */
  totalCompletedDays: number;
}

/**
 * 习惯里程碑徽章模型（C-04）。
 */
export interface HabitBadge {
  /** 徽章唯一标识。 */
  id: string;
  /** 徽章名称。 */
  title: string;
  /** 徽章 Emoji 图标。 */
  icon: string;
  /** 解锁所需的连续打卡天数。 */
  requiredDays: number;
  /** 徽章说明文案。 */
  description: string;
  /** 是否已解锁。 */
  unlocked: boolean;
}

/**
 * 全年打卡热力图单日单元格模型（C-02）。
 */
export interface HeatmapCell {
  /** 本地日历日 'YYYY-MM-DD'。 */
  localDate: string;
  /** 当日打卡/完成总次数。 */
  count: number;
  /** 颜色强度等级（0=无，1=低，2=中，3=高，4=极高）。 */
  level: 0 | 1 | 2 | 3 | 4;
  /** 星期几（0=周日 … 6=周六）。 */
  weekday: number;
}

/** 统计周期粒度（C-03）。 */
export type HabitStatsPeriod = 'week' | 'month' | 'year';

/**
 * 单个习惯在指定统计区间（周 / 月 / 年或自定义日期段）内的完成天数与累计总量摘要。
 */
export interface HabitPeriodItemSummary {
  /** 习惯 ID。 */
  habitId: string;
  /** 习惯名称（如「喝水」「跑步」）。 */
  name: string;
  /** 习惯图标。 */
  icon: string;
  /** 主题颜色。 */
  color: string;
  /** 计量单位（如 'ml'、'km'、'次'）。 */
  unit: string;
  /** 记录模式。 */
  trackingMode: HabitTrackingMode;
  /** 每日参考目标（若配置）。 */
  dailyTarget?: number;
  /** 区间内完成打卡天数（每天完成算 1 次）。 */
  completedDays: number;
  /** 区间内累计总量（每日总量求和，支持整数与小数）。 */
  totalQuantity: number;
  /** 打卡日日均量（totalQuantity / completedDays，保留合理小数）。 */
  averagePerCompletedDay: number;
  /** 自然日日均量（totalQuantity / 区间总天数）。 */
  averagePerCalendarDay: number;
}

/**
 * 周 / 月 / 年统计与「课表 + 习惯」合并完成事件统计结果（C-03）。
 */
export interface CombinedPeriodStats {
  /** 统计粒度：周 / 月 / 年。 */
  period: HabitStatsPeriod;
  /** 统计起始日 'YYYY-MM-DD'（含）。 */
  fromDate: string;
  /** 统计结束日 'YYYY-MM-DD'（含）。 */
  toDate: string;
  /** 区间总日历天数。 */
  totalDaysInPeriod: number;
  /** 习惯打卡完成次数（`sourceType === 'habit'`，每天每个习惯完成算 1 次）。 */
  habitCompletedCount: number;
  /** 课表时段完成次数（`sourceType === 'schedule'`）。 */
  scheduleCompletedCount: number;
  /** 课表 + 习惯合并总完成事件次数。 */
  combinedCompletedCount: number;
  /** 区间内有至少一次完成事件的活跃天数。 */
  activeDaysCount: number;
  /** 习惯目标完成率百分比（0..100）。 */
  habitCompletionRate: number;
  /** 区间内各习惯的打卡天数与累计总量明细。 */
  habitSummaries: HabitPeriodItemSummary[];
}

/**
 * 附带统计、当日累计量与徽章的习惯视图模型。
 */
export interface HabitWithStats {
  /** 习惯基础信息。 */
  habit: StoredHabit;
  /** 今日（或当前选中参考日）是否已打卡。 */
  completedOnRefDate: boolean;
  /** 当前选中参考日的累计量（未打卡为 0，单次习惯已打卡为 1，定量习惯为当日总和）。 */
  refDateValue: number;
  /** 当前选中参考日的分次累加明细。 */
  refDateEntries: HabitQuantityEntry[];
  /** 历史全量累计总量（所有打卡日数值总和）。 */
  totalQuantityAllTime: number;
  /** 连续打卡统计（按完成天数计，每天完成算 1 次）。 */
  streak: HabitStreakResult;
  /** 徽章列表。 */
  badges: HabitBadge[];
  /** 已打卡的全部日期列表（升序）。 */
  completedDates: string[];
}

/** 预置里程碑徽章定义（C-04）。 */
const MILESTONE_DEFINITIONS: ReadonlyArray<{
  id: string;
  title: string;
  icon: string;
  requiredDays: number;
  description: string;
}> = [
  { id: 'streak-1', title: '初露锋芒', icon: '🌱', requiredDays: 1, description: '完成首次打卡' },
  { id: 'streak-3', title: '坚持不懈', icon: '🔥', requiredDays: 3, description: '连续打卡达到 3 天' },
  { id: 'streak-7', title: '一周达成', icon: '⭐', requiredDays: 7, description: '连续打卡达到 7 天' },
  { id: 'streak-21', title: '习惯养成', icon: '🏆', requiredDays: 21, description: '连续打卡达到 21 天' },
  { id: 'streak-100', title: '百日传奇', icon: '👑', requiredDays: 100, description: '连续打卡达到 100 天' },
];

/**
 * 规范化习惯计量数值（保留最多 3 位小数，消除 JS 浮点数尾数误差如 `0.1 + 0.2`）。
 *
 * @param value 原始数值
 * @returns 四舍五入到千分位后的有限非负数值
 * @throws 无
 */
export function normalizeHabitAmount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.round(value * 1000) / 1000;
}

/**
 * 将习惯数值格式化为清爽易读的展示字符串（整数不带小数点，小数最多保留 2~3 位有效尾数）。
 *
 * @param value 数值
 * @returns 格式化字符串（如 `1500` -> `'1500'`，`3.5` -> `'3.5'`）
 * @throws 无
 */
export function formatHabitAmount(value: number): string {
  const normalized = normalizeHabitAmount(value);
  if (Number.isInteger(normalized)) {
    return String(normalized);
  }
  return String(Number(normalized.toFixed(2)));
}

/**
 * 判断某微习惯是否启用定量累加模式。
 *
 * @param habit 微习惯对象
 * @returns 若为定量模式返回 true，否则返回 false
 * @throws 无
 */
export function isQuantityHabit(habit: Pick<StoredHabit, 'trackingMode'>): boolean {
  return habit.trackingMode === 'quantity';
}

/**
 * 提取单条每日打卡记录的有效当日总量（兼容无 `value` 字段的历史打卡数据）。
 *
 * @param checkIn 打卡记录（可为 undefined）
 * @param completedFallback 若仅存在 `CompletionEvent` 而无 `checkIn` 明细时的兜底值（默认 1）
 * @returns 当日有效累计量
 * @throws 无
 */
export function resolveCheckInDailyValue(
  checkIn: StoredHabitCheckIn | undefined,
  completedFallback = 1,
): number {
  if (!checkIn) {
    return completedFallback;
  }
  if (typeof checkIn.value === 'number' && Number.isFinite(checkIn.value) && checkIn.value > 0) {
    return normalizeHabitAmount(checkIn.value);
  }
  if (Array.isArray(checkIn.entries) && checkIn.entries.length > 0) {
    const sum = checkIn.entries.reduce((acc, item) => acc + normalizeHabitAmount(item.amount), 0);
    if (sum > 0) {
      return normalizeHabitAmount(sum);
    }
  }
  return completedFallback;
}

/**
 * 合并同一 `(habitId, localDate)` 在本地与远端的两条每日打卡记录（用于多端云同步无损累加）。
 *
 * 说明：
 * - 若两端均含分次 `entries` 明细，按 `entry.id` 求并集并剔除 `deletedEntryIds`，自动重算当日总和 `value`；
 * - 否则以 `updatedAt || completedAt` 较新的一端为准。
 *
 * @param local 本地打卡记录
 * @param remote 远端打卡记录
 * @returns 合并后的单日打卡记录
 * @throws 无
 */
export function mergeHabitCheckInPair(
  local: StoredHabitCheckIn,
  remote: StoredHabitCheckIn,
): StoredHabitCheckIn {
  const localTs = local.updatedAt || local.completedAt || '';
  const remoteTs = remote.updatedAt || remote.completedAt || '';
  const newer = remoteTs > localTs ? remote : local;
  const older = newer === remote ? local : remote;

  const localEntries = Array.isArray(local.entries) ? local.entries : [];
  const remoteEntries = Array.isArray(remote.entries) ? remote.entries : [];

  if (localEntries.length > 0 && remoteEntries.length > 0) {
    const deletedSet = new Set<string>([
      ...(local.deletedEntryIds ?? []),
      ...(remote.deletedEntryIds ?? []),
    ]);
    const entryMap = new Map<string, HabitQuantityEntry>();
    for (const entry of [...(older.entries ?? []), ...(newer.entries ?? [])]) {
      if (!entry || !entry.id || deletedSet.has(entry.id)) {
        continue;
      }
      const amt = normalizeHabitAmount(entry.amount);
      if (amt > 0) {
        entryMap.set(entry.id, { ...entry, amount: amt });
      }
    }
    const mergedEntries = Array.from(entryMap.values()).sort((a, b) =>
      (a.createdAt || '').localeCompare(b.createdAt || ''),
    );
    if (mergedEntries.length > 0) {
      const sum = normalizeHabitAmount(
        mergedEntries.reduce((acc, item) => acc + item.amount, 0),
      );
      const earliestCompleted =
        (local.completedAt && remote.completedAt
          ? local.completedAt < remote.completedAt
            ? local.completedAt
            : remote.completedAt
          : local.completedAt || remote.completedAt) || new Date().toISOString();
      const latestUpdated = remoteTs > localTs ? remoteTs : localTs;
      return {
        ...newer,
        completedAt: earliestCompleted,
        updatedAt: latestUpdated || earliestCompleted,
        value: sum,
        entries: mergedEntries,
        ...(deletedSet.size > 0 ? { deletedEntryIds: Array.from(deletedSet) } : {}),
      };
    }
  }

  return { ...newer };
}

/**
 * 基于 `localDate` 字符串相邻性计算习惯的当前连续天数与历史最长连续天数（纯函数，C-01）。
 *
 * 说明：
 * - 严格按 `'YYYY-MM-DD'` 字符串排序并用 `addDays(prev, 1) === curr` 判断是否连续；
 * - 漏打一天即重置当前连续天数，同时保留历史最长连续天数；
 * - 黄金用例：`computeHabitStreak(['2026-01-01', '2026-01-02', '2026-01-04'], '2026-01-04')`
 *   返回 `{ currentStreak: 1, longestStreak: 2, totalCompletedDays: 3 }`。
 *
 * @param completedDates 已完成打卡的 `localDate` 字符串列表（可无序、可含重复）
 * @param referenceDate 参考日历日 'YYYY-MM-DD'，默认取今天
 * @returns 包含 `currentStreak`、`longestStreak` 与 `totalCompletedDays` 的计算结果
 * @throws 无
 */
export function computeHabitStreak(
  completedDates: readonly string[],
  referenceDate: string = getTodayLocalDate(),
): HabitStreakResult {
  const uniqueDates = Array.from(
    new Set(
      completedDates.filter(
        (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= referenceDate,
      ),
    ),
  ).sort((a, b) => a.localeCompare(b));

  if (uniqueDates.length === 0) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      totalCompletedDays: 0,
    };
  }

  let longestStreak = 1;
  let runningStreak = 1;
  for (let i = 1; i < uniqueDates.length; i++) {
    const prev = uniqueDates[i - 1] ?? '';
    const curr = uniqueDates[i] ?? '';
    if (addDays(prev, 1) === curr) {
      runningStreak += 1;
      if (runningStreak > longestStreak) {
        longestStreak = runningStreak;
      }
    } else {
      runningStreak = 1;
    }
  }

  const dateSet = new Set(uniqueDates);
  let currentStreak = 0;
  let cursor = referenceDate;
  while (dateSet.has(cursor)) {
    currentStreak += 1;
    cursor = addDays(cursor, -1);
  }

  return {
    currentStreak,
    longestStreak,
    totalCompletedDays: uniqueDates.length,
  };
}

/**
 * 根据习惯连续天数计算里程碑徽章解锁状态（纯函数，C-04）。
 *
 * @param streak 习惯连续天数计算结果
 * @returns 附带 `unlocked` 状态的徽章数组
 * @throws 无
 */
export function computeHabitBadges(streak: HabitStreakResult): HabitBadge[] {
  const best = Math.max(streak.longestStreak, streak.currentStreak);
  return MILESTONE_DEFINITIONS.map((def) => ({
    ...def,
    unlocked: best >= def.requiredDays && streak.totalCompletedDays >= def.requiredDays,
  }));
}

/**
 * 生成指定年份的全年打卡热力图数据（纯函数，C-02）。
 *
 * 说明：
 * - 枚举指定年份从 `YYYY-01-01` 到 `YYYY-12-31` 的全部日历日（平年 365 天，闰年 366 天）；
 * - 支持传入 `CompletionEvent[]` 或 `localDate` 字符串数组；
 * - 每日完成次数映射为 `0 | 1 | 2 | 3 | 4` 五档热力强度。
 *
 * @param eventsOrDates 完成事件数组或 `localDate` 字符串数组
 * @param year 四位年份（默认取当前年份）
 * @returns 按日期升序排列的全年热力图单元格数组
 * @throws 无
 */
export function buildYearlyHeatmap(
  eventsOrDates: readonly (CompletionEvent | string)[],
  year: number = Number.parseInt(getTodayLocalDate().slice(0, 4), 10),
): HeatmapCell[] {
  const countByDate = new Map<string, number>();
  for (const item of eventsOrDates) {
    const dateStr = typeof item === 'string' ? item : item.localDate;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      countByDate.set(dateStr, (countByDate.get(dateStr) ?? 0) + 1);
    }
  }

  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;
  const cells: HeatmapCell[] = [];
  let cursor = startDate;

  for (let i = 0; i < 367; i++) {
    if (cursor > endDate) {
      break;
    }
    const count = countByDate.get(cursor) ?? 0;
    const level: 0 | 1 | 2 | 3 | 4 =
      count <= 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : count === 3 ? 3 : 4;
    cells.push({
      localDate: cursor,
      count,
      level,
      weekday: weekdayOf(cursor),
    });
    cursor = addDays(cursor, 1);
  }

  return cells;
}

/**
 * 计算给定周期粒度（周 / 月 / 年）的起止日期闭区间。
 *
 * @param referenceDate 参考日历日 'YYYY-MM-DD'
 * @param period 统计粒度 'week' | 'month' | 'year'
 * @returns [起始日, 结束日]
 * @throws 无
 */
export function getPeriodRange(
  referenceDate: string,
  period: HabitStatsPeriod,
): [string, string] {
  if (period === 'week') {
    return getWeekRange(referenceDate);
  }
  if (period === 'month') {
    return getMonthRange(referenceDate);
  }
  const year = referenceDate.slice(0, 4);
  return [`${year}-01-01`, `${year}-12-31`];
}

/**
 * 计算任意闭区间 `[fromDate, toDate]` 内各习惯的完成天数与累计总量明细（纯函数）。
 *
 * 说明：
 * - 每天完成算 1 次（`completedDays` 为区间内去重完成日历天数）；
 * - 每天的量是一个总数（`totalQuantity` 为区间内各完成日总量之和，如周累计跑量 km、月累计饮水量 ml）。
 *
 * @param habits 活跃微习惯列表
 * @param completionEvents 完成事件列表
 * @param checkIns 每日打卡记录列表
 * @param fromDate 起始日 'YYYY-MM-DD'（含）
 * @param toDate 结束日 'YYYY-MM-DD'（含）
 * @returns 各习惯在区间内的汇总数组
 * @throws 无
 */
export function computeHabitRangeSummaries(
  habits: readonly StoredHabit[],
  completionEvents: readonly CompletionEvent[],
  checkIns: readonly StoredHabitCheckIn[],
  fromDate: string,
  toDate: string,
): HabitPeriodItemSummary[] {
  const startMs = Date.parse(`${fromDate}T00:00:00Z`);
  const endMs = Date.parse(`${toDate}T00:00:00Z`);
  const totalDaysInPeriod = Math.max(1, Math.round((endMs - startMs) / 86_400_000) + 1);

  const checkInByKey = new Map<string, StoredHabitCheckIn>();
  for (const ci of checkIns) {
    if (ci.localDate >= fromDate && ci.localDate <= toDate) {
      checkInByKey.set(`${ci.habitId}::${ci.localDate}`, ci);
    }
  }

  const datesByHabit = new Map<string, Set<string>>();
  for (const ev of completionEvents) {
    if (ev.sourceType !== 'habit' || ev.localDate < fromDate || ev.localDate > toDate) {
      continue;
    }
    let set = datesByHabit.get(ev.sourceId);
    if (!set) {
      set = new Set<string>();
      datesByHabit.set(ev.sourceId, set);
    }
    set.add(ev.localDate);
  }
  // 兜底：若存在 checkIn 记录（value > 0）但未同步进 completionEvents，同样纳入日期集合
  for (const ci of checkIns) {
    if (ci.localDate < fromDate || ci.localDate > toDate) {
      continue;
    }
    const dailyVal = resolveCheckInDailyValue(ci, 1);
    if (dailyVal > 0) {
      let set = datesByHabit.get(ci.habitId);
      if (!set) {
        set = new Set<string>();
        datesByHabit.set(ci.habitId, set);
      }
      set.add(ci.localDate);
    }
  }

  return habits.map((habit) => {
    const dateSet = datesByHabit.get(habit.id) ?? new Set<string>();
    const completedDays = dateSet.size;
    let totalQuantity = 0;
    for (const d of dateSet) {
      const ci = checkInByKey.get(`${habit.id}::${d}`);
      totalQuantity += resolveCheckInDailyValue(ci, 1);
    }
    const normalizedTotal = normalizeHabitAmount(totalQuantity);
    const averagePerCompletedDay =
      completedDays > 0 ? Math.round((normalizedTotal / completedDays) * 100) / 100 : 0;
    const averagePerCalendarDay =
      Math.round((normalizedTotal / totalDaysInPeriod) * 100) / 100;

    return {
      habitId: habit.id,
      name: habit.name,
      icon: habit.icon,
      color: habit.color,
      unit: habit.unit || '次',
      trackingMode: habit.trackingMode === 'quantity' ? 'quantity' : 'check',
      ...(habit.dailyTarget && habit.dailyTarget > 0 ? { dailyTarget: habit.dailyTarget } : {}),
      completedDays,
      totalQuantity: normalizedTotal,
      averagePerCompletedDay,
      averagePerCalendarDay,
    };
  });
}

/**
 * 计算指定周期内习惯与课表的合并完成事件统计及各习惯累计总量（纯函数，C-03）。
 *
 * 说明：
 * - 同时统计 `sourceType === 'habit'`（每天每个习惯完成算 1 次）与 `sourceType === 'schedule'` 的完成事件；
 * - 若传入 `habits` 与 `checkIns`，同步产出该周/月/年下每个习惯的累计总量 `habitSummaries`。
 *
 * @param completionEvents 区间内或全量的完成事件列表
 * @param activeHabitCount 当前活跃习惯数量
 * @param referenceDate 参考日历日 'YYYY-MM-DD'
 * @param period 统计粒度（'week' | 'month' | 'year'）
 * @param habits 可选活跃习惯列表（用于生成各习惯周期累计量）
 * @param checkIns 可选每日打卡记录列表（用于汇总每日定量数值）
 * @returns 周期合并统计结果
 * @throws 无
 */
export function computeCombinedPeriodStats(
  completionEvents: readonly CompletionEvent[],
  activeHabitCount: number,
  referenceDate: string,
  period: HabitStatsPeriod,
  habits: readonly StoredHabit[] = [],
  checkIns: readonly StoredHabitCheckIn[] = [],
): CombinedPeriodStats {
  const [fromDate, toDate] = getPeriodRange(referenceDate, period);
  const startMs = Date.parse(`${fromDate}T00:00:00Z`);
  const endMs = Date.parse(`${toDate}T00:00:00Z`);
  const totalDaysInPeriod = Math.max(1, Math.round((endMs - startMs) / 86_400_000) + 1);

  let habitCompletedCount = 0;
  let scheduleCompletedCount = 0;
  const activeDateSet = new Set<string>();

  for (const ev of completionEvents) {
    if (ev.localDate < fromDate || ev.localDate > toDate) {
      continue;
    }
    activeDateSet.add(ev.localDate);
    if (ev.sourceType === 'habit') {
      habitCompletedCount += 1;
    } else if (ev.sourceType === 'schedule') {
      scheduleCompletedCount += 1;
    }
  }

  const expectedHabitTotal = activeHabitCount * totalDaysInPeriod;
  const habitCompletionRate =
    expectedHabitTotal > 0
      ? Math.min(100, Math.round((habitCompletedCount / expectedHabitTotal) * 100))
      : 0;

  const habitSummaries =
    habits.length > 0
      ? computeHabitRangeSummaries(habits, completionEvents, checkIns, fromDate, toDate)
      : [];

  return {
    period,
    fromDate,
    toDate,
    totalDaysInPeriod,
    habitCompletedCount,
    scheduleCompletedCount,
    combinedCompletedCount: habitCompletedCount + scheduleCompletedCount,
    activeDaysCount: activeDateSet.size,
    habitCompletionRate,
    habitSummaries,
  };
}

/**
 * 生成习惯唯一 ID。
 *
 * @returns 字符串 ID
 */
function generateHabitId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `habit-${crypto.randomUUID()}`;
  }
  return `habit-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 生成单次定量累加明细唯一 ID。
 *
 * @returns 字符串 ID
 */
function generateEntryId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `hentry-${crypto.randomUUID()}`;
  }
  return `hentry-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 微习惯领域服务。
 *
 * 说明：封装 `habits`、`habitCheckIns` 与共享 `CompletionEventRepository`。
 */
export class HabitService {
  /** 数据库实例。 */
  private readonly db: LifeHubDatabase;
  /** 共享完成事件仓库。 */
  private readonly completionRepo: CompletionEventRepository;

  /**
   * 构造微习惯服务。
   *
   * @param database 数据库实例，默认调用 `createDatabase()`
   * @param completionRepository 完成事件仓库，默认基于同一数据库构造
   */
  constructor(
    database: LifeHubDatabase = createDatabase(),
    completionRepository?: CompletionEventRepository,
  ) {
    this.db = database;
    this.completionRepo = completionRepository ?? new CompletionEventRepository(this.db);
  }

  /**
   * 获取全部未归档的微习惯列表（按创建时间升序）。
   *
   * @returns 微习惯列表
   * @throws 无
   */
  async listHabits(): Promise<StoredHabit[]> {
    const all = await this.db.table<StoredHabit>('habits').toArray();
    return all
      .filter((h) => !h.archivedAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * 获取全部每日打卡记录（供跨区间聚合与 AI 分析读取）。
   *
   * @returns 每日打卡记录数组
   * @throws 无
   */
  async listAllCheckIns(): Promise<StoredHabitCheckIn[]> {
    return this.db.table<StoredHabitCheckIn>('habitCheckIns').toArray();
  }

  /**
   * 创建新的微习惯（C-01）。
   *
   * @param input 习惯创建参数
   * @returns 持久化后的微习惯对象
   * @throws {LifeHubError} 名称为空或定量参数非法时抛出 `LIFEHUB_E_VALIDATION`
   */
  async createHabit(input: HabitInput): Promise<StoredHabit> {
    if (!input.name || input.name.trim().length === 0) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', '习惯名称不能为空');
    }
    const trackingMode: HabitTrackingMode =
      input.trackingMode === 'quantity' ? 'quantity' : 'check';
    const defaultInc =
      input.defaultIncrement !== undefined && input.defaultIncrement !== null
        ? normalizeHabitAmount(input.defaultIncrement)
        : 0;
    const dailyTarget =
      input.dailyTarget !== undefined && input.dailyTarget !== null
        ? normalizeHabitAmount(input.dailyTarget)
        : 0;

    const now = new Date().toISOString();
    const habit: StoredHabit = {
      id: generateHabitId(),
      name: input.name.trim(),
      unit: input.unit?.trim() || (trackingMode === 'quantity' ? 'ml' : '次'),
      trackingMode,
      ...(trackingMode === 'quantity' && defaultInc > 0 ? { defaultIncrement: defaultInc } : {}),
      ...(trackingMode === 'quantity' && dailyTarget > 0 ? { dailyTarget } : {}),
      targetPerPeriod: input.targetPerPeriod ?? 1,
      color: input.color || '#16A34A',
      icon: input.icon || '✨',
      createdAt: now,
      updatedAt: now,
    };
    await this.db.table<StoredHabit>('habits').put(habit);
    await this.persistModuleSnapshot();
    return habit;
  }

  /**
   * 将当前微习惯定义与打卡记录实时静默落盘至配置目录下的 `lifehub-habits.json`。
   */
  private async persistModuleSnapshot(): Promise<void> {
    try {
      const [habits, checkIns] = await Promise.all([
        this.db.table<StoredHabit>('habits').toArray(),
        this.db.table<StoredHabitCheckIn>('habitCheckIns').toArray(),
      ]);
      syncAutoSnapshotToStorageDir(
        JSON.stringify(
          {
            schema: 'lifehub-habits-v1',
            updatedAt: new Date().toISOString(),
            habitCount: habits.length,
            checkInCount: checkIns.length,
            habits,
            habitCheckIns: checkIns,
          },
          null,
          2,
        ),
        'lifehub-habits.json',
      );
    } catch {
      // 忽略快照写入异常
    }
  }

  /**
   * 更新已有微习惯（C-01）。
   *
   * @param id 习惯 ID
   * @param patch 修改字段
   * @returns 更新后的微习惯对象
   * @throws {LifeHubError} 习惯不存在或名称为空时抛出异常
   */
  async updateHabit(id: string, patch: Partial<HabitInput>): Promise<StoredHabit> {
    const table = this.db.table<StoredHabit>('habits');
    const existing = await table.get(id);
    if (!existing) {
      throw new LifeHubError('LIFEHUB_E_ENTITY_NOT_FOUND', `未找到习惯：${id}`);
    }
    const nextName = patch.name !== undefined ? patch.name.trim() : existing.name;
    if (!nextName) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', '习惯名称不能为空');
    }
    const nextMode: HabitTrackingMode =
      patch.trackingMode !== undefined
        ? patch.trackingMode
        : existing.trackingMode === 'quantity'
          ? 'quantity'
          : 'check';

    let nextDefaultInc = existing.defaultIncrement;
    if (patch.defaultIncrement !== undefined) {
      const n = patch.defaultIncrement === null ? 0 : normalizeHabitAmount(patch.defaultIncrement);
      nextDefaultInc = n > 0 ? n : undefined;
    }
    let nextDailyTarget = existing.dailyTarget;
    if (patch.dailyTarget !== undefined) {
      const n = patch.dailyTarget === null ? 0 : normalizeHabitAmount(patch.dailyTarget);
      nextDailyTarget = n > 0 ? n : undefined;
    }
    if (nextMode !== 'quantity') {
      nextDefaultInc = undefined;
      nextDailyTarget = undefined;
    }

    const updated: StoredHabit = {
      ...existing,
      name: nextName,
      unit:
        patch.unit !== undefined
          ? patch.unit.trim() || (nextMode === 'quantity' ? 'ml' : '次')
          : existing.unit,
      trackingMode: nextMode,
      targetPerPeriod:
        patch.targetPerPeriod !== undefined ? patch.targetPerPeriod : existing.targetPerPeriod,
      color: patch.color !== undefined ? patch.color : existing.color,
      icon: patch.icon !== undefined ? patch.icon : existing.icon,
      updatedAt: new Date().toISOString(),
    };
    if (nextDefaultInc !== undefined) {
      updated.defaultIncrement = nextDefaultInc;
    } else {
      delete updated.defaultIncrement;
    }
    if (nextDailyTarget !== undefined) {
      updated.dailyTarget = nextDailyTarget;
    } else {
      delete updated.dailyTarget;
    }

    await table.put(updated);
    await this.persistModuleSnapshot();
    return updated;
  }

  /**
   * 删除微习惯并级联清理其打卡记录与完成事件。
   *
   * @param id 习惯 ID
   * @returns 无
   * @throws 无
   */
  async deleteHabit(id: string): Promise<void> {
    await this.db.table<StoredHabit>('habits').delete(id);
    recordCloudTombstone('habit', id);
    await this.completionRepo.deleteBySource('habit', id);
    const checkInTable = this.db.table<StoredHabitCheckIn>('habitCheckIns');
    const allCheckIns = await checkInTable.toArray();
    const deletedCheckInIds: string[] = [];
    for (const item of allCheckIns) {
      if (item.habitId === id) {
        await checkInTable.delete(item.id);
        deletedCheckInIds.push(item.id);
      }
    }
    recordCloudTombstones('habitCheckIn', deletedCheckInIds);
    await this.persistModuleSnapshot();
  }

  /**
   * 切换某习惯在指定日历日的单次打卡状态（C-01）。
   *
   * 说明：同时写入/删除共享 `completionEvents`（`sourceType: 'habit'`）与 `habitCheckIns` 表（`value: 1`）。
   *
   * @param habitId 习惯 ID
   * @param localDate 本地日历日 'YYYY-MM-DD'，默认取今天
   * @returns 切换后的状态（true=已打卡，false=已撤销）
   * @throws 无
   */
  async toggleCheckIn(
    habitId: string,
    localDate: string = getTodayLocalDate(),
  ): Promise<boolean> {
    const completed = await this.completionRepo.toggle('habit', habitId, localDate);
    const checkInId = `habit:${habitId}:${localDate}`;
    const checkInTable = this.db.table<StoredHabitCheckIn>('habitCheckIns');
    if (completed) {
      const now = new Date().toISOString();
      await checkInTable.put({
        id: checkInId,
        habitId,
        localDate,
        completedAt: now,
        updatedAt: now,
        value: 1,
      });
    } else {
      await checkInTable.delete(checkInId);
      recordCloudTombstone('habitCheckIn', checkInId);
    }
    await this.persistModuleSnapshot();
    return completed;
  }

  /**
   * 在指定日历日为习惯累加一次数值记录（如喝水 +250ml、跑步 +3.5km）。
   *
   * 说明：
   * - 同一天多次调用会将各次 `amount` 累加进当日总量 `value` 并保留每次明细 `entries`；
   * - 当天无论累加多少次，共享 `completionEvents` 幂等维持 1 条当日完成记录（「每天完成算一次」）。
   *
   * @param habitId 习惯 ID
   * @param amount 本次新增数量（必须 > 0，支持整数或小数）
   * @param localDate 本地日历日 'YYYY-MM-DD'，默认取今天
   * @param note 可选备注
   * @returns 更新后的当日打卡汇总记录
   * @throws {LifeHubError} 数量非法（<= 0 或非有限数）时抛出 `LIFEHUB_E_VALIDATION`
   */
  async addQuantityCheckIn(
    habitId: string,
    amount: number,
    localDate: string = getTodayLocalDate(),
    note?: string,
  ): Promise<StoredHabitCheckIn> {
    const cleanAmount = normalizeHabitAmount(amount);
    if (cleanAmount <= 0) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', '请输入大于 0 的有效记录数值');
    }

    const now = new Date().toISOString();
    const checkInId = `habit:${habitId}:${localDate}`;
    const checkInTable = this.db.table<StoredHabitCheckIn>('habitCheckIns');
    const existing = await checkInTable.get(checkInId);

    let baseEntries: HabitQuantityEntry[] = [];
    if (existing) {
      if (Array.isArray(existing.entries) && existing.entries.length > 0) {
        baseEntries = [...existing.entries];
      } else if (typeof existing.value === 'number' && existing.value > 0) {
        baseEntries = [
          {
            id: generateEntryId(),
            amount: normalizeHabitAmount(existing.value),
            createdAt: existing.completedAt || now,
          },
        ];
      }
    }

    const newEntry: HabitQuantityEntry = {
      id: generateEntryId(),
      amount: cleanAmount,
      createdAt: now,
      ...(note && note.trim() ? { note: note.trim() } : {}),
    };
    const nextEntries = [...baseEntries, newEntry];
    const nextTotal = normalizeHabitAmount(
      nextEntries.reduce((sum, item) => sum + normalizeHabitAmount(item.amount), 0),
    );

    const record: StoredHabitCheckIn = {
      id: checkInId,
      habitId,
      localDate,
      completedAt: existing?.completedAt || now,
      updatedAt: now,
      value: nextTotal,
      entries: nextEntries,
      ...(existing?.deletedEntryIds && existing.deletedEntryIds.length > 0
        ? { deletedEntryIds: existing.deletedEntryIds }
        : {}),
    };

    await checkInTable.put(record);
    await this.completionRepo.markCompleted('habit', habitId, localDate);
    await this.persistModuleSnapshot();
    return record;
  }

  /**
   * 撤销某日定量记录中的单条累加明细；若撤销后当日总量为 0 则自动取消当日打卡状态。
   *
   * @param habitId 习惯 ID
   * @param entryId 单次明细 ID
   * @param localDate 本地日历日 'YYYY-MM-DD'
   * @returns 更新后的当日记录；若当日已无剩余明细则返回 null
   * @throws 无
   */
  async removeQuantityEntry(
    habitId: string,
    entryId: string,
    localDate: string = getTodayLocalDate(),
  ): Promise<StoredHabitCheckIn | null> {
    const checkInId = `habit:${habitId}:${localDate}`;
    const checkInTable = this.db.table<StoredHabitCheckIn>('habitCheckIns');
    const existing = await checkInTable.get(checkInId);
    if (!existing || !Array.isArray(existing.entries)) {
      return existing ?? null;
    }

    const remaining = existing.entries.filter((item) => item.id !== entryId);
    if (remaining.length === 0) {
      await this.clearCheckIn(habitId, localDate);
      return null;
    }

    const now = new Date().toISOString();
    const nextTotal = normalizeHabitAmount(
      remaining.reduce((sum, item) => sum + normalizeHabitAmount(item.amount), 0),
    );
    const deletedSet = new Set<string>(existing.deletedEntryIds ?? []);
    deletedSet.add(entryId);

    const updated: StoredHabitCheckIn = {
      ...existing,
      updatedAt: now,
      value: nextTotal,
      entries: remaining,
      deletedEntryIds: Array.from(deletedSet),
    };
    await checkInTable.put(updated);
    await this.completionRepo.markCompleted('habit', habitId, localDate);
    await this.persistModuleSnapshot();
    return updated;
  }

  /**
   * 直接设定或修正指定日历日的总数值（传 0 则清空当日打卡记录）。
   *
   * @param habitId 习惯 ID
   * @param totalAmount 当日目标总数值（>= 0，传 0 清空当日打卡）
   * @param localDate 本地日历日 'YYYY-MM-DD'
   * @returns 更新后的记录；若清空则返回 null
   * @throws {LifeHubError} 传入负数或非有限数值时抛出 `LIFEHUB_E_VALIDATION`
   */
  async setDailyQuantity(
    habitId: string,
    totalAmount: number,
    localDate: string = getTodayLocalDate(),
  ): Promise<StoredHabitCheckIn | null> {
    if (!Number.isFinite(totalAmount) || totalAmount < 0) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', '每日总量不能为负数');
    }
    const cleanTotal = normalizeHabitAmount(totalAmount);
    if (cleanTotal === 0) {
      await this.clearCheckIn(habitId, localDate);
      return null;
    }

    const now = new Date().toISOString();
    const checkInId = `habit:${habitId}:${localDate}`;
    const checkInTable = this.db.table<StoredHabitCheckIn>('habitCheckIns');
    const existing = await checkInTable.get(checkInId);

    const deletedSet = new Set<string>(existing?.deletedEntryIds ?? []);
    for (const prev of existing?.entries ?? []) {
      deletedSet.add(prev.id);
    }

    const summaryEntry: HabitQuantityEntry = {
      id: generateEntryId(),
      amount: cleanTotal,
      createdAt: now,
    };
    const record: StoredHabitCheckIn = {
      id: checkInId,
      habitId,
      localDate,
      completedAt: existing?.completedAt || now,
      updatedAt: now,
      value: cleanTotal,
      entries: [summaryEntry],
      ...(deletedSet.size > 0 ? { deletedEntryIds: Array.from(deletedSet) } : {}),
    };

    await checkInTable.put(record);
    await this.completionRepo.markCompleted('habit', habitId, localDate);
    await this.persistModuleSnapshot();
    return record;
  }

  /**
   * 清空某习惯在指定日历日的打卡状态与全部当日明细。
   *
   * @param habitId 习惯 ID
   * @param localDate 本地日历日 'YYYY-MM-DD'
   * @returns 无
   * @throws 无
   */
  async clearCheckIn(
    habitId: string,
    localDate: string = getTodayLocalDate(),
  ): Promise<void> {
    const checkInId = `habit:${habitId}:${localDate}`;
    await this.db.table<StoredHabitCheckIn>('habitCheckIns').delete(checkInId);
    recordCloudTombstone('habitCheckIn', checkInId);
    await this.completionRepo.unmarkCompleted('habit', habitId, localDate);
    await this.persistModuleSnapshot();
  }

  /**
   * 获取全部习惯及其在参考日下的连续天数、当日量、累计总量与打卡状态列表（C-01 / C-04）。
   *
   * @param referenceDate 参考日历日 'YYYY-MM-DD'，默认取今天
   * @returns 附带连续天数、当日数值与徽章的习惯视图数组
   * @throws 无
   */
  async listHabitsWithStats(
    referenceDate: string = getTodayLocalDate(),
  ): Promise<HabitWithStats[]> {
    const [habits, allCheckIns] = await Promise.all([
      this.listHabits(),
      this.listAllCheckIns(),
    ]);
    const checkInsByHabit = new Map<string, StoredHabitCheckIn[]>();
    for (const ci of allCheckIns) {
      let arr = checkInsByHabit.get(ci.habitId);
      if (!arr) {
        arr = [];
        checkInsByHabit.set(ci.habitId, arr);
      }
      arr.push(ci);
    }

    const results: HabitWithStats[] = [];
    for (const habit of habits) {
      const events = await this.completionRepo.listBySource('habit', habit.id);
      const habitCheckIns = checkInsByHabit.get(habit.id) ?? [];
      const checkInMap = new Map<string, StoredHabitCheckIn>();
      for (const ci of habitCheckIns) {
        checkInMap.set(ci.localDate, ci);
      }

      const dateSet = new Set<string>(events.map((e) => e.localDate));
      for (const ci of habitCheckIns) {
        if (resolveCheckInDailyValue(ci, 1) > 0) {
          dateSet.add(ci.localDate);
        }
      }
      const completedDates = Array.from(dateSet).sort((a, b) => a.localeCompare(b));

      const streak = computeHabitStreak(completedDates, referenceDate);
      const badges = computeHabitBadges(streak);
      const completedOnRefDate = dateSet.has(referenceDate);
      const refCheckIn = checkInMap.get(referenceDate);
      const refDateValue = completedOnRefDate ? resolveCheckInDailyValue(refCheckIn, 1) : 0;
      const refDateEntries = completedOnRefDate && refCheckIn?.entries ? [...refCheckIn.entries] : [];

      let totalQuantityAllTime = 0;
      for (const d of completedDates) {
        totalQuantityAllTime += resolveCheckInDailyValue(checkInMap.get(d), 1);
      }

      results.push({
        habit,
        completedOnRefDate,
        refDateValue: normalizeHabitAmount(refDateValue),
        refDateEntries,
        totalQuantityAllTime: normalizeHabitAmount(totalQuantityAllTime),
        streak,
        badges,
        completedDates,
      });
    }
    return results;
  }

  /**
   * 获取指定年份的打卡热力图数据（C-02）。
   *
   * @param year 四位年份
   * @returns 全年每日热力图单元格数组
   * @throws 无
   */
  async getYearlyHeatmap(year: number): Promise<HeatmapCell[]> {
    const events = await this.completionRepo.listByDateRange(`${year}-01-01`, `${year}-12-31`);
    const habitEvents = events.filter((e) => e.sourceType === 'habit');
    return buildYearlyHeatmap(habitEvents, year);
  }

  /**
   * 获取指定周期（周 / 月 / 年）的习惯与课表合并统计及各习惯累计总量（C-03）。
   *
   * @param referenceDate 参考日历日 'YYYY-MM-DD'
   * @param period 周期粒度 'week' | 'month' | 'year'
   * @returns 周期合并统计与各习惯累计汇总
   * @throws 无
   */
  async getPeriodStats(
    referenceDate: string,
    period: HabitStatsPeriod,
  ): Promise<CombinedPeriodStats> {
    const [fromDate, toDate] = getPeriodRange(referenceDate, period);
    const [habits, events, checkIns] = await Promise.all([
      this.listHabits(),
      this.completionRepo.listByDateRange(fromDate, toDate),
      this.listAllCheckIns(),
    ]);
    return computeCombinedPeriodStats(events, habits.length, referenceDate, period, habits, checkIns);
  }
}
