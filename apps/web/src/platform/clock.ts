/**
 * 系统时钟实现。
 *
 * 架构位置：apps/web 的「平台适配」层，实现 core 的 `Clock` 端口。
 */
import type { Clock } from '@lifehub/core';

/**
 * 基于 `Date` 的系统时钟。
 */
export class SystemClock implements Clock {
  /**
   * 取当前时刻。
   *
   * @returns 当前时间的 Date 实例
   */
  now(): Date {
    return new Date();
  }

  /**
   * 取当前时刻的 ISO 8601 UTC 字符串。
   *
   * @returns 形如 '2024-06-03T08:12:00.000Z' 的字符串
   */
  nowIso(): string {
    return new Date().toISOString();
  }
}

/**
 * 创建系统时钟。
 *
 * @returns `Clock` 实例
 */
export function createClock(): Clock {
  return new SystemClock();
}
