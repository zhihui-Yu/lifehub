/**
 * 课表（B-02）与习惯（C-03）共用的完成事件模型与仓库。
 *
 * 架构位置：apps/web 的「S4 模块共享层」，是两类完成记录**唯一**的定义来源；
 * 课表项打卡与习惯打卡的统计合并都从这里读取，避免两套重复定义漂移。
 *
 * 设计要点：
 * - 主键用「`sourceType:sourceId:localDate`」而非随机 UUID，使 `toggle` 天然幂等、
 *   且无需先查后写即可定位记录（IndexedDB 主键唯一约束）；
 * - 持久化全部走本地 Dexie 的 `completionEvents` 明文表（见 `platform/db.ts` 的 version(2)），
 *   不引入任何外部网络依赖。
 */
import type { LifeHubDatabase } from '@/platform/db';
import { createDatabase } from '@/platform/db';

/** 完成事件的来源类型：课表时段或习惯。 */
export type CompletionSourceType = 'schedule' | 'habit';

/**
 * 完成事件。
 *
 * 说明：表示「某来源的某一项在某一本地日历日已经完成一次」。
 * 课表（B-02）与习惯（C-03）合并统计时都依赖它，故集中定义于此。
 */
export interface CompletionEvent {
  /** 主键，形如 `schedule:slotId:2024-06-03`，由来源与日期唯一确定。 */
  id: string;
  /** 来源类型：课表时段 `schedule` 或习惯 `habit`。 */
  sourceType: CompletionSourceType;
  /** 来源项 id（课表时段 id 或习惯 id）。 */
  sourceId: string;
  /** 本地日历日 'YYYY-MM-DD'，跨天判定只比该字符串。 */
  localDate: string;
  /** 创建时刻，ISO 8601 UTC 字符串。 */
  createdAt: string;
  /** 可选备注。 */
  note?: string;
}

/**
 * 完成事件仓库（Dexie 支撑）。
 *
 * 说明：封装 `completionEvents` 表的增删查；`toggle` 提供「打勾 / 取消打勾」的幂等切换，
 * 是课表与习惯完成确认的统一入口。
 */
export class CompletionEventRepository {
  /** 当前数据库实例（默认取应用唯一的 LifeHubDatabase）。 */
  private readonly db: LifeHubDatabase;

  /**
   * 构造完成事件仓库。
   *
   * @param database 数据库实例，默认取应用唯一的 `createDatabase()`；测试可注入假实例
   */
  constructor(database: LifeHubDatabase = createDatabase()) {
    this.db = database;
  }

  /**
   * 组装完成事件主键。
   *
   * 说明：用来源类型、来源 id、本地日历日三段拼接，保证同一来源同一天只能有一条记录。
   *
   * @param sourceType 来源类型
   * @param sourceId 来源项 id
   * @param localDate 本地日历日
   * @returns 形如 `schedule:abc:2024-06-03` 的主键
   */
  private buildId(sourceType: CompletionSourceType, sourceId: string, localDate: string): string {
    return `${sourceType}:${sourceId}:${localDate}`;
  }

  /**
   * 按来源列举完成事件。
   *
   * 说明：用于某课表时段或某习惯的全部完成记录（如习惯历史最长连续天数计算）。
   *
   * @param sourceType 来源类型
   * @param sourceId 来源项 id
   * @returns 该来源的全部完成事件（按 localDate 升序）
   * @throws 无
   */
  async listBySource(sourceType: CompletionSourceType, sourceId: string): Promise<CompletionEvent[]> {
    const all = await this.db.table<CompletionEvent>('completionEvents').toArray();
    return all
      .filter((event) => event.sourceType === sourceType && event.sourceId === sourceId)
      .sort((a, b) => a.localDate.localeCompare(b.localDate));
  }

