/**
 * 保险库会话 Hook。
 *
 * 架构位置：apps/web 的「Hooks」层。
 *
 * 说明：封装「创建保险库 / 解锁 / 用恢复码解锁 / 锁定」四个动作，
 * 并把 core 的 `LifeHubError` 归一为中文提示文案（系统设计 §8.3 第 4 条）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LifeHubError, type RecoveryBundle, type VaultSetup } from '@lifehub/core';
import { createVaultService, createPlatformRuntime, type PlatformRuntime } from '@/platform';
import { dekProvider, useVaultStore } from '@/store';

/** 保险库会话 Hook 的返回值。 */
export interface UseVaultResult {
  /** 会话状态。 */
  status: ReturnType<typeof useVaultStore.getState>['status'];
  /** 是否已创建保险库。 */
  vaultCreated: boolean;
  /** 中文错误提示。 */
  error: string | null;
  /** 连续失败次数。 */
  failedAttempts: number;
  /** 恢复码包（仅在创建 / 重新生成后短暂存在）。 */
  recoveryBundle: RecoveryBundle | null;
  /** 平台运行时。 */
  runtime: PlatformRuntime | null;
  /** 创建保险库。 */
  createVault: (password: string) => Promise<boolean>;
  /** 用口令解锁。 */
  unlock: (password: string) => Promise<boolean>;
  /** 用恢复码解锁。 */
  unlockWithRecoveryCode: (code: string) => Promise<boolean>;
  /** 重新生成恢复码。 */
  regenerateRecoveryCode: () => Promise<boolean>;
  /** 锁定。 */
  lock: () => void;
}

/**
 * 初始化保险库会话。
 *
 * @returns 保险库会话 Hook 的返回值
 */
export function useVault(): UseVaultResult {
  const status = useVaultStore((state) => state.status);
  const vaultCreated = useVaultStore((state) => state.vaultCreated);
  const failedAttempts = useVaultStore((state) => state.failedAttempts);
  const setUnlocked = useVaultStore((state) => state.setUnlocked);
  const markCreated = useVaultStore((state) => state.markCreated);
  const markLocked = useVaultStore((state) => state.markLocked);
  const recordFailedAttempt = useVaultStore((state) => state.recordFailedAttempt);
  const clearFailedAttempts = useVaultStore((state) => state.clearFailedAttempts);
  const lockStore = useVaultStore((state) => state.lock);

  const [error, setError] = useState<string | null>(null);
  const [recoveryBundle, setRecoveryBundle] = useState<RecoveryBundle | null>(null);
  const [runtime, setRuntime] = useState<PlatformRuntime | null>(null);

  // 首次挂载时打开数据库并探测保险库是否已存在。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const platform = createPlatformRuntime(dekProvider);
      try {
        await platform.storageAdapter.open();
        const created = await platform.vaultRepository.load();
        if (cancelled) {
          return;
        }
        setRuntime(platform);
        if (created) {
          markLocked();
        } else {
          markCreated();
        }
      } catch {
        if (!cancelled) {
          setError('本地数据读写失败，请检查浏览器是否允许使用 IndexedDB');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [markCreated, markLocked]);

  const createVault = useCallback(
    async (password: string): Promise<boolean> => {
      setError(null);
      try {
        const platform = runtime ?? createPlatformRuntime(dekProvider);
        await platform.storageAdapter.open();
        const service = createVaultService(platform);
        const setup: VaultSetup = await service.createVault(password);
        // 建库返回的 DEK 必须装进供给器，否则建库之后写入的数据会用错密钥加密。
        dekProvider.setDek(setup.dek, setup.vaultParams.keyVersion);
        setRecoveryBundle(setup.recoveryBundle);
        setRuntime(platform);
        markCreated();
        setUnlocked(dekProvider.getDek('bill'), setup.vaultParams.keyVersion);
        clearFailedAttempts();
        return true;
      } catch (cause) {
        setError(cause instanceof LifeHubError ? cause.message : '操作失败，请重试');
        return false;
      }
    },
    [clearFailedAttempts, markCreated, runtime, setUnlocked],
  );

  const unlock = useCallback(
    async (password: string): Promise<boolean> => {
      setError(null);
      try {
        const platform = runtime ?? createPlatformRuntime(dekProvider);
        await platform.storageAdapter.open();
        const service = createVaultService(platform);
        const unlocked = await service.unlock(password);
        dekProvider.setDek(unlocked.dek, unlocked.keyVersion);
        setRuntime(platform);
        setUnlocked(dekProvider.getDek('bill'), unlocked.keyVersion);
        clearFailedAttempts();
        return true;
      } catch (cause) {
        recordFailedAttempt();
        setError(cause instanceof LifeHubError ? cause.message : '操作失败，请重试');
        return false;
      }
    },
    [clearFailedAttempts, recordFailedAttempt, runtime, setUnlocked],
  );

  const unlockWithRecoveryCode = useCallback(
    async (code: string): Promise<boolean> => {
      setError(null);
      try {
        const platform = runtime ?? createPlatformRuntime(dekProvider);
        await platform.storageAdapter.open();
        const service = createVaultService(platform);
        const unlocked = await service.unlockWithRecoveryCode(code);
        dekProvider.setDek(unlocked.dek, unlocked.keyVersion);
        setRuntime(platform);
        setUnlocked(dekProvider.getDek('bill'), unlocked.keyVersion);
        clearFailedAttempts();
        return true;
      } catch (cause) {
        recordFailedAttempt();
        setError(cause instanceof LifeHubError ? cause.message : '操作失败，请重试');
        return false;
      }
    },
    [clearFailedAttempts, recordFailedAttempt, runtime, setUnlocked],
  );

  const regenerateRecoveryCode = useCallback(async (): Promise<boolean> => {
    setError(null);
    try {
      const platform = runtime ?? createPlatformRuntime(dekProvider);
      const service = createVaultService(platform);
      const bundle = await service.generateRecoveryBundle();
      setRecoveryBundle(bundle);
      return true;
    } catch (cause) {
      setError(cause instanceof LifeHubError ? cause.message : '操作失败，请重试');
      return false;
    }
  }, [runtime]);

  const lock = useCallback(() => {
    dekProvider.clear();
    lockStore();
  }, [lockStore]);

  return useMemo(
    () => ({
      status,
      vaultCreated,
      error,
      failedAttempts,
      recoveryBundle,
      runtime,
      createVault,
      unlock,
      unlockWithRecoveryCode,
      regenerateRecoveryCode,
      lock,
    }),
    [
      status,
      vaultCreated,
      error,
      failedAttempts,
      recoveryBundle,
      runtime,
      createVault,
      unlock,
      unlockWithRecoveryCode,
      regenerateRecoveryCode,
      lock,
    ],
  );
}
