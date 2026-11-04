/**
 * 虚拟化长列表。
 *
 * 架构位置：apps/web 的「账单组件」层。
 *
 * 说明：使用 `@tanstack/react-virtual`，
 * 保证 1 万条账单滚动不掉帧且 DOM 节点数不随数据量线性增长（A-09 ④ / A-27）。
 */
import { useRef } from 'react';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Bill, Category } from '@lifehub/core';
import { BillRow, BILL_TABLE_COLUMN_WIDTHS } from './BillRow';

/** 虚拟列表的属性。 */
export interface BillVirtualListProps {
  /** 待展示的账单。 */
  bills: Bill[];
  /** 分类 id → 名称映射。 */
  categoryNames: Record<string, string>;
  /** 导入批次 id → 文件名映射。 */
  sourceFileNames: Record<string, string>;
  /** 可选分类列表（用于行内点击快速选择分类）。 */
  categories?: readonly Category[];
  /** 行内快速选择分类回调。 */
  onQuickSelectCategory?: (bill: Bill, categoryId: string | null) => void;
  /** 判断某条账单是否为内部转账。 */
  isTransferBill?: (bill: Bill) => boolean;
  /** 切换「内部转账 / 正常收支」回调。 */
  onToggleTransfer?: (bill: Bill) => void;
  /** 编辑账单回调。 */
  onEdit?: (bill: Bill) => void;
  /** 删除账单回调。 */
  onDelete?: (bill: Bill) => void;
  /** 估算行高（像素），默认 44。 */
  estimateSize?: number;
}

/**
 * 渲染虚拟化长列表。
 *
 * 使用 `tableLayout: 'fixed'` 与 `<colgroup>` 固定 7 列列宽，使不同日期分组表格内所有列垂直对齐。
 *
 * @param props 组件属性
 * @returns React 节点
 * @throws 无显式抛出
 */
export function BillVirtualList({
  bills,
  categoryNames,
  sourceFileNames,
  categories,
  onQuickSelectCategory,
  isTransferBill,
  onToggleTransfer,
  onEdit,
  onDelete,
  estimateSize = 44,
}: BillVirtualListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: bills.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan: 12,
  });
  const hasActions = Boolean(onToggleTransfer || onEdit || onDelete);

  return (
    <div ref={parentRef} style={{ maxHeight: '62vh', overflow: 'auto' }} data-testid="bill-virtual-list">
      <Table size="small" sx={{ width: '100%', tableLayout: 'fixed' }} data-testid="bill-group-table">
        <colgroup data-testid="bill-table-colgroup">
          <col style={{ width: BILL_TABLE_COLUMN_WIDTHS.date }} />
          <col style={{ width: BILL_TABLE_COLUMN_WIDTHS.amount }} />
          <col style={{ width: BILL_TABLE_COLUMN_WIDTHS.counterparty }} />
          <col style={{ width: BILL_TABLE_COLUMN_WIDTHS.note }} />
          <col style={{ width: BILL_TABLE_COLUMN_WIDTHS.category }} />
          <col style={{ width: BILL_TABLE_COLUMN_WIDTHS.sourceFile }} />
          <col style={{ width: BILL_TABLE_COLUMN_WIDTHS.actions }} />
        </colgroup>
        <TableHead>
          <TableRow>
            <TableCell
              sx={{
                width: BILL_TABLE_COLUMN_WIDTHS.date,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                color: 'var(--lifehub-text)',
              }}
            >
              日期
            </TableCell>
            <TableCell
              align="left"
              sx={{
                width: BILL_TABLE_COLUMN_WIDTHS.amount,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                color: 'var(--lifehub-text)',
              }}
            >
              金额
            </TableCell>
            <TableCell
              sx={{
                width: BILL_TABLE_COLUMN_WIDTHS.counterparty,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                color: 'var(--lifehub-text)',
              }}
            >
              交易对方
            </TableCell>
            <TableCell
              sx={{
                width: BILL_TABLE_COLUMN_WIDTHS.note,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                color: 'var(--lifehub-text)',
              }}
            >
              账单内容 / 备注
            </TableCell>
            <TableCell
              sx={{
                width: BILL_TABLE_COLUMN_WIDTHS.category,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                color: 'var(--lifehub-text)',
              }}
            >
              分类
            </TableCell>
            <TableCell
              sx={{
                width: BILL_TABLE_COLUMN_WIDTHS.sourceFile,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                color: 'var(--lifehub-text)',
              }}
            >
              来源文件
            </TableCell>
            <TableCell
              align="right"
              sx={{
                width: BILL_TABLE_COLUMN_WIDTHS.actions,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                color: 'var(--lifehub-text)',
              }}
            >
              {hasActions ? '操作' : null}
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const bill = bills[virtualRow.index];
            if (!bill) {
              return null;
            }
            return (
              <BillRow
                key={bill.id}
                bill={bill}
                categoryNames={categoryNames}
                sourceFileNames={sourceFileNames}
                categories={categories}
                onQuickSelectCategory={onQuickSelectCategory}
                isTransfer={isTransferBill ? isTransferBill(bill) : false}
                onToggleTransfer={onToggleTransfer}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
