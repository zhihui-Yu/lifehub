/**
 * 应用根组件。
 *
 * 架构位置：apps/web 的「表现层」入口。
 *
 * 说明：负责装配主题、路由与**保险库守卫**——
 * 未创建保险库时弹出阻断式的设置主密码对话框（X-02 ②）。
 */
import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { SetPasswordDialog } from '@/components/security/SetPasswordDialog';
import { useVault } from '@/hooks/useVault';
import { router } from '@/router';
import { useSettingsStore } from '@/store';

/** 全局 MUI 主题。 */
const theme = createTheme({
  palette: {
    primary: { main: '#4f46e5' },
    success: { main: '#16a34a' },
    error: { main: '#dc2626' },
  },
  typography: {
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
  },
});

/**
 * 渲染应用根组件。
 *
 * @returns React 节点
 */
export function App() {
  const { status, vaultCreated, error, createVault, unlock } = useVault();
  const themeMode = useSettingsStore((state) => state.theme);
  const [dialogOpen, setDialogOpen] = useState(false);

  // 首次进入且尚未创建保险库时，弹出阻断式引导（X-02 ②）。
  useEffect(() => {
    if (status === 'needs-setup') {
      setDialogOpen(true);
    }
  }, [status]);

  // 主题跟随设置（'system' 时跟随系统偏好）。
  useEffect(() => {
    const root = document.documentElement;
    const prefersDark =
      themeMode === 'dark' ||
      (themeMode === 'system' &&
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    root.classList.toggle('dark', prefersDark);
  }, [themeMode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <RouterProvider router={router} />
      <SetPasswordDialog
        open={dialogOpen}
        mode={vaultCreated ? 'unlock' : 'create'}
        error={error}
        onSubmit={async (password) => {
          const ok = vaultCreated ? await unlock(password) : await createVault(password);
          if (ok) {
            setDialogOpen(false);
          }
          return ok;
        }}
      />
    </ThemeProvider>
  );
}
