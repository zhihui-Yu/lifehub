/**
 * 运行时类型守卫。
 *
 * 架构位置：core 包的最底层工具模块。
 * 说明：外部输入（CSV 单元格、JSON、剪贴板）一律先当 `unknown`，再用本模块收窄
 * （系统设计 §8.4 类型纪律）。
 */
import { DIRECTIONS, Direction } from '../models/bill';
import { ENTITY_TYPES, EntityType } from '../types/entity-type';
import type { EncryptedPayload, PlainPayload, StoredRecord } from '../models/common';

/**
 * 判断未知值是否为合法方向。
 *
 * @param value 待判定的未知值
 * @returns 合法方向返回 true
 */
export function isDirection(value: unknown): value is Direction {
  return typeof value === 'string' && (DIRECTIONS as readonly string[]).includes(value);
}

/**
 * 判断未知值是否为合法实体类型。
 *
 * @param value 待判定的未知值
 * @returns 合法实体类型返回 true
 */
export function isEntityType(value: unknown): value is EntityType {
  return typeof value === 'string' && (ENTITY_TYPES as readonly string[]).includes(value);
}

/**
 * 判断未知值是否为加密载荷。
 *
 * @param value 待判定的未知值
 * @returns 是加密载荷返回 true
 */
export function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate['kind'] === 'encrypted' &&
    candidate['algorithm'] === 'AES-256-GCM' &&
    candidate['iv'] instanceof Uint8Array &&
    candidate['ciphertext'] instanceof Uint8Array &&
    candidate['tag'] instanceof Uint8Array &&
    typeof candidate['keyVersion'] === 'number'
  );
}

/**
 * 判断未知值是否为明文载荷。
 *
 * @param value 待判定的未知值
 * @returns 是明文载荷返回 true
 */
export function isPlainPayload(value: unknown): value is PlainPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate['kind'] === 'plain' && typeof candidate['json'] === 'string';
}

/**
 * 判断未知值是否为合法的存储记录。
 *
 * @param value 待判定的未知值
 * @returns 是存储记录返回 true
 */
export function isStoredRecord(value: unknown): value is StoredRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['id'] === 'string' &&
    isEntityType(candidate['entityType']) &&
    typeof candidate['version'] === 'number' &&
    typeof candidate['createdAt'] === 'string' &&
    typeof candidate['updatedAt'] === 'string' &&
    typeof candidate['deviceId'] === 'string' &&
    (candidate['localDate'] === null || typeof candidate['localDate'] === 'string') &&
    (candidate['occurredAt'] === null || typeof candidate['occurredAt'] === 'string') &&
    (isEncryptedPayload(candidate['payload']) || isPlainPayload(candidate['payload']))
  );
}

/**
 * 判断未知值是否为非空字符串。
 *
 * @param value 待判定的未知值
 * @returns 是非空字符串返回 true
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * 把未知值安全地转成字符串。
 *
 * 说明：用于 CSV 单元格等「一切皆文本」的输入。
 *
 * @param value 待转换的未知值
 * @returns 字符串；null / undefined 返回空串
 */
export function asText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return String(value);
}
