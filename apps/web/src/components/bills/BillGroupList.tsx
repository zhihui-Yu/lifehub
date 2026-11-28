/**
 * 账单分组列表。
 *
 * 架构位置：apps/web 的「账单组件」层。
 *
 * 说明：
 * 1. 按 `localDate` 分组，组头显示日期 + 星期 + 笔数 + 合计（收入绿 / 支出红），对应 PRD A-09 ③；
 * 2. 支持 `collapsible` 按日默认折叠模式：首屏仅渲染轻量单行日期汇总卡片（不挂载任何表格与账单行），
 *    用户点击某日卡片时再按需从本地库读取并展开当日明细，再次点击即可收起。
 */
import { useEffect, useRef, useState } from 'react';
import { Box, Button, Chip, Paper, Typography } from '@mui/material';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import type { BillGroup } from '@/hooks/useBillList';
import { formatAmount, formatLocalDate, formatWeekday } from '@/utils/format';

/** 展开态首屏默认挂载的日期分组数。 */
const INITIAL_EXPANDED_GROUPS = 12;
/** 折叠态首屏默认挂载的日期分组数（单行卡片极轻，可多展示）。 */
const INITIAL_COLLAPSED_GROUPS = 30;
/** 每次触底增量追加挂载的日期分组数。 */
const GROUP_LOAD_STEP = 25;

/** 账单分组列表的属性。 */
export interface BillGroupListProps {
  /** 分组数据。 */
  groups: BillGroup[];
  /** 分组内容的渲染函数。 */
  renderBills: (group: BillGroup) => React.ReactNode;
  /** 移动端点击某日分组查看弹窗明细的回调。 */
  onSelectGroup?: (group: BillGroup) => void;
  /** 是否启用「按日默认折叠、点击展开」模式。 */
  collapsible?: boolean;
  /** 当前已展开的日期集合（仅 `collapsible` 为 true 时生效）。 */
  expandedDates?: ReadonlySet<string>;
  /** 当前正在按需加载明细的日期集合（仅 `collapsible` 为 true 时生效）。 */
  loadingDates?: ReadonlySet<string>;
  /** 点击某日标题切换展开/折叠的回调。 */
  onToggleDate?: (localDate: string) => void;
}

/**
 * 渲染账单分组列表。
 *
 * @param props 组件属性
 * @returns React 节点
 */
export function BillGroupList({
  groups,
  renderBills,
  onSelectGroup,
  collapsible = false,
  expandedDates,
  loadingDates,
  onToggleDate,
}: BillGroupListProps) {
  const initialCount = collapsible ? INITIAL_COLLAPSED_GROUPS : INITIAL_EXPANDED_GROUPS;
  const [visibleCount, setVisibleCount] = useState(initialCount);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const firstDate = groups[0]?.localDate ?? '';
  useEffect(() => {
    setVisibleCount(initialCount);
  }, [groups.length, firstDate, initialCount]);

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
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: collapsible ? 1.25 : 2 }}>
      {visibleGroups.map((group) => {
        const isExpanded = collapsible ? Boolean(expandedDates?.has(group.localDate)) : true;
        const isLoadingDay = collapsible && Boolean(loadingDates?.has(group.localDate));
        const count = group.billCount ?? group.bills.length;
        const totalsReady = group.totalsReady !== false;

        return (
          <Paper
            key={group.localDate}
            variant="outlined"
            data-testid={`bill-group-card-${group.localDate}`}
            data-expanded={isExpanded ? 'true' : 'false'}
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
              role={collapsible ? 'button' : undefined}
              tabIndex={collapsible ? 0 : undefined}
              aria-expanded={collapsible ? isExpanded : undefined}
              onClick={() => {
                if (collapsible && onToggleDate) {
                  onToggleDate(group.localDate);
                  return;
                }
                if (onSelectGroup && (typeof window === 'undefined' || window.innerWidth < 768)) {
                  onSelectGroup(group);
                }
              }}
              onKeyDown={(e) => {
                if (collapsible && onToggleDate && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  onToggleDate(group.localDate);
                }
              }}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: { xs: 1, sm: 2 },
                px: { xs: 1.75, sm: 2.25 },
                py: { xs: 1.35, sm: 1.25 },
                cursor: collapsible
                  ? 'pointer'
                  : { xs: onSelectGroup ? 'pointer' : 'default', sm: 'default' },
                userSelect: collapsible ? 'none' : 'auto',
                backgroundColor: 'var(--lifehub-surface)',
                borderBottom: isExpanded ? '1px solid var(--lifehub-border)' : 'none',
                transition: 'background-color 0.15s ease',
                '&:hover': collapsible
                  ? {
                      backgroundColor: 'var(--lifehub-hover, rgba(99, 102, 241, 0.04))',
                    }
                  : undefined,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                {collapsible ? (
                  isExpanded ? (
                    <ExpandMoreRounded
                      sx={{ fontSize: 20, color: 'var(--lifehub-text-muted)', flexShrink: 0 }}
                    />
                  ) : (
                    <ChevronRightRounded
                      sx={{ fontSize: 20, color: 'var(--lifehub-text-muted)', flexShrink: 0 }}
                    />
                  )
                ) : null}
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'var(--lifehub-text)' }}>
                  {formatLocalDate(group.localDate)} · {formatWeekday(group.localDate)}
                  <Typography
                    component="span"
                    variant="caption"
                    sx={{ ml: 1, color: 'var(--lifehub-text-muted)' }}
                  >
                    {count} 笔
                  </Typography>
                </Typography>
                {!collapsible && onSelectGroup ? (
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
                {totalsReady ? (
                  <>
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
                  </>
                ) : (
                  <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
                    汇总读取中…
                  </Typography>
                )}
              </Box>
            </Box>
            {isExpanded ? (
              isLoadingDay && group.bills.length === 0 ? (
                <Box
                  data-testid={`bill-group-loading-${group.localDate}`}
                  sx={{ px: 2.25, py: 1.75, color: 'var(--lifehub-text-muted)', fontSize: '0.85rem' }}
                >
                  正在读取当日账单明细…
                </Box>
              ) : (
                renderBills(group)
              )
            ) : null}
          </Paper>
        );
      })}
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
