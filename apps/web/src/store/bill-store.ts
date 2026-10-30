/**
 * 账单列表状态（内存工作集）。
 *
 * 架构位置：apps/web 的「状态管理」层（Zustand）。
 *
 * 说明：解密后的账单保存在**内存**中，
 * 关键词 / 方向 / 分类过滤都在这里做（系统设计 §5 假设 A-8）——
 * 这些是业务语义字段，密文中，不适合做明文索引。
 */
import { create } from 'zustand';
import type { Bill, Direction } from '@lifehub/core';

/** 账单列表的过滤条件。 */
export interface BillFilters {
  /** 关键词（同时匹配对方与备注）。 */
  keyword: string;
  /** 方向过滤；空数组表示不限。 */
  directions: Direction[];
  /** 日期区间起点 'YYYY-MM-DD'。 */
  dateFrom: string;
  /** 日期区间终点 'YYYY-MM-DD'。 */
  dateTo: string;
  /** 分类 id；空串表示不限。 */
  categoryId: string;
}

/** 账单 store 的状态与动作。 */
export interface BillState {
  /** 已解密的账单工作集。 */
  bills: Bill[];
  /** 当前过滤条件。 */
  filters: BillFilters;
  /** 是否正在加载。 */
  loading: boolean;
  /** 中文错误提示。 */
  error: string | null;
  /** 覆盖账单工作集。 */
  setBills: (bills: Bill[]) => void;
  /** 合并新的账单（导入后追加）。 */
  appendBills: (bills: Bill[]) => void;
  /** 设置过滤条件。 */
  setFilters: (filters: Partial<BillFilters>) => void;
  /** 一键清空全部过滤条件（A-09 ③）。 */
  clearFilters: () => void;
  /** 设置加载态。 */
  setLoading: (loading: boolean) => void;
  /** 设置错误提示。 */
  setError: (message: string | null) => void;
}

/** 空的过滤条件。 */
export const EMPTY_FILTERS: BillFilters = {
  keyword: '',
  directions: [],
  dateFrom: '',
  dateTo: '',
  categoryId: '',
};

/**
 * 账单 store。
 */
export const useBillStore = create<BillState>((set) => ({
  bills: [],
  filters: { ...EMPTY_FILTERS },
  loading: false,
  error: null,
  setBills: (bills) => set({ bills, error: null }),
  appendBills: (bills) => set((state) => ({ bills: [...state.bills, ...bills] })),
  setFilters: (filters) => set((state) => ({ filters: { ...state.filters, ...filters } })),
  clearFilters: () => set({ filters: { ...EMPTY_FILTERS } }),
  setLoading: (loading) => set({ loading }),
  setError: (message) => set({ error: message }),
}));
