/**
 * IndexedDB 存储适配器（Dexie 实现）。
 *
 * 架构位置：apps/web 的「平台适配」层，实现 core 的 `StorageAdapter` 端口。
 *
 * 说明：Dexie 只出现在 apps/web，核心层不感知它（系统设计 §1.3）。
 *
 * 查询实现要点：Dexie 的 `orderBy` 只存在于 `Table` / `Index` 上，
 * 因此排序需要从 `[entityType+xxx]` 复合索引起步，
 * 其余过滤条件再用 `.and()` 叠加（保证结果仍是可链式查询的 Collection）。
 */
import { LifeHubError } from '@lifehub/core';
import type { EntityType, StorageAdapter, StorageQueryLike, StoredRecord } from '@lifehub/core';
import type { LifeHubDatabase } from './db';

/** Dexie 集合类型。 */
type RecordCollection = ReturnType<LifeHubDatabase['records']['where']>;

/**
 * 复合索引视图。
 *
 * 说明：Dexie 的 `Table.orderBy()` 对复合索引返回的是 `Index`（带 `equals()`），
 * 但 TypeScript 无法从字符串形式的索引名推断出这一点，因此这里声明一个最小结构类型。
 */
interface CompoundIndexLike {
  /** 按复合索引的首段做等值匹配。 */
  equals(value: string): RecordCollection;
}

/** 具备 `[entityType+xxx]` 复合索引的列。 */
const COMPOUND_INDEX_COLUMNS: readonly string[] = ['localDate', 'occurredAt', 'updatedAt'];

/**
 * 基于 Dexie / IndexedDB 的存储适配器。
 */
export class DexieStorageAdapter implements StorageAdapter {
  /** Dexie 数据库实例。 */
  private readonly db: LifeHubDatabase;

  /**
   * 构造 Dexie 存储适配器。
   *
   * @param db Dexie 数据库实例
   */
  constructor(db: LifeHubDatabase) {
    this.db = db;
  }

  /**
   * 打开数据库。
   *
   * @returns 无异常
   * @throws {LifeHubError} `LIFEHUB_E_STORAGE` —— 打开失败
   */
  async open(): Promise<void> {
    try {
      await this.db.open();
    } catch {
      throw new LifeHubError('LIFEHUB_E_STORAGE', '无法打开本地数据库');
    }
  }

  /**
   * 关闭数据库。
   *
   * @returns 无异常
   */
  async close(): Promise<void> {
    this.db.close();
  }

  /**
   * 按 id 取单条记录。
   *
   * @param entityType 实体类型
   * @param id 实体 id
   * @returns 记录；不存在返回 null
   */
  async get(entityType: EntityType, id: string): Promise<StoredRecord | null> {
    const record = await this.db.records.get(id);
    if (!record || record.entityType !== entityType) {
      return null;
    }
    return record;
  }

  /**
   * 批量取记录。
   *
   * @param entityType 实体类型
   * @param ids 实体 id 列表
   * @returns 命中的记录列表
   */
  async getMany(entityType: EntityType, ids: readonly string[]): Promise<StoredRecord[]> {
    if (ids.length === 0) {
      return [];
    }
    const records = await this.db.records.bulkGet([...ids]);
    const out: StoredRecord[] = [];
    for (const record of records) {
      if (record && record.entityType === entityType) {
        out.push(record);
      }
    }
    return out;
  }

