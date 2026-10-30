/**
 * 账单行组件。
 *
 * 架构位置：apps/web 的「账单组件」层。
 *
 * 说明：列含日期、金额（含方向标识）、对方、分类、来源文件（PRD A-08 ③）。
 */
import { TableCell, TableRow } from '@mui/material';
import type { Bill } from '@lifehub/core';
import { AmountText } from '@/components/common/AmountText';

/** 账单行组件的属性。 */
export interface BillRowProps {
  /** 账单实体。 */
  bill: Bill;
  /** 分类 id → 名称映射。 */
  categoryNames: Record<string, string>;
  /** 导入批次 id → 文件名映射。 */
  sourceFileNames: Record<string, string>;
}

/**
 * 渲染账单行。
 *
 * @param props 组件属性
 * @returns React 节点
 */
export function BillRow({ bill, categoryNames, sourceFileNames }: BillRowProps) {
  return (
    <TableRow hover data-testid="bill-row">
      <TableCell sx={{ whiteSpace: 'nowrap' }}>{bill.localDate}</TableCell>
      <TableCell align="right">
        <AmountText amountMinor={bill.amountMinor} direction={bill.direction} currency={bill.currency} />
      </TableCell>
      <TableCell>{bill.counterparty || '—'}</TableCell>
      <TableCell>{bill.categoryId ? (categoryNames[bill.categoryId] ?? '未分类') : '未分类'}</TableCell>
      <TableCell>{sourceFileNames[bill.sourceFileId] ?? '—'}</TableCell>
    </TableRow>
  );
}
