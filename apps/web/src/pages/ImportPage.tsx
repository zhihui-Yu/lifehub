/**
 * 导入页面（UI-01）。
 *
 * 架构位置：apps/web 的「页面」层。
 *
 * 说明：拖拽 + 选择文件是同一入口；解析后自动跳转到 `/import/mapping`。
 */
import { useEffect, useState } from 'react';
import { Alert, Snackbar } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { DropZone } from '@/components/import/DropZone';
import { RecentImports } from '@/components/import/RecentImports';
import { StepIndicator } from '@/components/import/StepIndicator';
import { LoadingOverlay } from '@/components/common/LoadingOverlay';
import { useImportFlow } from '@/hooks/useImportFlow';
import { useVault } from '@/hooks/useVault';
import { useImportStore } from '@/store';
import { isSupportedFileType, readFileBytes } from '@/utils/file';
import type { ImportBatch } from '@lifehub/core';

/**
 * 渲染导入页面。
 *
 * @returns React 节点
 */
export function ImportPage() {
  const navigate = useNavigate();
  const { runtime } = useVault();
  const { plan } = useImportFlow();
  const error = useImportStore((state) => state.error);
  const fileHash = useImportStore((state) => state.plan?.fileHash);

  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  const handleFile = async (file: File): Promise<void> => {
    if (!isSupportedFileType(file)) {
      setNotice('不支持的文件类型，请上传 .csv 文件');
      return;
    }
    setBusy(true);
    try {
      const bytes = await readFileBytes(file);
      const result = await plan(file.name, bytes);
      if (result) {
        navigate('/import/mapping');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="import-page">
      <StepIndicator activeStep={0} />
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}
      <DropZone onFile={(file) => void handleFile(file)} disabled={busy} />
      <LoadingOverlay visible={busy} label="正在解析文件…" />
      <RecentImports batches={batches} currentFileHash={fileHash} />
      <Snackbar
        open={notice !== null}
        autoHideDuration={4000}
        onClose={() => setNotice(null)}
        message={notice ?? ''}
      />
    </div>
  );
}
