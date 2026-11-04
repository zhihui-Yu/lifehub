/**
 * 账单收支统计与可视化分析独立页面。
 *
 * 架构位置：apps/web 的「页面」层。
 *
 * 说明：将收支统计 KPI、月度预算预警、支出分类占比环形图（Top 6）及收支趋势柱状图独立成专门页面，
 * 让账单首页专注于记录与列表浏览，点击首页「收支统计」即可进入本页查看完整可视化分析。
 */
import { useMemo } from 'react';
import { Box, Button, Typography } from '@mui/material';
import ArrowBackOutlined from '@mui/icons-material/ArrowBackOutlined';
import { isTransferCategory, type Category } from '@lifehub/core';
import { BillFilterBar } from '@/components/bills/BillFilterBar';
import { BillVisualDashboard } from '@/components/bills/BillVisualDashboard';
import { EmptyState } from '@/components/common/EmptyState';
import { LoadingOverlay } from '@/components/common/LoadingOverlay';
import { useBillList } from '@/hooks/useBillList';
import { useCategories } from '@/hooks/useCategories';
import { useBillStore } from '@/store';

/**
 * 渲染独立收支统计与账单可视化分析页面。
 *
 * @returns React 节点
 * @throws 无显式抛出
 */
export function BillStatsPage() {
  const { bills, loading } = useBillList();
  const { categories } = useCategories();
  const filters = useBillStore((state) => state.filters);
  const setFilters = useBillStore((state) => state.setFilters);
  const clearFilters = useBillStore((state) => state.clearFilters);
  const allBills = useBillStore((state) => state.bills);

  const effectiveCategories = useMemo<Category[]>(() => {
    const list = [...categories];
    if (!list.some((c) => isTransferCategory(c))) {
      list.push({
        id: 'sys-internal-transfer',
        name: '内部转账',
        kind: 'both',
        parentId: null,
        color: '#6366F1',
        icon: 'transfer',
        isSystem: true,
        sortOrder: 800,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        version: 1,
        deviceId: 'local',
      });
    }
    if (!list.some((c) => !isTransferCategory(c))) {
      list.push({
        id: 'sys-other',
        name: '其他',
        kind: 'both',
        parentId: null,
        color: '#6B7280',
        icon: 'more',
        isSystem: true,
        sortOrder: 1300,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        version: 1,
        deviceId: 'local',
      });
    }
    return list;
  }, [categories]);

  return (
    <div data-testid="bill-stats-page">
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1.5,
          mb: 2,
        }}
      >
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            收支统计与可视化分析
          </Typography>
          <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)' }}>
            按分类占比、收支趋势与月度预算全面洞察账单流向
          </Typography>
        </Box>
        <Button
          variant="outlined"
          size="small"
          startIcon={<ArrowBackOutlined />}
          onClick={() => {
            if (typeof window !== 'undefined') {
              window.location.hash = '#/bills';
            }
          }}
          data-testid="back-to-bills-button"
        >
          返回账单列表
        </Button>
      </Box>

      <LoadingOverlay visible={loading} label="正在加载统计数据…" />

      {allBills.length === 0 && !loading ? (
        <EmptyState
          title="暂无可统计的账单数据"
          description="请先在账单页「记一笔」或导入账单文件，这里会自动生成可视化图表。"
        />
      ) : (
        <>
          <BillFilterBar
            filters={filters}
            onChange={setFilters}
            onClear={clearFilters}
            categoryOptions={[
              ...effectiveCategories.map((category) => ({ id: category.id, name: category.name })),
              { id: '__uncategorized__', name: '未分类' },
            ]}
          />
          {bills.length === 0 ? (
            <EmptyState
              title="没有符合筛选条件的账单"
              description="试试调整搜索关键词或清空筛选条件。"
            />
          ) : (
            <BillVisualDashboard
              bills={bills}
              categories={effectiveCategories}
              defaultChartsExpanded
            />
          )}
        </>
      )}
    </div>
  );
}
