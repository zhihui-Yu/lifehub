/**
 * 账单过滤栏。
 *
 * 架构位置：apps/web 的「账单组件」层。
 *
 * 说明：搜索（200ms 防抖）+ 方向 + 日期区间 + 分类可组合筛选，一键清空（PRD A-09 ①②③）。
 * 采用无外框轻量内联工具条布局，消除卡片套卡片的视觉累赘。
 */
import { useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  InputAdornment,
  ListItemText,
  MenuItem,
  Select,
  TextField,
} from '@mui/material';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import TuneOutlined from '@mui/icons-material/TuneOutlined';
import type { Direction } from '@lifehub/core';
import { WheelDateField } from '@/components/common/WheelPicker';
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
 * 渲染轻量内联过滤栏。
 *
 * @param props 组件属性
 * @returns React 节点
 */
export function BillFilterBar({
  filters,
  onChange,
  onClear,
  categoryOptions = [],
}: BillFilterBarProps) {
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth >= 768,
  );
  const selectedCategoryIds =
    filters.categoryIds && filters.categoryIds.length > 0
      ? filters.categoryIds
      : filters.categoryId !== ''
        ? [filters.categoryId]
        : [];

  const hasActiveFilters =
    filters.keyword.trim() !== '' ||
    filters.directions.length > 0 ||
    filters.dateFrom !== '' ||
    filters.dateTo !== '' ||
    selectedCategoryIds.length > 0;

  const compactInputSx = {
    backgroundColor: 'var(--lifehub-surface)',
    borderRadius: '8px',
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1,
        alignItems: 'center',
        width: '100%',
        boxSizing: 'border-box',
        mb: 2,
      }}
      data-testid="bill-filter-bar"
    >
      <TextField
        size="small"
        placeholder="搜索对方或备注"
        value={filters.keyword}
        onChange={(event) => onChange({ keyword: event.target.value })}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchOutlined sx={{ fontSize: 18, color: 'var(--lifehub-text-muted)' }} />
            </InputAdornment>
          ),
        }}
        sx={{
          flex: { xs: '1 1 calc(100% - 96px)', sm: '1 1 200px', md: '1 1 220px' },
          minWidth: { xs: 0, md: 200 },
          '& .MuiOutlinedInput-root': compactInputSx,
        }}
        inputProps={{ 'aria-label': '搜索对方或备注' }}
      />
      <Box
        component="span"
        data-testid="toggle-mobile-filters"
        onClick={() => setMobileFiltersOpen((prev) => !prev)}
        sx={{
          display: { xs: 'inline-flex', sm: 'none' },
          flex: '0 0 auto',
        }}
      >
        <Button
          size="small"
          variant={mobileFiltersOpen || hasActiveFilters ? 'contained' : 'outlined'}
          disableElevation
          startIcon={<TuneOutlined sx={{ fontSize: 16 }} />}
          onClick={(e) => {
            e.stopPropagation();
            setMobileFiltersOpen((prev) => !prev);
          }}
          data-testid="toggle-mobile-filters-button"
          sx={{
            height: 40,
            borderRadius: '8px',
            px: 1.5,
            whiteSpace: 'nowrap',
          }}
        >
          筛选
        </Button>
      </Box>
      <Select
        size="small"
        multiple
        value={filters.directions}
        displayEmpty
        renderValue={(selected) => {
          const list = Array.isArray(selected) ? selected : [];
          if (list.length === 0) {
            return '全部方向';
          }
          return list
            .map((dir) => DIRECTION_OPTIONS.find((opt) => opt.value === dir)?.label ?? String(dir))
            .join('、');
        }}
        onChange={(event) => {
          const raw = event.target.value;
          const list = Array.isArray(raw)
            ? raw.map(String)
            : typeof raw === 'string' && raw !== ''
              ? raw.split(',')
              : [];
          if (list.includes('__all__') || list.includes('') || list.length === 0) {
            onChange({ directions: [] });
            return;
          }
          const validDirections = list.filter(
            (item): item is Direction =>
              item === 'income' || item === 'expense' || item === 'refund',
          );
          onChange({ directions: validDirections });
        }}
        sx={{
          display: mobileFiltersOpen ? 'inline-flex' : 'none',
          flex: { xs: '1 1 calc(50% - 4px)', sm: '0 0 auto' },
          minWidth: { xs: 0, sm: 120 },
          ...compactInputSx,
        }}
        inputProps={{ 'aria-label': '收支方向', 'data-testid': 'filter-direction-select' }}
      >
        <MenuItem value="__all__">
          <ListItemText primary="全部方向" />
        </MenuItem>
        {DIRECTION_OPTIONS.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            <Checkbox
              size="small"
              checked={filters.directions.includes(option.value)}
              sx={{ p: 0.5, mr: 0.75 }}
            />
            <ListItemText primary={option.label} />
          </MenuItem>
        ))}
      </Select>
      <WheelDateField
        label="开始日期"
        value={filters.dateFrom}
        clearable
        onChange={(val) => onChange({ dateFrom: val })}
        sx={{
          display: mobileFiltersOpen ? 'inline-flex' : 'none',
          flex: { xs: '1 1 calc(50% - 4px)', sm: '0 0 auto' },
          minWidth: { xs: 0, sm: 142 },
          '& .MuiOutlinedInput-root': compactInputSx,
        }}
      />
      <WheelDateField
        label="结束日期"
        value={filters.dateTo}
        clearable
        onChange={(val) => onChange({ dateTo: val })}
        sx={{
          display: mobileFiltersOpen ? 'inline-flex' : 'none',
          flex: { xs: '1 1 calc(50% - 4px)', sm: '0 0 auto' },
          minWidth: { xs: 0, sm: 142 },
          '& .MuiOutlinedInput-root': compactInputSx,
        }}
      />
      <Select
        size="small"
        multiple
        value={selectedCategoryIds}
        displayEmpty
        renderValue={(selected) => {
          const list = Array.isArray(selected) ? selected : [];
          if (list.length === 0) {
            return '全部分类';
          }
          return list
            .map((id) => categoryOptions.find((opt) => opt.id === id)?.name ?? String(id))
            .join('、');
        }}
        onChange={(event) => {
          const raw = event.target.value;
          const list = Array.isArray(raw)
            ? raw.map(String)
            : typeof raw === 'string' && raw !== ''
              ? raw.split(',')
              : [];
          if (list.includes('__all__') || list.includes('') || list.length === 0) {
            onChange({ categoryIds: [], categoryId: '' });
            return;
          }
          onChange({
            categoryIds: list,
            categoryId: list.length === 1 ? (list[0] ?? '') : '',
          });
        }}
        sx={{
          display: mobileFiltersOpen ? 'inline-flex' : 'none',
          flex: { xs: '1 1 calc(50% - 4px)', sm: '0 0 auto' },
          minWidth: { xs: 0, sm: 136 },
          ...compactInputSx,
        }}
        inputProps={{ 'aria-label': '分类', 'data-testid': 'filter-category-select' }}
      >
        <MenuItem value="__all__">
          <ListItemText primary="全部分类" />
        </MenuItem>
        {categoryOptions.map((option) => (
          <MenuItem key={option.id} value={option.id}>
            <Checkbox
              size="small"
              checked={selectedCategoryIds.includes(option.id)}
              sx={{ p: 0.5, mr: 0.75 }}
            />
            <ListItemText primary={option.name} />
          </MenuItem>
        ))}
      </Select>
      <Button
        size="small"
        variant="text"
        onClick={onClear}
        sx={{
          display: mobileFiltersOpen ? 'inline-flex' : 'none',
          flex: { xs: '1 1 100%', sm: '0 0 auto' },
          color: hasActiveFilters ? 'primary.main' : 'var(--lifehub-text-muted)',
        }}
      >
        清空筛选
      </Button>
    </Box>
  );
}
