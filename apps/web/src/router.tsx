/**
 * 路由表。
 *
 * 架构位置：apps/web 的「路由」层，对应 PRD §5.0。
 *
 * 说明：使用 hash 路由，保证静态部署（无服务端 rewrite）时也能直接访问深链接。
 * 根布局路由负责装配 AppShell 与 TopBar。
 */
import { Outlet, createHashRouter } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { TopBar } from '@/components/layout/TopBar';
import { BillsPage } from '@/pages/BillsPage';
import { ImportPage } from '@/pages/ImportPage';
import { MappingPage } from '@/pages/MappingPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { SecurityPage } from '@/pages/SecurityPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { useVault } from '@/hooks/useVault';

/**
 * 根布局组件：侧导航 + 顶栏 + 内容区。
 *
 * @returns React 节点
 */
function RootLayout() {
  const { status } = useVault();
  return (
    <AppShell>
      <TopBar title="LifeHub" unlocked={status === 'unlocked'} />
      <Outlet />
    </AppShell>
  );
}

/**
 * 路由配置。
 */
export const router = createHashRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      { index: true, element: <ImportPage /> },
      { path: 'import', element: <ImportPage /> },
      { path: 'import/mapping', element: <MappingPage /> },
      { path: 'bills', element: <BillsPage /> },
      { path: 'security', element: <SecurityPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
