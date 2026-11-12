import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * 本地开发与预览环境下的原生文件夹选择与文件落盘中间件（支持 Windows 原生 FolderBrowserDialog 返回完整绝对路径）。
 */
function lifehubDesktopNativePlugin(): Plugin {
  const attachMiddleware = (middlewares: {
    use: (fn: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => void) => void;
  }) => {
    middlewares.use((req, res, next) => {
      if (req.url === '/__lifehub_desktop__/pick-directory' && req.method === 'POST') {
        const psScript = [
          'Add-Type -AssemblyName System.Windows.Forms;',
          '$f = New-Object System.Windows.Forms.FolderBrowserDialog;',
          '$f.Description = "选择 LifeHub 本地文件存储目录";',
          '$f.ShowNewFolderButton = $true;',
          '$top = New-Object System.Windows.Forms.Form;',
          '$top.TopMost = $true;',
          'if ($f.ShowDialog($top) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($f.SelectedPath) }',
        ].join(' ');

        execFile(
          'powershell.exe',
          ['-NoProfile', '-STA', '-Command', psScript],
          { timeout: 120_000 },
          (err, stdout) => {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            if (err) {
              res.end(JSON.stringify({ path: null, cancelled: true }));
              return;
            }
            const picked = (stdout || '').trim();
            res.end(JSON.stringify({ path: picked || null, cancelled: !picked }));
          },
        );
        return;
      }

      if (req.url === '/__lifehub_desktop__/save-file' && req.method === 'POST') {
        let rawBody = '';
        req.on('data', (chunk: Buffer) => {
          rawBody += chunk.toString('utf8');
        });
        req.on('end', () => {
          try {
            const parsed = JSON.parse(rawBody) as {
              fileName?: string;
              content?: string;
              subDir?: string;
            };
            const safeName = (parsed.fileName || 'lifehub-export.json').replace(/[<>:"/\\|?*]/g, '_');
            const subDir = (parsed.subDir || 'LifeHub').trim();
            const targetDir = /^[A-Za-z]:[/\\]/.test(subDir)
              ? resolve(subDir)
              : join(homedir(), 'Downloads', subDir);
            mkdirSync(targetDir, { recursive: true });
            const fullPath = join(targetDir, safeName);
            writeFileSync(fullPath, parsed.content ?? '', 'utf8');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: true, fullPath }));
          } catch (e) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : 'write failed' }));
          }
        });
        return;
      }

      next();
    });
  };

  return {
    name: 'lifehub-desktop-native-bridge',
    configureServer(server) {
      attachMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      attachMiddleware(server.middlewares);
    },
  };
}

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
  plugins: [react(), lifehubDesktopNativePlugin()],
  resolve: {
    alias: {
      '@lifehub/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // 绑定 IPv4 loopback：部分 Windows 环境对 IPv6 `::1` 的 bind 会被拦截。
    host: '127.0.0.1',
    // 默认端口避开 Windows Hyper-V/WSL 动态「排除端口段」（如 5147-5246），
    // 否则 bind 会直接 EACCES（非占用，netstat 不可见）。
    port: 4180,
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
