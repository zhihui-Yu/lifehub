/**
 * 预览表格。
 *
 * 架构位置：apps/web 的「映射组件」层。
 *
 * 说明：映射变更时实时重算**前 10 行**预览（PRD A-05 ④ / A-10 ②）。
 */
import { Box, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import type { PreviewRow } from '@lifehub/core';
import { formatAmount } from '@/utils/format';

/** 预览表格的属性。 */
export interface PreviewTableProps {
  /** 预览行。 */
  rows: PreviewRow[];
}

/**
 * 渲染预览表格。
 *
 * @param props 组件属性
 * @returns React 节点
 */
export function PreviewTable({ rows }: PreviewTableProps) {
  if (rows.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)' }}>
        暂无可预览的数据行。
      </Typography>
    );
  }
  return (
    <Box sx={{ border: '1px solid var(--lifehub-border)', borderRadius: 2, overflowX: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>日期</TableCell>
            <TableCell align="right">金额</TableCell>
            <TableCell>方向</TableCell>
            <TableCell>交易对方</TableCell>
            <TableCell>备注</TableCell>
            <TableCell>状态</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.rowIndex}>
              <TableCell>{row.localDate || '—'}</TableCell>
              <TableCell align="right">¥{formatAmount(row.amountMinor)}</TableCell>
              <TableCell>{row.direction ?? '—'}</TableCell>
              <TableCell>{row.counterparty || '—'}</TableCell>
              <TableCell>{row.note || '—'}</TableCell>
              <TableCell>{row.error ?? '正常'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
