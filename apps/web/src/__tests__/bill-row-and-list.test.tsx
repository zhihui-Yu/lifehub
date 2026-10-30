/**
 * 账单行与虚拟列表组件测试。
 *
 * 覆盖需求：A-09 ③（组内每行展示日期、金额含方向标识、交易对方、分类、来源文件）。
 *
 * 说明：`@tanstack/react-virtual` 依赖真实滚动容器尺寸，jsdom 里拿不到，
 * 这里把 `useVirtualizer` 换成「全量渲染」的替身，
 * 但**保留 BillRow 的真实渲染**，因此断言的是行内每一列的真实内容。
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Bill } from '@lifehub/core';
import { BillRow } from '@/components/bills/BillRow';
import { BillVirtualList } from '@/components/bills/BillVirtualList';
import { makeBill } from '@/__tests__/test-utils/fixtures';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 44,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 44, size: 44 })),
  }),
}));

describe('BillRow', () => {
  it('展示日期、金额（含方向标识）、交易对方、分类与来源文件', () => {
    const bill = makeBill({
      amountMinor: 3550,
      direction: 'expense',
      localDate: '2024-01-15',
      counterparty: '星巴克',
      note: '拿铁',
    });

    render(<BillRow bill={bill} categoryNames={{}} sourceFileNames={{}} />);

    expect(screen.getByText('2024-01-15')).toBeInTheDocument();
    expect(screen.getByText('支出 ¥35.50')).toBeInTheDocument();
    expect(screen.getByText('星巴克')).toBeInTheDocument();
    expect(screen.getByText('未分类')).toBeInTheDocument();
    // 没有来源文件映射时显示占位符。
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('有分类映射时展示分类名，没有映射时回落为「未分类」', () => {
    const bill = makeBill({ categoryId: 'cat-food' });

    const { rerender } = render(
      <BillRow bill={bill} categoryNames={{ 'cat-food': '餐饮' }} sourceFileNames={{ 'batch-1': '微信支付.csv' }} />,
    );
    expect(screen.getByText('餐饮')).toBeInTheDocument();
    expect(screen.getByText('微信支付.csv')).toBeInTheDocument();

    rerender(<BillRow bill={bill} categoryNames={{}} sourceFileNames={{}} />);
    expect(screen.getByText('未分类')).toBeInTheDocument();
  });

  it('交易对方为空时显示占位符', () => {
    const bill = makeBill({ counterparty: '' });
    render(<BillRow bill={bill} categoryNames={{}} sourceFileNames={{}} />);

    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('BillVirtualList', () => {
  it('逐条渲染账单行', () => {
    const bills: Bill[] = [
      makeBill({ id: 'b1', counterparty: '星巴克' }),
      makeBill({ id: 'b2', counterparty: '便利店' }),
      makeBill({ id: 'b3', counterparty: '工资' }),
    ];

    render(<BillVirtualList bills={bills} categoryNames={{}} sourceFileNames={{}} />);

    expect(screen.getByTestId('bill-virtual-list')).toBeInTheDocument();
    expect(screen.getAllByTestId('bill-row')).toHaveLength(3);
    expect(screen.getByText('星巴克')).toBeInTheDocument();
    expect(screen.getByText('便利店')).toBeInTheDocument();
    expect(screen.getByText('工资')).toBeInTheDocument();
  });

  it('空列表时只渲染表头', () => {
    render(<BillVirtualList bills={[]} categoryNames={{}} sourceFileNames={{}} />);

    expect(screen.getByTestId('bill-virtual-list')).toBeInTheDocument();
    expect(screen.queryAllByTestId('bill-row')).toHaveLength(0);
    expect(screen.getByText('交易对方')).toBeInTheDocument();
  });
});
