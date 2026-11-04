/**
 * 应用外壳组件。
 *
 * 架构位置：apps/web 的「布局组件」层。
 *
 * 说明：桌面端 220px 侧导航 + 自适应流式全宽内容区（兼容 1080P / 2K / 4K 大屏）；<900px 由 CSS 折叠为底部 Tab。
 */
import type { ReactNode } from 'react';
import { Box } from '@mui/material';
import { SideNav } from './SideNav';

/** 应用外壳组件的属性。 */
export interface AppShellProps {
  /** 内容区。 */
  children: ReactNode;
}

/**
 * 渲染应用外壳。
 *
 * 说明：承载左侧导航栏与自适应全宽主内容容器。
 *
 * @param props 组件属性
 * @returns React 节点
 * @throws 无；纯布局组件不抛出异常
 */
export function AppShell({ children }: AppShellProps) {
  return (
    <Box className="lifehub-shell">
      <SideNav />
      <Box component="main" className="lifehub-content lifehub-main">
        {children}
      </Box>
    </Box>
  );
}
