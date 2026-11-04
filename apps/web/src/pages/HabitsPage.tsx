/**
 * 微习惯打卡页面（模块 C：极简聚焦版）。
 *
 * 架构位置：apps/web 的「页面组件」层，路由 `/habits`。
 *
 * 功能覆盖：
 * - C-01：习惯 CRUD、今日/指定日期一键打卡与撤销；单行极简卡片布局（无冗余小标签、无徽章墙、无热力图）；
 * - C-03：周 / 月 / 年切换完成率统计面板（`data-testid="habit-stats-panel"`，默认收纳在顶部统计按钮中）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
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
 *
 * @returns React 节点
 * @throws 无
 */
export function HabitsPage() {
  const service = useMemo(() => new HabitService(), []);
  const today = useMemo(() => getTodayLocalDate(), []);

  const [referenceDate, setReferenceDate] = useState<string>(today);
  const [period, setPeriod] = useState<HabitStatsPeriod>('week');

  const [habitsWithStats, setHabitsWithStats] = useState<HabitWithStats[]>([]);
  const [periodStats, setPeriodStats] = useState<CombinedPeriodStats | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 新增 / 编辑弹窗状态
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingHabit, setEditingHabit] = useState<StoredHabit | null>(null);
  const [habitName, setHabitName] = useState('');
  const [habitUnit, setHabitUnit] = useState('次');
  const [habitIcon, setHabitIcon] = useState('💧');
  const [habitColor, setHabitColor] = useState('#16A34A');
  const [statsExpanded, setStatsExpanded] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth >= 768,
  );

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

  return (
    <Box data-testid="habits-page" sx={{ width: '100%' }}>
      {/* 移动端日程 / 习惯一键切换胶囊栏（ML-03） */}
      <Paper
        variant="outlined"
        data-testid="schedule-habits-switcher"
        sx={{
          p: 0.75,
          mb: 2,
          borderRadius: 3,
          backgroundColor: 'var(--lifehub-surface)',
          borderColor: 'var(--lifehub-border)',
        }}
      >
        <Stack direction="row" spacing={1} data-testid="schedule-habit-QuickSwitch">
          <Button
            variant="text"
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
            variant="contained"
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
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        spacing={1}
        sx={{ mb: 2.5 }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.25, whiteSpace: 'nowrap' }}>
            习惯打卡
          </Typography>
          <Typography
            variant="caption"
            sx={{
              color: 'var(--lifehub-text-muted)',
              display: 'block',
              mt: 0.25,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {referenceDate.slice(5)} · 已完成 {completedTodayCount}/{habitsWithStats.length}
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
          <Button
            size="small"
            variant={statsExpanded ? 'contained' : 'outlined'}
            color={statsExpanded ? 'secondary' : 'primary'}
            onClick={() => setStatsExpanded((prev) => !prev)}
            data-testid="toggle-habit-stats"
            sx={{ height: 36, px: 1.25, whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            {statsExpanded ? '收起完成率 ▴' : '📊 完成率 ▾'}
          </Button>
          <Button
            size="small"
            variant="contained"
            onClick={handleOpenAdd}
            data-testid="habit-add-button"
            sx={{ height: 36, px: 1.5, whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            + 新增习惯
          </Button>
        </Stack>
      </Stack>

      {errorMsg && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorMsg(null)}>
          {errorMsg}
        </Alert>
      )}

      {/* C-03：精简版完成率统计卡片（手机端默认收起，点击顶部「完成率」按钮展开） */}
      <Box
        data-testid="habit-collapsible-stats"
        sx={{ display: statsExpanded ? 'block' : 'none', mb: 2.5 }}
      >
        <Paper
          variant="outlined"
          data-testid="habit-stats-panel"
          sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: 3 }}
        >
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            spacing={1}
            sx={{ mb: 1.75 }}
          >
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                周期完成率统计
              </Typography>
              <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
                {periodStats?.fromDate ?? ''} ~ {periodStats?.toDate ?? ''}
              </Typography>
            </Box>
            <ToggleButtonGroup
              size="small"
              value={period}
              exclusive
              data-testid="habit-period-toggle"
              onChange={(_e, next: HabitStatsPeriod | null) => {
                if (next) setPeriod(next);
              }}
              sx={{
                height: 32,
                '& .MuiToggleButton-root': { px: 1.25, py: 0, fontSize: 12 },
              }}
            >
              <ToggleButton value="week" data-testid="habit-period-week">
                本周
              </ToggleButton>
              <ToggleButton value="month" data-testid="habit-period-month">
                本月
              </ToggleButton>
              <ToggleButton value="year" data-testid="habit-period-year">
                本年
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 1.25,
            }}
          >
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, textAlign: 'center' }}>
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
            </Paper>

            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, textAlign: 'center' }}>
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
            </Paper>

            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, textAlign: 'center' }}>
              <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
                周期达成率
              </Typography>
              <Typography
                variant="subtitle1"
                sx={{ fontWeight: 700, mt: 0.25 }}
                data-testid="stat-combined-completed"
              >
                {periodStats?.habitCompletionRate ?? 0}%
              </Typography>
            </Paper>
          </Box>
        </Paper>
      </Box>

      {/* C-01：极简习惯打卡列表（单行清晰卡片，去除小标签与徽章干扰，直达打卡核心） */}
      <Box sx={{ mb: 2.5 }}>
        {habitsWithStats.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 3.5, textAlign: 'center', borderRadius: 3 }}>
            <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)' }}>
              还没有创建习惯，点击右上角「+ 新增习惯」开始记录吧。
            </Typography>
          </Paper>
        ) : (
          <Stack spacing={1.25}>
            {habitsWithStats.map((item) => (
              <Paper
                key={item.habit.id}
                variant="outlined"
                data-testid={`habit-card-${item.habit.id}`}
                sx={{
                  px: 2,
                  py: 1.5,
                  borderRadius: 3,
                  borderLeft: `4px solid ${item.habit.color || '#16A34A'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 1.5,
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
                      borderRadius: 2.5,
                      backgroundColor: 'var(--lifehub-surface-hover)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 20,
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
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      累计 {item.streak.totalCompletedDays} {item.habit.unit}
                    </Typography>
                  </Box>
                </Stack>

                <Button
                  size="small"
                  variant={item.completedOnRefDate ? 'contained' : 'outlined'}
                  color={item.completedOnRefDate ? 'success' : 'primary'}
                  data-testid="habit-checkin-toggle"
                  onClick={() => void handleToggleCheckIn(item.habit.id)}
                  sx={{ height: 38, minWidth: 96, px: 1.75, whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  {item.completedOnRefDate ? '✓ 已打卡' : '立即打卡'}
                </Button>
              </Paper>
            ))}
          </Stack>
        )}
      </Box>

      {/* 底部日期翻页栏：三等分网格对齐，整洁对称 */}
      <Paper
        variant="outlined"
        data-testid="habit-bottom-toolbar"
        sx={{
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
          onClick={() => setReferenceDate((d) => addDays(d, -1))}
          sx={{ height: 38 }}
        >
          ← 上一天
        </Button>
        <Button
          size="small"
          variant="outlined"
          fullWidth
          onClick={() => setReferenceDate(today)}
          data-testid="habit-today-button"
          sx={{ height: 38 }}
        >
          今天
        </Button>
        <Button
          size="small"
          variant="outlined"
          fullWidth
          onClick={() => setReferenceDate((d) => addDays(d, 1))}
          sx={{ height: 38 }}
        >
          下一天 →
        </Button>
      </Paper>

      {/* 新增 / 编辑习惯弹窗 */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        fullWidth
        maxWidth="xs"
        data-testid="habit-dialog"
      >
        <DialogTitle>{editingHabit ? '编辑习惯' : '新增习惯'}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField
              label="习惯名称"
              fullWidth
              size="small"
              value={habitName}
              onChange={(e) => setHabitName(e.target.value)}
              inputProps={{ 'data-testid': 'habit-input-name' }}
            />
            <TextField
              label="计数单位"
              fullWidth
              size="small"
              value={habitUnit}
              onChange={(e) => setHabitUnit(e.target.value)}
              inputProps={{ 'data-testid': 'habit-input-unit' }}
            />
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="caption">图标：</Typography>
              {HABIT_ICONS.map((ic) => (
                <Button
                  key={ic}
                  size="small"
                  variant={habitIcon === ic ? 'contained' : 'outlined'}
                  onClick={() => setHabitIcon(ic)}
                  sx={{ minWidth: 34, p: 0.5 }}
                >
                  {ic}
                </Button>
              ))}
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          {editingHabit && (
            <Button
              color="error"
              onClick={() => void handleDeleteHabit()}
              data-testid="habit-delete-button"
            >
              删除习惯
            </Button>
          )}
          <Button onClick={() => setDialogOpen(false)}>取消</Button>
          <Button
            variant="contained"
            onClick={() => void handleSaveHabit()}
            data-testid="habit-save-button"
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
