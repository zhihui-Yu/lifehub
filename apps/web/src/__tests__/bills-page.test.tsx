/**
 * 账单列表页面测试。
 *
 * 覆盖需求：A-09（按本地日历日分组、方向 / 关键词 / 日期区间筛选、一键清空）。
 *
 * 说明：页面依赖 `useVault` 提供的平台运行时（会真的去 IndexedDB 取数据），
 * 因此这里把 `useVault` 打桩成返回固定账单的假运行时，
 * 但**保留真实的 `useBillList`**，从而真正验证分组与筛选逻辑。
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bill } from '@lifehub/core';
import { BillsPage } from '@/pages/BillsPage';
import { EMPTY_FILTERS, useBillStore } from '@/store/bill-store';

/**
 * 打桩用的假运行时与账单集合。
 *
 * 说明：必须用 `vi.hoisted` 提前创建并保持**引用稳定**——
 * 若每次渲染都返回新的 runtime 对象，`useBillList` 的 reload 依赖会持续变化，
 * 从而触发无限重渲染。
 */
const { FAKE_BILLS, FAKE_RUNTIME } = vi.hoisted(() => {
  const bills = [
    {
      id: 'b1',
      amountMinor: 3550,
      currency: 'CNY',
      direction: 'expense',
      occurredAt: '2024-01-15T08:12:00.000Z',
      localDate: '2024-01-15',
      sourceTimeZone: 'Asia/Shanghai',
      counterparty: '星巴克',
      categoryId: null,
      note: '拿铁',
      sourceFileId: 'batch-1',
      sourceRowIndex: 0,
      createdAt: '2024-01-15T08:12:00.000Z',
      updatedAt: '2024-01-15T08:12:00.000Z',
      version: 1,
      deviceId: 'test-device',
    },
    {
      id: 'b2',
      amountMinor: 1200,
      currency: 'CNY',
      direction: 'expense',
      occurredAt: '2024-01-15T12:00:00.000Z',
      localDate: '2024-01-15',
      sourceTimeZone: 'Asia/Shanghai',
      counterparty: '便利店',
      categoryId: null,
      note: '饭团',
      sourceFileId: 'batch-1',
      sourceRowIndex: 1,
      createdAt: '2024-01-15T12:00:00.000Z',
      updatedAt: '2024-01-15T12:00:00.000Z',
      version: 1,
      deviceId: 'test-device',
    },
    {
      id: 'b3',
      amountMinor: 5000,
      currency: 'CNY',
      direction: 'income',
      occurredAt: '2024-01-16T09:00:00.000Z',
      localDate: '2024-01-16',
      sourceTimeZone: 'Asia/Shanghai',
      counterparty: '工资',
      categoryId: null,
      note: '',
      sourceFileId: 'batch-1',
      sourceRowIndex: 2,
      createdAt: '2024-01-16T09:00:00.000Z',
      updatedAt: '2024-01-16T09:00:00.000Z',
      version: 1,
      deviceId: 'test-device',
    },
  ];
  return {
    FAKE_BILLS: bills,
    FAKE_RUNTIME: {
      billRepository: { list: async () => bills },
      categoryRepository: { list: async () => [] },
    },
  };
});

// 打桩 `useVault`：返回一个能列出固定账单的假运行时（引用稳定）。
vi.mock('@/hooks/useVault', () => ({
  useVault: () => ({
    runtime: FAKE_RUNTIME,
    status: 'unlocked',
    vaultCreated: true,
    error: null,
    failedAttempts: 0,
    recoveryBundle: null,
    createVault: vi.fn(),
    unlock: vi.fn(),
    unlockWithRecoveryCode: vi.fn(),
    regenerateRecoveryCode: vi.fn(),
    lock: vi.fn(),
  }),
}));

