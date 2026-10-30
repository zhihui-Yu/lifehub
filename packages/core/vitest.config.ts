import { defineConfig } from 'vitest/config';

/**
 * packages/core 的 Vitest 配置。
 * 覆盖率门禁（NF-M-4）：核心层整体 ≥ 80%，加密 / CSV / 时间 / 金额四个目录要求 100%。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/index.ts', 'src/crypto/providers/node-crypto-provider.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
        'src/money/**': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'src/time/**': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'src/crypto/**': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'src/csv/**': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
      },
    },
  },
});
