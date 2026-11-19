/**
 * 分类管理路由兼容页面（A-01 ② 分类维度维护）。
 *
 * 架构位置：apps/web 的「页面」层。
 *
 * 说明：日常入口已整合进「账单列表」页顶部工具栏与「记一笔」弹窗；
 * 本页面作为 `/categories` 路由兼容入口保留，直接复用 `CategoryManagerPanel`。
 */
import { CategoryManagerPanel } from '@/components/categories/CategoryManagerDialog';

/**
 * 渲染分类管理页面。
 */
export function CategoriesPage() {
  return (
    <div data-testid="categories-page">
      <CategoryManagerPanel />
    </div>
  );
}
