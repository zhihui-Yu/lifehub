/**
 * 账单列表页面（UI-03）。
 *
 * 架构位置：apps/web 的「页面」层。
 *
 * 说明：按 `localDate` 分组展示；搜索 200ms 防抖；方向 / 日期区间 / 分类可组合筛选；
 * 长列表使用虚拟化（A-09）。
 */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Typography } from '@mui/material';
import { BillFilterBar } from '@/components/bills/BillFilterBar';
import { BillGroupList } from '@/components/bills/BillGroupList';
import { BillVirtualList } from '@/components/bills/BillVirtualList';
import { EmptyState } from '@/components/common/EmptyState';
import { LoadingOverlay } from '@/components/common/LoadingOverlay';
import { useBillList } from '@/hooks/useBillList';
import { useCategories } from '@/hooks/useCategories';
import { useBillStore } from '@/store';
import { useVault } from '@/hooks/useVault';

/**
 * 渲染账单列表页面。
 *
 * @returns React 节点
 */
export function BillsPage() {
  const { runtime, status } = useVault();
  const { groups, bills, loading, error } = useBillList();
  const { categories } = useCategories();
  const filters = useBillStore((state) => state.filters);
  const setFilters = useBillStore((state) => state.setFilters);
  const clearFilters = useBillStore((state) => state.clearFilters);
  // 原始工作集（过滤前）——用于区分「根本没有账单」与「筛选后为空」两种空状态。
  const allBills = useBillStore((state) => state.bills);

  const categoryNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const category of categories) {
      map[category.id] = category.name;
    }
    return map;
  }, [categories]);

  const [sourceFileNames, setSourceFileNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const batchRepository = runtime?.importBatchRepository;
      if (!batchRepository) {
        return;
      }
      try {
        const batches = await batchRepository.list();
        if (cancelled) {
          return;
        }
        const map: Record<string, string> = {};
        for (const batch of batches) {
          map[batch.id] = batch.fileName;
        }
        setSourceFileNames(map);
      } catch {
        // 批次列表加载失败不阻断账单列表渲染，来源文件列降级为「—」。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runtime]);

  if (status === 'unlocked' && allBills.length === 0 && !loading) {
    return (
      <div data-testid="bills-page">
        <EmptyState
          title="还没有账单"
          description="导入一个 CSV 账单文件后，这里会按日期分组展示账单。"
        />
      </div>
    );
  }

  return (
    <div data-testid="bills-page">
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}
      <BillFilterBar
        filters={filters}
        onChange={setFilters}
        onClear={clearFilters}
        categoryOptions={categories.map((category) => ({ id: category.id, name: category.name }))}
      />
      <LoadingOverlay visible={loading} label="正在解密账单…" />
      {groups.length === 0 && !loading ? (
        <EmptyState title="没有符合筛选条件的账单" description="试试调整搜索关键词或清空筛选条件。" />
      ) : (
        <BillGroupList
          groups={groups}
          renderBills={(group) => (
            <BillVirtualList
              bills={group.bills}
              categoryNames={categoryNames}
              sourceFileNames={sourceFileNames}
            />
          )}
        />
      )}
      <Box sx={{ mt: 2 }}>
        <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)' }}>
          共 {bills.length} 条账单，按本地日历日分组显示。
        </Typography>
      </Box>
    </div>
  );
}