  /**
   * 按本地日历日闭区间列举完成事件。
   *
   * 说明：用于周 / 月 / 年统计与课表完成率；字符串比较对 `YYYY-MM-DD` 等价于日期先后。
   *
   * @param from 起始日历日（含）
   * @param to 结束日历日（含）
   * @returns 区间内全部完成事件（按 localDate 升序）
   * @throws 无
   */
  async listByDateRange(from: string, to: string): Promise<CompletionEvent[]> {
    const all = await this.db.table<CompletionEvent>('completionEvents').toArray();
    return all
      .filter((event) => event.localDate >= from && event.localDate <= to)
      .sort((a, b) => a.localDate.localeCompare(b.localDate));
  }

  /**
   * 切换某来源在某天的完成状态（幂等）。
   *
   * 说明：已存在则删除（取消完成），不存在则新增（完成）；返回切换后是否处于「已完成」。
   * 课表项（B-02）与习惯（C-01）打卡都调用本方法，记录 `sourceType` 区分来源。
   *
   * @param sourceType 来源类型
   * @param sourceId 来源项 id
   * @param localDate 本地日历日
   * @returns 切换后是否已完成（true=刚完成，false=刚取消）
   * @throws 无
   */
  async toggle(sourceType: CompletionSourceType, sourceId: string, localDate: string): Promise<boolean> {
    const id = this.buildId(sourceType, sourceId, localDate);
    const table = this.db.table<CompletionEvent>('completionEvents');
    const existing = await table.get(id);
    if (existing) {
      await table.delete(id);
      return false;
    }
    const event: CompletionEvent = {
      id,
      sourceType,
      sourceId,
      localDate,
      createdAt: new Date().toISOString(),
    };
    await table.add(event);
    return true;
  }

  /**
   * 判断某来源在某天是否已完成。
   *
   * @param sourceType 来源类型
   * @param sourceId 来源项 id
   * @param localDate 本地日历日
   * @returns 已完成返回 true
   * @throws 无
   */
  async isCompleted(sourceType: CompletionSourceType, sourceId: string, localDate: string): Promise<boolean> {
    const id = this.buildId(sourceType, sourceId, localDate);
    return (await this.db.table<CompletionEvent>('completionEvents').get(id)) !== undefined;
  }

  /**
   * 幂等标记某来源在某天为已完成。
   *
   * 说明：若记录已存在则直接返回既有记录，否则新增并返回。
   *
   * @param sourceType 来源类型
   * @param sourceId 来源项 id
   * @param localDate 本地日历日
   * @param note 可选备注
   * @returns 完成事件记录
   * @throws 无
   */
  async markCompleted(
    sourceType: CompletionSourceType,
    sourceId: string,
    localDate: string,
    note?: string,
  ): Promise<CompletionEvent> {
    const id = this.buildId(sourceType, sourceId, localDate);
    const table = this.db.table<CompletionEvent>('completionEvents');
    const existing = await table.get(id);
    if (existing) {
      return existing;
    }
    const event: CompletionEvent = {
      id,
      sourceType,
      sourceId,
      localDate,
      createdAt: new Date().toISOString(),
      ...(note ? { note } : {}),
    };
    await table.put(event);
    return event;
  }

  /**
   * 幂等取消某来源在某天的完成状态。
   *
   * 说明：若记录存在则删除，不存在则静默成功。
   *
   * @param sourceType 来源类型
   * @param sourceId 来源项 id
   * @param localDate 本地日历日
   * @returns 无
   * @throws 无
   */
  async unmarkCompleted(
    sourceType: CompletionSourceType,
    sourceId: string,
    localDate: string,
  ): Promise<void> {
    const id = this.buildId(sourceType, sourceId, localDate);
    await this.db.table<CompletionEvent>('completionEvents').delete(id);
  }

  /**
   * 删除某来源的全部完成事件（来源被删除时级联清理）。
   *
   * @param sourceType 来源类型
   * @param sourceId 来源项 id
   * @returns 无
   * @throws 无
   */
  async deleteBySource(sourceType: CompletionSourceType, sourceId: string): Promise<void> {
    const all = await this.db.table<CompletionEvent>('completionEvents').toArray();
    const table = this.db.table<CompletionEvent>('completionEvents');
    for (const event of all) {
      if (event.sourceType === sourceType && event.sourceId === sourceId) {
        await table.delete(event.id);
      }
    }
  }
}
