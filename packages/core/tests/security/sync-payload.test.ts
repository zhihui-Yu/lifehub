/**
 * 安全深度验证 · X-01 端到端加密与密文搬移防护。
 *
 * 覆盖需求：X-01 ①②③④；NF-S-1；NF-PR-6；ADR-003（加密封装边界）；ADR-006（索引明文列）。
 * 覆盖红线：R4（存储层唯一密文写通道）、R5（同步载荷与备份只含密文）。
 *
 * 【本文件与既有测试的差异】
 * 既有 `tests/unit/sync-payload.test.ts` 与 `tests/qa/qa-sync-server.test.ts`
 * 验证的是「载荷构造函数的字段白名单」。本文件做的是**端到端快照检索**：
 * 1. 从真实运行时（建库 → 解锁 → 写入含中文对方名 / 金额 / 备注的账单）
 *    导出**同步载荷**与**加密备份**，把整份产物序列化后全文检索明文样本，
 *    命中数必须**严格为 0**；
 * 2. **AAD 绑定验证**：把 A 记录的密文搬到 B 记录的位置解密必须失败——
 *    这是「密文搬移」攻击（把别人的账单密文粘到自己的记录上）唯一的防线；
 * 3. 验证落盘记录只含 **ADR-006 允许的 7 个索引明文列**，不含任何业务语义字段。
 *
 * 性能说明：建库 / 解锁各要跑一次 N=32768 的 scrypt（约 1~2 秒），
 * 因此只读用例**共享同一个运行时**（beforeAll 准备一次），
 * 只有会破坏数据的「密文搬移」用例才另建运行时。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestRuntime } from '../helpers/runtime';
import { BackupService } from '../../src/services/backup-service';
import { buildSyncPayload } from '../../src/services/sync/sync-payload';
import { formatMinor } from '../../src/money/amount';
import type { EncryptedBlob } from '../../src/models/encrypted-blob';
import type { StoredRecord } from '../../src/models/common';

/** 明文样本：任何一处命中即判定为「密文外泄」。 */
const PLAINTEXT_SAMPLES: readonly string[] = [
  '星巴克(国贸店)',
  '128.50',
  '含逗号, 的备注',
  '今天的日记正文：天气很好',
  '机密项目 Alpha',
];

/** 明文样本的「零命中」期望值。 */
const ZERO_HITS: Record<string, number> = {
  '星巴克(国贸店)': 0,
  '128.50': 0,
  '含逗号, 的备注': 0,
  '今天的日记正文：天气很好': 0,
  '机密项目 Alpha': 0,
};

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
 * 构造一条含全部明文样本的账单实体。
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
    sourceFileId: 'batch-x01',
    sourceRowIndex: 0,
    createdAt: '2024-01-15T08:12:00.000Z',
    updatedAt: '2024-01-15T08:12:00.000Z',
    version: 1,
    deviceId: 'test-device',
  };
}

/**
 * 把任意值序列化为「可全文检索」的文本。
 *
 * 说明：Uint8Array 若直接 JSON.stringify 会变成 `{"0":1,...}`，
 * 检索到的只是字节序号而非真实内容，会造成**假阴性**（明明有明文却搜不到）。
 * 因此这里把字节数组额外展开成 hex 与 latin1 两种可读形式再拼接，
 * 确保任何以明文形式存在于载荷中的字节都能被检索到。
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
 * 统计明文样本在检索文本中的命中次数。
 *
 * @param text 检索用文本
 * @param samples 明文样本
 * @returns 命中明细（样本 → 次数）
 */
function countHits(text: string, samples: readonly string[]): Record<string, number> {
  const hits: Record<string, number> = {};
  for (const sample of samples) {
    let count = 0;
    let from = 0;
    for (;;) {
      const at = text.indexOf(sample, from);
      if (at < 0) {
        break;
      }
      count += 1;
      from = at + sample.length;
    }
    hits[sample] = count;
  }
  return hits;
}

/**
 * 把存储记录转换成同步 blob。
 *
 * @param record 存储记录
 * @returns 同步 blob
 */
