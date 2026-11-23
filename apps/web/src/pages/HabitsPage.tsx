/**
 * 微习惯打卡页面（模块 C：支持「按次打勾」与「定量累加」双模式，及周/月/年累计总量统计）。
 *
 * 架构位置：apps/web 的「页面组件」层，路由 `/habits`。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import AddOutlined from '@mui/icons-material/AddOutlined';
import BarChartOutlined from '@mui/icons-material/BarChartOutlined';
import ChevronLeftOutlined from '@mui/icons-material/ChevronLeftOutlined';
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import EditNoteOutlined from '@mui/icons-material/EditNoteOutlined';
import { addDays } from '@lifehub/core';
import { getTodayLocalDate } from '@/modules/shared/date-utils';
import {
  formatHabitAmount,
  HabitService,
  isQuantityHabit,
  type CombinedPeriodStats,
  type HabitStatsPeriod,
  type HabitTrackingMode,
  type HabitWithStats,
  type StoredHabit,
} from '@/modules/habits/habit-service';

/** 习惯可选图标预设。 */
const HABIT_ICONS = ['💧', '🏃', '📚', '🧘', '🍎', '✍️', '💤', '✨'];

/** 常用计量单位快捷预设。 */
const QUICK_UNITS: ReadonlyArray<{
  unit: string;
  mode: HabitTrackingMode;
  suggestedIncrement: string;
  suggestedTarget: string;
}> = [
  { unit: 'ml', mode: 'quantity', suggestedIncrement: '250', suggestedTarget: '2000' },
  { unit: 'km', mode: 'quantity', suggestedIncrement: '', suggestedTarget: '5' },
  { unit: '分钟', mode: 'quantity', suggestedIncrement: '30', suggestedTarget: '60' },
  { unit: '页', mode: 'quantity', suggestedIncrement: '20', suggestedTarget: '30' },
  { unit: '次', mode: 'check', suggestedIncrement: '', suggestedTarget: '' },
];

/** 周期中文名映射。 */
const PERIOD_LABEL_MAP: Record<HabitStatsPeriod, string> = {
  week: '本周',
  month: '本月',
  year: '本年',
};

/**
 * 格式化 ISO 时间戳为本地 `HH:mm` 时分文本。
 *
 * @param iso ISO 8601 时间字符串
 * @returns `HH:mm` 文本
 */
function formatTimeHm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '--:--';
  }
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * 渲染微习惯打卡页面。
 *
 * @returns React 节点
 */
