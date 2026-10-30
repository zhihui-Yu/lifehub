/**
 * 最近导入列表组件。
 *
 * 架构位置：apps/web 的「导入组件」层。
 *
 * 说明：展示文件名 / 行数 / 相对时间 / 重复标记（PRD UI-01）。
 */
import { Box, Chip, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import type { ImportBatch } from '@lifehub/core';
import { formatRelativeTime } from '@/utils/format';

/** 最近导入列表组件的属性。 */
export interface RecentImportsProps {
  /** 导入批次列表。 */
  batches: ImportBatch[];
  /** 当前文件的哈希（用于标记「重复」）。 */
  currentFileHash?: string;
}

/**
 * 渲染最近导入列表。
 *
 * @param props 组件属性
 * @returns React 节点；无数据时返回 null
 */
export function RecentImports({ batches, currentFileHash }: RecentImportsProps) {
  if (batches.length === 0) {
    return null;
  }
  return (
    <Box sx={{ mt: 4 }}>
      <Typography variant="h6" sx={{ mb: 1, color: 'var(--lifehub-text)' }}>
        最近导入
      </Typography>
      <Box sx={{ border: '1px solid var(--lifehub-border)', borderRadius: 2, overflow: 'hidden' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>文件名</TableCell>
              <TableCell>行数</TableCell>
              <TableCell>时间</TableCell>
              <TableCell>状态</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {batches.map((batch) => (
              <TableRow key={batch.id} hover>
                <TableCell>{batch.fileName}</TableCell>
                <TableCell>{batch.rowImported}</TableCell>
                <TableCell>{formatRelativeTime(batch.createdAt)}</TableCell>
                <TableCell>
                  {currentFileHash && currentFileHash === batch.fileHash ? (
                    <Chip size="small" color="warning" label="重复文件" />
                  ) : (
                    <Chip size="small" variant="outlined" label="已导入" />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Box>
  );
}
