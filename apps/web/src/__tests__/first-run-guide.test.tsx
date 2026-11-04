/**
 * 阻断式首次引导测试。
 *
 * 覆盖需求：X-02 ② —— 「首次进入必须设置主密码（阻断式弹窗），
 * 需勾选『我已知悉忘记密码将无法恢复』方可继续」；UI-04 交互要点 1。
 *
 * 说明：
 * 1. `SetPasswordDialog` 组件级测试：验证「不勾选就不给提交」这条硬约束；
 * 2. `App` 级测试：验证未创建保险库时**任何页面**都会弹出该对话框，
 *    且对话框**没有「取消」按钮**（阻断式，用户无法绕过）。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/App';
import { SetPasswordDialog } from '@/components/security/SetPasswordDialog';
import { useSettingsStore } from '@/store';
// 说明：jsdom 未实现 window.matchMedia，App 的主题跟随逻辑需要它，这里补齐。
import '@/__tests__/test-utils/polyfills';

/** 可变的保险库会话替身。 */
const vaultState = vi.hoisted(() => ({
  status: 'needs-setup' as 'uninitialized' | 'needs-setup' | 'locked' | 'unlocked',
  vaultCreated: false,
  error: null as string | null,
  createVault: vi.fn<(password: string) => Promise<boolean>>(),
  unlock: vi.fn<(password: string) => Promise<boolean>>(),
  runtime: {
    cryptoProvider: { name: 'web-crypto' },
    importBatchRepository: { list: async () => [] },
    auditLogger: { list: async () => [], clear: async () => undefined },
  },
}));

vi.mock('@/hooks/useVault', () => ({
  useVault: () => ({
    status: vaultState.status,
    vaultCreated: vaultState.vaultCreated,
    error: vaultState.error,
    failedAttempts: 0,
    recoveryBundle: null,
    runtime: vaultState.runtime,
    createVault: vaultState.createVault,
    unlock: vaultState.unlock,
    unlockWithRecoveryCode: vi.fn(),
    regenerateRecoveryCode: vi.fn(),
    lock: vi.fn(),
  }),
}));

/**
 * 用内存路由替换 hash 路由。
 *
 * 说明：`@/router` 用的是 `createHashRouter`，在 jsdom 里会挂到 `window.location.hash` 上，
 * 既引入全部页面（拖慢用例），又难以断言具体落点；
 * 这里替换成只含一个占位页面的 `createMemoryRouter`，
 * 使被测对象始终是 **App 自身的阻断式守卫逻辑**。
 */
vi.mock('@/router', async () => {
  const { createMemoryRouter } = await import('react-router-dom');
  const { createElement } = await import('react');
  return {
    router: createMemoryRouter([
      {
        path: '*',
        element: createElement('div', { 'data-testid': 'route-placeholder' }, '页面内容'),
      },
    ]),
  };
});

describe('SetPasswordDialog 组件（X-02 ②）', () => {
  it('展示常驻风险提示与确认复选框', () => {
    render(<SetPasswordDialog open onSubmit={vi.fn()} />);

    expect(screen.getByText('设置主密码')).toBeInTheDocument();
    expect(screen.getByText('忘记主密码且没有恢复码时，数据将永久无法恢复。')).toBeInTheDocument();
    expect(screen.getByLabelText('我已知悉忘记密码将无法恢复')).toBeInTheDocument();
  });

  it('没有勾选确认项时「创建保险库」按钮禁用', () => {
    render(<SetPasswordDialog open onSubmit={vi.fn()} />);

    const submit = screen.getByRole('button', { name: '创建保险库' });
    expect(submit).toBeDisabled();
  });

  it('密码不足 8 位时按钮仍然禁用', () => {
    render(<SetPasswordDialog open onSubmit={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('主密码'), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('确认主密码'), { target: { value: 'short' } });
    fireEvent.click(screen.getByLabelText('我已知悉忘记密码将无法恢复'));

    expect(screen.getByRole('button', { name: '创建保险库' })).toBeDisabled();
  });

  it('两次输入不一致时给出中文提示且按钮禁用', () => {
    render(<SetPasswordDialog open onSubmit={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('主密码'), { target: { value: 'correct-password' } });
    fireEvent.change(screen.getByLabelText('确认主密码'), { target: { value: 'different-password' } });
    fireEvent.click(screen.getByLabelText('我已知悉忘记密码将无法恢复'));

    expect(screen.getByText('两次输入不一致')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建保险库' })).toBeDisabled();
  });

  it('勾选确认项且两次密码一致（≥8 位）后才能提交', async () => {
    const onSubmit = vi.fn<(password: string) => Promise<boolean>>();
    onSubmit.mockResolvedValue(true);
    render(<SetPasswordDialog open onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('主密码'), { target: { value: 'correct-password' } });
    fireEvent.change(screen.getByLabelText('确认主密码'), { target: { value: 'correct-password' } });

    // 仅填密码、还没勾选 → 依旧禁用。
    expect(screen.getByRole('button', { name: '创建保险库' })).toBeDisabled();

    fireEvent.click(screen.getByLabelText('我已知悉忘记密码将无法恢复'));

    const submit = screen.getByRole('button', { name: '创建保险库' });
    expect(submit).toBeEnabled();

    await act(async () => {
      fireEvent.click(submit);
    });
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('correct-password');
    });
  });

  it('解锁模式下不要求勾选确认项（保险库已创建）', async () => {
    const onSubmit = vi.fn<(password: string) => Promise<boolean>>();
    onSubmit.mockResolvedValue(true);
    render(<SetPasswordDialog open mode="unlock" onSubmit={onSubmit} />);

    expect(screen.getByText('解锁保险库')).toBeInTheDocument();
    expect(screen.queryByLabelText('我已知悉忘记密码将无法恢复')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('主密码'), { target: { value: 'any-password' } });
    const submit = screen.getByRole('button', { name: '解锁' });
    expect(submit).toBeEnabled();

    await act(async () => {
      fireEvent.click(submit);
    });
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('any-password');
    });
  });
});

