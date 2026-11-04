/**
 * 账单编辑对话框（记一笔 / 编辑一笔）。
 *
 * 架构位置：apps/web 的「账单组件」层。
 *
 * 说明：新增与编辑共用同一对话框；`initial` 为 null 时是「记一笔」。
 * 表单只收集**明文输入**，组装成 `ManualBillInput` 后交给 `onSubmit`，
 * 由上层（页面）负责校验与落库，错误信息回显到对话框。
 */
import { useEffect, useState } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import type { Bill, Category, Direction } from '@lifehub/core';
import { toLocalDate, toWallClock } from '@lifehub/core';
import type { ManualBillInput } from '@/lib/bill-factory';
import { lookupRememberedCategoryId } from '@/lib/category-memory';
import { useBillStore, useSettingsStore } from '@/store';

/** 账单编辑对话框的属性。 */
export interface BillEditDialogProps {
  /** 是否打开。 */
  open: boolean;
  /** 被编辑的账单；null 表示新增。 */
  initial: Bill | null;
  /** 分类列表（用于分类下拉）。 */
  categories: Category[];
  /** 关闭回调。 */
  onClose: () => void;
  /** 提交回调；返回 true 表示成功（对话框关闭），false / 抛错表示失败（保持打开并提示）。 */
  onSubmit: (input: ManualBillInput, options?: { rememberCategory?: boolean }) => Promise<boolean>;
}

/** 方向选项。 */
const DIRECTION_OPTIONS: { value: Direction; label: string }[] = [
  { value: 'expense', label: '支出' },
  { value: 'income', label: '收入' },
  { value: 'refund', label: '退款' },
];

/**
 * 渲染账单编辑对话框。
 *
 * @param props 组件属性
 * @returns React 节点
 */
