/**
 * 导入流程 Hook。
 *
 * 架构位置：apps/web 的「Hooks」层。
 *
 * 说明：编排「选择文件 → plan → 映射调整 → run」四步（A-10 / A-11 / A-12）。
 */
import { useCallback } from 'react';
import { LifeHubError, type ColumnMapping, type ImportPlan, type ImportSummary } from '@lifehub/core';
import { createImportService } from '@/platform';
import { useImportStore } from '@/store';
import { useSettingsStore } from '@/store/settings-store';
import { useVault } from './useVault';

/** 导入流程 Hook 的返回值。 */
export interface UseImportFlowResult {
  /** 探查源文件，生成导入计划。 */
  plan: (fileName: string, bytes: Uint8Array) => Promise<ImportPlan | null>;
  /** 用当前映射重新计算预览。 */
  refreshPreview: (mapping: ColumnMapping) => Promise<void>;
  /** 更新映射并刷新预览。 */
  updateMapping: (mapping: ColumnMapping) => Promise<void>;
  /** 执行导入。 */
  run: (mapping: ColumnMapping) => Promise<ImportSummary | null>;
}

/**
 * 初始化导入流程。
 *
 * @returns 导入流程 Hook 的返回值
 */
export function useImportFlow(): UseImportFlowResult {
  const { runtime } = useVault();
  const bytes = useImportStore((state) => state.bytes);
  const fileName = useImportStore((state) => state.fileName);
  const setSource = useImportStore((state) => state.setSource);
  const setPlan = useImportStore((state) => state.setPlan);
  const setMapping = useImportStore((state) => state.setMapping);
  const setPreview = useImportStore((state) => state.setPreview);
  const setSummary = useImportStore((state) => state.setSummary);
  const setError = useImportStore((state) => state.setError);
  const timezone = useSettingsStore((state) => state.timezone);
  const currency = useSettingsStore((state) => state.currency);

  const buildService = useCallback(() => {
    const platform = runtime;
    if (!platform) {
      return null;
    }
    return createImportService(platform, 'local-device');
  }, [runtime]);

  const plan = useCallback(
    async (sourceName: string, sourceBytes: Uint8Array): Promise<ImportPlan | null> => {
      const service = buildService();
      if (!service) {
        setError('本地数据尚未就绪，请稍后再试');
        return null;
      }
      setSource(sourceName, sourceBytes);
      try {
        const result = await service.plan(
          { fileName: sourceName, sizeBytes: sourceBytes.length, bytes: sourceBytes },
          { userTimeZone: timezone, currency },
        );
        setPlan(result);
        setPreview(result.preview);
        return result;
      } catch (cause) {
        setError(cause instanceof LifeHubError ? cause.message : '文件解析失败，请检查文件格式');
        return null;
      }
    },
    [buildService, currency, setError, setPlan, setPreview, setSource, timezone],
  );

  const refreshPreview = useCallback(
    async (mapping: ColumnMapping): Promise<void> => {
      const service = buildService();
      if (!service || !bytes) {
        return;
      }
      try {
        const rows = await service.preview(
          { fileName, sizeBytes: bytes.length, bytes },
          mapping,
          10,
          { userTimeZone: timezone, currency },
        );
        setPreview(rows);
      } catch {
        // 预览失败不阻断主流程：映射页仍可继续调整。
        setPreview([]);
      }
    },
    [buildService, bytes, currency, fileName, setPreview, timezone],
  );

  const updateMapping = useCallback(
    async (mapping: ColumnMapping): Promise<void> => {
      setMapping(mapping);
      await refreshPreview(mapping);
    },
    [refreshPreview, setMapping],
  );

  const run = useCallback(
    async (mapping: ColumnMapping): Promise<ImportSummary | null> => {
      const service = buildService();
      if (!service || !bytes) {
        setError('本地数据尚未就绪，请稍后再试');
        return null;
      }
      try {
        const summary = await service.run(
          { fileName, sizeBytes: bytes.length, bytes },
          mapping,
          { userTimeZone: timezone, currency },
        );
        setSummary(summary);
        return summary;
      } catch (cause) {
        setError(cause instanceof LifeHubError ? cause.message : '导入失败，请重试');
        return null;
      }
    },
    [buildService, bytes, currency, fileName, setError, setSummary, timezone],
  );

  return { plan, refreshPreview, updateMapping, run };
}
