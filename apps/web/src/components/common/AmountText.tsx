/**
 * 金额文本组件。
 *
 * 架构位置：apps/web 的「通用组件」层。
 *
 * 说明：统一收支语义色（收入绿 #16A34A / 支出红 #DC2626 / 退款蓝 #2563EB），
 * 避免各页面各写一套导致口径不一致。
 */
import { memo } from 'react';
import type { Direction } from '@lifehub/core';
import { formatAmount } from '@/utils/format';

/** 金额文本组件的属性。 */
export interface AmountTextProps {
  /** 以分为单位的整数金额。 */
  amountMinor: number;
  /** 收支方向。 */
  direction: Direction;
  /** 币种，默认 CNY。 */
  currency?: string;
  /** 是否显示方向标识，默认 true。 */
  showLabel?: boolean;
}

/** 方向对应的 CSS 类名。 */
const DIRECTION_CLASS: Record<Direction, string> = {
  income: 'lifehub-amount-income',
  expense: 'lifehub-amount-expense',
  refund: 'lifehub-amount-refund',
};

/** 方向对应的中文标识。 */
const DIRECTION_LABEL: Record<Direction, string> = {
  income: '收入',
  expense: '支出',
  refund: '退款',
};

/**
 * 渲染金额文本。
 *
 * @param props 组件属性
 * @returns React 节点
 */
export const AmountText = memo(function AmountText({
  amountMinor,
  direction,
  currency = 'CNY',
  showLabel = true,
}: AmountTextProps) {
  return (
    <span className={`font-medium tabular-nums ${DIRECTION_CLASS[direction]}`} data-direction={direction}>
      {showLabel ? `${DIRECTION_LABEL[direction]} ` : ''}¥{formatAmount(amountMinor, currency as 'CNY')}
    </span>
  );
});