  /**
   * 条件查询。
   *
   * 说明：范围过滤与排序全部走**索引明文列**，只有返回的页内记录才会被上层解密。
   *
   * @param entityType 实体类型
   * @param filter 查询条件
   * @returns 命中的记录列表
   */
  async query(entityType: EntityType, filter?: StorageQueryLike): Promise<StoredRecord[]> {
    const orderColumn = filter?.orderBy?.column;
    const direction = filter?.orderBy?.direction === 'desc' ? 'desc' : 'asc';

    // 排序：优先使用与 entityType 组合的复合索引（[entityType+localDate] 等）。
    let collection: RecordCollection;
    if (orderColumn && COMPOUND_INDEX_COLUMNS.includes(orderColumn)) {
      const index = this.db.records.orderBy(`[entityType+${orderColumn}]` as never) as unknown as CompoundIndexLike;
      collection = index.equals(entityType);
      if (direction === 'desc') {
        collection = collection.reverse();
      }
    } else {
      // 没有对应复合索引的列（如 createdAt / version / deviceId）走主索引查询，
      // 排序交由上层在内存中完成（这些列不是列表页的默认排序键）。
      collection = this.db.records.where('entityType').equals(entityType);
    }

    // 等值条件：只允许索引明文列。
    const predicates: ((record: StoredRecord) => boolean)[] = [];
    if (filter?.where) {
      for (const [column, expected] of Object.entries(filter.where)) {
        if (expected === undefined || column === 'entityType') {
          continue;
        }
        predicates.push((record) => {
          const actual = (record as unknown as Record<string, unknown>)[column];
          if (expected === null) {
            return actual === null || actual === undefined;
          }
          if (typeof expected === 'boolean') {
            return Boolean(actual) === expected;
          }
          return String(actual ?? '') === String(expected);
        });
      }
    }

    // localDate 闭区间。
    if (filter?.localDateFrom !== undefined) {
      const from = filter.localDateFrom;
      predicates.push((record) => record.localDate !== null && record.localDate >= from);
    }
    if (filter?.localDateTo !== undefined) {
      const to = filter.localDateTo;
      predicates.push((record) => record.localDate !== null && record.localDate <= to);
    }

    if (predicates.length > 0) {
      collection = collection.and((record) => predicates.every((predicate) => predicate(record)));
    }

    if (filter?.offset !== undefined) {
      collection = collection.offset(filter.offset);
    }
    if (filter?.limit !== undefined) {
      collection = collection.limit(filter.limit);
    }

    return collection.toArray();
  }

  /**
   * 写入单条记录。
   *
   * @param entityType 实体类型
   * @param record 待写入的记录
   * @returns 无异常
   * @throws {LifeHubError} `LIFEHUB_E_STORAGE` —— 记录类型不匹配或写入失败
   */
  async put(entityType: EntityType, record: StoredRecord): Promise<void> {
    if (record.entityType !== entityType) {
      throw new LifeHubError('LIFEHUB_E_STORAGE', '记录类型与目标表不一致');
    }
    try {
      await this.db.records.put(record);
    } catch {
      throw new LifeHubError('LIFEHUB_E_STORAGE', '写入本地数据失败');
    }
  }

  /**
   * 批量写入记录。
   *
   * @param entityType 实体类型
   * @param records 待写入的记录列表
   * @returns 无异常
   */
  async putMany(entityType: EntityType, records: readonly StoredRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }
    try {
      await this.db.records.bulkPut([...records]);
    } catch {
      throw new LifeHubError('LIFEHUB_E_STORAGE', '批量写入本地数据失败');
    }
  }

  /**
   * 删除单条记录。
   *
   * @param entityType 实体类型
   * @param id 实体 id
   * @returns 无异常
   */
  async delete(entityType: EntityType, id: string): Promise<void> {
    const record = await this.db.records.get(id);
    if (record && record.entityType !== entityType) {
      return;
    }
    await this.db.records.delete(id);
  }

  /**
   * 批量删除记录。
   *
   * @param entityType 实体类型
   * @param ids 实体 id 列表
   * @returns 无异常
   */
  async deleteMany(entityType: EntityType, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const records = await this.db.records.bulkGet([...ids]);
    const targets: string[] = [];
    for (const record of records) {
      if (record && record.entityType === entityType) {
        targets.push(record.id);
      }
    }
    await this.db.records.bulkDelete(targets);
  }

  /**
   * 统计符合条件的记录数。
   *
   * @param entityType 实体类型
   * @param filter 查询条件
   * @returns 记录数
   */
  async count(entityType: EntityType, filter?: StorageQueryLike): Promise<number> {
    return (await this.query(entityType, filter)).length;
  }

  /**
   * 清空某类实体。
   *
   * @param entityType 实体类型
   * @returns 无异常
   */
  async clear(entityType: EntityType): Promise<void> {
    const records = await this.db.records.where('entityType').equals(entityType).toArray();
    await this.db.records.bulkDelete(records.map((record) => record.id));
  }
}
