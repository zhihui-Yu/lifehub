/**
 * 安全深度验证 · X-07 审计日志。
 *
 * 覆盖需求：X-07 ①②③④⑤；PRD §3.1.4 AuditLog 实体；系统设计 §8.5 日志与审计约定。
 * 覆盖红线：R4（唯一密文写通道）、R5（只含密文）、R7（不上传）。
 *
 * 【本文件与既有测试的差异】
 * 既有 `tests/qa/qa-audit-log.test.ts` 与 `tests/integration/vault-unlock.test.ts`
 * 已覆盖「连续两次 unlock 两条记录」「解锁失败记 failed_unlock」。
 * 本文件补齐**尚未被充分验证**的部分：
 * 1. **审计记录本身是加密存储的**——落盘内容里检索不到明文动作名
 *    （`unlock` / `failed_unlock` / `create_vault` 等）与明文 `deviceLabel`；
 * 2. 审计记录**只含 5 个必记字段**（`at` / `action` / `target` / `deviceLabel` / `success`）
 *    加存储元字段，且落盘时是**密文载荷**；
 * 3. `clear()` 真的能清空（且清空后存储层也确实为空）；
 * 4. 审计日志**不上传**：不进入同步载荷与加密备份的 blob 白名单之外的任何位置；
 * 5. 审计写入失败**不阻断主流程**（旁路能力，系统设计 §8.5）。
 *
 * 性能说明：建库 / 解锁各要跑一次 N=32768 的 scrypt（约 1~2 秒），
 * 因此**只读用例共享同一个运行时**（模块级 `beforeAll` 准备一次），
 * 只有会破坏数据的「clear()」用例才另建运行时。
 * 这既把 scrypt 调用从 14 次降到 4 次，也避免了覆盖率插桩下的超时抖动。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestRuntime } from '../helpers/runtime';
import { AUDIT_ACTIONS } from '../../src/models/audit';
import { SYNC_BLOB_ALLOWED_FIELDS } from '../../src/services/sync/sync-payload';
import type { StoredRecord } from '../../src/models/common';

/** 测试用主口令。 */
const PASSWORD = 'test-password-123';

/**
 * 涉及建库 / 解锁（真实 scrypt）的用例超时上限。
 *
 * 说明：覆盖率插桩 + 多 worker 并行时，单次 scrypt 可能耗时数十秒，
 * 这里给足余量；**这只放宽超时上限，不放宽任何断言**。
 */
const VAULT_TIMEOUT = 180_000;

/** 测试运行时类型别名。 */
type Runtime = ReturnType<typeof createTestRuntime>;

/**
 * 把任意值序列化为「可全文检索」的文本（字节数组展开为 hex 与 latin1）。
 *
 * 说明：与 `sync-payload.test.ts` / `recovery-code.test.ts` 保持一致的实现，
 * 避免 Uint8Array 序列化后只留下字节序号造成的假阴性。
 *
 * @param value 待序列化对象
 * @returns 检索用文本
 */
function toSearchableText(value: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || node === undefined) {
      return;
    }
    if (node instanceof Uint8Array) {
      let hex = '';
      let latin = '';
      for (const byte of node) {
        hex += byte.toString(16).padStart(2, '0');
        latin += String.fromCharCode(byte);
      }
      parts.push(hex, latin);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item);
      }
      return;
    }
    if (typeof node === 'object') {
      for (const [key, item] of Object.entries(node as Record<string, unknown>)) {
        parts.push(key);
        walk(item);
      }
      return;
    }
    parts.push(String(node));
  };
  walk(value);
  return parts.join('\n');
}

/**
 * 统计子串在文本中的出现次数。
 *
 * @param text 被检索文本
 * @param needle 检索目标
 * @returns 出现次数
 */
function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at < 0) {
      break;
    }
    count += 1;
    from = at + needle.length;
  }
  return count;
}

/**
 * 构造一条含明文样本的账单（用于验证审计记录不携带业务语义）。
 *
 * @param id 账单 id
 * @returns 账单实体
 */
