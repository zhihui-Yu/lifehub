/**
 * 账单列表 Hook。
 *
 * 架构位置：apps/web 的「Hooks」层。
 *
 * 说明：负责加载解密后的账单工作集，并按过滤条件派生分组视图（PRD A-09）。
 */
import { useCallback, useEffect, useMemo } from 'react';
import { parseFlexibleDate, toLocalDate, type Bill } from '@lifehub/core';
import { useBillStore, useSettingsStore } from '@/store';
import { useVault } from '@/hooks/useVault';
import { formatAmount } from '@/utils/format';
import { useDebouncedValue } from './useDebouncedValue';

/** 历史无时区偏移（Naive Datetime）误按 UTC 存储导致 16:00 后跨天的单次迁移完成标识。 */
export const NAIVE_TZ_MIGRATION_KEY = 'lifehub:migration:naive-tz-fixed:v1';

/**
 * 将单笔账单的 `occurredAt` 动态投影到当前生效时区下的本地日历日 `YYYY-MM-DD`。
 *
 * 说明：当用户在设置中切换默认时区（如从 `Asia/Shanghai` 切到 `America/New_York` 或 `Asia/Tokyo`）时，
 * 账单列表的日期分组与单行日期随配置时区响应式重算；对既有 `Asia/Shanghai` 下的无偏移流水保持原 `localDate` 兼容。
 *
 * @param bill 原始账单实体
 * @param effectiveTimeZone 当前生效的 IANA 时区名
 * @returns 投影后的本地日历日字符串
 * @throws 无；异常在内部捕获并回退 `bill.localDate`
 */
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
  const parsed = new Date(bill.occurredAt);
  if (Number.isNaN(parsed.getTime())) {
    return bill.localDate;
  }
  try {
    return toLocalDate(parsed, effectiveTimeZone);
  } catch {
    return bill.localDate;
  }
}

/** 按 localDate 分组后的视图模型。 */
export interface BillGroup {
  /** 本地日历日 'YYYY-MM-DD'。 */
  localDate: string;
  /** 组内账单。 */
  bills: Bill[];
  /** 组内收入合计（整数分）。 */
  incomeMinor: number;
  /** 组内支出合计（整数分）。 */
  expenseMinor: number;
}

/** 账单列表 Hook 的返回值。 */
export interface UseBillListResult {
  /** 过滤后的账单列表（按时间倒序）。 */
  bills: Bill[];
  /** 按 localDate 分组的视图。 */
  groups: BillGroup[];
  /** 是否正在加载。 */
  loading: boolean;
  /** 中文错误提示。 */
  error: string | null;
  /** 重新加载。 */
  reload: () => Promise<void>;
}

/**
 * 初始化账单列表。
 *
 * @returns 账单列表 Hook 的返回值
 */
export function useBillList(): UseBillListResult {
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

  const reload = useCallback(async () => {
    if (!runtime || status !== 'unlocked') {
      return;
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
      setBills(list);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '本地数据读写失败');
    } finally {
      setLoading(false);
    }
  }, [runtime, setBills, setError, setLoading, status]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const projectedBills = useMemo(() => {
    const effectiveTimeZone =
      timezone ||
      (typeof Intl !== 'undefined'
        ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        : 'UTC');
    return bills.map((bill) => {
      const projectedLocalDate = projectBillLocalDate(bill, effectiveTimeZone);
      return projectedLocalDate === bill.localDate ? bill : { ...bill, localDate: projectedLocalDate };
    });
  }, [bills, timezone]);

  const filtered = useMemo(() => {
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
    projectedBills,
    filters.categoryId,
    filters.categoryIds,
    filters.dateFrom,
    filters.dateTo,
    filters.directions,
    keyword,
  ]);

  const groups = useMemo<BillGroup[]>(() => {
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
        incomeMinor: 0,
        expenseMinor: 0,
      };
      group.bills.push(bill);
      if (bill.direction === 'expense') {
        group.expenseMinor += bill.amountMinor;
      } else {
        group.incomeMinor += bill.amountMinor;
      }
      map.set(bill.localDate, group);
    }
    return [...map.values()];
  }, [filtered]);

  return { bills: filtered, groups, loading, error, reload };
}
