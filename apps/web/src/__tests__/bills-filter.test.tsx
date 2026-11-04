/**
 * 账单列表页的筛选与分组行为测试（A-09）。
 *
 * 覆盖需求：A-09 ①（搜索 200ms 防抖）、A-09 ②（方向 / 日期区间 / 分类可组合筛选 +
 * 一键清空）、A-09 ③（按 localDate 分组，组头显示日期 + 星期 + 笔数 + 合计）、
 * A-09 ④（列表按 occurredAt 倒序、空结果给中文空状态）。
 *
 * 说明：
 * 1. `useVault` 打桩成**引用稳定**的假运行时（否则 `useBillList` 的 reload 依赖会持续变化，
 *    触发无限重渲染）；但**保留真实的 `useBillList`**，从而真正验证分组与筛选逻辑；
 * 2. 虚拟列表依赖真实滚动容器尺寸，在 jsdom 中不稳定，因此换成普通列表替身，
 *    但替身保留「每条账单一个可定位节点 + 原始时间戳」的语义，
 *    以便断言**排序**（而不只是断言渲染没崩）。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bill } from '@lifehub/core';
import { BillsPage } from '@/pages/BillsPage';
import { EMPTY_FILTERS, useBillStore } from '@/store/bill-store';

/** 打桩用的假账单集合与假运行时。 */
const { FAKE_BILLS, FAKE_CATEGORIES, FAKE_RUNTIME } = vi.hoisted(() => {
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
      categoryId: 'cat-salary',
      note: '月薪',
      sourceFileId: 'batch-1',
      sourceRowIndex: 2,
      createdAt: '2024-01-16T09:00:00.000Z',
      updatedAt: '2024-01-16T09:00:00.000Z',
      version: 1,
      deviceId: 'test-device',
    },
    {
      id: 'b4',
      amountMinor: 800,
      currency: 'CNY',
      direction: 'expense',
      occurredAt: '2024-01-16T20:30:00.000Z',
      localDate: '2024-01-16',
      sourceTimeZone: 'Asia/Shanghai',
      counterparty: '地铁',
      categoryId: 'cat-transport',
      note: '通勤',
      sourceFileId: 'batch-1',
      sourceRowIndex: 3,
      createdAt: '2024-01-16T20:30:00.000Z',
      updatedAt: '2024-01-16T20:30:00.000Z',
      version: 1,
      deviceId: 'test-device',
    },
  ];
  const categories = [
    { id: 'cat-salary', name: '工资' },
    { id: 'cat-transport', name: '交通' },
  ];
  return {
    FAKE_BILLS: bills,
    FAKE_CATEGORIES: categories,
    FAKE_RUNTIME: {
      // 这两个方法在测试里可替换，用于模拟「空数据」等场景。
      billRepository: { list: async (): Promise<unknown[]> => bills },
      categoryRepository: { list: async (): Promise<unknown[]> => categories },
    },
  };
});

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

vi.mock('@/components/bills/BillVirtualList', () => ({
  BillVirtualList: ({ bills }: { bills: Bill[] }) => (
    <ul data-testid="bill-virtual-list">
      {bills.map((item) => (
        <li key={item.id} data-testid={`bill-item-${item.id}`} data-occurred-at={item.occurredAt}>
          {item.counterparty}
        </li>
      ))}
    </ul>
  ),
}));

/**
 * 取得当前渲染出来的账单顺序（按 DOM 顺序）。
 *
 * @returns 交易对方名称数组
 */
function renderedOrder(): string[] {
  return screen
    .getAllByTestId(/^bill-item-/)
    .map((node) => node.textContent ?? '');
}

/**
 * 在搜索框中输入关键词。
 *
 * @param keyword 关键词
 * @returns 无异常
 */
function typeKeyword(keyword: string): void {
  const input = screen.getByLabelText('搜索对方或备注');
  fireEvent.change(input, { target: { value: keyword } });
}

