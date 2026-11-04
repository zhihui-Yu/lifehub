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
      className="lifehub-topbar"
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1.5,
        mb: { xs: 2, md: 3 },
        pt: { xs: 'calc(env(safe-area-inset-top, 0px) + 12px)', md: 1.5 },
        pb: { xs: 1.25, md: 1.5 },
        px: { xs: 2, md: 0 },
        mx: { xs: -2, md: 0 },
        position: { xs: 'sticky', md: 'static' },
        top: 0,
        zIndex: 20,
        backgroundColor: { xs: 'var(--lifehub-glass-bg)', md: 'transparent' },
        backdropFilter: { xs: 'blur(12px)', md: 'none' },
        borderBottom: '1px solid var(--lifehub-border)',
      }}
    >
      <Typography
        variant="h5"
        component="h1"
        sx={{
          fontWeight: 800,
          letterSpacing: '-0.02em',
          fontSize: { xs: '1.15rem', sm: '1.35rem' },
          color: 'var(--lifehub-text)',
        }}
      >
        {title}
      </Typography>
      <Chip
        size="small"
        color={unlocked ? 'success' : 'default'}
        variant={unlocked ? 'filled' : 'outlined'}
        label={unlocked ? '本地 · 已解锁' : '本地 · 已加密 🔒'}
        aria-label={unlocked ? '保险库已解锁' : '保险库处于加密锁定状态'}
        sx={{
          fontWeight: 600,
          borderRadius: 999,
          px: 0.5,
        }}
      />
    </Box>
  );
}
