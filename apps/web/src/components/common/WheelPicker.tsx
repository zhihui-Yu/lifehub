/**
 * 跨平台流畅滚轮时间 / 日期 / 时间段选择器组件集。
 *
 * 架构位置：apps/web 的「通用交互组件」层。
 *
 * 核心特性：
 * 1. 基于 CSS `scroll-snap-type: y mandatory` + 触摸惯性滑动 + 桌面鼠标滚轮步进 + 点击直达，
 *    彻底替代易出错的纯文本手输与固定尺寸原生弹窗，100% 保证产出合法 `HH:mm` / `YYYY-MM-DD`；
 * 2. 适配移动端窄屏与短屏视口：可内嵌展开或作为自适应底部弹性弹窗呈现，底部操作按钮固定常驻不遮挡；
 * 3. 保留底层 `readOnly` `<input>` 的无障碍标签与 `onChange` 契约，兼容键盘导航与自动化测试。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type WheelEvent,
} from 'react';
import {
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AccessTimeRounded from '@mui/icons-material/AccessTimeRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import CloseRounded from '@mui/icons-material/CloseRounded';
import KeyboardArrowDownRounded from '@mui/icons-material/KeyboardArrowDownRounded';
import { addDays } from '@lifehub/core';
import { getMonthRange, getTodayLocalDate } from '@/modules/shared/date-utils';
import {
  adjustTimeRangeOnStartChange,
  clampEndTimeAfterStart,
  formatDurationLabel,
  formatHm,
  formatYmd,
  getDaysInYearMonth,
  hmToMinutes,
  minutesToHm,
  normalizeDateRangeOrder,
  parseHm,
  parseYmd,
} from './wheel-picker-utils';

/** 滚轮单行高度（px）。 */
const ITEM_HEIGHT = 36;
/** 滚轮可视行数（奇数：上下各 2 行 + 中间 1 行选中行）。 */
const VISIBLE_ROWS = 5;
/** 滚轮容器可视总高度（px）。 */
const WHEEL_VIEWPORT_HEIGHT = ITEM_HEIGHT * VISIBLE_ROWS;
/** 上下留白高度（使首尾项均可滚至正中央）。 */
const WHEEL_SPACER_HEIGHT = ((VISIBLE_ROWS - 1) / 2) * ITEM_HEIGHT;

/** 24 小时选项列表（00 ~ 23）。 */
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: `${String(i).padStart(2, '0')} 时`,
}));

/** 60 分钟选项列表（00 ~ 59）。 */
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => ({
  value: i,
  label: `${String(i).padStart(2, '0')} 分`,
}));

/** 12 个月份选项列表（01 ~ 12）。 */
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: `${String(i + 1).padStart(2, '0')} 月`,
}));

/** 课表常用开始时间快捷点。 */
const QUICK_START_TIMES = ['08:00', '09:00', '14:00', '19:00', '20:30'];

/** 课表常用时长增量（分钟）。 */
const QUICK_DURATION_DELTAS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 30, label: '+30分' },
  { minutes: 45, label: '+45分' },
  { minutes: 60, label: '+1小时' },
  { minutes: 90, label: '+1.5小时' },
  { minutes: 120, label: '+2小时' },
];

/** 单列滚轮选项结构。 */
export interface WheelOption<T extends number | string> {
  /** 选项值。 */
  value: T;
  /** 展示文本。 */
  label: string;
}

/** 单列滚轮属性。 */
export interface WheelPickerColumnProps<T extends number | string> {
  /** 选项列表。 */
  options: readonly WheelOption<T>[];
  /** 当前选中值。 */
  value: T;
  /** 选中变更回调。 */
  onChange: (nextValue: T) => void;
  /** 无障碍列标签。 */
  ariaLabel: string;
  /** 测试定位标识。 */
  testId?: string;
}

/**
 * 渲染单列惯性滚轮拨盘（支持手指滑动、鼠标滚轮步进、点击任意行居中与方向键微调）。
 *
 * @param props 组件属性
 * @returns React 节点
 * @throws 无
 */
