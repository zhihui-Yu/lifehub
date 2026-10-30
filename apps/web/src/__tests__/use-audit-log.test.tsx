/**
 * 审计日志 Hook 测试。
 *
 * 覆盖需求：X-07 ④（审计日志本地留存、可查看、可清除）、NF-PR-5（审计日志不随同步上传）。
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditLog } from '@lifehub/core';
import { useAuditLog } from '@/hooks/useAuditLog';
import { makeAuditLog } from '@/__tests__/test-utils/fixtures';

/** 受控的审计日志服务替身（runtime 必须**引用稳定**，否则 hook 的 effect 会反复触发）。 */
const { list, clear, runtime } = vi.hoisted(() => {
  const listFn = vi.fn<() => Promise<AuditLog[]>>();
  const clearFn = vi.fn<() => Promise<void>>();
  return {
    list: listFn,
    clear: clearFn,
    runtime: { auditLogger: { list: listFn, clear: clearFn } },
  };
});

vi.mock('@/hooks/useVault', () => ({
  useVault: () => ({
    runtime,
    status: 'unlocked',
    vaultCreated: true,
    error: null,
    failedAttempts: 0,
    recoveryBundle: null,
    createVault: vi.fn(),
    unlock: vi.fn(),
    unlockWithRecoveryCode: vi.fn(),
    regenerateRecoveryCode: vi.fn(),
    lock: vi.fn(),
  }),
}));

describe('useAuditLog', () => {
  beforeEach(() => {
    list.mockReset();
    clear.mockReset();
    list.mockResolvedValue([makeAuditLog({ id: 'log-1' }), makeAuditLog({ id: 'log-2' })]);
    clear.mockResolvedValue(undefined);
  });

  it('解锁状态下加载审计日志', async () => {
    const { result } = renderHook(() => useAuditLog());

    await waitFor(() => {
      expect(result.current.logs).toHaveLength(2);
    });
    expect(list).toHaveBeenCalledWith({ limit: 200 });
  });

  it('clear 会先清空服务端日志再重新加载列表', async () => {
    const { result } = renderHook(() => useAuditLog());
    await waitFor(() => {
      expect(result.current.logs).toHaveLength(2);
    });

    list.mockClear();
    list.mockResolvedValue([]);
    await act(async () => {
      await result.current.clear();
    });

    expect(clear).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(result.current.logs).toHaveLength(0);
    });
  });

  it('加载失败时给出中文错误提示', async () => {
    list.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useAuditLog());

    await waitFor(() => {
      expect(result.current.error).toBe('boom');
    });
  });
});
