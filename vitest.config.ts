import { defineConfig } from 'vitest/config';

/**
 * Vitest 5 多包工作区（根配置）。
 *
 * 【为什么用根配置而不是 vitest.workspace.ts】
 * Vitest 4 起移除了 `test.workspace` 字段，Vitest 5 会直接抛错：
 * > The `test.workspace` option was removed in Vitest 4. Please, migrate to `test.projects` instead.
 * 因此改用官方推荐的 `test.projects` 写法，把每个包作为一个独立项目纳入。
 *
 * 各包自身的环境与门禁仍由包内 `vitest.config.ts` 决定：
 * - packages/core：node 环境，零 DOM 依赖的领域层单测（覆盖率门禁 NF-M-4）
 * - apps/web：jsdom 环境，React 组件与 store 测试
 * - apps/sync-server：node 环境，同步服务（只存密文）
 *
 * 注意：根 `npm run test` 走的是 `npm run test --workspaces --if-present`，
 * 会逐包执行各自的 `test` 脚本；本文件用于让「在根目录直接跑 vitest」也能覆盖全部包。
 */
export default defineConfig({
  test: {
    projects: ['packages/core', 'apps/web', 'apps/sync-server'],
  },
});