function toBlob(record: StoredRecord): EncryptedBlob {
  if (record.payload.kind !== 'encrypted') {
    throw new Error('业务记录必须是密文载荷');
  }
  return {
    id: record.id,
    entityType: record.entityType,
    entityId: record.id,
    ciphertext: record.payload.ciphertext,
    iv: record.payload.iv,
    tag: record.payload.tag,
    algorithm: 'AES-256-GCM',
    keyVersion: record.payload.keyVersion,
    updatedAt: record.updatedAt,
    version: record.version,
  };
}

/**
 * 准备一个已解锁、且已写入含明文样本账单的运行时。
 *
 * @param billCount 写入的账单条数
 * @returns 运行时与写入的账单 id 列表
 */
async function prepareRuntime(billCount: number): Promise<{ runtime: Runtime; billIds: string[] }> {
  const runtime = createTestRuntime();
  await runtime.vault.createVault(PASSWORD);
  await runtime.vault.unlock(PASSWORD);

  const billIds: string[] = [];
  for (let index = 0; index < billCount; index += 1) {
    const id = `bill-x01-${index}`;
    await runtime.bills.put(makeBill(id) as never);
    billIds.push(id);
  }

  // 再写一条带「日记正文」的记录，模拟加密日记模块的载荷。
  await runtime.store.put('diaryEntry', {
    id: 'diary-x01-1',
    body: '今天的日记正文：天气很好',
    secret: '机密项目 Alpha',
    version: 1,
    createdAt: '2024-01-15T08:12:00.000Z',
    updatedAt: '2024-01-15T08:12:00.000Z',
    deviceId: 'test-device',
  });

  return { runtime, billIds };
}

describe('X-01 ④ · 同步载荷与备份全文搜索明文样本命中数必须为 0', () => {
  /** 共享的只读运行时（避免每个用例都重跑一次 scrypt）。 */
  let runtime: Runtime;
  /** 已写入的账单 id。 */
  let billIds: string[];

  beforeAll(async () => {
    const prepared = await prepareRuntime(5);
    runtime = prepared.runtime;
    billIds = prepared.billIds;
  });

  it('导出的同步载荷里检索不到任何明文样本', async () => {
    const records = await runtime.adapter.query('bill');
    const payload = buildSyncPayload(
      records.map((record) => toBlob(record)),
      '2024-01-15T08:12:00.000Z',
    );

    const hits = countHits(toSearchableText(payload), PLAINTEXT_SAMPLES);
    expect(hits).toEqual(ZERO_HITS);
  }, VAULT_TIMEOUT);

  it('导出的加密备份里检索不到任何明文样本', async () => {
    const backupService = new BackupService({
      adapter: runtime.adapter,
      clock: runtime.clock,
      provider: runtime.provider,
    });
    const file = await backupService.exportBackup();

    const hits = countHits(toSearchableText(file), PLAINTEXT_SAMPLES);
    expect(hits).toEqual(ZERO_HITS);
  }, VAULT_TIMEOUT);

  it('存储适配器落盘内容里检索不到任何明文样本（含索引明文列）', async () => {
    // 把整个适配器（所有实体类型）的落盘内容都检索一遍。
    const chunks: string[] = [];
    for (const entityType of runtime.adapter.listEntityTypes()) {
      const records = await runtime.adapter.query(entityType);
      chunks.push(toSearchableText(records));
    }
    const hits = countHits(chunks.join('\n'), PLAINTEXT_SAMPLES);
    expect(hits).toEqual(ZERO_HITS);
  }, VAULT_TIMEOUT);

  it('对照组：明文确实存在于业务对象中（证明上一条不是「因为没数据所以搜不到」）', async () => {
    const bill = await runtime.bills.getById(billIds[0] ?? '');
    expect(bill?.counterparty).toBe('星巴克(国贸店)');
    expect(bill?.note).toBe('含逗号, 的备注');
    expect(bill?.amountMinor).toBe(12850);

    // 用 core 的金额格式化函数还原出「128.50」这份明文样本，
    // 证明检索器对明文有效（否则前一条断言可能是「搜不到是因为根本没有明文」的假阴性）。
    const formatted = `金额 ${formatMinor(bill?.amountMinor ?? 0)} 元`;
    expect(formatted).toContain('128.50');
    expect(countHits(formatted, PLAINTEXT_SAMPLES)['128.50']).toBe(1);
  }, VAULT_TIMEOUT);
});

