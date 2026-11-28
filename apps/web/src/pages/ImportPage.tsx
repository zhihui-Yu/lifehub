/**
 * 导入页面（UI-01）。
 *
 * 架构位置：apps/web 的「页面」层。
 *
 * 说明：
 * 1. 单文件快速路径：选择单个文件后直接解析并进入映射页（若文件加密则针对该文件弹窗索取密码）；
 * 2. 批量混合路径：支持连续叠加选择多个文件与多个文件夹；在加入列表时即对文件头做字节级加密检测，
 *    仅对真正加密的 PDF / ZIP 一一对应渲染独立密码输入框，无需密码的文件（CSV / XLSX / JSON / 未加密 PDF / 未加密 ZIP）不渲染密码框。
 */
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import { useNavigate } from 'react-router-dom';
import { classifySourceChannel, ColumnMapper } from '@lifehub/core';
import type { ImportBatch, ImportSource } from '@lifehub/core';
import { DropZone } from '@/components/import/DropZone';
import { RecentImports } from '@/components/import/RecentImports';
import { StepIndicator } from '@/components/import/StepIndicator';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { LoadingOverlay } from '@/components/common/LoadingOverlay';
import { useImportFlow } from '@/hooks/useImportFlow';
import { useVault } from '@/hooks/useVault';
import { invalidateLoadedDayBillsCache } from '@/hooks/useBillList';
import {
  buildDailyIndexFromBills,
  clearDailyBillIndexCache,
  saveEncryptedDailyBillIndex,
} from '@/lib/bill-daily-index';
import type { PlatformRuntime } from '@/platform';
import { useBillStore, useImportStore } from '@/store';
import { detectFileType, isSupportedFileType, readFileBytes } from '@/utils/file';
import { buildImportSource, isPdfBytesEncrypted } from '@/lib/import/extract';
import {
  extractZipFiles,
  isPasswordRequiredError,
  isZipBytesEncrypted,
} from '@/lib/import/zip';

/** 待批量导入队列中的单个文件条目。 */
interface QueuedFileItem {
  /** 唯一标识键（基于展示路径 + 字节大小 + 修改时间去重）。 */
  key: string;
  /** 原始文件对象。 */
  file: File;
  /** 已预读的文件字节（导入时直接复用，避免二次读盘）。 */
  bytes: Uint8Array;
  /** 展示名称（含文件夹/压缩包前缀时保留完整可读路径）。 */
  displayName: string;
  /** 经字节头实测该文件是否需要解密密码（无需密码的文件绝不渲染密码输入框）。 */
  requiresPassword: boolean;
  /** 该文件专属的解密/解压密码。 */
  password: string;
}

/** 正在执行解析与解密的工作项。 */
interface PendingWorkItem {
  file: File;
  displayName: string;
  bytes?: Uint8Array;
  password?: string;
}

/** 正在执行中的会话上下文（用于在遇到未填/填错密码的加密文件弹窗补填后无缝断点续跑）。 */
interface ActiveImportSession {
  isBatch: boolean;
  queue: PendingWorkItem[];
  readySources: ImportSource[];
}

/** 获取文件可读展示名。 */
function getDisplayFileName(file: File): string {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return rel && rel.trim() !== '' ? rel : file.name;
}

/** 生成队列项去重键。 */
function buildQueueKey(displayName: string, file: File): string {
  return `${displayName}::${file.size}::${file.lastModified}`;
}

/**
 * 预检一批候选文件：
 * 1. 未加密的 `.zip` 自动就地展开为内部账单文件，避免外层空挂无意义的密码框；
 * 2. 对每个 `.pdf` 与 `.zip` 做真实字节级加密检测，精准标记 `requiresPassword`（CSV/XLSX/JSON 及未加密 PDF 恒为 `false`）。
 */
