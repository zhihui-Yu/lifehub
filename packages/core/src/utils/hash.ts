/**
 * 通用哈希与标识工具。
 *
 * 架构位置：core 包的最底层工具模块。
 */
import { toHex } from './bytes';
import type { CryptoProvider } from '../crypto/provider';

/**
 * 计算 SHA-256 摘要并返回 hex 字符串。
 *
 * 说明：委托 `CryptoProvider` 计算，保证与加密层使用同一套平台原生实现，
 * 避免核心层直接触碰 `window.crypto`（架构红线 R1）。
 *
 * @param provider 密码学能力端口
 * @param data 待摘要数据
 * @returns 小写 hex 字符串
 */
export async function sha256Hex(provider: CryptoProvider, data: Uint8Array): Promise<string> {
  return toHex(await provider.sha256(data));
}

/**
 * 取当前时间的毫秒时间戳。
 *
 * 说明：抽出独立函数便于测试注入；不依赖 DOM 的 `performance` API。
 *
 * @returns 毫秒时间戳
 */
export function nowMillis(): number {
  return Date.now();
}

/**
 * 生成 UUIDv7（时间有序的 UUID）。
 *
 * 说明：零依赖实现。前 48 位是毫秒时间戳（保证按时间递增，便于分页与冲突合并），
 * 之后是版本位、随机位与变体位。
 *
 * @param randomBytes 随机字节源（长度至少 10）
 * @param timestamp 毫秒时间戳，默认取当前时间
 * @returns UUIDv7 字符串
 * @throws {Error} 随机源不足或时间戳非法
 */
export function uuidV7(
  randomBytes: (length: number) => Uint8Array,
  timestamp: number = Date.now(),
): string {
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new Error('非法的时间戳');
  }
  const random = randomBytes(10);
  if (random.length < 10) {
    throw new Error('随机源至少需要 10 字节');
  }

  const bytes = new Uint8Array(16);
  // 48 位毫秒时间戳（大端）。
  bytes[0] = Math.floor(timestamp / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(timestamp / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(timestamp / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(timestamp / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(timestamp / 2 ** 8) & 0xff;
  bytes[5] = timestamp & 0xff;
  // 剩余 10 字节随机。
  bytes.set(random.subarray(0, 10), 6);
  // 版本位：0100 0011 → 7（时间有序）。
  bytes[6] = (bytes[6] ?? 0) & 0x0f;
  bytes[6] = (bytes[6] ?? 0) | 0x70;
  // 变体位：10xx。
  bytes[8] = (bytes[8] ?? 0) & 0x3f;
  bytes[8] = (bytes[8] ?? 0) | 0x80;

  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
