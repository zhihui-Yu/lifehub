/**
 * 审计日志表格。
 *
 * 架构位置：apps/web 的「安全组件」层。
 *
 * 说明：展示时间 / 动作 / 对象 / 结果；「清除日志」需二次确认（X-07 ④）。
 */
import { Box, Button, Paper, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import type { AuditLog } from '@lifehub/core';
import { AUDIT_ACTION_LABELS } from '@lifehub/core';
import { formatRelativeTime } from '@/utils/format';

/** 审计日志表格的属性。 */
export interface AuditLogTableProps {
  /** 日志列表。 */
  logs: AuditLog[];
  /** 清除回调（由页面负责二次确认）。 */
  onClear: () => void;
}

/**
 * 渲染审计日志表格。
 *
 * @param props 组件属性
 * @returns React 节点
 */
export function AuditLogTable({ logs, onClear }: AuditLogTableProps) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5 }} data-testid="audit-log-table">
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography variant="h6" sx={{ color: 'var(--lifehub-text)' }}>
          审计日志
        </Typography>
        <Button size="small" color="error" onClick={onClear}>
          清除日志
        </Button>
      </Box>
      {logs.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)' }}>
          暂无审计日志。
        </Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>时间</TableCell>
              <TableCell>动作</TableCell>
              <TableCell>对象</TableCell>
              <TableCell>结果</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {logs.map((log) => (
              <TableRow key={log.id}>
                <TableCell>{formatRelativeTime(log.at)}</TableCell>
                <TableCell>{AUDIT_ACTION_LABELS[log.action]}</TableCell>
                <TableCell>{log.target || '—'}</TableCell>
                <TableCell>{log.success ? '成功' : '失败'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Paper>
  );
}
