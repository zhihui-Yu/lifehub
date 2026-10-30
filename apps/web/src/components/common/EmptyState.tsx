/**
 * 空状态组件。
 *
 * 架构位置：apps/web 的「通用组件」层。
 */
import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';

/** 空状态组件的属性。 */
export interface EmptyStateProps {
  /** 主标题。 */
  title: string;
  /** 补充说明。 */
  description?: string;
  /** 操作按钮。 */
  action?: ReactNode;
}

/**
 * 渲染空状态。
 *
 * @param props 组件属性
 * @returns React 节点
 */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        py: 8,
        textAlign: 'center',
        border: '1px dashed var(--lifehub-border)',
        borderRadius: 2,
        backgroundColor: 'var(--lifehub-surface)',
      }}
    >
      <Typography variant="h6" component="p" sx={{ mb: 1, color: 'var(--lifehub-text)' }}>
        {title}
      </Typography>
      {description ? (
        <Typography variant="body2" sx={{ mb: 2, color: 'var(--lifehub-text-muted)' }}>
          {description}
        </Typography>
      ) : null}
      {action}
    </Box>
  );
}
