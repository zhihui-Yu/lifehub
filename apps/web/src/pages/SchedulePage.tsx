/**
 * 生活课表 / 时间块页面（模块 B：B-01 ~ B-05）。
 *
 * 架构位置：apps/web 的「页面组件」层，路由 `/schedule`。
 *
 * 功能覆盖：
 * - B-01：时段新增 / 编辑 / 删除（标题、开始/结束时间 HH:mm、重复规则、地点、颜色、备注）；
 * - B-02：时段完成确认勾选（写入共享 `CompletionEventRepository`，`sourceType: 'schedule'`）；
 * - B-03：日视图 / 周视图切换（`data-testid="schedule-view-toggle"`），统一几何圆角表格与内嵌时段块；
 * - B-04：A4 纸张打印 / 导出 PDF（`data-testid="schedule-print-button"`）；
 * - B-05：本周 / 本月完成率统计面板（`data-testid="schedule-stats-card"`，默认折叠）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import AddOutlined from '@mui/icons-material/AddOutlined';
import BarChartOutlined from '@mui/icons-material/BarChartOutlined';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import ChevronLeftOutlined from '@mui/icons-material/ChevronLeftOutlined';
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined';
import CloseRounded from '@mui/icons-material/CloseRounded';
import PrintOutlined from '@mui/icons-material/PrintOutlined';
import RadioButtonUncheckedRounded from '@mui/icons-material/RadioButtonUncheckedRounded';
import { addDays } from '@lifehub/core';
import { WheelTimeField } from '@/components/common/WheelPicker';
import {
  adjustTimeRangeOnStartChange,
  clampEndTimeAfterStart,
} from '@/components/common/wheel-picker-utils';
import {
  addMonthsToLocalDate,
  getTodayLocalDate,
  getWeekRange,
  listLocalDates,
  weekdayOf,
} from '@/modules/shared/date-utils';
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
 * 渲染生活课表页面。
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
  const [dialogError, setDialogError] = useState<string | null>(null);

  // 新增 / 编辑弹窗与折叠统计状态
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<StoredScheduleSlot | null>(null);
  const [statsExpanded, setStatsExpanded] = useState(false);
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

  const handleOpenAddForDate = (targetDate?: string) => {
    const baseDate = targetDate ?? anchorDate;
    setEditingSlot(null);
    setTitle('');
    setStartTime('09:00');
    setEndTime('10:30');
    setRepeatPreset('weekly-fixed');
    setDayOfWeek(weekdayOf(baseDate));
    setCustomRRule('FREQ=WEEKLY;BYDAY=MO,WE,FR');
    setSyncDurationPreset('3');
    setCustomSyncMonths('4');
    setLocation('');
    setColor('#4F46E5');
    setNote('');
    setDialogError(null);
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
    setDialogError(null);
    setDialogOpen(true);
  };

  const resolvedSyncRange = useMemo((): { validFrom?: string; validUntil?: string; label: string } => {
    const startBase = weekStart < anchorDate ? weekStart : anchorDate;
    if (syncDurationPreset === 'forever') {
      return {
        validFrom: repeatPreset === 'monthly' ? anchorDate : undefined,
        validUntil: undefined,
        label: '长期有效',
      };
    }
    if (syncDurationPreset === 'current-week') {
      return {
        validFrom: weekStart,
        validUntil: weekEnd,
        label: `${weekStart} ~ ${weekEnd}`,
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
      label: `${startBase} ~ ${untilDate}`,
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
      setDialogError(null);
      setDialogOpen(false);
      await reloadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存课表时段失败';
      setDialogError(msg);
      setErrorMsg(msg);
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

  const isCurrentAnchorToday =
    viewMode === 'week' ? today >= weekStart && today <= weekEnd : anchorDate === today;

  const dialogFieldSx = {
    '& .MuiOutlinedInput-root': {
      borderRadius: '8px',
      backgroundColor: 'var(--lifehub-bg)',
    },
  };

  return (
    <Box data-testid="schedule-page" sx={{ width: '100%' }}>
      {/* 移动端分段切换（课表 | 习惯）—— 统一 8px 圆角风格 */}
      <Box
        data-testid="schedule-habits-switcher"
        className="lifehub-no-print lifehub-mobile-only"
        sx={{
          display: { xs: 'flex', md: 'none' },
          mb: 1.75,
        }}
      >
        <Box
          data-testid="schedule-habit-QuickSwitch"
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            width: '100%',
            p: 0.4,
            borderRadius: '10px',
            backgroundColor: 'var(--lifehub-surface-hover)',
          }}
        >
          <Button
            size="small"
            disableElevation
            data-testid="switch-to-schedule"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.hash = '#/schedule';
              }
            }}
            sx={{
              borderRadius: '8px',
              py: 0.55,
              fontWeight: 700,
              fontSize: 13,
              color: 'var(--lifehub-text)',
              backgroundColor: 'var(--lifehub-surface)',
              boxShadow: 'var(--lifehub-shadow-sm)',
              '&:hover': { backgroundColor: 'var(--lifehub-surface)' },
            }}
          >
            课表
          </Button>
          <Button
            size="small"
            disableElevation
            data-testid="switch-to-habits"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.hash = '#/habits';
              }
            }}
            sx={{
              borderRadius: '8px',
              py: 0.55,
              fontWeight: 600,
              fontSize: 13,
              color: 'var(--lifehub-text-muted)',
              backgroundColor: 'transparent',
            }}
          >
            习惯
          </Button>
        </Box>
      </Box>

      {/* 顶部工具栏：与下方表格统一 8px 几何圆角，消除突兀大胶囊 */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', sm: 'center' }}
        spacing={1.25}
        sx={{ mb: 1.75 }}
      >
        <Stack direction="row" alignItems="center" spacing={1.25} flexWrap="wrap">
          <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: '-0.01em' }}>
            课表
          </Typography>

          <Stack
            direction="row"
            alignItems="center"
            spacing={0.25}
            className="lifehub-no-print"
            sx={{
              px: 0.4,
              py: 0.2,
              borderRadius: '8px',
              border: '1px solid var(--lifehub-border)',
              backgroundColor: 'var(--lifehub-surface)',
            }}
          >
            <IconButton
              size="small"
              onClick={handlePrev}
              aria-label={viewMode === 'week' ? '上一周' : '上一天'}
              sx={{ p: 0.35, borderRadius: '6px' }}
            >
              <ChevronLeftOutlined sx={{ fontSize: 18 }} />
            </IconButton>
            <Typography
              variant="body2"
              sx={{
                px: 0.75,
                fontWeight: 600,
                fontSize: 13,
                fontVariantNumeric: 'tabular-nums',
                color: 'var(--lifehub-text)',
                whiteSpace: 'nowrap',
              }}
            >
              {viewMode === 'week'
                ? `${weekStart.slice(5)} ~ ${weekEnd.slice(5)}`
                : `${anchorDate.slice(5)} ${WEEKDAY_LABELS[weekdayOf(anchorDate)]}`}
            </Typography>
            <IconButton
              size="small"
              onClick={handleNext}
              aria-label={viewMode === 'week' ? '下一周' : '下一天'}
              sx={{ p: 0.35, borderRadius: '6px' }}
            >
              <ChevronRightOutlined sx={{ fontSize: 18 }} />
            </IconButton>
          </Stack>

          {!isCurrentAnchorToday ? (
            <Button
              size="small"
              variant="text"
              onClick={() => setAnchorDate(today)}
              data-testid="schedule-today-button"
              className="lifehub-no-print"
              sx={{
                minWidth: 0,
                px: 1,
                py: 0.35,
                borderRadius: '8px',
                fontSize: 12.5,
                fontWeight: 600,
              }}
            >
              今天
            </Button>
          ) : (
            <Box component="span" sx={{ display: 'none' }}>
              <button
                type="button"
                data-testid="schedule-today-button"
                onClick={() => setAnchorDate(today)}
              >
                今天
              </button>
            </Box>
          )}
        </Stack>

        <Stack
          direction="row"
          alignItems="center"
          justifyContent={{ xs: 'space-between', sm: 'flex-end' }}
          spacing={0.85}
          className="lifehub-no-print"
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
              p: 0.3,
              borderRadius: '8px',
              backgroundColor: 'var(--lifehub-surface-hover)',
              '& .MuiToggleButtonGroup-grouped': {
                border: 0,
                borderRadius: '6px !important',
                px: 1.5,
                py: 0.35,
                fontSize: 12.5,
                fontWeight: 600,
                color: 'var(--lifehub-text-muted)',
                '&.Mui-selected': {
                  backgroundColor: 'var(--lifehub-surface)',
                  color: 'var(--lifehub-text)',
                  boxShadow: 'var(--lifehub-shadow-sm)',
                },
              },
            }}
          >
            <ToggleButton value="week" data-testid="schedule-view-week">
              周
            </ToggleButton>
            <ToggleButton value="day" data-testid="schedule-view-day">
              日
            </ToggleButton>
          </ToggleButtonGroup>

          <Stack direction="row" spacing={0.65} alignItems="center">
            <Tooltip title="完成率">
              <IconButton
                size="small"
                onClick={() => setStatsExpanded((prev) => !prev)}
                data-testid="toggle-schedule-stats"
                aria-label="完成率统计"
                sx={{
                  width: 34,
                  height: 34,
                  borderRadius: '8px',
                  backgroundColor: statsExpanded ? 'var(--lifehub-primary-soft)' : 'transparent',
                  color: statsExpanded ? 'primary.main' : 'var(--lifehub-text-muted)',
                }}
              >
                <BarChartOutlined sx={{ fontSize: 19 }} />
              </IconButton>
            </Tooltip>

            <Tooltip title="打印 A4">
              <IconButton
                size="small"
                onClick={handlePrint}
                data-testid="schedule-print-button"
                aria-label="打印或导出 A4"
                sx={{
                  display: { xs: 'none', sm: 'inline-flex' },
                  width: 34,
                  height: 34,
                  borderRadius: '8px',
                  color: 'var(--lifehub-text-muted)',
                }}
              >
                <PrintOutlined sx={{ fontSize: 19 }} />
              </IconButton>
            </Tooltip>

            <Button
              size="small"
              variant="contained"
              disableElevation
              startIcon={<AddOutlined sx={{ fontSize: 17 }} />}
              onClick={() => handleOpenAddForDate()}
              data-testid="schedule-add-button"
              sx={{
                height: 34,
                px: 1.5,
                borderRadius: '8px',
                fontWeight: 600,
              }}
            >
              新增
            </Button>
          </Stack>
        </Stack>
      </Stack>

      {errorMsg && (
        <Alert severity="error" sx={{ mb: 2, borderRadius: '10px' }} onClose={() => setErrorMsg(null)}>
          {errorMsg}
        </Alert>
      )}

      {/* B-05：单层扁平统计条 */}
      <Collapse in={statsExpanded}>
        <Paper
          variant="outlined"
          data-testid="schedule-stats-card"
          sx={{
            mb: 1.75,
            px: { xs: 2, sm: 2.5 },
            py: 1.5,
            borderRadius: '12px',
            backgroundColor: 'var(--lifehub-surface)',
            borderColor: 'var(--lifehub-border)',
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
            gap: { xs: 1.25, sm: 3 },
          }}
        >
          <Stack direction="row" justifyContent="space-between" alignItems="baseline">
            <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)' }}>
              本周完成率
            </Typography>
            <Stack direction="row" spacing={1} alignItems="baseline">
              <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.main' }}>
                {weekStats?.completionRate ?? 0}%
              </Typography>
              <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
                {weekStats?.completedCount ?? 0}/{weekStats?.expectedCount ?? 0}
              </Typography>
            </Stack>
          </Stack>

          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="baseline"
            sx={{
              borderTop: { xs: '1px solid var(--lifehub-border)', sm: 'none' },
              borderLeft: { xs: 'none', sm: '1px solid var(--lifehub-border)' },
              pt: { xs: 1.25, sm: 0 },
              pl: { xs: 0, sm: 3 },
            }}
          >
            <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)' }}>
              本月完成率
            </Typography>
            <Stack direction="row" spacing={1} alignItems="baseline">
              <Typography variant="h6" sx={{ fontWeight: 700, color: 'success.main' }}>
                {monthStats?.completionRate ?? 0}%
              </Typography>
              <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
                {monthStats?.completedCount ?? 0}/{monthStats?.expectedCount ?? 0}
              </Typography>
            </Stack>
          </Stack>
        </Paper>
      </Collapse>

      {/* B-03：周视图（12px 规整表格外框 + 内嵌 8px 日历块 + 列头直达快捷添加） */}
      {viewMode === 'week' ? (
        <Paper
          variant="outlined"
          sx={{
            borderRadius: '12px',
            overflow: 'hidden',
            backgroundColor: 'var(--lifehub-surface)',
            borderColor: 'var(--lifehub-border)',
          }}
        >
          <Box
            data-testid="schedule-week-grid"
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: 'repeat(7, minmax(172px, 1fr))',
                md: 'repeat(7, minmax(136px, 1fr))',
              },
              overflowX: 'auto',
              scrollSnapType: { xs: 'x proximity', md: 'none' },
              WebkitOverflowScrolling: 'touch',
            }}
          >
            {weekDates.map((dateStr, colIdx) => {
              const wd = weekdayOf(dateStr);
              const isToday = dateStr === today;
              const dayNum = String(Number(dateStr.slice(8)));
              const dayOccurrences = occurrences.filter((o) => o.localDate === dateStr);

              return (
                <Box
                  key={dateStr}
                  sx={{
                    minHeight: { xs: 300, md: 430 },
                    scrollSnapAlign: 'start',
                    borderRight:
                      colIdx < weekDates.length - 1 ? '1px solid var(--lifehub-border)' : 'none',
                    backgroundColor: isToday ? 'rgba(79, 70, 229, 0.025)' : 'transparent',
                    display: 'flex',
                    flexDirection: 'column',
                    '&:hover .schedule-col-add': {
                      opacity: 1,
                    },
                  }}
                >
                  {/* 星期列头：左侧星期+日期，右侧悬停直达「+」添加当前星期时段 */}
                  <Stack
                    direction="row"
                    justifyContent="space-between"
                    alignItems="center"
                    sx={{
                      px: 1.25,
                      py: 1,
                      borderBottom: '1px solid var(--lifehub-border)',
                      backgroundColor: isToday ? 'rgba(79, 70, 229, 0.04)' : 'transparent',
                    }}
                  >
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <Typography
                        variant="caption"
                        sx={{
                          fontWeight: isToday ? 700 : 600,
                          fontSize: 12.5,
                          color: isToday ? 'primary.main' : 'var(--lifehub-text-muted)',
                        }}
                      >
                        {WEEKDAY_LABELS[wd]}
                      </Typography>
                      <Box
                        sx={{
                          minWidth: 22,
                          height: 22,
                          px: 0.5,
                          borderRadius: '6px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 12,
                          fontWeight: 700,
                          fontVariantNumeric: 'tabular-nums',
                          backgroundColor: isToday ? 'primary.main' : 'transparent',
                          color: isToday ? '#ffffff' : 'var(--lifehub-text)',
                        }}
                      >
                        {dayNum}
                      </Box>
                    </Stack>

                    <IconButton
                      size="small"
                      className="schedule-col-add lifehub-no-print"
                      onClick={() => handleOpenAddForDate(dateStr)}
                      aria-label={`添加${WEEKDAY_LABELS[wd]}时段`}
                      sx={{
                        p: 0.25,
                        borderRadius: '6px',
                        opacity: { xs: 0.55, md: 0 },
                        transition: 'opacity 0.15s ease',
                        color: 'var(--lifehub-text-muted)',
                        '&:hover': {
                          color: 'primary.main',
                          backgroundColor: 'var(--lifehub-primary-soft)',
                        },
                      }}
                    >
                      <AddOutlined sx={{ fontSize: 15 }} />
                    </IconButton>
                  </Stack>

                  {/* 表格内时段块：8px 规整日历块 + 内嵌竖色条 + 极简圆点勾选，与表格网格浑然一体 */}
                  <Stack spacing={0.75} sx={{ p: 0.85, flex: 1 }}>
                    {dayOccurrences.map((occ) => {
                      const accent = occ.color || '#4F46E5';
                      return (
                        <Box
                          key={`${occ.slotId}:${occ.localDate}`}
                          className="lifehub-schedule-card"
                          data-testid={`schedule-card-${occ.slotId}-${occ.localDate}`}
                          onClick={() => handleOpenEdit(occ.slot)}
                          sx={{
                            p: 0.9,
                            borderRadius: '8px',
                            cursor: 'pointer',
                            backgroundColor: `${accent}10`,
                            border: `1px solid ${accent}26`,
                            opacity: occ.completed ? 0.58 : 1,
                            transition:
                              'opacity 0.15s ease, border-color 0.15s ease, background-color 0.15s ease',
                            '&:hover': {
                              borderColor: `${accent}66`,
                              backgroundColor: `${accent}18`,
                            },
                          }}
                        >
                          <Stack
                            direction="row"
                            justifyContent="space-between"
                            alignItems="center"
                            spacing={0.5}
                          >
                            <Stack direction="row" spacing={0.6} alignItems="center" sx={{ minWidth: 0 }}>
                              <Box
                                sx={{
                                  width: 3,
                                  height: 11,
                                  borderRadius: '99px',
                                  backgroundColor: accent,
                                  flexShrink: 0,
                                }}
                              />
                              <Typography
                                variant="caption"
                                sx={{
                                  fontWeight: 600,
                                  fontSize: 11,
                                  fontVariantNumeric: 'tabular-nums',
                                  color: 'var(--lifehub-text-muted)',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {occ.startTime}-{occ.endTime}
                              </Typography>
                            </Stack>

                            <Checkbox
                              size="small"
                              checked={occ.completed}
                              icon={<RadioButtonUncheckedRounded sx={{ fontSize: 16, opacity: 0.55 }} />}
                              checkedIcon={<CheckCircleRounded sx={{ fontSize: 16 }} />}
                              inputProps={{
                                'aria-label': `完成确认-${occ.title}-${occ.localDate}`,
                              }}
                              data-testid="schedule-complete-toggle"
                              onClick={(e) => e.stopPropagation()}
                              onChange={() => void handleToggleCompletion(occ.slotId, occ.localDate)}
                              sx={{
                                p: 0.25,
                                mr: -0.25,
                                color: 'var(--lifehub-text-muted)',
                                '&.Mui-checked': { color: accent },
                              }}
                            />
                          </Stack>

                          <Typography
                            variant="body2"
                            sx={{
                              fontWeight: 600,
                              fontSize: 13,
                              lineHeight: 1.35,
                              textDecoration: occ.completed ? 'line-through' : 'none',
                              mt: 0.35,
                              color: 'var(--lifehub-text)',
                              wordBreak: 'break-word',
                            }}
                          >
                            {occ.title}
                          </Typography>

                          {occ.location && (
                            <Typography
                              variant="caption"
                              sx={{
                                display: 'block',
                                mt: 0.25,
                                fontSize: 11,
                                color: 'var(--lifehub-text-muted)',
                              }}
                            >
                              {occ.location}
                            </Typography>
                          )}
                        </Box>
                      );
                    })}
                  </Stack>
                </Box>
              );
            })}
          </Box>
        </Paper>
      ) : (
        /* 日视图：12px 单卡片时间线 */
        <Paper
          variant="outlined"
          data-testid="schedule-day-view"
          sx={{
            borderRadius: '12px',
            overflow: 'hidden',
            backgroundColor: 'var(--lifehub-surface)',
            borderColor: 'var(--lifehub-border)',
          }}
        >
          {occurrences.length === 0 ? (
            <Box sx={{ py: 6, px: 3, textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)', mb: 1.5 }}>
                当日暂无安排
              </Typography>
              <Button
                size="small"
                variant="outlined"
                startIcon={<AddOutlined sx={{ fontSize: 16 }} />}
                onClick={() => handleOpenAddForDate(anchorDate)}
                sx={{ borderRadius: '8px' }}
              >
                添加时段
              </Button>
            </Box>
          ) : (
            <Box>
              {occurrences.map((occ, idx) => {
                const accent = occ.color || '#4F46E5';
                return (
                  <Box
                    key={`${occ.slotId}:${occ.localDate}`}
                    className="lifehub-schedule-card"
                    data-testid={`schedule-day-card-${occ.slotId}-${occ.localDate}`}
                    onClick={() => handleOpenEdit(occ.slot)}
                    sx={{
                      px: { xs: 2, sm: 2.5 },
                      py: 1.5,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 1.5,
                      borderBottom:
                        idx < occurrences.length - 1 ? '1px solid var(--lifehub-border)' : 'none',
                      opacity: occ.completed ? 0.6 : 1,
                      '&:hover': { backgroundColor: 'var(--lifehub-surface-hover)' },
                    }}
                  >
                    <Stack
                      direction="row"
                      alignItems="center"
                      spacing={1.5}
                      sx={{ minWidth: 0, flex: 1 }}
                    >
                      <Typography
                        variant="body2"
                        sx={{
                          width: 88,
                          flexShrink: 0,
                          fontWeight: 600,
                          fontSize: 12.5,
                          fontVariantNumeric: 'tabular-nums',
                          color: 'var(--lifehub-text-muted)',
                        }}
                      >
                        {occ.startTime}-{occ.endTime}
                      </Typography>
                      <Box
                        sx={{
                          width: 3.5,
                          height: 24,
                          borderRadius: '99px',
                          backgroundColor: accent,
                          flexShrink: 0,
                        }}
                      />
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography
                          variant="subtitle2"
                          sx={{
                            fontWeight: 700,
                            fontSize: 14,
                            textDecoration: occ.completed ? 'line-through' : 'none',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {occ.title}
                        </Typography>
                        {occ.location && (
                          <Typography
                            variant="caption"
                            sx={{ color: 'var(--lifehub-text-muted)', display: 'block' }}
                          >
                            {occ.location}
                          </Typography>
                        )}
                      </Box>
                    </Stack>

                    <Checkbox
                      checked={occ.completed}
                      icon={<RadioButtonUncheckedRounded sx={{ fontSize: 20, opacity: 0.55 }} />}
                      checkedIcon={<CheckCircleRounded sx={{ fontSize: 20 }} />}
                      data-testid="schedule-complete-toggle"
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => void handleToggleCompletion(occ.slotId, occ.localDate)}
                      sx={{
                        p: 0.5,
                        color: 'var(--lifehub-text-muted)',
                        '&.Mui-checked': { color: accent },
                      }}
                    />
                  </Box>
                );
              })}
            </Box>
          )}
        </Paper>
      )}

      {/* B-01：极简紧凑新增/编辑时段面板（与课表 12px/8px 视觉风格一致，去除生硬分割线） */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        fullWidth
        maxWidth="xs"
        data-testid="schedule-slot-dialog"
        PaperProps={{
          sx: {
            borderRadius: '14px',
            backgroundColor: 'var(--lifehub-surface)',
          },
        }}
      >
        <DialogTitle
          sx={{
            px: { xs: 2, sm: 2.5 },
            pt: 2,
            pb: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Typography variant="subtitle1" component="span" sx={{ fontWeight: 700 }}>
            {editingSlot ? '编辑时段' : '新增时段'}
          </Typography>
          <IconButton size="small" onClick={() => setDialogOpen(false)} aria-label="关闭">
            <CloseRounded sx={{ fontSize: 18 }} />
          </IconButton>
        </DialogTitle>

        <DialogContent sx={{ px: { xs: 2, sm: 2.5 }, pt: 1.75, pb: 1.25 }}>
          <Stack spacing={1.5}>
            {dialogError && (
              <Alert
                severity="error"
                sx={{ py: 0.25, borderRadius: '8px' }}
                onClose={() => setDialogError(null)}
              >
                {dialogError}
              </Alert>
            )}

            {/* 标题 + 内联主题色点 */}
            <TextField
              placeholder="事项名称，如：英语精读 / 健身"
              label="标题"
              fullWidth
              size="small"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              sx={dialogFieldSx}
              inputProps={{ 'data-testid': 'schedule-input-title' }}
            />

            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
              sx={{ py: 0.25 }}
            >
              {SCHEDULE_COLORS.map((c) => {
                const selected = color === c;
                return (
                  <Box
                    key={c}
                    onClick={() => setColor(c)}
                    sx={{
                      width: 20,
                      height: 20,
                      borderRadius: '6px',
                      backgroundColor: c,
                      cursor: 'pointer',
                      transform: selected ? 'scale(1.12)' : 'scale(1)',
                      outline: selected ? `2px solid ${c}` : 'none',
                      outlineOffset: 2,
                      transition: 'transform 0.12s ease',
                    }}
                  />
                );
              })}
            </Stack>

            {/* 起止时间紧凑双列（点击弹出纯净双列滚轮） */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25 }}>
              <WheelTimeField
                label="开始"
                value={startTime}
                inputTestId="schedule-input-start"
                sx={dialogFieldSx}
                onChange={(nextStart) => {
                  const next = adjustTimeRangeOnStartChange(nextStart, startTime, endTime);
                  setStartTime(next.startTime);
                  setEndTime(next.endTime);
                }}
              />
              <WheelTimeField
                label="结束"
                value={endTime}
                inputTestId="schedule-input-end"
                sx={dialogFieldSx}
                onChange={(nextEnd) => {
                  setEndTime(clampEndTimeAfterStart(startTime, nextEnd));
                }}
              />
            </Box>

            {/* 重复规则 + 星期/周期紧凑网格 */}
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: repeatPreset === 'weekly-fixed' ? '1.2fr 0.8fr' : '1fr',
                gap: 1.25,
              }}
            >
              <FormControl fullWidth size="small" sx={dialogFieldSx}>
                <InputLabel id="schedule-repeat-label">重复</InputLabel>
                <Select
                  labelId="schedule-repeat-label"
                  label="重复"
                  value={repeatPreset}
                  onChange={(e) => setRepeatPreset(e.target.value as RepeatPreset)}
                  data-testid="schedule-repeat-select"
                >
                  <MenuItem value="weekly-fixed">每周固定</MenuItem>
                  <MenuItem value="daily">每天</MenuItem>
                  <MenuItem value="workdays">工作日</MenuItem>
                  <MenuItem value="monthly">每月同日</MenuItem>
                  <MenuItem value="custom-rrule">自定义规则</MenuItem>
                </Select>
              </FormControl>

              {repeatPreset === 'weekly-fixed' && (
                <FormControl fullWidth size="small" sx={dialogFieldSx}>
                  <InputLabel id="schedule-weekday-label">星期</InputLabel>
                  <Select
                    labelId="schedule-weekday-label"
                    label="星期"
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
            </Box>

            {repeatPreset === 'custom-rrule' && (
              <TextField
                label="RRULE"
                fullWidth
                size="small"
                value={customRRule}
                onChange={(e) => setCustomRRule(e.target.value)}
                placeholder="FREQ=WEEKLY;BYDAY=MO,WE,FR"
                sx={dialogFieldSx}
              />
            )}

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: syncDurationPreset === 'custom' ? '1.2fr 0.8fr' : '1fr',
                gap: 1.25,
              }}
            >
              <FormControl fullWidth size="small" sx={dialogFieldSx}>
                <InputLabel id="schedule-sync-months-label">有效期</InputLabel>
                <Select
                  labelId="schedule-sync-months-label"
                  label="有效期"
                  value={syncDurationPreset}
                  onChange={(e) => setSyncDurationPreset(e.target.value as SyncDurationPreset)}
                  data-testid="schedule-sync-months-select"
                >
                  <MenuItem value="current-week">仅本周</MenuItem>
                  <MenuItem value="1">1 个月</MenuItem>
                  <MenuItem value="3">3 个月</MenuItem>
                  <MenuItem value="6">半年</MenuItem>
                  <MenuItem value="12">全年</MenuItem>
                  <MenuItem value="forever">长期有效</MenuItem>
                  <MenuItem value="custom">自定义月数</MenuItem>
                </Select>
              </FormControl>

              {syncDurationPreset === 'custom' && (
                <TextField
                  label="月数"
                  type="number"
                  size="small"
                  value={customSyncMonths}
                  onChange={(e) => setCustomSyncMonths(e.target.value)}
                  sx={dialogFieldSx}
                  inputProps={{ min: 1, max: 60, 'data-testid': 'schedule-custom-months-input' }}
                />
              )}
            </Box>

            <Box component="span" data-testid="schedule-sync-range-preview" sx={{ display: 'none' }}>
              {resolvedSyncRange.label}
            </Box>

            {/* 选填项双列并排，避免弹窗拉得过长 */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25 }}>
              <TextField
                label="地点（选填）"
                size="small"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                sx={dialogFieldSx}
                inputProps={{ 'data-testid': 'schedule-input-location' }}
              />
              <TextField
                label="备注（选填）"
                size="small"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                sx={dialogFieldSx}
                inputProps={{ 'data-testid': 'schedule-input-note' }}
              />
            </Box>
          </Stack>
        </DialogContent>

        <DialogActions sx={{ px: { xs: 2, sm: 2.5 }, pt: 1.25, pb: 2 }}>
          {editingSlot && (
            <Button
              color="error"
              onClick={() => void handleDeleteSlot()}
              data-testid="schedule-delete-button"
              sx={{ mr: 'auto', borderRadius: '8px' }}
            >
              删除
            </Button>
          )}
          <Button onClick={() => setDialogOpen(false)} sx={{ borderRadius: '8px' }}>
            取消
          </Button>
          <Button
            variant="contained"
            disableElevation
            onClick={() => void handleSaveSlot()}
            data-testid="schedule-save-button"
            sx={{ borderRadius: '8px', px: 2.25 }}
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
