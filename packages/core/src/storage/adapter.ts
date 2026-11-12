/**
 * 本地存储端口（Port）。
 *
 * 架构位置：core 包的「端口」层。核心层只依赖此接口，**不感知 IndexedDB / SQLite / Dexie**。
 *
 * 实现方：
 * - `DexieStorageAdapter`（apps/web，基于 IndexedDB）
 * - `MemoryStorageAdapter`（packages/core，测试替身）
 *
 * 落盘形态约束（架构红线 R4）：业务实体一律以**密文 payload** 写入；
 * 本接口本身不提供任何明文业务写入口。
 */
import type { EntityType, IndexColumn } from '../types/entity-type';
import type { StoredRecord } from '../models/common';

export type { IndexColumn } from '../types/entity-type';
export type { PlainPayload, StoredRecord } from '../models/common';

/**
 * 本地存储端口。
 *
 * 说明：所有方法在失败时应抛出 `LifeHubError`（错误码 `LIFEHUB_E_STORAGE`）。
 */
export interface StorageAdapter {
  /**
   * 打开底层存储（建立连接 / 建表）。
   *
   * @returns 无异常
   */
  open(): Promise<void>;

  /**
   * 关闭底层存储。
   *
   * @returns 无异常
   */
  close(): Promise<void>;

  /**
   * 按 id 取单条记录。
   *
   * @param entityType 实体类型
   * @param id 实体 id
   * @returns 记录；不存在返回 null
   */
  get(entityType: EntityType, id: string): Promise<StoredRecord | null>;

  /**
   * 批量取记录（用于列表页分页拉取解密）。
   *
   * @param entityType 实体类型
   * @param ids 实体 id 列表
   * @returns 命中的记录列表（可能少于请求数）
   */
  getMany(entityType: EntityType, ids: readonly string[]): Promise<StoredRecord[]>;

  /**
   * 条件查询：支持索引明文列过滤、localDate 范围、按索引列排序、分页。
   *
   * @param entityType 实体类型
   * @param filter 查询条件
   * @returns 命中的记录列表
   */
  query(entityType: EntityType, filter?: StorageQueryLike): Promise<StoredRecord[]>;

  /**
   * 写入单条记录（同 id 为 upsert 语义）。
   *
   * @param entityType 实体类型
   * @param record 待写入的记录
   * @returns 无异常
   */
  put(entityType: EntityType, record: StoredRecord): Promise<void>;

  /**
   * 批量写入记录（同 id 为 upsert 语义）。
   *
   * @param entityType 实体类型
   * @param records 待写入的记录列表
   * @returns 无异常
   */
  putMany(entityType: EntityType, records: readonly StoredRecord[]): Promise<void>;

  /**
   * 删除单条记录。
   *
   * @param entityType 实体类型
   * @param id 实体 id
   * @returns 无异常
   */
  delete(entityType: EntityType, id: string): Promise<void>;

  /**
   * 批量删除记录。
   *
   * @param entityType 实体类型
   * @param ids 实体 id 列表
   * @returns 无异常
   */
  deleteMany(entityType: EntityType, ids: readonly string[]): Promise<void>;

  /**
   * 统计符合条件的记录数。
   *
   * @param entityType 实体类型
   * @param filter 查询条件
   * @returns 记录数
   */
  count(entityType: EntityType, filter?: StorageQueryLike): Promise<number>;

  /**
   * 清空某类实体（用于「清空本地数据」，需 UI 二次确认）。
   *
   * @param entityType 实体类型
   * @returns 无异常
   */
  clear(entityType: EntityType): Promise<void>;
}

/**
 * 存储层查询条件。
 *
 * 说明：`where` 只允许索引明文列；语义过滤（关键词 / 方向 / 分类）在解密后于内存中进行
 * （系统设计 §5 假设 A-8）。
 */
export interface StorageQueryLike {
  /** 等值条件，仅允许索引列。 */
  where?: Partial<Record<IndexColumn, string | number | boolean | null>>;
  /** localDate 闭区间起点 'YYYY-MM-DD'。 */
  localDateFrom?: string;
  /** localDate 闭区间终点 'YYYY-MM-DD'。 */
  localDateTo?: string;
  /** 排序列与方向。 */
  orderBy?: { column: IndexColumn; direction: 'asc' | 'desc' };
  /** 返回条数上限。 */
  limit?: number;
  /** 跳过的条数。 */
  offset?: number;
}
