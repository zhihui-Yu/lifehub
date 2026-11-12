/**
 * 生活课表 / 时间块领域服务与仓库（模块 B：B-01 ~ B-05）。
 *
 * 架构位置：apps/web 的「生活课表模块」服务层。
 *
 * 职责：
 * 1. 基于 `LifeHubDatabase` 的 `scheduleSlots` 明文表提供课表时段 CRUD（B-01）；
 * 2. 结合共享 `CompletionEventRepository`（`sourceType: 'schedule'`）实现时段完成勾选与取消（B-02）；
 * 3. 提供日视图 / 周视图区间展开与完成状态合并（B-03）；
 * 4. 计算周 / 月应完成次数、已完成次数与完成率百分比，跨月边界严格按 `localDate` 闭区间切分、不重复计入（B-05）。
 */
import { LifeHubError } from '@lifehub/core';
import type { LifeHubDatabase } from '@/platform/db';
import { createDatabase } from '@/platform/db';
import {
  CompletionEventRepository,
  type CompletionEvent,
} from '@/modules/shared/completion-event';
import { getMonthRange, getWeekRange } from '@/modules/shared/date-utils';
import { syncAutoSnapshotToStorageDir } from '@/utils/download';
import {
  expandScheduleForRange,
  isValidWallTime,
  parseRRule,
  type ExpandedScheduleInstance,
  type StoredScheduleSlot,
} from './rrule';

export type { ExpandedScheduleInstance, StoredScheduleSlot } from './rrule';

/**
 * 创建或更新课表时段的输入载荷。
 */
export interface ScheduleSlotInput {
  /** 时段标题（必填）。 */
  title: string;
  /** 开始墙上时间 'HH:mm'（必填）。 */
  startTime: string;
  /** 结束墙上时间 'HH:mm'（必填，且需晚于 startTime）。 */
  endTime: string;
  /** 固定星期几（0=周日，1=周一 … 6=周六）。 */
  dayOfWeek?: number;
  /** 可选 RFC 5545 子集规则字符串。 */
  rrule?: string;
  /** 生效起始日 'YYYY-MM-DD'。 */
  validFrom?: string;
  /** 生效截止日 'YYYY-MM-DD'。 */
  validUntil?: string;
  /** 地点。 */
  location?: string;
  /** 分类标识。 */
  category?: string;
  /** 颜色 '#RRGGBB'。 */
  color?: string;
  /** 备注。 */
  note?: string;
}

/**
 * 附带完成状态的展开课表实例。
 */
export interface ScheduleOccurrenceWithStatus extends ExpandedScheduleInstance {
  /** 当天该时段是否已勾选完成。 */
  completed: boolean;
}

/**
 * 指定日期区间的课表完成率统计结果（B-05）。
 */
export interface ScheduleCompletionStats {
  /** 统计起始日 'YYYY-MM-DD'（含）。 */
  fromDate: string;
  /** 统计结束日 'YYYY-MM-DD'（含）。 */
  toDate: string;
  /** 区间内应完成总次数。 */
  expectedCount: number;
  /** 区间内应完成总次数（别名，兼容统计卡片读取）。 */
  totalScheduled: number;
  /** 区间内已完成次数。 */
  completedCount: number;
  /** 完成率百分比（0..100 整数，如 75 表示 75%）。 */
  completionRate: number;
  /** 完成率小数（0..1，如 0.75）。 */
  completionRatio: number;
}

/**
 * 计算指定闭区间 `[fromDate, toDate]` 内的课表完成率（纯函数，B-05）。
 *
 * 说明：
 * - 先将所有课表时段在 `[fromDate, toDate]` 内展开为具体 `(slotId, localDate)` 实例；
 * - 再与 `completionEvents` 中 `sourceType === 'schedule'` 的记录按 `slotId + localDate` 精确匹配；
 * - 仅统计落在 `[fromDate, toDate]` 内的展开项，跨月或未绑定有效时段的孤立事件不重复计入。
 *
 * @param slots 课表时段列表
 * @param completionEvents 完成事件列表
 * @param fromDate 统计起始日 'YYYY-MM-DD'（含）
 * @param toDate 统计结束日 'YYYY-MM-DD'（含）
 * @returns 区间完成率统计结果
 * @throws {LifeHubError} 当时段包含非法 RRULE 时抛出异常
 */
