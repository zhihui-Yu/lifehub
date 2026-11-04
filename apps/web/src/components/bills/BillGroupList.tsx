/**
 * 账单分组列表。
 *
 * 架构位置：apps/web 的「账单组件」层。
 *
 * 说明：按 `localDate` 分组，组头显示日期 + 星期 + 笔数 + 合计（收入绿 / 支出红），对应 PRD A-09 ③。
 */
import { Box, Chip, Paper, Typography } from '@mui/material';
import type { BillGroup } from '@/hooks/useBillList';
import { formatAmount, formatLocalDate, formatWeekday } from '@/utils/format';

/** 账单分组列表的属性。 */
export interface BillGroupListProps {
  /** 分组数据。 */
  groups: BillGroup[];
  /** 分组内容的渲染函数。 */
  renderBills: (group: BillGroup) => React.ReactNode;
  /** 移动端点击某日分组标题查看当日全部记录明细的回调。 */
  onSelectGroup?: (group: BillGroup) => void;
}

/**
 * 渲染账单分组列表。
 *
 * 顶部汇总栏右侧的当日收入与当日支出采用等宽数字与固定最小宽度对齐，确保跨分组卡片汇总列垂直对齐。
 * 手机端点击每日汇总栏可打开当日记录明细抽屉/弹窗；Web 端因空间充裕无需弹窗。
 *
 * @param props 组件属性
 * @returns React 节点
 * @throws 无显式抛出
 */
export function BillGroupList({ groups, renderBills, onSelectGroup }: BillGroupListProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {groups.map((group) => (
        <Paper
          key={group.localDate}
          variant="outlined"
          sx={{
            overflow: 'hidden',
            borderRadius: { xs: 3, sm: 2.5 },
            backgroundColor: 'var(--lifehub-surface)',
            borderColor: 'var(--lifehub-border)',
            boxShadow: 'var(--lifehub-shadow-sm)',
          }}
        >
          <Box
            data-testid={`bill-group-header-${group.localDate}`}
            onClick={() => {
              if (onSelectGroup && (typeof window === 'undefined' || window.innerWidth < 768)) {
                onSelectGroup(group);
              }
            }}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: { xs: 1, sm: 2 },
              px: { xs: 2, sm: 2.5 },
              py: { xs: 1.5, sm: 1.25 },
              cursor: { xs: onSelectGroup ? 'pointer' : 'default', sm: 'default' },
              backgroundColor: 'var(--lifehub-surface)',
              borderBottom: '1px solid var(--lifehub-border)',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'var(--lifehub-text)' }}>
                {formatLocalDate(group.localDate)} · {formatWeekday(group.localDate)}
                <Typography component="span" variant="caption" sx={{ ml: 1, color: 'var(--lifehub-text-muted)' }}>
                  {group.bills.length} 笔
                </Typography>
              </Typography>
              {onSelectGroup ? (
                <Chip
                  size="small"
                  label="查看明细 ▸"
                  variant="outlined"
                  color="primary"
                  data-testid={`view-daily-detail-${group.localDate}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectGroup(group);
                  }}
                  sx={{
                    display: { xs: 'inline-flex', sm: 'none' },
                    height: 22,
                    fontSize: '0.7rem',
                  }}
                />
              ) : null}
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: { xs: 1.5, sm: 2 } }}>
              <Typography
                variant="body2"
                className="lifehub-amount-income"
                sx={{
                  minWidth: { xs: 'auto', sm: 120 },
                  textAlign: { xs: 'left', sm: 'right' },
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                收入 ¥{formatAmount(group.incomeMinor)}
              </Typography>
              <Typography
                variant="body2"
                className="lifehub-amount-expense"
                sx={{
                  minWidth: { xs: 'auto', sm: 120 },
                  textAlign: { xs: 'left', sm: 'right' },
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
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
