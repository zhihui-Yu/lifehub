/**
 * 幂等导入集成测试。
 *
 * 覆盖需求：A-12 ②③；系统设计 §7 T03 验收「同一 fixture 连续导入两次，账单总数不变」。
 *
 * 说明：夹具选用 `simple-with-direction.csv`（含「方向」列）。
 * `simple.csv` 没有方向列，在 auto 策略下方向无法判定，
 * 按 PRD A-06 ② 该行会被跳过（rowSkipped），因此无法用于验证「幂等导入」与「重复行去重」。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ColumnMapping } from '../../src/index';
import { createUnlockedRuntime } from '../helpers/runtime';

/** 读取夹具文件内容。 */
function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/csv/${name}`, import.meta.url)), 'utf8');
}

/** 含方向列的常用列映射。 */
const DIRECTION_MAPPING: ColumnMapping = {
  0: 'occurredAt',
  1: 'amount',
  2: 'counterparty',
  3: 'direction',
};

describe('幂等导入', () => {
  it('同一 fixture 连续导入两次，账单总数不变（A-12 ③）', async () => {
    const runtime = await createUnlockedRuntime();
    const text = fixture('simple-with-direction.csv');
    const bytes = new TextEncoder().encode(text);
    const mapping: ColumnMapping = DIRECTION_MAPPING;
    const options = { userTimeZone: 'Asia/Shanghai' };

    const first = await runtime.importService.run(
      { fileName: 'simple-with-direction.csv', sizeBytes: bytes.length, bytes },
      mapping,
      options,
    );
    expect(first.rowImported).toBe(3);
    expect(await runtime.bills.list()).toHaveLength(3);

    const second = await runtime.importService.run(
      { fileName: 'simple-with-direction.csv', sizeBytes: bytes.length, bytes },
      mapping,
      options,
    );
    expect(second.duplicateFile).toBe(true);
    expect(second.rowImported).toBe(0);
    expect(await runtime.bills.list()).toHaveLength(3);
  });

  it('内容级去重：文件名不同但内容相同的行不会重复入库', async () => {
    const runtime = await createUnlockedRuntime();
    const text = fixture('simple-with-direction.csv');
    const mapping: ColumnMapping = DIRECTION_MAPPING;
    const options = { userTimeZone: 'Asia/Shanghai' };

    const bytesA = new TextEncoder().encode(text);
    await runtime.importService.run({ fileName: 'a.csv', sizeBytes: bytesA.length, bytes: bytesA }, mapping, options);

    // 相同内容但文件名不同 → 文件哈希相同，仍应被幂等拦截。
    const bytesB = new TextEncoder().encode(text);
    const second = await runtime.importService.run(
      { fileName: 'b.csv', sizeBytes: bytesB.length, bytes: bytesB },
      mapping,
      options,
    );
    expect(second.duplicateFile).toBe(true);
    expect(await runtime.bills.list()).toHaveLength(3);
  });

  it('内容不同但行内容重复时，重复行被跳过且计入 rowDuplicated', async () => {
    const runtime = await createUnlockedRuntime();
    const text =
      '日期,金额,对方,方向\n' +
      '2024-01-15,35.50,星巴克,支出\n' +
      '2024-01-15,35.50,星巴克,支出\n' +
      '2024-01-16,12.00,便利店,支出\n';
    const bytes = new TextEncoder().encode(text);
    const mapping: ColumnMapping = DIRECTION_MAPPING;
    const summary = await runtime.importService.run(
      { fileName: 'dup-rows.csv', sizeBytes: bytes.length, bytes },
      mapping,
      { userTimeZone: 'Asia/Shanghai' },
    );
    expect(summary.rowTotal).toBe(3);
    expect(summary.rowImported).toBe(2);
    expect(summary.rowDuplicated).toBe(1);
    expect(summary.rowSkipped).toBe(1);
    expect(await runtime.bills.list()).toHaveLength(2);
  });

  it('allowDuplicate = true 时允许重新导入', async () => {
    const runtime = await createUnlockedRuntime();
    const bytes = new TextEncoder().encode(fixture('simple-with-direction.csv'));
    const mapping: ColumnMapping = DIRECTION_MAPPING;
    const options = { userTimeZone: 'Asia/Shanghai' };

    await runtime.importService.run(
      { fileName: 'simple-with-direction.csv', sizeBytes: bytes.length, bytes },
      mapping,
      options,
    );
    const second = await runtime.importService.run(
      { fileName: 'simple-with-direction.csv', sizeBytes: bytes.length, bytes },
      mapping,
      { ...options, allowDuplicate: true },
    );
    expect(second.duplicateFile).toBe(false);
    // 内容级去重仍然生效，账单数不变。
    expect(await runtime.bills.list()).toHaveLength(3);
  });
});
