/**
 * 账单可视化图表看板组件。
 *
 * 架构位置：apps/web 的「账单组件」层。
 *
 * 说明：基于当前筛选后的账单集合（整数分 `amountMinor`）实时计算并渲染：
 * 1. 顶部 4 张核心财务指标卡片（累计支出、累计收入、净收支结余、筛选命中记录）；
 * 2. 月度预算与超支预警卡片（支持内联编辑月度预算、三色进度条与剩余/超支实时计算）；
 * 3. 左侧「支出分类占比」纯 SVG 环形图（Donut Chart）与分类进度条明细；
 * 4. 右侧「收支趋势」双柱状对比图（支持自动/按月/按天粒度切换、取消 7 天截断、每根柱子顶部直接展示紧凑金额）。
 */
import { useMemo, useState } from 'react';
import { Box, Button, ButtonGroup, LinearProgress, Paper, TextField, Typography } from '@mui/material';
import AccountBalanceWalletOutlined from '@mui/icons-material/AccountBalanceWalletOutlined';
import BarChartOutlined from '@mui/icons-material/BarChartOutlined';
import DonutLargeOutlined from '@mui/icons-material/DonutLargeOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import ExpandLessOutlined from '@mui/icons-material/ExpandLessOutlined';
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined';
import SavingsOutlined from '@mui/icons-material/SavingsOutlined';
import SwapHorizOutlined from '@mui/icons-material/SwapHorizOutlined';
import TrendingDownOutlined from '@mui/icons-material/TrendingDownOutlined';
import TrendingUpOutlined from '@mui/icons-material/TrendingUpOutlined';
import { isInternalTransferBill, parseAmountToMinor, type Bill, type Category } from '@lifehub/core';
import { CategoryIcon } from '@/components/common/VisualIcons';
import { useSettingsStore } from '@/store/settings-store';
import { formatAmount, formatCompactYuan } from '@/utils/format';

/** 账单可视化图表看板组件的属性。 */
export interface BillVisualDashboardProps {
  /** 当前筛选后的账单列表。 */
  bills: readonly Bill[];
  /** 分类字典列表（用于展示分类名称、图标与配色）。 */
  categories: readonly Category[];
  /** 是否默认展开全部可视化图表（独立统计页传 true）。 */
  defaultChartsExpanded?: boolean;
}

/** 趋势图时间粒度模式。 */
export type TrendGranularityMode = 'auto' | 'month' | 'day';

/** 环形图分类切片数据。 */
interface CategorySlice {
  /** 分类 ID（未分类为 '__uncategorized__'）。 */
  id: string;
  /** 分类名称。 */
  name: string;
  /** 分类图标标识。 */
  icon: string;
  /** 切片颜色。 */
  color: string;
  /** 该分类累计支出（整数分）。 */
  amountMinor: number;
  /** 占总支出的比例（0 ~ 100）。 */
  percent: number;
  /** 账单记录条数。 */
  count: number;
}

/** 收支趋势柱状图时间桶条目。 */
interface TrendBarItem {
  /** 时间桶唯一键（YYYY-MM 或 YYYY-MM-DD）。 */
  bucketKey: string;
  /** 横轴展示短标签（YYYY-MM 或 MM-DD）。 */
  shortLabel: string;
  /** 当期支出（整数分）。 */
  expenseMinor: number;
  /** 当期收入（整数分）。 */
  incomeMinor: number;
}

/** 默认图表色板。 */
const CHART_PALETTE = [
  '#6366f1',
  '#f97316',
  '#ec4899',
  '#14b8a6',
  '#eab308',
  '#8b5cf6',
  '#06b6d4',
  '#ef4444',
] as const;

/**
 * 计算两个 YYYY-MM-DD 日期字符串之间的自然日跨度。
 *
 * 说明：用于 `auto` 粒度模式下判定筛选账单是否跨越超过 31 天。
 *
 * @param minDate 最小日期 YYYY-MM-DD
 * @param maxDate 最大日期 YYYY-MM-DD
 * @returns 相差天数（非负整数）
 * @throws 无；日期解析异常时返回 0
 */
