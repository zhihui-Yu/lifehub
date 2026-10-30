/**
 * 加密备份往返集成测试。
 *
 * 覆盖需求：A-24 ①②③④、X-01 ④、NF-PR-6。
 */
import { describe, expect, it } from 'vitest';
import { BackupService } from '../../src/services/backup-service';
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

/** 把备份文件序列化为「落盘文本」，用于全文检索明文样本。 */
function serialize(file: unknown): string {
  return JSON.stringify(file, (_key, value: unknown) =>
    value instanceof Uint8Array ? Array.from(value) : value,
  );
}

describe('BackupService', () => {
  it('导出备份文件全文不含明文样本（A-24 ④）', async () => {
    const runtime = await createUnlockedRuntime();
    await runtime.bills.put(bill());

    const service = new BackupService({
      adapter: runtime.adapter,
      clock: runtime.clock,
      provider: runtime.provider,
    });
    const file = await service.exportBackup();
    const json = serialize(file);

    for (const sample of ['星巴克', '拿铁大杯', '128.50', '12850', 'expense', 'localDate']) {
      expect(json).not.toContain(sample);
    }
  });

  it('导出的备份文本全文搜不到对方名与金额等明文样本', async () => {
    const runtime = await createUnlockedRuntime();
    await runtime.bills.put(bill());
    await runtime.bills.put(
      bill({
        id: 'bill-2',
        counterparty: '全家便利店',
        note: '饭团',
        amountMinor: 1_250,
        localDate: '2024-01-16',
      }),
    );

    const service = new BackupService({
      adapter: runtime.adapter,
      clock: runtime.clock,
      provider: runtime.provider,
    });
    const file = await service.exportBackup();
    const text = serialize(file);

    // 明文样本：对方名、备注、金额（整数分与十进制两种写法）。
    for (const sample of ['星巴克', '国贸店', '拿铁大杯', '全家便利店', '饭团', '12850', '128.50', '1250', '12.50']) {
      expect(text).not.toContain(sample);
    }
  });

  it('导出文件不含 salt / DEK / 主密钥', async () => {
    const runtime = await createUnlockedRuntime();
    await runtime.bills.put(bill());
    const service = new BackupService({
      adapter: runtime.adapter,
      clock: runtime.clock,
      provider: runtime.provider,
    });
    const file = await service.exportBackup();
    expect(Object.keys(file).sort()).toEqual(['algorithm', 'blobs', 'exportedAt', 'keyVersion', 'magic', 'version']);
  });

  it('导入备份后数据一致（往返）', async () => {
    const source = await createUnlockedRuntime();
    await source.bills.put(bill());

    const service = new BackupService({
      adapter: source.adapter,
      clock: source.clock,
      provider: source.provider,
    });
    const file = await service.exportBackup();

    const target = await createUnlockedRuntime();
    // 备份文件按 PRD A-24 ① 只搬运密文，**不含 DEK**；
    // 因此目标端必须复用源端的同一把 DEK 才能解开密文——这正是「备份不含密钥」的含义。
    target.dek.setDek(source.dek.getDek('bill'));

    const targetService = new BackupService({
      adapter: target.adapter,
      clock: target.clock,
      provider: target.provider,
    });
    const summary = await targetService.importBackup(file);
    // 备份包含源端全部密文 blob（账单 + 审计日志），导入条数应与 blob 数一致。
    expect(summary.rowImported).toBe(file.blobs.length);
    expect(summary.rowSkipped).toBe(0);

    const restored = await target.bills.getById('bill-1');
    expect(restored?.counterparty).toBe('星巴克(国贸店)');
    expect(restored?.amountMinor).toBe(12_850);
  });

  it('魔数 / 版本 / 算法不匹配时抛 LIFEHUB_E_BACKUP_INVALID', async () => {
    const runtime = await createUnlockedRuntime();
    const service = new BackupService({
      adapter: runtime.adapter,
      clock: runtime.clock,
      provider: runtime.provider,
    });
    const file = await service.exportBackup();

    await expect(service.importBackup({ ...file, magic: 'NOT-LIFEHUB' as 'LIFEHUB-BACKUP' })).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_BACKUP_INVALID' }),
    );
    await expect(service.importBackup({ ...file, version: 99 as 1 })).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_BACKUP_INVALID' }),
    );
    await expect(
      service.importBackup({ ...file, algorithm: 'AES-128-GCM' as 'AES-256-GCM' }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'LIFEHUB_E_BACKUP_INVALID' }));
  });

  it('备份内容含明文字段时被拒绝', async () => {
    const runtime = await createUnlockedRuntime();
    const service = new BackupService({
      adapter: runtime.adapter,
      clock: runtime.clock,
      provider: runtime.provider,
    });
    const file = await service.exportBackup();
    const tampered = {
      ...file,
      blobs: [{ ...file.blobs[0], amountMinor: 100 } as never],
    };
    await expect(service.importBackup(tampered)).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_BACKUP_INVALID' }),
    );
  });
});
