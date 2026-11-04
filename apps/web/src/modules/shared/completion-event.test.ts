/**
 * 共享完成事件仓库测试。
 *
 * 覆盖需求：S4 共享 `CompletionEvent`（课表 B-02 与习惯 C-03 的唯一完成记录来源）。
 *
 * 说明：用假 Dexie 替代真实 IndexedDB（jsdom 不实现 IndexedDB），
 * 验证 `toggle` 的幂等切换、`listBySource` / `listByDateRange` 过滤与级联删除。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDatabase } from '@/__tests__/helpers/fake-dexie';
import {
  CompletionEventRepository,
  type CompletionEvent,
} from '@/modules/shared/completion-event';

// 顶层打桩：让仓库默认使用的 `createDatabase()` 返回内存假库。
vi.mock('@/platform/db', () => ({
  createDatabase: () => createFakeDatabase(),
  LifeHubDatabase: class {},
}));

/** 待测仓库。 */
let repo: CompletionEventRepository;

beforeEach(() => {
  repo = new CompletionEventRepository();
});

describe('CompletionEventRepository.toggle', () => {
  it('首次打勾返回 true 并写入记录', async () => {
    const done = await repo.toggle('schedule', 'slot-1', '2024-06-03');
    expect(done).toBe(true);
    expect(await repo.isCompleted('schedule', 'slot-1', '2024-06-03')).toBe(true);
  });

  it('再次打勾（同来源同天）返回 false 且删除记录，实现幂等', async () => {
    await repo.toggle('schedule', 'slot-1', '2024-06-03');
    const undone = await repo.toggle('schedule', 'slot-1', '2024-06-03');
    expect(undone).toBe(false);
    expect(await repo.isCompleted('schedule', 'slot-1', '2024-06-03')).toBe(false);
  });

  it('不同来源或不同天的记录互不影响', async () => {
    await repo.toggle('schedule', 'slot-1', '2024-06-03');
    await repo.toggle('habit', 'slot-1', '2024-06-03');
    await repo.toggle('schedule', 'slot-1', '2024-06-04');

    expect(await repo.isCompleted('schedule', 'slot-1', '2024-06-03')).toBe(true);
    expect(await repo.isCompleted('habit', 'slot-1', '2024-06-03')).toBe(true);
    expect(await repo.isCompleted('schedule', 'slot-1', '2024-06-04')).toBe(true);
    expect(await repo.isCompleted('schedule', 'slot-2', '2024-06-03')).toBe(false);
  });
});

describe('CompletionEventRepository.listBySource', () => {
  it('仅返回指定来源类型的记录并按 localDate 升序', async () => {
    await repo.toggle('habit', 'h1', '2024-06-05');
    await repo.toggle('habit', 'h1', '2024-06-03');
    await repo.toggle('schedule', 's1', '2024-06-04');

    const events: CompletionEvent[] = await repo.listBySource('habit', 'h1');
    expect(events.map((e) => e.localDate)).toEqual(['2024-06-03', '2024-06-05']);
    expect(events.every((e) => e.sourceType === 'habit' && e.sourceId === 'h1')).toBe(true);
  });
});

describe('CompletionEventRepository.listByDateRange', () => {
  it('返回闭区间内的全部记录', async () => {
    await repo.toggle('schedule', 's1', '2024-06-01');
    await repo.toggle('schedule', 's1', '2024-06-10');
    await repo.toggle('schedule', 's1', '2024-06-15');

    const events = await repo.listByDateRange('2024-06-01', '2024-06-10');
    expect(events.map((e) => e.localDate)).toEqual(['2024-06-01', '2024-06-10']);
  });
});

describe('CompletionEventRepository.deleteBySource', () => {
  it('删除某来源的全部完成事件，不影响其他来源', async () => {
    await repo.toggle('schedule', 's1', '2024-06-01');
    await repo.toggle('schedule', 's1', '2024-06-02');
    await repo.toggle('habit', 'h1', '2024-06-01');

    await repo.deleteBySource('schedule', 's1');

    expect(await repo.isCompleted('schedule', 's1', '2024-06-01')).toBe(false);
    expect(await repo.isCompleted('schedule', 's1', '2024-06-02')).toBe(false);
    expect(await repo.isCompleted('habit', 'h1', '2024-06-01')).toBe(true);
  });
});
