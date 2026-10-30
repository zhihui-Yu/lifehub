/**
 * 加载遮罩组件。
 *
 * 架构位置：apps/web 的「通用组件」层。
 */
import { Box, CircularProgress, Typography } from '@mui/material';

/** 加载遮罩组件的属性。 */
export interface LoadingOverlayProps {
  /** 是否显示。 */
  visible: boolean;
  /** 提示文案。 */
  label?: string;
}

/**
 * 渲染加载遮罩。
 *
 * @param props 组件属性
 * @returns React 节点
 */
export function LoadingOverlay({ visible, label = '正在处理…' }: LoadingOverlayProps) {
  if (!visible) {
    return null;
  }
  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        py: 4,
      }}
    >
      <CircularProgress size={20} />
      <Typography variant="body2">{label}</Typography>
    </Box>
  );
}
