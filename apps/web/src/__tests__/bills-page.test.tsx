/**
 * 账单列表页面测试。
 *
 * 覆盖需求：A-09（按本地日历日分组、方向 / 关键词 / 日期区间筛选、一键清空）。
 *
 * 说明：页面依赖 `useVault` 提供的平台运行时（会真的去 IndexedDB 取数据），
 * 因此这里把 `useVault` 打桩成返回固定账单的假运行时，
 * 但**保留真实的 `useBillList`**，从而真正验证分组与筛选逻辑。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Table, TableBody } from '@mui/material';
import type { Bill, Category } from '@lifehub/core';
import { BillsPage } from '@/pages/BillsPage';
import { BillStatsPage } from '@/pages/BillStatsPage';
import { BillRow } from '@/components/bills/BillRow';
import { BillEditDialog } from '@/components/bills/BillEditDialog';
import { NAIVE_TZ_MIGRATION_KEY } from '@/hooks/useBillList';
import { clearRememberedCategoryMap, lookupRememberedCategoryId } from '@/lib/category-memory';
import { EMPTY_FILTERS, useBillStore } from '@/store/bill-store';
import { useSettingsStore } from '@/store/settings-store';
import { formatCompactYuan } from '@/utils/format';
import { makeBill } from '@/__tests__/test-utils/fixtures';

/**
 * 打桩用的假运行时与账单集合。
 *
 * 说明：必须用 `vi.hoisted` 提前创建并保持**引用稳定**——
 * 若每次渲染都返回新的 runtime 对象，`useBillList` 的 reload 依赖会持续变化，
 * 从而触发无限重渲染。
 */
