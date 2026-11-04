/**
 * 账单行组件。
 *
 * 架构位置：apps/web 的「账单组件」层。
 *
 * 说明：列含日期、金额（含方向标识）、对方、分类、来源文件（PRD A-08 ③）。
 * 解锁态下额外提供「编辑 / 删除」操作（A 模块记账闭环）。
 */
import { useState } from 'react';
import { Box, Chip, IconButton, Menu, MenuItem, TableCell, TableRow, Tooltip } from '@mui/material';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import EditOutlined from '@mui/icons-material/EditOutlined';
import SwapHorizOutlined from '@mui/icons-material/SwapHorizOutlined';
import { toWallClock, type Bill, type Category } from '@lifehub/core';
import { AmountText } from '@/components/common/AmountText';
import { CategoryIcon, ChannelIcon } from '@/components/common/VisualIcons';
import { useSettingsStore } from '@/store';

/** 账单表格跨日期分组统一固定列宽契约（确保 10.20 与 10.22 等不同分组卡片内各字段 100% 垂直对齐）。 */
export const BILL_TABLE_COLUMN_WIDTHS = {
  date: '120px',
  amount: '150px',
  counterparty: '18%',
  note: '26%',
  category: '16%',
  sourceFile: '18%',
  actions: '116px',
} as const;

/** 账单行组件的属性。 */
export interface BillRowProps {
  /** 账单实体。 */
  bill: Bill;
  /** 分类 id → 名称映射。 */
  categoryNames: Record<string, string>;
  /** 导入批次 id → 文件名映射。 */
  sourceFileNames: Record<string, string>;
  /** 可选分类列表（提供且配合 onQuickSelectCategory 时支持行内点击快速归类）。 */
  categories?: readonly Category[];
  /** 行内快速选择分类回调（自动记住相同项并批量归类）。 */
  onQuickSelectCategory?: (bill: Bill, categoryId: string | null) => void;
  /** 是否属于内部转账（不计入收支统计）。 */
  isTransfer?: boolean;
  /** 切换「内部转账 / 正常收支」回调。 */
  onToggleTransfer?: (bill: Bill) => void;
  /** 编辑回调；提供时显示编辑按钮。 */
  onEdit?: (bill: Bill) => void;
  /** 删除回调；提供时显示删除按钮。 */
  onDelete?: (bill: Bill) => void;
}

/**
 * 渲染账单行。
 *
 * 采用与表头 `<colgroup>` 1:1 对应的 7 列固定列宽契约与单行溢出省略策略，确保不同日期分组表格内所有列垂直对齐。
 *
 * @param props 组件属性
 * @returns React 节点
 * @throws 无显式抛出
 */
