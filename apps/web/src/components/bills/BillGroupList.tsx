/**
 * 账单分组列表。
 *
 * 架构位置：apps/web 的「账单组件」层。
 *
 * 说明：按 `localDate` 分组，组头显示日期 + 星期 + 笔数 + 合计（收入绿 / 支出红），对应 PRD A-09 ③。
 */
import { Box, Paper, Typography } from '@mui/material';
import type { BillGroup } from '@/hooks/useBillList';
import { formatAmount, formatLocalDate, formatWeekday } from '@/utils/format';

/** 账单分组列表的属性。 */
export interface BillGroupListProps {
  /** 分组数据。 */
  groups: BillGroup[];
  /** 分组内容的渲染函数。 */
  renderBills: (group: BillGroup) => React.ReactNode;
}

/**
 * 渲染账单分组列表。
 *
 * @param props 组件属性
 * @returns React 节点
 */
export function BillGroupList({ groups, renderBills }: BillGroupListProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {groups.map((group) => (
        <Paper key={group.localDate} variant="outlined" sx={{ overflow: 'hidden' }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
              px: 2,
              py: 1.2,
              backgroundColor: 'var(--lifehub-surface)',
              borderBottom: '1px solid var(--lifehub-border)',
            }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {formatLocalDate(group.localDate)} · {formatWeekday(group.localDate)}
              <Typography component="span" variant="caption" sx={{ ml: 1, color: 'var(--lifehub-text-muted)' }}>
                {group.bills.length} 笔
              </Typography>
            </Typography>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Typography variant="body2" className="lifehub-amount-income">
                收入 ¥{formatAmount(group.incomeMinor)}
              </Typography>
              <Typography variant="body2" className="lifehub-amount-expense">
                支出 ¥{formatAmount(group.expenseMinor)}
              </Typography>
            </Box>
          </Box>
          {renderBills(group)}
        </Paper>
      ))}
    </Box>
  );
}
