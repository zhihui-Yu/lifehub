/**
 * 账单列表 Hook。
 *
 * 架构位置：apps/web 的「Hooks」层。
 *
 * 说明：负责加载解密后的账单工作集，并按过滤条件派生分组视图（PRD A-09）。
 */
import { useCallback, useEffect, useMemo } from 'react';
import type { Bill } from '@lifehub/core';
import { useBillStore } from '@/store';
import { useVault } from '@/hooks/useVault';
import { useDebouncedValue } from './useDebouncedValue';

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

  const keyword = useDebouncedValue(filters.keyword);

  const reload = useCallback(async () => {
    if (!runtime || status !== 'unlocked') {
      return;
    }
    setLoading(true);
    try {
      const list = await runtime.billRepository.list();
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

  const filtered = useMemo(() => {
    const lowered = keyword.trim().toLowerCase();
    return bills.filter((bill) => {
      if (lowered !== '') {
        const hit =
          bill.counterparty.toLowerCase().includes(lowered) || bill.note.toLowerCase().includes(lowered);
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
      if (filters.categoryId !== '' && bill.categoryId !== filters.categoryId) {
        return false;
      }
      return true;
    });
  }, [bills, filters.categoryId, filters.dateFrom, filters.dateTo, filters.directions, keyword]);

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
