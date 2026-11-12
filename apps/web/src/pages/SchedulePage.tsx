/**
 * 生活课表 / 时间块页面（模块 B：B-01 ~ B-05）。
 *
 * 架构位置：apps/web 的「页面组件」层，路由 `/schedule`。
 *
 * 功能覆盖：
 * - B-01：时段新增 / 编辑 / 删除（标题、开始/结束墙上时间 HH:mm、星期几/RRULE 重复规则、地点、颜色、备注）；
 * - B-02：时段完成确认勾选（写入共享 `CompletionEventRepository`，`sourceType: 'schedule'`）；
 * - B-03：日视图 / 周视图切换（`data-testid="schedule-view-toggle"`），7 天 × 时间轴网格展示；
 * - B-04：A4 纸张打印 / 导出 PDF（`data-testid="schedule-print-button"`，配合 `@media print` 防切半）；
 * - B-05：本周 / 本月完成率统计卡片（`data-testid="schedule-stats-card"`）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { addDays } from '@lifehub/core';
import {
  getTodayLocalDate,
  getWeekRange,
  listLocalDates,
  weekdayOf,
} from '@/modules/shared/date-utils';
import {
  getDaysInMonth,
} from '@/modules/schedule/rrule';
import {
  ScheduleService,
  type ScheduleCompletionStats,
  type ScheduleOccurrenceWithStatus,
  type StoredScheduleSlot,
} from '@/modules/schedule/schedule-service';

/** 星期中文名称映射（0=周日 … 6=周六）。 */
const WEEKDAY_LABELS: Record<number, string> = {
  0: '周日',
  1: '周一',
  2: '周二',
  3: '周三',
  4: '周四',
  5: '周五',
  6: '周六',
};

/** 课表可选主题色。 */
const SCHEDULE_COLORS = [
  '#4F46E5',
  '#0D9488',
  '#EA580C',
  '#2563EB',
  '#9333EA',
  '#16A34A',
  '#DC2626',
];

/** 重复模式类型。 */
type RepeatPreset = 'weekly-fixed' | 'daily' | 'workdays' | 'monthly' | 'custom-rrule';

/** 同步未来有效周期预设类型。 */
type SyncDurationPreset = '1' | '3' | '6' | '12' | 'current-week' | 'forever' | 'custom';

/**
 * 在本地日历日 `'YYYY-MM-DD'` 基础上向后推算指定月数。
 *
 * @param baseDate 基准日历日 `'YYYY-MM-DD'`
 * @param months 向后推算的月数（正整数）
 * @returns 推算后的 `'YYYY-MM-DD'`
 */
export function addMonthsToLocalDate(baseDate: string, months: number): string {
  const parts = baseDate.split('-').map((n) => Number(n));
  const y0 = parts[0] ?? 2026;
  const m0 = parts[1] ?? 1;
  const d0 = parts[2] ?? 1;
  const totalMonths = y0 * 12 + (m0 - 1) + Math.max(1, Math.trunc(months));
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;
  const maxDay = getDaysInMonth(targetYear, targetMonth);
  const targetDay = Math.min(d0, maxDay);
  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
}

/**
 * 渲染生活课表页面。
 *
 * @returns React 节点
 * @throws 无
 */