describe('BillsPage 筛选与分组（A-09）', () => {
  beforeEach(() => {
    // 复位可能被上个用例替换掉的运行时数据源。
    FAKE_RUNTIME.billRepository.list = async () => FAKE_BILLS;
    FAKE_RUNTIME.categoryRepository.list = async () => FAKE_CATEGORIES;
    useBillStore.setState({
      bills: [],
      filters: { ...EMPTY_FILTERS },
      loading: false,
      error: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('按 localDate 分组，组头显示中文日期、星期、笔数与收支合计', async () => {
    render(<BillsPage />);

    await waitFor(() => {
      expect(screen.getByText(/共 4 条账单/)).toBeInTheDocument();
    });

    // 2024-01-15 是星期一，2024-01-16 是星期二。
    expect(screen.getByText(/2024年1月15日 · 星期一/)).toBeInTheDocument();
    expect(screen.getByText(/2024年1月16日 · 星期二/)).toBeInTheDocument();

    // 每组笔数。
    expect(screen.getAllByText(/2 笔/)).toHaveLength(2);

    // 2024-01-15 组：支出 3550 + 1200 = 4750 分；收入 0。
    expect(screen.getByText('支出 ¥47.50')).toBeInTheDocument();
    // 2024-01-16 组：支出 800 分、收入 5000 分。
    expect(screen.getByText('收入 ¥50.00')).toBeInTheDocument();
    expect(screen.getByText('支出 ¥8.00')).toBeInTheDocument();
  });

  it('列表按 occurredAt 倒序（日期分组倒序、组内时间倒序）', async () => {
    render(<BillsPage />);

    await waitFor(() => {
      expect(screen.getByText(/共 4 条账单/)).toBeInTheDocument();
    });

    // 分组按 localDate 倒序：2024-01-16 在前，2024-01-15 在后。
    const order = renderedOrder();
    expect(order).toEqual(['地铁', '工资', '便利店', '星巴克']);

    // 组内按 occurredAt 倒序：01-16 组内 20:30（地铁）排在 09:00（工资）之前；
    // 01-15 组内 12:00（便利店）排在 08:12（星巴克）之前。
    const stamps = screen.getAllByTestId(/^bill-item-/).map((node) => node.getAttribute('data-occurred-at'));
    expect(stamps).toEqual([
      '2024-01-16T20:30:00.000Z',
      '2024-01-16T09:00:00.000Z',
      '2024-01-15T12:00:00.000Z',
      '2024-01-15T08:12:00.000Z',
    ]);
  });

  it('搜索输入在 200ms 防抖窗口内不生效，超过 200ms 后才过滤', async () => {
    render(<BillsPage />);
    await waitFor(() => {
      expect(screen.getByText(/共 4 条账单/)).toBeInTheDocument();
    });

    // 切换到假定时器，精确控制防抖窗口。
    vi.useFakeTimers();
    typeKeyword('星巴克');

    // 尚未到 200ms：结果不变。
    await act(async () => {
      vi.advanceTimersByTime(199);
    });
    expect(screen.getByText(/共 4 条账单/)).toBeInTheDocument();

    // 到达 200ms：防抖值生效，只剩 1 条。
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText(/共 1 条账单/)).toBeInTheDocument();
    expect(screen.queryByText('便利店')).not.toBeInTheDocument();
  });

  it('连续输入时只有最后一个关键词生效（防抖会重置计时）', async () => {
    render(<BillsPage />);
    await waitFor(() => {
      expect(screen.getByText(/共 4 条账单/)).toBeInTheDocument();
    });

    vi.useFakeTimers();
    typeKeyword('星');
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    typeKeyword('地铁');
    await act(async () => {
      vi.advanceTimersByTime(199);
    });
    // 计时器被重置，尚未到 200ms，结果仍为全部。
    expect(screen.getByText(/共 4 条账单/)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText(/共 1 条账单/)).toBeInTheDocument();
    expect(screen.getByText('地铁')).toBeInTheDocument();
  });

  it('关键词同时命中交易对方与备注', async () => {
    render(<BillsPage />);
    await waitFor(() => {
      expect(screen.getByText(/共 4 条账单/)).toBeInTheDocument();
    });

    // 「拿铁」只出现在星巴克这笔的备注里。
    act(() => {
      useBillStore.getState().setFilters({ keyword: '拿铁' });
    });
    await waitFor(
      () => {
        expect(screen.getByText(/共 1 条账单/)).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
    expect(screen.getByText('星巴克')).toBeInTheDocument();

    // 金额、日期、方向关键词同样可搜索命中。
    act(() => {
      useBillStore.getState().setFilters({ keyword: '50.00' });
    });
    await waitFor(
      () => {
        expect(screen.getByText('工资')).toBeInTheDocument();
        expect(screen.queryByText('星巴克')).not.toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    act(() => {
      useBillStore.getState().setFilters({ keyword: '支出' });
    });
    await waitFor(
      () => {
        expect(screen.getByText(/共 3 条账单/)).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  /**
   * 组合筛选（PRD A-09 ②③）：方向 / 日期区间 / 分类可叠加，
   * 且叠加到无匹配时显示「共 0 条账单」，而不是切到「还没有账单」空状态。
   */
  it('方向 + 日期区间 + 分类可组合筛选', async () => {
    render(<BillsPage />);
    await waitFor(() => {
      expect(screen.getByText(/共 4 条账单/)).toBeInTheDocument();
    });

    // 只保留 2024-01-16 的支出 → 地铁。
    act(() => {
      useBillStore.getState().setFilters({ directions: ['expense'], dateFrom: '2024-01-16', dateTo: '2024-01-16' });
    });
    await waitFor(() => {
      expect(screen.getByText(/共 1 条账单/)).toBeInTheDocument();
    });
    expect(screen.getByText('地铁')).toBeInTheDocument();
    expect(screen.queryByText('工资')).not.toBeInTheDocument();

    // 再叠加分类条件（地铁属于 cat-transport）→ 仍然命中。
    act(() => {
      useBillStore.getState().setFilters({ categoryId: 'cat-transport' });
    });
    await waitFor(() => {
      expect(screen.getByText(/共 1 条账单/)).toBeInTheDocument();
    });
    expect(screen.getByText('地铁')).toBeInTheDocument();

    // 叠加不匹配的分类 → 结果为空。
    act(() => {
      useBillStore.getState().setFilters({ categoryId: 'cat-salary' });
    });
    await waitFor(() => {
      expect(screen.getByText(/共 0 条账单/)).toBeInTheDocument();
    });
  });

  /**
   * 空结果中文空状态（PRD A-09 ④）：筛选后为空显示「没有符合筛选条件的账单」
   * 与底部「共 0 条账单」统计条，而不是切到「还没有账单」或整页留白。
   */
  it('筛选结果为空时显示中文空状态而不是空白页', async () => {
    render(<BillsPage />);
    await waitFor(() => {
      expect(screen.getByText(/共 4 条账单/)).toBeInTheDocument();
    });

    act(() => {
      useBillStore.getState().setFilters({ keyword: '不存在的商家' });
    });

    await waitFor(
      () => {
        expect(screen.getByText('没有符合筛选条件的账单')).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
    expect(screen.getByText('试试调整搜索关键词或清空筛选条件。')).toBeInTheDocument();
    expect(screen.getByText(/共 0 条账单/)).toBeInTheDocument();
  });

  it('「清空筛选」一键恢复全部账单', async () => {
    render(<BillsPage />);
    await waitFor(() => {
      expect(screen.getByText(/共 4 条账单/)).toBeInTheDocument();
    });

    act(() => {
      useBillStore.getState().setFilters({ keyword: '星巴克', directions: ['expense'] });
    });
    await waitFor(
      () => {
        expect(screen.getByText(/共 1 条账单/)).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    fireEvent.click(screen.getByRole('button', { name: '清空筛选' }));

    await waitFor(() => {
      expect(screen.getByText(/共 4 条账单/)).toBeInTheDocument();
    });
    expect(useBillStore.getState().filters).toEqual(EMPTY_FILTERS);
  });

  it('完全没有任何账单时展示「还没有账单」空状态', async () => {
    FAKE_RUNTIME.billRepository.list = async () => [];
    FAKE_RUNTIME.categoryRepository.list = async () => [];

    render(<BillsPage />);
    await waitFor(() => {
      expect(screen.getByText('还没有账单')).toBeInTheDocument();
    });
    expect(screen.getByText(/导入一个 CSV 账单文件/)).toBeInTheDocument();
  });
});