async function inspectCandidateFiles(
  files: readonly File[],
  prefixPath = '',
): Promise<QueuedFileItem[]> {
  const out: QueuedFileItem[] = [];
  for (const file of files) {
    if (!isSupportedFileType(file)) {
      continue;
    }
    const baseDisplay = getDisplayFileName(file);
    const displayName = prefixPath ? `${prefixPath} / ${baseDisplay}` : baseDisplay;
    const bytes = await readFileBytes(file);
    const kind = detectFileType(file);

    if (kind === 'zip') {
      const zipEncrypted = isZipBytesEncrypted(bytes);
      if (!zipEncrypted) {
        try {
          const innerFiles = await extractZipFiles(bytes, undefined, file.name);
          const unpacked = await inspectCandidateFiles(innerFiles, displayName);
          if (unpacked.length > 0) {
            out.push(...unpacked);
            continue;
          }
        } catch {
          // 若解压异常则保留原条目交由后续导入阶段统一报错提示
        }
      }
      out.push({
        key: buildQueueKey(displayName, file),
        file,
        bytes,
        displayName,
        requiresPassword: zipEncrypted,
        password: '',
      });
      continue;
    }

    if (kind === 'pdf') {
      const pdfEncrypted = await isPdfBytesEncrypted(bytes);
      out.push({
        key: buildQueueKey(displayName, file),
        file,
        bytes,
        displayName,
        requiresPassword: pdfEncrypted,
        password: '',
      });
      continue;
    }

    out.push({
      key: buildQueueKey(displayName, file),
      file,
      bytes,
      displayName,
      requiresPassword: false,
      password: '',
    });
  }
  return out;
}

/** 批量导入时优先导入微信/支付宝明细账单，再导入银行流水，使跨来源去重天然保留最完整商户与备注。 */
function sourcePriority(source: ImportSource): number {
  const ch = classifySourceChannel(source.fileName);
  if (ch === 'wechat' || ch === 'alipay') {
    return 0;
  }
  if (ch === 'bank') {
    return 2;
  }
  return 1;
}

/**
 * 渲染导入页面。
 *
 * @returns React 节点
 */
