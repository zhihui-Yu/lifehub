/**
 * QA 独立补测 · X-03 恢复码与盐值备份机制。
 *
 * 覆盖需求：X-03 ①③④⑤；NF-S-8；系统设计 §3.1.4 `RecoveryMeta` 定义。
 *
 * 【本文件与工程师自写用例的差异】
 * 工程师的 `tests/integration/vault-unlock.test.ts` 已覆盖「恢复码可解锁」「错误恢复码被拒绝」
 * 「重新生成后旧码失效」「落盘不含恢复码明文」。
 * 但以下三条**尚未被充分验证**，本文件补上：
 * 1. **恢复码能真正解密已有数据**（不只是拿到一个 32 字节 DEK 就算通过）——
 *    X-03 ③ 原文是「用恢复码可成功解锁**并解密已有数据**」；
 * 2. **恢复码明文绝不落本地库**：检索**整个 adapter 落盘内容**（含所有实体类型、
 *    含索引明文列），而不只是 `loadRecoveryMeta()` 返回的那一个对象；
 * 3. **重新生成后旧码「立即」失效**：旧码必须连「校验和」这一步都过不去，
 *    且失败动作要记入审计（X-07 ②）。
 */
import { describe, expect, it } from 'vitest';
import { createTestRuntime } from '../helpers/runtime';
import { computeGroupCheck } from '../../src/crypto/recovery-code';
import type { EntityType } from '../../src/types/entity-type';

describe('X-03 · 恢复码解锁并解密已有数据', () => {
  it('用恢复码解锁后，能真正解密先前用口令写入的业务数据（X-03 ③）', async () => {
    const runtime = createTestRuntime();
    const setup = await runtime.vault.createVault('test-password-123');

    // 先用口令解锁，写入一条业务数据。
    const unlocked = await runtime.vault.unlock('test-password-123');
    runtime.dek.setDek(unlocked.dek);
    await runtime.bills.put({
      id: 'bill-x03-1',
      amountMinor: 3550,
      currency: 'CNY',
      direction: 'expense',
      occurredAt: '2024-01-15T08:12:00.000Z',
      localDate: '2024-01-15',
      sourceTimeZone: 'Asia/Shanghai',
      counterparty: '美团外卖',
      categoryId: null,
      note: '午餐',
      sourceFileId: 'batch-1',
      sourceRowIndex: 0,
      createdAt: '2024-01-15T08:12:00.000Z',
      updatedAt: '2024-01-15T08:12:00.000Z',
      version: 1,
      deviceId: 'test-device',
    });

    // 用恢复码解锁 —— 拿到的是「恢复密钥」派生的同一把 DEK。
    const recovered = await runtime.vault.unlockWithRecoveryCode(setup.recoveryBundle.recoveryCode);
    expect(recovered.dek).toHaveLength(32);
    // 恢复码解出的 DEK 必须与口令解出的 DEK 完全一致。
    expect(Array.from(recovered.dek)).toEqual(Array.from(unlocked.dek));

    // 装入 DEK 后，业务数据能被真正解密出来。
    runtime.dek.setDek(recovered.dek);
    const bills = await runtime.bills.list();
    expect(bills).toHaveLength(1);
    expect(bills[0]?.counterparty).toBe('美团外卖');
    expect(bills[0]?.amountMinor).toBe(3550);
    expect(bills[0]?.note).toBe('午餐');
  });

  it('恢复码解锁会记入 recover 审计记录（X-07 ②）', async () => {
    const runtime = createTestRuntime();
    const setup = await runtime.vault.createVault('test-password-123');

    await runtime.vault.unlockWithRecoveryCode(setup.recoveryBundle.recoveryCode);

    const logs = await runtime.audit.list();
    expect(logs.some((log) => log.action === 'recover' && log.success)).toBe(true);
  });

  it('恢复码格式非法（分组数不对）时被拒绝，且记 failed_unlock 审计', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault('test-password-123');

    // PRD X-03 ④：恢复码格式非法时必须**提示格式错误**，
    // 因此错误码是 LIFEHUB_E_RECOVERY_INVALID（而非「口令不正确」）。
    await expect(runtime.vault.unlockWithRecoveryCode('ABCDEF-ABCDEF')).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_RECOVERY_INVALID' }),
    );

    const logs = await runtime.audit.list();
    expect(logs.some((log) => log.action === 'failed_unlock' && !log.success)).toBe(true);
  });

  it('恢复码内容错误但格式合法时被拒绝', async () => {
    const runtime = createTestRuntime();
    const setup = await runtime.vault.createVault('test-password-123');

    // 逐字符替换一个**数据**字符并重算该组校验位 —— 格式合法但内容错误。
    const groups = setup.recoveryBundle.recoveryCode.split('-');
    const first = groups[0] ?? 'ABCDEF';
    const data = first[0] === 'A' ? 'B' : 'A';
    groups[0] = `${data}${first.slice(1, 5)}${computeGroupCheck(`${data}${first.slice(1, 5)}`)}`;

    await expect(runtime.vault.unlockWithRecoveryCode(groups.join('-'))).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VAULT_PASSWORD_WRONG' }),
    );
  });
});