export function HabitsPage() {
  const service = useMemo(() => new HabitService(), []);
  const today = useMemo(() => getTodayLocalDate(), []);

  const [referenceDate, setReferenceDate] = useState<string>(today);
  const [period, setPeriod] = useState<HabitStatsPeriod>('week');

  const [habitsWithStats, setHabitsWithStats] = useState<HabitWithStats[]>([]);
  const [periodStats, setPeriodStats] = useState<CombinedPeriodStats | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statsExpanded, setStatsExpanded] = useState(false);

  // 新增 / 编辑习惯配置弹窗状态
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingHabit, setEditingHabit] = useState<StoredHabit | null>(null);
  const [habitName, setHabitName] = useState('');
  const [habitTrackingMode, setHabitTrackingMode] = useState<HabitTrackingMode>('check');
  const [habitUnit, setHabitUnit] = useState('次');
  const [habitDefaultIncrement, setHabitDefaultIncrement] = useState('');
  const [habitDailyTarget, setHabitDailyTarget] = useState('');
  const [habitIcon, setHabitIcon] = useState('💧');
  const [habitColor, setHabitColor] = useState('#16A34A');

  // 定量累加 / 当日明细记录弹窗状态
  const [quantityDialogHabitId, setQuantityDialogHabitId] = useState<string | null>(null);
  const [quantityInput, setQuantityInput] = useState('');
  const [quantityDialogError, setQuantityDialogError] = useState<string | null>(null);

  const reloadData = useCallback(async () => {
    try {
      const [list, stats] = await Promise.all([
        service.listHabitsWithStats(referenceDate),
        service.getPeriodStats(referenceDate, period),
      ]);
      setHabitsWithStats(list);
      setPeriodStats(stats);
      setErrorMsg(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '加载习惯数据失败');
    }
  }, [period, referenceDate, service]);

  useEffect(() => {
    void reloadData();
  }, [reloadData]);

  const activeQuantityItem = useMemo(
    () =>
      quantityDialogHabitId
        ? habitsWithStats.find((item) => item.habit.id === quantityDialogHabitId) ?? null
        : null,
    [habitsWithStats, quantityDialogHabitId],
  );

  const handleOpenAdd = () => {
    setEditingHabit(null);
    setHabitName('');
    setHabitTrackingMode('check');
    setHabitUnit('次');
    setHabitDefaultIncrement('');
    setHabitDailyTarget('');
    setHabitIcon('💧');
    setHabitColor('#16A34A');
    setDialogOpen(true);
  };

  const handleOpenEdit = (habit: StoredHabit) => {
    setEditingHabit(habit);
    setHabitName(habit.name);
    setHabitTrackingMode(isQuantityHabit(habit) ? 'quantity' : 'check');
    setHabitUnit(habit.unit || '次');
    setHabitDefaultIncrement(
      habit.defaultIncrement && habit.defaultIncrement > 0
        ? formatHabitAmount(habit.defaultIncrement)
        : '',
    );
    setHabitDailyTarget(
      habit.dailyTarget && habit.dailyTarget > 0 ? formatHabitAmount(habit.dailyTarget) : '',
    );
    setHabitIcon(habit.icon);
    setHabitColor(habit.color);
    setDialogOpen(true);
  };

  const handleSaveHabit = async () => {
    try {
      const parsedInc = habitDefaultIncrement.trim()
        ? Number.parseFloat(habitDefaultIncrement.trim())
        : null;
      const parsedTarget = habitDailyTarget.trim()
        ? Number.parseFloat(habitDailyTarget.trim())
        : null;

      if (
        habitTrackingMode === 'quantity' &&
        parsedInc !== null &&
        (!Number.isFinite(parsedInc) || parsedInc < 0)
      ) {
        setErrorMsg('单次快捷步长请填写大于等于 0 的数字');
        return;
      }
      if (
        habitTrackingMode === 'quantity' &&
        parsedTarget !== null &&
        (!Number.isFinite(parsedTarget) || parsedTarget < 0)
      ) {
        setErrorMsg('每日参考目标请填写大于等于 0 的数字');
        return;
      }

      const payload = {
        name: habitName,
        unit: habitUnit,
        trackingMode: habitTrackingMode,
        defaultIncrement: habitTrackingMode === 'quantity' ? parsedInc : null,
        dailyTarget: habitTrackingMode === 'quantity' ? parsedTarget : null,
        icon: habitIcon,
        color: habitColor,
      };

      if (editingHabit) {
        await service.updateHabit(editingHabit.id, payload);
      } else {
        await service.createHabit(payload);
      }
      setDialogOpen(false);
      await reloadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '保存习惯失败');
    }
  };

  const handleDeleteHabit = async () => {
    if (!editingHabit) return;
    await service.deleteHabit(editingHabit.id);
    setDialogOpen(false);
    await reloadData();
  };

  const handleToggleCheckIn = async (habitId: string) => {
    await service.toggleCheckIn(habitId, referenceDate);
    await reloadData();
  };

  const handleQuickAddQuantity = async (habit: StoredHabit) => {
    const inc = habit.defaultIncrement ?? 0;
    if (inc <= 0) {
      handleOpenQuantityDialog(habit);
      return;
    }
    try {
      await service.addQuantityCheckIn(habit.id, inc, referenceDate);
      await reloadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '记录打卡数量失败');
    }
  };

  const handleOpenQuantityDialog = (habit: StoredHabit) => {
    setQuantityDialogHabitId(habit.id);
    setQuantityInput(
      habit.defaultIncrement && habit.defaultIncrement > 0
        ? formatHabitAmount(habit.defaultIncrement)
        : '',
    );
    setQuantityDialogError(null);
  };

  const handleCloseQuantityDialog = () => {
    setQuantityDialogHabitId(null);
    setQuantityInput('');
    setQuantityDialogError(null);
  };

  const handleConfirmAddQuantity = async () => {
    if (!activeQuantityItem) return;
    const val = Number.parseFloat(quantityInput.trim());
    if (!Number.isFinite(val) || val <= 0) {
      setQuantityDialogError('请输入大于 0 的数字（支持小数，如 3.5 或 250）');
      return;
    }
    try {
      await service.addQuantityCheckIn(activeQuantityItem.habit.id, val, referenceDate);
      setQuantityDialogError(null);
      handleCloseQuantityDialog();
      await reloadData();
    } catch (err) {
      setQuantityDialogError(err instanceof Error ? err.message : '累加记录失败');
    }
  };

  const handleSetDailyTotalDirectly = async () => {
    if (!activeQuantityItem) return;
    const val = Number.parseFloat(quantityInput.trim());
    if (!Number.isFinite(val) || val < 0) {
      setQuantityDialogError('请输入大于等于 0 的数字（填 0 可清空当日记录）');
      return;
    }
    try {
      await service.setDailyQuantity(activeQuantityItem.habit.id, val, referenceDate);
      setQuantityDialogError(null);
      handleCloseQuantityDialog();
      await reloadData();
    } catch (err) {
      setQuantityDialogError(err instanceof Error ? err.message : '设置当日总量失败');
    }
  };

  const handleRemoveSingleEntry = async (entryId: string) => {
    if (!activeQuantityItem) return;
    await service.removeQuantityEntry(activeQuantityItem.habit.id, entryId, referenceDate);
    await reloadData();
  };

  const handleClearDayQuantity = async () => {
    if (!activeQuantityItem) return;
    await service.clearCheckIn(activeQuantityItem.habit.id, referenceDate);
    handleCloseQuantityDialog();
    await reloadData();
  };

  const completedTodayCount = useMemo(
    () => habitsWithStats.filter((item) => item.completedOnRefDate).length,
    [habitsWithStats],
  );

  const isToday = referenceDate === today;

  return (
    <Box data-testid="habits-page" sx={{ width: '100%' }}>
      {/* 移动端分段切换（课表 | 习惯）—— 与课表页保持完全相同的 8px/10px 风格 */}
      <Box
        data-testid="schedule-habits-switcher"
        className="lifehub-mobile-only"
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
              fontWeight: 600,
              fontSize: 13,
              color: 'var(--lifehub-text-muted)',
              backgroundColor: 'transparent',
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
              fontWeight: 700,
              fontSize: 13,
              color: 'var(--lifehub-text)',
              backgroundColor: 'var(--lifehub-surface)',
              boxShadow: 'var(--lifehub-shadow-sm)',
              '&:hover': { backgroundColor: 'var(--lifehub-surface)' },
            }}
          >
            习惯
          </Button>
        </Box>
      </Box>

      {/* 顶部标题 + 日期切换 + 操作栏 */}
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        spacing={1}
        flexWrap="wrap"
        useFlexGap
        sx={{ mb: 1.75 }}
      >
        <Stack direction="row" alignItems="center" spacing={1.25} flexWrap="wrap">
          <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: '-0.01em' }}>
            习惯
          </Typography>

          <Stack
            direction="row"
            alignItems="center"
            spacing={0.25}
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
              onClick={() => setReferenceDate((d) => addDays(d, -1))}
              aria-label="上一天"
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
              }}
            >
              {isToday ? `今天 ${referenceDate.slice(5)}` : referenceDate.slice(5)}
            </Typography>
            <IconButton
              size="small"
              onClick={() => setReferenceDate((d) => addDays(d, 1))}
              aria-label="下一天"
              sx={{ p: 0.35, borderRadius: '6px' }}
            >
              <ChevronRightOutlined sx={{ fontSize: 18 }} />
            </IconButton>
          </Stack>

          {!isToday ? (
            <Button
              size="small"
              variant="text"
              onClick={() => setReferenceDate(today)}
              data-testid="habit-today-button"
              sx={{ minWidth: 0, px: 1, py: 0.35, borderRadius: '8px', fontSize: 12.5, fontWeight: 600 }}
            >
              今天
            </Button>
          ) : (
            <Box component="span" sx={{ display: 'none' }}>
              <button
                type="button"
                data-testid="habit-today-button"
                onClick={() => setReferenceDate(today)}
              >
                今天
              </button>
            </Box>
          )}

          {habitsWithStats.length > 0 && (
            <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)', fontWeight: 500 }}>
              {completedTodayCount}/{habitsWithStats.length}
            </Typography>
          )}
        </Stack>

        <Stack direction="row" spacing={0.65} alignItems="center">
          <Tooltip title="周/月/年累计统计">
            <IconButton
              size="small"
              onClick={() => setStatsExpanded((prev) => !prev)}
              data-testid="toggle-habit-stats"
              aria-label="周期统计"
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
          <Button
            size="small"
            variant="contained"
            disableElevation
            startIcon={<AddOutlined sx={{ fontSize: 17 }} />}
            onClick={handleOpenAdd}
            data-testid="habit-add-button"
            sx={{ height: 34, px: 1.5, borderRadius: '8px', fontWeight: 600 }}
          >
            新增
          </Button>
        </Stack>
      </Stack>

      {errorMsg && (
        <Alert severity="error" sx={{ mb: 2, borderRadius: '10px' }} onClose={() => setErrorMsg(null)}>
          {errorMsg}
        </Alert>
      )}

      {/* 周期统计面板（周 / 月 / 年总览 + 各习惯累计总量） */}
      <Collapse in={statsExpanded} data-testid="habit-collapsible-stats">
        <Paper
          variant="outlined"
          data-testid="habit-stats-panel"
          sx={{
            p: { xs: 2, sm: 2.25 },
            mb: 1.75,
            borderRadius: '12px',
            backgroundColor: 'var(--lifehub-surface)',
            borderColor: 'var(--lifehub-border)',
          }}
        >
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            spacing={1}
            sx={{ mb: 1.5 }}
          >
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              周期统计
              <Typography
                component="span"
                variant="caption"
                sx={{ ml: 1, color: 'var(--lifehub-text-muted)', fontWeight: 400 }}
              >
                {periodStats?.fromDate.slice(5) ?? ''} ~ {periodStats?.toDate.slice(5) ?? ''}
              </Typography>
            </Typography>
            <ToggleButtonGroup
              size="small"
              value={period}
              exclusive
              data-testid="habit-period-toggle"
              onChange={(_e, next: HabitStatsPeriod | null) => {
                if (next) setPeriod(next);
              }}
              sx={{
                p: 0.3,
                borderRadius: '8px',
                backgroundColor: 'var(--lifehub-surface-hover)',
                '& .MuiToggleButtonGroup-grouped': {
                  border: 0,
                  borderRadius: '6px !important',
                  px: 1.25,
                  py: 0.25,
                  fontSize: 12,
                  fontWeight: 600,
                  '&.Mui-selected': {
                    backgroundColor: 'var(--lifehub-surface)',
                    color: 'var(--lifehub-text)',
                    boxShadow: 'var(--lifehub-shadow-sm)',
                  },
                },
              }}
            >
              <ToggleButton value="week" data-testid="habit-period-week">
                周
              </ToggleButton>
              <ToggleButton value="month" data-testid="habit-period-month">
                月
              </ToggleButton>
              <ToggleButton value="year" data-testid="habit-period-year">
                年
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              pt: 1.25,
              borderTop: '1px solid var(--lifehub-border)',
            }}
          >
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
                习惯打卡
              </Typography>
              <Typography
                variant="subtitle1"
                sx={{ fontWeight: 700, color: 'success.main', mt: 0.25 }}
                data-testid="stat-habit-completed"
              >
                {periodStats?.habitCompletedCount ?? 0} 次
              </Typography>
            </Box>

            <Box
              sx={{
                textAlign: 'center',
                borderLeft: '1px solid var(--lifehub-border)',
                borderRight: '1px solid var(--lifehub-border)',
              }}
            >
              <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
                课表完成
              </Typography>
              <Typography
                variant="subtitle1"
                sx={{ fontWeight: 700, color: 'primary.main', mt: 0.25 }}
                data-testid="stat-schedule-completed"
              >
                {periodStats?.scheduleCompletedCount ?? 0} 次
              </Typography>
            </Box>

            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
                达成率
              </Typography>
              <Typography
                variant="subtitle1"
                sx={{ fontWeight: 700, mt: 0.25 }}
                data-testid="stat-combined-completed"
              >
                {periodStats?.habitCompletionRate ?? 0}%
              </Typography>
            </Box>
          </Box>

          {/* 各习惯周/月/年累计总量统计（展开周期统计面板时渲染，避免折叠态在 DOM 中重复渲染同名习惯节点） */}
          {statsExpanded && periodStats && periodStats.habitSummaries.length > 0 && (
            <Box
              data-testid="habit-period-breakdown"
              sx={{
                mt: 1.5,
                pt: 1.25,
                borderTop: '1px dashed var(--lifehub-border)',
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  color: 'var(--lifehub-text-muted)',
                  fontWeight: 600,
                  display: 'block',
                  mb: 0.85,
                }}
              >
                各习惯{PERIOD_LABEL_MAP[period]}累计（每天完成计 1 次，数值按日汇总）
              </Typography>
              <Stack spacing={0.75}>
                {periodStats.habitSummaries.map((summary) => (
                  <Box
                    key={summary.habitId}
                    data-testid={`habit-period-item-${summary.habitId}`}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 1,
                      px: 1.25,
                      py: 0.75,
                      borderRadius: '8px',
                      backgroundColor: 'var(--lifehub-surface-hover)',
                    }}
                  >
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                      <Typography component="span" sx={{ fontSize: 16, lineHeight: 1 }}>
                        {summary.icon}
                      </Typography>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 600,
                            fontSize: 13.2,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {summary.name}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
                          打卡 {summary.completedDays} 天
                          {summary.trackingMode === 'quantity' && summary.completedDays > 0
                            ? ` · 打卡日均 ${formatHabitAmount(summary.averagePerCompletedDay)} ${summary.unit}`
                            : ''}
                        </Typography>
                      </Box>
                    </Stack>

                    <Typography
                      variant="body2"
                      data-testid={`habit-period-total-${summary.habitId}`}
                      sx={{
                        fontWeight: 700,
                        fontVariantNumeric: 'tabular-nums',
                        color: summary.totalQuantity > 0 ? 'var(--lifehub-text)' : 'var(--lifehub-text-muted)',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      共 {formatHabitAmount(summary.totalQuantity)} {summary.unit}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </Box>
          )}
        </Paper>
      </Collapse>

      {/* 一体式单卡片习惯清单 */}
      <Paper
        variant="outlined"
        sx={{
          borderRadius: '12px',
          overflow: 'hidden',
          backgroundColor: 'var(--lifehub-surface)',
          borderColor: 'var(--lifehub-border)',
        }}
      >
        {habitsWithStats.length === 0 ? (
          <Box sx={{ py: 6, px: 3, textAlign: 'center' }}>
            <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)', mb: 1.5 }}>
              暂无习惯
            </Typography>
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddOutlined sx={{ fontSize: 16 }} />}
              onClick={handleOpenAdd}
              sx={{ borderRadius: '8px' }}
            >
              添加习惯
            </Button>
          </Box>
        ) : (
          <Box>
            {habitsWithStats.map((item, idx) => {
              const accent = item.habit.color || '#16A34A';
              const isQty = isQuantityHabit(item.habit);
              const defaultInc = item.habit.defaultIncrement ?? 0;
              const dailyTarget = item.habit.dailyTarget ?? 0;
              const progressPct =
                isQty && dailyTarget > 0
                  ? Math.min(100, Math.round((item.refDateValue / dailyTarget) * 100))
                  : 0;

              return (
                <Box
                  key={item.habit.id}
                  data-testid={`habit-card-${item.habit.id}`}
                  sx={{
                    px: { xs: 1.75, sm: 2.5 },
                    py: 1.6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1.25,
                    borderBottom:
                      idx < habitsWithStats.length - 1 ? '1px solid var(--lifehub-border)' : 'none',
                    '&:hover': { backgroundColor: 'var(--lifehub-surface-hover)' },
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={1.4}
                    alignItems="center"
                    sx={{ cursor: 'pointer', minWidth: 0, flex: 1 }}
                    onClick={() => handleOpenEdit(item.habit)}
                  >
                    <Box
                      sx={{
                        width: 40,
                        height: 40,
                        borderRadius: '10px',
                        backgroundColor: item.completedOnRefDate
                          ? `${accent}18`
                          : 'var(--lifehub-surface-hover)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 19,
                        flexShrink: 0,
                      }}
                    >
                      {item.habit.icon}
                    </Box>

                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        <Typography
                          variant="subtitle1"
                          sx={{
                            fontWeight: 700,
                            fontSize: 14.5,
                            lineHeight: 1.3,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.habit.name}
                        </Typography>
                        {isQty && item.completedOnRefDate && (
                          <Chip
                            size="small"
                            label={`✓ ${formatHabitAmount(item.refDateValue)}${
                              dailyTarget > 0 ? `/${formatHabitAmount(dailyTarget)}` : ''
                            } ${item.habit.unit}`}
                            color="success"
                            variant="outlined"
                            data-testid={`habit-daily-badge-${item.habit.id}`}
                            sx={{
                              height: 20,
                              fontSize: 11.5,
                              fontWeight: 700,
                              '& .MuiChip-label': { px: 0.8 },
                            }}
                          />
                        )}
                      </Stack>

                      <Typography
                        variant="caption"
                        sx={{
                          color: 'var(--lifehub-text-muted)',
                          display: 'block',
                          mt: 0.2,
                        }}
                      >
                        {isQty
                          ? `${
                              !item.completedOnRefDate
                                ? `今日 0${dailyTarget > 0 ? `/${formatHabitAmount(dailyTarget)}` : ''} ${item.habit.unit} · `
                                : ''
                            }打卡 ${item.streak.totalCompletedDays} 天 · 总计 ${formatHabitAmount(
                              item.totalQuantityAllTime,
                            )} ${item.habit.unit}`
                          : `累计 ${item.streak.totalCompletedDays} ${item.habit.unit}`}
                      </Typography>

                      {isQty && dailyTarget > 0 && item.refDateValue > 0 && (
                        <LinearProgress
                          variant="determinate"
                          value={progressPct}
                          color="success"
                          sx={{
                            mt: 0.6,
                            height: 4,
                            maxWidth: 180,
                            borderRadius: 2,
                            backgroundColor: 'var(--lifehub-surface-hover)',
                          }}
                        />
                      )}
                    </Box>
                  </Stack>

                  {/* 右侧打卡操作区 */}
                  {isQty ? (
                    <Stack direction="row" spacing={0.65} alignItems="center" sx={{ flexShrink: 0 }}>
                      {defaultInc > 0 ? (
                        <>
                          <Button
                            size="small"
                            disableElevation
                            variant={item.completedOnRefDate ? 'contained' : 'outlined'}
                            color={item.completedOnRefDate ? 'success' : 'primary'}
                            data-testid={`habit-quick-add-${item.habit.id}`}
                            onClick={() => void handleQuickAddQuantity(item.habit)}
                            sx={{
                              height: 34,
                              px: 1.35,
                              borderRadius: '8px',
                              fontWeight: 700,
                              fontVariantNumeric: 'tabular-nums',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            +{formatHabitAmount(defaultInc)} {item.habit.unit}
                          </Button>
                          <Tooltip title="自定义累加 / 查看或修改今日明细">
                            <IconButton
                              size="small"
                              data-testid={`habit-quantity-open-${item.habit.id}`}
                              aria-label="自定义数量与明细"
                              onClick={() => handleOpenQuantityDialog(item.habit)}
                              sx={{
                                width: 34,
                                height: 34,
                                borderRadius: '8px',
                                border: '1px solid var(--lifehub-border)',
                                color: 'var(--lifehub-text-muted)',
                              }}
                            >
                              <EditNoteOutlined sx={{ fontSize: 18 }} />
                            </IconButton>
                          </Tooltip>
                        </>
                      ) : (
                        <Button
                          size="small"
                          disableElevation
                          variant={item.completedOnRefDate ? 'contained' : 'outlined'}
                          color={item.completedOnRefDate ? 'success' : 'primary'}
                          data-testid={`habit-quantity-open-${item.habit.id}`}
                          onClick={() => handleOpenQuantityDialog(item.habit)}
                          sx={{
                            height: 34,
                            minWidth: 88,
                            px: 1.5,
                            borderRadius: '8px',
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.completedOnRefDate
                            ? `+ 继续加 ${item.habit.unit}`
                            : `+ 记录 ${item.habit.unit}`}
                        </Button>
                      )}
                    </Stack>
                  ) : (
                    <Button
                      size="small"
                      disableElevation
                      variant={item.completedOnRefDate ? 'contained' : 'outlined'}
                      color={item.completedOnRefDate ? 'success' : 'primary'}
                      data-testid="habit-checkin-toggle"
                      onClick={() => void handleToggleCheckIn(item.habit.id)}
                      sx={{
                        height: 34,
                        minWidth: 88,
                        px: 1.75,
                        borderRadius: '8px',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      {item.completedOnRefDate ? '✓ 已打卡' : '立即打卡'}
                    </Button>
                  )}
                </Box>
              );
            })}
          </Box>
        )}
      </Paper>

      {/* 新增 / 编辑习惯弹窗 */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        fullWidth
        maxWidth="xs"
        data-testid="habit-dialog"
        PaperProps={{
          sx: { borderRadius: '14px', backgroundColor: 'var(--lifehub-surface)' },
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
            {editingHabit ? '编辑习惯' : '新增习惯'}
          </Typography>
          <IconButton size="small" onClick={() => setDialogOpen(false)} aria-label="关闭">
            <CloseRounded sx={{ fontSize: 18 }} />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ px: { xs: 2, sm: 2.5 }, py: 1 }}>
          <Stack spacing={1.5}>
            {/* 记录模式切换 */}
            <ToggleButtonGroup
              size="small"
              fullWidth
              exclusive
              value={habitTrackingMode}
              data-testid="habit-mode-toggle"
              onChange={(_e, next: HabitTrackingMode | null) => {
                if (!next) return;
                setHabitTrackingMode(next);
                if (next === 'quantity' && habitUnit === '次') {
                  setHabitUnit('ml');
                } else if (next === 'check' && !habitUnit.trim()) {
                  setHabitUnit('次');
                }
              }}
              sx={{
                p: 0.35,
                borderRadius: '9px',
                backgroundColor: 'var(--lifehub-surface-hover)',
                '& .MuiToggleButtonGroup-grouped': {
                  border: 0,
                  borderRadius: '7px !important',
                  py: 0.5,
                  px: { xs: 1, sm: 1.5 },
                  fontSize: { xs: 12, sm: 12.5 },
                  fontWeight: 600,
                  '&.Mui-selected': {
                    backgroundColor: 'var(--lifehub-surface)',
                    color: 'var(--lifehub-text)',
                    boxShadow: 'var(--lifehub-shadow-sm)',
                  },
                },
              }}
            >
              <ToggleButton value="check" data-testid="habit-mode-check">
                按次打勾（每天1次）
              </ToggleButton>
              <ToggleButton value="quantity" data-testid="habit-mode-quantity">
                定量累加（ml / km）
              </ToggleButton>
            </ToggleButtonGroup>

            <TextField
              label="名称"
              placeholder={habitTrackingMode === 'quantity' ? '如：喝水、跑步、阅读' : '如：早睡、冥想'}
              fullWidth
              size="small"
              value={habitName}
              onChange={(e) => setHabitName(e.target.value)}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px', backgroundColor: 'var(--lifehub-bg)' } }}
              inputProps={{ 'data-testid': 'habit-input-name' }}
            />

            <Box>
              <TextField
                label="计数单位"
                placeholder="如：ml、km、分钟、页、次"
                fullWidth
                size="small"
                value={habitUnit}
                onChange={(e) => setHabitUnit(e.target.value)}
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px', backgroundColor: 'var(--lifehub-bg)' } }}
                inputProps={{ 'data-testid': 'habit-input-unit' }}
              />
              <Stack direction="row" spacing={0.6} sx={{ mt: 0.75 }} flexWrap="wrap" useFlexGap>
                {QUICK_UNITS.map((preset) => (
                  <Chip
                    key={preset.unit}
                    size="small"
                    label={preset.unit}
                    variant={habitUnit === preset.unit ? 'filled' : 'outlined'}
                    color={habitUnit === preset.unit ? 'primary' : 'default'}
                    onClick={() => {
                      setHabitUnit(preset.unit);
                      setHabitTrackingMode(preset.mode);
                      if (preset.mode === 'quantity' && !editingHabit) {
                        setHabitDefaultIncrement(preset.suggestedIncrement);
                        setHabitDailyTarget(preset.suggestedTarget);
                      }
                    }}
                    sx={{ height: 22, fontSize: 11.5, cursor: 'pointer' }}
                  />
                ))}
              </Stack>
            </Box>

            {habitTrackingMode === 'quantity' && (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: 1.25,
                }}
              >
                <TextField
                  label="单次快捷加量（选填）"
                  placeholder={`如 250（留空则手填）`}
                  size="small"
                  type="number"
                  value={habitDefaultIncrement}
                  onChange={(e) => setHabitDefaultIncrement(e.target.value)}
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px', backgroundColor: 'var(--lifehub-bg)' } }}
                  inputProps={{
                    step: 'any',
                    min: 0,
                    'data-testid': 'habit-input-increment',
                  }}
                />
                <TextField
                  label="每日参考目标（选填）"
                  placeholder={`如 2000 或 5`}
                  size="small"
                  type="number"
                  value={habitDailyTarget}
                  onChange={(e) => setHabitDailyTarget(e.target.value)}
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px', backgroundColor: 'var(--lifehub-bg)' } }}
                  inputProps={{
                    step: 'any',
                    min: 0,
                    'data-testid': 'habit-input-target',
                  }}
                />
              </Box>
            )}

            <Stack direction="row" spacing={0.65} alignItems="center" flexWrap="wrap" useFlexGap>
              {HABIT_ICONS.map((ic) => (
                <Button
                  key={ic}
                  size="small"
                  disableElevation
                  variant={habitIcon === ic ? 'contained' : 'text'}
                  onClick={() => setHabitIcon(ic)}
                  sx={{ minWidth: 36, height: 36, p: 0, borderRadius: '8px', fontSize: 18 }}
                >
                  {ic}
                </Button>
              ))}
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: { xs: 2, sm: 2.5 }, pt: 1.25, pb: 2 }}>
          {editingHabit && (
            <Button
              color="error"
              onClick={() => void handleDeleteHabit()}
              data-testid="habit-delete-button"
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
            onClick={() => void handleSaveHabit()}
            data-testid="habit-save-button"
            sx={{ borderRadius: '8px', px: 2.25 }}
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>

      {/* 定量累加记录 & 当日分次明细弹窗 */}
      <Dialog
        open={Boolean(activeQuantityItem)}
        onClose={handleCloseQuantityDialog}
        fullWidth
        maxWidth="xs"
        data-testid="habit-quantity-dialog"
        PaperProps={{
          sx: { borderRadius: '14px', backgroundColor: 'var(--lifehub-surface)' },
        }}
      >
        {activeQuantityItem && (
          <>
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
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography component="span" sx={{ fontSize: 19 }}>
                  {activeQuantityItem.habit.icon}
                </Typography>
                <Box>
                  <Typography variant="subtitle1" component="span" sx={{ fontWeight: 700 }}>
                    {activeQuantityItem.habit.name}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ display: 'block', color: 'var(--lifehub-text-muted)' }}
                  >
                    {isToday ? '今日' : referenceDate}已累计{' '}
                    <strong>
                      {formatHabitAmount(activeQuantityItem.refDateValue)}{' '}
                      {activeQuantityItem.habit.unit}
                    </strong>
                  </Typography>
                </Box>
              </Stack>
              <IconButton size="small" onClick={handleCloseQuantityDialog} aria-label="关闭">
                <CloseRounded sx={{ fontSize: 18 }} />
              </IconButton>
            </DialogTitle>

            <DialogContent sx={{ px: { xs: 2, sm: 2.5 }, py: 1 }}>
              <Stack spacing={1.5}>
                {quantityDialogError && (
                  <Alert severity="error" sx={{ py: 0.25, borderRadius: '8px' }}>
                    {quantityDialogError}
                  </Alert>
                )}

                <TextField
                  label={`输入数量（${activeQuantityItem.habit.unit}，支持小数如 3.5）`}
                  placeholder={`例如：${
                    activeQuantityItem.habit.unit === 'km' ? '3.5' : '250'
                  }`}
                  fullWidth
                  size="small"
                  autoFocus
                  type="number"
                  value={quantityInput}
                  onChange={(e) => setQuantityInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleConfirmAddQuantity();
                    }
                  }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: '8px',
                      backgroundColor: 'var(--lifehub-bg)',
                    },
                  }}
                  inputProps={{
                    step: 'any',
                    min: 0,
                    'data-testid': 'habit-quantity-input',
                  }}
                />

                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: 1,
                  }}
                >
                  <Button
                    fullWidth
                    variant="contained"
                    disableElevation
                    data-testid="habit-quantity-add-confirm"
                    onClick={() => void handleConfirmAddQuantity()}
                    sx={{ borderRadius: '8px', fontWeight: 700, px: 1 }}
                  >
                    + 累加本次
                  </Button>
                  <Button
                    fullWidth
                    variant="outlined"
                    data-testid="habit-quantity-set-total"
                    onClick={() => void handleSetDailyTotalDirectly()}
                    sx={{ borderRadius: '8px', fontWeight: 600, px: 1 }}
                  >
                    设为当日总量
                  </Button>
                </Box>

                {activeQuantityItem.refDateEntries.length > 0 && (
                  <Box
                    data-testid="habit-quantity-entry-list"
                    sx={{
                      pt: 1,
                      borderTop: '1px solid var(--lifehub-border)',
                    }}
                  >
                    <Typography
                      variant="caption"
                      sx={{
                        color: 'var(--lifehub-text-muted)',
                        fontWeight: 600,
                        display: 'block',
                        mb: 0.75,
                      }}
                    >
                      当日分次明细（共 {activeQuantityItem.refDateEntries.length} 笔）
                    </Typography>
                    <Stack spacing={0.5} sx={{ maxHeight: 160, overflowY: 'auto' }}>
                      {activeQuantityItem.refDateEntries.map((entry) => (
                        <Box
                          key={entry.id}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            px: 1.1,
                            py: 0.5,
                            borderRadius: '7px',
                            backgroundColor: 'var(--lifehub-surface-hover)',
                          }}
                        >
                          <Typography variant="caption" sx={{ color: 'var(--lifehub-text)' }}>
                            <Box
                              component="span"
                              sx={{ color: 'var(--lifehub-text-muted)', mr: 1 }}
                            >
                              {formatTimeHm(entry.createdAt)}
                            </Box>
                            <strong>
                              +{formatHabitAmount(entry.amount)} {activeQuantityItem.habit.unit}
                            </strong>
                          </Typography>
                          <IconButton
                            size="small"
                            aria-label="删除单条记录"
                            data-testid={`habit-delete-entry-${entry.id}`}
                            onClick={() => void handleRemoveSingleEntry(entry.id)}
                            sx={{ p: 0.35, color: 'var(--lifehub-text-muted)' }}
                          >
                            <DeleteOutline sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                )}
              </Stack>
            </DialogContent>

            <DialogActions sx={{ px: { xs: 2, sm: 2.5 }, pt: 1, pb: 2 }}>
              {activeQuantityItem.completedOnRefDate && (
                <Button
                  color="error"
                  size="small"
                  data-testid="habit-quantity-clear-day"
                  onClick={() => void handleClearDayQuantity()}
                  sx={{ mr: 'auto', borderRadius: '8px' }}
                >
                  清空当日打卡
                </Button>
              )}
              <Button onClick={handleCloseQuantityDialog} sx={{ borderRadius: '8px' }}>
                关闭
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}
