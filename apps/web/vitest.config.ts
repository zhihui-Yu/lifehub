import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * apps/web 的 Vitest 配置（jsdom 环境）。
 *
 * 说明：与 core 包的 node 环境测试分开配置，避免 DOM 依赖泄漏进核心层。
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@lifehub/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/__tests__/setup.ts'],
    // 说明：首次导入 `@lifehub/core` 需要转换约 90 个源文件，
    // 在 CI 机器上可能超过默认的 5 秒超时，因此这里放宽单测超时。
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/vite-env.d.ts'],
    },
  },
});
