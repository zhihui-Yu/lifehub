/**
 * 分类规则编辑器。
 *
 * 架构位置：apps/web 的「映射组件」层。
 *
 * 说明：支持 `contains` / `prefix` / `exact` / `regex` 四种匹配类型与优先级设置（PRD A-20）。
 */
import { Box, IconButton, MenuItem, Select, TextField, Typography } from '@mui/material';
// 说明：使用深路径导入而不是 `@mui/icons-material` 桶文件——
// 桶文件会 re-export 上万个图标，导致开发服务器与测试环境的模块预构建极慢。
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import type { CategoryMatchType, CategoryRule } from '@lifehub/core';

/** 分类规则编辑器的属性。 */
export interface CategoryRuleEditorProps {
  /** 规则列表。 */
  rules: CategoryRule[];
  /** 规则变更回调。 */
  onChange: (rules: CategoryRule[]) => void;
  /** 可选的分类 id → 名称映射。 */
  categoryOptions?: { id: string; name: string }[];
}

/** 匹配类型的中文标签。 */
const MATCH_TYPE_LABELS: Record<CategoryMatchType, string> = {
  contains: '包含',
  prefix: '前缀',
  exact: '完全匹配',
  regex: '正则',
};

/**
 * 渲染分类规则编辑器。
 *
 * @param props 组件属性
 * @returns React 节点
 */
export function CategoryRuleEditor({ rules, onChange, categoryOptions = [] }: CategoryRuleEditorProps) {
  const update = (index: number, patch: Partial<CategoryRule>): void => {
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="subtitle2">自动分类规则（按优先级从高到低匹配，命中即停）</Typography>
      {rules.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)' }}>
          尚未添加分类规则，未命中的账单将归入「未分类」。
        </Typography>
      ) : null}
      {rules.map((rule, index) => (
        <Box key={rule.id} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <TextField
            size="small"
            label="关键词"
            value={rule.pattern}
            onChange={(event) => update(index, { pattern: event.target.value })}
            sx={{ flex: 1 }}
          />
          <Select
            size="small"
            value={rule.matchType}
            onChange={(event) => update(index, { matchType: event.target.value as CategoryMatchType })}
            sx={{ width: 120 }}
            inputProps={{ 'aria-label': '匹配类型' }}
          >
            {(Object.keys(MATCH_TYPE_LABELS) as CategoryMatchType[]).map((type) => (
              <MenuItem key={type} value={type}>
                {MATCH_TYPE_LABELS[type]}
              </MenuItem>
            ))}
          </Select>
          <TextField
            size="small"
            label="优先级"
            type="number"
            value={rule.priority}
            onChange={(event) => update(index, { priority: Number(event.target.value) })}
            sx={{ width: 92 }}
          />
          <Select
            size="small"
            value={rule.categoryId}
            onChange={(event) => update(index, { categoryId: event.target.value })}
            sx={{ width: 140 }}
            inputProps={{ 'aria-label': '目标分类' }}
          >
            {categoryOptions.map((option) => (
              <MenuItem key={option.id} value={option.id}>
                {option.name}
              </MenuItem>
            ))}
          </Select>
          <IconButton
            aria-label={`删除规则 ${index + 1}`}
            onClick={() => onChange(rules.filter((_, i) => i !== index))}
          >
            <DeleteOutline fontSize="small" />
          </IconButton>
        </Box>
      ))}
    </Box>
  );
}
