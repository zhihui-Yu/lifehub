/**
 * 最近导入列表组件。
 *
 * 架构位置：apps/web 的「导入组件」层。
 *
 * 说明：展示文件名 / 行数 / 相对时间 / 重复标记（PRD UI-01）。
 */
import {
  Box,
  Button,
  Chip,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import DeleteSweepOutlined from '@mui/icons-material/DeleteSweepOutlined';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import type { ImportBatch } from '@lifehub/core';
import { ChannelIcon } from '@/components/common/VisualIcons';
import { formatRelativeTime } from '@/utils/format';

/** 最近导入列表组件的属性。 */
export interface RecentImportsProps {
  /** 导入批次列表。 */
  batches: ImportBatch[];
  /** 当前文件的哈希（用于标记「重复」）。 */
  currentFileHash?: string;
  /** 按批次删除回调（连同该批次导入的账单一并移除）。 */
  onDeleteBatch?: (batch: ImportBatch) => void;
  /** 清空全部导入记录与关联账单回调。 */
  onClearAllBatches?: () => void;
}

/**
 * 渲染最近导入列表。
 *
 * 说明：展示文件名（含渠道图标）/ 行数 / 相对时间 / 重复标记，并支持按批次删除或清空全部导入记录。
 *
 * @param props 组件属性
 * @returns React 节点；无数据时返回 null
 * @throws 无；纯展示组件不抛出异常
 */
export function RecentImports({
  batches,
  currentFileHash,
  onDeleteBatch,
  onClearAllBatches,
}: RecentImportsProps) {
  if (batches.length === 0) {
    return null;
  }
  return (
    <Box sx={{ mt: 4 }} data-testid="recent-imports">
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
        <Typography
          variant="h6"
          sx={{ color: 'var(--lifehub-text)', display: 'flex', alignItems: 'center', gap: 1, fontSize: { xs: '1.05rem', sm: '1.2rem' } }}
        >
          <HistoryOutlined fontSize="small" color="primary" />
          最近导入
        </Typography>
        {onClearAllBatches ? (
          <Button
            size="small"
            color="error"
            variant="outlined"
            startIcon={<DeleteSweepOutlined />}
            onClick={onClearAllBatches}
            data-testid="clear-all-batches-button"
          >
            清空全部导入记录
          </Button>
        ) : null}
      </Box>
      <Box
        sx={{
          border: '1px solid var(--lifehub-border)',
          borderRadius: 3,
          overflowX: 'auto',
          backgroundColor: 'var(--lifehub-surface)',
        }}
      >
        <Table size="small" sx={{ minWidth: 420 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, color: 'var(--lifehub-text)' }}>文件名</TableCell>
              <TableCell sx={{ fontWeight: 600, color: 'var(--lifehub-text)' }}>行数</TableCell>
              <TableCell sx={{ fontWeight: 600, color: 'var(--lifehub-text)' }}>时间</TableCell>
              <TableCell sx={{ fontWeight: 600, color: 'var(--lifehub-text)' }}>状态</TableCell>
              {onDeleteBatch ? (
                <TableCell align="right" sx={{ fontWeight: 600, color: 'var(--lifehub-text)' }}>
                  操作
                </TableCell>
              ) : null}
            </TableRow>
          </TableHead>
          <TableBody>
            {batches.map((batch) => (
              <TableRow key={batch.id} hover>
                <TableCell sx={{ color: 'var(--lifehub-text)' }}>
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                    <ChannelIcon channel={batch.sourceChannel} fileName={batch.fileName} size={22} />
                    <span>{batch.fileName}</span>
                  </Box>
                </TableCell>
                <TableCell sx={{ color: 'var(--lifehub-text)', fontVariantNumeric: 'tabular-nums' }}>
                  {batch.rowImported}
                </TableCell>
                <TableCell sx={{ color: 'var(--lifehub-text-muted)' }}>
                  {formatRelativeTime(batch.createdAt)}
                </TableCell>
                <TableCell>
                  {currentFileHash && currentFileHash === batch.fileHash ? (
                    <Chip size="small" color="warning" label="重复文件" />
                  ) : (
                    <Chip
                      size="small"
                      variant="outlined"
                      label="已导入"
                      sx={{ color: 'var(--lifehub-text)', borderColor: 'var(--lifehub-border)' }}
                    />
                  )}
                </TableCell>
                {onDeleteBatch ? (
                  <TableCell align="right">
                    <Tooltip title="删除该批次及关联账单">
                      <IconButton
                        size="small"
                        color="error"
                        aria-label={`删除导入记录 ${batch.fileName}`}
                        onClick={() => onDeleteBatch(batch)}
                        data-testid={`delete-batch-${batch.id}`}
                      >
                        <DeleteOutline fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Box>
  );
}
