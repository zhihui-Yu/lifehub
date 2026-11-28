/**
 * 账单按日汇总加密索引（Daily Collapsed Summary Index）。
 *
 * 架构位置：apps/web 的「应用基础设施（lib）」层。
 *
 * 说明：
 * 1. 为解决万级账单进入「账单」页时全表解密阻塞首屏（出现「加载中…」卡顿）的问题，
 *    将每日「笔数 + 收入合计 + 支出合计」聚合为约 2~4KB 的轻量摘要，经当前会话 DEK（AES-GCM-256）加密后缓存在本地；
 * 2. 首屏进入账单页仅需 < 1ms 解密单条按日摘要即可秒开渲染全部折叠日期卡片，
 *    用户点击某一天展开时再通过 `[entityType+localDate]` 复合索引按需读取并解密当日明细；
 * 3. 当尚无缓存（如旧版升级后首次打开）时，直接通过 IndexedDB 复合索引键扫描（0 次密文读取、0 次解密）在数毫秒内渲染每日笔数，并在后台空闲分片补齐收支合计。
 */
import type { Bill, EncryptedPayload } from '@lifehub/core';
import type { PlatformRuntime } from '@/platform';

/** 本地加密按日汇总缓存键名（仅存储 AES-GCM 密文载荷 JSON，严禁明文落盘）。 */
export const BILL_DAILY_INDEX_STORAGE_KEY = 'lifehub:bills:daily-index-enc:v1';

/** 单日账单汇总项。 */
export interface DailyBillSummaryItem {
  /** 本地日历日 `YYYY-MM-DD`。 */
  localDate: string;
  /** 当日账单笔数。 */
  count: number;
  /** 当日收入合计（整数分）。 */
  incomeMinor: number;
  /** 当日支出合计（整数分）。 */
  expenseMinor: number;
  /** 收支合计是否已完成解密聚合（索引键初扫阶段可能暂为 false）。 */
  totalsReady: boolean;
}

interface EncryptedDailyIndexEnvelope {
  schema: 'lifehub-daily-index-v1';
  totalCount: number;
  items: DailyBillSummaryItem[];
}

/** 会话内存级按日汇总缓存，使同会话切 Tab 达到 0ms 同步直出。 */
let memoryDailyIndexRuntime: unknown = null;
let memoryDailyIndexItems: DailyBillSummaryItem[] | null = null;

/**
 * 读取当前内存态已缓存的按日汇总（若属于同一 runtime）。
 */
export function getMemoryDailyBillIndex(runtime: unknown): DailyBillSummaryItem[] | null {
  if (runtime && memoryDailyIndexRuntime === runtime && memoryDailyIndexItems) {
    return memoryDailyIndexItems;
  }
  return null;
}

/**
 * 更新内存态按日汇总缓存。
 */
export function setMemoryDailyBillIndex(
  runtime: unknown,
  items: readonly DailyBillSummaryItem[] | null,
): void {
  memoryDailyIndexRuntime = runtime;
  memoryDailyIndexItems = items ? [...items] : null;
}

/**
 * 清空按日汇总缓存（如清空账单或切换密钥时调用）。
 */
export function clearDailyBillIndexCache(): void {
  memoryDailyIndexRuntime = null;
  memoryDailyIndexItems = null;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(BILL_DAILY_INDEX_STORAGE_KEY);
    }
  } catch {
    // 忽略无 localStorage 权限环境
  }
}

/**
 * 从内存账单数组聚合生成按日期倒序排列的每日汇总列表。
 */
export function buildDailyIndexFromBills(bills: readonly Bill[]): DailyBillSummaryItem[] {
  const map = new Map<string, DailyBillSummaryItem>();
  for (const bill of bills) {
    const existing = map.get(bill.localDate);
    if (existing) {
      existing.count += 1;
      if (bill.direction === 'expense') {
        existing.expenseMinor += bill.amountMinor;
      } else {
        existing.incomeMinor += bill.amountMinor;
      }
    } else {
      map.set(bill.localDate, {
        localDate: bill.localDate,
        count: 1,
        incomeMinor: bill.direction === 'expense' ? 0 : bill.amountMinor,
        expenseMinor: bill.direction === 'expense' ? bill.amountMinor : 0,
        totalsReady: true,
      });
    }
  }
  return [...map.values()].sort((a, b) => (a.localDate < b.localDate ? 1 : a.localDate > b.localDate ? -1 : 0));
}

