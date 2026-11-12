/**
 * Dexie 数据库 schema 与索引定义。
 *
 * 架构位置：apps/web 的「平台适配」层，是 IndexedDB 的唯一入口。
 *
 * 索引设计（对应 §3.2.2 StorageQuery）：
 * - 主键 `id`；
 * - `entityType` 单列索引：按实体类型过滤；
 * - `[entityType+localDate]` 复合索引：**按 localDate 范围查询**（X-09 ③）的关键；
 * - `[entityType+occurredAt]` 复合索引：按 UTC 时间戳排序。
 *
 * 红线：本地表只存**密文载荷 + 最小索引明文列**，
 * 不含金额、方向、对方、备注、分类等业务语义（ADR-006）。
 */
import Dexie, { type EntityTable } from 'dexie';
import type { StoredRecord } from '@lifehub/core';

/**
 * Dexie 数据库实例。
 *
 * 说明：`version(1).stores(...)` 声明表与索引；
 * 后续如需变更结构，用 `version(2).stores(...)` 追加迁移，
 * **不得**修改已发布版本的索引定义（会导致用户数据不可读）。
 *
 * 课表 / 习惯（S4）为本地明文功能，按现有模式在 `version(2)` 追加四张明文表，
 * 不复用 `records`（密文）表，也不另起 Dexie 实例——
 * `LifeHubDatabase` 仍是全应用唯一的数据库入口。
 */
export class LifeHubDatabase extends Dexie {
  /** 记录表：所有实体的密文记录。 */
  records!: EntityTable<StoredRecord, 'id'>;

  /**
   * 构造数据库实例。
   *
   * @param name 数据库名，默认 'lifehub'
   */
  constructor(name = 'lifehub') {
    super(name);
    this.version(1).stores({
      records:
        'id, entityType, localDate, occurredAt, createdAt, updatedAt, version, deviceId, ' +
        '[entityType+localDate], [entityType+occurredAt], [entityType+updatedAt]',
    });
    // S4：课表与习惯的本地明文表（PRD §S4）。
    // 仅追加，不动 version(1) 的任何索引；索引只用于排序 / 潜在过滤，查询仍以 toArray 后在内存过滤为主。
    this.version(2).stores({
      // 课表时段：dayOfWeek 0-6（仅周循环时段用），rrule 为 RFC 5545 子集字符串。
      scheduleSlots: 'id, dayOfWeek, rrule, createdAt',
      // 习惯定义。
      habits: 'id, createdAt',
      // 习惯打卡记录。
      habitCheckIns: 'id, habitId, localDate',
      // 课表 / 习惯共用的完成事件（唯一来源）。
      completionEvents: 'id, sourceType, sourceId, localDate',
    });
    // 模块 E：AI 分析请求审计指标表与本地加密配置表（仅存 SHA-256 摘要/指标与 AES-GCM 密文密钥，严禁存明文 Prompt/响应/明文 Key）。
    this.version(3).stores({
      aiAnalysisRequests: 'id, createdAt, provider, status',
      aiSettings: 'id',
    });
    // 模块 D：树洞日记表（D-01：标题、正文、标签、心情均通过 AES-GCM 加密后写入 ciphertext，AAD 绑定条目 id，表内不存明文内容）。
    this.version(4).stores({
      diaryEntries: 'id, localDate, isPinned, createdAt, updatedAt',
    });
  }
}

/**
 * 创建数据库实例。
 *
 * @param name 数据库名，默认 'lifehub'
 * @returns 数据库实例
 */
export function createDatabase(name = 'lifehub'): LifeHubDatabase {
  return new LifeHubDatabase(name);
}