export function WheelPickerColumn<T extends number | string>({
  options,
  value,
  onChange,
  ariaLabel,
  testId,
}: WheelPickerColumnProps<T>) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const programmaticRef = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userInteractingRef = useRef(false);

  const selectedIndex = useMemo(() => {
    const idx = options.findIndex((opt) => opt.value === value);
    return idx >= 0 ? idx : 0;
  }, [options, value]);

  const scrollToIndex = useCallback((index: number, smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    const clampedIdx = Math.max(0, Math.min(options.length - 1, index));
    const targetTop = clampedIdx * ITEM_HEIGHT;
    programmaticRef.current = true;
    if (unlockTimerRef.current) {
      clearTimeout(unlockTimerRef.current);
    }
    try {
      if (smooth && typeof el.scrollTo === 'function') {
        el.scrollTo({ top: targetTop, behavior: 'smooth' });
      } else {
        el.scrollTop = targetTop;
      }
    } catch {
      el.scrollTop = targetTop;
    }
    unlockTimerRef.current = setTimeout(() => {
      programmaticRef.current = false;
    }, smooth ? 180 : 50);
  }, [options.length]);

  useEffect(() => {
    if (!userInteractingRef.current) {
      scrollToIndex(selectedIndex, false);
    }
  }, [selectedIndex, scrollToIndex]);

  useEffect(() => {
    return () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      if (unlockTimerRef.current) clearTimeout(unlockTimerRef.current);
    };
  }, []);

  const handleScroll = () => {
    if (programmaticRef.current) return;
    const el = scrollRef.current;
    if (!el || options.length === 0) return;

    userInteractingRef.current = true;
    const rawIdx = Math.round(el.scrollTop / ITEM_HEIGHT);
    const nextIdx = Math.max(0, Math.min(options.length - 1, rawIdx));
    const picked = options[nextIdx];
    if (picked !== undefined && picked.value !== value) {
      onChange(picked.value);
    }

    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
    }
    settleTimerRef.current = setTimeout(() => {
      userInteractingRef.current = false;
      const alignedTop = nextIdx * ITEM_HEIGHT;
      if (scrollRef.current && Math.abs(scrollRef.current.scrollTop - alignedTop) > 1) {
        scrollToIndex(nextIdx, true);
      }
    }, 110);
  };

  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (options.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.deltaY > 0 ? 1 : e.deltaY < 0 ? -1 : 0;
    if (step === 0) return;
    const nextIdx = Math.max(0, Math.min(options.length - 1, selectedIndex + step));
    const picked = options[nextIdx];
    if (picked !== undefined && picked.value !== value) {
      onChange(picked.value);
      scrollToIndex(nextIdx, true);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const step = e.key === 'ArrowDown' ? 1 : -1;
    const nextIdx = Math.max(0, Math.min(options.length - 1, selectedIndex + step));
    const picked = options[nextIdx];
    if (picked !== undefined && picked.value !== value) {
      onChange(picked.value);
      scrollToIndex(nextIdx, true);
    }
  };

  return (
    <Box
      sx={{
        position: 'relative',
        flex: 1,
        minWidth: 0,
        height: WHEEL_VIEWPORT_HEIGHT,
        userSelect: 'none',
      }}
    >
      {/* 中央高亮选中指示条 */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          top: WHEEL_SPACER_HEIGHT,
          left: 4,
          right: 4,
          height: ITEM_HEIGHT,
          borderRadius: '8px',
          backgroundColor: 'var(--lifehub-primary-soft)',
          border: '1px solid rgba(79, 70, 229, 0.22)',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />

      {/* 顶部与底部渐隐遮罩 */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: WHEEL_SPACER_HEIGHT - 8,
          background: 'linear-gradient(to bottom, var(--lifehub-surface) 15%, transparent 100%)',
          pointerEvents: 'none',
          zIndex: 2,
        }}
      />
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: WHEEL_SPACER_HEIGHT - 8,
          background: 'linear-gradient(to top, var(--lifehub-surface) 15%, transparent 100%)',
          pointerEvents: 'none',
          zIndex: 2,
        }}
      />

      <Box
        ref={scrollRef}
        role="listbox"
        tabIndex={0}
        aria-label={ariaLabel}
        data-testid={testId}
        onScroll={handleScroll}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        sx={{
          position: 'relative',
          zIndex: 3,
          height: WHEEL_VIEWPORT_HEIGHT,
          overflowY: 'auto',
          scrollSnapType: 'y mandatory',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
          outline: 'none',
        }}
      >
        <Box sx={{ height: WHEEL_SPACER_HEIGHT }} />
        {options.map((opt, idx) => {
          const isSelected = idx === selectedIndex;
          const dist = Math.abs(idx - selectedIndex);
          return (
            <Box
              key={String(opt.value)}
              role="option"
              aria-selected={isSelected}
              data-testid={testId ? `${testId}-opt-${String(opt.value)}` : undefined}
              onClick={() => {
                userInteractingRef.current = false;
                if (opt.value !== value) {
                  onChange(opt.value);
                }
                scrollToIndex(idx, true);
              }}
              sx={{
                height: ITEM_HEIGHT,
                scrollSnapAlign: 'center',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                fontVariantNumeric: 'tabular-nums',
                fontSize: isSelected ? 15 : 13.5,
                fontWeight: isSelected ? 700 : 500,
                color: isSelected ? 'primary.main' : 'var(--lifehub-text-muted)',
                opacity: isSelected ? 1 : dist === 1 ? 0.78 : 0.42,
                transition: 'color 0.12s ease, opacity 0.12s ease, font-size 0.12s ease',
              }}
            >
              {opt.label}
            </Box>
          );
        })}
        <Box sx={{ height: WHEEL_SPACER_HEIGHT }} />
      </Box>
    </Box>
  );
}

