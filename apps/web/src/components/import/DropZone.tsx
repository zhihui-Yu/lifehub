/**
 * 文件拖拽区组件。
 *
 * 架构位置：apps/web 的「导入组件」层。
 *
 * 说明：拖拽与点击选择是**同一个入口**（PRD UI-01），
 * 文件类型不符时给出「不支持的文件类型，请上传 .csv 文件」。
 */
import { useRef, useState, type DragEvent } from 'react';
import { Box, Button, Typography } from '@mui/material';
import CloudUploadOutlined from '@mui/icons-material/CloudUploadOutlined';

/** 拖拽区组件的属性。 */
export interface DropZoneProps {
  /** 选中文件后的回调。 */
  onFile: (file: File) => void;
  /** 是否正在处理。 */
  disabled?: boolean;
}

/**
 * 渲染文件拖拽区。
 *
 * @param props 组件属性
 * @returns React 节点
 */
export function DropZone({ onFile, disabled = false }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    if (disabled) {
      return;
    }
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      onFile(file);
    }
  };

  return (
    <Box
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) {
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={dragging ? 'lifehub-dragging' : undefined}
      sx={{
        border: '2px dashed',
        borderColor: dragging ? 'var(--lifehub-primary)' : 'var(--lifehub-border)',
        borderRadius: 2,
        p: 6,
        textAlign: 'center',
        backgroundColor: 'var(--lifehub-surface)',
      }}
      data-testid="drop-zone"
    >
      <CloudUploadOutlined sx={{ fontSize: 44, color: 'var(--lifehub-text-muted)' }} />
      <Typography variant="h6" sx={{ mt: 1, color: 'var(--lifehub-text)' }}>
        把账单 CSV 文件拖到这里
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.5, mb: 2, color: 'var(--lifehub-text-muted)' }}>
        支持微信支付、支付宝与主流银行导出的 CSV；文件只在本机解析，不会上传。
      </Typography>
      <Button
        variant="contained"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        aria-label="选择 CSV 文件"
      >
        选择文件
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            onFile(file);
          }
          event.target.value = '';
        }}
      />
    </Box>
  );
}