export function BillRow({
  bill,
  categoryNames,
  sourceFileNames,
  categories,
  onQuickSelectCategory,
  isTransfer = false,
  onToggleTransfer,
  onEdit,
  onDelete,
}: BillRowProps) {
  const [categoryMenuAnchor, setCategoryMenuAnchor] = useState<HTMLElement | null>(null);
  const canQuickSelect = Boolean(onQuickSelectCategory && categories && categories.length > 0);
  const timezone = useSettingsStore((state) => state.timezone);
  const effectiveTimeZone =
    timezone ||
    (typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      : 'UTC');
  let wallClock = '00:00';
  if (bill.occurredAt) {
    const parsed = new Date(bill.occurredAt);
    if (!Number.isNaN(parsed.getTime())) {
      try {
        wallClock = toWallClock(parsed, effectiveTimeZone);
      } catch {
        wallClock = toWallClock(parsed, 'UTC');
      }
    }
  }
  const categoryLabel = bill.categoryId
    ? (categoryNames[bill.categoryId] ?? '未分类')
    : isTransfer
      ? '内部转账'
      : '未分类';
  const sourceFileName = sourceFileNames[bill.sourceFileId];

  return (
    <TableRow hover data-testid="bill-row">
      <TableCell
        className="lifehub-bill-cell-date"
        title={`${bill.localDate} ${wallClock} (${effectiveTimeZone})`}
        sx={{
          width: BILL_TABLE_COLUMN_WIDTHS.date,
          whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--lifehub-text)',
        }}
      >
        {bill.localDate}
      </TableCell>
      <TableCell
        className="lifehub-bill-cell-amount"
        align="left"
        sx={{
          width: BILL_TABLE_COLUMN_WIDTHS.amount,
          whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <AmountText amountMinor={bill.amountMinor} direction={bill.direction} currency={bill.currency} />
      </TableCell>
      <TableCell
        className="lifehub-bill-cell-counterparty"
        title={bill.counterparty || undefined}
        sx={{
          width: BILL_TABLE_COLUMN_WIDTHS.counterparty,
          maxWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: 'var(--lifehub-text)',
        }}
      >
        {bill.counterparty || '—'}
      </TableCell>
      <TableCell
        className="lifehub-bill-cell-note"
        title={bill.note || undefined}
        sx={{
          width: BILL_TABLE_COLUMN_WIDTHS.note,
          maxWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: 'var(--lifehub-text)',
        }}
      >
        {bill.note || '—'}
      </TableCell>
      <TableCell
        className="lifehub-bill-cell-category"
        sx={{
          width: BILL_TABLE_COLUMN_WIDTHS.category,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          color: 'var(--lifehub-text)',
        }}
      >
        <Box
          onClick={
            canQuickSelect
              ? (event) => {
                  setCategoryMenuAnchor(event.currentTarget);
                }
              : undefined
          }
          title={canQuickSelect ? '点击快速选择分类（自动记住相同项并批量归类）' : undefined}
          data-testid={`bill-category-trigger-${bill.id}`}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            flexWrap: 'nowrap',
            maxWidth: '100%',
            cursor: canQuickSelect ? 'pointer' : 'default',
            borderRadius: 1,
            px: canQuickSelect ? 0.5 : 0,
            py: canQuickSelect ? 0.25 : 0,
            '&:hover': canQuickSelect
              ? {
                  backgroundColor: 'action.hover',
                }
              : undefined,
          }}
        >
          <CategoryIcon name={categoryLabel} size={20} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{categoryLabel}</span>
          {isTransfer ? (
            <Chip
              size="small"
              label="不计收支"
              variant="outlined"
              sx={{
                height: 20,
                fontSize: '0.7rem',
                color: 'var(--lifehub-primary)',
                borderColor: 'var(--lifehub-primary)',
              }}
              data-testid="transfer-badge"
            />
          ) : null}
        </Box>
        {canQuickSelect && categories ? (
          <Menu
            anchorEl={categoryMenuAnchor}
            open={Boolean(categoryMenuAnchor)}
            onClose={() => setCategoryMenuAnchor(null)}
            data-testid="quick-category-menu"
          >
            {categories.map((cat) => (
              <MenuItem
                key={cat.id}
                selected={bill.categoryId === cat.id}
                onClick={() => {
                  setCategoryMenuAnchor(null);
                  onQuickSelectCategory?.(bill, cat.id);
                }}
                data-testid={`quick-category-option-${cat.id}`}
                sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: '0.875rem' }}
              >
                <CategoryIcon name={cat.name} size={18} />
                <span>{cat.name}</span>
              </MenuItem>
            ))}
            <MenuItem
              selected={bill.categoryId === null}
              onClick={() => {
                setCategoryMenuAnchor(null);
                onQuickSelectCategory?.(bill, null);
              }}
              data-testid="quick-category-option-none"
              sx={{ fontSize: '0.875rem', color: 'var(--lifehub-text-muted)' }}
            >
              未分类
            </MenuItem>
          </Menu>
        ) : null}
      </TableCell>
      <TableCell
        className="lifehub-bill-cell-source"
        title={sourceFileName || undefined}
        sx={{
          width: BILL_TABLE_COLUMN_WIDTHS.sourceFile,
          maxWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: 'var(--lifehub-text-muted)',
        }}
      >
        {sourceFileName ? (
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, maxWidth: '100%', overflow: 'hidden' }}>
            <ChannelIcon fileName={sourceFileName} size={18} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sourceFileName}</span>
          </Box>
        ) : (
          '—'
        )}
      </TableCell>
      <TableCell
        className="lifehub-bill-cell-actions"
        align="right"
        sx={{
          width: BILL_TABLE_COLUMN_WIDTHS.actions,
          whiteSpace: 'nowrap',
        }}
      >
        {onToggleTransfer || onEdit || onDelete ? (
          <>
            {onToggleTransfer ? (
              <Tooltip title={isTransfer ? '恢复计入收支' : '设为内部转账（不计收支）'}>
                <IconButton
                  size="small"
                  color={isTransfer ? 'primary' : 'default'}
                  aria-label={isTransfer ? '恢复计入收支' : '设为内部转账'}
                  onClick={() => onToggleTransfer(bill)}
                  data-testid={`toggle-transfer-${bill.id}`}
                >
                  <SwapHorizOutlined fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
            {onEdit ? (
              <Tooltip title="编辑">
                <IconButton size="small" aria-label="编辑账单" onClick={() => onEdit(bill)}>
                  <EditOutlined fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
            {onDelete ? (
              <Tooltip title="删除">
                <IconButton size="small" aria-label="删除账单" onClick={() => onDelete(bill)}>
                  <DeleteOutline fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
          </>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