function makeBill(id: string): Record<string, unknown> {
  return {
    id,
    amountMinor: 12850,
    currency: 'CNY',
    direction: 'expense',
    occurredAt: '2024-01-15T08:12:00.000Z',
    localDate: '2024-01-15',
    sourceTimeZone: 'Asia/Shanghai',
    counterparty: '星巴克(国贸店)',
    categoryId: null,
    note: '含逗号, 的备注',
    sourceFileId: 'batch-1',
    sourceRowIndex: 0,
    createdAt: '2024-01-15T08:12:00.000Z',
    updatedAt: '2024-01-15T08:12:00.000Z',
    version: 1,
    deviceId: 'test-device',
  };
}

/** 共享的只读运行时：建库 → 两次成功解锁 → 一次失败解锁 → 写入一条账单。 */
let shared: Runtime;

/** 建库并产出全套审计样本（模块级，只跑一次）。 */
beforeAll(async () => {
  shared = createTestRuntime();
  await shared.vault.createVault(PASSWORD);
  await shared.vault.unlock(PASSWORD);
  await shared.vault.unlock(PASSWORD);
  await expect(shared.vault.unlock('wrong-password')).rejects.toThrow();
  await shared.bills.put(makeBill('bill-audit-shared') as never);
}, VAULT_TIMEOUT);

describe('X-07 ⑤ · 解锁动作的审计记录', () => {
  it('连续两次 unlock 产生两条 unlock 记录，且 success 均为 true', async () => {
    const logs = await shared.audit.list();
    const unlocks = logs.filter((log) => log.action === 'unlock');
    expect(unlocks).toHaveLength(2);
    expect(unlocks.every((log) => log.success)).toBe(true);
  });

  it('解锁失败产生 failed_unlock 记录且 success = false', async () => {
    const logs = await shared.audit.list();
    const failed = logs.filter((log) => log.action === 'failed_unlock');
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(failed.every((log) => log.success === false)).toBe(true);
  });

  it('建库产生 create_vault 记录', async () => {
    const logs = await shared.audit.list();
    expect(logs.some((log) => log.action === 'create_vault' && log.success)).toBe(true);
  });

  it('审计条目含全部 5 个必记字段（at / action / target / deviceLabel / success）', async () => {
    const logs = await shared.audit.list();
    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) {
      expect(typeof log.id).toBe('string');
      expect(log.id.length).toBeGreaterThan(0);
      expect(log.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(AUDIT_ACTIONS).toContain(log.action);
      expect(typeof log.target).toBe('string');
      expect(typeof log.deviceLabel).toBe('string');
      expect(log.deviceLabel.length).toBeGreaterThan(0);
      expect(typeof log.success).toBe('boolean');
    }
  });

  it('审计动作全部来自 PRD §3.1.4 定义的动作枚举', async () => {
    const logs = await shared.audit.list();
    for (const log of logs) {
      expect(AUDIT_ACTIONS).toContain(log.action);
    }
    // 九类动作枚举齐备（PRD §3.1.4）。
    expect(AUDIT_ACTIONS).toEqual([
      'create_vault',
      'unlock',
      'failed_unlock',
      'decrypt',
      'import',
      'export',
      'rotate_key',
      'recover',
      'clear_audit',
    ]);
  });
});

