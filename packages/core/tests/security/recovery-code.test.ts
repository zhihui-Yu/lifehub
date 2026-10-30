/**
 * 安全深度验证 · X-03 恢复码机制。
 *
 * 覆盖需求：X-03 ①②③④⑤；X-04 ①②；ADR-003 §4（恢复码 = 一把「恢复 DEK」的备用钥匙）。
 * 覆盖红线：R4（唯一密文写通道）、R5（只含密文）。
 *
 * 【本文件与既有测试的差异】
 * 既有 `tests/qa/qa-recovery-code.test.ts` 与 `tests/integration/vault-unlock.test.ts`
 * 已覆盖「恢复码可解锁」「旧码失效」「落盘不含恢复码明文」。
 * 本文件补齐**尚未被充分验证**的部分：
 * 1. **恢复码明文绝不落本地库**：检索**整个适配器落盘内容**
 *    （所有实体类型 × 全部记录 × 字节级 hex/latin1 展开），
 *    而不只是 `loadRecoveryMeta()` 返回的那一个对象；
 * 2. **恢复码明文也不出现在审计日志与保险库参数里**；
 * 3. **重新生成恢复码后旧码「立即」失效**：旧码必须连「校验和」这一步都过不去，
 *    且失败动作要记入审计（X-07 ②）；
 * 4. **正确恢复码能真正解密已有数据**：不止是拿到一个 32 字节 DEK，
 *    而是要用恢复出来的 DEK **读出明文账单**（X-03 ③）；
 * 5. 恢复码的**格式校验与字符集约束**（剔除易混字符 I/O/0/1）。
 *
 * 性能说明：建库 / 解锁 / 恢复码解锁各要跑一次 N=32768 的 scrypt（约 1~2 秒）。
 * 本文件的用例**共享同一个运行时**（模块级 `beforeAll` 准备一次），
 * 把 scrypt 调用从 13 次降到 1 次，避免覆盖率插桩下的超时抖动。
 * 每个用例仍在自己的断言里显式触发它要验证的那条路径（口令解锁 / 恢复码解锁 / 重新生成），
 * 因此**断言强度不受共享影响**。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestRuntime } from '../helpers/runtime';
import { validateRecoveryCode, generateRecoveryCode } from '../../src/crypto/recovery-code';
import {
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_GROUP_COUNT,
  RECOVERY_CODE_GROUP_LENGTH,
} from '../../src/constants';
import type { EntityType } from '../../src/types/entity-type';

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
 * 说明：与 `sync-payload.test.ts` 里的同名函数刻意保持一致的实现，
 * 目的是**避免假阴性**——Uint8Array 直接 JSON.stringify 会变成 `{"0":1,...}`，
 * 字节序号不是真实内容，搜不到不代表没泄漏。
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
 * 把整个存储适配器的落盘内容序列化成一个可检索的大字符串。
 *
 * @param runtime 测试运行时
 * @returns 落盘内容全文
 */
async function dumpWholeAdapter(runtime: Runtime): Promise<string> {
  const chunks: string[] = [];
  for (const entityType of runtime.adapter.listEntityTypes()) {
    const records = await runtime.adapter.query(entityType);
    chunks.push(entityType, toSearchableText(records));
  }
  return chunks.join('\n');
}

/**
 * 构造一条用于验证「恢复码能解密已有数据」的账单。
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
    sourceFileId: 'batch-x03',
    sourceRowIndex: 0,
    createdAt: '2024-01-15T08:12:00.000Z',
    updatedAt: '2024-01-15T08:12:00.000Z',
    version: 1,
    deviceId: 'test-device',
  };
}

/** 共享运行时：建库 → 口令解锁 → 写入一条账单。 */
let runtime: Runtime;
/** 建库时生成的恢复码（原始的那一份）。 */
let originalRecoveryCode: string;

beforeAll(async () => {
  runtime = createTestRuntime();
  const setup = await runtime.vault.createVault(PASSWORD);
  originalRecoveryCode = setup.recoveryBundle.recoveryCode;
  await runtime.vault.unlock(PASSWORD);
  await runtime.bills.put(makeBill('bill-x03-decrypt') as never);
}, VAULT_TIMEOUT);

