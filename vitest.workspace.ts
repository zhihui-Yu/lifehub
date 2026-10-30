import { defineWorkspace } from 'vitest/config';

/**
 * Vitest 多包工作区。
 * - packages/core：node 环境，零 DOM 依赖的领域层单测
 * - apps/web：jsdom 环境，React 组件与 store 测试
 */
export default defineWorkspace(['packages/core', 'apps/web']);
