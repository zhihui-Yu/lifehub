/**
 * 指纹计算：文件哈希、表头签名与账单指纹。
 *
 * 架构位置：core 包「规则」模块，服务于 A-12（去重与幂等导入）与 A-13（模板自动匹配）。
 */
import type { Bill } from '../models/bill';
import type { CryptoProvider } from '../crypto/provider';
import { sha256Hex } from '../utils/hash';
import { utf8Encode } from '../utils/bytes';

/**
 * 计算文件内容的 sha256 hex。
 *
 * 说明：用于导入幂等判定——同一文件重复导入时提示「该文件已导入过（时间戳）」（A-12 ②）。
 *
 * @param provider 密码学能力端口
 * @param bytes 文件字节数组
 * @returns sha256 hex 字符串
 */
export async function computeFileHash(provider: CryptoProvider, bytes: Uint8Array): Promise<string> {
  return sha256Hex(provider, bytes);
}

/**
 * 归一化表头行并生成签名。
 *
 * 说明：去空白 + 转小写 + 用 '|' 连接，容忍导出工具的空格与大小写差异。
 *
 * @param headers 表头单元格
 * @returns 归一化后的表头文本
 */
export function normalizeHeaders(headers: readonly string[]): string {
  return headers.map((header) => header.trim().toLowerCase()).join('|');
}

/**
 * 计算账单内容指纹。
 *
 * 说明：指纹 = `localDate | amountMinor | counterparty | currency`。
 * 选择这四个字段是因为它们共同刻画了「同一笔交易」，
 * 且都是账单导出中稳定不变的字段；加入 `direction` 会导致
 * 「同一笔交易在不同平台导出方向表示不同」时被判为两条。
 *
 * @param bill 账单实体
 * @returns 指纹字符串
 */
export function computeBillFingerprint(bill: Bill): string {
  return [bill.localDate, bill.amountMinor, bill.counterparty.trim(), bill.currency].join('|');
}
