/**
 * 生活课表与时间块模块（Module B：B-01 ~ B-05）单元测试与组件测试。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDatabase } from '@/__tests__/helpers/fake-dexie';
import {
  expandRRuleDates,
  expandScheduleForDate,
  expandScheduleForRange,
  parseRRule,
  type StoredScheduleSlot,
} from '@/modules/schedule/rrule';
import {
  computeScheduleStats,
  ScheduleService,
} from '@/modules/schedule/schedule-service';
import { CompletionEventRepository } from '@/modules/shared/completion-event';
import { SchedulePage } from '@/pages/SchedulePage';
import type { LifeHubDatabase } from '@/platform/db';

const fakeDbHolder = vi.hoisted(() => ({
  db: null as unknown,
}));

vi.mock('@/platform/db', () => ({
  createDatabase: () => fakeDbHolder.db,
  LifeHubDatabase: class {},
}));

beforeEach(() => {
  fakeDbHolder.db = createFakeDatabase();
});

describe('Module B —— RRULE 解析与跨月/跨年/闰年展开（rrule.ts）', () => {
  it('正确解析 FREQ / INTERVAL / BYDAY / BYMONTHDAY / UNTIL / COUNT', () => {
    const parsed = parseRRule(
      'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;UNTIL=20261231;COUNT=10',
    );
    expect(parsed).toEqual({
      freq: 'WEEKLY',
      interval: 2,
      byDay: [1, 3, 5],
      until: '2026-12-31',
      count: 10,
    });
  });

  it('支持跨月与跨年的 DAILY / WEEKLY 规则展开', () => {
    // 2025-12-29 是周一，2025-12-31 是周三，2026-01-02 是周五
    const dates = expandRRuleDates(
      'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      '2025-12-29',
      '2025-12-29',
      '2026-01-04',
    );
    expect(dates).toEqual(['2025-12-29', '2025-12-31', '2026-01-02']);
  });

  it('正确处理闰年 2024-02-29（DAILY、MONTHLY BYMONTHDAY=29/-1 与 YEARLY）', () => {
    // 1) DAILY 跨越 2024-02-28 至 2024-03-01
    const dailyLeap = expandRRuleDates(
      'FREQ=DAILY',
      '2024-02-28',
      '2024-02-28',
      '2024-03-01',
    );
    expect(dailyLeap).toEqual(['2024-02-28', '2024-02-29', '2024-03-01']);

    // 2) MONTHLY BYMONTHDAY=29：2024 年 2 月有 29 日，2025 年 2 月无 29 日应跳过
    const monthly29 = expandRRuleDates(
      'FREQ=MONTHLY;BYMONTHDAY=29',
      '2024-01-29',
      '2024-02-01',
      '2025-03-31',
    );
    expect(monthly29).toContain('2024-02-29');
    expect(monthly29).not.toContain('2025-02-29');
    expect(monthly29).toContain('2025-03-29');

    // 3) MONTHLY BYMONTHDAY=-1（月末最后一天）：2024-02 为 29 日，2025-02 为 28 日
    const monthlyLast = expandRRuleDates(
      'FREQ=MONTHLY;BYMONTHDAY=-1',
      '2024-01-31',
      '2024-02-01',
      '2025-02-28',
    );
    expect(monthlyLast).toContain('2024-02-29');
    expect(monthlyLast).toContain('2025-02-28');

    // 4) YEARLY 锚定在 2024-02-29：仅闰年命中
    const yearlyLeap = expandRRuleDates(
      'FREQ=YEARLY',
      '2024-02-29',
      '2024-01-01',
      '2028-12-31',
    );
    expect(yearlyLeap).toEqual(['2024-02-29', '2028-02-29']);
  });

  it('墙上时间 HH:mm 原样保留并按字面升序排列，不做 UTC 换算', () => {
    const slots: StoredScheduleSlot[] = [
      {
        id: 'slot-b',
        title: '下午实验课',
        startTime: '14:00',
        endTime: '15:30',
        dayOfWeek: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'slot-a',
        title: '晨间英语',
        startTime: '08:00',
        endTime: '09:00',
        dayOfWeek: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    // 2026-01-05 是周一
    const expanded = expandScheduleForDate(slots, '2026-01-05');
    expect(expanded.map((e) => `${e.startTime}-${e.endTime}:${e.title}`)).toEqual([
      '08:00-09:00:晨间英语',
      '14:00-15:30:下午实验课',
    ]);
  });
});

describe('Module B —— ScheduleService 与完成率统计（B-01 / B-02 / B-05）', () => {
  it('支持时段 CRUD、共享 CompletionEvent 勾选切换与周/月完成率统计（跨月不重复计入）', async () => {
    const db = fakeDbHolder.db as LifeHubDatabase;
    const completionRepo = new CompletionEventRepository(db);
    const service = new ScheduleService(db, completionRepo);

    const slot = await service.createSlot({
      title: '线性代数',
      startTime: '10:00',
      endTime: '11:30',
      rrule: 'FREQ=DAILY',
      validFrom: '2026-01-30',
      validUntil: '2026-02-02',
    });

    // 在 1 月完成 1 次（2026-01-30），在 2 月完成 1 次（2026-02-01）
    await service.toggleSlotCompletion(slot.id, '2026-01-30');
    await service.toggleSlotCompletion(slot.id, '2026-02-01');

    const allSlots = await service.listSlots();
    const allEvents = await completionRepo.listByDateRange('2026-01-01', '2026-02-28');

    // 1 月应完成 2 次（01-30, 01-31），已完成 1 次（01-30），完成率 50%
    const janStats = computeScheduleStats(allSlots, allEvents, '2026-01-01', '2026-01-31');
    expect(janStats.expectedCount).toBe(2);
    expect(janStats.completedCount).toBe(1);
    expect(janStats.completionRate).toBe(50);

    // 2 月应完成 2 次（02-01, 02-02），已完成 1 次（02-01），完成率 50%，1月事件绝不混入2月
    const febStats = computeScheduleStats(allSlots, allEvents, '2026-02-01', '2026-02-28');
    expect(febStats.expectedCount).toBe(2);
    expect(febStats.completedCount).toBe(1);
    expect(febStats.completionRate).toBe(50);

    // 展开区间内状态核对
    const rangeInstances = expandScheduleForRange(allSlots, '2026-01-30', '2026-02-02');
    expect(rangeInstances).toHaveLength(4);
  });
});

describe('Module B —— SchedulePage 组件交互测试（B-01 ~ B-05）', () => {
  it('支持周/日视图切换、新增时段、完成勾选与 A4 打印按钮触发', async () => {
    const printSpy = vi.fn();
    Object.defineProperty(window, 'print', {
      value: printSpy,
      configurable: true,
      writable: true,
    });

    render(<SchedulePage />);

    expect(screen.getByTestId('schedule-page')).toBeInTheDocument();
    expect(screen.getByTestId('schedule-week-grid')).toBeInTheDocument();
    expect(screen.getByTestId('schedule-stats-card')).toBeInTheDocument();

    // 切换到日视图
    fireEvent.click(screen.getByTestId('schedule-view-day'));
    expect(await screen.findByTestId('schedule-day-view')).toBeInTheDocument();

    // 切换回周视图
    fireEvent.click(screen.getByTestId('schedule-view-week'));
    expect(await screen.findByTestId('schedule-week-grid')).toBeInTheDocument();

    // 打开新增时段弹窗并创建一个当天时段
    fireEvent.click(screen.getByTestId('schedule-add-button'));
    const titleInput = await screen.findByTestId('schedule-input-title');
    fireEvent.change(titleInput, { target: { value: '算法导论精读' } });
    fireEvent.click(screen.getByTestId('schedule-save-button'));

    await waitFor(() => {
      expect(screen.getByText('算法导论精读')).toBeInTheDocument();
    });

    // 勾选完成
    const checkboxes = screen.getAllByTestId('schedule-complete-toggle');
    expect(checkboxes.length).toBeGreaterThan(0);
    const firstCheckbox = checkboxes[0]?.querySelector('input') ?? checkboxes[0];
    if (firstCheckbox) {
      fireEvent.click(firstCheckbox);
    }

    // 点击打印按钮
    fireEvent.click(screen.getByTestId('schedule-print-button'));
    expect(printSpy).toHaveBeenCalledTimes(1);
  });
});