/** 课表起止时间段滚轮选择器属性。 */
export interface TimeRangeWheelPickerProps {
  /** 开始时间 `HH:mm`。 */
  startTime: string;
  /** 结束时间 `HH:mm`。 */
  endTime: string;
  /** 时间段变更回调。 */
  onChange: (next: { startTime: string; endTime: string }) => void;
  /** 开始时间输入框测试标识。 */
  startInputTestId?: string;
  /** 结束时间输入框测试标识。 */
  endInputTestId?: string;
}

/**
 * 渲染课表起止时间段双列滚轮选择器（点击开始/结束展开 24 小时制「时·分」滚轮 + 时长快捷预设）。
 *
 * @param props 组件属性
 * @returns React 节点
 * @throws 无
 */
export function TimeRangeWheelPicker({
  startTime,
  endTime,
  onChange,
  startInputTestId = 'schedule-input-start',
  endInputTestId = 'schedule-input-end',
}: TimeRangeWheelPickerProps) {
  const [activeSide, setActiveSide] = useState<'start' | 'end' | null>(null);

  const activeTimeStr = activeSide === 'end' ? endTime : startTime;
  const parsedActive = useMemo(() => parseHm(activeTimeStr), [activeTimeStr]);
  const durationLabel = useMemo(
    () => formatDurationLabel(startTime, endTime),
    [startTime, endTime],
  );

  const applyStartChange = (nextStartRaw: string) => {
    const next = adjustTimeRangeOnStartChange(nextStartRaw, startTime, endTime);
    onChange(next);
  };

  const applyEndChange = (nextEndRaw: string) => {
    const safeEnd = clampEndTimeAfterStart(startTime, nextEndRaw);
    onChange({ startTime, endTime: safeEnd });
  };

  const handleHourChange = (nextHour: number) => {
    const candidate = formatHm(nextHour, parsedActive.minute);
    if (activeSide === 'end') {
      applyEndChange(candidate);
    } else {
      applyStartChange(candidate);
    }
  };

  const handleMinuteChange = (nextMinute: number) => {
    const candidate = formatHm(parsedActive.hour, nextMinute);
    if (activeSide === 'end') {
      applyEndChange(candidate);
    } else {
      applyStartChange(candidate);
    }
  };

  const handleQuickDuration = (deltaMinutes: number) => {
    const startMin = hmToMinutes(startTime);
    const nextEnd = minutesToHm(Math.min(23 * 60 + 59, startMin + deltaMinutes));
    onChange({ startTime, endTime: clampEndTimeAfterStart(startTime, nextEnd) });
  };

  return (
    <Box data-testid="time-range-wheel-picker">
      {/* 起止时间点击触发栏（只读防手输错格式，同时兼容自动化测试 fireEvent.change） */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          gap: 0.85,
        }}
      >
        <TextField
          label="开始"
          size="small"
          value={startTime}
          onClick={() => setActiveSide((prev) => (prev === 'start' ? null : 'start'))}
          onChange={(e) => applyStartChange(e.target.value)}
          InputLabelProps={{ shrink: true }}
          InputProps={{
            readOnly: true,
            endAdornment: (
              <InputAdornment position="end" sx={{ mr: -0.5 }}>
                <AccessTimeRounded
                  sx={{
                    fontSize: 16,
                    color: activeSide === 'start' ? 'primary.main' : 'var(--lifehub-text-muted)',
                  }}
                />
              </InputAdornment>
            ),
          }}
          inputProps={{
            'data-testid': startInputTestId,
            'aria-label': '开始时间',
            style: { cursor: 'pointer', fontVariantNumeric: 'tabular-nums', fontWeight: 600 },
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: '8px',
              backgroundColor:
                activeSide === 'start' ? 'var(--lifehub-primary-soft)' : 'var(--lifehub-bg)',
              cursor: 'pointer',
              '& fieldset': {
                borderColor: activeSide === 'start' ? 'primary.main' : undefined,
              },
            },
          }}
        />

        <Stack alignItems="center" spacing={0.15} sx={{ px: 0.25 }}>
          <ArrowForwardRounded sx={{ fontSize: 15, color: 'var(--lifehub-text-muted)' }} />
          <Typography
            variant="caption"
            data-testid="time-range-duration-badge"
            sx={{
              fontSize: 10.5,
              lineHeight: 1.1,
              color: 'var(--lifehub-text-muted)',
              whiteSpace: 'nowrap',
            }}
          >
            {durationLabel}
          </Typography>
        </Stack>

        <TextField
          label="结束"
          size="small"
          value={endTime}
          onClick={() => setActiveSide((prev) => (prev === 'end' ? null : 'end'))}
          onChange={(e) => applyEndChange(e.target.value)}
          InputLabelProps={{ shrink: true }}
          InputProps={{
            readOnly: true,
            endAdornment: (
              <InputAdornment position="end" sx={{ mr: -0.5 }}>
                <AccessTimeRounded
                  sx={{
                    fontSize: 16,
                    color: activeSide === 'end' ? 'primary.main' : 'var(--lifehub-text-muted)',
                  }}
                />
              </InputAdornment>
            ),
          }}
          inputProps={{
            'data-testid': endInputTestId,
            'aria-label': '结束时间',
            style: { cursor: 'pointer', fontVariantNumeric: 'tabular-nums', fontWeight: 600 },
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: '8px',
              backgroundColor:
                activeSide === 'end' ? 'var(--lifehub-primary-soft)' : 'var(--lifehub-bg)',
              cursor: 'pointer',
              '& fieldset': {
                borderColor: activeSide === 'end' ? 'primary.main' : undefined,
              },
            },
          }}
        />
      </Box>

      {/* 内嵌平滑展开的双列时分滚轮面板（免弹软键盘、免嵌套遮挡） */}
      <Collapse in={activeSide !== null} unmountOnExit>
        <Box
          data-testid="schedule-time-wheel-panel"
          sx={{
            mt: 1,
            p: 1.25,
            borderRadius: '10px',
            border: '1px solid var(--lifehub-border)',
            backgroundColor: 'var(--lifehub-surface)',
          }}
        >
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            spacing={0.75}
            sx={{ mb: 1 }}
          >
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 0.5,
                p: 0.3,
                borderRadius: '8px',
                backgroundColor: 'var(--lifehub-surface-hover)',
                flex: 1,
              }}
            >
              <Button
                size="small"
                disableElevation
                data-testid="wheel-tab-start"
                onClick={() => setActiveSide('start')}
                sx={{
                  py: 0.35,
                  px: 1,
                  minWidth: 0,
                  borderRadius: '6px',
                  fontSize: 12,
                  fontWeight: activeSide === 'start' ? 700 : 500,
                  backgroundColor:
                    activeSide === 'start' ? 'var(--lifehub-surface)' : 'transparent',
                  color: activeSide === 'start' ? 'primary.main' : 'var(--lifehub-text-muted)',
                  boxShadow: activeSide === 'start' ? 'var(--lifehub-shadow-sm)' : 'none',
                }}
              >
                开始 {startTime}
              </Button>
              <Button
                size="small"
                disableElevation
                data-testid="wheel-tab-end"
                onClick={() => setActiveSide('end')}
                sx={{
                  py: 0.35,
                  px: 1,
                  minWidth: 0,
                  borderRadius: '6px',
                  fontSize: 12,
                  fontWeight: activeSide === 'end' ? 700 : 500,
                  backgroundColor:
                    activeSide === 'end' ? 'var(--lifehub-surface)' : 'transparent',
                  color: activeSide === 'end' ? 'primary.main' : 'var(--lifehub-text-muted)',
                  boxShadow: activeSide === 'end' ? 'var(--lifehub-shadow-sm)' : 'none',
                }}
              >
                结束 {endTime}
              </Button>
            </Box>

            <Button
              size="small"
              variant="text"
              data-testid="wheel-time-done"
              onClick={() => setActiveSide(null)}
              sx={{ minWidth: 0, px: 1, py: 0.35, fontSize: 12.5, fontWeight: 700 }}
            >
              完成
            </Button>
          </Stack>

          {/* 快捷预设：开始时间给常用整点，结束时间给常用课表时长 */}
          <Stack
            direction="row"
            spacing={0.5}
            flexWrap="wrap"
            useFlexGap
            sx={{ mb: 0.85 }}
          >
            {activeSide === 'start'
              ? QUICK_START_TIMES.map((preset) => (
                  <Chip
                    key={preset}
                    size="small"
                    label={preset}
                    variant={startTime === preset ? 'filled' : 'outlined'}
                    color={startTime === preset ? 'primary' : 'default'}
                    onClick={() => {
                      applyStartChange(preset);
                    }}
                    sx={{ height: 22, fontSize: 11.5, cursor: 'pointer' }}
                  />
                ))
              : QUICK_DURATION_DELTAS.map((d) => (
                  <Chip
                    key={d.minutes}
                    size="small"
                    label={d.label}
                    variant="outlined"
                    onClick={() => handleQuickDuration(d.minutes)}
                    data-testid={`wheel-quick-duration-${d.minutes}`}
                    sx={{ height: 22, fontSize: 11.5, cursor: 'pointer' }}
                  />
                ))}
          </Stack>

          {/* 双列 24h 时 / 分 滚轮 */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <WheelPickerColumn
              options={HOUR_OPTIONS}
              value={parsedActive.hour}
              onChange={handleHourChange}
              ariaLabel={activeSide === 'end' ? '结束小时' : '开始小时'}
              testId="wheel-col-hour"
            />
            <Typography
              variant="subtitle1"
              sx={{ fontWeight: 800, color: 'var(--lifehub-text-muted)', px: 0.25 }}
            >
              :
            </Typography>
            <WheelPickerColumn
              options={MINUTE_OPTIONS}
              value={parsedActive.minute}
              onChange={handleMinuteChange}
              ariaLabel={activeSide === 'end' ? '结束分钟' : '开始分钟'}
              testId="wheel-col-minute"
            />
          </Box>
        </Box>
      </Collapse>
    </Box>
  );
}

