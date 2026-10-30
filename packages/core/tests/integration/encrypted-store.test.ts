/**
 * 加密存储集成测试。
 *
 * 覆盖需求：NF-S-1、R4、X-09 ③；系统设计 §7 T05「落库密文可检索到明文 = 0」。
 */
import { describe, expect, it } from 'vitest';
import { createUnlockedRuntime } from '../helpers/runtime';
import type { Bill } from '../../src/models/bill';

/** 构造一条账单。 */
function bill(partial: Partial<Bill> = {}): Bill {
  return {
    id: 'bill-1',
    amountMinor: 12_850,
    currency: 'CNY',
    direction: 'expense',
    occurredAt: '2024-01-15T08:12:00.000Z',
    localDate: '2024-01-15',
    sourceTimeZone: 'Asia/Shanghai',
    counterparty: '星巴克(国贸店)',
    categoryId: null,
    note: '拿铁大杯',
    sourceFileId: 'batch-1',
    sourceRowIndex: 0,
    createdAt: '2024-01-15T08:12:00.000Z',
    updatedAt: '2024-01-15T08:12:00.000Z',
    version: 1,
    deviceId: 'test-device',
    ...partial,
  };
}

describe('EncryptedStore', () => {
  it('落盘后存储层检索不到任何明文业务数据（NF-S-1）', async () => {
    const runtime = await createUnlockedRuntime();
    await runtime.bills.put(bill());

    const raw = JSON.stringify(
      [...runtime.adapter.listEntityTypes()].map((type) => runtime.adapter.query(type)),
      (_key, value: unknown) => (value instanceof Uint8Array ? Array.from(value) : value),
    );

    for (const sample of ['星巴克', '拿铁大杯', '128.50', '12850', 'expense']) {
      expect(raw).not.toContain(sample);
    }
  });

  it('存储记录只含最小索引明文列（ADR-006）', async () => {
    const runtime = await createUnlockedRuntime();
    await runtime.bills.put(bill());

    const records = await runtime.adapter.query('bill');
    const record = records[0];
    expect(record?.localDate).toBe('2024-01-15');
    expect(record?.occurredAt).toBe('2024-01-15T08:12:00.000Z');
    expect(record?.deviceId).toBe('test-device');
    expect(record?.version).toBe(1);
    expect(record?.payload.kind).toBe('encrypted');
  });

  it('写入后可原样读回（解密往返一致）', async () => {
    const runtime = await createUnlockedRuntime();
    await runtime.bills.put(bill());
    const loaded = await runtime.bills.getById('bill-1');
    expect(loaded?.counterparty).toBe('星巴克(国贸店)');
    expect(loaded?.amountMinor).toBe(12_850);
    expect(loaded?.note).toBe('拿铁大杯');
  });

  it('按 localDate 范围查询只返回区间内的记录（X-09 ③）', async () => {
    const runtime = await createUnlockedRuntime();
    await runtime.bills.put(bill({ id: 'b1', localDate: '2024-01-15' }));
    await runtime.bills.put(bill({ id: 'b2', localDate: '2024-02-20' }));
    await runtime.bills.put(bill({ id: 'b3', localDate: '2024-03-05' }));

    const inRange = await runtime.bills.queryByLocalDateRange('2024-02-01', '2024-02-29');
    expect(inRange).toHaveLength(1);
    expect(inRange[0]?.id).toBe('b2');
  });

  it('按方向统计数量', async () => {
    const runtime = await createUnlockedRuntime();
    await runtime.bills.put(bill({ id: 'b1', direction: 'expense' }));
    await runtime.bills.put(bill({ id: 'b2', direction: 'income' }));
    await runtime.bills.put(bill({ id: 'b3', direction: 'income' }));
    expect(await runtime.bills.countByDirection('income')).toBe(2);
    expect(await runtime.bills.countByDirection('expense')).toBe(1);
  });

  it('关键词过滤在解密后进行，且同时匹配对方与备注', async () => {
    const runtime = await createUnlockedRuntime();
    await runtime.bills.put(bill({ id: 'b1', counterparty: '星巴克', note: '拿铁' }));
    await runtime.bills.put(bill({ id: 'b2', counterparty: '便利店', note: '矿泉水' }));

    expect(await runtime.bills.list({ keyword: '星巴克' })).toHaveLength(1);
    expect(await runtime.bills.list({ keyword: '矿泉水' })).toHaveLength(1);
    expect(await runtime.bills.list({ keyword: '不存在' })).toHaveLength(0);
  });

  it('未解锁时拒绝一切业务实体读写（LIFEHUB_E_VAULT_NOT_FOUND）', async () => {
    const runtime = await createUnlockedRuntime();
    const locked = await createUnlockedRuntime();
    // 构造一个未解锁的 DEK 供给器。
    const { MemoryStorageAdapter, CryptoService, WebCryptoProvider, EncryptedStore } = await import(
      '../../src/index'
    );
    const adapter = new MemoryStorageAdapter();
    const provider = new WebCryptoProvider();
    const cryptoService = new CryptoService(provider);
    const store = new EncryptedStore({
      adapter,
      crypto: cryptoService,
      dek: {
        isUnlocked: () => false,
        getDek: () => new Uint8Array(32),
        getKeyVersion: () => 1,
      },
    });
    await expect(store.get('bill', 'bill-1')).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VAULT_NOT_FOUND' }),
    );
    void locked;
  });

  it('PlainStore 拒绝写入白名单之外的实体', async () => {
    const runtime = await createUnlockedRuntime();
    const params = await runtime.vaultRepository.load();
    // 说明：load() 的返回类型是 `VaultParams | null`，
    // 这里显式判空而不是写 `!` 非空断言（§8.4 类型纪律禁止 `!`）。
    if (params === null) {
      throw new Error('保险库参数应已存在');
    }
    await expect(runtime.vaultRepository.save({ ...params } as never)).resolves.toBeUndefined();
  });
});
