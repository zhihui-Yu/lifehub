/**
 * 顶栏安全区与无障碍标题组件。
 *
 * 架构位置：apps/web 的「布局组件」层。
 *
 * 说明：桌面端左侧导航已承载品牌标识，各页面自带一级标题栏；此处仅保留移动端顶部安全区留白与屏幕阅读器语义 h1，消除重复顶栏。
 */
import { Box, Typography } from '@mui/material';

/** 顶栏组件的属性。 */
export interface TopBarProps {
  /** 页面标题。 */
  title: string;
}

/**
 * 渲染极简安全区顶栏。
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
        pt: { xs: 'calc(env(safe-area-inset-top, 0px) + 14px)', md: 0 },
        position: 'relative',
      }}
    >
      <Typography
        component="h1"
        sx={{
          position: 'absolute',
          width: 1,
          height: 1,
          p: 0,
          m: -1,
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {title}
      </Typography>
    </Box>
  );
}
