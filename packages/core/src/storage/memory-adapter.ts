/**
 * 内存存储适配器（测试替身）。
 *
 * 架构位置：core 包的「适配器」层，实现 `StorageAdapter` 端口。
 *
 * 说明：用于 core 包的单元 / 集成测试，使测试无需浏览器环境；
 * 同时也是 `packages/core` 零 DOM 依赖的体现——测试全部在 Node 环境跑。
 */
import { LifeHubError } from '../errors';
import type { EntityType } from '../types/entity-type';
import type { StorageAdapter, StorageQueryLike } from './adapter';
import type { StoredRecord } from '../models/common';

/**
 * 内存版存储适配器。
 *
 * 说明：以 `entityType -> Map<id, record>` 组织数据，
 * 查询时在内存里完成过滤、排序与分页，语义与真实实现保持一致。
 */
export class MemoryStorageAdapter implements StorageAdapter {
  /** 各实体类型的记录集合。 */
  private readonly tables = new Map<EntityType, Map<string, StoredRecord>>();

  /** 是否已打开。 */
  private opened = false;

  /**
   * 构造内存适配器。
   */
  constructor() {
    // 无需预建表，put 时按需创建。
  }

  /**
   * 打开存储。
   *
   * @returns 无异常
   */
  async open(): Promise<void> {
    this.opened = true;
  }

  /**
   * 关闭存储。
   *
   * @returns 无异常
   */
  async close(): Promise<void> {
    this.opened = false;
  }

  /**
   * 按 id 取单条记录。
   *
   * @param entityType 实体类型
   * @param id 实体 id
   * @returns 记录；不存在返回 null
   */
  async get(entityType: EntityType, id: string): Promise<StoredRecord | null> {
    return this.tables.get(entityType)?.get(id) ?? null;
  }

  /**
   * 批量取记录。
   *
   * @param entityType 实体类型
   * @param ids 实体 id 列表
   * @returns 命中的记录列表
   */
  async getMany(entityType: EntityType, ids: readonly string[]): Promise<StoredRecord[]> {
    const table = this.tables.get(entityType);
    if (!table) {
      return [];
    }
    const out: StoredRecord[] = [];
    for (const id of ids) {
      const record = table.get(id);
      if (record) {
        out.push(record);
      }
    }
    return out;
  }

  /**
   * 条件查询。
   *
   * @param entityType 实体类型
   * @param filter 查询条件
   * @returns 命中的记录列表
   */
  async query(entityType: EntityType, filter?: StorageQueryLike): Promise<StoredRecord[]> {
    const table = this.tables.get(entityType);
    if (!table) {
      return [];
    }
    let records = [...table.values()];

    // 等值条件：只允许索引明文列。
    if (filter?.where) {
      for (const [column, expected] of Object.entries(filter.where)) {
        if (expected === undefined) {
          continue;
        }
        records = records.filter((record) => readIndexColumn(record, column) === expected);
      }
    }

    // localDate 闭区间过滤。
    if (filter?.localDateFrom) {
      records = records.filter(
        (record) => record.localDate !== null && record.localDate >= filter.localDateFrom!,
      );
    }
    if (filter?.localDateTo) {
      records = records.filter((record) => record.localDate !== null && record.localDate <= filter.localDateTo!);
    }

    // 排序。
    if (filter?.orderBy) {
      const { column, direction } = filter.orderBy;
      const factor = direction === 'desc' ? -1 : 1;
      records.sort((a, b) => {
        const left = readIndexColumn(a, column);
        const right = readIndexColumn(b, column);
        if (left === right) {
          return 0;
        }
        if (left === null || left === undefined) {
          return 1;
        }
        if (right === null || right === undefined) {
          return -1;
        }
        return (left < right ? -1 : 1) * factor;
      });
    }

    // 分页。
    const offset = filter?.offset ?? 0;
    const limit = filter?.limit;
    const sliced = limit === undefined ? records.slice(offset) : records.slice(offset, offset + limit);
    return sliced;
  }

  /**
   * 写入单条记录。
   *
   * @param entityType 实体类型
   * @param record 待写入的记录
   * @returns 无异常
   * @throws {LifeHubError} `LIFEHUB_E_STORAGE` —— 记录与实体类型不匹配
   */
  async put(entityType: EntityType, record: StoredRecord): Promise<void> {
    if (record.entityType !== entityType) {
      throw new LifeHubError('LIFEHUB_E_STORAGE', '记录类型与目标表不一致');
    }
    let table = this.tables.get(entityType);
    if (!table) {
      table = new Map<string, StoredRecord>();
      this.tables.set(entityType, table);
    }
    table.set(record.id, record);
  }

  /**
   * 批量写入记录。
   *
   * @param entityType 实体类型
   * @param records 待写入的记录列表
   * @returns 无异常
   */
  async putMany(entityType: EntityType, records: readonly StoredRecord[]): Promise<void> {
    for (const record of records) {
      await this.put(entityType, record);
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
    this.tables.get(entityType)?.delete(id);
  }

  /**
   * 批量删除记录。
   *
   * @param entityType 实体类型
   * @param ids 实体 id 列表
   * @returns 无异常
   */
  async deleteMany(entityType: EntityType, ids: readonly string[]): Promise<void> {
    const table = this.tables.get(entityType);
    if (!table) {
      return;
    }
    for (const id of ids) {
      table.delete(id);
    }
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
    this.tables.get(entityType)?.clear();
  }

  /**
   * 列出全部实体类型（测试辅助）。
   *
   * @returns 实体类型列表
   */
  listEntityTypes(): EntityType[] {
    return [...this.tables.keys()];
  }

  /**
   * 当前是否已打开（测试辅助）。
   *
   * @returns 已打开返回 true
   */
  isOpen(): boolean {
    return this.opened;
  }
}

/**
 * 读取记录上的索引明文列值。
 *
 * @param record 存储记录
 * @param column 索引列名
 * @returns 索引列的值
 */
function readIndexColumn(record: StoredRecord, column: string): string | number | boolean | null | undefined {
  switch (column) {
    case 'entityType':
      return record.entityType;
    case 'localDate':
      return record.localDate;
    case 'occurredAt':
      return record.occurredAt;
    case 'createdAt':
      return record.createdAt;
    case 'updatedAt':
      return record.updatedAt;
    case 'version':
      return record.version;
    case 'deviceId':
      return record.deviceId;
    default:
      return undefined;
  }
}
