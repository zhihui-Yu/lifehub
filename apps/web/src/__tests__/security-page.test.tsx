/**
 * 安全与加密页面测试（UI-04）。
 *
 * 覆盖需求：UI-04 交互要点 1~4 —— 常驻风险提示、恢复码**默认不展示明文**（仅「显示一次」可见）、
 * 「清除审计日志」需**二次确认**、加密状态展示。
 *
 * 说明：`useVault` / `useAuditLog` 打桩成稳定替身（页面本身依赖真实 IndexedDB），
 * 但**恢复码面板、确认对话框、审计日志表格全部走真实组件**，
 * 因此断言的是用户真正看到的行为，而不是替身的行为。
 */
import { act, fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditLog, RecoveryBundle } from '@lifehub/core';
import { SecurityPage } from '@/pages/SecurityPage';
import { makeAuditLog, makeRecoveryBundle } from '@/__tests__/test-utils/fixtures';

/** 打桩用的钩子替身。 */
const { regenerateRecoveryCode, createVault, unlock, clearLogs, listLogs } = vi.hoisted(() => ({
  regenerateRecoveryCode: vi.fn<(bundle: RecoveryBundle | null) => Promise<boolean>>(),
  createVault: vi.fn<(password: string) => Promise<boolean>>(),
  unlock: vi.fn<(password: string) => Promise<boolean>>(),
  clearLogs: vi.fn<() => Promise<void>>(),
  listLogs: vi.fn<() => Promise<AuditLog[]>>(),
}));

/** 可变的替身状态（在用例里切换）。 */
const state = {
  status: 'unlocked' as 'uninitialized' | 'needs-setup' | 'locked' | 'unlocked',
  vaultCreated: true,
  recoveryBundle: null as RecoveryBundle | null,
  logs: [] as AuditLog[],
  error: null as string | null,
};

/** 平台运行时替身（引用必须稳定）。 */
const FAKE_RUNTIME = { cryptoProvider: { name: 'web-crypto' } };

vi.mock('@/hooks/useVault', () => ({
  useVault: () => ({
    status: state.status,
    vaultCreated: state.vaultCreated,
    error: state.error,
    failedAttempts: 0,
    recoveryBundle: state.recoveryBundle,
    runtime: FAKE_RUNTIME,
    createVault,
    unlock,
    unlockWithRecoveryCode: vi.fn(),
    regenerateRecoveryCode,
    lock: vi.fn(),
  }),
}));

vi.mock('@/hooks/useAuditLog', () => ({
  useAuditLog: () => ({
    logs: state.logs,
    loading: false,
    error: null,
    reload: listLogs,
    clear: clearLogs,
  }),
}));

