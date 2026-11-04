/**
 * 账单列表 store 单测。
 *
 * 覆盖需求：A-09 ②③ —— 解密后的**内存工作集**、过滤条件的合并与一键清空、
 * 加载态与中文错误提示。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, useBillStore } from '@/store/bill-store';
import { makeBill } from '@/__tests__/test-utils/fixtures';

describe('useBillStore', () => {
  beforeEach(() => {
    useBillStore.setState({
      bills: [],
      filters: { ...EMPTY_FILTERS },
      loading: false,
      error: null,
    });
  });

  it('初始状态是空工作集 + 空过滤条件', () => {
    const state = useBillStore.getState();
    expect(state.bills).toEqual([]);
    expect(state.filters).toEqual(EMPTY_FILTERS);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('setBills 覆盖整个工作集并顺带清掉上一次的错误提示', () => {
    const bills = [makeBill({ id: 'b1' }), makeBill({ id: 'b2' })];
    useBillStore.getState().setError('本地数据读写失败');

    useBillStore.getState().setBills(bills);

    const state = useBillStore.getState();
    expect(state.bills).toHaveLength(2);
    expect(state.error).toBeNull();
  });

  it('appendBills 把新账单追加到工作集尾部（导入后追加）', () => {
    useBillStore.getState().setBills([makeBill({ id: 'b1' })]);
    useBillStore.getState().appendBills([makeBill({ id: 'b2' }), makeBill({ id: 'b3' })]);

    const ids = useBillStore.getState().bills.map((bill) => bill.id);
    expect(ids).toEqual(['b1', 'b2', 'b3']);
  });

  it('setFilters 只覆盖传入的字段，其余过滤条件保持不变（可组合筛选）', () => {
    useBillStore.getState().setFilters({ keyword: '星巴克', directions: ['expense'] });

    useBillStore.getState().setFilters({ dateFrom: '2024-01-01', dateTo: '2024-01-31' });

    const { filters } = useBillStore.getState();
    expect(filters.keyword).toBe('星巴克');
    expect(filters.directions).toEqual(['expense']);
    expect(filters.dateFrom).toBe('2024-01-01');
    expect(filters.dateTo).toBe('2024-01-31');
    expect(filters.categoryId).toBe('');
    expect(filters.categoryIds).toEqual([]);
  });

  it('setFilters 支持分类多选（categoryIds）与单选（categoryId）双向同步', () => {
    useBillStore.getState().setFilters({ categoryIds: ['cat-food', 'cat-shopping'] });
    expect(useBillStore.getState().filters.categoryIds).toEqual(['cat-food', 'cat-shopping']);
    expect(useBillStore.getState().filters.categoryId).toBe('');

    useBillStore.getState().setFilters({ categoryIds: ['cat-food'] });
    expect(useBillStore.getState().filters.categoryIds).toEqual(['cat-food']);
    expect(useBillStore.getState().filters.categoryId).toBe('cat-food');

    useBillStore.getState().setFilters({ categoryId: 'cat-transport' });
    expect(useBillStore.getState().filters.categoryId).toBe('cat-transport');
    expect(useBillStore.getState().filters.categoryIds).toEqual(['cat-transport']);
  });

  it('clearFilters 一键清空全部过滤条件', () => {
    useBillStore.getState().setFilters({
      keyword: '星巴克',
      directions: ['income'],
      dateFrom: '2024-01-01',
      dateTo: '2024-01-31',
      categoryId: 'cat-1',
    });

    useBillStore.getState().clearFilters();

    expect(useBillStore.getState().filters).toEqual(EMPTY_FILTERS);
  });

  it('clearFilters 不会改动工作集本身', () => {
    useBillStore.getState().setBills([makeBill({ id: 'b1' })]);
    useBillStore.getState().clearFilters();

    expect(useBillStore.getState().bills).toHaveLength(1);
  });

  it('setLoading / setError 管理加载态与中文错误提示', () => {
    useBillStore.getState().setLoading(true);
    expect(useBillStore.getState().loading).toBe(true);

    useBillStore.getState().setError('本地数据读写失败');
    expect(useBillStore.getState().error).toBe('本地数据读写失败');

    useBillStore.getState().setError(null);
    expect(useBillStore.getState().error).toBeNull();
  });

  it('EMPTY_FILTERS 是模块级常量，clearFilters 返回的是它的副本（不会被外部改坏）', () => {
    useBillStore.getState().clearFilters();
    const { filters } = useBillStore.getState();

    filters.keyword = '被外部改坏了';
    useBillStore.getState().clearFilters();

    expect(useBillStore.getState().filters.keyword).toBe('');
    expect(EMPTY_FILTERS.keyword).toBe('');
  });
});