describe('X-03 ⑤ · 恢复码明文绝不落本地库', () => {
  it('整个适配器落盘内容里检索不到恢复码明文（含分隔符形式）', async () => {
    const dump = await dumpWholeAdapter(runtime);
    expect(countOccurrences(dump, originalRecoveryCode)).toBe(0);
  });

  it('检索不到恢复码的「去分隔符」形式（防止以紧凑格式落盘）', async () => {
    const dump = await dumpWholeAdapter(runtime);
    const compact = originalRecoveryCode.replace(/-/g, '');
    expect(compact.length).toBeGreaterThan(0);
    expect(countOccurrences(dump, compact)).toBe(0);
  });

  it('检索不到恢复码的任意单个分组（如第一组 6 字符）', async () => {
    const dump = await dumpWholeAdapter(runtime);
    const groups = originalRecoveryCode.split('-');
    expect(groups.length).toBe(RECOVERY_CODE_GROUP_COUNT);
    for (const group of groups) {
      expect(countOccurrences(dump, group)).toBe(0);
    }
  });

  it('RecoveryMeta 结构里根本没有存放明文的字段', async () => {
    const meta = await runtime.vault.loadRecoveryMeta();
    expect(meta).not.toBeNull();

    const keys = Object.keys(meta ?? {});
    expect(keys).not.toContain('recoveryCode');
    expect(keys).not.toContain('code');
    expect(keys).not.toContain('plaintext');
    // 只允许：id / checksum / exported / createdAt / salt / kdfParams / wrappedDek
    expect(keys.sort()).toEqual(
      ['checksum', 'createdAt', 'exported', 'id', 'kdfParams', 'salt', 'wrappedDek'].sort(),
    );
  });

  it('本地只存恢复码的校验和与被恢复密钥包裹的 DEK（不含明文）', async () => {
    const meta = await runtime.vault.loadRecoveryMeta();
    expect(meta?.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(meta?.wrappedDek.wrapped.kind).toBe('encrypted');
    expect(meta?.exported).toBe(false);
  });

  it('对照组：恢复码确实存在且格式合法（证明上一条不是「因为没生成恢复码」）', () => {
    expect(originalRecoveryCode.length).toBeGreaterThan(0);
    expect(validateRecoveryCode(originalRecoveryCode)).toBe(true);
  });
});

describe('X-03 ③ · 正确恢复码能真正解锁并解密已有数据', () => {
  it('用恢复码解锁后能读出明文账单（而不只是拿到一个 DEK 字节数组）', async () => {
    // 用恢复码解锁 —— 拿到的是「恢复密钥」解出的**同一把 DEK**。
    const recovered = await runtime.vault.unlockWithRecoveryCode(originalRecoveryCode);
    expect(recovered.dek).toHaveLength(32);
    expect(recovered.keyVersion).toBe(1);

    // 把恢复出来的 DEK 装进供给器，再走**正常读路径**。
    runtime.dek.setDek(recovered.dek);
    const bill = await runtime.bills.getById('bill-x03-decrypt');

    expect(bill).not.toBeNull();
    expect(bill?.counterparty).toBe('星巴克(国贸店)');
    expect(bill?.note).toBe('含逗号, 的备注');
    expect(bill?.amountMinor).toBe(12850);
  }, VAULT_TIMEOUT);

  it('恢复码解出的 DEK 与口令解出的 DEK 完全相同（同一把数据密钥）', async () => {
    const byPassword = await runtime.vault.unlock(PASSWORD);
    const byRecovery = await runtime.vault.unlockWithRecoveryCode(originalRecoveryCode);

    expect(Array.from(byRecovery.dek)).toEqual(Array.from(byPassword.dek));
  }, VAULT_TIMEOUT);

  it('恢复码解锁会记录 recover 审计动作', async () => {
    await runtime.vault.unlockWithRecoveryCode(originalRecoveryCode);

    const logs = await runtime.audit.list();
    const recoverLogs = logs.filter((log) => log.action === 'recover');
    expect(recoverLogs.length).toBeGreaterThanOrEqual(1);
    expect(recoverLogs.every((log) => log.success)).toBe(true);
  }, VAULT_TIMEOUT);

  it('恢复码解锁后可继续读写新数据（DEK 可用而非一次性）', async () => {
    const recovered = await runtime.vault.unlockWithRecoveryCode(originalRecoveryCode);
    runtime.dek.setDek(recovered.dek);
    await runtime.bills.put(makeBill('bill-x03-after-recover') as never);

    const bill = await runtime.bills.getById('bill-x03-after-recover');
    expect(bill?.counterparty).toBe('星巴克(国贸店)');
  }, VAULT_TIMEOUT);
});

describe('X-03 ④ · 重新生成恢复码后旧码立即失效', () => {
  it('旧恢复码既过不了校验和，也解不开 DEK 包裹', async () => {
    const oldCode = originalRecoveryCode;
    const newBundle = await runtime.vault.generateRecoveryBundle();
    expect(newBundle.recoveryCode).not.toBe(oldCode);

    // 旧码必须直接被拒绝（校验和不符 → 口令不正确）。
    await expect(runtime.vault.unlockWithRecoveryCode(oldCode)).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VAULT_PASSWORD_WRONG' }),
    );

    // 新码可用。
    await expect(runtime.vault.unlockWithRecoveryCode(newBundle.recoveryCode)).resolves.toBeDefined();
  }, VAULT_TIMEOUT);

  it('重新生成后，落盘的校验和与恢复盐值都换成了新的', async () => {
    const metaBefore = await runtime.vault.loadRecoveryMeta();
    const newBundle = await runtime.vault.generateRecoveryBundle();
    const metaAfter = await runtime.vault.loadRecoveryMeta();

    expect(metaAfter?.checksum).not.toBe(metaBefore?.checksum);
    expect(Array.from(metaAfter?.salt ?? [])).not.toEqual(Array.from(metaBefore?.salt ?? []));
    // 新恢复码的校验和与落盘一致。
    expect(metaAfter?.checksum).toBe(newBundle.checksum);
  }, VAULT_TIMEOUT);

  it('重新生成不改变 DEK（数据不丢失），旧码失效但已有数据仍可读', async () => {
    const oldCode = originalRecoveryCode;
    const newBundle = await runtime.vault.generateRecoveryBundle();
    await expect(runtime.vault.unlockWithRecoveryCode(oldCode)).rejects.toThrow();

    // 用新码解锁后仍能读到原来写入的数据。
    const recovered = await runtime.vault.unlockWithRecoveryCode(newBundle.recoveryCode);
    runtime.dek.setDek(recovered.dek);
    const bill = await runtime.bills.getById('bill-x03-decrypt');
    expect(bill?.counterparty).toBe('星巴克(国贸店)');
  }, VAULT_TIMEOUT);

  it('用旧恢复码解锁失败会记入 failed_unlock 审计（X-07 ②）', async () => {
    await expect(runtime.vault.unlockWithRecoveryCode(originalRecoveryCode)).rejects.toThrow();

    const logs = await runtime.audit.list();
    const failed = logs.filter((log) => log.action === 'failed_unlock');
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(failed[0]?.success).toBe(false);
  }, VAULT_TIMEOUT);
});

