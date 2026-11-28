/**
 * 账单分组列表。
 *
 * 架构位置：apps/web 的「账单组件」层。
 *
 * 说明：按 `localDate` 分组，组头显示日期 + 星期 + 笔数 + 合计（收入绿 / 支出红），对应 PRD A-09 ③。
 * 针对跨数月、上万条账单的长列表场景，采用渐进分批挂载（首屏挂载前 12 个日期分组，滚动到底部前自动续载），
 * 消除一次性挂载上百张表格与数千个行节点导致的切 Tab 卡顿。
 */
import { useEffect, useRef, useState } from 'react';
import { Box, Button, Chip, Paper, Typography } from '@mui/material';
import type { BillGroup } from '@/hooks/useBillList';
import { formatAmount, formatLocalDate, formatWeekday } from '@/utils/format';

/** 首屏默认挂载的日期分组数（覆盖 2~4 屏高度，兼顾秒开与顺滑浏览）。 */
const INITIAL_VISIBLE_GROUPS = 12;
/** 每次触底增量追加挂载的日期分组数。 */
const GROUP_LOAD_STEP = 15;

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
 * @param props 组件属性
 * @returns React 节点
 */
export function BillGroupList({ groups, renderBills, onSelectGroup }: BillGroupListProps) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_GROUPS);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const firstDate = groups[0]?.localDate ?? '';
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_GROUPS);
  }, [groups.length, firstDate]);

  const hasMore = visibleCount < groups.length;

  useEffect(() => {
    if (!hasMore || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const target = sentinelRef.current;
    if (!target) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((prev) => Math.min(groups.length, prev + GROUP_LOAD_STEP));
        }
      },
      { rootMargin: '420px 0px' },
    );
    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [groups.length, hasMore]);

  const visibleGroups = hasMore ? groups.slice(0, visibleCount) : groups;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {visibleGroups.map((group) => (
        <Paper
          key={group.localDate}
          variant="outlined"
          sx={{
            overflow: 'hidden',
            borderRadius: '12px',
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
      {hasMore ? (
        <Box ref={sentinelRef} sx={{ py: 1, textAlign: 'center' }}>
          <Button
            size="small"
            variant="outlined"
            onClick={() =>
              setVisibleCount((prev) => Math.min(groups.length, prev + GROUP_LOAD_STEP))
            }
            data-testid="load-more-groups-button"
          >
            加载更多（剩余 {groups.length - visibleCount} 天）
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}
