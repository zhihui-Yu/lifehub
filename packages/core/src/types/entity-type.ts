/**
 * 实体类型与索引列白名单。
 *
 * 架构位置：core 包的类型叶子模块。它定义了「哪些实体可以以明文形式落盘」，
 * 是系统设计 §1.2 难点 7（索引明文列取舍）与 §1.4 规则 4（加密写入口唯一化）的类型基础。
 */

/**
 * 实体类型枚举。
 *
 * 前 9 项为本轮 Sprint 0 实际落地；其余为后续阶段的预留位（系统设计 §5 假设 A-13），
 * 仅保留类型定义与枚举位，本轮不实现业务逻辑。
 */
export const ENTITY_TYPES = [
  'bill',
  'category',
  'ruleTemplate',
  'importBatch',
  'auditLog',
  'vaultParams',
  'recoveryMeta',
  'appSettings',
  'encryptedBlob',
  'syncBase',
  'rotationState',
  'scheduleSlot',
  'habit',
  'habitCheckIn',
  'completionEvent',
  'diaryEntry',
  'aiAnalysisRequest',
] as const;

/** 实体类型字面量联合类型。 */
export type EntityType = (typeof ENTITY_TYPES)[number];

/**
 * 允许以**明文**形式落盘的实体类型白名单。
 *
 * 取值依据：系统设计 §1.4 规则 4 —— 只有这三类实体本身不含明文密钥，
 * 且解锁前就需要读取（时区 / 主题 / 保险库参数 / 恢复码元数据）。
 */
export const PLAIN_ENTITY_TYPES = ['vaultParams', 'recoveryMeta', 'appSettings'] as const;

/** 明文实体类型联合类型。 */
export type PlainEntityType = (typeof PLAIN_ENTITY_TYPES)[number];

/**
 * 可作为明文索引列的字段名白名单。
 *
 * 取值依据：系统设计 §1.2 难点 7 —— 仅暴露用于范围查询与排序的最小字段集，
 * **不含**金额、方向、对方、备注、分类等业务语义。
 */
export const INDEX_COLUMNS = [
  'entityType',
  'localDate',
  'occurredAt',
  'createdAt',
  'updatedAt',
  'version',
  'deviceId',
] as const;

/** 索引列名联合类型。 */
export type IndexColumn = (typeof INDEX_COLUMNS)[number];

/**
 * 类型守卫：判断未知值是否为合法实体类型。
 *
 * @param value 待判定的未知值
 * @returns 是合法实体类型时返回 true
 */
export function isEntityType(value: unknown): value is EntityType {
  return typeof value === 'string' && (ENTITY_TYPES as readonly string[]).includes(value);
}

/**
 * 类型守卫：判断未知值是否为允许明文落盘的实体类型。
 *
 * @param value 待判定的未知值
 * @returns 是明文实体类型时返回 true
 */
export function isPlainEntityType(value: unknown): value is PlainEntityType {
  return typeof value === 'string' && (PLAIN_ENTITY_TYPES as readonly string[]).includes(value);
}

/**
 * 类型守卫：判断未知值是否为合法索引列名。
 *
 * @param value 待判定的未知值
 * @returns 是合法索引列时返回 true
 */
export function isIndexColumn(value: unknown): value is IndexColumn {
  return typeof value === 'string' && (INDEX_COLUMNS as readonly string[]).includes(value);
}
