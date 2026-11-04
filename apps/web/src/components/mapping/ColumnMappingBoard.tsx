/**
 * 列映射看板。
 *
 * 架构位置：apps/web 的「映射组件」层。
 *
 * 说明：提供**下拉选择**与**整列拖拽**两种方式，且两者结果一致（PRD A-10 ①②）。
 * 左侧是源列（可拖拽），右侧是语义字段槽位（可放置）。
 */
import { useState, type DragEvent } from 'react';
import { Box, Chip, FormControl, MenuItem, Select, Typography } from '@mui/material';
import type { BillField, ColumnMapping } from '@lifehub/core';
import { BILL_FIELDS } from '@lifehub/core';

/** 语义字段的中文标签。 */
const FIELD_LABELS: Record<BillField, string> = {
  occurredAt: '日期',
  amount: '金额',
  counterparty: '交易对方',
  category: '分类',
  direction: '收支方向',
  balance: '余额',
  note: '备注',
  ignore: '忽略',
};

/** 列映射看板的属性。 */
export interface ColumnMappingBoardProps {
  /** 表头单元格。 */
  headers: string[];
  /** 当前映射。 */
  mapping: ColumnMapping;
  /** 映射变更回调。 */
  onChange: (mapping: ColumnMapping) => void;
}

/**
 * 渲染列映射看板。
 *
 * @param props 组件属性
 * @returns React 节点
 */
export function ColumnMappingBoard({ headers, mapping, onChange }: ColumnMappingBoardProps) {
  const [dragColumn, setDragColumn] = useState<number | null>(null);

  /** 找到绑定到某语义字段的列索引。 */
  const columnOfField = (field: BillField): number | null => {
    for (const [index, value] of Object.entries(mapping)) {
      if (value === field) {
        return Number.parseInt(index, 10);
      }
    }
    return null;
  };

  /** 把某列绑定到某语义字段（互斥：一个字段只能绑一列）。 */
  const assign = (columnIndex: number, field: BillField): void => {
    const next: ColumnMapping = {};
    for (const [index, value] of Object.entries(mapping)) {
      // 目标字段若已被其它列占用，先解除那一列的绑定。
      if (value === field) {
        continue;
      }
      next[Number.parseInt(index, 10)] = value;
    }
    next[columnIndex] = field;
    onChange(next);
  };

  /** 解除某列的绑定（设为「忽略」）。 */
  const unassign = (columnIndex: number): void => {
    const next = { ...mapping };
    delete next[columnIndex];
    onChange(next);
  };

  const handleDropOnField = (event: DragEvent<HTMLDivElement>, field: BillField): void => {
    event.preventDefault();
    const source = dragColumn;
    setDragColumn(null);
    if (source === null) {
      return;
    }
    assign(source, field);
  };

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
      {/* 左栏：源列 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600, color: 'var(--lifehub-text)' }}>
          源列（可拖拽到右侧字段）
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {headers.map((header, index) => (
            <Box
              key={`${header}-${index}`}
              draggable
              onDragStart={() => setDragColumn(index)}
              onDragEnd={() => setDragColumn(null)}
              onClick={() => unassign(index)}
              sx={{
                p: 1.2,
                border: mapping[index]
                  ? '1px solid var(--lifehub-primary)'
                  : '1px solid var(--lifehub-border)',
                borderRadius: 1.5,
                backgroundColor: mapping[index]
                  ? 'rgba(99, 102, 241, 0.10)'
                  : 'var(--lifehub-surface)',
                color: 'var(--lifehub-text)',
                cursor: 'grab',
              }}
              data-testid={`source-column-${index}`}
            >
              <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--lifehub-text)' }}>
                {header || `第 ${index + 1} 列`}
              </Typography>
              <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
                {mapping[index] ? `已映射到「${FIELD_LABELS[mapping[index] as BillField]}」` : '未映射（点击可解除）'}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* 右栏：语义字段 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600, color: 'var(--lifehub-text)' }}>
          语义字段（可从左侧拖入，或用下拉选择）
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {BILL_FIELDS.map((field) => {
            const columnIndex = columnOfField(field);
            const isMapped = columnIndex !== null;
            return (
              <Box
                key={field}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => handleDropOnField(event, field)}
                sx={{
                  p: 1.2,
                  border: isMapped
                    ? '1px solid var(--lifehub-primary)'
                    : '1px solid var(--lifehub-border)',
                  borderRadius: 1.5,
                  backgroundColor: isMapped
                    ? 'rgba(99, 102, 241, 0.10)'
                    : 'var(--lifehub-surface)',
                  color: 'var(--lifehub-text)',
                }}
                data-testid={`field-slot-${field}`}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                  <Chip
                    size="small"
                    label={FIELD_LABELS[field]}
                    color={isMapped ? 'primary' : 'default'}
                    variant={isMapped ? 'filled' : 'outlined'}
                    sx={{
                      fontWeight: 600,
                      color: isMapped ? '#ffffff' : 'var(--lifehub-text)',
                      borderColor: 'var(--lifehub-border)',
                    }}
                  />
                  <FormControl size="small" sx={{ minWidth: 200 }}>
                    <Select
                      value={columnIndex === null ? '' : String(columnIndex)}
                      displayEmpty
                      inputProps={{ 'aria-label': `${FIELD_LABELS[field]} 对应的列` }}
                      sx={{
                        color: 'var(--lifehub-text)',
                        backgroundColor: 'var(--lifehub-bg)',
                        '& .MuiSelect-icon': {
                          color: 'var(--lifehub-text-muted)',
                        },
                      }}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value === '') {
                          unassign(columnIndex ?? -1);
                          return;
                        }
                        assign(Number.parseInt(value, 10), field);
                      }}
                    >
                      <MenuItem value="">
                        <em>未映射</em>
                      </MenuItem>
                      {headers.map((header, index) => (
                        <MenuItem key={index} value={String(index)}>
                          第 {index + 1} 列：{header || '（空表头）'}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