// 打桩虚拟列表：虚拟化依赖真实滚动容器尺寸，在 jsdom 中不稳定；
// 这里换成普通列表，保留「每条账单渲染一行交易对方」的语义。
vi.mock('@/components/bills/BillVirtualList', () => ({
  BillVirtualList: ({ bills }: { bills: Bill[] }) => (
    <ul data-testid="bill-virtual-list">
      {bills.map((item) => (
        <li key={item.id}>{item.counterparty}</li>
      ))}
    </ul>
  ),
}));

describe('BillsPage', () => {
  beforeEach(() => {
    useBillStore.setState({
      bills: [],
      filters: { ...EMPTY_FILTERS },
      loading: false,
      error: null,
    });
  });

  it('按本地日历日分组展示，并给出每组笔数与收支合计', async () => {
    render(<BillsPage />);

    await waitFor(() => {
      expect(screen.getAllByTestId('bill-virtual-list')).toHaveLength(2);
    });

    // 组头包含本地日历日、星期与笔数。
    expect(screen.getByText(/2024年1月15日/)).toBeInTheDocument();
    expect(screen.getByText(/2024年1月16日/)).toBeInTheDocument();
    expect(screen.getAllByText(/2 笔/)).toHaveLength(1);
    expect(screen.getAllByText(/1 笔/)).toHaveLength(1);

    // 2024-01-15 组：支出 3550 + 1200 = 4750 分；收入 0。
    expect(screen.getByText('支出 ¥47.50')).toBeInTheDocument();
    // 2024-01-16 组：收入 5000 分。
    expect(screen.getByText('收入 ¥50.00')).toBeInTheDocument();

    // 底部统计条给出总条数。
    expect(screen.getByText(/共 3 条账单/)).toBeInTheDocument();
  });

  it('按方向筛选后只保留支出记录', async () => {
    render(<BillsPage />);
    await waitFor(() => {
      expect(screen.getByText(/共 3 条账单/)).toBeInTheDocument();
    });

    act(() => {
      useBillStore.getState().setFilters({ directions: ['expense'] });
    });

    await waitFor(() => {
      expect(screen.getByText(/共 2 条账单/)).toBeInTheDocument();
    });
    expect(screen.queryByText('工资')).not.toBeInTheDocument();
  });

  it('按日期区间筛选后只保留区间内的账单', async () => {
    render(<BillsPage />);
    await waitFor(() => {
      expect(screen.getByText(/共 3 条账单/)).toBeInTheDocument();
    });

    act(() => {
      useBillStore.getState().setFilters({ dateFrom: '2024-01-16', dateTo: '2024-01-16' });
    });

    await waitFor(() => {
      expect(screen.getByText(/共 1 条账单/)).toBeInTheDocument();
    });
    expect(screen.getByText('工资')).toBeInTheDocument();
    expect(screen.queryByText('星巴克')).not.toBeInTheDocument();
  });

  it('关键词搜索命中对方与备注（200ms 防抖后生效）', async () => {
    render(<BillsPage />);
    await waitFor(() => {
      expect(screen.getByText(/共 3 条账单/)).toBeInTheDocument();
    });

    act(() => {
      useBillStore.getState().setFilters({ keyword: '便利店' });
    });

    await waitFor(
      () => {
        expect(screen.getByText(/共 1 条账单/)).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
    expect(screen.getByText('便利店')).toBeInTheDocument();
    expect(screen.queryByText('星巴克')).not.toBeInTheDocument();
  });

  it('清空筛选后恢复全部账单', async () => {
    render(<BillsPage />);
    await waitFor(() => {
      expect(screen.getByText(/共 3 条账单/)).toBeInTheDocument();
    });

    act(() => {
      useBillStore.getState().setFilters({ directions: ['income'] });
    });
    await waitFor(() => {
      expect(screen.getByText(/共 1 条账单/)).toBeInTheDocument();
    });

    act(() => {
      useBillStore.getState().clearFilters();
    });
    await waitFor(() => {
      expect(screen.getByText(/共 3 条账单/)).toBeInTheDocument();
    });
  });
});
