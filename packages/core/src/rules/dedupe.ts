/**
 * 去重器。
 *
 * 架构位置：core 包「规则」模块，服务于 A-12（去重与幂等导入）与 A-21（本地清洗与合并）。
 *
 * 两层去重：
 * 1. **文件级**：同一文件的 sha256 相同 → 整个文件不重复导入；
 * 2. **内容级**：账单指纹（`localDate|amountMinor|counterparty|currency`）相同 → 跳过该行。
 */
import type { Bill } from '../models/bill';
import { computeBillFingerprint } from './fingerprint';

/**
 * 去重器。
 */
export class Deduplicator {
  /**
   * 计算账单的指纹。
   *
   * @param bill 账单实体
   * @returns 指纹字符串
   */
  computeFingerprint(bill: Bill): string {
    return computeBillFingerprint(bill);
  }

  /**
   * 判断账单是否已存在。
   *
   * @param bill 待判断的账单
   * @param fingerprints 已存在账单的指纹集合
   * @returns 已存在返回 true
   */
  isDuplicate(bill: Bill, fingerprints: ReadonlySet<string>): boolean {
    return fingerprints.has(this.computeFingerprint(bill));
  }

  /**
   * 合并两条指纹相同的账单。
   *
   * 说明：保留**最早的 createdAt** 与**最新的 updatedAt**，
   * 版本号取两者较大值 + 1，其余字段以 `incoming` 为准
   * （incoming 是本次导入读到的新数据，通常更新）。
   *
   * @param existing 已存在的账单
   * @param incoming 本次读到的账单
   * @returns 合并后的账单
   */
  merge(existing: Bill, incoming: Bill): Bill {
    const createdAt = existing.createdAt <= incoming.createdAt ? existing.createdAt : incoming.createdAt;
    const updatedAt = existing.updatedAt >= incoming.updatedAt ? existing.updatedAt : incoming.updatedAt;
    return {
      ...incoming,
      id: existing.id,
      createdAt,
      updatedAt,
      version: Math.max(existing.version, incoming.version) + 1,
    };
  }

  /**
   * 批量合并重复账单。
   *
   * @param bills 账单列表
   * @returns 去重后的账单列表（保留最早出现的一条）
   */
  dedupe(bills: readonly Bill[]): Bill[] {
    const seen = new Map<string, Bill>();
    const order: string[] = [];
    for (const bill of bills) {
      const fingerprint = this.computeFingerprint(bill);
      const existing = seen.get(fingerprint);
      if (existing) {
        seen.set(fingerprint, this.merge(existing, bill));
        continue;
      }
      seen.set(fingerprint, bill);
      order.push(fingerprint);
    }
    return order.map((fingerprint) => seen.get(fingerprint)).filter((bill): bill is Bill => bill !== undefined);
  }
}
