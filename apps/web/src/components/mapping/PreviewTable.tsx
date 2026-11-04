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
 * 所有业务数据列（含金额列）统一左对齐，确保表头「金额」与每行数值左边缘笔直对齐。
 *
 * @param props 组件属性
 * @returns React 节点
 * @throws 无显式抛出
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
            <TableCell sx={{ fontWeight: 600, color: 'var(--lifehub-text)' }}>日期</TableCell>
            <TableCell align="left" sx={{ fontWeight: 600, color: 'var(--lifehub-text)' }}>
              金额
            </TableCell>
            <TableCell sx={{ fontWeight: 600, color: 'var(--lifehub-text)' }}>方向</TableCell>
            <TableCell sx={{ fontWeight: 600, color: 'var(--lifehub-text)' }}>交易对方</TableCell>
            <TableCell sx={{ fontWeight: 600, color: 'var(--lifehub-text)' }}>备注</TableCell>
            <TableCell sx={{ fontWeight: 600, color: 'var(--lifehub-text)' }}>状态</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.rowIndex}>
              <TableCell sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: 'var(--lifehub-text)' }}>
                {row.localDate || '—'}
              </TableCell>
              <TableCell
                align="left"
                sx={{
                  fontVariantNumeric: 'tabular-nums',
                  fontFamily: 'var(--lifehub-font-mono, monospace)',
                  fontWeight: 600,
                  color:
                    row.direction === 'income'
                      ? 'success.main'
                      : row.direction === 'expense'
                        ? 'var(--lifehub-text)'
                        : 'var(--lifehub-text-muted)',
                }}
              >
                ¥{formatAmount(row.amountMinor)}
              </TableCell>
              <TableCell sx={{ color: 'var(--lifehub-text)' }}>
                {row.direction === 'expense' ? '支出' : row.direction === 'income' ? '收入' : '—'}
              </TableCell>
              <TableCell sx={{ color: 'var(--lifehub-text)' }}>{row.counterparty || '—'}</TableCell>
              <TableCell sx={{ color: 'var(--lifehub-text-muted)' }}>{row.note || '—'}</TableCell>
              <TableCell sx={{ color: row.error ? 'warning.main' : 'success.main' }}>
                {row.error ?? '正常'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
