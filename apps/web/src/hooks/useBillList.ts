/**
 * 账单列表 Hook。
 *
 * 架构位置：apps/web 的「Hooks」层。
 *
 * 说明：
 * 1. 默认开启「按日折叠优先 + 点击展开按需取数」模式（当底层仓储支持 `queryByLocalDateRange` 且无跨日语义筛选时）：
 *    - 首屏仅加载轻量按日汇总索引（或扫描 IndexedDB `[entityType+localDate]` 复合索引键），数毫秒内直接渲染折叠日期卡片，不出现全表解密「加载中…」卡顿；
 *    - 用户点击某日卡片展开时，才按需调用 `queryByLocalDateRange(date, date)` 从本地库读取并解密当日账单；
 * 2. 当传入 `{ eagerAll: true }`（如独立收支统计页）或用户输入关键词/方向/分类筛选时，自动按需加载全量工作集。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseFlexibleDate, toLocalDate, type Bill } from '@lifehub/core';
import { useBillStore, useSettingsStore } from '@/store';
import { useVault } from '@/hooks/useVault';
import {
  buildDailyIndexFromBills,
  getMemoryDailyBillIndex,
  loadEncryptedDailyBillIndex,
  saveEncryptedDailyBillIndex,
  scanIndexedDbBillDateCounts,
  type DailyBillSummaryItem,
} from '@/lib/bill-daily-index';
import type { PlatformRuntime } from '@/platform';
import { formatAmount } from '@/utils/format';
import { useDebouncedValue } from './useDebouncedValue';

/** 历史无时区偏移（Naive Datetime）误按 UTC 存储导致 16:00 后跨天的单次迁移完成标识。 */
export const NAIVE_TZ_MIGRATION_KEY = 'lifehub:migration:naive-tz-fixed:v1';

/** 投影日期缓存（避免万级账单每次筛选重渲染时重复 new Date + Intl 格式化）。 */
const projectedLocalDateCache = new Map<string, string>();
const MAX_PROJECTED_DATE_CACHE_SIZE = 30_000;

function projectBillLocalDate(bill: Bill, effectiveTimeZone: string): string {
  if (!bill.occurredAt) {
    return bill.localDate;
  }
  if (
    effectiveTimeZone === 'Asia/Shanghai' &&
    bill.sourceTimeZone === 'Asia/Shanghai' &&
    bill.localDate === bill.occurredAt.slice(0, 10)
  ) {
    return bill.localDate;
  }
  const cacheKey = `${effectiveTimeZone}|${bill.occurredAt}`;
  const cached = projectedLocalDateCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const parsed = new Date(bill.occurredAt);
  if (Number.isNaN(parsed.getTime())) {
    return bill.localDate;
  }
  try {
    const projected = toLocalDate(parsed, effectiveTimeZone);
    if (projectedLocalDateCache.size >= MAX_PROJECTED_DATE_CACHE_SIZE) {
      projectedLocalDateCache.clear();
    }
    projectedLocalDateCache.set(cacheKey, projected);
    return projected;
  } catch {
    return bill.localDate;
  }
}

/** 按 localDate 分组后的视图模型。 */
export interface BillGroup {
  /** 本地日历日 'YYYY-MM-DD'。 */
  localDate: string;
  /** 组内账单（折叠未展开且未全量加载时为空数组，展开后填入按需加载的当日明细）。 */
  bills: Bill[];
  /** 当日账单总笔数（折叠未加载明细时亦可由按日索引直接提供）。 */
  billCount?: number;
  /** 组内收入合计（整数分）。 */
  incomeMinor: number;
  /** 组内支出合计（整数分）。 */
  expenseMinor: number;
  /** 当日收支合计是否已就绪。 */
  totalsReady?: boolean;
}

/** `useBillList` 可选行为配置。 */
export interface UseBillListOptions {
  /** 是否在挂载时立即加载全量账单（收支统计图表页设为 true；账单列表页默认 false 走按日折叠秒开）。 */
  eagerAll?: boolean;
}

