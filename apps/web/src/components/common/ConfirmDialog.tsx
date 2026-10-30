/**
 * 二次确认对话框。
 *
 * 架构位置：apps/web 的「通用组件」层。
 *
 * 说明：用于「清空本地数据」「清除审计日志」等不可逆动作（X-07 ④、NF-PR-6）。
 */
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';

/** 二次确认对话框的属性。 */
export interface ConfirmDialogProps {
  /** 是否打开。 */
  open: boolean;
  /** 对话框标题。 */
  title: string;
  /** 确认提示正文。 */
  description: string;
  /** 确认按钮文案。 */
  confirmText?: string;
  /** 取消按钮文案。 */
  cancelText?: string;
  /** 确认回调。 */
  onConfirm: () => void;
  /** 取消回调。 */
  onCancel: () => void;
}

/**
 * 渲染二次确认对话框。
 *
 * @param props 组件属性
 * @returns React 节点
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel} aria-labelledby="confirm-dialog-title">
      <DialogTitle id="confirm-dialog-title">{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{description}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{cancelText}</Button>
        <Button color="error" variant="contained" onClick={onConfirm} autoFocus>
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
