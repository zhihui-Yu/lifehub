/**
 * 账单过滤栏组件测试。
 *
 * 覆盖需求：A-09 ② —— 搜索 / 方向 / 日期区间 / 分类可组合筛选，并提供一键清空。
 *
 * 说明：这里验证的是**组件与 store 的契约**（每个控件改的是哪个字段、
 * 清空按钮回调什么），组合筛选的端到端效果在 `bills-filter.test.tsx` 里验证。
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BillFilterBar } from '@/components/bills/BillFilterBar';
import { EMPTY_FILTERS } from '@/store/bill-store';

describe('BillFilterBar', () => {
  it('搜索框输入会回调 keyword 变更', () => {
    const onChange = vi.fn();
    render(<BillFilterBar filters={EMPTY_FILTERS} onChange={onChange} onClear={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('搜索对方或备注'), { target: { value: '星巴克' } });

    expect(onChange).toHaveBeenCalledWith({ keyword: '星巴克' });
  });

  it('方向下拉回调 directions 变更（选「全部方向」时清空数组）', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <BillFilterBar filters={EMPTY_FILTERS} onChange={onChange} onClear={vi.fn()} />,
    );

    const select = screen.getByLabelText('收支方向');
    fireEvent.mouseDown(select);
    fireEvent.click(screen.getByRole('option', { name: '收入' }));
    expect(onChange).toHaveBeenCalledWith({ directions: ['income'] });

    // 已选中「收入」时再选「全部方向」，才会产生一次「清空」变更。
    onChange.mockClear();
    rerender(<BillFilterBar filters={{ ...EMPTY_FILTERS, directions: ['income'] }} onChange={onChange} onClear={vi.fn()} />);
    fireEvent.mouseDown(screen.getByLabelText('收支方向'));
    fireEvent.click(screen.getByRole('option', { name: '全部方向' }));
    expect(onChange).toHaveBeenCalledWith({ directions: [] });
  });

  it('日期区间分别回调 dateFrom 与 dateTo', () => {
    const onChange = vi.fn();
    render(<BillFilterBar filters={EMPTY_FILTERS} onChange={onChange} onClear={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2024-01-01' } });
    expect(onChange).toHaveBeenCalledWith({ dateFrom: '2024-01-01' });

    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2024-01-31' } });
    expect(onChange).toHaveBeenCalledWith({ dateTo: '2024-01-31' });
  });

  it('分类下拉支持单选与多选，回调 categoryIds 与 categoryId 变更', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <BillFilterBar
        filters={EMPTY_FILTERS}
        onChange={onChange}
        onClear={vi.fn()}
        categoryOptions={[
          { id: 'cat-food', name: '餐饮' },
          { id: 'cat-transport', name: '交通' },
        ]}
      />,
    );

    const select = screen.getByLabelText('分类');
    fireEvent.mouseDown(select);
    fireEvent.click(screen.getByRole('option', { name: '餐饮' }));

    expect(onChange).toHaveBeenCalledWith({
      categoryId: 'cat-food',
      categoryIds: ['cat-food'],
    });

    // 已选「餐饮」后再勾选「交通」，形成多选数组 ['cat-food', 'cat-transport']
    onChange.mockClear();
    rerender(
      <BillFilterBar
        filters={{ ...EMPTY_FILTERS, categoryId: 'cat-food', categoryIds: ['cat-food'] }}
        onChange={onChange}
        onClear={vi.fn()}
        categoryOptions={[
          { id: 'cat-food', name: '餐饮' },
          { id: 'cat-transport', name: '交通' },
        ]}
      />,
    );
    fireEvent.mouseDown(screen.getByLabelText('分类'));
    fireEvent.click(screen.getByRole('option', { name: '交通' }));
    expect(onChange).toHaveBeenCalledWith({
      categoryId: '',
      categoryIds: ['cat-food', 'cat-transport'],
    });

    // 点击「全部分类」清空多选
    onChange.mockClear();
    rerender(
      <BillFilterBar
        filters={{ ...EMPTY_FILTERS, categoryIds: ['cat-food', 'cat-transport'] }}
        onChange={onChange}
        onClear={vi.fn()}
        categoryOptions={[
          { id: 'cat-food', name: '餐饮' },
          { id: 'cat-transport', name: '交通' },
        ]}
      />,
    );
    fireEvent.mouseDown(screen.getByLabelText('分类'));
    fireEvent.click(screen.getByRole('option', { name: '全部分类' }));
    expect(onChange).toHaveBeenCalledWith({
      categoryId: '',
      categoryIds: [],
    });
  });

  it('「清空筛选」按钮触发清空回调', () => {
    const onClear = vi.fn();
    render(<BillFilterBar filters={EMPTY_FILTERS} onChange={vi.fn()} onClear={onClear} />);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '清空筛选' }));
    });

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('当前过滤条件被回显到各控件', () => {
    render(
      <BillFilterBar
        filters={{
          keyword: '星巴克',
          directions: ['expense'],
          dateFrom: '2024-01-01',
          dateTo: '2024-01-31',
          categoryId: 'cat-food',
        }}
        onChange={vi.fn()}
        onClear={vi.fn()}
        categoryOptions={[{ id: 'cat-food', name: '餐饮' }]}
      />,
    );

    expect(screen.getByLabelText('搜索对方或备注')).toHaveValue('星巴克');
    expect(screen.getByLabelText('开始日期')).toHaveValue('2024-01-01');
    expect(screen.getByLabelText('结束日期')).toHaveValue('2024-01-31');
  });
});