describe('X-07 ② / R4 / R5 · 审计记录本身是加密存储的', () => {
  it('审计记录落盘时载荷类型是 encrypted（不是 plain）', async () => {
    const records = await shared.adapter.query('auditLog');
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record.payload.kind).toBe('encrypted');
      if (record.payload.kind === 'encrypted') {
        expect(record.payload.algorithm).toBe('AES-256-GCM');
        expect(record.payload.ciphertext.length).toBeGreaterThan(0);
      }
    }
  });

  it('落盘内容里检索不到明文动作名与明文设备标签', async () => {
    const records = await shared.adapter.query('auditLog');
    const dump = toSearchableText(records);

    // 明文动作名不得出现在落盘内容中。
    for (const action of ['create_vault', 'failed_unlock', 'unlock']) {
      expect(countOccurrences(dump, action)).toBe(0);
    }
    // 明文设备标签（运行时用的是 '本机 · 测试'）同样不得出现。
    expect(countOccurrences(dump, '本机 · 测试')).toBe(0);
  });

  it('审计记录解密后能读回完整字段（证明上一条不是「什么都没写」）', async () => {
    const logs = await shared.audit.list();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((log) => log.action === 'unlock')).toBe(true);
    expect(logs.some((log) => log.action === 'create_vault')).toBe(true);
  });

  it('审计记录的落盘顶层字段与业务实体一致（索引明文列 + 密文载荷）', async () => {
    const record = (await shared.adapter.query('auditLog'))[0] as StoredRecord | undefined;
    expect(record).toBeDefined();
    expect(Object.keys(record ?? {}).sort()).toEqual(
      [
        'createdAt',
        'deviceId',
        'entityType',
        'id',
        'localDate',
        'occurredAt',
        'payload',
        'updatedAt',
        'version',
      ].sort(),
    );
  });
});

describe('X-07 ④ · clear() 可清空审计日志', () => {
  it('clear() 之后 list() 返回空数组', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault(PASSWORD);
    await runtime.vault.unlock(PASSWORD);
    expect((await runtime.audit.list()).length).toBeGreaterThan(0);

    await runtime.audit.clear();

    expect(await runtime.audit.list()).toEqual([]);
  }, VAULT_TIMEOUT);

  it('clear() 之后存储层里的审计记录确实被删除', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault(PASSWORD);
    await runtime.vault.unlock(PASSWORD);
    expect((await runtime.adapter.query('auditLog')).length).toBeGreaterThan(0);

    await runtime.audit.clear();

    expect(await runtime.adapter.query('auditLog')).toEqual([]);
  }, VAULT_TIMEOUT);

  it('clear() 只清审计日志，不影响业务数据', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault(PASSWORD);
    await runtime.vault.unlock(PASSWORD);
    await runtime.bills.put(makeBill('bill-audit-clear') as never);

    await runtime.audit.clear();

    expect(await runtime.audit.list()).toEqual([]);
    const bill = await runtime.bills.getById('bill-audit-clear');
    expect(bill?.counterparty).toBe('星巴克(国贸店)');
  }, VAULT_TIMEOUT);
});

describe('X-07 / R5 · 审计日志不上传（NF-PR-5）', () => {
  it('同步 blob 字段白名单里不含任何审计专有字段', () => {
    for (const forbidden of ['action', 'deviceLabel', 'at', 'success']) {
      expect(SYNC_BLOB_ALLOWED_FIELDS).not.toContain(forbidden);
    }
  });

  it('审计日志的落盘记录不携带任何业务语义明文字段', async () => {
    const records = await shared.adapter.query('auditLog');
    const dump = toSearchableText(records);

    // 业务明文绝不出现在审计记录里（审计只记动作与对象，不记业务内容）。
    expect(countOccurrences(dump, '星巴克(国贸店)')).toBe(0);
    expect(countOccurrences(dump, '含逗号, 的备注')).toBe(0);
    expect(countOccurrences(dump, '12850')).toBe(0);
  });
});

describe('X-07 · 审计写入失败不阻断主流程（旁路能力）', () => {
  it('存储层写入抛错时，audit.log 仍返回条目且不抛出异常', async () => {
    // 让适配器的 put 抛错，模拟存储故障。
    const originalPut = shared.adapter.put.bind(shared.adapter);
    shared.adapter.put = async () => {
      throw new Error('模拟存储故障');
    };
    try {
      const entry = await shared.audit.log('unlock', '', true);
      expect(entry.action).toBe('unlock');
      expect(entry.success).toBe(true);
    } finally {
      shared.adapter.put = originalPut;
    }
  });
});
