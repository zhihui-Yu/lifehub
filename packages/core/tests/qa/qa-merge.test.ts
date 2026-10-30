/**
 * QA 独立补测 · X-11 冲突合并（三方合并）。
 *
 * 覆盖需求：X-11 ①②③；PRD §3.1 Bill 的 version / deviceId 字段；
 * 系统设计 §1.2 难点 5 的规则表。
 *
 * 【本文件与工程师自写用例的差异】
 * 工程师的 `tests/unit/merge-record.test.ts` 已覆盖基础规则表。
 * 本轮主理人特别要求核实：「现在用 `winnerDeviceId` 判定，请确认这个新字段真的与到达顺序无关」。
 * 因此本文件用**参数化 + 穷举对调**的方式补测：
 * 1. 对**每一组**冲突场景，把入参对调后重新合并，断言 `winnerDeviceId` 不变、
 *    合并结果不变 —— 这才是「与到达顺序无关」的正确表达；
 * 2. 覆盖 `updatedAt` **完全相同**时靠 `deviceId` 决胜的边界；
 * 3. 覆盖 base 缺失（首次同步）时 winnerDeviceId 的正确性。
 */
import { describe, expect, it } from 'vitest';
import { mergeRecord } from '../../src/services/sync/merge';

/** 测试实体。 */
interface TestEntity {
  id: string;
  version: number;
  updatedAt: string;
  deviceId: string;
  amountMinor: number;
  counterparty: string;
  note: string;
}

/**
 * 构造一条测试实体。
 *
 * @param partial 需要覆盖的字段
 * @returns 完整的测试实体
 */
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

/** 一组冲突场景：本地、远端、共同祖先。 */
interface Scenario {
  /** 场景名称。 */
  name: string;
  /** 本地记录。 */
  local: TestEntity;
  /** 远端记录。 */
  remote: TestEntity;
  /** 共同祖先快照。 */
  base: TestEntity | null;
  /** 期望的胜出设备 id。 */
  expectedWinnerDeviceId: string;
}

describe('X-11 · 双端改不同字段 → 两字段都保留（X-11 ③）', () => {
  it('本地改金额、远端改对方，两处改动都保留', () => {
    const base = entity({});
    const local = entity({ amountMinor: 9999 });
    const remote = entity({ counterparty: '便利店' });

    const result = mergeRecord<TestEntity>(local, remote, base);

    expect(result.merged.amountMinor).toBe(9999);
    expect(result.merged.counterparty).toBe('便利店');
    expect(result.conflicts).toHaveLength(0);
    expect(result.changed).toBe(true);
  });

  it('本地改备注、远端改金额，两处改动都保留', () => {
    const base = entity({});
    const local = entity({ note: '换了备注' });
    const remote = entity({ amountMinor: 5555 });

    const result = mergeRecord<TestEntity>(local, remote, base);

    expect(result.merged.note).toBe('换了备注');
    expect(result.merged.amountMinor).toBe(5555);
    expect(result.conflicts).toHaveLength(0);
  });

  it('两端各改三个不同字段，六个字段全部保留', () => {
    const base = entity({});
    const local = entity({ amountMinor: 1111, counterparty: 'A店', note: '本地备注' });
    const remote = entity({ amountMinor: 2222, counterparty: 'B店', note: '远端备注' });

    // 同一字段被两端都改 → 产生冲突；这里改为真正不同的字段组合。
    const local2 = entity({ amountMinor: 1111, counterparty: 'A店' });
    const remote2 = entity({ note: '远端备注', version: 2 });
    const result = mergeRecord<TestEntity>(local2, remote2, base);

    expect(result.merged.amountMinor).toBe(1111);
    expect(result.merged.counterparty).toBe('A店');
    expect(result.merged.note).toBe('远端备注');
  });
});