function computeDaySpan(minDate: string, maxDate: string): number {
  const startMs = Date.parse(`${minDate}T00:00:00Z`);
  const endMs = Date.parse(`${maxDate}T00:00:00Z`);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return 0;
  }
  return Math.round((endMs - startMs) / 86_400_000);
}

/**
 * 渲染账单可视化图表看板。
 *
 * 说明：所有金额汇总均以整数分（`amountMinor`）累加后再通过 `formatAmount` 或 `formatCompactYuan` 格式化，严禁浮点金额解析。
 *
 * @param props 组件属性
 * @returns React 节点；当无账单时返回 null
 * @throws 无；纯展示组件不抛出异常
 */
export function BillVisualDashboard({
  bills,
  categories,
  defaultChartsExpanded,
}: BillVisualDashboardProps) {
  const [expanded, setExpanded] = useState(true);
  const [chartsExpanded, setChartsExpanded] = useState(() =>
    defaultChartsExpanded !== undefined
      ? defaultChartsExpanded
      : typeof window === 'undefined'
        ? true
        : window.innerWidth >= 768,
  );
  const [excludeTransfers, setExcludeTransfers] = useState(true);
  const [granularityMode, setGranularityMode] = useState<TrendGranularityMode>('auto');

  const monthlyBudgetCents = useSettingsStore((state) => state.monthlyBudgetCents);
  const setMonthlyBudgetCents = useSettingsStore((state) => state.setMonthlyBudgetCents);
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInputText, setBudgetInputText] = useState('');
  const [budgetInputError, setBudgetInputError] = useState<string | null>(null);

  const stats = useMemo(() => {
    let totalExpenseMinor = 0;
    let totalIncomeMinor = 0;
    let expenseCount = 0;
    let incomeCount = 0;
    let excludedTransferCount = 0;
    let excludedTransferMinor = 0;

    const categoryMap = new Map<string, Category>();
    for (const cat of categories) {
      categoryMap.set(cat.id, cat);
    }

    const expenseByCat = new Map<string, { amountMinor: number; count: number }>();
    const dailyMap = new Map<string, { expenseMinor: number; incomeMinor: number }>();
    const monthlyMap = new Map<string, { expenseMinor: number; incomeMinor: number }>();
    let minDate = '';
    let maxDate = '';

    for (const bill of bills) {
      const isTransfer = isInternalTransferBill(bill, categoryMap);
      if (isTransfer) {
        excludedTransferCount += 1;
        excludedTransferMinor += bill.amountMinor;
        if (excludeTransfers) {
          continue;
        }
      }

      const monthKey = bill.localDate.slice(0, 7);
      if (!minDate || bill.localDate < minDate) {
        minDate = bill.localDate;
      }
      if (!maxDate || bill.localDate > maxDate) {
        maxDate = bill.localDate;
      }

      const dayEntry = dailyMap.get(bill.localDate) ?? { expenseMinor: 0, incomeMinor: 0 };
      const monthEntry = monthlyMap.get(monthKey) ?? { expenseMinor: 0, incomeMinor: 0 };

      if (bill.direction === 'expense') {
        totalExpenseMinor += bill.amountMinor;
        expenseCount += 1;
        dayEntry.expenseMinor += bill.amountMinor;
        monthEntry.expenseMinor += bill.amountMinor;

        const catKey = bill.categoryId ?? '__uncategorized__';
        const prev = expenseByCat.get(catKey) ?? { amountMinor: 0, count: 0 };
        expenseByCat.set(catKey, {
          amountMinor: prev.amountMinor + bill.amountMinor,
          count: prev.count + 1,
        });
      } else if (bill.direction === 'income') {
        totalIncomeMinor += bill.amountMinor;
        incomeCount += 1;
        dayEntry.incomeMinor += bill.amountMinor;
        monthEntry.incomeMinor += bill.amountMinor;
      }
      dailyMap.set(bill.localDate, dayEntry);
      monthlyMap.set(monthKey, monthEntry);
    }

    const slices: CategorySlice[] = Array.from(expenseByCat.entries())
      .map(([catId, item], idx) => {
        const matched = categoryMap.get(catId);
        const percent =
          totalExpenseMinor > 0 ? Math.round((item.amountMinor * 1000) / totalExpenseMinor) / 10 : 0;
        return {
          id: catId,
          name: matched?.name ?? '未分类',
          icon: matched?.icon ?? 'more_horiz',
          color: matched?.color ?? CHART_PALETTE[idx % CHART_PALETTE.length] ?? '#6366f1',
          amountMinor: item.amountMinor,
          percent,
          count: item.count,
        };
      })
      .sort((a, b) => b.amountMinor - a.amountMinor)
      .slice(0, 6);

    const daySpan = minDate && maxDate ? computeDaySpan(minDate, maxDate) : 0;
    const autoGranularity: 'month' | 'day' =
      monthlyMap.size > 1 || daySpan > 31 ? 'month' : 'day';
    const effectiveGranularity: 'month' | 'day' =
      granularityMode === 'auto' ? autoGranularity : granularityMode;

    const trendBars: TrendBarItem[] =
      effectiveGranularity === 'month'
        ? Array.from(monthlyMap.entries())
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([monthKey, values]) => ({
              bucketKey: monthKey,
              shortLabel: monthKey,
              expenseMinor: values.expenseMinor,
              incomeMinor: values.incomeMinor,
            }))
        : Array.from(dailyMap.entries())
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([localDate, values]) => ({
              bucketKey: localDate,
              shortLabel: localDate.slice(5),
              expenseMinor: values.expenseMinor,
              incomeMinor: values.incomeMinor,
            }));

    // 月度预算参考支出：若跨多个月份则取最新月份支出，若单月则取该月累计支出
    const sortedMonths = Array.from(monthlyMap.keys()).sort();
    const referenceMonth = sortedMonths[sortedMonths.length - 1] ?? '';
    const referenceMonthExpenseMinor = referenceMonth
      ? (monthlyMap.get(referenceMonth)?.expenseMinor ?? 0)
      : totalExpenseMinor;

    const netMinor = totalIncomeMinor - totalExpenseMinor;

    return {
      totalExpenseMinor,
      totalIncomeMinor,
      netMinor,
      expenseCount,
      incomeCount,
      excludedTransferCount,
      excludedTransferMinor,
      slices,
      trendBars,
      autoGranularity,
      effectiveGranularity,
      referenceMonth,
      referenceMonthExpenseMinor,
      monthCount: monthlyMap.size,
    };
  }, [bills, categories, excludeTransfers, granularityMode]);

  if (bills.length === 0) {
    return null;
  }

  // 环形图参数：半径 52，周长 2 * PI * 52 ≈ 326.73
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let accumulatedPercent = 0;

  const maxTrendMinor = Math.max(
    1,
    ...stats.trendBars.map((d) => Math.max(d.expenseMinor, d.incomeMinor)),
  );

  // 月度预算进度与超支预警计算
  const budgetSpentMinor = stats.referenceMonthExpenseMinor;
  const budgetUsagePercent =
    monthlyBudgetCents > 0
      ? Math.round((budgetSpentMinor * 1000) / monthlyBudgetCents) / 10
      : 0;
  const budgetDiffMinor = monthlyBudgetCents - budgetSpentMinor;
  const isOverspent = budgetDiffMinor < 0;
  const isWarning = !isOverspent && budgetUsagePercent >= 80;
  const budgetColor = isOverspent ? '#ef4444' : isWarning ? '#f59e0b' : '#10b981';

  const handleOpenBudgetEdit = (): void => {
    setBudgetInputText(formatAmount(monthlyBudgetCents, 'CNY'));
    setBudgetInputError(null);
    setEditingBudget(true);
  };

  const handleSaveBudget = (): void => {
    try {
      const parsedCents = parseAmountToMinor(budgetInputText.trim());
      if (parsedCents <= 0) {
        setBudgetInputError('请输入大于 0 的预算金额');
        return;
      }
      setMonthlyBudgetCents(parsedCents);
      setEditingBudget(false);
      setBudgetInputError(null);
    } catch {
      setBudgetInputError('请输入合法的金额（如 5000 或 3500.00）');
    }
  };

  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 2, sm: 2.5 },
        mb: 2,
        borderRadius: 3,
        backgroundColor: 'var(--lifehub-surface)',
        borderColor: 'var(--lifehub-border)',
        boxShadow: 'var(--lifehub-shadow-sm)',
      }}
      data-testid="bill-visual-dashboard"
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
        <Typography
          variant="subtitle1"
          sx={{ fontWeight: 600, color: 'var(--lifehub-text)', display: 'flex', alignItems: 'center', gap: 1 }}
        >
          <DonutLargeOutlined fontSize="small" color="primary" />
          收支统计与可视化分析
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button
            size="small"
            variant={excludeTransfers ? 'outlined' : 'text'}
            color={excludeTransfers ? 'primary' : 'inherit'}
            startIcon={<SwapHorizOutlined fontSize="small" />}
            onClick={() => setExcludeTransfers((prev) => !prev)}
            data-testid="exclude-transfers-toggle"
          >
            {excludeTransfers ? '已剔除内部转账' : '含内部转账'}
          </Button>
          <Button
            size="small"
            variant="text"
            endIcon={expanded ? <ExpandLessOutlined /> : <ExpandMoreOutlined />}
            onClick={() => setExpanded((prev) => !prev)}
            data-testid="toggle-visual-dashboard"
          >
            {expanded ? '收起图表' : '展开图表'}
          </Button>
        </Box>
      </Box>

      {stats.excludedTransferCount > 0 ? (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.5,
            py: 0.75,
            mb: 1.5,
            borderRadius: 1,
            backgroundColor: 'var(--lifehub-primary-soft)',
            border: '1px solid var(--lifehub-border)',
          }}
          data-testid="excluded-transfer-summary"
        >
          <SwapHorizOutlined sx={{ fontSize: 16, color: 'var(--lifehub-primary)' }} />
          <Typography variant="caption" sx={{ color: 'var(--lifehub-text)' }}>
            {excludeTransfers
              ? `已自动剔除 ${stats.excludedTransferCount} 条内部转账/倒卡流水（合计 ¥${formatAmount(stats.excludedTransferMinor, 'CNY')} 不计入收支）`
              : `当前统计已包含 ${stats.excludedTransferCount} 条内部转账/倒卡流水（合计 ¥${formatAmount(stats.excludedTransferMinor, 'CNY')}）`}
          </Typography>
        </Box>
      ) : null}

      {/* 顶部 4 张 KPI 指标卡片：移动端 2×2 等宽网格，桌面端 4 列网格 */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(2, minmax(0, 1fr))',
            md: 'repeat(4, minmax(0, 1fr))',
          },
          gap: { xs: 1.25, sm: 1.5 },
          mb: 1.5,
        }}
      >
        <Box
          sx={{
            p: { xs: 1.5, sm: 2 },
            borderRadius: 2,
            backgroundColor: 'var(--lifehub-bg)',
            border: '1px solid var(--lifehub-border)',
          }}
        >
          <Typography
            variant="caption"
            component="div"
            sx={{ color: 'var(--lifehub-text-muted)', display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}
          >
            <TrendingDownOutlined sx={{ fontSize: 16, color: 'var(--lifehub-expense)' }} />
            累计支出（{stats.expenseCount} 条）
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{
              fontWeight: 700,
              fontSize: { xs: '1.05rem', sm: '1.25rem' },
              color: 'var(--lifehub-expense)',
              fontVariantNumeric: 'tabular-nums',
            }}
            data-testid="kpi-total-expense"
          >
            ¥{formatAmount(stats.totalExpenseMinor, 'CNY')}
          </Typography>
        </Box>

        <Box
          sx={{
            p: { xs: 1.5, sm: 2 },
            borderRadius: 2,
            backgroundColor: 'var(--lifehub-bg)',
            border: '1px solid var(--lifehub-border)',
          }}
        >
          <Typography
            variant="caption"
            component="div"
            sx={{ color: 'var(--lifehub-text-muted)', display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}
          >
            <TrendingUpOutlined sx={{ fontSize: 16, color: 'var(--lifehub-income)' }} />
            累计收入（{stats.incomeCount} 条）
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{
              fontWeight: 700,
              fontSize: { xs: '1.05rem', sm: '1.25rem' },
              color: 'var(--lifehub-income)',
              fontVariantNumeric: 'tabular-nums',
            }}
            data-testid="kpi-total-income"
          >
            ¥{formatAmount(stats.totalIncomeMinor, 'CNY')}
          </Typography>
        </Box>

        <Box
          sx={{
            p: { xs: 1.5, sm: 2 },
            borderRadius: 2,
            backgroundColor: 'var(--lifehub-bg)',
            border: '1px solid var(--lifehub-border)',
          }}
        >
          <Typography
            variant="caption"
            component="div"
            sx={{ color: 'var(--lifehub-text-muted)', display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}
          >
            <AccountBalanceWalletOutlined sx={{ fontSize: 16, color: 'var(--lifehub-primary)' }} />
            净收支结余
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{
              fontWeight: 700,
              fontSize: { xs: '1.05rem', sm: '1.25rem' },
              color: stats.netMinor >= 0 ? 'var(--lifehub-income)' : 'var(--lifehub-expense)',
              fontVariantNumeric: 'tabular-nums',
            }}
            data-testid="kpi-net-balance"
          >
            {stats.netMinor >= 0
              ? `+¥${formatAmount(stats.netMinor, 'CNY')}`
              : `-¥${formatAmount(Math.abs(stats.netMinor), 'CNY')}`}
          </Typography>
        </Box>

        <Box
          sx={{
            p: { xs: 1.5, sm: 2 },
            borderRadius: 2,
            backgroundColor: 'var(--lifehub-bg)',
            border: '1px solid var(--lifehub-border)',
          }}
        >
          <Typography
            variant="caption"
            component="div"
            sx={{ color: 'var(--lifehub-text-muted)', display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}
          >
            <ReceiptLongOutlined sx={{ fontSize: 16, color: 'var(--lifehub-primary)' }} />
            筛选命中记录
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{
              fontWeight: 700,
              fontSize: { xs: '1.05rem', sm: '1.25rem' },
              color: 'var(--lifehub-text)',
              fontVariantNumeric: 'tabular-nums',
            }}
            data-testid="kpi-record-count"
          >
            {bills.length} 条记录
          </Typography>
        </Box>
      </Box>

      {/* 月度预算与超支预警卡片（A-23） */}
      <Box
        sx={{
          p: 1.5,
          mb: expanded ? 2 : 0,
          borderRadius: 1.5,
          backgroundColor: 'var(--lifehub-bg)',
          border: '1px solid var(--lifehub-border)',
        }}
        data-testid="monthly-budget-card"
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 1,
            mb: 1,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <SavingsOutlined sx={{ fontSize: 18, color: budgetColor }} />
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--lifehub-text)' }}>
              月度预算监控{stats.referenceMonth ? `（${stats.referenceMonth}）` : ''}
            </Typography>
            <Typography
              variant="caption"
              sx={{
                px: 1,
                py: 0.25,
                borderRadius: 1,
                fontWeight: 600,
                color: budgetColor,
                border: `1px solid ${budgetColor}`,
              }}
              data-testid="budget-status-badge"
            >
              {isOverspent
                ? `已超支 ¥${formatAmount(Math.abs(budgetDiffMinor), 'CNY')}（${budgetUsagePercent.toFixed(1)}%）`
                : isWarning
                  ? `接近预算上限（已用 ${budgetUsagePercent.toFixed(1)}%，剩余 ¥${formatAmount(budgetDiffMinor, 'CNY')}）`
                  : `预算充裕（已用 ${budgetUsagePercent.toFixed(1)}%，剩余 ¥${formatAmount(budgetDiffMinor, 'CNY')}）`}
            </Typography>
          </Box>

          {editingBudget ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <TextField
                size="small"
                label="月度预算 (元)"
                value={budgetInputText}
                onChange={(e) => setBudgetInputText(e.target.value)}
                error={Boolean(budgetInputError)}
                helperText={budgetInputError ?? undefined}
                inputProps={{ 'data-testid': 'budget-input' }}
                sx={{ width: 150 }}
              />
              <Button
                size="small"
                variant="contained"
                onClick={handleSaveBudget}
                data-testid="save-budget-button"
              >
                保存预算
              </Button>
              <Button
                size="small"
                variant="text"
                onClick={() => {
                  setEditingBudget(false);
                  setBudgetInputError(null);
                }}
              >
                取消
              </Button>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography
                variant="caption"
                sx={{ color: 'var(--lifehub-text-muted)', fontVariantNumeric: 'tabular-nums' }}
              >
                当月已支出 ¥{formatAmount(budgetSpentMinor, 'CNY')} / 预算 ¥
                {formatAmount(monthlyBudgetCents, 'CNY')}
              </Typography>
              <Button
                size="small"
                variant="outlined"
                startIcon={<EditOutlined fontSize="small" />}
                onClick={handleOpenBudgetEdit}
                data-testid="edit-budget-button"
              >
                设置预算
              </Button>
            </Box>
          )}
        </Box>

        <LinearProgress
          variant="determinate"
          value={Math.min(100, Math.max(0, budgetUsagePercent))}
          sx={{
            height: 8,
            borderRadius: 4,
            backgroundColor: 'var(--lifehub-border)',
            '& .MuiLinearProgress-bar': {
              backgroundColor: budgetColor,
              borderRadius: 4,
            },
          }}
          data-testid="budget-progress-bar"
        />
      </Box>

      {/* 图表分析区域：左侧支出分类占比环形图 + 右侧收支趋势双柱状图 */}
      {expanded ? (
        <>
          <Box
            sx={{ display: { xs: 'flex', sm: 'none' }, justifyContent: 'center', mb: chartsExpanded ? 1.5 : 0 }}
            data-testid="toggle-dashboard-charts"
            onClick={() => setChartsExpanded((prev) => !prev)}
          >
            <Button
              size="small"
              variant="outlined"
              onClick={(e) => {
                e.stopPropagation();
                setChartsExpanded((prev) => !prev);
              }}
              data-testid="toggle-mobile-charts-button"
              sx={{ width: '100%' }}
            >
              {chartsExpanded ? '收起详细图表 ▴' : '展开趋势与分类图表 ▾'}
            </Button>
          </Box>
          <Box
            sx={{
              display: chartsExpanded ? 'grid' : 'none',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 2,
            }}
            data-testid="bill-visual-charts"
          >
          {/* 左侧：支出分类构成环形图 */}
          <Box
            sx={{
              p: 2,
              borderRadius: 1.5,
              backgroundColor: 'var(--lifehub-bg)',
              border: '1px solid var(--lifehub-border)',
            }}
          >
            <Typography
              variant="body2"
              sx={{ fontWeight: 600, color: 'var(--lifehub-text)', mb: 1.5, display: 'flex', alignItems: 'center', gap: 0.75 }}
            >
              <DonutLargeOutlined sx={{ fontSize: 16, color: 'var(--lifehub-primary)' }} />
              支出分类构成（Top 6）
            </Typography>
            {stats.slices.length === 0 ? (
              <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
                当前筛选范围内暂无支出记录
              </Typography>
            ) : (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5, flexWrap: 'wrap' }}>
                <Box sx={{ position: 'relative', width: 132, height: 132, flexShrink: 0, mx: 'auto' }}>
                  <svg width="132" height="132" viewBox="0 0 132 132" role="img" aria-label="支出分类占比环形图">
                    <circle
                      cx="66"
                      cy="66"
                      r={radius}
                      fill="transparent"
                      stroke="var(--lifehub-border)"
                      strokeWidth="16"
                    />
                    {stats.slices.map((slice) => {
                      const strokeDasharray = `${(slice.percent / 100) * circumference} ${circumference}`;
                      const strokeDashoffset = -((accumulatedPercent / 100) * circumference);
                      accumulatedPercent += slice.percent;
                      return (
                        <circle
                          key={slice.id}
                          cx="66"
                          cy="66"
                          r={radius}
                          fill="transparent"
                          stroke={slice.color}
                          strokeWidth="16"
                          strokeDasharray={strokeDasharray}
                          strokeDashoffset={strokeDashoffset}
                          transform="rotate(-90 66 66)"
                        />
                      );
                    })}
                  </svg>
                </Box>

                <Box sx={{ flex: 1, minWidth: 160, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {stats.slices.map((slice) => (
                    <Box key={slice.id}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.25 }}>
                        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                          <CategoryIcon icon={slice.icon} name={slice.name} size={18} />
                          <Typography variant="caption" sx={{ color: 'var(--lifehub-text)', fontWeight: 500 }}>
                            {slice.name}
                          </Typography>
                        </Box>
                        <Typography
                          variant="caption"
                          data-testid="category-slice-stat"
                          sx={{
                            color: 'var(--lifehub-text-muted)',
                            whiteSpace: 'nowrap',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {slice.percent.toFixed(1)}% · ¥{formatAmount(slice.amountMinor, 'CNY')}
                        </Typography>
                      </Box>
                      <LinearProgress
                        variant="determinate"
                        value={Math.min(100, Math.max(2, slice.percent))}
                        sx={{
                          height: 6,
                          borderRadius: 3,
                          backgroundColor: 'var(--lifehub-border)',
                          '& .MuiLinearProgress-bar': {
                            backgroundColor: slice.color,
                            borderRadius: 3,
                          },
                        }}
                      />
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
          </Box>

          {/* 右侧：收支趋势对比柱状图（支持自动/按月/按天切换、无截断横向滚动、柱顶直接展示金额） */}
          <Box
            sx={{
              p: 2,
              borderRadius: 1.5,
              backgroundColor: 'var(--lifehub-bg)',
              border: '1px solid var(--lifehub-border)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              overflow: 'hidden',
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 1,
                mb: 1.5,
              }}
            >
              <Box>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 600,
                    color: 'var(--lifehub-text)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.75,
                  }}
                  data-testid="trend-chart-title"
                >
                  <BarChartOutlined sx={{ fontSize: 16, color: 'var(--lifehub-primary)' }} />
                  {stats.effectiveGranularity === 'month'
                    ? `收支趋势（按月统计 · 共 ${stats.trendBars.length} 个月）`
                    : `收支趋势（按日统计 · 共 ${stats.trendBars.length} 天）`}
                </Typography>
                <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
                  随当前搜索与筛选结果实时联动
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <ButtonGroup
                  size="small"
                  aria-label="趋势图时间粒度切换"
                  data-testid="trend-granularity-group"
                >
                  <Button
                    variant={granularityMode === 'auto' ? 'contained' : 'outlined'}
                    onClick={() => setGranularityMode('auto')}
                    data-testid="trend-granularity-auto"
                    sx={{ fontSize: '0.72rem', py: 0.25, px: 1 }}
                  >
                    自动（{stats.autoGranularity === 'month' ? '按月' : '按天'}）
                  </Button>
                  <Button
                    variant={granularityMode === 'month' ? 'contained' : 'outlined'}
                    onClick={() => setGranularityMode('month')}
                    data-testid="trend-granularity-month"
                    sx={{ fontSize: '0.72rem', py: 0.25, px: 1 }}
                  >
                    按月显示
                  </Button>
                  <Button
                    variant={granularityMode === 'day' ? 'contained' : 'outlined'}
                    onClick={() => setGranularityMode('day')}
                    data-testid="trend-granularity-day"
                    sx={{ fontSize: '0.72rem', py: 0.25, px: 1 }}
                  >
                    按天显示
                  </Button>
                </ButtonGroup>

                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--lifehub-expense)' }} />
                    <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
                      支出
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--lifehub-income)' }} />
                    <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
                      收入
                    </Typography>
                  </Box>
                </Box>
              </Box>
            </Box>

            <Box
              role="img"
              aria-label="近期每日收支对比柱状图"
              sx={{
                overflowX: 'auto',
                pb: 0.5,
              }}
              data-testid="trend-chart-scroll"
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: 1.25,
                  minHeight: 156,
                  pt: 2.5,
                  px: 0.5,
                  borderBottom: '1px solid var(--lifehub-border)',
                  minWidth: Math.max(280, stats.trendBars.length * 64),
                }}
              >
                {stats.trendBars.map((bar) => {
                  const expHeight =
                    bar.expenseMinor > 0
                      ? Math.max(6, Math.round((bar.expenseMinor / maxTrendMinor) * 88))
                      : 0;
                  const incHeight =
                    bar.incomeMinor > 0
                      ? Math.max(6, Math.round((bar.incomeMinor / maxTrendMinor) * 88))
                      : 0;
                  return (
                    <Box
                      key={bar.bucketKey}
                      sx={{
                        flex: '1 0 56px',
                        minWidth: 56,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                      }}
                      data-testid={`trend-bucket-${bar.bucketKey}`}
                    >
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'flex-end',
                          justifyContent: 'center',
                          gap: 0.5,
                          height: 116,
                          width: '100%',
                        }}
                      >
                        {bar.expenseMinor > 0 ? (
                          <Box
                            sx={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'flex-end',
                            }}
                          >
                            <Typography
                              variant="caption"
                              sx={{
                                fontSize: '0.65rem',
                                lineHeight: 1.1,
                                mb: 0.25,
                                color: 'var(--lifehub-expense)',
                                fontWeight: 600,
                                fontVariantNumeric: 'tabular-nums',
                                whiteSpace: 'nowrap',
                              }}
                              data-testid="trend-bar-value"
                            >
                              {formatCompactYuan(bar.expenseMinor)}
                            </Typography>
                            <Box
                              sx={{
                                width: 12,
                                height: expHeight,
                                borderRadius: '3px 3px 0 0',
                                backgroundColor: 'var(--lifehub-expense)',
                              }}
                            />
                          </Box>
                        ) : null}

                        {bar.incomeMinor > 0 ? (
                          <Box
                            sx={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'flex-end',
                            }}
                          >
                            <Typography
                              variant="caption"
                              sx={{
                                fontSize: '0.65rem',
                                lineHeight: 1.1,
                                mb: 0.25,
                                color: 'var(--lifehub-income)',
                                fontWeight: 600,
                                fontVariantNumeric: 'tabular-nums',
                                whiteSpace: 'nowrap',
                              }}
                              data-testid="trend-bar-value"
                            >
                              {formatCompactYuan(bar.incomeMinor)}
                            </Typography>
                            <Box
                              sx={{
                                width: 12,
                                height: incHeight,
                                borderRadius: '3px 3px 0 0',
                                backgroundColor: 'var(--lifehub-income)',
                              }}
                            />
                          </Box>
                        ) : null}
                      </Box>
                    </Box>
                  );
                })}
              </Box>

              {/* 横轴日期/月份标签行 */}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                  px: 0.5,
                  pt: 0.75,
                  minWidth: Math.max(280, stats.trendBars.length * 64),
                }}
              >
                {stats.trendBars.map((bar) => (
                  <Box
                    key={bar.bucketKey}
                    sx={{
                      flex: '1 0 56px',
                      minWidth: 56,
                      textAlign: 'center',
                    }}
                  >
                    <Typography
                      variant="caption"
                      sx={{
                        fontSize: '0.7rem',
                        color: 'var(--lifehub-text-muted)',
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {bar.shortLabel}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        </Box>
        </>
      ) : null}
    </Paper>
  );
}
