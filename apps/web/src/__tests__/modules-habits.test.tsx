/**
 * 微习惯打卡模块（Module C：C-01 ~ C-04 及定量累加与周/月/年统计）单元测试与组件测试。
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
  mergeHabitCheckInPair,
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

  it('定量累加习惯（喝水多次 ml 累加 + 跑步小数 km）每天完成计 1 次，且正确汇总周/月/年累计总量', async () => {
    const db = fakeDbHolder.db as LifeHubDatabase;
    const completionRepo = new CompletionEventRepository(db);
    const service = new HabitService(db, completionRepo);

    const water = await service.createHabit({
      name: '喝水',
      unit: 'ml',
      trackingMode: 'quantity',
      defaultIncrement: 250,
      dailyTarget: 2000,
    });
    const run = await service.createHabit({
      name: '跑步',
      unit: 'km',
      trackingMode: 'quantity',
      dailyTarget: 5,
    });

    // 2026-06-03 同一天喝水累加 3 次：250 + 250 + 300 = 800 ml，当天完成只计 1 次
    await service.addQuantityCheckIn(water.id, 250, '2026-06-03');
    await service.addQuantityCheckIn(water.id, 250, '2026-06-03');
    const day1Water = await service.addQuantityCheckIn(water.id, 300, '2026-06-03');
    expect(day1Water.value).toBe(800);
    expect(day1Water.entries).toHaveLength(3);

    // 2026-06-04 再喝 1200 ml
    await service.addQuantityCheckIn(water.id, 1200, '2026-06-04');

    // 跑步：6/3 跑 3 km，6/4 跑 3.5 km（跨周再加一条 5/10 跑 4.2 km 测试月/年区分）
    await service.addQuantityCheckIn(run.id, 3, '2026-06-03');
    await service.addQuantityCheckIn(run.id, 3.5, '2026-06-04');
    await service.addQuantityCheckIn(run.id, 4.2, '2026-05-10');

    // 验证参考日 2026-06-04 状态与连续天数
    const listOnJune4 = await service.listHabitsWithStats('2026-06-04');
    const waterItem = listOnJune4.find((x) => x.habit.id === water.id);
    const runItem = listOnJune4.find((x) => x.habit.id === run.id);

    expect(waterItem?.refDateValue).toBe(1200);
    expect(waterItem?.streak.currentStreak).toBe(2);
    expect(waterItem?.streak.totalCompletedDays).toBe(2); // 同一天多次喝水仍计 1 天
    expect(waterItem?.totalQuantityAllTime).toBe(2000);

    expect(runItem?.refDateValue).toBe(3.5);
    expect(runItem?.streak.currentStreak).toBe(2);
    expect(runItem?.streak.totalCompletedDays).toBe(3);
    expect(runItem?.totalQuantityAllTime).toBe(10.7);

    // 周统计（2026-06-04 所在周）：喝水 2 天共 2000 ml，跑步 2 天共 6.5 km，总打卡完成次数 = 4 次（2+2）
    const weekStats = await service.getPeriodStats('2026-06-04', 'week');
    expect(weekStats.habitCompletedCount).toBe(4);
    const weekWater = weekStats.habitSummaries.find((s) => s.habitId === water.id);
    const weekRun = weekStats.habitSummaries.find((s) => s.habitId === run.id);
    expect(weekWater?.completedDays).toBe(2);
    expect(weekWater?.totalQuantity).toBe(2000);
    expect(weekWater?.averagePerCompletedDay).toBe(1000);
    expect(weekRun?.completedDays).toBe(2);
    expect(weekRun?.totalQuantity).toBe(6.5);
    expect(weekRun?.averagePerCompletedDay).toBe(3.25);

    // 年统计（2026 全年）：跑步包含 5/10 的 4.2 km，共 3 天 10.7 km
    const yearStats = await service.getPeriodStats('2026-06-04', 'year');
    const yearRun = yearStats.habitSummaries.find((s) => s.habitId === run.id);
    expect(yearRun?.completedDays).toBe(3);
    expect(yearRun?.totalQuantity).toBe(10.7);

    // 验证单条明细撤销：删掉 6/3 的一笔 300 ml 后变为 500 ml，仍处于已打卡
    const thirdEntryId = day1Water.entries?.[2]?.id ?? '';
    const afterRemove = await service.removeQuantityEntry(water.id, thirdEntryId, '2026-06-03');
    expect(afterRemove?.value).toBe(500);

    // 多端同日累加合并测试：手机记了 e1(250)，桌面记了 e2(350)，合并后无损得到 600
    const mergedCi = mergeHabitCheckInPair(
      {
        id: 'habit:h1:2026-06-05',
        habitId: 'h1',
        localDate: '2026-06-05',
        completedAt: '2026-06-05T01:00:00.000Z',
        updatedAt: '2026-06-05T01:00:00.000Z',
        value: 250,
        entries: [{ id: 'e1', amount: 250, createdAt: '2026-06-05T01:00:00.000Z' }],
      },
      {
        id: 'habit:h1:2026-06-05',
        habitId: 'h1',
        localDate: '2026-06-05',
        completedAt: '2026-06-05T04:00:00.000Z',
        updatedAt: '2026-06-05T04:00:00.000Z',
        value: 350,
        entries: [{ id: 'e2', amount: 350, createdAt: '2026-06-05T04:00:00.000Z' }],
      },
    );
    expect(mergedCi.value).toBe(600);
    expect(mergedCi.entries).toHaveLength(2);
  });
});

describe('Module C —— HabitsPage 页面渲染与打卡交互测试', () => {
  it('支持普通单次打卡习惯与定量累加习惯（一键 +250ml 及小数输入）以及周/月/年累计面板展示', async () => {
    render(<HabitsPage />);

    expect(screen.getByTestId('habits-page')).toBeInTheDocument();
    expect(screen.getByTestId('habit-stats-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('habit-heatmap')).not.toBeInTheDocument();
    expect(screen.queryByTestId('habit-badges-section')).not.toBeInTheDocument();

    // 1. 新增普通单次习惯并打卡/撤销
    fireEvent.click(screen.getByTestId('habit-add-button'));
    const nameInput = await screen.findByTestId('habit-input-name');
    fireEvent.change(nameInput, { target: { value: '早起喝温水' } });
    fireEvent.click(screen.getByTestId('habit-save-button'));

    await waitFor(() => {
      expect(screen.getByText('早起喝温水')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('habit-checkin-toggle'));
    await waitFor(() => {
      expect(screen.getByText('✓ 已打卡')).toBeInTheDocument();
      expect(screen.getByTestId('stat-habit-completed')).toHaveTextContent('1 次');
    });

    fireEvent.click(screen.getByTestId('habit-checkin-toggle'));
    await waitFor(() => {
      expect(screen.getByText('立即打卡')).toBeInTheDocument();
      expect(screen.getByTestId('stat-habit-completed')).toHaveTextContent('0 次');
    });

    // 2. 新增定量累加习惯（喝水 250 ml / 目标 2000 ml）并连续点击两次 +250 ml
    fireEvent.click(screen.getByTestId('habit-add-button'));
    fireEvent.click(await screen.findByTestId('habit-mode-quantity'));
    fireEvent.change(screen.getByTestId('habit-input-name'), { target: { value: '全天饮水' } });
    fireEvent.change(screen.getByTestId('habit-input-unit'), { target: { value: 'ml' } });
    fireEvent.change(screen.getByTestId('habit-input-increment'), { target: { value: '250' } });
    fireEvent.change(screen.getByTestId('habit-input-target'), { target: { value: '2000' } });
    fireEvent.click(screen.getByTestId('habit-save-button'));

    const quickAddBtn = await screen.findByText('+250 ml');
    fireEvent.click(quickAddBtn);
    await waitFor(() => {
      expect(screen.getByText('✓ 250/2000 ml')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('+250 ml'));
    await waitFor(() => {
      expect(screen.getByText('✓ 500/2000 ml')).toBeInTheDocument();
      // 同一天点两次 +250 ml，完成次数仍算 1 次
      expect(screen.getByTestId('stat-habit-completed')).toHaveTextContent('1 次');
    });

    // 展开周期统计面板，验证各习惯周/月/年累计总量展示
    fireEvent.click(screen.getByTestId('toggle-habit-stats'));
    await waitFor(() => {
      expect(screen.getByTestId('habit-period-breakdown')).toHaveTextContent('共 500 ml');
    });
  });
});
