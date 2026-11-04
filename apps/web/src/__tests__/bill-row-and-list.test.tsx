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
import { BillRow, BILL_TABLE_COLUMN_WIDTHS } from '@/components/bills/BillRow';
import { BillGroupList } from '@/components/bills/BillGroupList';
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

    render(
      <table>
        <tbody>
          <BillRow bill={bill} categoryNames={{}} sourceFileNames={{}} />
        </tbody>
      </table>,
    );

    expect(screen.getByText('2024-01-15')).toBeInTheDocument();
    expect(screen.getByText('支出 ¥35.50')).toBeInTheDocument();
    expect(screen.getByText('星巴克')).toBeInTheDocument();
    expect(screen.getByText('拿铁')).toBeInTheDocument();
    expect(screen.getByText('未分类')).toBeInTheDocument();
    // 没有来源文件映射时显示占位符。
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('有分类映射时展示分类名，没有映射时回落为「未分类」', () => {
    const bill = makeBill({ categoryId: 'cat-food' });

    const { rerender } = render(
      <table>
        <tbody>
          <BillRow bill={bill} categoryNames={{ 'cat-food': '餐饮' }} sourceFileNames={{ 'batch-1': '微信支付.csv' }} />
        </tbody>
      </table>,
    );
    expect(screen.getByText('餐饮')).toBeInTheDocument();
    expect(screen.getByText('微信支付.csv')).toBeInTheDocument();

    rerender(
      <table>
        <tbody>
          <BillRow bill={bill} categoryNames={{}} sourceFileNames={{}} />
        </tbody>
      </table>,
    );
    expect(screen.getByText('未分类')).toBeInTheDocument();
  });

  it('交易对方为空时显示占位符', () => {
    const bill = makeBill({ counterparty: '' });
    render(
      <table>
        <tbody>
          <BillRow bill={bill} categoryNames={{}} sourceFileNames={{}} />
        </tbody>
      </table>,
    );

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
    expect(screen.getByText('账单内容 / 备注')).toBeInTheDocument();
  });

  it('跨不同日期分组（如 10.20 短文本组与 10.22 超长备注组）统一启用 table-layout: fixed 与 7 列固定列宽契约，确保各字段 100% 垂直对齐', () => {
    const oct20Bill = makeBill({
      id: 'b-oct20',
      localDate: '2026-10-20',
      amountMinor: 1200,
      direction: 'expense',
      counterparty: '包子铺',
      note: '早餐',
      sourceFileId: 'batch-short',
    });
    const oct22Bill = makeBill({
      id: 'b-oct22',
      localDate: '2026-10-22',
      amountMinor: 158000,
      direction: 'expense',
      counterparty: '京东商城自营旗舰店超长商户名称测试',
      note: '购买数码配件与家庭日常办公耗材超长商品说明备注不会撑变形表格列宽',
      sourceFileId: 'batch-long',
    });

    const groups = [
      {
        localDate: '2026-10-22',
        incomeMinor: 0,
        expenseMinor: 158000,
        bills: [oct22Bill],
      },
      {
        localDate: '2026-10-20',
        incomeMinor: 0,
        expenseMinor: 1200,
        bills: [oct20Bill],
      },
    ];

    render(
      <BillGroupList
        groups={groups}
        renderBills={(group) => (
          <BillVirtualList
            bills={group.bills}
            categoryNames={{}}
            sourceFileNames={{
              'batch-short': 'a.csv',
              'batch-long': '微信支付账单(20261001-20261031)_超长文件名测试.csv',
            }}
          />
        )}
      />,
    );

    const tables = screen.getAllByTestId('bill-group-table');
    expect(tables).toHaveLength(2);
    for (const table of tables) {
      expect(table).toHaveStyle({ tableLayout: 'fixed', width: '100%' });
    }

    const colgroups = screen.getAllByTestId('bill-table-colgroup');
    expect(colgroups).toHaveLength(2);
    const expectedWidths = [
      BILL_TABLE_COLUMN_WIDTHS.date,
      BILL_TABLE_COLUMN_WIDTHS.amount,
      BILL_TABLE_COLUMN_WIDTHS.counterparty,
      BILL_TABLE_COLUMN_WIDTHS.note,
      BILL_TABLE_COLUMN_WIDTHS.category,
      BILL_TABLE_COLUMN_WIDTHS.sourceFile,
      BILL_TABLE_COLUMN_WIDTHS.actions,
    ];

    for (const colgroup of colgroups) {
      const cols = Array.from(colgroup.querySelectorAll('col'));
      expect(cols).toHaveLength(7);
      expect(cols.map((col) => col.style.width)).toEqual(expectedWidths);
    }

    const rows = screen.getAllByTestId('bill-row');
    expect(rows).toHaveLength(2);
    const expectedCellClasses = [
      'lifehub-bill-cell-date',
      'lifehub-bill-cell-amount',
      'lifehub-bill-cell-counterparty',
      'lifehub-bill-cell-note',
      'lifehub-bill-cell-category',
      'lifehub-bill-cell-source',
      'lifehub-bill-cell-actions',
    ];
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      expect(cells).toHaveLength(7);
      // 验证移动端 APK 卡片化流式布局（UI-M-01）所需的 7 个语义化 className 均已挂载
      expectedCellClasses.forEach((cls, idx) => {
        expect(cells[idx]).toHaveClass(cls);
      });
      // 前 6 列数据字段（含第 2 列「金额」）全部统一左对齐，不带 MuiTableCell-alignRight
      for (let i = 0; i < 6; i += 1) {
        expect(cells[i]).not.toHaveClass('MuiTableCell-alignRight');
      }
    }

    const amountHeaders = screen.getAllByText('金额');
    expect(amountHeaders).toHaveLength(2);
    for (const th of amountHeaders) {
      expect(th.closest('th')).not.toHaveClass('MuiTableCell-alignRight');
    }
  });
});
