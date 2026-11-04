/**
 * 首页根路径智能分流组件。
 *
 * 架构位置：apps/web 的「布局与路由辅助组件」层。
 *
 * 说明：移动端（窗口宽度 `<= 900px` 且非显式访问 `#/import`）打开根路径 `/` 时，
 * 自动重定向至高频核心页面 `/bills`（账单列表）；桌面端（`> 900px`）保持渲染 `<ImportPage />`，
 * 既让手机端启动即见账单与记一笔，又 100% 兼容桌面端与 JSDOM（1024px）自动化测试。
 */
import { Navigate } from 'react-router-dom';
import { ImportPage } from '@/pages/ImportPage';

/**
 * 渲染首页根路径分流节点。
 *
 * 说明：根据当前视口宽度与 Hash 路径决定渲染账单列表重定向或导入账单页。
 *
 * @param _props 组件无入参
 * @returns React 节点
 * @throws 无；纯路由分流组件不抛出异常
 */
export function HomeIndexRoute() {
  if (
    typeof window !== 'undefined' &&
    window.innerWidth <= 900 &&
    window.location.hash !== '#/import'
  ) {
    return <Navigate to="/bills" replace />;
  }
  return <ImportPage />;
}
