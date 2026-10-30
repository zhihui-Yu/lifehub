/**
 * JSON 序列化辅助。
 *
 * 架构位置：core 包的最底层工具模块。
 *
 * 为什么需要它：`PlainStore` 把保险库参数与恢复码元数据以 JSON 文本落盘，
 * 而这些结构里含有 `Uint8Array`（盐值、IV、密文、认证标签）。
 * 标准的 `JSON.stringify` 会把 `Uint8Array` 变成 `{"0":1,"1":2}` 这样的普通对象，
 * 读回来时**不再是** `Uint8Array`，导致解密链路直接断裂。
 *
 * 这里的方案是用一个带标记的包装对象承载二进制：
 * `{"__bytes__": "<base64>"}`，读回时还原为 `Uint8Array`。
 */
import { fromBase64, toBase64 } from './bytes';

/** 二进制字段的标记键。 */
const BYTES_MARKER = '__bytes__';

/**
 * 把任意值序列化为 JSON 文本，其中 `Uint8Array` 会被标记编码。
 *
 * @param value 待序列化的值
 * @returns JSON 文本
 */
export function stringifyWithBytes(value: unknown): string {
  return JSON.stringify(value, (_key, current: unknown) => {
    if (current instanceof Uint8Array) {
      return { [BYTES_MARKER]: toBase64(current) };
    }
    return current;
  });
}

/**
 * 把 JSON 文本反序列化为对象，其中带标记的字段会还原为 `Uint8Array`。
 *
 * @param text JSON 文本
 * @returns 反序列化后的对象
 * @throws {Error} JSON 非法
 */
export function parseWithBytes(text: string): unknown {
  return JSON.parse(text, (_key, current: unknown) => {
    if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
      const marker = (current as Record<string, unknown>)[BYTES_MARKER];
      if (typeof marker === 'string' && Object.keys(current).length === 1) {
        return fromBase64(marker);
      }
    }
    return current;
  });
}