export function ImportPage() {
  const navigate = useNavigate();
  const { runtime } = useVault();
  const { plan, run } = useImportFlow();
  const error = useImportStore((state) => state.error);
  const fileHash = useImportStore((state) =>
    state.stage === 'done' && !state.summary?.duplicateFile ? undefined : state.plan?.fileHash,
  );

  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [autoImport, setAutoImport] = useState(false);
  const [queuedFiles, setQueuedFiles] = useState<QueuedFileItem[]>([]);
  const queuedFilesRef = useRef<QueuedFileItem[]>(queuedFiles);
  queuedFilesRef.current = queuedFiles;

  const [pendingDeleteBatch, setPendingDeleteBatch] = useState<ImportBatch | null>(null);
  const [confirmClearAllOpen, setConfirmClearAllOpen] = useState(false);

  const [dialogPassword, setDialogPassword] = useState('');
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [passwordDialogFileName, setPasswordDialogFileName] = useState('');
  const [passwordDialogError, setPasswordDialogError] = useState<string | null>(null);
  const [passwordDialogCanSkip, setPasswordDialogCanSkip] = useState(false);
  const sessionRef = useRef<ActiveImportSession | null>(null);

  const [batchSummary, setBatchSummary] = useState<{
    fileCount: number;
    rowImported: number;
    rowSkipped: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!runtime) {
        return;
      }
      try {
        const list = await runtime.importBatchRepository.list();
        if (!cancelled) {
          setBatches(list);
        }
      } catch {
        // 列表加载失败不阻断导入流程。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runtime]);

  const handleConfirmDeleteBatch = async (): Promise<void> => {
    const target = pendingDeleteBatch;
    setPendingDeleteBatch(null);
    if (!target || !runtime) {
      return;
    }
    try {
      let deletedCount = 0;
      if (runtime.billRepository?.deleteBySourceFileId) {
        deletedCount = await runtime.billRepository.deleteBySourceFileId(target.id);
      } else if (runtime.billRepository?.list && runtime.billRepository?.delete) {
        const allBills = await runtime.billRepository.list();
        for (const bill of allBills) {
          if (bill.sourceFileId === target.id) {
            await runtime.billRepository.delete(bill.id);
            deletedCount += 1;
          }
        }
      }
      await runtime.importBatchRepository.delete?.(target.id);
      const nextBatches = await runtime.importBatchRepository.list();
      setBatches(nextBatches);
      clearDailyBillIndexCache();
      invalidateLoadedDayBillsCache();
      if (runtime.billRepository?.list) {
        const latestBills = await runtime.billRepository.list();
        useBillStore.getState().setBills(latestBills);
        void saveEncryptedDailyBillIndex(
          runtime as PlatformRuntime,
          buildDailyIndexFromBills(latestBills),
        );
      }
      setNotice(`已删除「${target.fileName}」及其关联的 ${deletedCount} 条账单`);
    } catch {
      setNotice('删除导入记录失败，请稍后重试');
    }
  };

  const handleConfirmClearAllBatches = async (): Promise<void> => {
    setConfirmClearAllOpen(false);
    if (!runtime) {
      return;
    }
    try {
      for (const batch of batches) {
        if (runtime.billRepository?.deleteBySourceFileId) {
          await runtime.billRepository.deleteBySourceFileId(batch.id);
        }
        await runtime.importBatchRepository.delete?.(batch.id);
      }
      if (runtime.billRepository?.clearAll) {
        await runtime.billRepository.clearAll();
      }
      setBatches([]);
      clearDailyBillIndexCache();
      invalidateLoadedDayBillsCache();
      useBillStore.getState().setBills([]);
      useImportStore.getState().reset();
      setNotice('已清空全部导入记录及关联账单，现在可重新导入');
    } catch {
      setNotice('清空导入记录失败，请稍后重试');
    }
  };

  /** 执行或断点续跑当前导入会话（逐个文件独立解密，已解密文件不重复处理）。 */
  const resumeImportSession = async (): Promise<void> => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    setBusy(true);
    try {
      while (session.queue.length > 0) {
        const current = session.queue[0];
        if (!current) {
          session.queue.shift();
          continue;
        }
        try {
          const bytes = current.bytes ?? (await readFileBytes(current.file));
          current.bytes = bytes;
          const pwd = current.password?.trim() || undefined;

          if (detectFileType(current.file) === 'zip') {
            const entries = await extractZipFiles(bytes, pwd, current.file.name);
            session.queue.shift();
            const innerWork: PendingWorkItem[] = entries
              .filter((entry) => isSupportedFileType(entry))
              .map((entry) => ({
                file: entry,
                displayName: `${current.displayName} / ${entry.name}`,
              }));
            session.queue.unshift(...innerWork);
            if (innerWork.length > 1) {
              session.isBatch = true;
            }
          } else {
            const source = await buildImportSource(current.file, bytes, { password: pwd });
            session.queue.shift();
            session.readySources.push(source);
          }
        } catch (err) {
          if (isPasswordRequiredError(err)) {
            setPasswordDialogFileName(current.displayName || current.file.name);
            setPasswordDialogError(err.reason === 'incorrect_password' ? err.message : null);
            setPasswordDialogCanSkip(
              session.isBatch || session.readySources.length + session.queue.length > 1,
            );
            if (err.reason === 'need_password') {
              setDialogPassword('');
            }
            setPasswordDialogOpen(true);
            return;
          }
          throw err;
        }
      }

      setPasswordDialogOpen(false);
      setPasswordDialogError(null);
      const sources = [...session.readySources];
      const isBatch = session.isBatch || sources.length > 1;
      sessionRef.current = null;

      if (sources.length === 0) {
        setLocalError('未找到可导入的账单文件（CSV / Excel / PDF / JSON）');
        return;
      }

      if (!isBatch && sources.length === 1 && sources[0]) {
        const result = await plan(sources[0]);
        if (result) {
          const validation = new ColumnMapper(result.headers).validate(result.suggestedMapping);
          if (autoImport && validation.ok) {
            const summary = await run(result.suggestedMapping);
            if (summary) {
              clearDailyBillIndexCache();
              invalidateLoadedDayBillsCache();
              navigate('/bills');
              return;
            }
          }
          navigate('/import/mapping');
        }
        return;
      }

      sources.sort((a, b) => sourcePriority(a) - sourcePriority(b));

      let totalImported = 0;
      let totalSkipped = 0;
      let successFiles = 0;
      for (const source of sources) {
        const planned = await plan(source);
        if (!planned) {
          continue;
        }
        const validation = new ColumnMapper(planned.headers).validate(planned.suggestedMapping);
        if (!validation.ok) {
          continue;
        }
        const summary = await run(planned.suggestedMapping, { skipStoreRefresh: true });
        if (summary) {
          totalImported += summary.rowImported;
          totalSkipped += summary.rowSkipped;
          successFiles += 1;
        }
      }

      setQueuedFiles([]);
      invalidateLoadedDayBillsCache();

      if (runtime) {
        const nextBatches = await runtime.importBatchRepository.list();
        setBatches(nextBatches);
        if (runtime.billRepository?.list) {
          const latestBills = await runtime.billRepository.list();
          useBillStore.getState().setBills(latestBills);
          await saveEncryptedDailyBillIndex(
            runtime as PlatformRuntime,
            buildDailyIndexFromBills(latestBills),
          );
        }
      }

      setBatchSummary({
        fileCount: successFiles,
        rowImported: totalImported,
        rowSkipped: totalSkipped,
      });
      setNotice(`已完成 ${successFiles} 个文件的批量导入，共导入 ${totalImported} 条账单`);
    } catch (err) {
      sessionRef.current = null;
      setLocalError(err instanceof Error ? err.message : '读取或解析文件失败');
    } finally {
      setBusy(false);
    }
  };

  /** 处理用户拖入或选择的一批文件/文件夹。 */
  const handleIncomingSelection = (inputFiles: File[], fromFolder = false): void => {
    setLocalError(null);
    setBatchSummary(null);
    const supported = inputFiles.filter((file) => isSupportedFileType(file));
    if (supported.length === 0) {
      setNotice(
        fromFolder
          ? '所选文件夹中未找到支持的账单文件（CSV / Excel / PDF / JSON / ZIP）'
          : '不支持的文件类型，请上传 CSV / Excel / PDF / JSON 文件',
      );
      return;
    }

    // 单文件且当前待导入队列为空时（非文件夹、非未加密多文件 ZIP）：走 0 点击快速路径
    if (
      !fromFolder &&
      supported.length === 1 &&
      queuedFilesRef.current.length === 0 &&
      supported[0] &&
      detectFileType(supported[0]) !== 'zip'
    ) {
      sessionRef.current = {
        isBatch: false,
        queue: [
          {
            file: supported[0],
            displayName: getDisplayFileName(supported[0]),
          },
        ],
        readySources: [],
      };
      void resumeImportSession();
      return;
    }

    void (async () => {
      setBusy(true);
      try {
        const inspected = await inspectCandidateFiles(supported);
        // 若单选了一个加密 ZIP（或内含仅 1 个文件的未加密 ZIP）且队列原本为空，仍走单文件直达体验
        if (
          !fromFolder &&
          supported.length === 1 &&
          queuedFilesRef.current.length === 0 &&
          inspected.length === 1 &&
          inspected[0]
        ) {
          sessionRef.current = {
            isBatch: false,
            queue: [
              {
                file: inspected[0].file,
                bytes: inspected[0].bytes,
                displayName: inspected[0].displayName,
              },
            ],
            readySources: [],
          };
          await resumeImportSession();
          return;
        }

        setQueuedFiles((prev) => {
          const existingKeys = new Set(prev.map((item) => item.key));
          const next = [...prev];
          for (const item of inspected) {
            if (!existingKeys.has(item.key)) {
              existingKeys.add(item.key);
              next.push(item);
            }
          }
          return next;
        });
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : '读取待导入文件失败');
      } finally {
        if (!sessionRef.current) {
          setBusy(false);
        }
      }
    })();
  };

  /** 启动待导入清单的批量导入。 */
  const handleStartBatchImport = (): void => {
    if (queuedFiles.length === 0) {
      return;
    }
    setLocalError(null);
    setBatchSummary(null);
    sessionRef.current = {
      isBatch: queuedFiles.length > 1,
      queue: queuedFiles.map((item) => ({
        file: item.file,
        bytes: item.bytes,
        displayName: item.displayName,
        password: item.requiresPassword ? item.password.trim() || undefined : undefined,
      })),
      readySources: [],
    };
    void resumeImportSession();
  };

  const handleSubmitDialogPassword = (): void => {
    const session = sessionRef.current;
    const current = session?.queue[0];
    if (!session || !current || !dialogPassword.trim()) {
      return;
    }
    current.password = dialogPassword.trim();
    setPasswordDialogOpen(false);
    setPasswordDialogError(null);
    void resumeImportSession();
  };

  const handleSkipEncryptedFile = (): void => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    session.queue.shift();
    setPasswordDialogOpen(false);
    setPasswordDialogError(null);
    setDialogPassword('');
    void resumeImportSession();
  };

  const handleCancelPasswordDialog = (): void => {
    sessionRef.current = null;
    setPasswordDialogOpen(false);
    setPasswordDialogError(null);
    setDialogPassword('');
  };

  const displayError = error ?? localError;
  const stepIndex = batchSummary ? 3 : busy && queuedFiles.length > 0 ? 2 : 0;
  const encryptedQueueCount = queuedFiles.filter((f) => f.requiresPassword).length;

  return (
    <div data-testid="import-page">
      <StepIndicator activeStep={stepIndex} />
      {displayError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {displayError}
        </Alert>
      ) : null}
      {batchSummary ? (
        <Alert severity="success" sx={{ mb: 2 }} data-testid="batch-import-banner">
          批量导入完成：成功处理 {batchSummary.fileCount} 个文件，导入 {batchSummary.rowImported}{' '}
          条账单（跳过 {batchSummary.rowSkipped} 条）。
        </Alert>
      ) : null}
      <DropZone
        onFile={(file) => handleIncomingSelection([file], false)}
        onFiles={(files, meta) => handleIncomingSelection(files, Boolean(meta?.fromFolder))}
        disabled={busy}
      />

      {queuedFiles.length > 0 ? (
        <Paper
          variant="outlined"
          data-testid="pending-batch-list"
          sx={{
            mt: 2,
            p: 2,
            borderRadius: '12px',
            backgroundColor: 'var(--lifehub-surface)',
            borderColor: 'var(--lifehub-border)',
          }}
        >
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            flexWrap="wrap"
            gap={1}
            sx={{ mb: 1.5 }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'var(--lifehub-text)' }}>
              待导入（共 {queuedFiles.length} 个文件
              {encryptedQueueCount > 0 ? ` · ${encryptedQueueCount} 个加密文件需填密码` : ''}）
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <Button
                size="small"
                variant="text"
                disabled={busy}
                onClick={() => setQueuedFiles([])}
                data-testid="clear-queued-files-button"
              >
                清空
              </Button>
              <Button
                size="small"
                variant="contained"
                disableElevation
                disabled={busy}
                onClick={handleStartBatchImport}
                data-testid="start-batch-import-button"
                sx={{ borderRadius: '8px' }}
              >
                开始导入
              </Button>
            </Stack>
          </Stack>
          <Box
            sx={{
              maxHeight: 340,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
            }}
          >
            {queuedFiles.map((item, idx) => (
              <Box
                key={item.key}
                data-testid={`queued-file-row-${idx}`}
                data-encrypted={item.requiresPassword ? 'true' : 'false'}
                sx={{
                  display: 'flex',
                  flexDirection: { xs: item.requiresPassword ? 'column' : 'row', sm: 'row' },
                  alignItems: { xs: item.requiresPassword ? 'stretch' : 'center', sm: 'center' },
                  gap: 1,
                  py: 0.75,
                  borderBottom:
                    idx < queuedFiles.length - 1 ? '1px solid var(--lifehub-border)' : 'none',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flex: 1, minWidth: 0 }}>
                  {item.requiresPassword ? (
                    <LockOutlined
                      sx={{ fontSize: 16, color: 'warning.main', flexShrink: 0 }}
                    />
                  ) : null}
                  <Typography
                    variant="body2"
                    title={item.displayName}
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      wordBreak: 'break-all',
                      color: 'var(--lifehub-text)',
                      lineHeight: 1.4,
                    }}
                  >
                    {idx + 1}. {item.displayName}
                  </Typography>
                  <IconButton
                    size="small"
                    disabled={busy}
                    aria-label={`移除 ${item.file.name}`}
                    sx={{ display: { xs: item.requiresPassword ? 'inline-flex' : 'none', sm: 'none' } }}
                    onClick={() =>
                      setQueuedFiles((prev) => prev.filter((q) => q.key !== item.key))
                    }
                  >
                    <CloseOutlined fontSize="small" />
                  </IconButton>
                </Box>
                {item.requiresPassword ? (
                  <TextField
                    size="small"
                    type="text"
                    autoComplete="off"
                    disabled={busy}
                    placeholder="请输入此文件密码"
                    value={item.password}
                    onChange={(event) => {
                      const val = event.target.value;
                      setQueuedFiles((prev) =>
                        prev.map((q) => (q.key === item.key ? { ...q, password: val } : q)),
                      );
                    }}
                    sx={{ width: { xs: '100%', sm: 188 }, flexShrink: 0 }}
                    inputProps={{
                      'data-testid': `queued-file-password-${idx}`,
                      'aria-label': `${item.file.name} 密码`,
                    }}
                  />
                ) : null}
                <IconButton
                  size="small"
                  disabled={busy}
                  aria-label={`移除 ${item.file.name}`}
                  sx={{
                    display: { xs: item.requiresPassword ? 'none' : 'inline-flex', sm: 'inline-flex' },
                    flexShrink: 0,
                  }}
                  onClick={() =>
                    setQueuedFiles((prev) => prev.filter((q) => q.key !== item.key))
                  }
                >
                  <CloseOutlined fontSize="small" />
                </IconButton>
              </Box>
            ))}
          </Box>
        </Paper>
      ) : null}

      <Box sx={{ mt: 1.5, mb: 1 }}>
        <FormControlLabel
          sx={{ color: 'var(--lifehub-text)' }}
          control={
            <Checkbox
              checked={autoImport}
              onChange={(event) => setAutoImport(event.target.checked)}
              data-testid="auto-import-toggle"
            />
          }
          label="自动识别字段并直接导入"
        />
      </Box>
      <LoadingOverlay visible={busy} label="解析中…" />
      <RecentImports
        batches={batches}
        currentFileHash={fileHash}
        onDeleteBatch={(batch) => setPendingDeleteBatch(batch)}
        onClearAllBatches={() => setConfirmClearAllOpen(true)}
      />
      <Dialog
        open={passwordDialogOpen}
        onClose={handleCancelPasswordDialog}
        maxWidth="xs"
        fullWidth
        data-testid="password-prompt-dialog"
      >
        <DialogTitle>输入文件密码</DialogTitle>
        <DialogContent>
          <Typography
            variant="body2"
            sx={{ mb: 2, color: 'var(--lifehub-text-muted)', wordBreak: 'break-all' }}
            data-testid="password-dialog-filename"
          >
            {passwordDialogFileName
              ? `请输入「${passwordDialogFileName}」的密码以继续导入。`
              : '请输入文件密码以继续导入。'}
          </Typography>
          {passwordDialogError ? (
            <Alert severity="error" sx={{ mb: 2 }} data-testid="password-dialog-error">
              {passwordDialogError}
            </Alert>
          ) : null}
          <TextField
            autoFocus
            fullWidth
            size="small"
            type="text"
            autoComplete="off"
            label="解密密码"
            value={dialogPassword}
            onChange={(event) => setDialogPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && dialogPassword.trim() && !busy) {
                event.preventDefault();
                handleSubmitDialogPassword();
              }
            }}
            data-testid="password-prompt-input"
            inputProps={{
              'data-testid': 'password-dialog-input',
              'aria-label': '解密密码',
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelPasswordDialog}>取消</Button>
          {passwordDialogCanSkip ? (
            <Button onClick={handleSkipEncryptedFile} data-testid="password-prompt-skip">
              跳过此文件
            </Button>
          ) : null}
          <Button
            variant="contained"
            disabled={!dialogPassword.trim() || busy}
            onClick={handleSubmitDialogPassword}
            data-testid="password-prompt-submit"
          >
            解密并继续
          </Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={pendingDeleteBatch !== null}
        title="删除该次导入记录及关联账单？"
        description={
          pendingDeleteBatch
            ? `确定删除「${pendingDeleteBatch.fileName}」及该批次导入的 ${pendingDeleteBatch.rowImported} 条账单吗？删除后可重新导入该文件。`
            : ''
        }
        confirmText="确认删除"
        onCancel={() => setPendingDeleteBatch(null)}
        onConfirm={() => void handleConfirmDeleteBatch()}
      />
      <ConfirmDialog
        open={confirmClearAllOpen}
        title="清空全部导入记录？"
        description="确定清空所有导入记录及其关联的全部账单吗？清空后无法恢复，但你可以随时重新上传文件导入。"
        confirmText="确认清空"
        onCancel={() => setConfirmClearAllOpen(false)}
        onConfirm={() => void handleConfirmClearAllBatches()}
      />
      <Snackbar
        open={notice !== null}
        autoHideDuration={4000}
        onClose={() => setNotice(null)}
        message={notice ?? ''}
      />
    </div>
  );
}
