/**
 * 异步工具。
 *
 * 架构位置：core 包的最底层工具模块。
 */

import { LifeHubError } from '../errors';

/**
 * 让出当前执行流，使 UI 有机会刷新。
 *
 * 说明：10 万行导入时，每处理一批就让出一次主线程，避免界面卡死（NF-P-1）。
 *
 * @returns Promise，在下一个宏任务后 resolve
 */
export function yieldToMainThread(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * 把数组按固定大小分批。
 *
 * 说明：导入时每 1000 条写一次库，避免单次事务过大。
 *
 * @param items 待分批的数组
 * @param size 每批大小，必须 ≥ 1
 * @returns 批次数组的数组
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 批大小不是不小于 1 的整数
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '批大小必须是不小于 1 的整数');
  }
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

/**
 * 生成异步迭代的数值序列。
 *
 * @param count 序列长度
 * @returns 异步迭代器
 */
export async function* range(count: number): AsyncGenerator<number> {
  for (let index = 0; index < count; index += 1) {
    yield index;
  }
}