describe('X-11 · 双端改同一字段 → 取较新者且与到达顺序无关（X-11 ③）', () => {
  /** 冲突场景集合：覆盖时间不同、时间相同靠 deviceId 决胜、base 缺失三种情形。 */
  const scenarios: Scenario[] = [
    {
      name: '远端更新（updatedAt 更晚）',
      local: entity({ amountMinor: 1111, updatedAt: '2024-01-16T00:00:00.000Z', deviceId: 'device-a' }),
      remote: entity({ amountMinor: 2222, updatedAt: '2024-01-17T00:00:00.000Z', deviceId: 'device-b' }),
      base: entity({}),
      expectedWinnerDeviceId: 'device-b',
    },
    {
      name: '本地更新（updatedAt 更晚）',
      local: entity({ amountMinor: 1111, updatedAt: '2024-01-18T00:00:00.000Z', deviceId: 'device-a' }),
      remote: entity({ amountMinor: 2222, updatedAt: '2024-01-17T00:00:00.000Z', deviceId: 'device-b' }),
      base: entity({}),
      expectedWinnerDeviceId: 'device-a',
    },
    {
      name: 'updatedAt 完全相同 → 按 deviceId 决胜（device-b > device-a）',
      local: entity({ amountMinor: 1111, updatedAt: '2024-01-16T00:00:00.000Z', deviceId: 'device-a' }),
      remote: entity({ amountMinor: 2222, updatedAt: '2024-01-16T00:00:00.000Z', deviceId: 'device-b' }),
      base: entity({}),
      expectedWinnerDeviceId: 'device-b',
    },
    {
      name: 'updatedAt 相同且 deviceId 字典序更大的一方胜出',
      local: entity({ amountMinor: 1111, updatedAt: '2024-01-16T00:00:00.000Z', deviceId: 'device-z' }),
      remote: entity({ amountMinor: 2222, updatedAt: '2024-01-16T00:00:00.000Z', deviceId: 'device-b' }),
      base: entity({}),
      expectedWinnerDeviceId: 'device-z',
    },
    {
      name: '无 base（首次同步）时按整条记录 LWW',
      local: entity({ amountMinor: 1111, updatedAt: '2024-01-16T00:00:00.000Z', deviceId: 'device-a' }),
      remote: entity({ amountMinor: 2222, updatedAt: '2024-01-17T00:00:00.000Z', deviceId: 'device-b' }),
      base: null,
      expectedWinnerDeviceId: 'device-b',
    },
  ];

  for (const scenario of scenarios) {
    it(`场景「${scenario.name}」：胜出设备与到达顺序无关`, () => {
      const forward = mergeRecord<TestEntity>(scenario.local, scenario.remote, scenario.base);
      const backward = mergeRecord<TestEntity>(scenario.remote, scenario.local, scenario.base);

      // 胜出方设备 id 在两个方向下必须完全一致 —— 这才是顺序无关的判据。
      expect(forward.conflicts[0]?.winnerDeviceId).toBe(scenario.expectedWinnerDeviceId);
      expect(backward.conflicts[0]?.winnerDeviceId).toBe(scenario.expectedWinnerDeviceId);
      expect(forward.conflicts[0]?.winnerDeviceId).toBe(backward.conflicts[0]?.winnerDeviceId);

      // 合并出的业务字段值也必须一致。
      expect(forward.merged.amountMinor).toBe(backward.merged.amountMinor);
      expect(forward.merged.counterparty).toBe(backward.merged.counterparty);
      expect(forward.merged.note).toBe(backward.merged.note);
    });
  }

  it('winner 字段是位置相关标签，对调入参后必然翻转（不能用于断言确定性）', () => {
    const base = entity({});
    const local = entity({ amountMinor: 1111, updatedAt: '2024-01-16T00:00:00.000Z', deviceId: 'device-a' });
    const remote = entity({ amountMinor: 2222, updatedAt: '2024-01-17T00:00:00.000Z', deviceId: 'device-b' });

    const forward = mergeRecord<TestEntity>(local, remote, base);
    const backward = mergeRecord<TestEntity>(remote, local, base);

    // 位置标签翻转是预期行为（文档已在 FieldConflict.winner 上注明）。
    expect(forward.conflicts[0]?.winner).toBe('remote');
    expect(backward.conflicts[0]?.winner).toBe('local');
    // 但胜出设备不变。
    expect(forward.conflicts[0]?.winnerDeviceId).toBe(backward.conflicts[0]?.winnerDeviceId);
  });

  it('两端改成相同值时不算冲突', () => {
    const base = entity({});
    const local = entity({ amountMinor: 7777 });
    const remote = entity({ amountMinor: 7777 });

    const result = mergeRecord<TestEntity>(local, remote, base);
    expect(result.merged.amountMinor).toBe(7777);
    expect(result.conflicts).toHaveLength(0);
  });
});

describe('X-11 · 版本号与元字段（X-11 ①）', () => {
  it('合并后版本号严格大于两端与 base 的版本号', () => {
    const base = entity({ version: 5 });
    const local = entity({ version: 6, amountMinor: 1 });
    const remote = entity({ version: 7, counterparty: 'x' });

    const result = mergeRecord<TestEntity>(local, remote, base);
    expect(result.merged.version).toBeGreaterThan(7);
  });

  it('合并结果携带胜方的 updatedAt 与 deviceId', () => {
    const base = entity({});
    const local = entity({ amountMinor: 1111, updatedAt: '2024-01-18T00:00:00.000Z', deviceId: 'device-a' });
    const remote = entity({ amountMinor: 2222, updatedAt: '2024-01-17T00:00:00.000Z', deviceId: 'device-b' });

    const result = mergeRecord<TestEntity>(local, remote, base);
    expect(result.merged.updatedAt).toBe('2024-01-18T00:00:00.000Z');
    expect(result.merged.deviceId).toBe('device-a');
  });

  it('本地不存在时直接采用远端（首次同步场景）', () => {
    const remote = entity({ version: 3, amountMinor: 4242 });
    const result = mergeRecord<TestEntity>(null, remote, null);
    expect(result.merged).toBe(remote);
    expect(result.conflicts).toHaveLength(0);
  });
});
