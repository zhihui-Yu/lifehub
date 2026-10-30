/**
 * UUIDv7 生成器。
 *
 * 架构位置：core 包的最底层工具模块。
 * 说明：实现放在 `hash.ts` 中以避免重复的随机源逻辑，此文件提供语义化的入口。
 */
import { uuidV7 as generate } from './hash';
import { LifeHubError } from '../errors';

/**
 * 生成一个 UUIDv7 标识符。
 *
 * 说明：UUIDv7 前 48 位是毫秒时间戳，因此生成的 id **按时间递增**，
 * 这对分页查询与「同毫秒内插入不乱序」非常关键。
 *
 * @param randomBytes 随机字节源，默认使用平台密码学随机源
 * @param timestamp 毫秒时间戳，默认取当前时间
 * @returns UUIDv7 字符串
 */
export function uuidV7(
  randomBytes?: (length: number) => Uint8Array,
  timestamp?: number,
): string {
  if (randomBytes) {
    return generate(randomBytes, timestamp);
  }
  return generate(defaultRandomSource(), timestamp);
}

/**
 * 默认随机字节源：优先使用 globalThis 的密码学随机源。
 *
 * @returns 随机字节源函数
 */
function defaultRandomSource(): (length: number) => Uint8Array {
  const scope = globalThis as unknown as {
    crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array };
  };
  const source = scope.crypto?.getRandomValues;
  if (!source) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '当前环境没有可用的密码学随机源');
  }
  // 绑定 this：某些实现要求调用者是 crypto 对象本身。
  const bound = source.bind(scope.crypto);
  return (length: number): Uint8Array => bound(new Uint8Array(length));
}
