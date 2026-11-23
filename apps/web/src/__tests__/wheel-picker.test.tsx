/**
 * 滚轮时间/日期/时间段选择器单元测试与页面集成测试。
 *
 * 覆盖：
 * 1. `wheel-picker-utils`：时分格式化、开始/结束时间联动顺延、闰年大小月天数钳制、日期区间倒序自动纠正；
 * 2. `SchedulePage`：新增时段弹窗内点击起止时间展开 24 小时滚轮拨盘、时长预设与滚轮点击选择（无需手动输入，零格式错误）；
 * 3. `BillFilterBar`：点击开始日期/结束日期唤起三列日期滚轮时间段弹窗、快捷时间段胶囊与区间确认回填；
 * 4. `BillEditDialog`：点击日期与时间（可选）内嵌展开滚轮选择并正确提交。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Category } from '@lifehub/core';
import { createFakeDatabase } from '@/__tests__/helpers/fake-dexie';
import { BillEditDialog } from '@/components/bills/BillEditDialog';
import { BillFilterBar } from '@/components/bills/BillFilterBar';
import {
  adjustTimeRangeOnStartChange,
  clampEndTimeAfterStart,
  formatDurationLabel,
  formatHm,
  formatYmd,
  getDaysInYearMonth,
  normalizeDateRangeOrder,
  parseHm,
} from '@/components/common/wheel-picker-utils';
import { SchedulePage } from '@/pages/SchedulePage';
import { EMPTY_FILTERS } from '@/store/bill-store';

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

describe('wheel-picker-utils 纯函数边界测试', () => {
  it('规范解析与格式化 HH:mm（含中文冒号与单位数小时兼容）', () => {
    expect(parseHm('9:05')).toEqual({ hour: 9, minute: 5 });
    expect(parseHm('14：30')).toEqual({ hour: 14, minute: 30 });
    expect(parseHm('invalid', '08:15')).toEqual({ hour: 8, minute: 15 });
    expect(formatHm(7, 5)).toBe('07:05');
  });

  it('调整开始时间超过原结束时间时按原时长自动顺延，并保证不越过 23:59', () => {
    // 原时段 09:00 ~ 10:30（90 分钟），将开始拨到 14:00 -> 自动顺延至 15:30
    expect(adjustTimeRangeOnStartChange('14:00', '09:00', '10:30')).toEqual({
      startTime: '14:00',
      endTime: '15:30',
    });

    // 原时段 09:00 ~ 10:30，将开始拨到 09:30（仍早于 10:30） -> 保持 10:30 不变
    expect(adjustTimeRangeOnStartChange('09:30', '09:00', '10:30')).toEqual({
      startTime: '09:30',
      endTime: '10:30',
    });

    // 极端深夜边界：将开始拨到 23:59 -> 自动钳制为 23:58 ~ 23:59，绝不产生非法区间
    expect(adjustTimeRangeOnStartChange('23:59', '09:00', '10:30')).toEqual({
      startTime: '23:58',
      endTime: '23:59',
    });

    expect(clampEndTimeAfterStart('15:00', '14:30')).toBe('15:05');
    expect(formatDurationLabel('09:00', '10:30')).toBe('1小时30分');
  });

  it('准确计算闰年 2 月与大小月天数，并自动纠正倒序起止日期', () => {
    expect(getDaysInYearMonth(2024, 2)).toBe(29);
    expect(getDaysInYearMonth(2025, 2)).toBe(28);
    expect(getDaysInYearMonth(2026, 4)).toBe(30);
    expect(formatYmd(2025, 2, 31)).toBe('2025-02-28');
    expect(formatYmd(2024, 2, 31)).toBe('2024-02-29');

    expect(normalizeDateRangeOrder('2026-11-25', '2026-11-01')).toEqual({
      dateFrom: '2026-11-01',
      dateTo: '2026-11-25',
    });
  });
});

describe('SchedulePage 时间段滚轮交互测试', () => {
  it('新增时段弹窗通过滚轮与时长预设选择起止时间并成功保存', async () => {
    render(<SchedulePage />);

    fireEvent.click(screen.getByTestId('schedule-add-button'));
    const titleInput = await screen.findByTestId('schedule-input-title');
    fireEvent.change(titleInput, { target: { value: '晨间跑步训练' } });

    const startInput = screen.getByTestId('schedule-input-start') as HTMLInputElement;
    const endInput = screen.getByTestId('schedule-input-end') as HTMLInputElement;
    expect(startInput).toHaveAttribute('readonly');
    expect(endInput).toHaveAttribute('readonly');

    // 点击「开始」展开双列滚轮，点选 07 时 30 分
    fireEvent.click(startInput);
    expect(await screen.findByTestId('schedule-time-wheel-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('wheel-col-hour-opt-7'));
    fireEvent.click(screen.getByTestId('wheel-col-minute-opt-30'));
    expect(startInput.value).toBe('07:30');

    // 切换到「结束」侧，点击「+1小时」快捷时长胶囊 -> 08:30
    fireEvent.click(screen.getByTestId('wheel-tab-end'));
    fireEvent.click(screen.getByTestId('wheel-quick-duration-60'));
    expect(endInput.value).toBe('08:30');
    expect(screen.getByTestId('time-range-duration-badge')).toHaveTextContent('1小时');

    fireEvent.click(screen.getByTestId('wheel-time-done'));
    fireEvent.click(screen.getByTestId('schedule-save-button'));

    await waitFor(() => {
      expect(screen.getByText('晨间跑步训练')).toBeInTheDocument();
      expect(screen.getByText('07:30-08:30')).toBeInTheDocument();
    });
  });
});

describe('BillFilterBar 日期时间段滚轮弹窗测试', () => {
  it('点击开始日期唤起三列滚轮弹窗，支持快捷胶囊与滚轮选择并回填区间', async () => {
    const onChange = vi.fn();
    render(<BillFilterBar filters={EMPTY_FILTERS} onChange={onChange} onClear={vi.fn()} />);

    const fromInput = screen.getByLabelText('开始日期');
    expect(fromInput).toHaveAttribute('readonly');
    fireEvent.click(fromInput);

    expect(await screen.findByTestId('wheel-date-range-dialog')).toBeInTheDocument();

    // 点击「本月」快捷胶囊并确定
    fireEvent.click(screen.getByTestId('range-preset-this-month'));
    fireEvent.click(screen.getByTestId('range-wheel-confirm'));

    expect(onChange).toHaveBeenCalledTimes(1);
    const applied = onChange.mock.calls[0]?.[0] as { dateFrom: string; dateTo: string } | undefined;
    expect(applied?.dateFrom).toMatch(/^\d{4}-\d{2}-01$/);
    expect(applied?.dateTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('BillEditDialog 记一笔内嵌日期与时间滚轮测试', () => {
  it('支持通过滚轮点选日期与时间并提交标准格式', async () => {
    const categories: Category[] = [];
    const onSubmit = vi.fn().mockResolvedValue(true);

    render(
      <BillEditDialog
        open
        initial={null}
        categories={categories}
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText('金额（元）'), { target: { value: '26.5' } });

    // 点击时间输入框展开时分滚轮，选择 18:45
    fireEvent.click(screen.getByLabelText('时间（可选）'));
    expect(await screen.findByTestId('bill-datetime-wheel-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('bill-wheel-hour-opt-18'));
    fireEvent.click(screen.getByTestId('bill-wheel-minute-opt-45'));

    fireEvent.click(screen.getByRole('button', { name: '记一笔' }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0]?.[0]?.time).toBe('18:45');
  });
});