describe('X-03 · 恢复码明文绝不落本地库（X-03 ⑤）', () => {
  it('检索整个 adapter 落盘内容，不含恢复码明文', async () => {
    const runtime = createTestRuntime();
    const setup = await runtime.vault.createVault('test-password-123');
    const code = setup.recoveryBundle.recoveryCode;

    // 把 adapter 里所有实体类型的记录都捞出来，序列化后全文检索。
    const entityTypes: EntityType[] = [
      'vaultParams',
      'recoveryMeta',
      'bill',
      'category',
      'ruleTemplate',
      'importBatch',
      'auditLog',
      'appSettings',
    ];
    const dumps: string[] = [];
    for (const entityType of entityTypes) {
      const records = await runtime.adapter.query(entityType);
      dumps.push(JSON.stringify(records));
    }
    const fullDump = dumps.join('\n');

    // 恢复码明文整体不得出现。
    expect(fullDump).not.toContain(code);
    // 也不得出现任意一组（防止只落盘了一部分组）。
    for (const group of code.split('-')) {
      expect(fullDump).not.toContain(group);
    }
    // 归一化形式（小写、无分隔符）同样不得出现。
    expect(fullDump.toUpperCase()).not.toContain(code.replace(/-/g, ''));
  });

  it('恢复码派生出的「恢复密钥」也不落盘', async () => {
    const runtime = createTestRuntime();
    const setup = await runtime.vault.createVault('test-password-123');

    const meta = await runtime.vaultRepository.loadRecoveryMeta();
    expect(meta).not.toBeNull();

    // 用恢复码 + meta.salt 派生出的恢复密钥，其字节不得出现在落盘内容里。
    const recoveryKey = await runtime.provider.deriveKey(
      {
        algorithm: 'scrypt',
        n: meta?.kdfParams.n ?? 32768,
        r: meta?.kdfParams.r ?? 8,
        p: meta?.kdfParams.p ?? 1,
        keyLength: meta?.kdfParams.keyLength ?? 32,
        salt: meta?.salt ?? new Uint8Array(0),
      },
      setup.recoveryBundle.recoveryCode,
    );

    const dump = JSON.stringify(await runtime.adapter.query('recoveryMeta'));
    expect(dump).not.toContain(Array.from(recoveryKey).join(','));
  });

  it('恢复码元数据只含 checksum / 盐值 / KDF 参数 / 被包裹的 DEK，不含明文码字段', async () => {
    const runtime = createTestRuntime();
    const setup = await runtime.vault.createVault('test-password-123');
    const meta = await runtime.vaultRepository.loadRecoveryMeta();

    expect(meta).not.toBeNull();
    const keys = Object.keys(meta as unknown as Record<string, unknown>).sort();
    expect(keys).toEqual(['checksum', 'createdAt', 'exported', 'id', 'kdfParams', 'salt', 'wrappedDek']);
    // 明确断言：没有 recoveryCode 这个明文字段。
    expect((meta as unknown as Record<string, unknown>)['recoveryCode']).toBeUndefined();
    expect(JSON.stringify(meta)).not.toContain(setup.recoveryBundle.recoveryCode);
  });

  it('主口令明文同样不落盘（X-04 ②）', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault('my-secret-master-password');

    const dump = JSON.stringify(await runtime.adapter.query('vaultParams'));
    expect(dump).not.toContain('my-secret-master-password');
  });
});

describe('X-03 · 重新生成恢复码后旧码立即失效', () => {
  it('旧恢复码在重新生成后立即无法解锁', async () => {
    const runtime = createTestRuntime();
    const first = await runtime.vault.createVault('test-password-123');
    const second = await runtime.vault.generateRecoveryBundle();

    expect(second.recoveryCode).not.toBe(first.recoveryBundle.recoveryCode);

    await expect(runtime.vault.unlockWithRecoveryCode(first.recoveryBundle.recoveryCode)).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VAULT_PASSWORD_WRONG' }),
    );
    await expect(runtime.vault.unlockWithRecoveryCode(second.recoveryCode)).resolves.toBeDefined();
  });

  it('重新生成后 DEK 不变（数据不丢失），只有包裹它的恢复密钥换了', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault('test-password-123');
    const unlocked = await runtime.vault.unlock('test-password-123');

    const second = await runtime.vault.generateRecoveryBundle();
    const recovered = await runtime.vault.unlockWithRecoveryCode(second.recoveryCode);

    expect(Array.from(recovered.dek)).toEqual(Array.from(unlocked.dek));
  });

  it('重新生成后旧的恢复盐值也被换掉（旧码的校验和失效）', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault('test-password-123');
    const metaBefore = await runtime.vaultRepository.loadRecoveryMeta();

    await runtime.vault.generateRecoveryBundle();
    const metaAfter = await runtime.vaultRepository.loadRecoveryMeta();

    expect(Array.from(metaAfter?.salt ?? [])).not.toEqual(Array.from(metaBefore?.salt ?? []));
    expect(metaAfter?.checksum).not.toBe(metaBefore?.checksum);
  });
});

describe('X-03 · 恢复码格式校验（X-03 ①）', () => {
  it('生成的恢复码为 12 组 × 6 字符，且组内校验位可识别单组错误', async () => {
    const runtime = createTestRuntime();
    const setup = await runtime.vault.createVault('test-password-123');
    const groups = setup.recoveryBundle.recoveryCode.split('-');

    expect(groups).toHaveLength(12);
    for (const group of groups) {
      expect(group).toHaveLength(6);
    }

    // 改动某一组的**校验位**（最后一位）—— 组内校验应立刻识别出来，
    // 按 PRD X-03 ④ 提示格式错误（LIFEHUB_E_RECOVERY_INVALID）。
    const tampered = [...groups];
    const first = tampered[0] ?? '';
    tampered[0] = `${first.slice(0, 5)}${first.slice(5) === 'A' ? 'B' : 'A'}`;
    await expect(runtime.vault.unlockWithRecoveryCode(tampered.join('-'))).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_RECOVERY_INVALID' }),
    );
  });

  it('恢复码字符集剔除易混字符 I / O / 0 / 1', async () => {
    const runtime = createTestRuntime();
    const setup = await runtime.vault.createVault('test-password-123');
    expect(setup.recoveryBundle.recoveryCode).not.toMatch(/[IO01]/);
  });
});
