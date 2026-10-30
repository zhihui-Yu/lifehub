/**
 * QA 独立补测 · X-07 / A-2 审计日志。
 *
 * 覆盖需求：X-07 ①②③④⑤；PRD §3.1 AuditLog 实体；系统设计 §8.5 日志与审计约定。
 *
 * 【本文件与工程师自写用例的差异】
 * 工程师的 `tests/integration/vault-unlock.test.ts` 覆盖了「连续两次 unlock 产生两条 unlock 记录」
 * 与「解锁失败记 failed_unlock」。但以下三条**未被验证**：
 * 1. **审计记录本身是加密存储的** —— 落盘内容里不应能检索到明文 `action`；
 * 2. 审计日志覆盖 PRD §3.1 要求的**全部动作枚举**（解锁成功 / 解锁失败 / 导入 / 导出 /
 *    密钥轮换 / 恢复），而不只是 unlock 两种；
 * 3. 审计记录字段完整性（`at` / `action` / `target` / `deviceLabel` / `success` 五要素）。
 */
import { describe, expect, it } from 'vitest';
import { createTestRuntime } from '../helpers/runtime';
import type { EntityType } from '../../src/types/entity-type';

/**
 * 把存储适配器里某类实体的全部记录序列化成一个字符串，便于做全文检索。
 *
 * @param runtime 测试运行时
 * @param entityType 实体类型
 * @returns 序列化后的落盘内容
 */
async function dumpEntity(runtime: ReturnType<typeof createTestRuntime>, entityType: EntityType): Promise<string> {
  const records = await runtime.adapter.query(entityType);
  return JSON.stringify(records);
}

describe('A-2 · 审计日志记录语义（X-07 ①②⑤）', () => {
  it('连续两次 unlock 产生两条 unlock 记录（X-07 ⑤）', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault('test-password-123');
    await runtime.vault.unlock('test-password-123');
    await runtime.vault.unlock('test-password-123');

    const logs = await runtime.audit.list();
    const unlocks = logs.filter((log) => log.action === 'unlock');
    expect(unlocks).toHaveLength(2);
    expect(unlocks.every((log) => log.success)).toBe(true);
  });

  it('解锁失败产生 failed_unlock 记录且 success = false（X-07 ②）', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault('test-password-123');
    await expect(runtime.vault.unlock('wrong-password')).rejects.toThrow();

    const logs = await runtime.audit.list();
    const failed = logs.filter((log) => log.action === 'failed_unlock');
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(failed.every((log) => log.success === false)).toBe(true);
  });

  it('每条审计记录都含 at / action / target / deviceLabel / success 五要素（X-07 ①）', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault('test-password-123');
    await runtime.vault.unlock('test-password-123');

    const logs = await runtime.audit.list();
    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) {
      expect(typeof log.id).toBe('string');
      expect(log.id.length).toBeGreaterThan(0);
      // at 必须是 ISO 8601 UTC。
      expect(log.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(typeof log.action).toBe('string');
      expect(typeof log.target).toBe('string');
      expect(typeof log.deviceLabel).toBe('string');
      expect(typeof log.success).toBe('boolean');
    }
  });

  it('审计覆盖 PRD §3.1 的动作枚举：create_vault / unlock / failed_unlock / import / rotate_key / recover', async () => {
    const runtime = createTestRuntime();
    const setup = await runtime.vault.createVault('test-password-123');
    await runtime.vault.unlock('test-password-123');
    await expect(runtime.vault.unlock('wrong-password')).rejects.toThrow();
    await runtime.vault.unlockWithRecoveryCode(setup.recoveryBundle.recoveryCode);
    await runtime.vault.rotateMasterKey('test-password-123', 'new-password-456');

    const csv = '时间,金额,对方,收支\n2024-01-15 08:30:00,35.50,星巴克,支出\n';
    const bytes = new TextEncoder().encode(csv);
    await runtime.importService.run(
      { fileName: 'audit-import.csv', sizeBytes: bytes.length, bytes },
      { 0: 'occurredAt', 1: 'amount', 2: 'counterparty', 3: 'direction' },
      {},
    );

    const logs = await runtime.audit.list();
    const actions = new Set(logs.map((log) => log.action));
    expect(actions.has('create_vault')).toBe(true);
    expect(actions.has('unlock')).toBe(true);
    expect(actions.has('failed_unlock')).toBe(true);
    expect(actions.has('recover')).toBe(true);
    expect(actions.has('rotate_key')).toBe(true);
    expect(actions.has('import')).toBe(true);
  });

  it('导入审计记录带上文件名作为 target（X-07 ①）', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault('test-password-123');
    await runtime.vault.unlock('test-password-123');

    const csv = '时间,金额,对方,收支\n2024-01-15 08:30:00,35.50,星巴克,支出\n';
    const bytes = new TextEncoder().encode(csv);
    await runtime.importService.run(
      { fileName: 'my-bank-export.csv', sizeBytes: bytes.length, bytes },
      { 0: 'occurredAt', 1: 'amount', 2: 'counterparty', 3: 'direction' },
      {},
    );

    const logs = await runtime.audit.list();
    const importLog = logs.find((log) => log.action === 'import');
    expect(importLog?.target).toBe('my-bank-export.csv');
  });

  it('clear() 清空审计日志（X-07 ④）', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault('test-password-123');
    await runtime.vault.unlock('test-password-123');
    expect((await runtime.audit.list()).length).toBeGreaterThan(0);

    await runtime.audit.clear();
    expect(await runtime.audit.list()).toHaveLength(0);
  });
});

describe('A-2 · 审计日志本身是加密存储的（X-04 ① / NF-S-1）', () => {
  it('审计记录的落盘载荷是密文，而非明文 JSON', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault('test-password-123');
    await runtime.vault.unlock('test-password-123');
    await expect(runtime.vault.unlock('wrong-password')).rejects.toThrow();

    const records = await runtime.adapter.query('auditLog');
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      // 载荷必须是 encrypted 类型，不允许出现 plain 明文载荷。
      expect(record.payload.kind).toBe('encrypted');
    }
  });

  it('落盘内容检索不到明文 action 值', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault('test-password-123');
    await runtime.vault.unlock('test-password-123');
    await expect(runtime.vault.unlock('wrong-password')).rejects.toThrow();

    const dump = await dumpEntity(runtime, 'auditLog');
    // 动作名必须只存在于密文里，落盘明文部分不得出现。
    expect(dump).not.toContain('"action"');
    expect(dump).not.toContain('failed_unlock');
    expect(dump).not.toContain('create_vault');
    // 设备标签同样在密文内。
    expect(dump).not.toContain('本机 · 测试');
  });

  it('审计记录的索引明文列只有 ADR-006 允许的 7 个（不含业务语义）', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault('test-password-123');
    await runtime.vault.unlock('test-password-123');

    const records = await runtime.adapter.query('auditLog');
    const record = records[0];
    expect(record).toBeDefined();

    const allowedPlaintext = new Set([
      'id',
      'entityType',
      'version',
      'createdAt',
      'updatedAt',
      'deviceId',
      'localDate',
      'occurredAt',
      'payload',
    ]);
    for (const key of Object.keys(record as unknown as Record<string, unknown>)) {
      expect(allowedPlaintext.has(key)).toBe(true);
    }
  });
});
