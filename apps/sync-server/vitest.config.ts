import { defineConfig } from 'vitest/config';

/**
 * apps/sync-server 的 Vitest 配置。
 *
 * 说明：同步服务是纯 Node 服务（无 DOM），因此用 `node` 环境；
 * 测试会真的起一个临时实例（`:memory:` SQLite + 随机端口）并用 `fetch` 打真实 HTTP。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 说明：限制并发 worker 数，与 packages/core 保持一致。
    // 原因：根 vitest.config.ts 用 `test.projects` 聚合三个包时，
    // Vitest 5 要求同一 sequence.groupOrder 下的各项目 maxWorkers 一致，
    // 否则报 "Projects have different 'maxWorkers' but same 'sequence.groupOrder'"。
    // 固定为 4 也避免在多核机器上开满 worker 导致进程超订。
    maxWorkers: 4,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
    },
  },
});
