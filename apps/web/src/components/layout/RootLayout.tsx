/**
 * 根布局组件：侧导航 + 顶栏 + 内容区。
 *
 * 架构位置：apps/web 的「路由布局」层。
 *
 * 说明：单独成文件是为了满足 `react-refresh/only-export-components` 约束 ——
 * 该规则要求一个文件要么只导出 React 组件、要么只导出非组件值，
 * 而 `router.tsx` 需要导出路由表（非组件），因此组件必须独立成文件。
 */
import { Outlet } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { TopBar } from '@/components/layout/TopBar';

/**
 * 根布局组件：侧导航 + 顶栏 + 内容区。
 *
 * @returns React 节点
 */
export function RootLayout() {
  return (
    <AppShell>
      <TopBar title="LifeHub" />
      <Outlet />
    </AppShell>
  );
}
