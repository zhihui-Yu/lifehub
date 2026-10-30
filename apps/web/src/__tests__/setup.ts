/**
 * apps/web 的 Vitest 全局准备脚本。
 *
 * 说明：引入 `@testing-library/jest-dom` 的自定义断言扩展
 * （`toBeInTheDocument` / `toHaveTextContent` 等），让组件测试的断言更直观。
 */
import '@testing-library/jest-dom/vitest';
