/**
 * 顶栏组件。
 *
 * 架构位置：apps/web 的「布局组件」层。
 *
 * 说明：展示账户状态胶囊「本地 · 已加密 🔒」，
 * 让用户随时知道自己的数据处于加密状态（PRD UI-04）。
 */
import { Box, Chip, Typography } from '@mui/material';

/** 顶栏组件的属性。 */
export interface TopBarProps {
  /** 页面标题。 */
  title: string;
  /** 是否已解锁。 */
  unlocked: boolean;
}

/**
 * 渲染顶栏。
 *
 * @param props 组件属性
 * @returns React 节点
 */
export function TopBar({ title, unlocked }: TopBarProps) {
  return (
    <Box
      component="header"
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
        mb: 3,
      }}
    >
      <Typography variant="h5" component="h1" sx={{ fontWeight: 700, color: 'var(--lifehub-text)' }}>
        {title}
      </Typography>
      <Chip
        size="small"
        color={unlocked ? 'success' : 'default'}
        variant={unlocked ? 'filled' : 'outlined'}
        label={unlocked ? '本地 · 已解锁' : '本地 · 已加密 🔒'}
        aria-label={unlocked ? '保险库已解锁' : '保险库处于加密锁定状态'}
      />
    </Box>
  );
}
