/**
 * 错误摘要组件。
 *
 * 架构位置：apps/web 的「通用组件」层。
 *
 * 说明：展示导入过程中被跳过的行（行号 + 原因 + 原文），对应 PRD A-11 ③。
 */
import { Alert, AlertTitle, Box, Typography } from '@mui/material';
import type { ImportError } from '@lifehub/core';

/** 错误摘要组件的属性。 */
export interface ErrorSummaryProps {
  /** 错误明细列表。 */
  errors: ImportError[];
  /** 最多展示的条数，默认 20。 */
  maxItems?: number;
}

/**
 * 渲染错误摘要。
 *
 * @param props 组件属性
 * @returns React 节点；无错误时返回 null
 */
export function ErrorSummary({ errors, maxItems = 20 }: ErrorSummaryProps) {
  if (errors.length === 0) {
    return null;
  }
  const shown = errors.slice(0, maxItems);
  return (
    <Alert severity="warning" sx={{ mt: 2 }} data-testid="error-summary">
      <AlertTitle>已跳过 {errors.length} 行</AlertTitle>
      <Box component="ul" sx={{ m: 0, pl: 2, maxHeight: 220, overflowY: 'auto' }}>
        {shown.map((error) => (
          <Typography component="li" variant="body2" key={`${error.rowIndex}-${error.reason}`}>
            第 {error.rowIndex + 1} 行：{error.reason}
          </Typography>
        ))}
      </Box>
      {errors.length > maxItems ? (
        <Typography variant="caption">其余 {errors.length - maxItems} 行已省略。</Typography>
      ) : null}
    </Alert>
  );
}
