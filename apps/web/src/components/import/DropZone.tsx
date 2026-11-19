/**
 * 文件拖拽区组件。
 *
 * 架构位置：apps/web 的「导入组件」层。
 *
 * 说明：拖拽与点击选择是**同一个入口**（PRD UI-01），支持单文件、多文件、压缩包（.zip）及文件夹批量上传，
 * 同时提供可选的文件解密/解压密码输入框。
 */
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Box, Button, Stack, TextField, Typography } from '@mui/material';
import CloudUploadOutlined from '@mui/icons-material/CloudUploadOutlined';
import FolderOpenOutlined from '@mui/icons-material/FolderOpenOutlined';

/** 拖拽区组件的属性。 */
export interface DropZoneProps {
  /** 选中单个文件后的回调。 */
  onFile: (file: File) => void;
  /** 选中多个文件或文件夹后的回调。 */
  onFiles?: (files: File[]) => void;
  /** 可选的文件解密或解压密码。 */
  password?: string;
  /** 密码输入变更回调。 */
  onPasswordChange?: (password: string) => void;
  /** 是否正在处理。 */
  disabled?: boolean;
}

/**
 * 渲染文件拖拽区。
 *
 * 说明：支持拖拽或点击选择 CSV / Excel / PDF / JSON / ZIP 账单文件及文件夹批量上传。
 *
 * @param props 组件属性
 * @returns React 节点
 * @throws 无（交互事件在回调中处理）
 */
export function DropZone({
  onFile,
  onFiles,
  password = '',
  onPasswordChange,
  disabled = false,
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute('webkitdirectory', '');
      folderInputRef.current.setAttribute('directory', '');
    }
  }, []);

  const dispatchFiles = (fileList: FileList | null | undefined): void => {
    if (!fileList || fileList.length === 0) {
      return;
    }
    const list = Array.from(fileList);
    if (onFiles) {
      onFiles(list);
      return;
    }
    const first = list[0];
    if (first) {
      onFile(first);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    if (disabled) {
      return;
    }
    dispatchFiles(event.dataTransfer?.files);
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
        border: '1.5px dashed',
        borderColor: dragging ? 'var(--lifehub-primary)' : 'var(--lifehub-border)',
        borderRadius: '12px',
        p: { xs: 2.5, sm: 4 },
        textAlign: 'center',
        backgroundColor: 'var(--lifehub-surface)',
      }}
      data-testid="drop-zone"
    >
      <CloudUploadOutlined sx={{ fontSize: { xs: 36, sm: 42 }, color: 'var(--lifehub-text-muted)' }} />
      <Typography variant="h6" sx={{ mt: 1, fontSize: { xs: '1rem', sm: '1.15rem' }, fontWeight: 700, color: 'var(--lifehub-text)' }}>
        把账单文件拖到这里（CSV / Excel / PDF / JSON）
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.5, mb: 2, color: 'var(--lifehub-text-muted)' }}>
        支持微信、支付宝、银行账单与压缩包（文件只在本机解析，不会上传）
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} justifyContent="center" sx={{ mb: 2 }}>
        <Button
          variant="contained"
          disableElevation
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          aria-label="选择账单文件"
          sx={{ borderRadius: '8px' }}
        >
          选择文件
        </Button>
        <Button
          variant="outlined"
          disabled={disabled}
          startIcon={<FolderOpenOutlined />}
          onClick={() => folderInputRef.current?.click()}
          aria-label="选择账单文件夹"
          data-testid="select-folder-button"
          sx={{ borderRadius: '8px' }}
        >
          选择文件夹批量上传
        </Button>
      </Stack>
      {onPasswordChange ? (
        <Box sx={{ maxWidth: 320, mx: 'auto' }}>
          <TextField
            size="small"
            fullWidth
            type="password"
            disabled={disabled}
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            placeholder="文件密码（选填）"
            data-testid="import-password-field"
            inputProps={{
              'data-testid': 'import-password-input',
              'aria-label': '文件解密或解压密码',
            }}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
          />
        </Box>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".csv,.tsv,.txt,.xlsx,.xls,.pdf,.json,.zip,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/pdf,application/json,application/zip,application/x-zip-compressed"
        hidden
        onChange={(event) => {
          dispatchFiles(event.target.files);
          event.target.value = '';
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        hidden
        data-testid="folder-file-input"
        onChange={(event) => {
          dispatchFiles(event.target.files);
          event.target.value = '';
        }}
      />
    </Box>
  );
}
