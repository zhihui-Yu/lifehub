/**
 * 微习惯打卡模块（Module C：C-01 ~ C-04）单元测试与组件测试。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDatabase } from '@/__tests__/helpers/fake-dexie';
import {
  buildYearlyHeatmap,
  computeCombinedPeriodStats,
  computeHabitBadges,
  computeHabitStreak,
  HabitService,
} from '@/modules/habits/habit-service';
import { CompletionEventRepository } from '@/modules/shared/completion-event';
import { HabitsPage } from '@/pages/HabitsPage';
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

describe('Module C —— 连续天数计算黄金用例与边界（C-01）', () => {
  it('黄金用例：1/1, 1/2, 1/4 在参考日 2026-01-04 下 currentStreak === 1 且 longestStreak === 2', () => {
    const result = computeHabitStreak(
      ['2026-01-01', '2026-01-02', '2026-01-04'],
      '2026-01-04',
    );
    expect(result.currentStreak).toBe(1);
    expect(result.longestStreak).toBe(2);
    expect(result.totalCompletedDays).toBe(3);
  });

  it('跨闰年 2 月底连续打卡（2024-02-28, 2024-02-29, 2024-03-01）正确计为连续 3 天', () => {
    const result = computeHabitStreak(
      ['2024-02-28', '2024-02-29', '2024-03-01'],
      '2024-03-01',
    );
    expect(result.currentStreak).toBe(3);
    expect(result.longestStreak).toBe(3);
  });

  it('参考日未打卡时 currentStreak 重置为 0，同时保留历史 longestStreak', () => {
    const result = computeHabitStreak(
      ['2026-01-01', '2026-01-02', '2026-01-03'],
      '2026-01-04',
    );
    expect(result.currentStreak).toBe(0);
    expect(result.longestStreak).toBe(3);
  });
});

describe('Module C —— 热力图、里程碑徽章与跨模块合并统计（C-02 / C-03 / C-04）', () => {
  it('buildYearlyHeatmap 在平年生成 365 格、闰年生成 366 格，并正确计算强度等级', () => {
    const cells2026 = buildYearlyHeatmap(
      ['2026-05-01', '2026-05-01', '2026-05-01'],
      2026,
    );
    expect(cells2026).toHaveLength(365);
    const may1 = cells2026.find((c) => c.localDate === '2026-05-01');
    expect(may1?.count).toBe(3);
    expect(may1?.level).toBe(3);

    const cells2024 = buildYearlyHeatmap(['2024-02-29'], 2024);
    expect(cells2024).toHaveLength(366);
    const feb29 = cells2024.find((c) => c.localDate === '2024-02-29');
    expect(feb29?.count).toBe(1);
    expect(feb29?.level).toBe(1);
  });

  it('computeHabitBadges 根据连续天数解锁对应里程碑徽章', () => {
    const badges = computeHabitBadges({
      currentStreak: 7,
      longestStreak: 7,
      totalCompletedDays: 7,
    });
    const unlockedIds = badges.filter((b) => b.unlocked).map((b) => b.id);
    expect(unlockedIds).toEqual(['streak-1', 'streak-3', 'streak-7']);
  });

  it('computeCombinedPeriodStats 正确合并 schedule 与 habit 的共享 CompletionEvent（C-03）', async () => {
    const db = fakeDbHolder.db as LifeHubDatabase;
    const completionRepo = new CompletionEventRepository(db);
    const service = new HabitService(db, completionRepo);

    const habit = await service.createHabit({ name: '每日冥想' });
    await service.toggleCheckIn(habit.id, '2026-06-03');
    await service.toggleCheckIn(habit.id, '2026-06-04');
    // 课表也在同一周完成 1 次
    await completionRepo.toggle('schedule', 'slot-math', '2026-06-03');

    const weekStats = await service.getPeriodStats('2026-06-04', 'week');
    expect(weekStats.habitCompletedCount).toBe(2);
    expect(weekStats.scheduleCompletedCount).toBe(1);
    expect(weekStats.combinedCompletedCount).toBe(3);
    expect(weekStats.activeDaysCount).toBe(2);

    const allEvents = await completionRepo.listByDateRange('2026-06-01', '2026-06-30');
    const monthStats = computeCombinedPeriodStats(allEvents, 1, '2026-06-04', 'month');
    expect(monthStats.combinedCompletedCount).toBe(3);
  });
});

describe('Module C —— HabitsPage 页面渲染与打卡交互测试', () => {
  it('展示精简打卡列表与周期统计面板（无冗余小标签、里程碑墙与热力图），并支持新增习惯与一键打卡/撤销', async () => {
    render(<HabitsPage />);

    expect(screen.getByTestId('habits-page')).toBeInTheDocument();
    expect(screen.getByTestId('habit-stats-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('habit-heatmap')).not.toBeInTheDocument();
    expect(screen.queryByTestId('habit-badges-section')).not.toBeInTheDocument();

    // 新增习惯
    fireEvent.click(screen.getByTestId('habit-add-button'));
    const nameInput = await screen.findByTestId('habit-input-name');
    fireEvent.change(nameInput, { target: { value: '早起喝温水' } });
    fireEvent.click(screen.getByTestId('habit-save-button'));

    await waitFor(() => {
      expect(screen.getByText('早起喝温水')).toBeInTheDocument();
    });

    // 点击打卡
    const checkInBtn = screen.getByTestId('habit-checkin-toggle');
    fireEvent.click(checkInBtn);

    await waitFor(() => {
      expect(screen.getByText('✓ 已打卡')).toBeInTheDocument();
      expect(screen.getByTestId('stat-habit-completed')).toHaveTextContent('1 次');
    });

    // 再次点击撤销打卡
    fireEvent.click(screen.getByTestId('habit-checkin-toggle'));
    await waitFor(() => {
      expect(screen.getByText('立即打卡')).toBeInTheDocument();
      expect(screen.getByTestId('stat-habit-completed')).toHaveTextContent('0 次');
    });
  });
});
