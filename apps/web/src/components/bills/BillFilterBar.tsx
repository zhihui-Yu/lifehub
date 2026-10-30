/**
 * 账单过滤栏。
 *
 * 架构位置：apps/web 的「账单组件」层。
 *
 * 说明：搜索（200ms 防抖）+ 方向 + 日期区间 + 分类可组合筛选，一键清空（PRD A-09 ①②③）。
 */
import { Box, Button, MenuItem, Select, TextField } from '@mui/material';
import type { Direction } from '@lifehub/core';
import type { BillFilters } from '@/store/bill-store';

/** 过滤栏的属性。 */
export interface BillFilterBarProps {
  /** 当前过滤条件。 */
  filters: BillFilters;
  /** 过滤条件变更回调。 */
  onChange: (filters: Partial<BillFilters>) => void;
  /** 一键清空回调。 */
  onClear: () => void;
  /** 可选的分类列表。 */
  categoryOptions?: { id: string; name: string }[];
}

/** 方向选项。 */
const DIRECTION_OPTIONS: { value: Direction; label: string }[] = [
  { value: 'income', label: '收入' },
  { value: 'expense', label: '支出' },
  { value: 'refund', label: '退款' },
];

/**
 * 渲染过滤栏。
 *
 * @param props 组件属性
 * @returns React 节点
 */
export function BillFilterBar({ filters, onChange, onClear, categoryOptions = [] }: BillFilterBarProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1.5,
        alignItems: 'center',
        mb: 2,
      }}
    >
      <TextField
        size="small"
        label="搜索对方或备注"
        value={filters.keyword}
        onChange={(event) => onChange({ keyword: event.target.value })}
        sx={{ minWidth: 220 }}
        inputProps={{ 'aria-label': '搜索对方或备注' }}
      />
      <Select
        size="small"
        value={filters.directions.length === 1 ? filters.directions[0] : ''}
        displayEmpty
        onChange={(event) => {
          const value = event.target.value as Direction | '';
          onChange({ directions: value === '' ? [] : [value] });
        }}
        sx={{ minWidth: 110 }}
        inputProps={{ 'aria-label': '收支方向' }}
      >
        <MenuItem value="">全部方向</MenuItem>
        {DIRECTION_OPTIONS.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </Select>
      <TextField
        size="small"
        type="date"
        label="开始日期"
        value={filters.dateFrom}
        onChange={(event) => onChange({ dateFrom: event.target.value })}
        InputLabelProps={{ shrink: true }}
      />
      <TextField
        size="small"
        type="date"
        label="结束日期"
        value={filters.dateTo}
        onChange={(event) => onChange({ dateTo: event.target.value })}
        InputLabelProps={{ shrink: true }}
      />
      <Select
        size="small"
        value={filters.categoryId}
        displayEmpty
        onChange={(event) => onChange({ categoryId: event.target.value })}
        sx={{ minWidth: 130 }}
        inputProps={{ 'aria-label': '分类' }}
      >
        <MenuItem value="">全部分类</MenuItem>
        {categoryOptions.map((option) => (
          <MenuItem key={option.id} value={option.id}>
            {option.name}
          </MenuItem>
        ))}
      </Select>
      <Button variant="text" onClick={onClear}>
        清空筛选
      </Button>
    </Box>
  );
}