describe('App 阻断式首次引导（X-02 ②）', () => {
  beforeEach(() => {
    vaultState.status = 'needs-setup';
    vaultState.vaultCreated = false;
    vaultState.error = null;
    vaultState.createVault.mockReset();
    vaultState.unlock.mockReset();
    vaultState.createVault.mockResolvedValue(true);
    useSettingsStore.getState().setSecurityEnabled(true);
  });

  it('当安全与加密总开关默认关闭（securityEnabled=false）时，免密直入不弹出主密码对话框', async () => {
    useSettingsStore.getState().setSecurityEnabled(false);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('route-placeholder')).toBeInTheDocument();
    });
    expect(screen.queryByText('设置主密码')).not.toBeInTheDocument();
  });

  it('未创建保险库时进入任何页面都会弹出设置主密码对话框', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('设置主密码')).toBeInTheDocument();
    });
    // 对话框里同时给出风险提示与确认复选框。
    expect(screen.getByText('忘记主密码且没有恢复码时，数据将永久无法恢复。')).toBeInTheDocument();
    expect(screen.getByLabelText('我已知悉忘记密码将无法恢复')).toBeInTheDocument();
  });

  it('阻断式对话框没有「取消」按钮，用户无法绕过', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('设置主密码')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument();
  });

  it('勾选确认项并提交后调用建库', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('设置主密码')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('主密码'), { target: { value: 'correct-password' } });
    fireEvent.change(screen.getByLabelText('确认主密码'), { target: { value: 'correct-password' } });
    fireEvent.click(screen.getByLabelText('我已知悉忘记密码将无法恢复'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '创建保险库' }));
    });

    await waitFor(() => {
      expect(vaultState.createVault).toHaveBeenCalledWith('correct-password');
    });
  });

  it('保险库已解锁时不再弹出阻断式引导', async () => {
    vaultState.status = 'unlocked';
    vaultState.vaultCreated = true;
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('route-placeholder')).toBeInTheDocument();
    });
    expect(screen.queryByText('设置主密码')).not.toBeInTheDocument();
  });

  it('保险库处于锁定态（status=locked）时自动弹出解锁保险库对话框', async () => {
    vaultState.status = 'locked';
    vaultState.vaultCreated = true;
    vaultState.unlock.mockResolvedValue(true);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('解锁保险库')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText('主密码'), { target: { value: 'correct-password' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '解锁' }));
    });
    await waitFor(() => {
      expect(vaultState.unlock).toHaveBeenCalledWith('correct-password');
    });
  });

  it('切换深浅色主题时同步更新 html.dark 与 MUI 主题', async () => {
    const { useSettingsStore } = await import('@/store');
    vaultState.status = 'unlocked';
    vaultState.vaultCreated = true;

    act(() => {
      useSettingsStore.getState().setTheme('dark');
    });
    render(<App />);

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    act(() => {
      useSettingsStore.getState().setTheme('light');
    });
    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
  });
});
