/**
 * 账单编辑对话框测试。
 *
 * 覆盖：新增模式收集 ManualBillInput；编辑模式回填字段；提交产出正确结构。
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bill, Category } from '@lifehub/core';
import { BillEditDialog } from '@/components/bills/BillEditDialog';
import { useSettingsStore } from '@/store/settings-store';

const CATEGORIES: Category[] = [
  { id: 'c1', name: '餐饮', kind: 'expense', parentId: null, color: '#DC2626', icon: 'restaurant', isSystem: true, sortOrder: 100, createdAt: '2023-01-01T00:00:00.000Z', updatedAt: '2023-01-01T00:00:00.000Z', version: 1, deviceId: 'seed' },
];

describe('BillEditDialog', () => {
  beforeEach(() => {
    useSettingsStore.getState().setTimezone('Asia/Shanghai');
  });
  it('新增模式：提交收集到正确的 ManualBillInput（金额恒正、方向独立、未分类为 null）', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<BillEditDialog open initial={null} categories={CATEGORIES} onClose={() => {}} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2024-05-20' } });
    fireEvent.change(screen.getByLabelText('金额（元）'), { target: { value: '12.34' } });
    fireEvent.click(screen.getByRole('button', { name: '记一笔' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    const input = onSubmit.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      date: '2024-05-20',
      amountText: '12.34',
      direction: 'expense',
      categoryId: null,
      counterparty: '',
      note: '',
    });
  });

  it('编辑模式：回填金额 / 对方，并提交更新', async () => {
    const existing: Bill = {
      id: 'b1',
      amountMinor: 3550,
      currency: 'CNY',
      direction: 'income',
      occurredAt: '2024-01-15T00:00:00.000Z',
      localDate: '2024-01-15',
      sourceTimeZone: 'Asia/Shanghai',
      counterparty: '星巴克',
      categoryId: 'c1',
      note: '拿铁',
      sourceFileId: 'manual-entry',
      sourceRowIndex: 0,
      createdAt: '2024-01-15T00:00:00.000Z',
      updatedAt: '2024-01-15T00:00:00.000Z',
      version: 1,
      deviceId: 'local-device',
    };
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<BillEditDialog open initial={existing} categories={CATEGORIES} onClose={() => {}} onSubmit={onSubmit} />);

    const amountInput = (await screen.findByLabelText('金额（元）')) as HTMLInputElement;
    expect(amountInput.value).toBe('35.5');
    expect((screen.getByLabelText('交易对方') as HTMLInputElement).value).toBe('星巴克');
    expect((screen.getByLabelText('日期') as HTMLInputElement).value).toBe('2024-01-15');

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    const input = onSubmit.mock.calls[0]?.[0];
    expect(input.amountText).toBe('35.5');
    expect(input.direction).toBe('income');
    expect(input.categoryId).toBe('c1');
  });

  it('提交失败时回显中文错误并保持对话框打开', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('金额格式不正确'));
    render(<BillEditDialog open initial={null} categories={CATEGORIES} onClose={() => {}} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2024-05-20' } });
    fireEvent.change(screen.getByLabelText('金额（元）'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: '记一笔' }));

    await waitFor(() => {
      expect(screen.getByText('金额格式不正确')).toBeInTheDocument();
    });
  });

  it('编辑模式：切换设置中的默认时区（如 America/New_York 或 Asia/Tokyo）时，日期与墙钟时间按设置时区精准回填（T-Timezone-Unify-1）', async () => {
    useSettingsStore.getState().setTimezone('America/New_York');
    // 2026-10-20T05:30:00.000Z 在纽约时间（EDT, UTC-4）是 2026-10-20 01:30，而在北京时间（UTC+8）是 13:30
    const nyBill: Bill = {
      id: 'b-ny',
      amountMinor: 2500,
      currency: 'CNY',
      direction: 'expense',
      occurredAt: '2026-10-20T05:30:00.000Z',
      localDate: '2026-10-20',
      sourceTimeZone: 'America/New_York',
      counterparty: 'New York Cafe',
      categoryId: 'c1',
      note: 'Coffee',
      sourceFileId: 'manual-entry',
      sourceRowIndex: 0,
      createdAt: '2026-10-20T05:30:00.000Z',
      updatedAt: '2026-10-20T05:30:00.000Z',
      version: 1,
      deviceId: 'local-device',
    };

    render(
      <BillEditDialog
        open
        initial={nyBill}
        categories={CATEGORIES}
        onClose={() => {}}
        onSubmit={vi.fn().mockResolvedValue(true)}
      />,
    );

    expect((await screen.findByLabelText('日期') as HTMLInputElement).value).toBe('2026-10-20');
    expect((screen.getByLabelText('时间（可选）') as HTMLInputElement).value).toBe('01:30');
  });
});
