/**
 * 应用外壳组件。
 *
 * 架构位置：apps/web 的「布局组件」层。
 *
 * 说明：桌面端 220px 侧导航 + 1280px 内容区；<900px 由 CSS 折叠为底部 Tab。
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
 * @param props 组件属性
 * @returns React 节点
 */
export function AppShell({ children }: AppShellProps) {
  return (
    <Box className="lifehub-shell">
      <SideNav />
      <Box component="main" className="lifehub-content">
        {children}
      </Box>
    </Box>
  );
}
