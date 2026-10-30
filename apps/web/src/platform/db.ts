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
