/**
 * 保险库解锁集成测试。
 *
 * 覆盖需求：A-07、X-03、X-04、X-07；系统设计 §7 T02 验收。
 */
import { describe, expect, it } from 'vitest';
import { createTestRuntime } from '../helpers/runtime';

describe('VaultService', () => {
  it('创建保险库后写入保险库参数与恢复码元数据', async () => {
    const runtime = createTestRuntime();
    const setup = await runtime.vault.createVault('test-password-123');

    expect(setup.vaultParams.kdf).toBe('scrypt');
    expect(setup.vaultParams.salt).toHaveLength(16);
    expect(setup.vaultParams.previousDek).toBeNull();
    // 落盘内容不含任何明文密钥。
    expect(JSON.stringify(setup.vaultParams)).not.toContain('test-password-123');

    const stored = await runtime.vaultRepository.load();
    expect(stored).not.toBeNull();
    expect(stored?.keyVersion).toBe(1);

    const meta = await runtime.vaultRepository.loadRecoveryMeta();
    expect(meta?.exported).toBe(false);
    // 恢复码明文绝不落库（X-03 ⑤）。
    expect(JSON.stringify(meta)).not.toContain(setup.recoveryBundle.recoveryCode);
  });

  it('isVaultCreated 反映创建状态', async () => {
    const runtime = createTestRuntime();
    expect(await runtime.vault.isVaultCreated()).toBe(false);
    await runtime.vault.createVault('test-password-123');
    expect(await runtime.vault.isVaultCreated()).toBe(true);
  });

  it('正确口令可以解锁，错误口令抛 LIFEHUB_E_VAULT_PASSWORD_WRONG', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault('test-password-123');

    const unlocked = await runtime.vault.unlock('test-password-123');
    expect(unlocked.dek).toHaveLength(32);
    expect(unlocked.keyVersion).toBe(1);

    await expect(runtime.vault.unlock('wrong-password')).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VAULT_PASSWORD_WRONG' }),
    );
  });

  it('连续两次 unlock 产生两条 unlock 审计记录（X-07 ⑤）', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault('test-password-123');
    await runtime.vault.unlock('test-password-123');
    await runtime.vault.unlock('test-password-123');

    const logs = await runtime.audit.list();
    const unlocks = logs.filter((log) => log.action === 'unlock');
    expect(unlocks).toHaveLength(2);
  });

  it('解锁失败同样记审计（X-07 ②）', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault('test-password-123');
    await expect(runtime.vault.unlock('wrong')).rejects.toThrow();

    const logs = await runtime.audit.list();
    expect(logs.some((log) => log.action === 'failed_unlock' && !log.success)).toBe(true);
  });

  it('连续 5 次失败后进入冷却（NF-S-8）', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault('test-password-123');
    for (let index = 0; index < 5; index += 1) {
      await expect(runtime.vault.unlock('wrong')).rejects.toThrow();
    }
    expect(runtime.vault.getCooldownRemainingMs()).toBeGreaterThan(0);
    // 冷却期内即使口令正确也会被拒绝。
    await expect(runtime.vault.unlock('test-password-123')).rejects.toThrowError(
      expect.objectContaining({ message: '尝试次数过多，请稍后再试' }),
    );
  });

  it('恢复码可解锁；错误恢复码被拒绝', async () => {
    const runtime = createTestRuntime();
    const setup = await runtime.vault.createVault('test-password-123');

    const unlocked = await runtime.vault.unlockWithRecoveryCode(setup.recoveryBundle.recoveryCode);
    expect(unlocked.dek).toHaveLength(32);

    // 'AAAAAA-BBBBBB-CCCCCC' 只有 3 组，属**格式非法**（缺少 9 组），
    // 按系统设计 §3.4 错误码表应抛 LIFEHUB_E_RECOVERY_INVALID，而非「口令不正确」。
    await expect(runtime.vault.unlockWithRecoveryCode('AAAAAA-BBBBBB-CCCCCC')).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_RECOVERY_INVALID' }),
    );
  });

  it('重新生成恢复码会使旧恢复码失效', async () => {
    const runtime = createTestRuntime();
    const first = await runtime.vault.createVault('test-password-123');
    const second = await runtime.vault.generateRecoveryBundle();
    expect(second.recoveryCode).not.toBe(first.recoveryBundle.recoveryCode);
    await expect(runtime.vault.unlockWithRecoveryCode(first.recoveryBundle.recoveryCode)).rejects.toThrow();
    await expect(runtime.vault.unlockWithRecoveryCode(second.recoveryCode)).resolves.toBeDefined();
  });

  it('口令过短时抛 LIFEHUB_E_VALIDATION', async () => {
    const runtime = createTestRuntime();
    await expect(runtime.vault.createVault('short')).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  });

  it('重复创建保险库被拒绝', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault('test-password-123');
    await expect(runtime.vault.createVault('another-password')).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  });

  it('未创建保险库时解锁抛 LIFEHUB_E_VAULT_NOT_FOUND', async () => {
    const runtime = createTestRuntime();
    await expect(runtime.vault.unlock('test-password-123')).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VAULT_NOT_FOUND' }),
    );
  });

  it('rotateMasterKey 校验参数并返回轮换计划', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault('test-password-123');
    const plan = await runtime.vault.rotateMasterKey('test-password-123', 'new-password-456');
    expect(plan.fromKeyVersion).toBe(1);
    expect(plan.toKeyVersion).toBe(2);
    await expect(runtime.vault.rotateMasterKey('test-password-123', 'short')).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  });
});
