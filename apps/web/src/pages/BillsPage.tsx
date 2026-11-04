/**
 * 账单列表页面（UI-03）。
 *
 * 架构位置：apps/web 的「页面」层。
 *
 * 说明：按 `localDate` 分组展示；搜索 200ms 防抖；方向 / 日期区间 / 分类可组合筛选；
 * 长列表使用虚拟化（A-09）。解锁态下支持「记一笔 / 编辑 / 删除」（A 模块记账闭环）。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import AddOutlined from '@mui/icons-material/AddOutlined';
import BarChartOutlined from '@mui/icons-material/BarChartOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import DeleteSweepOutlined from '@mui/icons-material/DeleteSweepOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import KeyboardArrowUpOutlined from '@mui/icons-material/KeyboardArrowUpOutlined';
import SwapHorizOutlined from '@mui/icons-material/SwapHorizOutlined';
import { BillFilterBar } from '@/components/bills/BillFilterBar';
import { BillGroupList } from '@/components/bills/BillGroupList';
import { BillVirtualList } from '@/components/bills/BillVirtualList';
import { BillEditDialog } from '@/components/bills/BillEditDialog';
import { BillVisualDashboard } from '@/components/bills/BillVisualDashboard';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { LoadingOverlay } from '@/components/common/LoadingOverlay';
import { useBillList } from '@/hooks/useBillList';
import { useCategories } from '@/hooks/useCategories';
import { useBillActions, type CategoryMemoryActionResult } from '@/hooks/useBillActions';
import { useBillStore } from '@/store';
import { useVault } from '@/hooks/useVault';
import {
  detectTransferPairs,
  isInternalTransferBill,
  isTransferCategory,
  type Bill,
  type Category,
} from '@lifehub/core';
import type { ManualBillInput } from '@/lib/bill-factory';
import { formatAmount, formatLocalDate, formatWeekday } from '@/utils/format';

/**
 * 转义 CSV 单元格文本以符合 RFC 4180 规范。
 *
 * 说明：包含逗号、双引号或换行的单元格会包裹双引号，并将内部双引号翻倍。
 *
 * @param cell 原始单元格文本
 * @returns 安全的 CSV 单元格字符串
 * @throws 无；纯字符串处理不抛出异常
 */
