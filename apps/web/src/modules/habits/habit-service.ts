/**
 * 微习惯打卡领域服务、连续天数计算、全年热力图与跨模块统计（模块 C：C-01 ~ C-04）。
 *
 * 架构位置：apps/web 的「微习惯模块」服务层。
 *
 * 核心设计约束（ADR-006 / X-09）：
 * 1. 所有连续天数（Streak）、漏打重置、跨天分组计算**严格只比较 `localDate`（`'YYYY-MM-DD'`）字符串**，
 *    通过 `@lifehub/core` 的 `addDays` 判断日历日相邻性，绝不做 UTC 时间戳毫秒差运算；
 * 2. 打卡动作同时写入共享 `CompletionEventRepository`（`sourceType: 'habit'`）与 `habitCheckIns` 表，
 *    使模块 B（课表）与模块 C（习惯）天然共享同一套 `CompletionEvent` 完成事件模型（C-03）。
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

/**
 * 持久化在 Dexie `habits` 表中的微习惯模型。
 */
export interface StoredHabit {
  /** 习惯唯一主键 ID。 */
  id: string;
  /** 习惯名称（如「晨起喝水」「阅读 30 分钟」）。 */
  name: string;
  /** 计量单位（如「次」「分钟」「页」）。 */
  unit: string;
  /** 每周期目标次数（默认每天 1 次）。 */
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
 * 持久化在 Dexie `habitCheckIns` 表中的打卡记录。
 */
export interface StoredHabitCheckIn {
  /** 主键，格式为 `habit:${habitId}:${localDate}`。 */
  id: string;
  /** 所属习惯 ID。 */
  habitId: string;
  /** 打卡本地日历日 'YYYY-MM-DD'。 */
  localDate: string;
  /** 完成时刻 ISO 8601 UTC。 */
  completedAt: string;
}

/**
 * 创建或更新微习惯的输入载荷。
 */
export interface HabitInput {
  /** 习惯名称（必填）。 */
  name: string;
  /** 单位（默认「次」）。 */
  unit?: string;
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
  /** 累计打卡总天数（去重后）。 */
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
  /** 习惯打卡完成次数（`sourceType === 'habit'`）。 */
  habitCompletedCount: number;
  /** 课表时段完成次数（`sourceType === 'schedule'`）。 */
  scheduleCompletedCount: number;
  /** 课表 + 习惯合并总完成事件次数。 */
  combinedCompletedCount: number;
  /** 区间内有至少一次完成事件的活跃天数。 */
  activeDaysCount: number;
  /** 习惯目标完成率百分比（0..100）。 */
  habitCompletionRate: number;
}

/**
 * 附带统计与徽章的习惯视图模型。
 */
export interface HabitWithStats {
  /** 习惯基础信息。 */
  habit: StoredHabit;
  /** 今日（或当前选中参考日）是否已打卡。 */
  completedOnRefDate: boolean;
  /** 连续打卡统计。 */
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
 * 计算指定周期内习惯与课表的合并完成事件统计（纯函数，C-03）。
 *
 * 说明：
 * - 同时统计 `sourceType === 'habit'` 与 `sourceType === 'schedule'` 的完成事件，
 *   验证模块 B 与模块 C 共享同一 `CompletionEvent` 模型；
 * - 计算区间内习惯完成率与活跃天数。
 *
 * @param completionEvents 区间内或全量的完成事件列表
 * @param activeHabitCount 当前活跃习惯数量
 * @param referenceDate 参考日历日 'YYYY-MM-DD'
 * @param period 统计粒度（'week' | 'month' | 'year'）
 * @returns 周期合并统计结果
 * @throws 无
 */
export function computeCombinedPeriodStats(
  completionEvents: readonly CompletionEvent[],
  activeHabitCount: number,
  referenceDate: string,
  period: HabitStatsPeriod,
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
   * 创建新的微习惯（C-01）。
   *
   * @param input 习惯创建参数
   * @returns 持久化后的微习惯对象
   * @throws {LifeHubError} 名称为空时抛出 `LIFEHUB_E_VALIDATION`
   */
  async createHabit(input: HabitInput): Promise<StoredHabit> {
    if (!input.name || input.name.trim().length === 0) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', '习惯名称不能为空');
    }
    const now = new Date().toISOString();
    const habit: StoredHabit = {
      id: generateHabitId(),
      name: input.name.trim(),
      unit: input.unit?.trim() || '次',
      targetPerPeriod: input.targetPerPeriod ?? 1,
      color: input.color || '#16A34A',
      icon: input.icon || '✨',
      createdAt: now,
      updatedAt: now,
    };
    await this.db.table<StoredHabit>('habits').put(habit);
    return habit;
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
    const updated: StoredHabit = {
      ...existing,
      name: nextName,
      unit: patch.unit !== undefined ? patch.unit.trim() || '次' : existing.unit,
      targetPerPeriod:
        patch.targetPerPeriod !== undefined ? patch.targetPerPeriod : existing.targetPerPeriod,
      color: patch.color !== undefined ? patch.color : existing.color,
      icon: patch.icon !== undefined ? patch.icon : existing.icon,
      updatedAt: new Date().toISOString(),
    };
    await table.put(updated);
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
    await this.completionRepo.deleteBySource('habit', id);
    const checkInTable = this.db.table<StoredHabitCheckIn>('habitCheckIns');
    const allCheckIns = await checkInTable.toArray();
    for (const item of allCheckIns) {
      if (item.habitId === id) {
        await checkInTable.delete(item.id);
      }
    }
  }

  /**
   * 切换某习惯在指定日历日的打卡状态（C-01）。
   *
   * 说明：同时写入/删除共享 `completionEvents`（`sourceType: 'habit'`）与 `habitCheckIns` 表。
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
      await checkInTable.put({
        id: checkInId,
        habitId,
        localDate,
        completedAt: new Date().toISOString(),
      });
    } else {
      await checkInTable.delete(checkInId);
    }
    return completed;
  }

  /**
   * 获取全部习惯及其在参考日下的连续天数、徽章与打卡状态列表（C-01 / C-04）。
   *
   * @param referenceDate 参考日历日 'YYYY-MM-DD'，默认取今天
   * @returns 附带连续天数与徽章的习惯视图数组
   * @throws 无
   */
  async listHabitsWithStats(
    referenceDate: string = getTodayLocalDate(),
  ): Promise<HabitWithStats[]> {
    const habits = await this.listHabits();
    const results: HabitWithStats[] = [];
    for (const habit of habits) {
      const events = await this.completionRepo.listBySource('habit', habit.id);
      const completedDates = events.map((e) => e.localDate);
      const streak = computeHabitStreak(completedDates, referenceDate);
      const badges = computeHabitBadges(streak);
      const completedOnRefDate = completedDates.includes(referenceDate);
      results.push({
        habit,
        completedOnRefDate,
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
   * 获取指定周期（周 / 月 / 年）的习惯与课表合并统计（C-03）。
   *
   * @param referenceDate 参考日历日 'YYYY-MM-DD'
   * @param period 周期粒度 'week' | 'month' | 'year'
   * @returns 周期合并统计结果
   * @throws 无
   */
  async getPeriodStats(
    referenceDate: string,
    period: HabitStatsPeriod,
  ): Promise<CombinedPeriodStats> {
    const [fromDate, toDate] = getPeriodRange(referenceDate, period);
    const [habits, events] = await Promise.all([
      this.listHabits(),
      this.completionRepo.listByDateRange(fromDate, toDate),
    ]);
    return computeCombinedPeriodStats(events, habits.length, referenceDate, period);
  }
}
