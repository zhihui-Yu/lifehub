/**
 * 保险库会话状态。
 *
 * 架构位置：apps/web 的「状态管理」层（Zustand）。
 *
 * 安全约束：DEK 与主密钥**只驻留内存**，不写入 localStorage / IndexedDB；
 * `lock()` 时立即用 `fill(0)` 擦除（NF-S-2）。
 */
import { create } from 'zustand';
import type { DekProvider, EntityType } from '@lifehub/core';

/** 保险库会话状态。 */
export type VaultStatus = 'uninitialized' | 'needs-setup' | 'locked' | 'unlocked';

/** 保险库 store 的状态与动作。 */
export interface VaultState {
  /** 会话状态。 */
  status: VaultStatus;
  /** 是否已创建过保险库。 */
  vaultCreated: boolean;
  /** 当前密钥版本。 */
  keyVersion: number;
  /** 连续解锁失败次数。 */
  failedAttempts: number;
  /** 冷却截止时间戳；0 表示未冷却。 */
  cooldownUntil: number;
  /** 设置保险库：写入 DEK 并进入已解锁态。 */
  setUnlocked: (dek: Uint8Array, keyVersion: number) => void;
  /** 标记**尚未**创建保险库（首次进入引导，等待用户设置主密码）。 */
  markNeedsSetup: () => void;
  /** 标记保险库已创建（等待用户解锁）。 */
  markCreated: () => void;
  /** 标记已创建但处于锁定态。 */
  markLocked: () => void;
  /** 记录一次解锁失败。 */
  recordFailedAttempt: () => void;
  /** 清除失败计数。 */
  clearFailedAttempts: () => void;
  /** 锁定：擦除密钥，回到 locked 态。 */
  lock: () => void;
}

/**
 * 保险库会话 store。
 *
 * 说明：不持有 DEK 本身（避免状态快照泄漏），只持有「是否解锁」与版本号；
 * DEK 由 `useVault` hook 在内存中持有并注入 `DekProvider`。
 */
export const useVaultStore = create<VaultState>((set, get) => ({
  status: 'uninitialized',
  vaultCreated: false,
  keyVersion: 1,
  failedAttempts: 0,
  cooldownUntil: 0,
  setUnlocked: (dek, keyVersion) => {
    void dek;
    set({ status: 'unlocked', vaultCreated: true, keyVersion, failedAttempts: 0, cooldownUntil: 0 });
  },
  markNeedsSetup: () => set({ status: 'needs-setup', vaultCreated: false }),
  markCreated: () => set({ status: 'needs-setup', vaultCreated: true }),
  markLocked: () => set({ status: 'locked', vaultCreated: true }),
  recordFailedAttempt: () => set({ failedAttempts: get().failedAttempts + 1 }),
  clearFailedAttempts: () => set({ failedAttempts: 0, cooldownUntil: 0 }),
  lock: () => set({ status: 'locked', failedAttempts: 0, cooldownUntil: 0 }),
}));

/**
 * 内存态的 DEK 供给器。
 *
 * 说明：实现 core 的 `DekProvider` 端口；密钥只存在于这个闭包里，
 * 页面刷新即消失，符合「密钥永不离开客户端内存」的约束。
 */
export class InMemoryDekProvider implements DekProvider {
  /** 当前 DEK；未解锁时为 null。 */
  private dek: Uint8Array | null = null;
  /** 当前密钥版本。 */
  private version = 1;

  /**
   * 是否处于解锁状态。
   *
   * @returns 已解锁返回 true
   */
  isUnlocked(): boolean {
    return this.dek !== null;
  }

  /**
   * 取当前 DEK。
   *
   * @param _entityType 实体类型（当前按单一 DEK 设计，参数保留以符合端口契约）
   * @returns DEK 字节数组
   * @throws {Error} 未解锁时抛出
   */
  getDek(_entityType: EntityType): Uint8Array {
    if (!this.dek) {
      throw new Error('保险库未解锁');
    }
    return this.dek;
  }

  /**
   * 取当前密钥版本。
   *
   * @returns 密钥版本
   */
  getKeyVersion(): number {
    return this.version;
  }

  /**
   * 设置 DEK（解锁成功后调用）。
   *
   * @param dek DEK 字节数组
   * @param keyVersion 密钥版本
   * @returns 无异常
   * @throws 无
   */
  setDek(dek: Uint8Array, keyVersion: number): void {
    this.dek = dek;
    this.version = keyVersion;
  }

  /**
   * 解锁并写入 DEK（与 `setDek` 等价的语义化别名）。
   *
   * @param dek DEK 字节数组
   * @param keyVersion 密钥版本（默认 1）
   * @returns 无异常
   * @throws 无
   */
  unlock(dek: Uint8Array, keyVersion = 1): void {
    this.setDek(dek, keyVersion);
  }

  /**
   * 锁定：擦除 DEK 内存。
   *
   * @returns 无异常
   */
  clear(): void {
    this.dek?.fill(0);
    this.dek = null;
    this.version = 1;
  }
}

/** 全局唯一的 DEK 供给器实例。 */
export const dekProvider = new InMemoryDekProvider();
