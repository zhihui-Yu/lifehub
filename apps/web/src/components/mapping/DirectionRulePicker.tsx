/**
 * 方向策略选择器。
 *
 * 架构位置：apps/web 的「映射组件」层。
 *
 * 说明：三种策略单选（金额正负号 / 收·支列 / 关键词），对应 PRD A-06 ①。
 */
import { Box, FormControl, FormControlLabel, FormLabel, Radio, RadioGroup } from '@mui/material';
import type { DirectionRule, DirectionRuleMode } from '@lifehub/core';

/** 方向策略选择器的属性。 */
export interface DirectionRulePickerProps {
  /** 当前规则。 */
  rule: DirectionRule;
  /** 规则变更回调。 */
  onChange: (rule: DirectionRule) => void;
}

/** 各模式的说明文案。 */
const MODE_HINTS: Record<DirectionRuleMode, string> = {
  auto: '自动：优先使用收/支列，其次金额正负号，最后关键词',
  sign: '按金额正负号判断：负号记为支出',
  column: '按独立的收/支列判断（列值含「收」「支」「入账」等）',
  keyword: '按对方 / 备注中的关键词判断',
};

/**
 * 渲染方向策略选择器。
 *
 * @param props 组件属性
 * @returns React 节点
 */
export function DirectionRulePicker({ rule, onChange }: DirectionRulePickerProps) {
  return (
    <Box>
      <FormControl>
        <FormLabel id="direction-rule-label">收支方向判定方式</FormLabel>
        <RadioGroup
          aria-labelledby="direction-rule-label"
          value={rule.mode}
          onChange={(event) => onChange({ ...rule, mode: event.target.value as DirectionRuleMode })}
        >
          <FormControlLabel
            value="auto"
            control={<Radio size="small" />}
            label={MODE_HINTS.auto}
            data-testid="direction-mode-auto"
          />
          <FormControlLabel
            value="sign"
            control={<Radio size="small" />}
            label={MODE_HINTS.sign}
            data-testid="direction-mode-sign"
          />
          <FormControlLabel
            value="column"
            control={<Radio size="small" />}
            label={MODE_HINTS.column}
            data-testid="direction-mode-column"
          />
          <FormControlLabel
            value="keyword"
            control={<Radio size="small" />}
            label={MODE_HINTS.keyword}
            data-testid="direction-mode-keyword"
          />
        </RadioGroup>
      </FormControl>
    </Box>
  );
}
