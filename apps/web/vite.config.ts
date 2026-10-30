import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * apps/web 的 Vite 配置。
 *
 * 关键点：
 * 1. `@lifehub/core` 直接指向**源码**（monorepo 内部包不打包），
 *    避免构建顺序依赖与「源码与产物不一致」问题（系统设计 §1.3）；
 * 2. 别名 `@` 指向 `src/`，保持导入路径清晰；
 * 3. 生产构建注入 CSP，禁止任何指向外部域名的请求（X-06 ② / R7）。
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@lifehub/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  define: {
    // 标记生产构建，供 Logger 丢弃 debug / info 日志（系统设计 §8.5）。
    __IS_PROD__: JSON.stringify(process.env['NODE_ENV'] === 'production'),
  },
});