/** 账单列表 Hook 的返回值。 */
export interface UseBillListResult {
  /** 过滤后的账单列表（按时间倒序）。 */
  bills: Bill[];
  /** 按 localDate 分组的视图。 */
  groups: BillGroup[];
  /** 当前总账单条数（兼容按日索引模式与全量过滤模式）。 */
  totalBillCount: number;
  /** 是否处于「按日默认折叠、点击展开按需取数」模式。 */
  isDailyCollapsedMode: boolean;
  /** 当前已展开的日期集合。 */
  expandedDates: ReadonlySet<string>;
  /** 当前正在按需读取明细的日期集合。 */
  loadingDates: ReadonlySet<string>;
  /** 切换某日分组的展开/折叠状态（展开时若当日未加载则自动去本地库按日期取数）。 */
  toggleDateExpand: (localDate: string) => Promise<void>;
  /** 确保指定日期的明细已从本地库读取并返回。 */
  ensureDateLoaded: (localDate: string) => Promise<Bill[]>;
  /** 按需加载并返回全量账单（供导出 CSV/JSON 等全量动作调用）。 */
  ensureAllBillsLoaded: () => Promise<Bill[]>;
  /** 是否正在加载。 */
  loading: boolean;
  /** 中文错误提示。 */
  error: string | null;
  /** 重新全量加载。 */
  reload: () => Promise<Bill[]>;
}

/** 记录最近一次已完成全量解密加载的 runtime 引用（避免切换 Tab 时对万级账单重复全表解密）。 */
let hydratedBillRuntime: unknown = null;

/** 按日明细内存缓存（同一 runtime 下已点开过的日期二次展开 0ms 直出）。 */
let cachedDayBillsRuntime: unknown = null;
let cachedDayBillsRecord: Record<string, Bill[]> = {};

/**
 * 在账单增删改后通知按日明细缓存刷新指定日期或清空重取。
 */
export function invalidateLoadedDayBillsCache(dates?: readonly string[]): void {
  if (!dates || dates.length === 0) {
    cachedDayBillsRecord = {};
    return;
  }
  const next = { ...cachedDayBillsRecord };
  for (const d of dates) {
    delete next[d];
  }
  cachedDayBillsRecord = next;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('lifehub:bills-daily-mutated', { detail: { dates } }));
  }
}

/**
 * 初始化账单列表。
 *
 * @param options 可选加载模式配置
 * @returns 账单列表 Hook 的返回值
 */