export function computeScheduleStats(
  slots: readonly StoredScheduleSlot[],
  completionEvents: readonly CompletionEvent[],
  fromDate: string,
  toDate: string,
): ScheduleCompletionStats {
  const instances = expandScheduleForRange(slots, fromDate, toDate);
  const expectedCount = instances.length;
  if (expectedCount === 0) {
    return {
      fromDate,
      toDate,
      expectedCount: 0,
      totalScheduled: 0,
      completedCount: 0,
      completionRate: 0,
      completionRatio: 0,
    };
  }

  const completedKeySet = new Set<string>();
  for (const ev of completionEvents) {
    if (ev.sourceType === 'schedule' && ev.localDate >= fromDate && ev.localDate <= toDate) {
      completedKeySet.add(`${ev.sourceId}:${ev.localDate}`);
    }
  }

  let completedCount = 0;
  for (const inst of instances) {
    if (completedKeySet.has(`${inst.slotId}:${inst.localDate}`)) {
      completedCount += 1;
    }
  }

  const completionRatio = completedCount / expectedCount;
  const completionRate = Math.round(completionRatio * 100);

  return {
    fromDate,
    toDate,
    expectedCount,
    totalScheduled: expectedCount,
    completedCount,
    completionRate,
    completionRatio,
  };
}

/**
 * 生成时段唯一 ID。
 *
 * @returns 字符串 ID
 */
