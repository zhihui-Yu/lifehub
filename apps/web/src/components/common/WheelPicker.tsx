/**
 * 极简纯滚轮时间与日期选择框（WheelTimeField / WheelDateField）。
 *
 * 架构位置：apps/web 的「通用交互组件」层。
 *
 * 设计原则（极简至上）：
 * - 平时就是标准干净的输入框，无多余图标、角标或附加栏；
 * - 点击输入框即弹出轻量纯数字滚轮浮层（时:分 两列 / 年·月·日 三列），无多余按钮、无预设胶囊、无内嵌 Tab；
 * - 滑动或点选即实时生效，点击外部自动收起，100% 杜绝手动输错格式。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type WheelEvent,
} from 'react';
import { Box, IconButton, InputAdornment, Popover, TextField, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import CloseRounded from '@mui/icons-material/CloseRounded';
import { getTodayLocalDate } from '@/modules/shared/date-utils';
import {
  formatHm,
  formatYmd,
  getDaysInYearMonth,
  parseHm,
  parseYmd,
} from './wheel-picker-utils';

/** 单行高度（px）。 */
const ITEM_HEIGHT = 34;
/** 可视行数（上下各 2 行 + 中间选中 1 行）。 */
const VISIBLE_ROWS = 5;
/** 滚轮可视总高度（170px）。 */
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_ROWS;
/** 上下留白高度（68px）。 */
const SPACER_HEIGHT = ((VISIBLE_ROWS - 1) / 2) * ITEM_HEIGHT;

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: String(i).padStart(2, '0'),
}));

const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => ({
  value: i,
  label: String(i).padStart(2, '0'),
}));

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: String(i + 1).padStart(2, '0'),
}));

/** 单列滚轮选项。 */
interface WheelOption {
  value: number;
  label: string;
}

/** 单列滚轮内部属性。 */
interface WheelColumnProps {
  options: readonly WheelOption[];
  value: number;
  onSelect: (nextValue: number) => void;
  onItemClickDone?: () => void;
  ariaLabel: string;
  testId?: string;
}

/**
 * 渲染纯净单列惯性滚轮。
 */
function WheelColumn({
  options,
  value,
  onSelect,
  onItemClickDone,
  ariaLabel,
  testId,
}: WheelColumnProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const programmaticRef = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interactingRef = useRef(false);

  const selectedIndex = useMemo(() => {
    const idx = options.findIndex((o) => o.value === value);
    return idx >= 0 ? idx : 0;
  }, [options, value]);

  const scrollToIndex = useCallback(
    (index: number, smooth: boolean) => {
      const el = scrollRef.current;
      if (!el) return;
      const clamped = Math.max(0, Math.min(options.length - 1, index));
      const top = clamped * ITEM_HEIGHT;
      programmaticRef.current = true;
      if (unlockTimerRef.current) clearTimeout(unlockTimerRef.current);
      try {
        if (smooth && typeof el.scrollTo === 'function') {
          el.scrollTo({ top, behavior: 'smooth' });
        } else {
          el.scrollTop = top;
        }
      } catch {
        el.scrollTop = top;
      }
      unlockTimerRef.current = setTimeout(() => {
        programmaticRef.current = false;
      }, smooth ? 160 : 40);
    },
    [options.length],
  );

  useEffect(() => {
    if (!interactingRef.current) {
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

    interactingRef.current = true;
    const nextIdx = Math.max(0, Math.min(options.length - 1, Math.round(el.scrollTop / ITEM_HEIGHT)));
    const picked = options[nextIdx];
    if (picked !== undefined && picked.value !== value) {
      onSelect(picked.value);
    }

    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      interactingRef.current = false;
      const aligned = nextIdx * ITEM_HEIGHT;
      if (scrollRef.current && Math.abs(scrollRef.current.scrollTop - aligned) > 1) {
        scrollToIndex(nextIdx, true);
      }
    }, 100);
  };

  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (options.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.deltaY > 0 ? 1 : e.deltaY < 0 ? -1 : 0;
    if (step === 0) return;
    const nextIdx = Math.max(0, Math.min(options.length - 1, selectedIndex + step));
    const picked = options[nextIdx];
    if (picked !== undefined) {
      onSelect(picked.value);
      scrollToIndex(nextIdx, true);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const step = e.key === 'ArrowDown' ? 1 : -1;
    const nextIdx = Math.max(0, Math.min(options.length - 1, selectedIndex + step));
    const picked = options[nextIdx];
    if (picked !== undefined) {
      onSelect(picked.value);
      scrollToIndex(nextIdx, true);
    }
  };

  return (
    <Box sx={{ position: 'relative', flex: 1, minWidth: 0, height: WHEEL_HEIGHT, userSelect: 'none' }}>
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          top: SPACER_HEIGHT,
          left: 3,
          right: 3,
          height: ITEM_HEIGHT,
          borderRadius: '7px',
          backgroundColor: 'var(--lifehub-primary-soft)',
          pointerEvents: 'none',
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
          zIndex: 1,
          height: WHEEL_HEIGHT,
          overflowY: 'auto',
          touchAction: 'pan-y',
          scrollSnapType: 'y mandatory',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
          outline: 'none',
        }}
      >
        <Box sx={{ height: SPACER_HEIGHT }} />
        {options.map((opt, idx) => {
          const selected = idx === selectedIndex;
          const dist = Math.abs(idx - selectedIndex);
          return (
            <Box
              key={opt.value}
              role="option"
              aria-selected={selected}
              data-testid={testId ? `${testId}-opt-${opt.value}` : undefined}
              onClick={() => {
                interactingRef.current = false;
                onSelect(opt.value);
                scrollToIndex(idx, true);
                onItemClickDone?.();
              }}
              sx={{
                height: ITEM_HEIGHT,
                scrollSnapAlign: 'center',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                fontVariantNumeric: 'tabular-nums',
                fontSize: selected ? 15 : 13.5,
                fontWeight: selected ? 700 : 400,
                color: selected ? 'primary.main' : 'var(--lifehub-text-muted)',
                opacity: selected ? 1 : dist === 1 ? 0.72 : 0.36,
              }}
            >
              {opt.label}
            </Box>
          );
        })}
        <Box sx={{ height: SPACER_HEIGHT }} />
      </Box>
    </Box>
  );
}

