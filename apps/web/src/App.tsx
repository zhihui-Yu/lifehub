/**
 * 应用根组件。
 *
 * 架构位置：apps/web 的「表现层」入口。
 *
 * 说明：负责装配主题、路由与**保险库守卫**——
 * 未创建保险库时弹出阻断式的设置主密码对话框（X-02 ②）。
 */
import { useEffect, useMemo, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { SetPasswordDialog } from '@/components/security/SetPasswordDialog';
import { useVault } from '@/hooks/useVault';
import { router } from '@/router';
import { dekProvider, useSettingsStore, useVaultStore } from '@/store';

/**
 * 渲染应用根组件。
 *
 * 说明：默认关闭强制密码锁（`securityEnabled === false`），用户进入应用即自动解锁可用；
 * 当用户开启「安全与加密保护总开关」（`securityEnabled === true`）后，未创建或锁定时将弹出主密码对话框。
 *
 * @param _props 组件无外部入参
 * @returns React 节点
 * @throws 无；顶层组件不直接抛出异常
 */
export function App() {
  const { status, vaultCreated, error, createVault, unlock } = useVault();
  const themeMode = useSettingsStore((state) => state.theme);
  const securityEnabled = useSettingsStore((state) => state.securityEnabled);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (themeMode === 'dark') {
      return true;
    }
    if (themeMode === 'light') {
      return false;
    }
    return (
      typeof window !== 'undefined' &&
      Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches)
    );
  });

  // 当「安全与加密保护总开关」关闭（默认状态）时，免密直入并自动初始化会话密钥；
  // 当用户显式开启该开关后，在未创建或锁定态下弹出阻断式主密码对话框（X-02 ②）。
  useEffect(() => {
    if (!securityEnabled) {
      setDialogOpen(false);
      if (status === 'needs-setup' || status === 'locked') {
        const defaultDek = new Uint8Array(32).fill(7);
        if (!dekProvider.isUnlocked()) {
          dekProvider.setDek(defaultDek, 1);
        }
        useVaultStore.getState().setUnlocked(defaultDek, 1);
      }
      return;
    }
    if (status === 'needs-setup' || status === 'locked') {
      setDialogOpen(true);
    } else if (status === 'unlocked') {
      setDialogOpen(false);
    }
  }, [status, securityEnabled]);

  // 主题跟随设置（'system' 时跟随系统偏好），同步更新 html.dark 类与 MUI 主题模式。
  useEffect(() => {
    const root = document.documentElement;
    const mediaQuery =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;
    const computeIsDark = (): boolean => {
      if (themeMode === 'dark') {
        return true;
      }
      if (themeMode === 'light') {
        return false;
      }
      return Boolean(mediaQuery?.matches);
    };
    const applyTheme = (): void => {
      const nextDark = computeIsDark();
      setIsDark(nextDark);
      root.classList.toggle('dark', nextDark);
    };
    applyTheme();
    if (themeMode === 'system' && mediaQuery && typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', applyTheme);
      return () => {
        mediaQuery.removeEventListener('change', applyTheme);
      };
    }
    return undefined;
  }, [themeMode]);

  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: isDark ? 'dark' : 'light',
          primary: { main: isDark ? '#818cf8' : '#4f46e5' },
          success: { main: isDark ? '#22c55e' : '#16a34a' },
          error: { main: isDark ? '#f87171' : '#dc2626' },
          background: {
            default: isDark ? '#0f1117' : '#f7f7fb',
            paper: isDark ? '#181b23' : '#ffffff',
          },
          text: {
            primary: isDark ? '#f3f4f6' : '#111827',
            secondary: isDark ? '#cbd5e1' : '#4b5563',
          },
        },
        typography: {
          fontFamily:
            '"Inter", "Noto Sans SC", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        },
        shape: { borderRadius: 12 },
        components: {
          MuiPaper: {
            styleOverrides: {
              root: { backgroundImage: 'none', borderRadius: 14 },
              outlined: {
                borderColor: 'var(--lifehub-border)',
                boxShadow: 'var(--lifehub-shadow-sm)',
              },
            },
          },
          MuiButton: {
            styleOverrides: {
              root: {
                textTransform: 'none',
                fontWeight: 600,
                borderRadius: 10,
                boxShadow: 'none',
                '&:hover': { boxShadow: 'none' },
              },
              sizeSmall: { padding: '5px 12px' },
              sizeMedium: { padding: '8px 16px' },
            },
          },
          MuiChip: {
            styleOverrides: {
              root: { fontWeight: 500, borderRadius: 8 },
            },
          },
          MuiDialog: {
            styleOverrides: {
              paper: { borderRadius: 16, margin: 12, width: 'calc(100% - 24px)' },
            },
          },
        },
      }),
    [isDark],
  );

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