function generateSlotId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `slot-${crypto.randomUUID()}`;
  }
  return `slot-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 校验课表时段输入合法性。
 *
 * @param input 待校验的课表时段输入
 * @returns 无
 * @throws {LifeHubError} 标题为空、时间格式错误或结束时间不晚于开始时间时抛出 `LIFEHUB_E_VALIDATION`
 */
function validateSlotInput(input: ScheduleSlotInput): void {
  if (!input.title || input.title.trim().length === 0) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '课表时段标题不能为空');
  }
  if (!isValidWallTime(input.startTime) || !isValidWallTime(input.endTime)) {
    throw new LifeHubError(
      'LIFEHUB_E_VALIDATION',
      `课表时间格式必须为 HH:mm（当前：${input.startTime} - ${input.endTime}）`,
    );
  }
  if (input.startTime >= input.endTime) {
    throw new LifeHubError(
      'LIFEHUB_E_VALIDATION',
      `结束时间（${input.endTime}）必须晚于开始时间（${input.startTime}）`,
    );
  }
  if (input.rrule && input.rrule.trim().length > 0) {
    parseRRule(input.rrule);
  }
}

/**
 * 生活课表领域服务。
 *
 * 说明：封装 `scheduleSlots` 表与共享 `CompletionEventRepository`，供页面与测试调用。
 */
export class ScheduleService {
  /** 数据库实例。 */
  private readonly db: LifeHubDatabase;
  /** 共享完成事件仓库。 */
  private readonly completionRepo: CompletionEventRepository;

  /**
   * 构造生活课表服务。
   *
   * @param database 数据库实例，默认调用 `createDatabase()`
   * @param completionRepository 完成事件仓库，默认使用同一数据库构造
   */
  constructor(
    database: LifeHubDatabase = createDatabase(),
    completionRepository?: CompletionEventRepository,
  ) {
    this.db = database;
    this.completionRepo = completionRepository ?? new CompletionEventRepository(this.db);
  }

  /**
   * 获取全部课表时段定义（按开始时间与创建时间排序）。
   *
   * @returns 课表时段数组
   * @throws 无
   */
  async listSlots(): Promise<StoredScheduleSlot[]> {
    const all = await this.db.table<StoredScheduleSlot>('scheduleSlots').toArray();
    return all.sort((a, b) => {
      const timeCmp = a.startTime.localeCompare(b.startTime);
      if (timeCmp !== 0) {
        return timeCmp;
      }
      return a.createdAt.localeCompare(b.createdAt);
    });
  }

  /**
   * 按 ID 获取单个课表时段。
   *
   * @param id 时段 ID
   * @returns 存在时返回时段对象，否则返回 undefined
   * @throws 无
   */
  async getSlot(id: string): Promise<StoredScheduleSlot | undefined> {
    return this.db.table<StoredScheduleSlot>('scheduleSlots').get(id);
  }

  /**
   * 创建新的课表时段（B-01）。
   *
   * @param input 课表时段输入参数
   * @returns 持久化后的课表时段对象
   * @throws {LifeHubError} 输入参数校验失败时抛出异常
   */
  async createSlot(input: ScheduleSlotInput): Promise<StoredScheduleSlot> {
    validateSlotInput(input);
    const now = new Date().toISOString();
    const slot: StoredScheduleSlot = {
      id: generateSlotId(),
      title: input.title.trim(),
      startTime: input.startTime.trim(),
      endTime: input.endTime.trim(),
      ...(input.dayOfWeek !== undefined ? { dayOfWeek: input.dayOfWeek } : {}),
      ...(input.rrule && input.rrule.trim() ? { rrule: input.rrule.trim() } : {}),
      ...(input.validFrom ? { validFrom: input.validFrom } : {}),
      ...(input.validUntil ? { validUntil: input.validUntil } : {}),
      ...(input.location ? { location: input.location.trim() } : {}),
      ...(input.category ? { category: input.category.trim() } : {}),
      color: input.color || '#4F46E5',
      ...(input.note ? { note: input.note.trim() } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await this.db.table<StoredScheduleSlot>('scheduleSlots').put(slot);
    await this.persistModuleSnapshot();
    return slot;
  }

  /**
   * 将当前全部课表时段与完成事件静默落盘至用户配置的本地存储目录 `lifehub-schedule.json`。
   */
  private async persistModuleSnapshot(): Promise<void> {
    try {
      const [slots, events] = await Promise.all([
        this.db.table<StoredScheduleSlot>('scheduleSlots').toArray(),
        this.completionRepo.listByDateRange('1970-01-01', '2099-12-31'),
      ]);
      const scheduleEvents = events.filter((e) => e.sourceType === 'schedule');
      syncAutoSnapshotToStorageDir(
        JSON.stringify(
          {
            schema: 'lifehub-schedule-v1',
            updatedAt: new Date().toISOString(),
            slotCount: slots.length,
            completionCount: scheduleEvents.length,
            scheduleSlots: slots,
            completionEvents: scheduleEvents,
          },
          null,
          2,
        ),
        'lifehub-schedule.json',
      );
    } catch {
      // 忽略快照写入异常
    }
  }

  /**
   * 更新已有的课表时段（B-01）。
   *
   * @param id 目标时段 ID
   * @param patch 要修改的字段集合
   * @returns 更新后的课表时段对象
   * @throws {LifeHubError} 时段不存在或修改后的时间/规则非法时抛出异常
   */
  async updateSlot(id: string, patch: Partial<ScheduleSlotInput>): Promise<StoredScheduleSlot> {
    const table = this.db.table<StoredScheduleSlot>('scheduleSlots');
    const existing = await table.get(id);
    if (!existing) {
      throw new LifeHubError('LIFEHUB_E_ENTITY_NOT_FOUND', `未找到课表时段：${id}`);
    }
    const merged: ScheduleSlotInput = {
      title: patch.title !== undefined ? patch.title : existing.title,
      startTime: patch.startTime !== undefined ? patch.startTime : existing.startTime,
      endTime: patch.endTime !== undefined ? patch.endTime : existing.endTime,
      dayOfWeek: patch.dayOfWeek !== undefined ? patch.dayOfWeek : existing.dayOfWeek,
      rrule: patch.rrule !== undefined ? patch.rrule : existing.rrule,
      validFrom: patch.validFrom !== undefined ? patch.validFrom : existing.validFrom,
      validUntil: patch.validUntil !== undefined ? patch.validUntil : existing.validUntil,
      location: patch.location !== undefined ? patch.location : existing.location,
      category: patch.category !== undefined ? patch.category : existing.category,
      color: patch.color !== undefined ? patch.color : existing.color,
      note: patch.note !== undefined ? patch.note : existing.note,
    };
    validateSlotInput(merged);

    const updated: StoredScheduleSlot = {
      ...existing,
      title: merged.title.trim(),
      startTime: merged.startTime.trim(),
      endTime: merged.endTime.trim(),
      dayOfWeek: merged.dayOfWeek,
      rrule: merged.rrule && merged.rrule.trim() ? merged.rrule.trim() : undefined,
      validFrom: merged.validFrom,
      validUntil: merged.validUntil,
      location: merged.location ? merged.location.trim() : undefined,
      category: merged.category ? merged.category.trim() : undefined,
      color: merged.color || existing.color || '#4F46E5',
      note: merged.note ? merged.note.trim() : undefined,
      updatedAt: new Date().toISOString(),
    };
    await table.put(updated);
    await this.persistModuleSnapshot();
    return updated;
  }

  /**
   * 删除指定课表时段并级联清理其关联的完成事件（B-01）。
   *
   * @param id 时段 ID
   * @returns 无
   * @throws 无
   */
  async deleteSlot(id: string): Promise<void> {
    await this.db.table<StoredScheduleSlot>('scheduleSlots').delete(id);
    await this.completionRepo.deleteBySource('schedule', id);
    await this.persistModuleSnapshot();
  }

  /**
   * 切换某课表时段在指定日历日的完成状态（B-02，写入共享 `completionEvents` 表）。
   *
   * @param slotId 课表时段 ID
   * @param localDate 本地日历日 'YYYY-MM-DD'
   * @returns 切换后的完成状态（true=已完成，false=未完成）
   * @throws 无
   */
  async toggleSlotCompletion(slotId: string, localDate: string): Promise<boolean> {
    const res = await this.completionRepo.toggle('schedule', slotId, localDate);
    await this.persistModuleSnapshot();
    return res;
  }

  /**
   * 查询某课表时段在指定日历日是否已完成。
   *
   * @param slotId 课表时段 ID
   * @param localDate 本地日历日 'YYYY-MM-DD'
   * @returns 已完成返回 true
   * @throws 无
   */
  async isSlotCompleted(slotId: string, localDate: string): Promise<boolean> {
    return this.completionRepo.isCompleted('schedule', slotId, localDate);
  }

  /**
   * 获取闭区间 `[fromDate, toDate]` 内展开的全部课表实例及其完成状态（B-02 / B-03）。
   *
   * @param fromDate 起始日历日 'YYYY-MM-DD'（含）
   * @param toDate 结束日历日 'YYYY-MM-DD'（含）
   * @returns 附带完成状态的展开课表实例列表
   * @throws {LifeHubError} 当时段包含非法 RRULE 时抛出异常
   */
  async getOccurrencesWithStatus(
    fromDate: string,
    toDate: string,
  ): Promise<ScheduleOccurrenceWithStatus[]> {
    const [slots, events] = await Promise.all([
      this.listSlots(),
      this.completionRepo.listByDateRange(fromDate, toDate),
    ]);
    const instances = expandScheduleForRange(slots, fromDate, toDate);
    const completedSet = new Set<string>();
    for (const ev of events) {
      if (ev.sourceType === 'schedule') {
        completedSet.add(`${ev.sourceId}:${ev.localDate}`);
      }
    }
    return instances.map((inst) => ({
      ...inst,
      completed: completedSet.has(`${inst.slotId}:${inst.localDate}`),
    }));
  }

  /**
   * 计算参考日所在自然周与自然月的课表完成率统计（B-05）。
   *
   * @param referenceDate 参考本地日历日 'YYYY-MM-DD'
   * @returns 包含本周（week）与本月（month）的完成率统计对象
   * @throws {LifeHubError} 当时段包含非法 RRULE 时抛出异常
   */
  async getWeekAndMonthStats(referenceDate: string): Promise<{
    week: ScheduleCompletionStats;
    month: ScheduleCompletionStats;
  }> {
    const [weekFrom, weekTo] = getWeekRange(referenceDate);
    const [monthFrom, monthTo] = getMonthRange(referenceDate);
    const minFrom = weekFrom < monthFrom ? weekFrom : monthFrom;
    const maxTo = weekTo > monthTo ? weekTo : monthTo;

    const [slots, events] = await Promise.all([
      this.listSlots(),
      this.completionRepo.listByDateRange(minFrom, maxTo),
    ]);

    return {
      week: computeScheduleStats(slots, events, weekFrom, weekTo),
      month: computeScheduleStats(slots, events, monthFrom, monthTo),
    };
  }
}
