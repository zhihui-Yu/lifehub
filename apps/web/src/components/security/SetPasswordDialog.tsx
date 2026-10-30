/**
 * 设置主密码对话框。
 *
 * 架构位置：apps/web 的「安全组件」层。
 *
 * 阻断式设计（X-02 ②）：**必须勾选**「我已知悉忘记密码将无法恢复」才能提交。
 */
import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  TextField,
  Typography,
} from '@mui/material';

/** 设置主密码对话框的属性。 */
export interface SetPasswordDialogProps {
  /** 是否打开。 */
  open: boolean;
  /** 中文错误提示。 */
  error?: string | null;
  /** 提交回调（返回 true 表示成功）。 */
  onSubmit: (password: string) => Promise<boolean>;
  /** 取消回调。 */
  onCancel?: () => void;
  /** 是否为「解锁」模式（标题与文案不同）。 */
  mode?: 'create' | 'unlock';
}

/** 主口令最小长度。 */
const MIN_LENGTH = 8;

/**
 * 渲染设置主密码对话框。
 *
 * @param props 组件属性
 * @returns React 节点
 */
export function SetPasswordDialog({
  open,
  error,
  onSubmit,
  onCancel,
  mode = 'create',
}: SetPasswordDialogProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const isCreate = mode === 'create';
  const mismatch = isCreate && confirm !== '' && confirm !== password;
  const tooShort = isCreate && password.length > 0 && password.length < MIN_LENGTH;
  const canSubmit = isCreate
    ? password.length >= MIN_LENGTH && password === confirm && acknowledged
    : password.length > 0;

  const handleSubmit = async (): Promise<void> => {
    setBusy(true);
    setLocalError(null);
    try {
      const ok = await onSubmit(password);
      if (ok) {
        setPassword('');
        setConfirm('');
        setAcknowledged(false);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="sm" fullWidth aria-labelledby="set-password-title">
      <DialogTitle id="set-password-title">{isCreate ? '设置主密码' : '解锁保险库'}</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          忘记主密码且没有恢复码时，数据将永久无法恢复。
        </Alert>
        <TextField
          fullWidth
          size="small"
          type="password"
          label="主密码"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          sx={{ mb: 2 }}
          inputProps={{ 'aria-label': '主密码', autoComplete: 'new-password' }}
        />
        {isCreate ? (
          <>
            <TextField
              fullWidth
              size="small"
              type="password"
              label="确认主密码"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              error={mismatch}
              helperText={mismatch ? '两次输入不一致' : tooShort ? `主密码至少 ${MIN_LENGTH} 位` : ' '}
              sx={{ mb: 1 }}
              inputProps={{ 'aria-label': '确认主密码', autoComplete: 'new-password' }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  inputProps={{ 'aria-label': '我已知悉忘记密码将无法恢复' }}
                />
              }
              label="我已知悉忘记密码将无法恢复"
            />
          </>
        ) : null}
        {localError || error ? (
          <Typography variant="body2" color="error" sx={{ mt: 1 }}>
            {localError ?? error}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions>
        {onCancel ? <Button onClick={onCancel}>取消</Button> : null}
        <Button variant="contained" disabled={!canSubmit || busy} onClick={() => void handleSubmit()}>
          {isCreate ? '创建保险库' : '解锁'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