describe('X-03 ①② · 恢复码格式与字符集约束', () => {
  it('生成的恢复码是 12 组 × 6 字符，且字符集剔除易混字符 I/O/0/1', () => {
    const code = generateRecoveryCode((length) => new Uint8Array(length).fill(7));
    const groups = code.split('-');

    expect(groups.length).toBe(RECOVERY_CODE_GROUP_COUNT);
    for (const group of groups) {
      expect(group.length).toBe(RECOVERY_CODE_GROUP_LENGTH);
      for (const char of group) {
        expect(RECOVERY_CODE_ALPHABET).toContain(char);
        expect('IO01').not.toContain(char);
      }
    }
  });

  it('组数不足、校验位错误、含非法字符的恢复码一律判为非法', () => {
    expect(validateRecoveryCode('AAAAAA-BBBBBB')).toBe(false);
    expect(validateRecoveryCode('')).toBe(false);
    expect(validateRecoveryCode('AAAAAA-BBBBBB-CCCCCC-DDDDDD-EEEEEE-FFFFFF-GGGGGG-HHHHHH-IIIIII-JJJJJJ-KKKKKK')).toBe(
      false,
    );
    // 'I' 不在字符集内（易混字符已被剔除）。
    expect(validateRecoveryCode('IIIIII-BBBBBB-CCCCCC-DDDDDD-EEEEEE-FFFFFF-GGGGGG-HHHHHH-JJJJJJ-KKKKKK-LLLLLL')).toBe(
      false,
    );
  });

  it('非法格式的恢复码抛 LIFEHUB_E_RECOVERY_INVALID（而不是「口令不正确」）', async () => {
    await expect(runtime.vault.unlockWithRecoveryCode('AAAAAA-BBBBBB')).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_RECOVERY_INVALID' }),
    );
  }, VAULT_TIMEOUT);

  it('格式合法但内容错误的恢复码抛 LIFEHUB_E_VAULT_PASSWORD_WRONG（不泄露「恢复码存在」）', async () => {
    // 造一个格式合法、但与本地校验和不匹配的恢复码。
    const fake = generateRecoveryCode((length) => new Uint8Array(length).fill(3));
    await expect(runtime.vault.unlockWithRecoveryCode(fake)).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VAULT_PASSWORD_WRONG' }),
    );
  }, VAULT_TIMEOUT);
});

describe('X-04 ② · 保险库参数里不含任何明文密钥', () => {
  it('VaultParams 只含公开 KDF 参数、哨兵密文与被包裹的 DEK', async () => {
    const params = await runtime.vaultRepository.load();
    expect(params).not.toBeNull();

    const keys = Object.keys(params ?? {});
    expect(keys).not.toContain('password');
    expect(keys).not.toContain('passwordHash');
    expect(keys).not.toContain('masterKey');
    expect(keys).not.toContain('dek');
    expect(keys).not.toContain('plainDek');

    // 落盘的 currentDek 是「被包裹的」形态，不是 DEK 本身。
    expect(params?.currentDek.wrapped.kind).toBe('encrypted');
    expect(params?.verifier.kind).toBe('encrypted');
  });

  it('落盘内容里检索不到主口令明文', async () => {
    const dump = await dumpWholeAdapter(runtime);
    expect(countOccurrences(dump, PASSWORD)).toBe(0);
  });

  it('明文实体白名单只有 vaultParams / recoveryMeta / appSettings 三类', async () => {
    const { PLAIN_ENTITY_TYPES } = await import('../../src/types/entity-type');
    expect(PLAIN_ENTITY_TYPES).toEqual(['vaultParams', 'recoveryMeta', 'appSettings']);

    // 业务实体类型一律不在白名单里。
    const businessTypes: EntityType[] = ['bill', 'category', 'ruleTemplate', 'importBatch', 'auditLog'];
    for (const type of businessTypes) {
      expect(PLAIN_ENTITY_TYPES).not.toContain(type);
    }
  });
});