/** 极简时间滚轮输入框属性。 */
export interface WheelTimeFieldProps {
  /** 输入框标题标签。 */
  label: string;
  /** 当前时间值（`HH:mm` 或 `''`）。 */
  value: string;
  /** 变更回调。 */
  onChange: (nextTime: string) => void;
  /** 是否允许一键清空（用于可选时间字段）。 */
  clearable?: boolean;
  /** 测试定位标识。 */
  inputTestId?: string;
  /** 自定义样式。 */
  sx?: SxProps<Theme>;
  /** 是否撑满宽度。 */
  fullWidth?: boolean;
}

/**
 * 渲染极简「时 : 分」双列滚轮时间选择框。
 *
 * @param props 组件属性
 * @returns React 节点
 * @throws 无
 */
export function WheelTimeField({
  label,
  value,
  onChange,
  clearable = false,
  inputTestId,
  sx,
  fullWidth = false,
}: WheelTimeFieldProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const parsed = useMemo(() => parseHm(value || '09:00', '09:00'), [value]);

  const handleOpen = (e: MouseEvent<HTMLDivElement>) => {
    setAnchorEl(e.currentTarget);
  };

  return (
    <>
      <TextField
        fullWidth={fullWidth}
        size="small"
        label={label}
        value={value}
        onClick={handleOpen}
        onChange={(e) => onChange(e.target.value)}
        InputLabelProps={{ shrink: true }}
        InputProps={{
          readOnly: true,
          endAdornment:
            clearable && value ? (
              <InputAdornment position="end" sx={{ mr: -0.75 }}>
                <IconButton
                  size="small"
                  aria-label={`清空${label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange('');
                  }}
                  sx={{ p: 0.25 }}
                >
                  <CloseRounded sx={{ fontSize: 15 }} />
                </IconButton>
              </InputAdornment>
            ) : undefined,
        }}
        inputProps={{
          ...(inputTestId ? { 'data-testid': inputTestId } : {}),
          style: { cursor: 'pointer', fontVariantNumeric: 'tabular-nums' },
        }}
        sx={sx}
      />

      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        marginThreshold={12}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            'data-testid': 'wheel-time-popover',
            sx: {
              mt: 0.5,
              px: 1,
              py: 0.5,
              width: 152,
              maxWidth: 'calc(100vw - 24px)',
              borderRadius: '12px',
              border: '1px solid var(--lifehub-border)',
              backgroundColor: 'var(--lifehub-surface)',
              boxShadow: 'var(--lifehub-shadow-md)',
            },
          } as Record<string, unknown>,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
          <WheelColumn
            options={HOUR_OPTIONS}
            value={parsed.hour}
            onSelect={(h) => onChange(formatHm(h, parsed.minute))}
            ariaLabel={`${label}-时`}
            testId="wheel-col-hour"
          />
          <Typography sx={{ fontWeight: 700, color: 'var(--lifehub-text-muted)', userSelect: 'none' }}>
            :
          </Typography>
          <WheelColumn
            options={MINUTE_OPTIONS}
            value={parsed.minute}
            onSelect={(m) => onChange(formatHm(parsed.hour, m))}
            onItemClickDone={() => setAnchorEl(null)}
            ariaLabel={`${label}-分`}
            testId="wheel-col-minute"
          />
        </Box>
      </Popover>
    </>
  );
}

/** 极简日期滚轮输入框属性。 */
export interface WheelDateFieldProps {
  /** 输入框标题标签。 */
  label: string;
  /** 当前日期值（`YYYY-MM-DD` 或 `''`）。 */
  value: string;
  /** 变更回调。 */
  onChange: (nextDate: string) => void;
  /** 是否允许一键清空（用于筛选栏可选日期）。 */
  clearable?: boolean;
  /** 测试定位标识。 */
  inputTestId?: string;
  /** 自定义样式。 */
  sx?: SxProps<Theme>;
  /** 是否撑满宽度。 */
  fullWidth?: boolean;
}

/**
 * 渲染极简「年 - 月 - 日」三列滚轮日期选择框。
 *
 * @param props 组件属性
 * @returns React 节点
 * @throws 无
 */
export function WheelDateField({
  label,
  value,
  onChange,
  clearable = false,
  inputTestId,
  sx,
  fullWidth = false,
}: WheelDateFieldProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const today = useMemo(() => getTodayLocalDate(), []);
  const parsed = useMemo(() => parseYmd(value || today, today), [today, value]);

  const yearOptions = useMemo(() => {
    const baseYear = parseYmd(today).year;
    const minY = Math.min(baseYear - 15, parsed.year - 2);
    const maxY = Math.max(baseYear + 5, parsed.year + 2);
    const list: WheelOption[] = [];
    for (let y = minY; y <= maxY; y += 1) {
      list.push({ value: y, label: String(y) });
    }
    return list;
  }, [parsed.year, today]);

  const dayOptions = useMemo(() => {
    const days = getDaysInYearMonth(parsed.year, parsed.month);
    return Array.from({ length: days }, (_, i) => ({
      value: i + 1,
      label: String(i + 1).padStart(2, '0'),
    }));
  }, [parsed.month, parsed.year]);

  return (
    <>
      <TextField
        fullWidth={fullWidth}
        size="small"
        label={label}
        value={value}
        onClick={(e) => setAnchorEl(e.currentTarget)}
        onChange={(e) => onChange(e.target.value)}
        InputLabelProps={{ shrink: true }}
        InputProps={{
          readOnly: true,
          endAdornment:
            clearable && value ? (
              <InputAdornment position="end" sx={{ mr: -0.75 }}>
                <IconButton
                  size="small"
                  aria-label={`清空${label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange('');
                  }}
                  sx={{ p: 0.25 }}
                >
                  <CloseRounded sx={{ fontSize: 15 }} />
                </IconButton>
              </InputAdornment>
            ) : undefined,
        }}
        inputProps={{
          ...(inputTestId ? { 'data-testid': inputTestId } : {}),
          style: { cursor: 'pointer', fontVariantNumeric: 'tabular-nums' },
        }}
        sx={sx}
      />

      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        marginThreshold={12}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            'data-testid': 'wheel-date-popover',
            sx: {
              mt: 0.5,
              px: 1,
              py: 0.5,
              width: 212,
              maxWidth: 'calc(100vw - 24px)',
              borderRadius: '12px',
              border: '1px solid var(--lifehub-border)',
              backgroundColor: 'var(--lifehub-surface)',
              boxShadow: 'var(--lifehub-shadow-md)',
            },
          } as Record<string, unknown>,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
          <WheelColumn
            options={yearOptions}
            value={parsed.year}
            onSelect={(y) => onChange(formatYmd(y, parsed.month, parsed.day))}
            ariaLabel={`${label}-年`}
            testId="wheel-col-year"
          />
          <Typography sx={{ color: 'var(--lifehub-text-muted)', userSelect: 'none', fontSize: 13 }}>
            -
          </Typography>
          <WheelColumn
            options={MONTH_OPTIONS}
            value={parsed.month}
            onSelect={(m) => onChange(formatYmd(parsed.year, m, parsed.day))}
            ariaLabel={`${label}-月`}
            testId="wheel-col-month"
          />
          <Typography sx={{ color: 'var(--lifehub-text-muted)', userSelect: 'none', fontSize: 13 }}>
            -
          </Typography>
          <WheelColumn
            options={dayOptions}
            value={parsed.day}
            onSelect={(d) => onChange(formatYmd(parsed.year, parsed.month, d))}
            onItemClickDone={() => setAnchorEl(null)}
            ariaLabel={`${label}-日`}
            testId="wheel-col-day"
          />
        </Box>
      </Popover>
    </>
  );
}