export function useBillList(options?: UseBillListOptions): UseBillListResult {
  const eagerAll = Boolean(options?.eagerAll);
  const { runtime, status } = useVault();
  const bills = useBillStore((state) => state.bills);
  const filters = useBillStore((state) => state.filters);
  const loading = useBillStore((state) => state.loading);
  const error = useBillStore((state) => state.error);
  const setBills = useBillStore((state) => state.setBills);
  const setLoading = useBillStore((state) => state.setLoading);
  const setError = useBillStore((state) => state.setError);
  const timezone = useSettingsStore((state) => state.timezone);

  const keyword = useDebouncedValue(filters.keyword);

  const supportsOnDemandByDate = Boolean(
    runtime &&
      typeof (runtime.billRepository as { queryByLocalDateRange?: unknown }).queryByLocalDateRange ===
        'function',
  );

  const hasSemanticFilter = useMemo(() => {
    const selectedCategories =
      filters.categoryIds && filters.categoryIds.length > 0
        ? filters.categoryIds
        : filters.categoryId !== ''
          ? [filters.categoryId]
          : [];
    return (
      keyword.trim() !== '' || filters.directions.length > 0 || selectedCategories.length > 0
    );
  }, [filters.categoryId, filters.categoryIds, filters.directions, keyword]);

  const isDailyCollapsedMode = !eagerAll && supportsOnDemandByDate && !hasSemanticFilter;

  const [dailyIndex, setDailyIndex] = useState<DailyBillSummaryItem[] | null>(() =>
    getMemoryDailyBillIndex(runtime),
  );
  const [dayBillsMap, setDayBillsMap] = useState<Record<string, Bill[]>>(() =>
    cachedDayBillsRuntime === runtime ? cachedDayBillsRecord : {},
  );
  const [expandedDates, setExpandedDates] = useState<Set<string>>(() => new Set());
  const [loadingDates, setLoadingDates] = useState<Set<string>>(() => new Set());
  const expandedDatesRef = useRef(expandedDates);
  expandedDatesRef.current = expandedDates;
  const [mutationTick, setMutationTick] = useState(0);

  useEffect(() => {
    if (cachedDayBillsRuntime !== runtime) {
      cachedDayBillsRuntime = runtime;
      cachedDayBillsRecord = {};
      setDayBillsMap({});
      setExpandedDates(new Set());
      setDailyIndex(getMemoryDailyBillIndex(runtime));
    }
  }, [runtime]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const onMutated = (evt: Event) => {
      const dates = (evt as CustomEvent<{ dates?: string[] }>).detail?.dates;
      setDayBillsMap({ ...cachedDayBillsRecord });
      setMutationTick((t) => t + 1);
      if (dates && dates.length > 0 && runtime && supportsOnDemandByDate) {
        for (const d of dates) {
          if (expandedDatesRef.current.has(d)) {
            void runtime.billRepository.queryByLocalDateRange(d, d).then((dayList) => {
              const sorted = [...dayList].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
              cachedDayBillsRecord = { ...cachedDayBillsRecord, [d]: sorted };
              setDayBillsMap((prev) => ({ ...prev, [d]: sorted }));
            });
          }
        }
      }
    };
    window.addEventListener('lifehub:bills-daily-mutated', onMutated);
    return () => {
      window.removeEventListener('lifehub:bills-daily-mutated', onMutated);
    };
  }, [runtime, supportsOnDemandByDate]);

  const reload = useCallback(async (): Promise<Bill[]> => {
    if (!runtime || status !== 'unlocked') {
      return [];
    }
    setLoading(true);
    try {
      let list = await runtime.billRepository.list();
      const repoWithBatch = runtime.billRepository as {
        putMany?: (items: readonly Bill[]) => Promise<void>;
        saveBatch?: (items: readonly Bill[]) => Promise<void>;
      };
      const putManyFn = repoWithBatch.putMany;
      const saveBatchFn = repoWithBatch.saveBatch;
      const batchSaver =
        typeof putManyFn === 'function'
          ? (items: readonly Bill[]) => putManyFn.call(runtime.billRepository, items)
          : typeof saveBatchFn === 'function'
            ? (items: readonly Bill[]) => saveBatchFn.call(runtime.billRepository, items)
            : null;

      if (
        typeof localStorage !== 'undefined' &&
        !localStorage.getItem(NAIVE_TZ_MIGRATION_KEY) &&
        batchSaver !== null
      ) {
        const repairedBills: Bill[] = [];
        list = list.map((bill) => {
          if (
            bill.sourceFileId !== 'manual-entry' &&
            bill.sourceTimeZone &&
            bill.sourceTimeZone !== 'UTC' &&
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(bill.occurredAt)
          ) {
            try {
              const naiveWallClock = bill.occurredAt.slice(0, 19).replace('T', ' ');
              const parsed = parseFlexibleDate(naiveWallClock, {
                timeZone: bill.sourceTimeZone,
                sourceTimeZone: bill.sourceTimeZone,
              });
              if (parsed.occurredAt !== bill.occurredAt || parsed.localDate !== bill.localDate) {
                const updated: Bill = {
                  ...bill,
                  occurredAt: parsed.occurredAt,
                  localDate: parsed.localDate,
                };
                repairedBills.push(updated);
                return updated;
              }
            } catch {
              // 单条解析异常时保持原样
            }
          }
          return bill;
        });
        if (repairedBills.length > 0) {
          await batchSaver(repairedBills);
        }
        try {
          localStorage.setItem(NAIVE_TZ_MIGRATION_KEY, '1');
        } catch {
          // localStorage 受限环境忽略
        }
      }
      hydratedBillRuntime = runtime;
      setBills(list);
      const builtIndex = buildDailyIndexFromBills(list);
      setDailyIndex(builtIndex);
      void saveEncryptedDailyBillIndex(runtime as PlatformRuntime, builtIndex);
      return list;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '本地数据读写失败');
      return [];
    } finally {
      setLoading(false);
    }
  }, [runtime, setBills, setError, setLoading, status]);

  const ensureAllBillsLoaded = useCallback(async (): Promise<Bill[]> => {
    const existing = useBillStore.getState().bills;
    if (hydratedBillRuntime === runtime && existing.length > 0) {
      return existing;
    }
    return reload();
  }, [reload, runtime]);

  // 当内存工作集已被填充（如导入完成、云恢复完成或全量加载后），自动同步更新按日汇总索引
  useEffect(() => {
    if (!runtime || status !== 'unlocked' || bills.length === 0) {
      return;
    }
    const built = buildDailyIndexFromBills(bills);
    setDailyIndex(built);
    void saveEncryptedDailyBillIndex(runtime as PlatformRuntime, built);
  }, [bills, runtime, status]);

  // 按日折叠懒加载模式：仅读取轻量按日索引与 IndexedDB 日期键，绝不全表解密阻塞首屏
  useEffect(() => {
    if (!runtime || status !== 'unlocked') {
      return undefined;
    }

    // 非按日懒加载模式（如统计页、带关键词语义过滤、或测试桩无 queryByLocalDateRange）：按需加载工作集
    if (!isDailyCollapsedMode) {
      if (hydratedBillRuntime === runtime && useBillStore.getState().bills.length > 0) {
        return undefined;
      }
      void reload();
      return undefined;
    }

    // 若内存中已有全量账单，直接复用即可，无需任何 I/O
    if (useBillStore.getState().bills.length > 0) {
      return undefined;
    }

    // 历史跨天时区一次性迁移未执行过时：先看库里是否有账单，无账单直接标记完成，有账单则单次迁移并建立索引
    const migrationDone =
      typeof localStorage === 'undefined' || Boolean(localStorage.getItem(NAIVE_TZ_MIGRATION_KEY));

    let cancelled = false;
    let hydrationTimer: ReturnType<typeof setTimeout> | null = null;

    void (async () => {
      try {
        const [dateCounts, cachedEncrypted] = await Promise.all([
          scanIndexedDbBillDateCounts(runtime as PlatformRuntime),
          loadEncryptedDailyBillIndex(runtime as PlatformRuntime),
        ]);
        if (cancelled) return;

        // 若运行环境没有底层 Dexie database（如自定义测试桩仅实现了 queryByLocalDateRange），优先用加密摘要或回退全量列表
        if (dateCounts === null) {
          if (cachedEncrypted) {
            setDailyIndex(cachedEncrypted.items);
          } else {
            await reload();
          }
          return;
        }

        let totalFromIndexKeys = 0;
        for (const c of dateCounts.values()) {
          totalFromIndexKeys += c;
        }

        if (totalFromIndexKeys === 0) {
          try {
            localStorage.setItem(NAIVE_TZ_MIGRATION_KEY, '1');
          } catch {
            // 忽略
          }
          setDailyIndex([]);
          void saveEncryptedDailyBillIndex(runtime as PlatformRuntime, []);
          return;
        }

        if (!migrationDone) {
          await reload();
          return;
        }

        const cachedByDate = new Map<string, DailyBillSummaryItem>();
        const inMemIndex = getMemoryDailyBillIndex(runtime);
        if (inMemIndex) {
          for (const item of inMemIndex) {
            cachedByDate.set(item.localDate, item);
          }
        }
        if (cachedEncrypted) {
          for (const item of cachedEncrypted.items) {
            cachedByDate.set(item.localDate, item);
          }
        }

        const sortedDates = [...dateCounts.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
        const missingTotalDates: string[] = [];
        const initialItems: DailyBillSummaryItem[] = sortedDates.map((d) => {
          const count = dateCounts.get(d) ?? 0;
          const hit = cachedByDate.get(d);
          if (hit && hit.count === count && hit.totalsReady) {
            return hit;
          }
          const loadedDay = cachedDayBillsRecord[d];
          if (loadedDay && loadedDay.length === count) {
            let inc = 0;
            let exp = 0;
            for (const b of loadedDay) {
              if (b.direction === 'expense') exp += b.amountMinor;
              else inc += b.amountMinor;
            }
            return {
              localDate: d,
              count,
              incomeMinor: inc,
              expenseMinor: exp,
              totalsReady: true,
            };
          }
          missingTotalDates.push(d);
          return {
            localDate: d,
            count,
            incomeMinor: hit?.incomeMinor ?? 0,
            expenseMinor: hit?.expenseMinor ?? 0,
            totalsReady: false,
          };
        });

        setDailyIndex(initialItems);
        if (missingTotalDates.length === 0) {
          if (!cachedEncrypted || cachedEncrypted.totalCount !== totalFromIndexKeys) {
            void saveEncryptedDailyBillIndex(runtime as PlatformRuntime, initialItems);
          }
          return;
        }

        // 后台非阻塞空闲分片补齐未缓存日期的收支合计（每次仅读 4 天，绝不阻塞主线程或触发全屏 Loading）
        const workingMap = new Map(initialItems.map((it) => [it.localDate, { ...it }]));
        let cursor = 0;
        const stepHydrate = async () => {
          if (cancelled || cursor >= missingTotalDates.length) {
            if (!cancelled) {
              const completed = [...workingMap.values()].sort((a, b) =>
                a.localDate < b.localDate ? 1 : -1,
              );
              setDailyIndex(completed);
              await saveEncryptedDailyBillIndex(runtime as PlatformRuntime, completed);
            }
            return;
          }
          const sliceDates = missingTotalDates.slice(cursor, cursor + 4);
          cursor += sliceDates.length;
          const maxD = sliceDates[0];
          const minD = sliceDates[sliceDates.length - 1];
          if (minD && maxD) {
            const rangeBills = await runtime.billRepository.queryByLocalDateRange(minD, maxD);
            if (cancelled) return;
            const byDate = new Map<string, Bill[]>();
            for (const b of rangeBills) {
              const arr = byDate.get(b.localDate);
              if (arr) arr.push(b);
              else byDate.set(b.localDate, [b]);
            }
            for (const d of sliceDates) {
              const listForDay = byDate.get(d) ?? [];
              let inc = 0;
              let exp = 0;
              for (const b of listForDay) {
                if (b.direction === 'expense') exp += b.amountMinor;
                else inc += b.amountMinor;
              }
              workingMap.set(d, {
                localDate: d,
                count: listForDay.length,
                incomeMinor: inc,
                expenseMinor: exp,
                totalsReady: true,
              });
            }
            setDailyIndex(
              [...workingMap.values()].sort((a, b) => (a.localDate < b.localDate ? 1 : -1)),
            );
          }
          hydrationTimer = setTimeout(() => {
            void stepHydrate();
          }, 32);
        };

        hydrationTimer = setTimeout(() => {
          void stepHydrate();
        }, 16);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : '读取账单日期索引失败');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (hydrationTimer !== null) {
        clearTimeout(hydrationTimer);
      }
    };
  }, [isDailyCollapsedMode, mutationTick, reload, runtime, setError, status]);

  const projectedBills = useMemo(() => {
    if (bills.length === 0) {
      return bills;
    }
    const effectiveTimeZone =
      timezone ||
      (typeof Intl !== 'undefined'
        ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        : 'UTC');
    return bills.map((bill) => {
      const projectedLocalDate = projectBillLocalDate(bill, effectiveTimeZone);
      return projectedLocalDate === bill.localDate
        ? bill
        : { ...bill, localDate: projectedLocalDate };
    });
  }, [bills, timezone]);

  const ensureDateLoaded = useCallback(
    async (localDate: string): Promise<Bill[]> => {
      if (!runtime || status !== 'unlocked') {
        return [];
      }
      if (projectedBills.length > 0) {
        return projectedBills
          .filter((b) => b.localDate === localDate)
          .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
      }
      const already = cachedDayBillsRecord[localDate];
      if (already) {
        return already;
      }
      if (!supportsOnDemandByDate) {
        const all = await ensureAllBillsLoaded();
        return all.filter((b) => b.localDate === localDate);
      }

      setLoadingDates((prev) => {
        const next = new Set(prev);
        next.add(localDate);
        return next;
      });
      try {
        const fetched = await runtime.billRepository.queryByLocalDateRange(localDate, localDate);
        const sorted = [...fetched].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
        cachedDayBillsRecord = { ...cachedDayBillsRecord, [localDate]: sorted };
        setDayBillsMap((prev) => ({ ...prev, [localDate]: sorted }));

        let inc = 0;
        let exp = 0;
        for (const b of sorted) {
          if (b.direction === 'expense') exp += b.amountMinor;
          else inc += b.amountMinor;
        }
        setDailyIndex((prev) =>
          prev
            ? prev.map((item) =>
                item.localDate === localDate
                  ? {
                      localDate,
                      count: sorted.length,
                      incomeMinor: inc,
                      expenseMinor: exp,
                      totalsReady: true,
                    }
                  : item,
              )
            : prev,
        );
        return sorted;
      } finally {
        setLoadingDates((prev) => {
          if (!prev.has(localDate)) return prev;
          const next = new Set(prev);
          next.delete(localDate);
          return next;
        });
      }
    },
    [ensureAllBillsLoaded, projectedBills, runtime, status, supportsOnDemandByDate],
  );

  const toggleDateExpand = useCallback(
    async (localDate: string): Promise<void> => {
      const currentlyExpanded = expandedDatesRef.current.has(localDate);
      if (currentlyExpanded) {
        setExpandedDates((prev) => {
          const next = new Set(prev);
          next.delete(localDate);
          return next;
        });
        return;
      }
      setExpandedDates((prev) => {
        const next = new Set(prev);
        next.add(localDate);
        return next;
      });
      await ensureDateLoaded(localDate);
    },
    [ensureDateLoaded],
  );

  const filtered = useMemo(() => {
    if (isDailyCollapsedMode && projectedBills.length === 0) {
      // 懒加载模式下仅拼接用户已展开日期的明细供当前视图使用
      const loadedExpandedBills: Bill[] = [];
      for (const d of expandedDates) {
        const dayItems = dayBillsMap[d];
        if (dayItems) {
          for (const b of dayItems) {
            if (filters.dateFrom !== '' && b.localDate < filters.dateFrom) continue;
            if (filters.dateTo !== '' && b.localDate > filters.dateTo) continue;
            loadedExpandedBills.push(b);
          }
        }
      }
      return loadedExpandedBills;
    }

    const lowered = keyword.trim().toLowerCase();
    return projectedBills.filter((bill) => {
      if (lowered !== '') {
        const amountText = formatAmount(bill.amountMinor).toLowerCase();
        const rawAmountText = (bill.amountMinor / 100).toFixed(2);
        const directionLabel =
          bill.direction === 'expense' ? '支出' : bill.direction === 'income' ? '收入' : '退款';
        const hit =
          bill.counterparty.toLowerCase().includes(lowered) ||
          bill.note.toLowerCase().includes(lowered) ||
          bill.localDate.toLowerCase().includes(lowered) ||
          amountText.includes(lowered) ||
          rawAmountText.includes(lowered) ||
          directionLabel.includes(lowered);
        if (!hit) {
          return false;
        }
      }
      if (filters.directions.length > 0 && !filters.directions.includes(bill.direction)) {
        return false;
      }
      if (filters.dateFrom !== '' && bill.localDate < filters.dateFrom) {
        return false;
      }
      if (filters.dateTo !== '' && bill.localDate > filters.dateTo) {
        return false;
      }
      const selectedCategories =
        filters.categoryIds && filters.categoryIds.length > 0
          ? filters.categoryIds
          : filters.categoryId !== ''
            ? [filters.categoryId]
            : [];
      if (selectedCategories.length > 0) {
        const billCatKey = bill.categoryId ?? '__uncategorized__';
        if (!selectedCategories.includes(billCatKey)) {
          return false;
        }
      }
      return true;
    });
  }, [
    dayBillsMap,
    expandedDates,
    filters.categoryId,
    filters.categoryIds,
    filters.dateFrom,
    filters.dateTo,
    filters.directions,
    isDailyCollapsedMode,
    keyword,
    projectedBills,
  ]);

  const { groups, totalBillCount } = useMemo<{
    groups: BillGroup[];
    totalBillCount: number;
  }>(() => {
    // 按日折叠索引模式且尚未加载全量账单时：直接由轻量 dailyIndex 生成全部日期分组（0 全表遍历）
    if (isDailyCollapsedMode && projectedBills.length === 0) {
      const indexList = dailyIndex ?? [];
      const outGroups: BillGroup[] = [];
      let sumCount = 0;
      for (const item of indexList) {
        if (filters.dateFrom !== '' && item.localDate < filters.dateFrom) {
          continue;
        }
        if (filters.dateTo !== '' && item.localDate > filters.dateTo) {
          continue;
        }
        if (item.count <= 0) {
          continue;
        }
        sumCount += item.count;
        const loadedBills = expandedDates.has(item.localDate)
          ? (dayBillsMap[item.localDate] ?? [])
          : [];
        outGroups.push({
          localDate: item.localDate,
          bills: loadedBills,
          billCount: item.count,
          incomeMinor: item.incomeMinor,
          expenseMinor: item.expenseMinor,
          totalsReady: item.totalsReady,
        });
      }
      return { groups: outGroups, totalBillCount: sumCount };
    }

    const sorted = [...filtered].sort((a, b) => {
      if (a.localDate !== b.localDate) {
        return a.localDate < b.localDate ? 1 : -1;
      }
      return a.occurredAt < b.occurredAt ? 1 : -1;
    });
    const map = new Map<string, BillGroup>();
    for (const bill of sorted) {
      const group = map.get(bill.localDate) ?? {
        localDate: bill.localDate,
        bills: [],
        billCount: 0,
        incomeMinor: 0,
        expenseMinor: 0,
        totalsReady: true,
      };
      group.bills.push(bill);
      group.billCount = (group.billCount ?? 0) + 1;
      if (bill.direction === 'expense') {
        group.expenseMinor += bill.amountMinor;
      } else {
        group.incomeMinor += bill.amountMinor;
      }
      map.set(bill.localDate, group);
    }
    return { groups: [...map.values()], totalBillCount: filtered.length };
  }, [
    dailyIndex,
    dayBillsMap,
    expandedDates,
    filtered,
    filters.dateFrom,
    filters.dateTo,
    isDailyCollapsedMode,
    projectedBills.length,
  ]);

  return {
    bills: filtered,
    groups,
    totalBillCount,
    isDailyCollapsedMode,
    expandedDates,
    loadingDates,
    toggleDateExpand,
    ensureDateLoaded,
    ensureAllBillsLoaded,
    loading,
    error,
    reload,
  };
}