function escapeCsvCell(cell: string): string {
  if (cell.includes(',') || cell.includes('"') || cell.includes('\n') || cell.includes('\r')) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

/**
 * 将账单集合序列化为带 UTF-8 BOM 的标准 CSV 文本。
 *
 * 说明：金额通过 `formatAmount` 由整数分转为两位小数元字符串，严禁浮点运算；首行附带 `\uFEFF` 以便 Excel 直接打开不乱码。
 *
 * @param bills 待导出的账单列表
 * @param categoryNames 分类 ID 到分类名称的映射字典
 * @param sourceFileNames 来源批次 ID 到文件名的映射字典
 * @returns 带 UTF-8 BOM 的 CSV 文本
 * @throws 无；纯序列化函数不抛出异常
 */
function buildBillsCsvContent(
  bills: readonly Bill[],
  categoryNames: Readonly<Record<string, string>>,
  sourceFileNames: Readonly<Record<string, string>>,
): string {
  const header = '日期,时间,交易对方,分类,收支方向,金额(元),币种,备注,来源文件';
  const rows = bills.map((bill) => {
    const categoryName = (bill.categoryId ? categoryNames[bill.categoryId] : undefined) ?? '未分类';
    const directionLabel =
      bill.direction === 'expense' ? '支出' : bill.direction === 'income' ? '收入' : '不计收支';
    const amountText = formatAmount(bill.amountMinor, bill.currency);
    const sourceFile = (bill.sourceFileId ? sourceFileNames[bill.sourceFileId] : undefined) ?? '手动记账';
    return [
      bill.localDate,
      bill.occurredAt,
      bill.counterparty,
      categoryName,
      directionLabel,
      amountText,
      bill.currency,
      bill.note,
      sourceFile,
    ]
      .map((cell) => escapeCsvCell(String(cell ?? '')))
      .join(',');
  });
  return `\uFEFF${[header, ...rows].join('\n')}`;
}

/**
 * 将账单集合序列化为可读的 JSON 导出文本。
 *
 * 说明：同时保留整数分 `amountMinor` 与格式化元字符串 `amountYuan`，便于跨工具对账或二次导入备份。
 *
 * @param bills 待导出的账单列表
 * @param categoryNames 分类 ID 到分类名称的映射字典
 * @param sourceFileNames 来源批次 ID 到文件名的映射字典
 * @returns 格式化后的 JSON 字符串
 * @throws 无；纯序列化函数不抛出异常
 */
function buildBillsJsonContent(
  bills: readonly Bill[],
  categoryNames: Readonly<Record<string, string>>,
  sourceFileNames: Readonly<Record<string, string>>,
): string {
  const payload = {
    exportedAt: new Date().toISOString(),
    totalRecords: bills.length,
    bills: bills.map((bill) => ({
      id: bill.id,
      localDate: bill.localDate,
      occurredAt: bill.occurredAt,
      counterparty: bill.counterparty,
      categoryName: (bill.categoryId ? categoryNames[bill.categoryId] : undefined) ?? '未分类',
      direction: bill.direction,
      amountMinor: bill.amountMinor,
      amountYuan: formatAmount(bill.amountMinor, bill.currency),
      currency: bill.currency,
      note: bill.note,
      sourceFile: (bill.sourceFileId ? sourceFileNames[bill.sourceFileId] : undefined) ?? '手动记账',
    })),
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * 触发浏览器端文本文件下载（在测试环境下安全降级）。
 *
 * @param content 文件文本内容
 * @param fileName 下载文件名
 * @param mimeType MIME 类型
 * @returns 无返回值
 * @throws 无；异常在内部捕获安全降级
 */
function triggerBrowserDownload(content: string, fileName: string, mimeType: string): void {
  try {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      return;
    }
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url);
    }
  } catch {
    // JSDOM 等无完整下载实现的环境安全静默
  }
}

/**
 * 渲染账单列表页面。
 *
 * 说明：展示筛选后的账单可视化图表、月度预算监控、导出工具栏及按日分组账单明细。
 *
 * @param _props 页面无入参
 * @returns React 节点
 * @throws 无；组件内部捕获异步异常并转为错误横幅展示
 */