/** 账单记一笔内嵌日期 + 时间滚轮组合字段属性。 */
export interface BillDateTimeWheelFieldsProps {
  /** 日期 `YYYY-MM-DD`。 */
  date: string;
  /** 时间 `HH:mm`（可为空串）。 */
  time: string;
  /** 日期变更回调。 */
  onDateChange: (nextDate: string) => void;
  /** 时间变更回调。 */
  onTimeChange: (nextTime: string) => void;
}

/**
 * 渲染记一笔弹窗中的「日期 + 时间（可选）」滚轮选择组合框。
 *
 * @param props 组件属性
 * @returns React 节点
 * @throws 无
 */
export function BillDateTimeWheelFields({
  date,
  time,
  onDateChange,
  onTimeChange,
}: BillDateTimeWheelFieldsProps) {
  const [activePanel, setActivePanel] = useState<'date' | 'time' | null>(null);
  const today = useMemo(() => getTodayLocalDate(), []);

  const parsedDate = useMemo(() => parseYmd(date, today), [date, today]);
  const parsedTime = useMemo(() => parseHm(time || '12:00', '12:00'), [time]);

  const yearOptions = useMemo(() => {
    const currentYear = parseYmd(today).year;
    const minY = Math.min(currentYear - 15, parsedDate.year - 2);
    const maxY = Math.max(currentYear + 5, parsedDate.year + 2);
    const list: WheelOption<number>[] = [];
    for (let y = minY; y <= maxY; y += 1) {
      list.push({ value: y, label: `${y} 年` });
    }
    return list;
  }, [parsedDate.year, today]);

  const dayOptions = useMemo(() => {
    const maxDays = getDaysInYearMonth(parsedDate.year, parsedDate.month);
    return Array.from({ length: maxDays }, (_, i) => ({
      value: i + 1,
      label: `${String(i + 1).padStart(2, '0')} 日`,
    }));
  }, [parsedDate.month, parsedDate.year]);

  return (
    <Box>
      <Stack direction="row" spacing={1.25}>
        <TextField
          fullWidth
          size="small"
          label="日期"
          value={date}
          onClick={() => setActivePanel((prev) => (prev === 'date' ? null : 'date'))}
          onChange={(event) => onDateChange(event.target.value)}
          InputLabelProps={{ shrink: true }}
          InputProps={{
            readOnly: true,
            endAdornment: (
              <InputAdornment position="end" sx={{ mr: -0.5 }}>
                <CalendarMonthOutlined
                  sx={{
                    fontSize: 16,
                    color: activePanel === 'date' ? 'primary.main' : 'var(--lifehub-text-muted)',
                  }}
                />
              </InputAdornment>
            ),
          }}
          inputProps={{
            style: { cursor: 'pointer', fontVariantNumeric: 'tabular-nums' },
          }}
          sx={{
            flex: 1.25,
            '& .MuiOutlinedInput-root': {
              cursor: 'pointer',
              backgroundColor: activePanel === 'date' ? 'var(--lifehub-primary-soft)' : undefined,
            },
          }}
        />
        <TextField
          fullWidth
          size="small"
          label="时间（可选）"
          placeholder="点击选择"
          value={time}
          onClick={() => {
            if (!time) {
              const now = new Date();
              onTimeChange(formatHm(now.getHours(), now.getMinutes()));
            }
            setActivePanel((prev) => (prev === 'time' ? null : 'time'));
          }}
          onChange={(event) => onTimeChange(event.target.value)}
          InputLabelProps={{ shrink: true }}
          InputProps={{
            readOnly: true,
            endAdornment: (
              <InputAdornment position="end" sx={{ mr: -0.5 }}>
                <AccessTimeRounded
                  sx={{
                    fontSize: 16,
                    color: activePanel === 'time' ? 'primary.main' : 'var(--lifehub-text-muted)',
                  }}
                />
              </InputAdornment>
            ),
          }}
          inputProps={{
            style: { cursor: 'pointer', fontVariantNumeric: 'tabular-nums' },
          }}
          sx={{
            flex: 1,
            '& .MuiOutlinedInput-root': {
              cursor: 'pointer',
              backgroundColor: activePanel === 'time' ? 'var(--lifehub-primary-soft)' : undefined,
            },
          }}
        />
      </Stack>

      <Collapse in={activePanel !== null} unmountOnExit>
        <Box
          data-testid="bill-datetime-wheel-panel"
          sx={{
            mt: 1,
            p: 1.25,
            borderRadius: '10px',
            border: '1px solid var(--lifehub-border)',
            backgroundColor: 'var(--lifehub-surface)',
          }}
        >
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            spacing={0.5}
            sx={{ mb: 0.85 }}
          >
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
              {activePanel === 'date' ? (
                <>
                  <Chip
                    size="small"
                    label="今天"
                    variant={date === today ? 'filled' : 'outlined'}
                    color={date === today ? 'primary' : 'default'}
                    onClick={() => onDateChange(today)}
                    sx={{ height: 22, fontSize: 11.5, cursor: 'pointer' }}
                  />
                  <Chip
                    size="small"
                    label="昨天"
                    variant={date === addDays(today, -1) ? 'filled' : 'outlined'}
                    color={date === addDays(today, -1) ? 'primary' : 'default'}
                    onClick={() => onDateChange(addDays(today, -1))}
                    sx={{ height: 22, fontSize: 11.5, cursor: 'pointer' }}
                  />
                  <Chip
                    size="small"
                    label="前天"
                    variant={date === addDays(today, -2) ? 'filled' : 'outlined'}
                    color={date === addDays(today, -2) ? 'primary' : 'default'}
                    onClick={() => onDateChange(addDays(today, -2))}
                    sx={{ height: 22, fontSize: 11.5, cursor: 'pointer' }}
                  />
                </>
              ) : (
                <>
                  <Chip
                    size="small"
                    label="当前时间"
                    variant="outlined"
                    onClick={() => {
                      const now = new Date();
                      onTimeChange(formatHm(now.getHours(), now.getMinutes()));
                    }}
                    sx={{ height: 22, fontSize: 11.5, cursor: 'pointer' }}
                  />
                  <Chip
                    size="small"
                    label="不填时间"
                    variant={time === '' ? 'filled' : 'outlined'}
                    onClick={() => {
                      onTimeChange('');
                      setActivePanel(null);
                    }}
                    sx={{ height: 22, fontSize: 11.5, cursor: 'pointer' }}
                  />
                </>
              )}
            </Stack>

            <Button
              size="small"
              variant="text"
              onClick={() => setActivePanel(null)}
              sx={{ minWidth: 0, px: 1, py: 0.25, fontSize: 12.5, fontWeight: 700 }}
            >
              收起
            </Button>
          </Stack>

          {activePanel === 'date' ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <WheelPickerColumn
                options={yearOptions}
                value={parsedDate.year}
                onChange={(y) => onDateChange(formatYmd(y, parsedDate.month, parsedDate.day))}
                ariaLabel="选择年份"
                testId="bill-wheel-year"
              />
              <WheelPickerColumn
                options={MONTH_OPTIONS}
                value={parsedDate.month}
                onChange={(m) => onDateChange(formatYmd(parsedDate.year, m, parsedDate.day))}
                ariaLabel="选择月份"
                testId="bill-wheel-month"
              />
              <WheelPickerColumn
                options={dayOptions}
                value={parsedDate.day}
                onChange={(d) => onDateChange(formatYmd(parsedDate.year, parsedDate.month, d))}
                ariaLabel="选择日期"
                testId="bill-wheel-day"
              />
            </Box>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <WheelPickerColumn
                options={HOUR_OPTIONS}
                value={parsedTime.hour}
                onChange={(h) => onTimeChange(formatHm(h, parsedTime.minute))}
                ariaLabel="选择小时"
                testId="bill-wheel-hour"
              />
              <Typography variant="subtitle1" sx={{ fontWeight: 800, color: 'var(--lifehub-text-muted)' }}>
                :
              </Typography>
              <WheelPickerColumn
                options={MINUTE_OPTIONS}
                value={parsedTime.minute}
                onChange={(m) => onTimeChange(formatHm(parsedTime.hour, m))}
                ariaLabel="选择分钟"
                testId="bill-wheel-minute"
              />
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

/** 日期时间段滚轮选择弹窗属性（用于账单与收支统计筛选）。 */
export interface WheelDateRangeDialogProps {
  /** 是否打开弹窗。 */
  open: boolean;
  /** 初始激活侧（开始日期或结束日期）。 */
  initialSide?: 'from' | 'to';
  /** 当前开始日期 `YYYY-MM-DD` 或 `''`。 */
  dateFrom: string;
  /** 当前结束日期 `YYYY-MM-DD` 或 `''`。 */
  dateTo: string;
  /** 关闭回调。 */
  onClose: () => void;
  /** 确认应用区间回调。 */
  onApply: (range: { dateFrom: string; dateTo: string }) => void;
}

/**
 * 渲染自适应手机与桌面的「选择日期时间段」三列滚轮弹窗。
 *
 * @param props 组件属性
 * @returns React 节点
 * @throws 无
 */
export function WheelDateRangeDialog({
  open,
  initialSide = 'from',
  dateFrom,
  dateTo,
  onClose,
  onApply,
}: WheelDateRangeDialogProps) {
  const today = useMemo(() => getTodayLocalDate(), []);
  const [activeSide, setActiveSide] = useState<'from' | 'to'>(initialSide);
  const [draftFrom, setDraftFrom] = useState<string>(dateFrom);
  const [draftTo, setDraftTo] = useState<string>(dateTo);

  useEffect(() => {
    if (!open) return;
    setActiveSide(initialSide);
    setDraftFrom(dateFrom);
    setDraftTo(dateTo);
  }, [open, initialSide, dateFrom, dateTo]);

  const currentSideRaw = activeSide === 'from' ? draftFrom : draftTo;
  const parsedCurrent = useMemo(
    () => parseYmd(currentSideRaw || today, today),
    [currentSideRaw, today],
  );

  const yearOptions = useMemo(() => {
    const currentYear = parseYmd(today).year;
    const minY = Math.min(currentYear - 15, parsedCurrent.year - 2);
    const maxY = Math.max(currentYear + 3, parsedCurrent.year + 2);
    const list: WheelOption<number>[] = [];
    for (let y = minY; y <= maxY; y += 1) {
      list.push({ value: y, label: `${y} 年` });
    }
    return list;
  }, [parsedCurrent.year, today]);

  const dayOptions = useMemo(() => {
    const maxDays = getDaysInYearMonth(parsedCurrent.year, parsedCurrent.month);
    return Array.from({ length: maxDays }, (_, i) => ({
      value: i + 1,
      label: `${String(i + 1).padStart(2, '0')} 日`,
    }));
  }, [parsedCurrent.month, parsedCurrent.year]);

  const updateCurrentSide = (nextYmd: string) => {
    if (activeSide === 'from') {
      setDraftFrom(nextYmd);
    } else {
      setDraftTo(nextYmd);
    }
  };

  const applyQuickPreset = (preset: '7d' | 'this-month' | 'last-month' | '3m' | 'this-year') => {
    if (preset === '7d') {
      setDraftFrom(addDays(today, -6));
      setDraftTo(today);
      return;
    }
    if (preset === 'this-month') {
      const [mStart, mEnd] = getMonthRange(today);
      setDraftFrom(mStart);
      setDraftTo(mEnd);
      return;
    }
    if (preset === 'last-month') {
      const { year, month } = parseYmd(today);
      const prevYear = month === 1 ? year - 1 : year;
      const prevMonth = month === 1 ? 12 : month - 1;
      const refPrev = formatYmd(prevYear, prevMonth, 1);
      const [mStart, mEnd] = getMonthRange(refPrev);
      setDraftFrom(mStart);
      setDraftTo(mEnd);
      return;
    }
    if (preset === '3m') {
      setDraftFrom(addDays(today, -89));
      setDraftTo(today);
      return;
    }
    const { year } = parseYmd(today);
    setDraftFrom(`${year}-01-01`);
    setDraftTo(`${year}-12-31`);
  };

  const handleConfirm = () => {
    const finalFrom =
      activeSide === 'from' && !draftFrom && !draftTo ? formatYmd(parsedCurrent.year, parsedCurrent.month, parsedCurrent.day) : draftFrom;
    const finalTo =
      activeSide === 'to' && !draftTo && !draftFrom ? formatYmd(parsedCurrent.year, parsedCurrent.month, parsedCurrent.day) : draftTo;
    onApply(normalizeDateRangeOrder(finalFrom, finalTo));
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      data-testid="wheel-date-range-dialog"
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
          选择日期时间段
        </Typography>
        <IconButton size="small" onClick={onClose} aria-label="关闭日期选择">
          <CloseRounded sx={{ fontSize: 18 }} />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ px: { xs: 2, sm: 2.5 }, py: 1 }}>
        <Stack spacing={1.25}>
          {/* 常用时间段一键快捷胶囊 */}
          <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              label="近 7 天"
              variant="outlined"
              onClick={() => applyQuickPreset('7d')}
              data-testid="range-preset-7d"
              sx={{ height: 24, fontSize: 12, cursor: 'pointer' }}
            />
            <Chip
              size="small"
              label="本月"
              variant="outlined"
              onClick={() => applyQuickPreset('this-month')}
              data-testid="range-preset-this-month"
              sx={{ height: 24, fontSize: 12, cursor: 'pointer' }}
            />
            <Chip
              size="small"
              label="上月"
              variant="outlined"
              onClick={() => applyQuickPreset('last-month')}
              data-testid="range-preset-last-month"
              sx={{ height: 24, fontSize: 12, cursor: 'pointer' }}
            />
            <Chip
              size="small"
              label="近 3 个月"
              variant="outlined"
              onClick={() => applyQuickPreset('3m')}
              sx={{ height: 24, fontSize: 12, cursor: 'pointer' }}
            />
            <Chip
              size="small"
              label="本年"
              variant="outlined"
              onClick={() => applyQuickPreset('this-year')}
              sx={{ height: 24, fontSize: 12, cursor: 'pointer' }}
            />
          </Stack>

          {/* 开始日期 / 结束日期 分段切换 */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 0.75,
              p: 0.4,
              borderRadius: '10px',
              backgroundColor: 'var(--lifehub-surface-hover)',
            }}
          >
            <Button
              size="small"
              disableElevation
              data-testid="range-tab-from"
              onClick={() => {
                setActiveSide('from');
                if (!draftFrom) {
                  setDraftFrom(draftTo || today);
                }
              }}
              sx={{
                py: 0.6,
                px: 1,
                borderRadius: '8px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                backgroundColor: activeSide === 'from' ? 'var(--lifehub-surface)' : 'transparent',
                color: activeSide === 'from' ? 'primary.main' : 'var(--lifehub-text-muted)',
                boxShadow: activeSide === 'from' ? 'var(--lifehub-shadow-sm)' : 'none',
              }}
            >
              <Typography variant="caption" sx={{ fontSize: 11, opacity: 0.8 }}>
                开始日期
              </Typography>
              <Typography
                variant="body2"
                sx={{ fontWeight: 700, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}
              >
                {draftFrom || '不限'}
              </Typography>
            </Button>

            <Button
              size="small"
              disableElevation
              data-testid="range-tab-to"
              onClick={() => {
                setActiveSide('to');
                if (!draftTo) {
                  setDraftTo(draftFrom || today);
                }
              }}
              sx={{
                py: 0.6,
                px: 1,
                borderRadius: '8px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                backgroundColor: activeSide === 'to' ? 'var(--lifehub-surface)' : 'transparent',
                color: activeSide === 'to' ? 'primary.main' : 'var(--lifehub-text-muted)',
                boxShadow: activeSide === 'to' ? 'var(--lifehub-shadow-sm)' : 'none',
              }}
            >
              <Typography variant="caption" sx={{ fontSize: 11, opacity: 0.8 }}>
                结束日期
              </Typography>
              <Typography
                variant="body2"
                sx={{ fontWeight: 700, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}
              >
                {draftTo || '不限'}
              </Typography>
            </Button>
          </Box>

          {/* 年 / 月 / 日 三列惯性滚轮 */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              px: 0.5,
              py: 0.25,
              borderRadius: '10px',
              border: '1px solid var(--lifehub-border)',
              backgroundColor: 'var(--lifehub-surface)',
            }}
          >
            <WheelPickerColumn
              options={yearOptions}
              value={parsedCurrent.year}
              onChange={(y) => updateCurrentSide(formatYmd(y, parsedCurrent.month, parsedCurrent.day))}
              ariaLabel="筛选年份"
              testId="range-wheel-year"
            />
            <WheelPickerColumn
              options={MONTH_OPTIONS}
              value={parsedCurrent.month}
              onChange={(m) => updateCurrentSide(formatYmd(parsedCurrent.year, m, parsedCurrent.day))}
              ariaLabel="筛选月份"
              testId="range-wheel-month"
            />
            <WheelPickerColumn
              options={dayOptions}
              value={parsedCurrent.day}
              onChange={(d) => updateCurrentSide(formatYmd(parsedCurrent.year, parsedCurrent.month, d))}
              ariaLabel="筛选日"
              testId="range-wheel-day"
            />
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: { xs: 2, sm: 2.5 }, py: 1.5 }}>
        <Button
          size="small"
          color="inherit"
          data-testid="range-wheel-clear"
          onClick={() => {
            onApply({ dateFrom: '', dateTo: '' });
            onClose();
          }}
          sx={{ mr: 'auto', color: 'var(--lifehub-text-muted)' }}
        >
          清空区间
        </Button>
        <Button size="small" onClick={onClose}>
          取消
        </Button>
        <Button
          size="small"
          variant="contained"
          disableElevation
          data-testid="range-wheel-confirm"
          onClick={handleConfirm}
          sx={{ px: 2 }}
        >
          确定
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** 用于过滤栏的只读日期选择输入框属性。 */
export interface FilterDateTriggerFieldProps {
  /** 标签（开始日期 / 结束日期）。 */
  label: string;
  /** 当前日期值 `YYYY-MM-DD` 或 `''`。 */
  value: string;
  /** 点击打开滚轮弹窗回调。 */
  onOpenWheel: () => void;
  /** 直接赋值回调（兼容测试与无障碍输入）。 */
  onDirectChange: (nextValue: string) => void;
  /** 外层可见性。 */
  visible: boolean;
}

/**
 * 渲染过滤栏中的日期选择触发框（点击唤起三列日期滚轮弹窗，杜绝手动输入格式错误）。
 *
 * @param props 组件属性
 * @returns React 节点
 * @throws 无
 */
export function FilterDateTriggerField({
  label,
  value,
  onOpenWheel,
  onDirectChange,
  visible,
}: FilterDateTriggerFieldProps) {
  return (
    <TextField
      size="small"
      label={label}
      placeholder="点击选择"
      value={value}
      onClick={onOpenWheel}
      onChange={(event) => onDirectChange(event.target.value)}
      InputLabelProps={{ shrink: true }}
      InputProps={{
        readOnly: true,
        endAdornment: (
          <InputAdornment position="end" sx={{ mr: -0.75 }}>
            <KeyboardArrowDownRounded sx={{ fontSize: 17, color: 'var(--lifehub-text-muted)' }} />
          </InputAdornment>
        ),
      }}
      inputProps={{
        style: { cursor: 'pointer', fontVariantNumeric: 'tabular-nums' },
      }}
      sx={{
        display: visible ? 'inline-flex' : 'none',
        flex: { xs: '1 1 calc(50% - 4px)', sm: '0 0 auto' },
        minWidth: { xs: 0, sm: 142 },
        '& .MuiOutlinedInput-root': {
          backgroundColor: 'var(--lifehub-surface)',
          borderRadius: '8px',
          cursor: 'pointer',
        },
      }}
    />
  );
}
