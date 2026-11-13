/**
 * 顶栏组件。
 *
 * 架构位置：apps/web 的「布局组件」层。
 *
 * 说明：仅展示页面标题。加密已默认静默处理，不再向用户暴露「已解锁 / 已加密」状态胶囊。
 */
import { Box, Typography } from '@mui/material';

/** 顶栏组件的属性。 */
export interface TopBarProps {
  /** 页面标题。 */
  title: string;
}

/**
 * 渲染顶栏。
 *
 * @param props 组件属性
 * @returns React 节点
 */
export function TopBar({ title }: TopBarProps) {
  return (
    <Box
      component="header"
      className="lifehub-topbar"
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1.5,
        mb: { xs: 2, md: 2 },
        pt: { xs: 'calc(env(safe-area-inset-top, 0px) + 12px)', md: 0 },
        pb: { xs: 1.25, md: 0.5 },
        px: { xs: 2, md: 0 },
        mx: { xs: -2, md: 0 },
        position: { xs: 'sticky', md: 'static' },
        top: 0,
        zIndex: 20,
        backgroundColor: { xs: 'var(--lifehub-glass-bg)', md: 'transparent' },
        backdropFilter: { xs: 'blur(12px)', md: 'none' },
        borderBottom: { xs: '1px solid var(--lifehub-border)', md: 'none' },
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
    </Box>
  );
}
