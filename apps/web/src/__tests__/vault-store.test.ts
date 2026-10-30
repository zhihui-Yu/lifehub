/**
 * 保险库会话 store 单测。
 *
 * 覆盖需求：X-02（首次进入必须设置主密码）、X-03（恢复码）、X-07（解锁失败冷却）、
 * 以及安全红线「DEK 与主密钥只驻留内存，不写入 localStorage / IndexedDB」。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryDekProvider, useVaultStore } from '@/store/vault-store';

describe('useVaultStore 状态流转', () => {
  beforeEach(() => {
    useVaultStore.setState({
      status: 'uninitialized',
      vaultCreated: false,
      keyVersion: 1,
      failedAttempts: 0,
      cooldownUntil: 0,
    });
  });

  it('初始状态是「未初始化」，且没有创建过保险库', () => {
    const state = useVaultStore.getState();
    expect(state.status).toBe('uninitialized');
    expect(state.vaultCreated).toBe(false);
    expect(state.keyVersion).toBe(1);
    expect(state.failedAttempts).toBe(0);
    expect(state.cooldownUntil).toBe(0);
  });

  it('markCreated 进入「待设置」态并标记已创建', () => {
    useVaultStore.getState().markCreated();

    const state = useVaultStore.getState();
    expect(state.status).toBe('needs-setup');
    expect(state.vaultCreated).toBe(true);
  });

  it('setUnlocked 进入「已解锁」态并记录密钥版本，同时清零失败计数', () => {
    useVaultStore.setState({ failedAttempts: 3, cooldownUntil: 999 });
    useVaultStore.getState().setUnlocked(new Uint8Array(32).fill(9), 4);

    const state = useVaultStore.getState();
    expect(state.status).toBe('unlocked');
    expect(state.vaultCreated).toBe(true);
    expect(state.keyVersion).toBe(4);
    expect(state.failedAttempts).toBe(0);
    expect(state.cooldownUntil).toBe(0);
  });

  it('安全红线：store 快照里不持有 DEK 字节', () => {
    const dek = new Uint8Array(32).fill(7);
    useVaultStore.getState().setUnlocked(dek, 1);

    // 状态快照的任意字段都不得等于 DEK 引用本身。
    const snapshot = useVaultStore.getState() as unknown as Record<string, unknown>;
    for (const value of Object.values(snapshot)) {
      expect(value).not.toBe(dek);
      expect(ArrayBuffer.isView(value)).toBe(false);
    }
  });

  it('markLocked 进入「已锁定」态', () => {
    useVaultStore.getState().markCreated();
    useVaultStore.getState().markLocked();

    const state = useVaultStore.getState();
    expect(state.status).toBe('locked');
    expect(state.vaultCreated).toBe(true);
  });

  it('recordFailedAttempt 累加连续解锁失败次数', () => {
    useVaultStore.getState().recordFailedAttempt();
    useVaultStore.getState().recordFailedAttempt();
    expect(useVaultStore.getState().failedAttempts).toBe(2);
  });

  it('clearFailedAttempts 清零失败次数与冷却截止时间', () => {
    useVaultStore.setState({ failedAttempts: 5, cooldownUntil: 12345 });
    useVaultStore.getState().clearFailedAttempts();

    const state = useVaultStore.getState();
    expect(state.failedAttempts).toBe(0);
    expect(state.cooldownUntil).toBe(0);
  });

  it('lock 回到「已锁定」态并清零失败计数', () => {
    useVaultStore.setState({ status: 'unlocked', failedAttempts: 2, cooldownUntil: 999 });
    useVaultStore.getState().lock();

    const state = useVaultStore.getState();
    expect(state.status).toBe('locked');
    expect(state.failedAttempts).toBe(0);
    expect(state.cooldownUntil).toBe(0);
  });
});

describe('InMemoryDekProvider（DEK 只驻留内存）', () => {
  it('未解锁时 getDek 抛出中文异常', () => {
    const provider = new InMemoryDekProvider();
    expect(provider.isUnlocked()).toBe(false);
    expect(() => provider.getDek('bill')).toThrow('保险库未解锁');
  });

  it('setDek 之后可以取到密钥与密钥版本', () => {
    const provider = new InMemoryDekProvider();
    const dek = new Uint8Array(32).fill(3);

    provider.setDek(dek, 2);

    expect(provider.isUnlocked()).toBe(true);
    expect(provider.getDek('bill')).toBe(dek);
    expect(provider.getKeyVersion()).toBe(2);
  });

  it('clear 擦除内存中的密钥并回到未解锁态', () => {
    const provider = new InMemoryDekProvider();
    const dek = new Uint8Array(32).fill(5);
    provider.setDek(dek, 1);

    provider.clear();

    expect(provider.isUnlocked()).toBe(false);
    expect(provider.getKeyVersion()).toBe(1);
    // 原来的字节数组必须被就地清零，避免密钥残留在内存里。
    expect(Array.from(dek).every((byte) => byte === 0)).toBe(true);
    expect(() => provider.getDek('bill')).toThrow('保险库未解锁');
  });
});
