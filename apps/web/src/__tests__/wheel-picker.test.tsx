/**
 * 极简纯滚轮时间/日期选择器单元测试与交互测试。
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

describe('wheel-picker-utils 纯函数测试', () => {
  it('规范格式化 HH:mm 并在开始时间越过结束时间时自动顺延', () => {
    expect(parseHm('9:05')).toEqual({ hour: 9, minute: 5 });
    expect(formatHm(7, 5)).toBe('07:05');

    expect(adjustTimeRangeOnStartChange('14:00', '09:00', '10:30')).toEqual({
      startTime: '14:00',
      endTime: '15:30',
    });
    expect(adjustTimeRangeOnStartChange('23:59', '09:00', '10:30')).toEqual({
      startTime: '23:58',
      endTime: '23:59',
    });
    expect(clampEndTimeAfterStart('15:00', '14:30')).toBe('15:05');
  });

  it('准确处理闰年 2 月与大小月天数', () => {
    expect(getDaysInYearMonth(2024, 2)).toBe(29);
    expect(getDaysInYearMonth(2025, 2)).toBe(28);
    expect(formatYmd(2025, 2, 31)).toBe('2025-02-28');
    expect(normalizeDateRangeOrder('2026-11-25', '2026-11-01')).toEqual({
      dateFrom: '2026-11-01',
      dateTo: '2026-11-25',
    });
  });
});

describe('极简滚轮选择组件交互测试', () => {
  it('课表新增时段：点击开始/结束弹出纯双列滚轮选择并保存', async () => {
    render(<SchedulePage />);

    fireEvent.click(screen.getByTestId('schedule-add-button'));
    const titleInput = await screen.findByTestId('schedule-input-title');
    fireEvent.change(titleInput, { target: { value: '晨间阅读' } });

    const startInput = screen.getByTestId('schedule-input-start') as HTMLInputElement;
    expect(startInput).toHaveAttribute('readonly');

    fireEvent.click(startInput);
    expect(await screen.findByTestId('wheel-time-popover')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('wheel-col-hour-opt-7'));
    fireEvent.click(screen.getByTestId('wheel-col-minute-opt-30'));
    expect(startInput.value).toBe('07:30');

    fireEvent.click(screen.getByTestId('schedule-save-button'));
    await waitFor(() => {
      expect(screen.getByText('晨间阅读')).toBeInTheDocument();
      expect(screen.getByText('07:30-10:30')).toBeInTheDocument();
    });
  });

  it('过滤栏日期：点击开始日期弹出纯三列年月日滚轮并回填', async () => {
    const onChange = vi.fn();
    render(<BillFilterBar filters={EMPTY_FILTERS} onChange={onChange} onClear={vi.fn()} />);

    const fromInput = screen.getByLabelText('开始日期');
    expect(fromInput).toHaveAttribute('readonly');
    fireEvent.click(fromInput);

    expect(await screen.findByTestId('wheel-date-popover')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('wheel-col-day-opt-15'));

    expect(onChange).toHaveBeenCalled();
    const arg = onChange.mock.calls[0]?.[0] as { dateFrom?: string } | undefined;
    expect(arg?.dateFrom).toMatch(/^\d{4}-\d{2}-15$/);
  });

  it('记一笔弹窗：点击时间弹出纯双列滚轮选择并提交', async () => {
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

    fireEvent.change(screen.getByLabelText('金额（元）'), { target: { value: '18' } });
    fireEvent.click(screen.getByLabelText('时间（可选）'));
    expect(await screen.findByTestId('wheel-time-popover')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('wheel-col-hour-opt-18'));
    fireEvent.click(screen.getByTestId('wheel-col-minute-opt-45'));

    fireEvent.click(screen.getByRole('button', { name: '记一笔' }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0]?.[0]?.time).toBe('18:45');
  });
});