describe('X-01 ④ / R5 · 同步载荷与备份只含密文字段', () => {
  /** 共享的只读运行时。 */
  let runtime: Runtime;

  beforeAll(async () => {
    runtime = (await prepareRuntime(3)).runtime;
  });

  it('同步载荷的 blob 字段全部落在白名单内', async () => {
    const records = await runtime.adapter.query('bill');
    const payload = buildSyncPayload(records.map((record) => toBlob(record)));
    expect(payload.blobs.length).toBeGreaterThan(0);

    const allowed = new Set([
      'id',
      'entityType',
      'entityId',
      'ciphertext',
      'iv',
      'tag',
      'algorithm',
      'keyVersion',
      'updatedAt',
      'version',
      'createdAt',
      'blobs',
      'magic',
      'exportedAt',
    ]);
    for (const blob of payload.blobs) {
      for (const key of Object.keys(blob)) {
        expect(allowed.has(key)).toBe(true);
      }
      // 载荷里不得出现任何业务语义字段。
      expect(Object.keys(blob)).not.toContain('amountMinor');
      expect(Object.keys(blob)).not.toContain('counterparty');
      expect(Object.keys(blob)).not.toContain('note');
      expect(Object.keys(blob)).not.toContain('localDate');
    }
  }, VAULT_TIMEOUT);

  it('备份文件不含盐值 / DEK / 主密钥字段', async () => {
    const backupService = new BackupService({
      adapter: runtime.adapter,
      clock: runtime.clock,
      provider: runtime.provider,
    });
    const file = await backupService.exportBackup();

    expect(file.magic).toBe('LIFEHUB-BACKUP');
    expect(file.algorithm).toBe('AES-256-GCM');
    const keys = Object.keys(file);
    expect(keys).not.toContain('salt');
    expect(keys).not.toContain('dek');
    expect(keys).not.toContain('masterKey');
    expect(keys).not.toContain('verifier');

    for (const blob of file.blobs) {
      expect(Object.keys(blob)).not.toContain('salt');
      expect(Object.keys(blob)).not.toContain('dek');
    }
  }, VAULT_TIMEOUT);

  it('构造含明文字段的载荷会被 assertCiphertextOnly 拒绝', async () => {
    const { assertCiphertextOnly } = await import('../../src/services/sync/sync-payload');
    expect(() =>
      assertCiphertextOnly({
        blobs: [
          {
            id: 'x',
            entityType: 'bill',
            entityId: 'x',
            ciphertext: new Uint8Array([1]),
            iv: new Uint8Array([1]),
            tag: new Uint8Array([1]),
            algorithm: 'AES-256-GCM',
            keyVersion: 1,
            updatedAt: '2024-01-15T08:12:00.000Z',
            version: 1,
            amountMinor: 12850,
          },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }));
  }, VAULT_TIMEOUT);
});

describe('X-01 ② / ADR-006 · 存储记录只含 7 个索引明文列', () => {
  /** 共享的只读运行时。 */
  let runtime: Runtime;
  /** 已写入的账单 id。 */
  let billIds: string[];

  beforeAll(async () => {
    const prepared = await prepareRuntime(3);
    runtime = prepared.runtime;
    billIds = prepared.billIds;
  });

  it('落盘记录的顶层字段与 ADR-006 规定的完全一致', async () => {
    const record = await runtime.adapter.get('bill', billIds[0] ?? '');

    expect(record).not.toBeNull();
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
  }, VAULT_TIMEOUT);

  it('落盘记录不含任何业务语义字段（金额 / 对方 / 备注 / 分类 / 方向）', async () => {
    const record = await runtime.adapter.get('bill', billIds[0] ?? '');

    for (const forbidden of ['amountMinor', 'counterparty', 'note', 'categoryId', 'direction', 'body']) {
      expect(Object.keys(record ?? {})).not.toContain(forbidden);
    }
    // 载荷本身必须是密文。
    expect(record?.payload.kind).toBe('encrypted');
  }, VAULT_TIMEOUT);

  it('索引明文列只暴露 ADR-006 白名单内的 7 个字段', async () => {
    const record = await runtime.adapter.get('bill', billIds[0] ?? '');

    // entityType / localDate / occurredAt / createdAt / updatedAt / version / deviceId
    expect(record?.entityType).toBe('bill');
    expect(record?.localDate).toBe('2024-01-15');
    expect(record?.occurredAt).toBe('2024-01-15T08:12:00.000Z');
    expect(record?.createdAt).toBe('2024-01-15T08:12:00.000Z');
    expect(record?.updatedAt).toBe('2024-01-15T08:12:00.000Z');
    expect(record?.version).toBe(1);
    expect(record?.deviceId).toBe('test-device');
  }, VAULT_TIMEOUT);
});

describe('X-01 ② · AAD 绑定：密文不可跨记录搬移', () => {
  it('把 A 记录的密文搬到 B 记录的位置读取，必然失败', async () => {
    const { runtime, billIds } = await prepareRuntime(2);
    const idA = billIds[0] ?? '';
    const idB = billIds[1] ?? '';

    const recordA = await runtime.adapter.get('bill', idA);
    if (recordA?.payload.kind !== 'encrypted') {
      throw new Error('账单必须是密文载荷');
    }

    // 物理搬移：A 的密文塞进 B 的记录位置（保持 record.id = B）。
    const movedRecord: StoredRecord = {
      ...(recordA as StoredRecord),
      id: idB,
      entityType: 'bill',
    };
    await runtime.adapter.put('bill', movedRecord);

    // 通过正常读路径读取 B 记录 —— AAD 里绑的是 entityId=B，
    // 但密文是在 AAD=entityId=A 下产生的，GCM 认证必然失败。
    await expect(runtime.bills.getById(idB)).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_CRYPTO_AUTH_FAILED' }),
    );
  }, VAULT_TIMEOUT);

  it('把 A 记录的密文搬到另一种实体类型的记录位置读取，必然失败', async () => {
    const { runtime, billIds } = await prepareRuntime(1);
    const recordA = await runtime.adapter.get('bill', billIds[0] ?? '');
    if (recordA?.payload.kind !== 'encrypted') {
      throw new Error('账单必须是密文载荷');
    }

    const movedRecord: StoredRecord = {
      ...(recordA as StoredRecord),
      id: 'category-x01-1',
      entityType: 'category',
    };
    await runtime.adapter.put('category', movedRecord);

    await expect(runtime.store.get('category', 'category-x01-1')).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_CRYPTO_AUTH_FAILED' }),
    );
  }, VAULT_TIMEOUT);

  it('把 A 记录的密文搬到不同密钥版本的位置读取，必然失败', async () => {
    const { runtime, billIds } = await prepareRuntime(1);
    const idA = billIds[0] ?? '';
    const recordA = await runtime.adapter.get('bill', idA);
    if (recordA?.payload.kind !== 'encrypted') {
      throw new Error('账单必须是密文载荷');
    }

    const movedRecord: StoredRecord = {
      ...(recordA as StoredRecord),
      payload: { ...recordA.payload, keyVersion: 999 },
    };
    await runtime.adapter.put('bill', movedRecord);

    await expect(runtime.bills.getById(idA)).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_CRYPTO_AUTH_FAILED' }),
    );
  }, VAULT_TIMEOUT);

  it('对照组：未搬移的原记录仍能正常解密（证明上一条不是「本来就解不开」）', async () => {
    const { runtime, billIds } = await prepareRuntime(3);
    const bill = await runtime.bills.getById(billIds[2] ?? '');
    expect(bill?.counterparty).toBe('星巴克(国贸店)');
  }, VAULT_TIMEOUT);
});
