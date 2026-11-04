/**
 * 导入页面（UI-01）。
 *
 * 架构位置：apps/web 的「页面」层。
 *
 * 说明：拖拽 + 选择文件是同一入口；解析后自动跳转到 `/import/mapping`。
 */
import { useEffect, useState } from 'react';
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
  Snackbar,
  TextField,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { ColumnMapper } from '@lifehub/core';
import type { ImportBatch } from '@lifehub/core';
import { DropZone } from '@/components/import/DropZone';
import { RecentImports } from '@/components/import/RecentImports';
import { StepIndicator } from '@/components/import/StepIndicator';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { LoadingOverlay } from '@/components/common/LoadingOverlay';
import { useImportFlow } from '@/hooks/useImportFlow';
import { useVault } from '@/hooks/useVault';
import { useBillStore, useImportStore } from '@/store';
import { detectFileType, isSupportedFileType, readFileBytes } from '@/utils/file';
import { buildImportSource } from '@/lib/import/extract';
import { extractZipFiles, isPasswordRequiredError } from '@/lib/import/zip';

/**
 * 渲染导入页面。
 *
 * 说明：负责接收用户拖拽或选择的 CSV / Excel / PDF / JSON 账单文件，执行预解析、自动导入与历史导入批次管理。
 *
 * @param _props 页面无入参
 * @returns React 节点
 * @throws 无（解析与存储异常在内部捕获并以横幅展示）
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
  const [pendingDeleteBatch, setPendingDeleteBatch] = useState<ImportBatch | null>(null);
  const [confirmClearAllOpen, setConfirmClearAllOpen] = useState(false);
  const [filePassword, setFilePassword] = useState('');
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [passwordDialogError, setPasswordDialogError] = useState<string | null>(null);
  const [pendingEncryptedFiles, setPendingEncryptedFiles] = useState<File[] | null>(null);
  const [batchSummary, setBatchSummary] = useState<{
    fileCount: number;
    rowImported: number;
    rowSkipped: number;
  } | null>(null);

  // 加载最近导入列表。
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
      if (runtime.billRepository?.list) {
        const latestBills = await runtime.billRepository.list();
        useBillStore.getState().setBills(latestBills);
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
      useBillStore.getState().setBills([]);
      useImportStore.getState().reset();
      setNotice('已清空全部导入记录及关联账单，现在可重新导入');
    } catch {
      setNotice('清空导入记录失败，请稍后重试');
    }
  };

  const handleFiles = async (inputFiles: File[], overridePassword?: string): Promise<void> => {
    setLocalError(null);
    setBatchSummary(null);
    const activePassword = (overridePassword ?? filePassword).trim() || undefined;
    const supported = inputFiles.filter((file) => isSupportedFileType(file));
    if (supported.length === 0) {
      setNotice('不支持的文件类型，请上传 CSV / Excel / PDF / JSON 文件');
      return;
    }

    setBusy(true);
    try {
      const expandedFiles: { file: File; bytes: Uint8Array }[] = [];
      for (const file of supported) {
        const bytes = await readFileBytes(file);
        if (detectFileType(file) === 'zip') {
          const entries = await extractZipFiles(bytes, activePassword, file.name);
          for (const entry of entries) {
            if (isSupportedFileType(entry)) {
              const innerBytes = await readFileBytes(entry);
              expandedFiles.push({ file: entry, bytes: innerBytes });
            }
          }
        } else {
          expandedFiles.push({ file, bytes });
        }
      }

      if (expandedFiles.length === 0) {
        setLocalError('未在压缩包或文件夹中找到支持的账单文件（CSV / Excel / PDF / JSON）');
        return;
      }

      const singleItem = expandedFiles.length === 1 ? expandedFiles[0] : undefined;
      if (singleItem) {
        const source = await buildImportSource(singleItem.file, singleItem.bytes, {
          password: activePassword,
        });
        const result = await plan(source);
        setPasswordDialogOpen(false);
        setPasswordDialogError(null);
        setPendingEncryptedFiles(null);
        if (result) {
          const validation = new ColumnMapper(result.headers).validate(result.suggestedMapping);
          if (autoImport && validation.ok) {
            const summary = await run(result.suggestedMapping);
            if (summary) {
              navigate('/bills');
              return;
            }
          }
          navigate('/import/mapping');
        }
        return;
      }

      let totalImported = 0;
      let totalSkipped = 0;
      let successFiles = 0;
      for (const item of expandedFiles) {
        const source = await buildImportSource(item.file, item.bytes, {
          password: activePassword,
        });
        const planned = await plan(source);
        if (!planned) {
          continue;
        }
        const validation = new ColumnMapper(planned.headers).validate(planned.suggestedMapping);
        if (!validation.ok) {
          continue;
        }
        const summary = await run(planned.suggestedMapping);
        if (summary) {
          totalImported += summary.rowImported;
          totalSkipped += summary.rowSkipped;
          successFiles += 1;
        }
      }

      setPasswordDialogOpen(false);
      setPasswordDialogError(null);
      setPendingEncryptedFiles(null);

      if (runtime) {
        const nextBatches = await runtime.importBatchRepository.list();
        setBatches(nextBatches);
        if (runtime.billRepository?.list) {
          const latestBills = await runtime.billRepository.list();
          useBillStore.getState().setBills(latestBills);
        }
      }

      setBatchSummary({
        fileCount: successFiles,
        rowImported: totalImported,
        rowSkipped: totalSkipped,
      });
      setNotice(`已完成 ${successFiles} 个文件的批量导入，共导入 ${totalImported} 条账单`);
    } catch (err) {
      if (isPasswordRequiredError(err)) {
        setPendingEncryptedFiles(supported);
        setPasswordDialogError(err.reason === 'incorrect_password' ? err.message : null);
        setPasswordDialogOpen(true);
        return;
      }
      setLocalError(err instanceof Error ? err.message : '读取或解析文件失败');
    } finally {
      setBusy(false);
    }
  };

  const displayError = error ?? localError;

  return (
    <div data-testid="import-page">
      <StepIndicator activeStep={0} />
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
        onFile={(file) => void handleFiles([file])}
        onFiles={(files) => void handleFiles(files)}
        password={filePassword}
        onPasswordChange={setFilePassword}
        disabled={busy}
      />
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
          label="系统自动识别全部字段后直接完成导入（无需手动确认字段）"
        />
      </Box>
      <LoadingOverlay visible={busy} label="正在解析文件…" />
      <RecentImports
        batches={batches}
        currentFileHash={fileHash}
        onDeleteBatch={(batch) => setPendingDeleteBatch(batch)}
        onClearAllBatches={() => setConfirmClearAllOpen(true)}
      />
      <Dialog
        open={passwordDialogOpen}
        onClose={() => {
          setPasswordDialogOpen(false);
          setPasswordDialogError(null);
          setPendingEncryptedFiles(null);
        }}
        maxWidth="xs"
        fullWidth
        data-testid="password-prompt-dialog"
      >
        <DialogTitle>输入文件解密密码</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2, color: 'var(--lifehub-text-muted)' }}>
            该 PDF 或 ZIP 压缩包受密码保护，请输入文件解密/解压密码后继续导入。
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
            type="password"
            label="解密密码"
            value={filePassword}
            onChange={(event) => setFilePassword(event.target.value)}
            data-testid="password-prompt-input"
            inputProps={{
              'data-testid': 'password-dialog-input',
              'aria-label': '解密密码',
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setPasswordDialogOpen(false);
              setPasswordDialogError(null);
              setPendingEncryptedFiles(null);
            }}
          >
            取消
          </Button>
          <Button
            variant="contained"
            disabled={!filePassword.trim() || busy}
            onClick={() => {
              if (pendingEncryptedFiles) {
                void handleFiles(pendingEncryptedFiles, filePassword);
              }
            }}
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