export function SchedulePage() {
  const service = useMemo(() => new ScheduleService(), []);
  const today = useMemo(() => getTodayLocalDate(), []);

  const [viewMode, setViewMode] = useState<'week' | 'day'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 ? 'day' : 'week',
  );
  const [anchorDate, setAnchorDate] = useState<string>(today);
  const [occurrences, setOccurrences] = useState<ScheduleOccurrenceWithStatus[]>([]);
  const [weekStats, setWeekStats] = useState<ScheduleCompletionStats | null>(null);
  const [monthStats, setMonthStats] = useState<ScheduleCompletionStats | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 新增 / 编辑弹窗状态
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<StoredScheduleSlot | null>(null);
  const [statsExpanded, setStatsExpanded] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth >= 768,
  );
  const [title, setTitle] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:30');
  const [repeatPreset, setRepeatPreset] = useState<RepeatPreset>('weekly-fixed');
  const [dayOfWeek, setDayOfWeek] = useState<number>(weekdayOf(today));
  const [customRRule, setCustomRRule] = useState('FREQ=WEEKLY;BYDAY=MO,WE,FR');
  const [syncDurationPreset, setSyncDurationPreset] = useState<SyncDurationPreset>('3');
  const [customSyncMonths, setCustomSyncMonths] = useState<string>('4');
  const [location, setLocation] = useState('');
  const [color, setColor] = useState('#4F46E5');
  const [note, setNote] = useState('');

  const [weekStart, weekEnd] = useMemo(() => getWeekRange(anchorDate), [anchorDate]);
  const weekDates = useMemo(() => listLocalDates(weekStart, weekEnd), [weekStart, weekEnd]);

  const reloadData = useCallback(async () => {
    try {
      const rangeFrom = viewMode === 'week' ? weekStart : anchorDate;
      const rangeTo = viewMode === 'week' ? weekEnd : anchorDate;
      const [occList, stats] = await Promise.all([
        service.getOccurrencesWithStatus(rangeFrom, rangeTo),
        service.getWeekAndMonthStats(anchorDate),
      ]);
      setOccurrences(occList);
      setWeekStats(stats.week);
      setMonthStats(stats.month);
      setErrorMsg(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '加载课表数据失败');
    }
  }, [anchorDate, service, viewMode, weekEnd, weekStart]);

  useEffect(() => {
    void reloadData();
  }, [reloadData]);

  const handleOpenAdd = () => {
    setEditingSlot(null);
    setTitle('');
    setStartTime('09:00');
    setEndTime('10:30');
    setRepeatPreset('weekly-fixed');
    setDayOfWeek(weekdayOf(anchorDate));
    setCustomRRule('FREQ=WEEKLY;BYDAY=MO,WE,FR');
    setSyncDurationPreset('3');
    setCustomSyncMonths('4');
    setLocation('');
    setColor('#4F46E5');
    setNote('');
    setDialogOpen(true);
  };

  const handleOpenEdit = (slot: StoredScheduleSlot) => {
    setEditingSlot(slot);
    setTitle(slot.title);
    setStartTime(slot.startTime);
    setEndTime(slot.endTime);
    if (slot.rrule) {
      if (slot.rrule === 'FREQ=DAILY') {
        setRepeatPreset('daily');
      } else if (slot.rrule === 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR') {
        setRepeatPreset('workdays');
      } else if (slot.rrule === 'FREQ=MONTHLY') {
        setRepeatPreset('monthly');
      } else {
        setRepeatPreset('custom-rrule');
        setCustomRRule(slot.rrule);
      }
    } else {
      setRepeatPreset('weekly-fixed');
      setDayOfWeek(slot.dayOfWeek ?? weekdayOf(anchorDate));
    }
    if (!slot.validUntil) {
      setSyncDurationPreset('forever');
    } else {
      setSyncDurationPreset('3');
    }
    setLocation(slot.location ?? '');
    setColor(slot.color ?? '#4F46E5');
    setNote(slot.note ?? '');
    setDialogOpen(true);
  };

  const resolvedSyncRange = useMemo((): { validFrom?: string; validUntil?: string; label: string } => {
    const startBase = weekStart < anchorDate ? weekStart : anchorDate;
    if (syncDurationPreset === 'forever') {
      return {
        validFrom: repeatPreset === 'monthly' ? anchorDate : undefined,
        validUntil: undefined,
        label: '长期有效（每周自动延续）',
      };
    }
    if (syncDurationPreset === 'current-week') {
      return {
        validFrom: weekStart,
        validUntil: weekEnd,
        label: `仅本周有效（${weekStart} ~ ${weekEnd}）`,
      };
    }
    const monthsNum =
      syncDurationPreset === 'custom'
        ? Math.max(1, Math.min(60, Number.parseInt(customSyncMonths, 10) || 1))
        : Number.parseInt(syncDurationPreset, 10);
    const untilDate = addMonthsToLocalDate(anchorDate, monthsNum);
    return {
      validFrom: startBase,
      validUntil: untilDate,
      label: `同步未来 ${monthsNum} 个月（${startBase} ~ ${untilDate}，免每周重复设置）`,
    };
  }, [anchorDate, customSyncMonths, repeatPreset, syncDurationPreset, weekEnd, weekStart]);

  const handleSaveSlot = async () => {
    try {
      let resolvedRRule: string | undefined;
      let resolvedDayOfWeek: number | undefined;

      if (repeatPreset === 'weekly-fixed') {
        resolvedDayOfWeek = dayOfWeek;
      } else if (repeatPreset === 'daily') {
        resolvedRRule = 'FREQ=DAILY';
      } else if (repeatPreset === 'workdays') {
        resolvedRRule = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
      } else if (repeatPreset === 'monthly') {
        resolvedRRule = 'FREQ=MONTHLY';
      } else {
        resolvedRRule = customRRule.trim();
      }

      const payload = {
        title,
        startTime,
        endTime,
        dayOfWeek: resolvedDayOfWeek,
        rrule: resolvedRRule,
        validFrom: resolvedSyncRange.validFrom,
        validUntil: resolvedSyncRange.validUntil,
        location,
        color,
        note,
      };

      if (editingSlot) {
        await service.updateSlot(editingSlot.id, payload);
      } else {
        await service.createSlot(payload);
      }
      setDialogOpen(false);
      await reloadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '保存课表时段失败');
    }
  };

  const handleDeleteSlot = async () => {
    if (!editingSlot) return;
    await service.deleteSlot(editingSlot.id);
    setDialogOpen(false);
    await reloadData();
  };

  const handleToggleCompletion = async (slotId: string, localDate: string) => {
    await service.toggleSlotCompletion(slotId, localDate);
    await reloadData();
  };

  const handlePrint = () => {
    if (typeof window !== 'undefined' && typeof window.print === 'function') {
      window.print();
    }
  };

  const handlePrev = () => {
    setAnchorDate((prev) => addDays(prev, viewMode === 'week' ? -7 : -1));
  };

  const handleNext = () => {
    setAnchorDate((prev) => addDays(prev, viewMode === 'week' ? 7 : 1));
  };

  return (
    <Box data-testid="schedule-page" sx={{ width: '100%' }}>
      {/* 移动端日程 / 习惯一键切换胶囊栏（仅手机端展示，桌面端左侧导航已可切换） */}
      <Paper
        variant="outlined"
        data-testid="schedule-habits-switcher"
        className="lifehub-no-print lifehub-mobile-only"
        sx={{
          display: { xs: 'block', md: 'none' },
          p: 0.75,
          mb: 2,
          borderRadius: 3,
          backgroundColor: 'var(--lifehub-surface)',
          borderColor: 'var(--lifehub-border)',
        }}
      >
        <Stack direction="row" spacing={1} data-testid="schedule-habit-QuickSwitch">
          <Button
            variant="contained"
            size="small"
            fullWidth
            data-testid="switch-to-schedule"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.hash = '#/schedule';
              }
            }}
          >
            📅 今日课表
          </Button>
          <Button
            variant="text"
            size="small"
            fullWidth
            data-testid="switch-to-habits"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.hash = '#/habits';
              }
            }}
          >
            🔥 习惯打卡
          </Button>
        </Stack>
      </Paper>

      {/* 顶部标题与操作栏 */}
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', md: 'center' }}
        spacing={1.5}
        sx={{ mb: 2.5 }}
      >
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            生活课表
          </Typography>
          <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)' }}>
            {viewMode === 'week' ? `${weekStart} ~ ${weekEnd}` : `${anchorDate}（${WEEKDAY_LABELS[weekdayOf(anchorDate)]}）`}
          </Typography>
        </Box>

        <Stack
          direction="row"
          alignItems="center"
          justifyContent={{ xs: 'space-between', md: 'flex-end' }}
          flexWrap="wrap"
          className="lifehub-no-print"
          sx={{ width: { xs: '100%', md: 'auto' }, gap: 1 }}
        >
          <ToggleButtonGroup
            data-testid="schedule-view-toggle"
            value={viewMode}
            exclusive
            size="small"
            onChange={(_e, next: 'week' | 'day' | null) => {
              if (next) setViewMode(next);
            }}
            aria-label="课表视图切换"
            sx={{
              height: 36,
              '& .MuiToggleButton-root': {
                px: 1.5,
                py: 0,
                height: 36,
                fontSize: 13,
                fontWeight: 600,
              },
            }}
          >
            <ToggleButton value="week" data-testid="schedule-view-week">
              周视图
            </ToggleButton>
            <ToggleButton value="day" data-testid="schedule-view-day">
              日视图
            </ToggleButton>
          </ToggleButtonGroup>

          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
            <Button
              size="small"
              variant={statsExpanded ? 'contained' : 'outlined'}
              color={statsExpanded ? 'secondary' : 'primary'}
              onClick={() => setStatsExpanded((prev) => !prev)}
              data-testid="toggle-schedule-stats"
              sx={{ height: 36, px: 1.25, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {statsExpanded ? '收起完成率 ▴' : '📊 完成率 ▾'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              onClick={handlePrint}
              data-testid="schedule-print-button"
              sx={{ display: { xs: 'none', sm: 'inline-flex' }, height: 36, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              打印 / 导出 A4
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={handleOpenAdd}
              data-testid="schedule-add-button"
              sx={{ height: 36, px: 1.5, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              + 新增时段
            </Button>
          </Stack>
        </Stack>
      </Stack>

      {errorMsg && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorMsg(null)}>
          {errorMsg}
        </Alert>
      )}

      {/* B-05：周 / 月完成率统计卡片（手机端默认隐藏在「完成率统计」按钮中，点击展开） */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ mb: 3, display: statsExpanded ? 'flex' : 'none' }}
        data-testid="schedule-stats-card"
      >
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, flex: 1, borderRadius: 3 }}>
          <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
            本周课表完成率（{weekStart} ~ {weekEnd}）
          </Typography>
          <Stack direction="row" alignItems="baseline" spacing={1.5} sx={{ mt: 0.5 }}>
            <Typography variant="h5" sx={{ fontWeight: 700, color: 'primary.main' }}>
              {weekStats?.completionRate ?? 0}%
            </Typography>
            <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)' }}>
              已完成 {weekStats?.completedCount ?? 0} / 应完成 {weekStats?.expectedCount ?? 0} 项
            </Typography>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, flex: 1, borderRadius: 3 }}>
          <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
            本月课表完成率（{monthStats?.fromDate ?? ''} ~ {monthStats?.toDate ?? ''}）
          </Typography>
          <Stack direction="row" alignItems="baseline" spacing={1.5} sx={{ mt: 0.5 }}>
            <Typography variant="h5" sx={{ fontWeight: 700, color: 'success.main' }}>
              {monthStats?.completionRate ?? 0}%
            </Typography>
            <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)' }}>
              已完成 {monthStats?.completedCount ?? 0} / 应完成 {monthStats?.expectedCount ?? 0} 项
            </Typography>
          </Stack>
        </Paper>
      </Stack>

      {/* B-03：周视图（7天网格，移动端支持横向 scroll-snap 顺滑滑动）与日视图 */}
      {viewMode === 'week' ? (
        <Box
          data-testid="schedule-week-grid"
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(7, minmax(220px, 1fr))', md: 'repeat(7, minmax(150px, 1fr))' },
            gap: 1.5,
            overflowX: 'auto',
            scrollSnapType: { xs: 'x proximity', md: 'none' },
            WebkitOverflowScrolling: 'touch',
            pb: 1.5,
          }}
        >
          {weekDates.map((dateStr) => {
            const wd = weekdayOf(dateStr);
            const isToday = dateStr === today;
            const dayOccurrences = occurrences.filter((o) => o.localDate === dateStr);

            return (
              <Paper
                key={dateStr}
                variant="outlined"
                sx={{
                  p: { xs: 1.75, sm: 1.5 },
                  minHeight: 260,
                  borderRadius: 3,
                  scrollSnapAlign: 'start',
                  borderColor: isToday ? 'primary.main' : 'var(--lifehub-border)',
                  borderWidth: isToday ? 2 : 1,
                }}
              >
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  sx={{ mb: 1.5, pb: 1, borderBottom: '1px solid var(--lifehub-border)' }}
                >
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {WEEKDAY_LABELS[wd]}
                  </Typography>
                  <Chip
                    size="small"
                    label={dateStr.slice(5)}
                    color={isToday ? 'primary' : 'default'}
                    variant={isToday ? 'filled' : 'outlined'}
                  />
                </Stack>

                {dayOccurrences.length === 0 ? (
                  <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
                    无安排
                  </Typography>
                ) : (
                  <Stack spacing={1}>
                    {dayOccurrences.map((occ) => (
                      <Paper
                        key={`${occ.slotId}:${occ.localDate}`}
                        variant="outlined"
                        className="lifehub-schedule-card"
                        data-testid={`schedule-card-${occ.slotId}-${occ.localDate}`}
                        sx={{
                          p: 1,
                          borderLeft: `4px solid ${occ.color || '#4F46E5'}`,
                          opacity: occ.completed ? 0.78 : 1,
                        }}
                      >
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                          <Typography variant="caption" sx={{ fontWeight: 600 }}>
                            {occ.startTime} - {occ.endTime}
                          </Typography>
                          <Checkbox
                            size="small"
                            checked={occ.completed}
                            inputProps={{
                              'aria-label': `完成确认-${occ.title}-${occ.localDate}`,
                            }}
                            data-testid="schedule-complete-toggle"
                            onChange={() => void handleToggleCompletion(occ.slotId, occ.localDate)}
                            sx={{ p: 0.25 }}
                          />
                        </Stack>
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 600,
                            textDecoration: occ.completed ? 'line-through' : 'none',
                            cursor: 'pointer',
                            mt: 0.25,
                          }}
                          onClick={() => handleOpenEdit(occ.slot)}
                        >
                          {occ.title}
                        </Typography>
                        {occ.location && (
                          <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
                            📍 {occ.location}
                          </Typography>
                        )}
                      </Paper>
                    ))}
                  </Stack>
                )}
              </Paper>
            );
          })}
        </Box>
      ) : (
        <Paper
          variant="outlined"
          data-testid="schedule-day-view"
          sx={{ p: 2.5, borderRadius: 2 }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>
            {anchorDate}（{WEEKDAY_LABELS[weekdayOf(anchorDate)]}）时段列表
          </Typography>
          {occurrences.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)' }}>
              当日暂无课表或时间块安排，可点击右上角「+ 新增时段」创建。
            </Typography>
          ) : (
            <Stack spacing={1.5}>
              {occurrences.map((occ) => (
                <Paper
                  key={`${occ.slotId}:${occ.localDate}`}
                  variant="outlined"
                  className="lifehub-schedule-card"
                  sx={{
                    p: 1.5,
                    borderLeft: `4px solid ${occ.color || '#4F46E5'}`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Box onClick={() => handleOpenEdit(occ.slot)} sx={{ cursor: 'pointer' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      {occ.startTime} - {occ.endTime} · {occ.title}
                    </Typography>
                    {occ.location && (
                      <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
                        地点：{occ.location}
                      </Typography>
                    )}
                  </Box>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Checkbox
                      checked={occ.completed}
                      data-testid="schedule-complete-toggle"
                      onChange={() => void handleToggleCompletion(occ.slotId, occ.localDate)}
                    />
                    <Typography variant="caption">
                      {occ.completed ? '已完成' : '待完成'}
                    </Typography>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          )}
        </Paper>
      )}

      {/* 底部日期翻页栏：三等分网格对齐，整洁对称 */}
      <Paper
        variant="outlined"
        data-testid="schedule-bottom-toolbar"
        className="lifehub-no-print"
        sx={{
          mt: 2.5,
          p: 1.25,
          borderRadius: 3,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 1.25,
          alignItems: 'center',
          backgroundColor: 'var(--lifehub-surface)',
        }}
      >
        <Button
          size="small"
          variant="outlined"
          fullWidth
          onClick={handlePrev}
          sx={{ height: 38 }}
        >
          ← {viewMode === 'week' ? '上一周' : '上一天'}
        </Button>
        <Button
          size="small"
          variant="outlined"
          fullWidth
          onClick={() => setAnchorDate(today)}
          data-testid="schedule-today-button"
          sx={{ height: 38 }}
        >
          今天
        </Button>
        <Button
          size="small"
          variant="outlined"
          fullWidth
          onClick={handleNext}
          sx={{ height: 38 }}
        >
          {viewMode === 'week' ? '下一周' : '下一天'} →
        </Button>
      </Paper>

      {/* B-01：新增 / 编辑时段弹窗 */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        fullWidth
        maxWidth="sm"
        data-testid="schedule-slot-dialog"
      >
        <DialogTitle>{editingSlot ? '编辑课表时段' : '新增课表时段'}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField
              label="时段标题"
              fullWidth
              size="small"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              inputProps={{ 'data-testid': 'schedule-input-title' }}
            />
            <Stack direction="row" spacing={2}>
              <TextField
                label="开始时间 (HH:mm)"
                fullWidth
                size="small"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                inputProps={{ 'data-testid': 'schedule-input-start' }}
              />
              <TextField
                label="结束时间 (HH:mm)"
                fullWidth
                size="small"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                inputProps={{ 'data-testid': 'schedule-input-end' }}
              />
            </Stack>

            <FormControl fullWidth size="small">
              <InputLabel id="schedule-repeat-label">重复规则</InputLabel>
              <Select
                labelId="schedule-repeat-label"
                label="重复规则"
                value={repeatPreset}
                onChange={(e) => setRepeatPreset(e.target.value as RepeatPreset)}
                data-testid="schedule-repeat-select"
              >
                <MenuItem value="weekly-fixed">每周固定星期</MenuItem>
                <MenuItem value="daily">每天 (FREQ=DAILY)</MenuItem>
                <MenuItem value="workdays">工作日 (周一至周五)</MenuItem>
                <MenuItem value="monthly">每月同日 (FREQ=MONTHLY)</MenuItem>
                <MenuItem value="custom-rrule">自定义 RRULE</MenuItem>
              </Select>
            </FormControl>

            {repeatPreset === 'weekly-fixed' && (
              <FormControl fullWidth size="small">
                <InputLabel id="schedule-weekday-label">星期几</InputLabel>
                <Select
                  labelId="schedule-weekday-label"
                  label="星期几"
                  value={dayOfWeek}
                  onChange={(e) => setDayOfWeek(Number(e.target.value))}
                >
                  {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
                    <MenuItem key={wd} value={wd}>
                      {WEEKDAY_LABELS[wd]}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {repeatPreset === 'custom-rrule' && (
              <TextField
                label="自定义 RFC 5545 RRULE"
                fullWidth
                size="small"
                value={customRRule}
                onChange={(e) => setCustomRRule(e.target.value)}
                helperText="示例：FREQ=WEEKLY;BYDAY=MO,WE,FR 或 FREQ=MONTHLY;BYMONTHDAY=1,15"
              />
            )}

            <FormControl fullWidth size="small">
              <InputLabel id="schedule-sync-months-label">同步未来周期（免每周重复设置）</InputLabel>
              <Select
                labelId="schedule-sync-months-label"
                label="同步未来周期（免每周重复设置）"
                value={syncDurationPreset}
                onChange={(e) => setSyncDurationPreset(e.target.value as SyncDurationPreset)}
                data-testid="schedule-sync-months-select"
              >
                <MenuItem value="1">同步到未来 1 个月</MenuItem>
                <MenuItem value="3">同步到未来 3 个月（推荐）</MenuItem>
                <MenuItem value="6">同步到未来 6 个月（半年）</MenuItem>
                <MenuItem value="12">同步到未来 12 个月（全年）</MenuItem>
                <MenuItem value="custom">自定义未来 X 个月</MenuItem>
                <MenuItem value="current-week">仅本周有效</MenuItem>
                <MenuItem value="forever">长期有效（无截止日）</MenuItem>
              </Select>
            </FormControl>

            {syncDurationPreset === 'custom' && (
              <TextField
                label="同步到未来几个月（1 ~ 60）"
                type="number"
                fullWidth
                size="small"
                value={customSyncMonths}
                onChange={(e) => setCustomSyncMonths(e.target.value)}
                inputProps={{ min: 1, max: 60, 'data-testid': 'schedule-custom-months-input' }}
              />
            )}

            <Typography
              variant="caption"
              data-testid="schedule-sync-range-preview"
              sx={{ color: 'var(--lifehub-text-muted)', mt: -1 }}
            >
              生效周期：{resolvedSyncRange.label}
            </Typography>

            <TextField
              label="地点（可选）"
              fullWidth
              size="small"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              inputProps={{ 'data-testid': 'schedule-input-location' }}
            />

            <TextField
              label="备注（可选）"
              fullWidth
              size="small"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              inputProps={{ 'data-testid': 'schedule-input-note' }}
            />

            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="caption">标签颜色：</Typography>
              {SCHEDULE_COLORS.map((c) => (
                <Box
                  key={c}
                  onClick={() => setColor(c)}
                  sx={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    backgroundColor: c,
                    cursor: 'pointer',
                    border: color === c ? '2px solid #111827' : '2px solid transparent',
                  }}
                />
              ))}
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          {editingSlot && (
            <Button
              color="error"
              onClick={() => void handleDeleteSlot()}
              data-testid="schedule-delete-button"
            >
              删除时段
            </Button>
          )}
          <Button onClick={() => setDialogOpen(false)}>取消</Button>
          <Button
            variant="contained"
            onClick={() => void handleSaveSlot()}
            data-testid="schedule-save-button"
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
