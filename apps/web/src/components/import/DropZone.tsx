/**
 * 文件拖拽区组件。
 *
 * 架构位置：apps/web 的「导入组件」层。
 *
 * 说明：拖拽与点击选择是**同一个入口**（PRD UI-01），支持单文件、多文件、压缩包（.zip）及文件夹混合拖拽或分次叠加选择。
 */
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import CloudUploadOutlined from '@mui/icons-material/CloudUploadOutlined';
import FolderOpenOutlined from '@mui/icons-material/FolderOpenOutlined';

/** 浏览器 FileSystem Entry 最小兼容接口（用于递归解析拖入的文件夹）。 */
interface WebkitEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath?: string;
  file?: (success: (file: File) => void, error?: (err: unknown) => void) => void;
  createReader?: () => {
    readEntries: (
      success: (entries: WebkitEntryLike[]) => void,
      error?: (err: unknown) => void,
    ) => void;
  };
}

/** 递归读取单个 FileSystem Entry 下的全部文件。 */
async function readEntryFiles(entry: WebkitEntryLike): Promise<File[]> {
  if (entry.isFile && typeof entry.file === 'function') {
    return new Promise<File[]>((resolve) => {
      entry.file?.(
        (f) => resolve([f]),
        () => resolve([]),
      );
    });
  }
  if (entry.isDirectory && typeof entry.createReader === 'function') {
    const reader = entry.createReader();
    const children: WebkitEntryLike[] = [];
    // Chromium DirectoryReader.readEntries 单次最多返回 100 项，必须循环读至空数组为止
    while (true) {
      const batch = await new Promise<WebkitEntryLike[]>((resolve) => {
        reader.readEntries(
          (entries) => resolve(entries ?? []),
          () => resolve([]),
        );
      });
      if (batch.length === 0) {
        break;
      }
      children.push(...batch);
    }
    const nested = await Promise.all(children.map((child) => readEntryFiles(child)));
    return nested.flat();
  }
  return [];
}

/** 同步提取 DataTransfer 中的 FileSystem Entry（必须在 drop 事件同步栈内调用，防止浏览器回收 items）。 */
function snapshotDataTransferEntries(
  dataTransfer: DataTransfer | null | undefined,
): WebkitEntryLike[] {
  if (!dataTransfer?.items) {
    return [];
  }
  const entries: WebkitEntryLike[] = [];
  for (const item of Array.from(dataTransfer.items)) {
    const maybeGetter = (item as unknown as { webkitGetAsEntry?: () => WebkitEntryLike | null })
      .webkitGetAsEntry;
    if (typeof maybeGetter === 'function') {
      const entry = maybeGetter.call(item);
      if (entry) {
        entries.push(entry);
      }
    }
  }
  return entries;
}

/** 拖拽区组件的属性。 */
export interface DropZoneProps {
  /** 选中单个文件后的回调。 */
  onFile: (file: File) => void;
  /** 选中多个文件或文件夹后的回调（含是否来自文件夹选择的元信息）。 */
  onFiles?: (files: File[], meta?: { fromFolder?: boolean }) => void;
  /** 是否正在处理。 */
  disabled?: boolean;
}

/**
 * 渲染文件拖拽区。
 *
 * 说明：支持拖拽或点击选择 CSV / Excel / PDF / JSON / ZIP 账单文件及文件夹混合批量导入。
 *
 * @param props 组件属性
 * @returns React 节点
 * @throws 无（交互事件在回调中处理）
 */
export function DropZone({ onFile, onFiles, disabled = false }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute('webkitdirectory', '');
      folderInputRef.current.setAttribute('directory', '');
    }
  }, []);

  const dispatchFiles = (files: File[], fromFolder = false): void => {
    if (files.length === 0 && !fromFolder) {
      return;
    }
    if (onFiles) {
      onFiles(files, { fromFolder });
      return;
    }
    const first = files[0];
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
    const entries = snapshotDataTransferEntries(event.dataTransfer);
    const hasDirectory = entries.some((e) => e.isDirectory);
    if (!hasDirectory) {
      const syncFiles = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
      dispatchFiles(syncFiles, false);
      return;
    }
    void Promise.all(entries.map((entry) => readEntryFiles(entry))).then((groups) => {
      dispatchFiles(groups.flat(), true);
    });
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
        p: { xs: 2.5, sm: 3.5 },
        textAlign: 'center',
        backgroundColor: 'var(--lifehub-surface)',
      }}
      data-testid="drop-zone"
    >
      <CloudUploadOutlined sx={{ fontSize: { xs: 36, sm: 42 }, color: 'var(--lifehub-text-muted)' }} />
      <Typography
        variant="h6"
        sx={{ mt: 1, fontSize: { xs: '1rem', sm: '1.15rem' }, fontWeight: 700, color: 'var(--lifehub-text)' }}
      >
        把账单文件拖到这里（CSV / Excel / PDF / JSON）
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.5, mb: 2, color: 'var(--lifehub-text-muted)' }}>
        支持混合拖入多个文件与文件夹，文件只在本机解析，不会上传
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} justifyContent="center">
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
          选择文件夹
        </Button>
      </Stack>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".csv,.tsv,.txt,.xlsx,.xls,.pdf,.json,.zip,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/pdf,application/json,application/zip,application/x-zip-compressed"
        hidden
        onChange={(event) => {
          dispatchFiles(event.target.files ? Array.from(event.target.files) : [], false);
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
          dispatchFiles(event.target.files ? Array.from(event.target.files) : [], true);
          event.target.value = '';
        }}
      />
    </Box>
  );
}