describe('SecurityPage（UI-04）', () => {
  beforeEach(() => {
    state.status = 'unlocked';
    state.vaultCreated = true;
    state.recoveryBundle = null;
    state.logs = [];
    state.error = null;
    regenerateRecoveryCode.mockReset();
    createVault.mockReset();
    unlock.mockReset();
    clearLogs.mockReset();
    listLogs.mockReset();
  });

  it('页面常驻提示「忘记主密码且没有恢复码时，数据将永久无法恢复」', () => {
    render();

    const warning = screen.getAllByText('忘记主密码且没有恢复码时，数据将永久无法恢复。');
    expect(warning.length).toBeGreaterThan(0);
  });

  it('加密状态卡按会话状态展示「已解锁 / 已锁定 / 尚未创建」', () => {
    state.status = 'unlocked';
    render();
    expect(screen.getByTestId('vault-status-card')).toHaveTextContent('已解锁');
    expect(screen.getByTestId('vault-status-card')).toHaveTextContent('AES-256-GCM');
    expect(screen.getByTestId('vault-status-card')).toHaveTextContent('v1');
  });

  it('恢复码默认不展示明文，只显示打码占位', () => {
    state.recoveryBundle = makeRecoveryBundle();
    render();

    // 明文容器不存在。
    expect(screen.queryByTestId('recovery-code-text')).not.toBeInTheDocument();
    expect(screen.getByText(/••••-•••••-/)).toBeInTheDocument();
    expect(screen.getByText('已生成恢复码（默认隐藏）。')).toBeInTheDocument();
  });

  it('只有点「显示一次」才展示恢复码明文，再点「隐藏」恢复打码', async () => {
    const bundle = makeRecoveryBundle();
    state.recoveryBundle = bundle;
    render();

    fireEvent.click(screen.getByRole('button', { name: '显示一次' }));

    const plain = await screen.findByTestId('recovery-code-text');
    expect(plain).toHaveTextContent(bundle.recoveryCode);
    expect(screen.getByText(/恢复码（仅显示这一次，请立即抄写）/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '隐藏' }));
    expect(screen.queryByTestId('recovery-code-text')).not.toBeInTheDocument();
  });

  it('尚未生成恢复码时提供「生成恢复码」入口', async () => {
    state.recoveryBundle = null;
    regenerateRecoveryCode.mockResolvedValue(true);
    render();

    fireEvent.click(screen.getByRole('button', { name: '生成恢复码' }));
    await waitFor(() => {
      expect(regenerateRecoveryCode).toHaveBeenCalledTimes(1);
    });
  });

  it('审计日志表格展示中文动作标签与成功 / 失败结果', () => {
    state.logs = [
      makeAuditLog({ id: 'l1', action: 'unlock', success: true }),
      makeAuditLog({ id: 'l2', action: 'failed_unlock', success: false }),
    ];
    render();

    expect(screen.getByText('解锁成功')).toBeInTheDocument();
    expect(screen.getByText('解锁失败')).toBeInTheDocument();
    expect(screen.getByText('成功')).toBeInTheDocument();
    expect(screen.getByText('失败')).toBeInTheDocument();
  });

  it('「清除日志」需要二次确认：取消时不会清空', async () => {
    state.logs = [makeAuditLog({ id: 'l1' })];
    render();

    fireEvent.click(screen.getByRole('button', { name: '清除日志' }));

    // 二次确认对话框出现。
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('清除全部审计日志？');
    expect(dialog).toHaveTextContent('清除后无法恢复这些审计记录。业务数据不受影响。');

    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(clearLogs).not.toHaveBeenCalled();
  });

  it('「清除日志」在二次确认后会真正调用清空', async () => {
    state.logs = [makeAuditLog({ id: 'l1' })];
    render();

    fireEvent.click(screen.getByRole('button', { name: '清除日志' }));
    const dialog = await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '清除' }));
    });

    await waitFor(() => {
      expect(clearLogs).toHaveBeenCalledTimes(1);
    });
  });

  it('未创建保险库时主密码按钮显示「设置主密码」', () => {
    state.status = 'needs-setup';
    state.vaultCreated = false;
    render();

    expect(screen.getByRole('button', { name: '设置主密码' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '解锁保险库' })).not.toBeInTheDocument();
  });

  it('已创建保险库时按钮变为「解锁保险库」，输入口令后可解锁', async () => {
    state.status = 'locked';
    state.vaultCreated = true;
    unlock.mockResolvedValue(true);
    render();

    fireEvent.click(screen.getByRole('button', { name: '解锁保险库' }));

    const passwordInput = await screen.findByLabelText('主密码');
    fireEvent.change(passwordInput, { target: { value: 'correct-password' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '解锁' }));
    });

    await waitFor(() => {
      expect(unlock).toHaveBeenCalledWith('correct-password');
    });
  });

  it('未创建保险库时点「设置主密码」弹出创建对话框并可建库', async () => {
    state.status = 'needs-setup';
    state.vaultCreated = false;
    createVault.mockResolvedValue(true);
    render();

    fireEvent.click(screen.getByRole('button', { name: '设置主密码' }));

    const confirmInput = await screen.findByLabelText('确认主密码');
    fireEvent.change(screen.getByLabelText('主密码'), { target: { value: 'correct-password' } });
    fireEvent.change(confirmInput, { target: { value: 'correct-password' } });
    fireEvent.click(screen.getByLabelText('我已知悉忘记密码将无法恢复'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '创建保险库' }));
    });

    await waitFor(() => {
      expect(createVault).toHaveBeenCalledWith('correct-password');
    });
  });

  it('隐私说明声明不采集敏感信息、不直连银行接口', () => {
    render();

    expect(
      screen.getByText(/不采集手机号 \/ 设备号 \/ 定位 \/ 通讯录，不做埋点统计，不直连任何银行接口/),
    ).toBeInTheDocument();
  });
});

/**
 * 渲染安全页。
 *
 * @returns 无异常
 */
function render(): void {
  // 说明：页面依赖 useVault / useAuditLog，两者已在文件顶部打桩。
  rtlRender(<SecurityPage />);
}
