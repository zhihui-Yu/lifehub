/**
 * 微习惯打卡页面（模块 C：一体式清爽列表版）。
 *
 * 架构位置：apps/web 的「页面组件」层，路由 `/habits`。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
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
import { addDays } from '@lifehub/core';
import { getTodayLocalDate } from '@/modules/shared/date-utils';
import {
  HabitService,
  type CombinedPeriodStats,
  type HabitStatsPeriod,
  type HabitWithStats,
  type StoredHabit,
} from '@/modules/habits/habit-service';

/** 习惯可选图标预设。 */
const HABIT_ICONS = ['💧', '📚', '🏃', '🧘', '🍎', '✍️', '💤', '✨'];

/**
 * 渲染微习惯打卡页面。
 */
export function HabitsPage() {
  const service = useMemo(() => new HabitService(), []);
  const today = useMemo(() => getTodayLocalDate(), []);

  const [referenceDate, setReferenceDate] = useState<string>(today);
  const [period, setPeriod] = useState<HabitStatsPeriod>('week');

  const [habitsWithStats, setHabitsWithStats] = useState<HabitWithStats[]>([]);
  const [periodStats, setPeriodStats] = useState<CombinedPeriodStats | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingHabit, setEditingHabit] = useState<StoredHabit | null>(null);
  const [habitName, setHabitName] = useState('');
  const [habitUnit, setHabitUnit] = useState('次');
  const [habitIcon, setHabitIcon] = useState('💧');
  const [habitColor, setHabitColor] = useState('#16A34A');
  const [statsExpanded, setStatsExpanded] = useState(false);

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

  const handleOpenAdd = () => {
    setEditingHabit(null);
    setHabitName('');
    setHabitUnit('次');
    setHabitIcon('💧');
    setHabitColor('#16A34A');
    setDialogOpen(true);
  };

  const handleOpenEdit = (habit: StoredHabit) => {
    setEditingHabit(habit);
    setHabitName(habit.name);
    setHabitUnit(habit.unit);
    setHabitIcon(habit.icon);
    setHabitColor(habit.color);
    setDialogOpen(true);
  };

  const handleSaveHabit = async () => {
    try {
      if (editingHabit) {
        await service.updateHabit(editingHabit.id, {
          name: habitName,
          unit: habitUnit,
          icon: habitIcon,
          color: habitColor,
        });
      } else {
        await service.createHabit({
          name: habitName,
          unit: habitUnit,
          icon: habitIcon,
          color: habitColor,
        });
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
          <Tooltip title="周期统计">
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

      {/* 周期统计面板 */}
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
        </Paper>
      </Collapse>

      {/* 一体式单卡片习惯清单（12px 卡片 + 8px 按钮） */}
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
              return (
                <Box
                  key={item.habit.id}
                  data-testid={`habit-card-${item.habit.id}`}
                  sx={{
                    px: { xs: 2, sm: 2.5 },
                    py: 1.6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1.5,
                    borderBottom:
                      idx < habitsWithStats.length - 1 ? '1px solid var(--lifehub-border)' : 'none',
                    '&:hover': { backgroundColor: 'var(--lifehub-surface-hover)' },
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={1.5}
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
                    <Box sx={{ minWidth: 0 }}>
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
                      <Typography
                        variant="caption"
                        sx={{
                          color: 'var(--lifehub-text-muted)',
                          display: 'block',
                          mt: 0.15,
                        }}
                      >
                        累计 {item.streak.totalCompletedDays} {item.habit.unit}
                      </Typography>
                    </Box>
                  </Stack>

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
            px: 2.5,
            pt: 2.25,
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
        <DialogContent sx={{ px: 2.5, py: 1 }}>
          <Stack spacing={1.5}>
            <TextField
              label="名称"
              fullWidth
              size="small"
              value={habitName}
              onChange={(e) => setHabitName(e.target.value)}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px', backgroundColor: 'var(--lifehub-bg)' } }}
              inputProps={{ 'data-testid': 'habit-input-name' }}
            />
            <TextField
              label="计数单位"
              fullWidth
              size="small"
              value={habitUnit}
              onChange={(e) => setHabitUnit(e.target.value)}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px', backgroundColor: 'var(--lifehub-bg)' } }}
              inputProps={{ 'data-testid': 'habit-input-unit' }}
            />
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
        <DialogActions sx={{ px: 2.5, pt: 1.25, pb: 2 }}>
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
    </Box>
  );
}