export function BillsPage() {
  const { runtime, status } = useVault();
  const { groups, bills, loading, error } = useBillList();
  const { categories } = useCategories();
  const { addBill, updateBill, deleteBill, clearAllBills, setBillCategoryId, markBillsAsTransfer } =
    useBillActions();
  const filters = useBillStore((state) => state.filters);
  const setFilters = useBillStore((state) => state.setFilters);
  const clearFilters = useBillStore((state) => state.clearFilters);
  // 原始工作集（过滤前）——用于区分「根本没有账单」与「筛选后为空」两种空状态。
  const allBills = useBillStore((state) => state.bills);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Bill | null>(null);
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [sourceFileNames, setSourceFileNames] = useState<Record<string, string>>({});
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [memoryBanner, setMemoryBanner] = useState<string | null>(null);
  const [selectedGroupDate, setSelectedGroupDate] = useState<string | null>(null);

  const selectedDailyGroup = useMemo(
    () => (selectedGroupDate ? groups.find((g) => g.localDate === selectedGroupDate) ?? null : null),
    [groups, selectedGroupDate],
  );

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

  const categoryMap = useMemo(() => {
    const map = new Map<string, Category>();
    for (const category of effectiveCategories) {
      map.set(category.id, category);
    }
    return map;
  }, [effectiveCategories]);

  const categoryNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const category of effectiveCategories) {
      map[category.id] = category.name;
    }
    return map;
  }, [effectiveCategories]);

  const transferCategoryId = useMemo(
    () => effectiveCategories.find((c) => isTransferCategory(c))?.id ?? 'sys-internal-transfer',
    [effectiveCategories],
  );

  const fallbackNormalCategoryId = useMemo(
    () =>
      effectiveCategories.find((c) => c.name === '其他' && !isTransferCategory(c))?.id ??
      effectiveCategories.find((c) => !isTransferCategory(c))?.id ??
      'sys-other',
    [effectiveCategories],
  );

  const transferPairs = useMemo(
    () => detectTransferPairs(bills, categoryMap),
    [bills, categoryMap],
  );

  const applyMemoryBanner = (result: CategoryMemoryActionResult): void => {
    if (!result.remembered || !result.categoryId) {
      return;
    }
    const catName = categoryNames[result.categoryId] ?? '已选分类';
    if (result.autoCategorizedCount > 0) {
      setMemoryBanner(
        `已记住「${result.itemLabel} → ${catName}」，并自动将另外 ${result.autoCategorizedCount} 条相同未分类账单归入该分类`,
      );
    } else {
      setMemoryBanner(`已记住「${result.itemLabel} → ${catName}」，后续出现相同项将自动归入该分类`);
    }
  };

  const handleToggleTransfer = async (bill: Bill): Promise<void> => {
    const currentlyTransfer = isInternalTransferBill(bill, categoryMap);
    if (currentlyTransfer) {
      // 若清空分类后仍因关键词命中内部转账，则显式归入常规「其他」分类以尊重用户的恢复计入收支意图。
      const stillTransferWhenNull = isInternalTransferBill({ ...bill, categoryId: null }, categoryMap);
      await setBillCategoryId(bill, stillTransferWhenNull ? fallbackNormalCategoryId : null, {
        rememberCategory: false,
      });
    } else {
      await setBillCategoryId(bill, transferCategoryId, { rememberCategory: false });
    }
  };

  const handleQuickSelectCategory = async (bill: Bill, categoryId: string | null): Promise<void> => {
    const result = await setBillCategoryId(bill, categoryId, { rememberCategory: true });
    applyMemoryBanner(result);
  };

  const handleMarkAllPairsAsTransfer = async (): Promise<void> => {
    const toMark: Bill[] = [];
    for (const pair of transferPairs) {
      toMark.push(pair.expenseBill, pair.incomeBill);
    }
    await markBillsAsTransfer(toMark, transferCategoryId);
  };

  // 加载最近导入列表（用于「来源文件」列展示；失败不阻断渲染）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!runtime) {
        return;
      }
      try {
        const batches = await runtime.importBatchRepository.list();
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

  const openCreate = (): void => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (bill: Bill): void => {
    setEditing(bill);
    setDialogOpen(true);
  };
  const handleDelete = async (bill: Bill): Promise<void> => {
    await deleteBill(bill.id);
  };
  const handleSubmit = async (
    input: ManualBillInput,
    options?: { rememberCategory?: boolean },
  ): Promise<boolean> => {
    const result = editing
      ? await updateBill(editing, input, options)
      : await addBill(input, options);
    applyMemoryBanner(result);
    return true;
  };

  const handleExportCsv = (): void => {
    const csvContent = buildBillsCsvContent(bills, categoryNames, sourceFileNames);
    const today = new Date().toISOString().slice(0, 10);
    triggerBrowserDownload(csvContent, `lifehub-bills-${today}.csv`, 'text/csv;charset=utf-8');
    setExportMessage(`已成功导出 ${bills.length} 条账单记录（CSV 格式）`);
  };

  const handleExportJson = (): void => {
    const jsonContent = buildBillsJsonContent(bills, categoryNames, sourceFileNames);
    const today = new Date().toISOString().slice(0, 10);
    triggerBrowserDownload(jsonContent, `lifehub-bills-${today}.json`, 'application/json;charset=utf-8');
    setExportMessage(`已成功导出 ${bills.length} 条账单记录（JSON 格式）`);
  };

  const handleBackToTop = (): void => {
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch {
        window.scrollTo(0, 0);
      }
    }
    if (typeof document !== 'undefined') {
      if (document.documentElement) {
        document.documentElement.scrollTop = 0;
      }
      if (document.body) {
        document.body.scrollTop = 0;
      }
      const containers = document.querySelectorAll('[data-testid="bill-virtual-list"], .lifehub-content');
      containers.forEach((node) => {
        const el = node as HTMLElement;
        el.scrollTop = 0;
        if (typeof el.scrollTo === 'function') {
          try {
            el.scrollTo({ top: 0, behavior: 'smooth' });
          } catch {
            el.scrollTo(0, 0);
          }
        }
      });
    }
  };

  const interactive = status === 'unlocked';

  const dialog = (
    <BillEditDialog
      open={dialogOpen}
      initial={editing}
      categories={categories}
      onClose={() => setDialogOpen(false)}
      onSubmit={handleSubmit}
    />
  );

  if (interactive && allBills.length === 0 && !loading) {
    return (
      <div data-testid="bills-page">
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mb: 2 }}>
          <Button
            variant="outlined"
            startIcon={<BarChartOutlined />}
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.hash = '#/stats';
              }
            }}
            data-testid="go-bill-stats-button"
          >
            收支统计
          </Button>
          <Button variant="contained" startIcon={<AddOutlined />} onClick={openCreate}>
            记一笔
          </Button>
        </Box>
        <EmptyState
          title="还没有账单"
          description="你可以直接「记一笔」手动记账，或导入一个 CSV 账单文件，这里会按日期分组展示。"
        />
        {dialog}
      </div>
    );
  }

  return (
    <div data-testid="bills-page">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          账单
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, width: { xs: '100%', sm: 'auto' } }}>
          {bills.length > 0 ? (
            <>
              <Button
                variant="outlined"
                startIcon={<FileDownloadOutlined />}
                onClick={handleExportCsv}
                data-testid="export-bills-button"
                sx={{ display: { xs: 'none', sm: 'inline-flex' }, flex: { xs: '1 1 auto', sm: '0 0 auto' } }}
              >
                导出 CSV
              </Button>
              <Button
                variant="outlined"
                startIcon={<FileDownloadOutlined />}
                onClick={handleExportJson}
                data-testid="export-bills-json-button"
                sx={{ display: { xs: 'none', sm: 'inline-flex' }, flex: { xs: '1 1 auto', sm: '0 0 auto' } }}
              >
                导出 JSON
              </Button>
            </>
          ) : null}
          <Button
            variant="outlined"
            startIcon={<BarChartOutlined />}
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.hash = '#/stats';
              }
            }}
            data-testid="go-bill-stats-button"
            sx={{ flex: { xs: '1 1 auto', sm: '0 0 auto' } }}
          >
            收支统计
          </Button>
          {interactive ? (
            <>
              {allBills.length > 0 ? (
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteSweepOutlined />}
                  onClick={() => setClearAllOpen(true)}
                  data-testid="clear-all-bills-button"
                  sx={{ display: { xs: 'none', sm: 'inline-flex' }, flex: { xs: '1 1 auto', sm: '0 0 auto' } }}
                >
                  清空全部账单
                </Button>
              ) : null}
              <Button
                variant="contained"
                startIcon={<AddOutlined />}
                onClick={openCreate}
                sx={{ flex: { xs: '1 1 auto', sm: '0 0 auto' } }}
              >
                记一笔
              </Button>
            </>
          ) : null}
        </Box>
      </Box>
      {exportMessage ? (
        <Alert
          severity="success"
          sx={{ mb: 2 }}
          onClose={() => setExportMessage(null)}
          data-testid="export-success-banner"
        >
          {exportMessage}
        </Alert>
      ) : null}
      {memoryBanner ? (
        <Alert
          severity="success"
          sx={{ mb: 2 }}
          onClose={() => setMemoryBanner(null)}
          data-testid="category-memory-banner"
        >
          {memoryBanner}
        </Alert>
      ) : null}
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}
      {transferPairs.length > 0 ? (
        <Alert
          severity="info"
          icon={<SwapHorizOutlined fontSize="inherit" />}
          sx={{ mb: 2, alignItems: 'center' }}
          data-testid="transfer-pair-banner"
          action={
            interactive ? (
              <Button
                color="inherit"
                size="small"
                variant="outlined"
                onClick={() => {
                  void handleMarkAllPairsAsTransfer();
                }}
                data-testid="mark-transfer-pairs-button"
              >
                一键标记为内部转账（不计收支）
              </Button>
            ) : null
          }
        >
          检测到 {transferPairs.length} 组疑似跨卡/本人互转流水（同日同金额一收一支，单向合计 ¥
          {formatAmount(
            transferPairs.reduce((acc, p) => acc + p.amountMinor, 0),
            'CNY',
          )}
          ），建议标记为「内部转账」以免虚增收支。
        </Alert>
      ) : null}
      {/* 账单可视化分析已独立至 #/stats 页面，此处通过样式类隐藏内联面板以保持首页整洁 */}
      <Box className="lifehub-bills-inline-dashboard" data-testid="bills-inline-dashboard-hidden">
        <BillVisualDashboard bills={bills} categories={effectiveCategories} />
      </Box>
      <BillFilterBar
        filters={filters}
        onChange={setFilters}
        onClear={clearFilters}
        categoryOptions={[
          ...effectiveCategories.map((category) => ({ id: category.id, name: category.name })),
          { id: '__uncategorized__', name: '未分类' },
        ]}
      />
      <LoadingOverlay visible={loading} label="正在解密账单…" />
      {groups.length === 0 && !loading ? (
        <EmptyState title="没有符合筛选条件的账单" description="试试调整搜索关键词或清空筛选条件。" />
      ) : (
        <BillGroupList
          groups={groups}
          onSelectGroup={(group) => setSelectedGroupDate(group.localDate)}
          renderBills={(group) => (
            <BillVirtualList
              bills={group.bills}
              categoryNames={categoryNames}
              sourceFileNames={sourceFileNames}
              categories={effectiveCategories}
              onQuickSelectCategory={
                interactive
                  ? (bill, catId) => {
                      void handleQuickSelectCategory(bill, catId);
                    }
                  : undefined
              }
              isTransferBill={(bill) => isInternalTransferBill(bill, categoryMap)}
              onToggleTransfer={
                interactive
                  ? (bill) => {
                      void handleToggleTransfer(bill);
                    }
                  : undefined
              }
              onEdit={interactive ? openEdit : undefined}
              onDelete={interactive ? handleDelete : undefined}
            />
          )}
        />
      )}
      {/* 手机端点击每日账单分组弹出的当日记录明细抽屉/弹窗 */}
      <Dialog
        open={Boolean(selectedDailyGroup)}
        onClose={() => setSelectedGroupDate(null)}
        fullWidth
        maxWidth="sm"
        data-testid="daily-bill-detail-dialog"
      >
        {selectedDailyGroup ? (
          <>
            <DialogTitle sx={{ pb: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                {formatLocalDate(selectedDailyGroup.localDate)} · {formatWeekday(selectedDailyGroup.localDate)}
              </Typography>
              <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)', mt: 0.5 }}>
                当天共记录 <strong>{selectedDailyGroup.bills.length}</strong> 笔 · 收入 ¥
                {formatAmount(selectedDailyGroup.incomeMinor)} · 支出 ¥
                {formatAmount(selectedDailyGroup.expenseMinor)}
              </Typography>
            </DialogTitle>
            <DialogContent dividers sx={{ p: 2 }}>
              <Stack spacing={1.5}>
                {selectedDailyGroup.bills.map((bill, index) => {
                  const categoryLabel =
                    (bill.categoryId ? categoryNames[bill.categoryId] : undefined) ?? '未分类';
                  const isExpense = bill.direction === 'expense';
                  const isIncome = bill.direction === 'income';
                  const sign = isExpense ? '-' : isIncome ? '+' : '';
                  return (
                    <Paper
                      key={bill.id}
                      variant="outlined"
                      data-testid={`daily-detail-item-${bill.id}`}
                      sx={{
                        p: 1.5,
                        borderRadius: 2.5,
                        borderLeft: `4px solid ${
                          isExpense ? '#DC2626' : isIncome ? '#16A34A' : '#6366F1'
                        }`,
                      }}
                    >
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
                            <Chip size="small" label={`#${index + 1}`} sx={{ height: 20, fontSize: '0.7rem' }} />
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                              {bill.counterparty || '未填写交易对方'}
                            </Typography>
                            <Chip
                              size="small"
                              variant="outlined"
                              label={categoryLabel}
                              sx={{ height: 20, fontSize: '0.7rem' }}
                            />
                          </Stack>
                          <Typography variant="body2" sx={{ color: 'var(--lifehub-text)', mt: 0.75 }}>
                            备注/内容：{bill.note || '无备注'}
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)', display: 'block', mt: 0.5 }}>
                            记录时间：{bill.localDate} {bill.occurredAt.slice(11, 19)}
                          </Typography>
                        </Box>
                        <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                          <Typography
                            variant="subtitle1"
                            className={
                              isExpense
                                ? 'lifehub-amount-expense'
                                : isIncome
                                  ? 'lifehub-amount-income'
                                  : undefined
                            }
                            sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                          >
                            {sign}¥{formatAmount(bill.amountMinor, bill.currency)}
                          </Typography>
                          {interactive ? (
                            <Stack direction="row" spacing={0.5} justifyContent="flex-end" sx={{ mt: 1 }}>
                              <Button
                                size="small"
                                variant="text"
                                startIcon={<EditOutlined fontSize="small" />}
                                onClick={() => {
                                  setSelectedGroupDate(null);
                                  openEdit(bill);
                                }}
                              >
                                编辑
                              </Button>
                              <Button
                                size="small"
                                color="error"
                                variant="text"
                                startIcon={<DeleteOutline fontSize="small" />}
                                onClick={() => {
                                  void handleDelete(bill);
                                }}
                              >
                                删除
                              </Button>
                            </Stack>
                          ) : null}
                        </Box>
                      </Stack>
                    </Paper>
                  );
                })}
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setSelectedGroupDate(null)}>关闭</Button>
            </DialogActions>
          </>
        ) : null}
      </Dialog>
      <Box sx={{ mt: 2 }}>
        <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)' }}>
          共 {bills.length} 条账单，按本地日历日分组显示。
        </Typography>
      </Box>
      {bills.length > 0 ? (
        <Button
          variant="contained"
          color="primary"
          size="small"
          startIcon={<KeyboardArrowUpOutlined />}
          onClick={handleBackToTop}
          aria-label="回到顶部"
          data-testid="back-to-top-button"
          sx={{
            position: 'fixed',
            right: { xs: 16, md: 24 },
            bottom: { xs: 'calc(84px + env(safe-area-inset-bottom, 0px))', md: 28 },
            zIndex: 1100,
            borderRadius: '999px',
            px: 2,
            py: 0.85,
            fontWeight: 600,
            boxShadow: '0 6px 20px rgba(37, 99, 235, 0.28)',
          }}
        >
          回到顶部
        </Button>
      ) : null}
      {dialog}
      <ConfirmDialog
        open={clearAllOpen}
        title="清空全部账单？"
        description="确定清空当前所有账单记录及关联导入批次吗？清空后无法恢复，但你可以随时重新导入账单文件。"
        confirmText="确认清空"
        onCancel={() => setClearAllOpen(false)}
        onConfirm={() => {
          setClearAllOpen(false);
          void clearAllBills();
        }}
      />
    </div>
  );
}
