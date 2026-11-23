/**
 * 极简纯滚轮时间与日期选择框（WheelTimeField / WheelDateField）。
 *
 * 架构位置：apps/web 的「通用交互组件」层。
 *
 * 设计原则（极简至上 & 零抖动）：
 * - 平时为标准干净输入框，点击弹出纯数字滚轮浮层（使用 Fade 过渡消除缩放果冻感）；
 * - 首次挂载在绘制前（useLayoutEffect）同步定位，消除打开瞬间跳动；
 * - 选项字号恒定不触发重排，拦截 mousedown 默认聚焦滚动，消除点击与滚轮时的二次回弹抖动。
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type WheelEvent,
} from 'react';
import {
  Box,
  Fade,
  IconButton,
  InputAdornment,
  Popover,
  TextField,
  Typography,
} from '@mui/material';
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
 * 渲染纯净零抖动单列滚轮。
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
  const rafRef = useRef<number | null>(null);
  const didInitialPositionRef = useRef(false);
  const lastCommittedValueRef = useRef<number>(value);

  const selectedIndex = useMemo(() => {
    const idx = options.findIndex((o) => o.value === value);
    return idx >= 0 ? idx : 0;
  }, [options, value]);

  const cancelOngoingAnimation = useCallback(() => {
    if (rafRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const moveScrollTo = useCallback(
    (index: number, smooth: boolean) => {
      const el = scrollRef.current;
      if (!el || options.length === 0) return;
      const clamped = Math.max(0, Math.min(options.length - 1, index));
      const targetTop = clamped * ITEM_HEIGHT;

      cancelOngoingAnimation();

      if (
        !smooth ||
        typeof requestAnimationFrame !== 'function' ||
        typeof performance === 'undefined' ||
        Math.abs(el.scrollTop - targetTop) < 1
      ) {
        programmaticRef.current = true;
        el.style.scrollSnapType = 'y mandatory';
        el.scrollTop = targetTop;
        programmaticRef.current = false;
        return;
      }

      // 使用确定性的 120ms easeOutCubic 帧动画：全程关闭 scroll-snap，在精确到达目标像素的那一帧恢复，彻底杜绝二次吸附抖动
      const startTop = el.scrollTop;
      const delta = targetTop - startTop;
      const durationMs = 120;
      const startAt = performance.now();

      programmaticRef.current = true;
      el.style.scrollSnapType = 'none';

      const tick = (now: number) => {
        const node = scrollRef.current;
        if (!node) {
          programmaticRef.current = false;
          rafRef.current = null;
          return;
        }
        const t = Math.min(1, Math.max(0, (now - startAt) / durationMs));
        const eased = 1 - Math.pow(1 - t, 3);
        node.scrollTop = startTop + delta * eased;

        if (t < 1) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          node.scrollTop = targetTop;
          node.style.scrollSnapType = 'y mandatory';
          programmaticRef.current = false;
          rafRef.current = null;
        }
      };

      rafRef.current = requestAnimationFrame(tick);
    },
    [cancelOngoingAnimation, options.length],
  );

  // 首帧绘制前同步定位到当前选中项；外部受控值被动变化（如开始时间带动结束时间顺延）时无动画同步
  useLayoutEffect(() => {
    if (!didInitialPositionRef.current) {
      didInitialPositionRef.current = true;
      lastCommittedValueRef.current = value;
      moveScrollTo(selectedIndex, false);
      return;
    }
    if (value !== lastCommittedValueRef.current && !programmaticRef.current) {
      lastCommittedValueRef.current = value;
      moveScrollTo(selectedIndex, false);
    }
  }, [moveScrollTo, selectedIndex, value]);

  useEffect(() => {
    return () => {
      cancelOngoingAnimation();
    };
  }, [cancelOngoingAnimation]);

  const handleScroll = () => {
    if (programmaticRef.current) return;
    const el = scrollRef.current;
    if (!el || options.length === 0) return;

    const nextIdx = Math.max(0, Math.min(options.length - 1, Math.round(el.scrollTop / ITEM_HEIGHT)));
    const picked = options[nextIdx];
    if (picked !== undefined && picked.value !== value) {
      lastCommittedValueRef.current = picked.value;
      onSelect(picked.value);
    }
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
      lastCommittedValueRef.current = picked.value;
      onSelect(picked.value);
      moveScrollTo(nextIdx, true);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const step = e.key === 'ArrowDown' ? 1 : -1;
    const nextIdx = Math.max(0, Math.min(options.length - 1, selectedIndex + step));
    const picked = options[nextIdx];
    if (picked !== undefined) {
      lastCommittedValueRef.current = picked.value;
      onSelect(picked.value);
      moveScrollTo(nextIdx, true);
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
          scrollBehavior: 'auto',
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
              onMouseDown={(e) => {
                // 阻止浏览器 mousedown 默认将焦点滚入视口引起的先跳一下再居中的抖动
                e.preventDefault();
              }}
              onClick={() => {
                lastCommittedValueRef.current = opt.value;
                onSelect(opt.value);
                if (onItemClickDone) {
                  onItemClickDone();
                } else {
                  moveScrollTo(idx, true);
                }
              }}
              sx={{
                height: ITEM_HEIGHT,
                scrollSnapAlign: 'center',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                fontVariantNumeric: 'tabular-nums',
                fontSize: 14,
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
        TransitionComponent={Fade}
        transitionDuration={110}
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
        TransitionComponent={Fade}
        transitionDuration={110}
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
