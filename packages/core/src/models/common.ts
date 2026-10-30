/**
 * 共享值对象。
 *
 * 架构位置：core 包的「值对象」模块，承载跨实体复用的载荷与存储记录结构。
 * 这些结构是存储层与加密层的契约边界，被 storage / repositories / services 共用。
 */
import type { EntityType, IndexColumn } from '../types/entity-type';

/**
 * 加密载荷。
 *
 * 说明：IV 与 tag 独立存放；WebCrypto 返回的是 `ciphertext || tag` 合并体，
 * 由 provider 实现负责拆分/合并，本接口对上层保持稳定（系统设计 §3.2.1）。
 */
export interface EncryptedPayload {
  /** 载荷种类标记，固定为 'encrypted'。 */
  kind: 'encrypted';
  /** 加密算法，固定为 'AES-256-GCM'。 */
  algorithm: 'AES-256-GCM';
  /** 随机 IV，12 字节。 */
  iv: Uint8Array;
  /** 密文正文。 */
  ciphertext: Uint8Array;
  /** GCM 认证标签，16 字节。 */
  tag: Uint8Array;
  /** 加密时使用的密钥版本。 */
  keyVersion: number;
}

/**
 * 明文载荷。
 *
 * 说明：**仅允许**用于 `vaultParams` / `recoveryMeta` / `appSettings` 三类不含明文密钥的实体
 * （系统设计 §1.4 规则 4）。
 */
export interface PlainPayload {
  /** 载荷种类标记，固定为 'plain'。 */
  kind: 'plain';
  /** 实体序列化后的 JSON 文本。 */
  json: string;
}

/**
 * 存储层记录。
 *
 * 说明：除密文载荷外携带**极小的明文索引列**（entityType / localDate / occurredAt /
 * createdAt / updatedAt / version / deviceId），用于范围查询与排序；
 * **不含**金额、方向、对方、备注、分类等业务语义（ADR-006）。
 */
export interface StoredRecord {
  /** 实体 id。 */
  id: string;
  /** 实体类型。 */
  entityType: EntityType;
  /** 单调递增版本号。 */
  version: number;
  /** 创建时间，ISO 8601 UTC。 */
  createdAt: string;
  /** 最后更新时间，ISO 8601 UTC。 */
  updatedAt: string;
  /** 产生该记录的设备 id。 */
  deviceId: string;
  /** 索引明文列：本地日历日；非日期类实体为 null。 */
  localDate: string | null;
  /** 索引明文列：UTC 时间戳；非时间类实体为 null。 */
  occurredAt: string | null;
  /** 载荷：业务实体为密文，三类白名单实体为明文。 */
  payload: EncryptedPayload | PlainPayload;
}

/**
 * 存储层查询条件。
 *
 * 说明：`where` 只允许索引明文列；语义过滤（关键词 / 方向 / 分类）在解密后于内存中进行
 * （系统设计 §5 假设 A-8）。
 */
export interface StorageQuery {
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