const { FAKE_RUNTIME } = vi.hoisted(() => {
  const bills: Bill[] = [
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
    FAKE_RUNTIME: {
      billRepository: {
        list: async () => bills,
        put: vi.fn<(bill: Bill) => Promise<void>>().mockResolvedValue(),
        clearAll: vi.fn<() => Promise<number>>().mockResolvedValue(3),
      },
      categoryRepository: {
        list: async () => [
          {
            id: 'sys-cat-food',
            name: '餐饮美食',
            kind: 'expense' as const,
            parentId: null,
            color: '#DC2626',
            icon: 'restaurant',
            isSystem: true,
            sortOrder: 100,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
            version: 1,
            deviceId: 'test-device',
          },
          {
            id: 'sys-cat-transport',
            name: '交通出行',
            kind: 'expense' as const,
            parentId: null,
            color: '#EA580C',
            icon: 'commute',
            isSystem: true,
            sortOrder: 200,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
            version: 1,
            deviceId: 'test-device',
          },
        ],
      },
      importBatchRepository: {
        list: async () => [],
        delete: vi.fn<() => Promise<void>>().mockResolvedValue(),
      },
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
// 这里换成普通列表，保留「每条账单渲染一行交易对方」及快速选择分类触发器的语义。
vi.mock('@/components/bills/BillVirtualList', () => ({
  BillVirtualList: ({
    bills,
    categories,
    onQuickSelectCategory,
  }: {
    bills: Bill[];
    categories?: readonly Category[];
    onQuickSelectCategory?: (bill: Bill, categoryId: string | null) => void;
  }) => (
    <ul data-testid="bill-virtual-list">
      {bills.map((item) => (
        <li key={item.id}>
          <span>{item.counterparty}</span>
          {onQuickSelectCategory && categories && categories.length > 0 ? (
            <button
              type="button"
              data-testid={`mock-quick-cat-${item.id}`}
              onClick={() => onQuickSelectCategory(item, categories[0]?.id ?? null)}
            >
              快速归入首分类
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  ),
}));

describe('BillsPage', () => {
  beforeEach(() => {
    useSettingsStore.getState().setTimezone('Asia/Shanghai');
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

    // 按备注（账单内容）搜索「拿铁」命中星巴克账单
    act(() => {
      useBillStore.getState().setFilters({ keyword: '拿铁' });
    });
    await waitFor(
      () => {
        expect(screen.getByText('星巴克')).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
    expect(screen.queryByText('便利店')).not.toBeInTheDocument();

    // 按金额搜索「35.50」命中星巴克账单
    act(() => {
      useBillStore.getState().setFilters({ keyword: '35.50' });
    });
    await waitFor(
      () => {
        expect(screen.getByText(/共 1 条账单/)).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
    expect(screen.getByText('星巴克')).toBeInTheDocument();
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

  it('渲染收支统计与可视化分析看板（KPI 指标卡、支出分类占比环形图、每日收支柱状图）并支持折叠/展开', async () => {
    render(<BillsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('bill-visual-dashboard')).toBeInTheDocument();
    });

    expect(screen.getByTestId('kpi-total-expense')).toHaveTextContent('¥47.50');
    expect(screen.getByTestId('kpi-total-income')).toHaveTextContent('¥50.00');
    expect(screen.getByTestId('kpi-net-balance')).toHaveTextContent('+¥2.50');
    expect(screen.getByTestId('kpi-record-count')).toHaveTextContent('3 条记录');
    expect(screen.getByRole('img', { name: '支出分类占比环形图' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '近期每日收支对比柱状图' })).toBeInTheDocument();

    const toggleBtn = screen.getByTestId('toggle-visual-dashboard');
    await act(async () => {
      toggleBtn.click();
    });
    expect(screen.queryByTestId('bill-visual-charts')).not.toBeInTheDocument();
  });

  it('支持顶部「清空全部账单」按钮及二次确认弹窗', async () => {
    render(<BillsPage />);
    const clearBtn = await screen.findByTestId('clear-all-bills-button');
    expect(clearBtn).toHaveTextContent('清空全部账单');

    await act(async () => {
      clearBtn.click();
    });

    expect(await screen.findByText('清空全部账单？')).toBeInTheDocument();
    const confirmBtn = screen.getByRole('button', { name: '确认清空' });
    await act(async () => {
      confirmBtn.click();
    });

    await waitFor(() => {
      expect(FAKE_RUNTIME.billRepository.clearAll).toHaveBeenCalledTimes(1);
    });
  });

  it('自动剔除内部转账流水不计入收支 KPI，并支持跨卡互转配对横幅与统计口径切换', async () => {
    render(<BillsPage />);
    await waitFor(() => {
      expect(screen.getByText(/共 3 条账单/)).toBeInTheDocument();
    });

    // 注入一组跨卡同名转账流水（卡 A 转出 200.00 元 + 卡 B 他行转入 200.00 元）与原来的 3 条常规账单
    act(() => {
      const baseBills = useBillStore.getState().bills;
      useBillStore.getState().setBills([
        ...baseBills,
        {
          id: 'tx-out',
          amountMinor: 20000,
          currency: 'CNY',
          direction: 'expense',
          occurredAt: '2024-01-16T10:00:00.000Z',
          localDate: '2024-01-16',
          sourceTimeZone: 'Asia/Shanghai',
          counterparty: '本人储蓄卡（尾号8888）',
          categoryId: null,
          note: '跨行转出',
          sourceFileId: 'batch-card-a',
          sourceRowIndex: 0,
          createdAt: '2024-01-16T10:00:00.000Z',
          updatedAt: '2024-01-16T10:00:00.000Z',
          version: 1,
          deviceId: 'test-device',
        },
        {
          id: 'tx-in',
          amountMinor: 20000,
          currency: 'CNY',
          direction: 'income',
          occurredAt: '2024-01-16T10:01:00.000Z',
          localDate: '2024-01-16',
          sourceTimeZone: 'Asia/Shanghai',
          counterparty: '招商银行',
          categoryId: null,
          note: '他行转入',
          sourceFileId: 'batch-card-b',
          sourceRowIndex: 0,
          createdAt: '2024-01-16T10:01:00.000Z',
          updatedAt: '2024-01-16T10:01:00.000Z',
          version: 1,
          deviceId: 'test-device',
        },
      ]);
    });

    // 默认剔除内部转账：累计支出仍为 ¥47.50、累计收入仍为 ¥50.00，未被 200 元倒卡流水虚增！
    expect(await screen.findByTestId('excluded-transfer-summary')).toHaveTextContent(
      '已自动剔除 2 条内部转账/倒卡流水',
    );
    expect(screen.getByTestId('kpi-total-expense')).toHaveTextContent('¥47.50');
    expect(screen.getByTestId('kpi-total-income')).toHaveTextContent('¥50.00');

    // 跨卡互转配对横幅出现
    expect(screen.getByTestId('transfer-pair-banner')).toHaveTextContent(
      '检测到 1 组疑似跨卡/本人互转流水',
    );

    // 点击「已剔除内部转账」切换按钮后，可将内部转账临时纳入统计查看
    const excludeToggle = screen.getByTestId('exclude-transfers-toggle');
    await act(async () => {
      excludeToggle.click();
    });
    expect(screen.getByTestId('kpi-total-expense')).toHaveTextContent('¥247.50');
    expect(screen.getByTestId('kpi-total-income')).toHaveTextContent('¥250.00');

    // 点击「一键标记为内部转账（不计收支）」按钮，触发落库更新
    const markBtn = screen.getByTestId('mark-transfer-pairs-button');
    await act(async () => {
      markBtn.click();
    });
    expect(FAKE_RUNTIME.billRepository.put).toHaveBeenCalledTimes(2);
  });

  it('趋势图取消 7 天截断、支持跨月自动按月聚合与粒度手动切换，并在每根柱子顶部直接展示紧凑金额（T-Chart-Trend-1）', async () => {
    // 验证紧凑金额格式化纯整数计算
    expect(formatCompactYuan(32850)).toBe('¥328.50');
    expect(formatCompactYuan(32800)).toBe('¥328');
    expect(formatCompactYuan(1330000)).toBe('¥1.33万');

    render(<BillsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('bill-visual-dashboard')).toBeInTheDocument();
    });

    // 注入跨越 3 个月份（2025-10, 2025-11, 2025-12）且共 9 个不同日期的账单
    const multiMonthBills: Bill[] = [
      makeBill({ id: 'm1', localDate: '2025-10-01', occurredAt: '2025-10-01T10:00:00.000Z', direction: 'expense', amountMinor: 10000, counterparty: '十月餐饮1' }),
      makeBill({ id: 'm2', localDate: '2025-10-05', occurredAt: '2025-10-05T10:00:00.000Z', direction: 'expense', amountMinor: 20000, counterparty: '十月餐饮2' }),
      makeBill({ id: 'm3', localDate: '2025-10-12', occurredAt: '2025-10-12T10:00:00.000Z', direction: 'expense', amountMinor: 30000, counterparty: '十月餐饮3' }),
      makeBill({ id: 'm4', localDate: '2025-11-02', occurredAt: '2025-11-02T10:00:00.000Z', direction: 'expense', amountMinor: 40000, counterparty: '十一月购物1' }),
      makeBill({ id: 'm5', localDate: '2025-11-15', occurredAt: '2025-11-15T10:00:00.000Z', direction: 'income', amountMinor: 1330000, counterparty: '十一月工资' }),
      makeBill({ id: 'm6', localDate: '2025-11-20', occurredAt: '2025-11-20T10:00:00.000Z', direction: 'expense', amountMinor: 50000, counterparty: '十一月购物2' }),
      makeBill({ id: 'm7', localDate: '2025-12-01', occurredAt: '2025-12-01T10:00:00.000Z', direction: 'expense', amountMinor: 60000, counterparty: '十二月消费1' }),
      makeBill({ id: 'm8', localDate: '2025-12-08', occurredAt: '2025-12-08T10:00:00.000Z', direction: 'expense', amountMinor: 70000, counterparty: '十二月消费2' }),
      makeBill({ id: 'm9', localDate: '2025-12-19', occurredAt: '2025-12-19T10:00:00.000Z', direction: 'expense', amountMinor: 80000, counterparty: '十二月消费3' }),
    ];

    act(() => {
      useBillStore.getState().setBills(multiMonthBills);
    });

    // 跨多月时，自动粒度（auto）应自动命中「按月统计 · 共 3 个月」
    await waitFor(() => {
      expect(screen.getByTestId('trend-chart-title')).toHaveTextContent(
        '收支趋势（按月统计 · 共 3 个月）',
      );
    });
    expect(screen.getByTestId('trend-granularity-auto')).toHaveTextContent('自动（按月）');

    // 验证柱子顶部直接展示紧凑金额（无需悬停即可看到 ¥600、¥1.33万、¥2100 等）
    const barValues = screen.getAllByTestId('trend-bar-value').map((el) => el.textContent);
    expect(barValues).toContain('¥600');
    expect(barValues).toContain('¥1.33万');
    expect(barValues).toContain('¥2100');

    // 手动切换到「按天显示」：9 个日期全部渲染，绝不截断为 7 天！
    await act(async () => {
      screen.getByTestId('trend-granularity-day').click();
    });
    expect(screen.getByTestId('trend-chart-title')).toHaveTextContent(
      '收支趋势（按日统计 · 共 9 天）',
    );
    expect(screen.getByTestId('trend-bucket-2025-10-01')).toBeInTheDocument();
    expect(screen.getByTestId('trend-bucket-2025-12-19')).toBeInTheDocument();
  });

  it('支持月度预算设置与超支预警提示，以及一键导出当前筛选账单为 CSV / JSON（T-Bookkeeping-Complete-1）', async () => {
    act(() => {
      useSettingsStore.getState().setMonthlyBudgetCents(500000);
    });
    render(<BillsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('monthly-budget-card')).toBeInTheDocument();
    });

    // 初始支出 ¥47.50，预算 ¥5000.00，处于安全充裕状态
    expect(screen.getByTestId('budget-status-badge')).toHaveTextContent('预算充裕');

    // 点击「设置预算」改为 30 元（3000 分），触发超支预警
    await act(async () => {
      screen.getByTestId('edit-budget-button').click();
    });
    fireEvent.change(screen.getByTestId('budget-input'), { target: { value: '30' } });
    await act(async () => {
      screen.getByTestId('save-budget-button').click();
    });

    expect(useSettingsStore.getState().monthlyBudgetCents).toBe(3000);
    expect(screen.getByTestId('budget-status-badge')).toHaveTextContent('已超支 ¥17.50');

    // 点击「导出 CSV」与「导出 JSON」按钮，触发导出并展示成功横幅
    await act(async () => {
      screen.getByTestId('export-bills-button').click();
    });
    expect(screen.getByTestId('export-success-banner')).toHaveTextContent(
      '已成功导出 3 条账单记录（CSV 格式）',
    );

    await act(async () => {
      screen.getByTestId('export-bills-json-button').click();
    });
    expect(screen.getByTestId('export-success-banner')).toHaveTextContent(
      '已成功导出 3 条账单记录（JSON 格式）',
    );
  });

  it('切换设置中的默认时区（如 America/New_York / Asia/Tokyo）时，账单列表日期分组动态按目标时区重算（T-Timezone-Unify-1）', async () => {
    render(<BillsPage />);
    await waitFor(() => {
      expect(screen.getByText(/共 3 条账单/)).toBeInTheDocument();
    });

    // 注入一笔 UTC 2026-10-20T22:30:00.000Z 的账单：
    // 在 America/New_York (UTC-4) 下属于 2026-10-20 18:30；
    // 在 Asia/Tokyo (UTC+9) 下属于 2026-10-21 07:30。
    act(() => {
      useBillStore.getState().setBills([
        makeBill({
          id: 'tz-cross-1',
          occurredAt: '2026-10-20T22:30:00.000Z',
          localDate: '2026-10-20',
          sourceTimeZone: 'America/New_York',
          counterparty: '跨日测试商户',
          amountMinor: 8800,
          direction: 'expense',
        }),
      ]);
      useSettingsStore.getState().setTimezone('America/New_York');
    });

    await waitFor(() => {
      expect(screen.getByText(/2026年10月20日/)).toBeInTheDocument();
    });

    act(() => {
      useSettingsStore.getState().setTimezone('Asia/Tokyo');
    });

    await waitFor(() => {
      expect(screen.getByText(/2026年10月21日/)).toBeInTheDocument();
    });
  });

  it('支出分类构成（Top 6）在百分比后展示具体金额，且收支方向与分类筛选栏均支持多选（T-Top6-Amount-And-MultiSelect-1）', async () => {
    render(<BillsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('bill-visual-dashboard')).toBeInTheDocument();
    });

    // 注入 3 条不同分类/方向的账单：
    // 1. 餐饮美食 支出 ¥70.00（7000 分，占支出 70.0%）
    // 2. 交通出行 支出 ¥30.00（3000 分，占支出 30.0%）
    // 3. 未分类   收入 ¥200.00（20000 分）
    // 4. 退款     退款 ¥15.00（1500 分，购物消费）
    act(() => {
      useBillStore.getState().setBills([
        makeBill({
          id: 'cat-b1',
          amountMinor: 7000,
          direction: 'expense',
          categoryId: 'sys-cat-food',
          counterparty: '海底捞',
          localDate: '2024-01-18',
          occurredAt: '2024-01-18T12:00:00.000Z',
        }),
        makeBill({
          id: 'cat-b2',
          amountMinor: 3000,
          direction: 'expense',
          categoryId: 'sys-cat-transport',
          counterparty: '滴滴出行',
          localDate: '2024-01-18',
          occurredAt: '2024-01-18T14:00:00.000Z',
        }),
        makeBill({
          id: 'cat-b3',
          amountMinor: 20000,
          direction: 'income',
          categoryId: null,
          counterparty: '兼职稿费',
          localDate: '2024-01-18',
          occurredAt: '2024-01-18T16:00:00.000Z',
        }),
        makeBill({
          id: 'cat-b4',
          amountMinor: 1500,
          direction: 'refund',
          categoryId: 'sys-cat-shopping',
          counterparty: '淘宝退款',
          localDate: '2024-01-18',
          occurredAt: '2024-01-18T18:00:00.000Z',
        }),
      ]);
    });

    // 1. 验证「支出分类构成（Top 6）」每一项同时展示百分比与金额（如 70.0% · ¥70.00、30.0% · ¥30.00）
    await waitFor(() => {
      const sliceStats = screen.getAllByTestId('category-slice-stat').map((el) => el.textContent);
      expect(sliceStats).toContain('70.0% · ¥70.00');
      expect(sliceStats).toContain('30.0% · ¥30.00');
    });

    // 2. 验证「收支方向」支持多选（同时勾选 income + refund）：只保留「兼职稿费」与「淘宝退款」共 2 条
    act(() => {
      useBillStore.getState().setFilters({ directions: ['income', 'refund'] });
    });
    await waitFor(() => {
      expect(screen.getByText(/共 2 条账单/)).toBeInTheDocument();
    });
    expect(screen.getByText('兼职稿费')).toBeInTheDocument();
    expect(screen.getByText('淘宝退款')).toBeInTheDocument();
    expect(screen.queryByText('海底捞')).not.toBeInTheDocument();
    expect(screen.getByTestId('bill-filter-bar')).toHaveTextContent('收入、退款');

    // 3. 验证「分类」支持多选（同时勾选 餐饮美食 sys-cat-food + 未分类 __uncategorized__）：
    // 先恢复方向为不限，再多选两个分类，应命中「海底捞」与「兼职稿费」共 2 条
    act(() => {
      useBillStore.getState().setFilters({
        directions: [],
        categoryIds: ['sys-cat-food', '__uncategorized__'],
      });
    });
    await waitFor(() => {
      expect(screen.getByText(/共 2 条账单/)).toBeInTheDocument();
    });
    expect(screen.getByText('海底捞')).toBeInTheDocument();
    expect(screen.getByText('兼职稿费')).toBeInTheDocument();
    expect(screen.queryByText('滴滴出行')).not.toBeInTheDocument();
    expect(screen.getByTestId('bill-filter-bar')).toHaveTextContent('餐饮美食、未分类');
  });

  it('T-Category-Memory-1 · 支持行内点击分类快速归类、记住相同项分类选择、批量更新存量相同未分类账单及弹窗智能回填', async () => {
    clearRememberedCategoryMap();
    const foodCategory: Category = {
      id: 'sys-cat-food',
      name: '餐饮美食',
      kind: 'expense',
      parentId: null,
      color: '#DC2626',
      icon: 'restaurant',
      isSystem: true,
      sortOrder: 100,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      version: 1,
      deviceId: 'test-device',
    };

    // 1. 验证真实 BillRow 行内快速分类选择器（点击分类单元格弹出 quick-category-menu 并触发回调）
    const onQuickSelectSpy = vi.fn();
    const rowBill = makeBill({
      id: 'row-inline-1',
      counterparty: '山野咖啡工作室',
      categoryId: null,
    });
    const { unmount: unmountRow } = render(
      <Table>
        <TableBody>
          <BillRow
            bill={rowBill}
            categoryNames={{ 'sys-cat-food': '餐饮美食' }}
            sourceFileNames={{}}
            categories={[foodCategory]}
            onQuickSelectCategory={onQuickSelectSpy}
          />
        </TableBody>
      </Table>,
    );
    await act(async () => {
      screen.getByTestId('bill-category-trigger-row-inline-1').click();
    });
    expect(await screen.findByTestId('quick-category-menu')).toBeInTheDocument();
    await act(async () => {
      screen.getByTestId('quick-category-option-sys-cat-food').click();
    });
    expect(onQuickSelectSpy).toHaveBeenCalledWith(rowBill, 'sys-cat-food');
    unmountRow();

    // 2. 验证 BillsPage 中选择分类后记住选择并自动将存量相同未分类账单（共 3 条同商户未分类账单）一并归入目标分类
    const dynamicBills: Bill[] = [
      makeBill({
        id: 'same-cp-1',
        counterparty: '阿婆手作水饺',
        categoryId: null,
        amountMinor: 1800,
        localDate: '2024-01-15',
        occurredAt: '2024-01-15T11:30:00.000Z',
      }),
      makeBill({
        id: 'same-cp-2',
        counterparty: '阿婆手作水饺',
        categoryId: null,
        amountMinor: 2200,
        localDate: '2024-01-16',
        occurredAt: '2024-01-16T12:00:00.000Z',
      }),
      makeBill({
        id: 'same-cp-3',
        counterparty: '阿婆手作水饺',
        categoryId: null,
        amountMinor: 2500,
        localDate: '2024-01-17',
        occurredAt: '2024-01-17T18:10:00.000Z',
      }),
    ];
    const origList = FAKE_RUNTIME.billRepository.list;
    FAKE_RUNTIME.billRepository.list = async () => dynamicBills;
    FAKE_RUNTIME.billRepository.put.mockImplementation(async (updated: Bill) => {
      const idx = dynamicBills.findIndex((b) => b.id === updated.id);
      if (idx >= 0) {
        dynamicBills[idx] = updated;
      } else {
        dynamicBills.push(updated);
      }
    });

    const { unmount: unmountPage } = render(<BillsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('mock-quick-cat-same-cp-1')).toBeInTheDocument();
    });

    await act(async () => {
      screen.getByTestId('mock-quick-cat-same-cp-1').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('category-memory-banner')).toBeInTheDocument();
    });
    expect(screen.getByTestId('category-memory-banner')).toHaveTextContent(
      '已记住「阿婆手作水饺 → 餐饮美食」，并自动将另外 2 条相同未分类账单归入该分类',
    );
    expect(dynamicBills.every((b) => b.categoryId === 'sys-cat-food')).toBe(true);
    expect(lookupRememberedCategoryId({ counterparty: '阿婆手作水饺', note: '' })).toBe(
      'sys-cat-food',
    );
    unmountPage();
    FAKE_RUNTIME.billRepository.list = origList;

    // 3. 验证 BillEditDialog 默认勾选 remember-category-checkbox，且输入已记住的交易对方时自动回填分类
    const onSubmitDialog = vi.fn().mockResolvedValue(true);
    render(
      <BillEditDialog
        open
        initial={null}
        categories={[foodCategory]}
        onClose={vi.fn()}
        onSubmit={onSubmitDialog}
      />,
    );
    expect(screen.getByTestId('remember-category-checkbox')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('金额（元）'), { target: { value: '19.5' } });
    fireEvent.change(screen.getByLabelText('交易对方'), { target: { value: '阿婆手作水饺' } });

    await act(async () => {
      screen.getByRole('button', { name: '记一笔' }).click();
    });
    expect(onSubmitDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        counterparty: '阿婆手作水饺',
        categoryId: 'sys-cat-food',
      }),
      { rememberCategory: true },
    );
  });

  it('T-Date-Timezone-And-BackToTop-1：账单页渲染「回到顶部」按钮并触发滚动，且自动修复历史误存为 UTC 的 16:00 后跨天导入账单', async () => {
    localStorage.removeItem(NAIVE_TZ_MIGRATION_KEY);

    const legacyImportedBills: Bill[] = [
      makeBill({
        id: 'boc-first-legacy',
        amountMinor: 2118,
        direction: 'income',
        counterparty: '张三',
        note: '银联入账(余额提现100000000000001)',
        occurredAt: '2026-10-27T16:14:57.000Z',
        localDate: '2026-10-28',
        sourceTimeZone: 'Asia/Shanghai',
        sourceFileId: 'batch-boc',
      }),
    ];

    const origList = FAKE_RUNTIME.billRepository.list;
    const putManySpy = vi.fn<(items: readonly Bill[]) => Promise<void>>().mockResolvedValue();
    FAKE_RUNTIME.billRepository.list = async () => legacyImportedBills;
    (FAKE_RUNTIME.billRepository as { putMany?: typeof putManySpy }).putMany = putManySpy;

    const scrollToSpy = vi.fn();
    const origScrollTo = window.scrollTo;
    window.scrollTo = scrollToSpy as unknown as typeof window.scrollTo;

    try {
      render(<BillsPage />);

      // 1. 验证一次性自动迁移将 2026-10-28 修复回 2026-10-27，且写入持久化层
      await waitFor(() => {
        expect(putManySpy).toHaveBeenCalledTimes(1);
      });
      const migratedBatch = putManySpy.mock.calls[0]?.[0] ?? [];
      expect(migratedBatch[0]?.localDate).toBe('2026-10-27');
      expect(migratedBatch[0]?.occurredAt).toBe('2026-10-27T08:14:57.000Z');
      expect(localStorage.getItem(NAIVE_TZ_MIGRATION_KEY)).toBe('1');
      expect(screen.getByText(/2026年10月27日/)).toBeInTheDocument();
      expect(screen.queryByText(/2026年10月28日/)).not.toBeInTheDocument();

      // 2. 验证「回到顶部」按钮存在且点击后触发 window.scrollTo 与容器 scrollTop 归零
      const backToTopBtn = screen.getByTestId('back-to-top-button');
      expect(backToTopBtn).toBeInTheDocument();

      document.documentElement.scrollTop = 320;
      document.body.scrollTop = 320;
      fireEvent.click(backToTopBtn);

      expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
      expect(document.documentElement.scrollTop).toBe(0);
      expect(document.body.scrollTop).toBe(0);
    } finally {
      window.scrollTo = origScrollTo;
      FAKE_RUNTIME.billRepository.list = origList;
      delete (FAKE_RUNTIME.billRepository as { putMany?: typeof putManySpy }).putMany;
    }
  });

  it('将第一页顶部导入账单按钮替换为「收支统计」（跳转至独立可视化统计页 #/stats），且点击某日账单可弹出当日记录明细弹窗', async () => {
    const { unmount } = render(<BillsPage />);
    await waitFor(() => {
      expect(screen.getByText(/共 3 条账单/)).toBeInTheDocument();
    });

    // 1. 验证原 mobile-go-import-button 已替换为 go-bill-stats-button「收支统计」
    expect(screen.queryByTestId('mobile-go-import-button')).not.toBeInTheDocument();
    const statsBtn = screen.getByTestId('go-bill-stats-button');
    expect(statsBtn).toHaveTextContent('收支统计');
    fireEvent.click(statsBtn);
    expect(window.location.hash).toBe('#/stats');

    // 2. 点击 2024-01-15 的「查看明细 ▸」按钮弹出当日账单明细弹窗，展示当日共记录几笔及每笔明细
    fireEvent.click(screen.getByTestId('view-daily-detail-2024-01-15'));
    const detailDialog = await screen.findByTestId('daily-bill-detail-dialog');
    expect(detailDialog).toHaveTextContent('当天共记录 2 笔');
    expect(screen.getByTestId('daily-detail-item-b1')).toHaveTextContent('星巴克');
    expect(screen.getByTestId('daily-detail-item-b1')).toHaveTextContent('拿铁');
    expect(screen.getByTestId('daily-detail-item-b2')).toHaveTextContent('便利店');
    unmount();

    // 3. 验证独立收支统计页面 BillStatsPage 正常渲染可视化分析图表并支持返回账单页
    render(<BillStatsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('bill-stats-page')).toBeInTheDocument();
      expect(screen.getByTestId('bill-visual-dashboard')).toBeInTheDocument();
    });
    expect(screen.getByRole('img', { name: '支出分类占比环形图' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('back-to-bills-button'));
    expect(window.location.hash).toBe('#/bills');
  });
});