export function BillEditDialog({ open, initial, categories, onClose, onSubmit }: BillEditDialogProps) {
  const timezone = useSettingsStore((state) => state.timezone);
  const allBills = useBillStore((state) => state.bills);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [amountText, setAmountText] = useState('');
  const [direction, setDirection] = useState<Direction>('expense');
  const [counterparty, setCounterparty] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [note, setNote] = useState('');
  const [rememberCategory, setRememberCategory] = useState(true);
  const [userModifiedCategory, setUserModifiedCategory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // 打开或切换编辑对象时，按用户在设置中配置的默认时区回填表单字段。
  useEffect(() => {
    if (!open) {
      return;
    }
    const effectiveTimeZone =
      timezone ||
      (typeof Intl !== 'undefined'
        ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        : 'UTC');
    if (initial) {
      const parsedInstant = new Date(initial.occurredAt);
      const isValidInstant = !Number.isNaN(parsedInstant.getTime());
      let resolvedDate = initial.localDate;
      let resolvedTime = '00:00';
      if (isValidInstant) {
        try {
          if (
            !(
              effectiveTimeZone === 'Asia/Shanghai' &&
              initial.sourceTimeZone === 'Asia/Shanghai' &&
              initial.localDate === initial.occurredAt.slice(0, 10)
            )
          ) {
            resolvedDate = toLocalDate(parsedInstant, effectiveTimeZone);
          }
          resolvedTime = toWallClock(parsedInstant, effectiveTimeZone);
        } catch {
          resolvedDate = initial.localDate;
          resolvedTime = toWallClock(parsedInstant, 'UTC');
        }
      }
      setDate(resolvedDate);
      setTime(resolvedTime);
      setAmountText((initial.amountMinor / 100).toString());
      setDirection(initial.direction);
      setCounterparty(initial.counterparty);
      const rememberedForInitial =
        !initial.categoryId
          ? lookupRememberedCategoryId(
              { counterparty: initial.counterparty, note: initial.note },
              allBills,
            )
          : null;
      setCategoryId(initial.categoryId ?? rememberedForInitial ?? '');
      setNote(initial.note);
    } else {
      let todayInTimezone = new Date().toISOString().slice(0, 10);
      try {
        todayInTimezone = toLocalDate(new Date(), effectiveTimeZone);
      } catch {
        // 时区标识异常时回退 UTC 日期。
      }
      setDate(todayInTimezone);
      setTime('');
      setAmountText('');
      setDirection('expense');
      setCounterparty('');
      setCategoryId('');
      setNote('');
    }
    setRememberCategory(true);
    setUserModifiedCategory(false);
    setBusy(false);
    setLocalError(null);
  }, [open, initial, timezone, allBills]);

  // 当「记一笔」或「编辑未分类账单」且用户尚未手动改过分类时，输入已知交易对方/备注自动回填记住的分类。
  useEffect(() => {
    if (!open || userModifiedCategory || (initial && initial.categoryId)) {
      return;
    }
    const matched = lookupRememberedCategoryId({ counterparty, note }, allBills);
    if (matched && categories.some((c) => c.id === matched)) {
      setCategoryId(matched);
    }
  }, [open, counterparty, note, userModifiedCategory, initial, allBills, categories]);

  const handleSubmit = async (): Promise<void> => {
    setBusy(true);
    setLocalError(null);
    try {
      const input: ManualBillInput = {
        date,
        time: time.trim() === '' ? undefined : time.trim(),
        amountText,
        direction,
        counterparty,
        categoryId: categoryId === '' ? null : categoryId,
        note,
      };
      const ok = await onSubmit(input, { rememberCategory });
      if (ok) {
        onClose();
      }
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : '保存失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth aria-labelledby="bill-edit-title">
      <DialogTitle id="bill-edit-title">{initial ? '编辑账单' : '记一笔'}</DialogTitle>
      <DialogContent>
        <TextField
          fullWidth
          size="small"
          margin="dense"
          type="date"
          label="日期"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          fullWidth
          size="small"
          margin="dense"
          type="time"
          label="时间（可选）"
          value={time}
          onChange={(event) => setTime(event.target.value)}
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          fullWidth
          size="small"
          margin="dense"
          type="number"
          inputProps={{ min: 0, step: '0.01' }}
          label="金额（元）"
          value={amountText}
          onChange={(event) => setAmountText(event.target.value)}
        />
        <FormControl fullWidth size="small" margin="dense">
          <InputLabel id="bill-direction-label">方向</InputLabel>
          <Select
            labelId="bill-direction-label"
            label="方向"
            value={direction}
            onChange={(event) => setDirection(event.target.value as Direction)}
          >
            {DIRECTION_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          fullWidth
          size="small"
          margin="dense"
          label="交易对方"
          value={counterparty}
          onChange={(event) => setCounterparty(event.target.value)}
        />
        <FormControl fullWidth size="small" margin="dense">
          <InputLabel id="bill-category-label">分类</InputLabel>
          <Select
            labelId="bill-category-label"
            label="分类"
            value={categoryId}
            onChange={(event) => {
              setUserModifiedCategory(true);
              setCategoryId(event.target.value);
            }}
          >
            <MenuItem value="">未分类</MenuItem>
            {categories.map((category) => (
              <MenuItem key={category.id} value={category.id}>
                {category.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControlLabel
          sx={{ mt: 0.25, mb: 0.25, ml: 0 }}
          control={
            <Checkbox
              size="small"
              checked={rememberCategory}
              onChange={(event) => setRememberCategory(event.target.checked)}
              data-testid="remember-category-checkbox"
            />
          }
          label={
            <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
              记住此次分类选择（相同交易对方/备注的未分类账单及后续导入将自动归入此分类）
            </Typography>
          }
        />
        <TextField
          fullWidth
          size="small"
          margin="dense"
          label="备注"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        {localError ? (
          <Typography variant="body2" color="error" sx={{ mt: 1 }}>
            {localError}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          取消
        </Button>
        <Button variant="contained" onClick={() => void handleSubmit()} disabled={busy}>
          {initial ? '保存' : '记一笔'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
