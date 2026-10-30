/**
 * 路由表。
 *
 * 架构位置：apps/web 的「路由」层，对应 PRD §5.0。
 *
 * 说明：使用 hash 路由，保证静态部署（无服务端 rewrite）时也能直接访问深链接。
 * 根布局路由负责装配 AppShell 与 TopBar。
 *
 * 根布局组件已独立到 `components/layout/RootLayout.tsx` ——
 * `react-refresh/only-export-components` 要求组件文件不混放非组件导出，
 * 而本文件需要导出路由表。
 */
import { createHashRouter } from 'react-router-dom';
import { RootLayout } from '@/components/layout/RootLayout';
import { BillsPage } from '@/pages/BillsPage';
import { ImportPage } from '@/pages/ImportPage';
import { MappingPage } from '@/pages/MappingPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { SecurityPage } from '@/pages/SecurityPage';
import { SettingsPage } from '@/pages/SettingsPage';

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
