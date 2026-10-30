/**
 * 三方合并单测。
 *
 * 覆盖需求：X-11 ③；系统设计 §1.2 难点 5 的规则表。
 */
import { describe, expect, it } from 'vitest';
import { mergeRecord } from '../../src/services/sync/merge';

interface TestEntity {
  id: string;
  version: number;
  updatedAt: string;
  deviceId: string;
  amountMinor: number;
  counterparty: string;
  note: string;
}

/** 构造一条测试实体。 */
function entity(partial: Partial<TestEntity>): TestEntity {
  return {
    id: 'bill-1',
    version: 1,
    updatedAt: '2024-01-15T00:00:00.000Z',
    deviceId: 'device-a',
    amountMinor: 1234,
    counterparty: '星巴克',
    note: '咖啡',
    ...partial,
  };
}

describe('mergeRecord', () => {
  it('本地不存在时直接采用远端', () => {
    const remote = entity({ version: 3 });
    const result = mergeRecord<TestEntity>(null, remote, null);
    expect(result.merged).toBe(remote);
    expect(result.conflicts).toHaveLength(0);
  });

  it('两端都未修改时保留 base', () => {
    const base = entity({});
    const local = entity({});
    const remote = entity({});
    const result = mergeRecord<TestEntity>(local, remote, base);
    expect(result.changed).toBe(false);
    expect(result.merged.amountMinor).toBe(1234);
  });

  it('只有本地修改时取本地值', () => {
    const base = entity({});
    const local = entity({ amountMinor: 9999 });
    const remote = entity({});
    const result = mergeRecord<TestEntity>(local, remote, base);
    expect(result.merged.amountMinor).toBe(9999);
    expect(result.conflicts).toHaveLength(0);
  });

  it('只有远端修改时取远端值', () => {
    const base = entity({});
    const local = entity({});
    const remote = entity({ counterparty: '便利店' });
    const result = mergeRecord<TestEntity>(local, remote, base);
    expect(result.merged.counterparty).toBe('便利店');
    expect(result.conflicts).toHaveLength(0);
  });

  it('两端修改不同字段时两字段均保留（X-11 ③）', () => {
    const base = entity({});
    const local = entity({ amountMinor: 9999, updatedAt: '2024-01-16T00:00:00.000Z' });
    const remote = entity({ counterparty: '便利店', updatedAt: '2024-01-17T00:00:00.000Z' });
    const result = mergeRecord<TestEntity>(local, remote, base);
    expect(result.merged.amountMinor).toBe(9999);
    expect(result.merged.counterparty).toBe('便利店');
    expect(result.conflicts).toHaveLength(0);
  });

  it('两端修改同一字段且值不同时按 (updatedAt, deviceId) 决胜', () => {
    const base = entity({});
    const local = entity({ amountMinor: 1111, updatedAt: '2024-01-16T00:00:00.000Z', deviceId: 'device-a' });
    const remote = entity({ amountMinor: 2222, updatedAt: '2024-01-17T00:00:00.000Z', deviceId: 'device-b' });
    const result = mergeRecord<TestEntity>(local, remote, base);
    expect(result.merged.amountMinor).toBe(2222);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.field).toBe('amountMinor');
    expect(result.conflicts[0]?.winner).toBe('remote');
  });

  it('结果与到达顺序无关（确定性）', () => {
    const base = entity({});
    const local = entity({ amountMinor: 1111, updatedAt: '2024-01-16T00:00:00.000Z', deviceId: 'device-a' });
    const remote = entity({ amountMinor: 2222, updatedAt: '2024-01-17T00:00:00.000Z', deviceId: 'device-b' });
    const forward = mergeRecord<TestEntity>(local, remote, base);
    const backward = mergeRecord<TestEntity>(remote, local, base);
    expect(forward.merged.amountMinor).toBe(backward.merged.amountMinor);
    // 「与顺序无关」的正确表达是胜方**设备**一致：
    // `winner` 是位置相关标签，把入参对调后必然翻转，不能用来断言确定性。
    expect(forward.conflicts[0]?.winnerDeviceId).toBe('device-b');
    expect(forward.conflicts[0]?.winnerDeviceId).toBe(backward.conflicts[0]?.winnerDeviceId);
  });

  it('时间相同时按 deviceId 决胜', () => {
    const base = entity({});
    const local = entity({ amountMinor: 1111, deviceId: 'device-a' });
    const remote = entity({ amountMinor: 2222, deviceId: 'device-b' });
    const result = mergeRecord<TestEntity>(local, remote, base);
    expect(result.merged.amountMinor).toBe(2222);
    expect(result.conflicts[0]?.winner).toBe('remote');
  });

  it('两端改成相同值时不算冲突', () => {
    const base = entity({});
    const local = entity({ amountMinor: 1111 });
    const remote = entity({ amountMinor: 1111 });
    const result = mergeRecord<TestEntity>(local, remote, base);
    expect(result.merged.amountMinor).toBe(1111);
    expect(result.conflicts).toHaveLength(0);
  });

  it('无 base 时退化为整条记录 LWW 并记录全字段差异', () => {
    const local = entity({ amountMinor: 1111, updatedAt: '2024-01-16T00:00:00.000Z' });
    const remote = entity({ amountMinor: 2222, counterparty: '便利店', updatedAt: '2024-01-17T00:00:00.000Z' });
    const result = mergeRecord<TestEntity>(local, remote, null);
    expect(result.merged.amountMinor).toBe(2222);
    expect(result.conflicts.length).toBeGreaterThan(0);
  });

  it('合并后的版本号单调递增', () => {
    const base = entity({ version: 5 });
    const local = entity({ version: 6, amountMinor: 1 });
    const remote = entity({ version: 7, counterparty: 'x' });
    const result = mergeRecord<TestEntity>(local, remote, base);
    expect(result.merged.version).toBeGreaterThan(7);
  });
});
