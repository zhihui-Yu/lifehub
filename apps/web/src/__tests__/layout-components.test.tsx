/**
 * 布局组件测试（顶栏 / 侧导航 / 外壳）。
 *
 * 覆盖需求：UI-04 交互要点 —— 顶栏常驻展示「本地 · 已加密 🔒」状态胶囊，
 * 让用户随时知道自己的数据处于加密状态；侧导航提供四个页面入口。
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { RootLayout } from '@/components/layout/RootLayout';
import { SideNav } from '@/components/layout/SideNav';
import { TopBar } from '@/components/layout/TopBar';

/** 可变的保险库会话替身（引用必须稳定）。 */
const vaultState = vi.hoisted(() => ({
  status: 'unlocked' as 'uninitialized' | 'needs-setup' | 'locked' | 'unlocked',
}));

vi.mock('@/hooks/useVault', () => ({
  useVault: () => ({
    status: vaultState.status,
    vaultCreated: true,
    error: null,
    failedAttempts: 0,
    recoveryBundle: null,
    runtime: { cryptoProvider: { name: 'web-crypto' } },
    createVault: vi.fn(),
    unlock: vi.fn(),
    unlockWithRecoveryCode: vi.fn(),
    regenerateRecoveryCode: vi.fn(),
    lock: vi.fn(),
  }),
}));

describe('TopBar', () => {
  it('锁定时展示「本地 · 已加密 🔒」胶囊', () => {
    render(<TopBar title="LifeHub" unlocked={false} />);

    expect(screen.getByRole('heading', { name: 'LifeHub' })).toBeInTheDocument();
    expect(screen.getByText('本地 · 已加密 🔒')).toBeInTheDocument();
    expect(screen.getByLabelText('保险库处于加密锁定状态')).toBeInTheDocument();
  });

  it('解锁时展示「本地 · 已解锁」胶囊', () => {
    render(<TopBar title="LifeHub" unlocked />);

    expect(screen.getByText('本地 · 已解锁')).toBeInTheDocument();
    expect(screen.getByLabelText('保险库已解锁')).toBeInTheDocument();
  });
});

describe('SideNav', () => {
  it('展示四个页面入口', () => {
    render(
      <MemoryRouter initialEntries={['/import']}>
        <SideNav />
      </MemoryRouter>,
    );

    expect(screen.getByText('导入账单')).toBeInTheDocument();
    expect(screen.getByText('账单列表')).toBeInTheDocument();
    expect(screen.getByText('安全与加密')).toBeInTheDocument();
    expect(screen.getByText('设置')).toBeInTheDocument();
    expect(screen.getByText('本地优先 · 端到端加密')).toBeInTheDocument();
  });

  it('当前路由对应的入口被标记为选中', () => {
    render(
      <MemoryRouter initialEntries={['/bills']}>
        <SideNav />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: '账单列表' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '导入账单' })).not.toHaveAttribute('aria-current');
  });
});

describe('AppShell', () => {
  it('渲染侧导航与内容区', () => {
    render(
      <MemoryRouter initialEntries={['/import']}>
        <AppShell>
          <div data-testid="shell-content">页面内容</div>
        </AppShell>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('shell-content')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    expect(screen.getByText('导入账单')).toBeInTheDocument();
  });
});

describe('RootLayout', () => {
  it('装配侧导航、顶栏与子路由内容', () => {
    vaultState.status = 'unlocked';
    render(
      <MemoryRouter initialEntries={['/bills']}>
        <Routes>
          <Route element={<RootLayout />}>
            <Route path="bills" element={<div data-testid="outlet-content">账单页</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    // 顶栏标题是 h1；侧导航里的品牌名是 h6，两者同名，用层级区分。
    expect(screen.getByRole('heading', { level: 1, name: 'LifeHub' })).toBeInTheDocument();
    expect(screen.getByTestId('outlet-content')).toBeInTheDocument();
    // 顶栏状态跟随保险库会话。
    expect(screen.getByText('本地 · 已解锁')).toBeInTheDocument();
  });

  it('保险库锁定时顶栏展示加密状态胶囊', () => {
    vaultState.status = 'locked';
    render(
      <MemoryRouter initialEntries={['/bills']}>
        <Routes>
          <Route element={<RootLayout />}>
            <Route path="bills" element={<Outlet />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('本地 · 已加密 🔒')).toBeInTheDocument();
  });
});
