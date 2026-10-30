/**
 * 保险库会话 Hook 测试。
 *
 * 覆盖需求：X-02（首次进入必须设置主密码）、X-03（恢复码）、X-04（口令本地安全存储）、
 * X-07（解锁失败计数与冷却）。
 *
 * 说明：`@/platform` 的 `createPlatformRuntime` / `createVaultService` 被替换成受控替身，
 * 但**真实的 `useVault` Hook** 与**真实的 vault-store** 全部保留，
 * 因此断言的是真实的会话状态流转（含失败计数、DEK 装入供给器、锁定擦除）。
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecoveryBundle } from '@lifehub/core';
import { useVault } from '@/hooks/useVault';
import { dekProvider, useVaultStore } from '@/store/vault-store';
import { makeRecoveryBundle } from '@/__tests__/test-utils/fixtures';

/** 受控的平台运行时与保险库服务替身。 */
const { fakeRuntime, fakeVaultService } = vi.hoisted(() => {
  const runtime = {
    storageAdapter: { open: vi.fn(async () => undefined), close: vi.fn(async () => undefined) },
    vaultRepository: { load: vi.fn<() => Promise<unknown>>(async () => null) },
    cryptoProvider: { name: 'web-crypto' },
  };
  const service = {
    createVault: vi.fn(),
    unlock: vi.fn(),
    unlockWithRecoveryCode: vi.fn(),
    generateRecoveryBundle: vi.fn(),
  };
  return { fakeRuntime: runtime, fakeVaultService: service };
});

vi.mock('@/platform', () => ({
  createPlatformRuntime: vi.fn(() => fakeRuntime),
  createVaultService: vi.fn(() => fakeVaultService),
}));

describe('useVault 会话生命周期', () => {
  beforeEach(() => {
    useVaultStore.setState({
      status: 'uninitialized',
      vaultCreated: false,
      keyVersion: 1,
      failedAttempts: 0,
      cooldownUntil: 0,
    });
    dekProvider.clear();
    fakeRuntime.vaultRepository.load.mockReset();
    fakeRuntime.vaultRepository.load.mockResolvedValue(null);
    fakeRuntime.storageAdapter.open.mockClear();
    fakeVaultService.createVault.mockReset();
    fakeVaultService.unlock.mockReset();
    fakeVaultService.unlockWithRecoveryCode.mockReset();
    fakeVaultService.generateRecoveryBundle.mockReset();
  });

  it('首次挂载时打开数据库并探测保险库是否存在', async () => {
    const { result } = renderHook(() => useVault());

    await waitFor(() => {
      expect(fakeRuntime.storageAdapter.open).toHaveBeenCalled();
    });
    expect(useVaultStore.getState().status).toBe('needs-setup');
    expect(result.current.vaultCreated).toBe(true);
  });

  it('已存在保险库时进入「已锁定」态', async () => {
    fakeRuntime.vaultRepository.load.mockResolvedValue({ kdf: 'scrypt' });
    const { result } = renderHook(() => useVault());

    await waitFor(() => {
      expect(result.current.status).toBe('locked');
    });
    expect(result.current.vaultCreated).toBe(true);
  });

  it('createVault 成功后把 DEK 装入供给器并进入「已解锁」态', async () => {
    const bundle = makeRecoveryBundle();
    fakeVaultService.createVault.mockResolvedValue({
      dek: new Uint8Array(32).fill(4),
      vaultParams: { keyVersion: 2 },
      recoveryBundle: bundle,
    });

    const { result } = renderHook(() => useVault());
    await waitFor(() => {
      expect(result.current.status).toBe('needs-setup');
    });

    let ok = false;
    await act(async () => {
      ok = await result.current.createVault('correct-password');
    });

    expect(ok).toBe(true);
    expect(dekProvider.isUnlocked()).toBe(true);
    expect(dekProvider.getKeyVersion()).toBe(2);
    expect(useVaultStore.getState().status).toBe('unlocked');
    expect(result.current.recoveryBundle).toEqual(bundle);
  });

  it('createVault 失败时返回 false 并给出中文错误提示', async () => {
    fakeVaultService.createVault.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useVault());
    await waitFor(() => {
      expect(result.current.status).toBe('needs-setup');
    });

    let ok = true;
    await act(async () => {
      ok = await result.current.createVault('wrong');
    });

    expect(ok).toBe(false);
    expect(result.current.error).toBe('操作失败，请重试');
    expect(dekProvider.isUnlocked()).toBe(false);
  });

  it('unlock 成功后进入「已解锁」态并清零失败计数', async () => {
    useVaultStore.setState({ status: 'locked', vaultCreated: true, failedAttempts: 2 });
    fakeVaultService.unlock.mockResolvedValue({ dek: new Uint8Array(32).fill(6), keyVersion: 1 });

    const { result } = renderHook(() => useVault());

    let ok = false;
    await act(async () => {
      ok = await result.current.unlock('correct-password');
    });

    expect(ok).toBe(true);
    expect(useVaultStore.getState().status).toBe('unlocked');
    expect(useVaultStore.getState().failedAttempts).toBe(0);
    expect(dekProvider.isUnlocked()).toBe(true);
  });

  it('unlock 失败会累加失败次数并给出中文错误提示', async () => {
    useVaultStore.setState({ status: 'locked', vaultCreated: true });
    fakeVaultService.unlock.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useVault());

    let ok = true;
    await act(async () => {
      ok = await result.current.unlock('wrong');
    });

    expect(ok).toBe(false);
    expect(useVaultStore.getState().failedAttempts).toBe(1);
    expect(result.current.error).toBe('操作失败，请重试');
    expect(dekProvider.isUnlocked()).toBe(false);
  });

  it('unlockWithRecoveryCode 成功进入「已解锁」态', async () => {
    useVaultStore.setState({ status: 'locked', vaultCreated: true });
    fakeVaultService.unlockWithRecoveryCode.mockResolvedValue({
      dek: new Uint8Array(32).fill(8),
      keyVersion: 1,
    });

    const { result } = renderHook(() => useVault());

    let ok = false;
    await act(async () => {
      ok = await result.current.unlockWithRecoveryCode('ABCD-EFGH');
    });

    expect(ok).toBe(true);
    expect(useVaultStore.getState().status).toBe('unlocked');
  });

  it('unlockWithRecoveryCode 失败同样计入失败次数', async () => {
    useVaultStore.setState({ status: 'locked', vaultCreated: true });
    fakeVaultService.unlockWithRecoveryCode.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useVault());

    await act(async () => {
      await result.current.unlockWithRecoveryCode('WRONG');
    });

    expect(useVaultStore.getState().failedAttempts).toBe(1);
  });

  it('regenerateRecoveryCode 会刷新恢复码包', async () => {
    const bundle = makeRecoveryBundle() as RecoveryBundle;
    fakeVaultService.generateRecoveryBundle.mockResolvedValue(bundle);

    const { result } = renderHook(() => useVault());

    await act(async () => {
      await result.current.regenerateRecoveryCode();
    });

    expect(result.current.recoveryBundle).toEqual(bundle);
  });

  it('lock 擦除内存中的 DEK 并回到「已锁定」态', async () => {
    useVaultStore.setState({ status: 'unlocked', vaultCreated: true });
    const dek = new Uint8Array(32).fill(1);
    dekProvider.setDek(dek, 1);

    const { result } = renderHook(() => useVault());

    act(() => {
      result.current.lock();
    });

    expect(dekProvider.isUnlocked()).toBe(false);
    expect(useVaultStore.getState().status).toBe('locked');
    expect(Array.from(dek).every((byte) => byte === 0)).toBe(true);
  });
});
