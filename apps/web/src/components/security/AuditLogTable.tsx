/**
 * 审计日志表格。
 *
 * 架构位置：apps/web 的「安全组件」层。
 *
 * 说明：展示时间 / 动作 / 对象 / 结果；「清除日志」需二次确认（X-07 ④）。
 */
import { Box, Button, Paper, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
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
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: 3, overflowX: 'auto' }} data-testid="audit-log-table">
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
        <Typography variant="h6" sx={{ color: 'var(--lifehub-text)', display: 'flex', alignItems: 'center', gap: 1 }}>
          <HistoryOutlined fontSize="small" color="primary" />
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
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 360 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>时间</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>动作</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>对象</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>结果</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatRelativeTime(log.at)}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{AUDIT_ACTION_LABELS[log.action]}</TableCell>
                  <TableCell>{log.target || '—'}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{log.success ? '成功' : '失败'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
    </Paper>
  );
}
