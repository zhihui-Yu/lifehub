/**
 * 虚拟化长列表。
 *
 * 架构位置：apps/web 的「账单组件」层。
 *
 * 说明：使用 `@tanstack/react-virtual`，
 * 保证 1 万条账单滚动不掉帧且 DOM 节点数不随数据量线性增长（A-09 ④ / A-27）。
 */
import { useRef } from 'react';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Bill } from '@lifehub/core';
import { BillRow } from './BillRow';

/** 虚拟列表的属性。 */
export interface BillVirtualListProps {
  /** 待展示的账单。 */
  bills: Bill[];
  /** 分类 id → 名称映射。 */
  categoryNames: Record<string, string>;
  /** 导入批次 id → 文件名映射。 */
  sourceFileNames: Record<string, string>;
  /** 估算行高（像素），默认 44。 */
  estimateSize?: number;
}

/**
 * 渲染虚拟化长列表。
 *
 * @param props 组件属性
 * @returns React 节点
 */
export function BillVirtualList({
  bills,
  categoryNames,
  sourceFileNames,
  estimateSize = 44,
}: BillVirtualListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: bills.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan: 12,
  });

  return (
    <div ref={parentRef} style={{ height: '62vh', overflow: 'auto' }} data-testid="bill-virtual-list">
      <Table size="small" sx={{ width: '100%' }}>
        <TableHead>
          <TableRow>
            <TableCell>日期</TableCell>
            <TableCell align="right">金额</TableCell>
            <TableCell>交易对方</TableCell>
            <TableCell>分类</TableCell>
            <TableCell>来源文件</TableCell>
          </TableRow>
        </TableHead>
        <TableBody
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: 'relative',
            display: 'block',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const bill = bills[virtualRow.index];
            if (!bill) {
              return null;
            }
            return (
              <TableRow
                key={bill.id}
                hover
                data-index={virtualRow.index}
                style={{ position: 'absolute', transform: `translateY(${virtualRow.start}px)`, width: '100%' }}
              >
                <BillRow bill={bill} categoryNames={categoryNames} sourceFileNames={sourceFileNames} />
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
