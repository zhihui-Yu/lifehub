/**
 * 保险库解锁速率限制的持久化与失败审计暂存测试（B-4）。
 *
 * 覆盖缺陷：① 锁定态下解锁失败的审计被静默丢弃；② 失败计数与冷却状态
 * 刷新页面后归零，导致暴力破解冷却形同虚设。
 *
 * 期望行为（PRD X-07 ② / NF-S-8）：
 * - 锁定态下写不进加密库的失败审计先暂存到明文白名单，解锁成功后刷入；
 * - failedAttempts / cooldownUntil 持久化到 vaultParams，服务实例重建后仍生效。
 */
import { describe, expect, it } from 'vitest';
import { VaultService } from '../../src/index';
import { createTestRuntime } from '../helpers/runtime';

describe('VaultService 速率限制持久化（B-4）', () => {
  it('锁定态解锁失败时审计暂存到明文白名单，解锁成功后刷入加密审计', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault('test-password-123');
    // 模拟锁定态（用户锁屏 / 刷新后，DEK 不在内存，加密库不可写）。
    runtime.dek.setUnlocked(false);

    await expect(runtime.vault.unlock('wrong-password')).rejects.toThrow();

    // 失败审计写不进加密库，但被暂存到明文 vaultParams；失败计数也一并持久化。
    const locked = await runtime.vaultRepository.load();
    expect(locked?.failedAttempts).toBe(1);
    expect(locked?.pendingAuditEntries?.length).toBe(1);

    // 正确口令解锁 → DEK 重新就绪 → 暂存审计被刷入加密审计库。
    await runtime.vault.unlock('test-password-123');

    const logs = await runtime.audit.list();
    expect(logs.some((log) => log.action === 'failed_unlock' && !log.success)).toBe(true);

    // 暂存队列被清空，失败计数归零。
    const after = await runtime.vaultRepository.load();
    expect(after?.pendingAuditEntries?.length ?? 0).toBe(0);
    expect(after?.failedAttempts).toBe(0);
  });

  it('刷新（重建服务实例）后冷却状态仍生效，无法绕过暴力破解冷却', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault('test-password-123');
    // 连续 5 次失败触发冷却（NF-S-8）。
    for (let index = 0; index < 5; index += 1) {
      await expect(runtime.vault.unlock('wrong-password')).rejects.toThrow();
    }

    // 冷却状态已持久化到明文 vaultParams（cooldownUntil 是未来时间戳）。
    const persisted = await runtime.vaultRepository.load();
    expect(persisted?.cooldownUntil).toBeGreaterThan(Date.now());

    // 用同一份底层存储重建 VaultService（模拟刷新页面）。
    const secondVault = new VaultService({
      adapter: runtime.adapter,
      crypto: runtime.crypto,
      provider: runtime.provider,
      repository: runtime.vaultRepository,
      audit: runtime.audit,
      clock: runtime.clock,
    });

    // 冷却期内即使口令正确也被拒绝。
    await expect(secondVault.unlock('test-password-123')).rejects.toThrowError(
      expect.objectContaining({ message: '尝试次数过多，请稍后再试' }),
    );
  });
});