/**
 * 将按日汇总列表使用会话 DEK（AES-GCM-256）加密后持久化写入本地缓存。
 */
export async function saveEncryptedDailyBillIndex(
  runtime: PlatformRuntime | null | undefined,
  items: readonly DailyBillSummaryItem[],
): Promise<void> {
  const sorted = [...items].sort((a, b) =>
    a.localDate < b.localDate ? 1 : a.localDate > b.localDate ? -1 : 0,
  );
  if (runtime) {
    setMemoryDailyBillIndex(runtime, sorted);
  }
  if (
    !runtime ||
    !runtime.cryptoService ||
    !runtime.dekProvider ||
    !runtime.dekProvider.isUnlocked()
  ) {
    return;
  }
  try {
    const totalCount = sorted.reduce((acc, item) => acc + item.count, 0);
    const envelope: EncryptedDailyIndexEnvelope = {
      schema: 'lifehub-daily-index-v1',
      totalCount,
      items: sorted,
    };
    const encrypted = await runtime.cryptoService.encryptRecord(
      runtime.dekProvider.getDek('bill'),
      'bill',
      'daily-index-v1',
      runtime.dekProvider.getKeyVersion(),
      envelope as unknown as Record<string, unknown>,
    );
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(BILL_DAILY_INDEX_STORAGE_KEY, JSON.stringify(encrypted));
    }
  } catch {
    // 加密缓存落盘失败不影响主流程
  }
}

/**
 * 从本地缓存读取并使用当前会话 DEK 解密按日汇总索引（单次 AES-GCM 解密 < 1ms）。
 */
export async function loadEncryptedDailyBillIndex(
  runtime: PlatformRuntime | null | undefined,
): Promise<{ totalCount: number; items: DailyBillSummaryItem[] } | null> {
  if (
    !runtime ||
    !runtime.cryptoService ||
    !runtime.dekProvider ||
    !runtime.dekProvider.isUnlocked()
  ) {
    return null;
  }
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }
    const raw = window.localStorage.getItem(BILL_DAILY_INDEX_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const payload = JSON.parse(raw) as EncryptedPayload;
    const decrypted = await runtime.cryptoService.decryptRecord<EncryptedDailyIndexEnvelope>(
      runtime.dekProvider.getDek('bill'),
      'bill',
      'daily-index-v1',
      payload.keyVersion ?? runtime.dekProvider.getKeyVersion(),
      payload,
    );
    if (
      !decrypted ||
      decrypted.schema !== 'lifehub-daily-index-v1' ||
      !Array.isArray(decrypted.items)
    ) {
      return null;
    }
    return {
      totalCount: decrypted.totalCount,
      items: decrypted.items,
    };
  } catch {
    return null;
  }
}

/**
 * 直接扫描 IndexedDB `[entityType+localDate]` 复合索引键统计各日账单笔数（0 次密文读取、0 次解密，万级记录仅需 ~3ms）。
 */
export async function scanIndexedDbBillDateCounts(
  runtime: PlatformRuntime | null | undefined,
): Promise<Map<string, number> | null> {
  const db = (runtime as { database?: PlatformRuntime['database'] } | null)?.database;
  if (!db || !db.records) {
    return null;
  }
  try {
    const whereClause = db.records.where('[entityType+localDate]');
    if (whereClause && typeof whereClause.between === 'function') {
      const rangeCollection = whereClause.between(['bill', '0000-00-00'], ['bill', '9999-99-99']);
      if (rangeCollection && typeof rangeCollection.keys === 'function') {
        const rawKeys = (await rangeCollection.keys()) as readonly unknown[];
        const counts = new Map<string, number>();
        for (const key of rawKeys) {
          if (Array.isArray(key) && typeof key[1] === 'string' && key[1].length > 0) {
            const d = key[1];
            counts.set(d, (counts.get(d) ?? 0) + 1);
          }
        }
        return counts;
      }
    }
  } catch {
    // FakeDexie 或降级环境回退下方按 entityType 轻量扫描
  }
  try {
    const records = await db.records.where('entityType').equals('bill').toArray();
    const counts = new Map<string, number>();
    for (const rec of records) {
      if (rec.localDate) {
        counts.set(rec.localDate, (counts.get(rec.localDate) ?? 0) + 1);
      }
    }
    return counts;
  } catch {
    return null;
  }
}
