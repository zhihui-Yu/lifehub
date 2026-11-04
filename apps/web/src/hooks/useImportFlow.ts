/**
 * 导入流程 Hook。
 *
 * 架构位置：apps/web 的「Hooks」层。
 *
 * 说明：编排「选择文件 → plan → 映射调整 → run」四步（A-10 / A-11 / A-12 / A-25）。
 * 多格式支持：源文件已由 `buildImportSource` 在浏览器侧抽成核心层统一的 `ImportSource`
 * （CSV 字节 / XLSX 二维表 / PDF 文本），这里只负责把它连同跨来源去重开关传给 core。
 */
import { useCallback } from 'react';
import { LifeHubError, type ColumnMapping, type ImportPlan, type ImportSource, type ImportSummary } from '@lifehub/core';
import { createImportService, createPlatformRuntime, type PlatformRuntime } from '@/platform';
import { dekProvider, useBillStore, useImportStore, useVaultStore } from '@/store';
import { useSettingsStore } from '@/store/settings-store';
import { useVault } from './useVault';

/** 导入流程 Hook 的返回值。 */
export interface UseImportFlowResult {
  /** 探查源文件，生成导入计划。 */
  plan: (source: ImportSource) => Promise<ImportPlan | null>;
  /** 用当前映射重新计算预览。 */
  refreshPreview: (mapping: ColumnMapping) => Promise<void>;
  /** 更新映射并刷新预览。 */
  updateMapping: (mapping: ColumnMapping) => Promise<void>;
  /** 执行导入（可选指定是否允许重复导入或覆盖已有批次）。 */
  run: (
    mapping: ColumnMapping,
    options?: { allowDuplicate?: boolean; overwriteExisting?: boolean },
  ) => Promise<ImportSummary | null>;
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
  const format = useImportStore((state) => state.format);
  const table = useImportStore((state) => state.table);
  const text = useImportStore((state) => state.text);
  const skipCrossSourceDuplicates = useImportStore((state) => state.skipCrossSourceDuplicates);
  const setSource = useImportStore((state) => state.setSource);
  const setPlan = useImportStore((state) => state.setPlan);
  const setMapping = useImportStore((state) => state.setMapping);
  const setPreview = useImportStore((state) => state.setPreview);
  const setSummary = useImportStore((state) => state.setSummary);
  const setError = useImportStore((state) => state.setError);
  const timezone = useSettingsStore((state) => state.timezone);
  const currency = useSettingsStore((state) => state.currency);

  const ensureService = useCallback(async () => {
    if (!dekProvider.isUnlocked() && !useSettingsStore.getState().securityEnabled) {
      const defaultDek = new Uint8Array(32).fill(7);
      dekProvider.unlock(defaultDek, 1);
      useVaultStore.getState().setUnlocked(defaultDek, 1);
    }
    let activeRuntime: PlatformRuntime | null = runtime;
    if (!activeRuntime && typeof createPlatformRuntime === 'function') {
      const fallback = createPlatformRuntime(dekProvider);
      if (fallback?.storageAdapter?.open) {
        await fallback.storageAdapter.open();
        activeRuntime = fallback;
      }
    }
    if (!activeRuntime) {
      return { service: null, activeRuntime: null };
    }
    return {
      service: createImportService(activeRuntime, 'local-device'),
      activeRuntime,
    };
  }, [runtime]);

  /** 从 store 里拼出核心层统一的导入源。 */
  const buildSource = useCallback((): ImportSource | null => {
    if (!bytes) {
      return null;
    }
    return { fileName, sizeBytes: bytes.length, bytes, format, table, text };
  }, [bytes, fileName, format, table, text]);

  const plan = useCallback(
    async (source: ImportSource): Promise<ImportPlan | null> => {
      setError(null);
      const { service } = await ensureService();
      if (!service) {
        setError('本地数据尚未就绪，请稍后再试');
        return null;
      }
      setSource(source.fileName, source.bytes, {
        format: source.format,
        table: source.table,
        text: source.text,
      });
      try {
        const result = await service.plan(source, { userTimeZone: timezone, currency });
        setPlan(result);
        setPreview(result.preview);
        return result;
      } catch (cause) {
        setError(cause instanceof LifeHubError ? cause.message : '文件解析失败，请检查文件格式');
        return null;
      }
    },
    [currency, ensureService, setError, setPlan, setPreview, setSource, timezone],
  );

  const refreshPreview = useCallback(
    async (mapping: ColumnMapping): Promise<void> => {
      const { service } = await ensureService();
      const source = buildSource();
      if (!service || !source) {
        return;
      }
      try {
        const rows = await service.preview(source, mapping, 10, { userTimeZone: timezone, currency });
        setPreview(rows);
      } catch {
        // 预览失败不阻断主流程：映射页仍可继续调整。
        setPreview([]);
      }
    },
    [buildSource, currency, ensureService, setPreview, timezone],
  );

  const updateMapping = useCallback(
    async (mapping: ColumnMapping): Promise<void> => {
      setMapping(mapping);
      await refreshPreview(mapping);
    },
    [refreshPreview, setMapping],
  );

  const run = useCallback(
    async (
      mapping: ColumnMapping,
      options?: { allowDuplicate?: boolean; overwriteExisting?: boolean },
    ): Promise<ImportSummary | null> => {
      setError(null);
      const { service, activeRuntime } = await ensureService();
      const source = buildSource();
      if (!service || !source) {
        setError('本地数据尚未就绪，请稍后再试');
        return null;
      }
      try {
        const isDuplicatePlan = Boolean(useImportStore.getState().plan?.duplicateFile);
        const allowDuplicate = options?.allowDuplicate ?? isDuplicatePlan;
        const overwriteExisting = options?.overwriteExisting ?? isDuplicatePlan;
        const summary = await service.run(source, mapping, {
          userTimeZone: timezone,
          currency,
          skipCrossSourceDuplicates,
          allowDuplicate,
          overwriteExisting,
        });
        setSummary(summary);
        if (activeRuntime?.billRepository) {
          const latestBills = await activeRuntime.billRepository.list();
          useBillStore.getState().setBills(latestBills);
        }
        return summary;
      } catch (cause) {
        setError(cause instanceof LifeHubError ? cause.message : '导入失败，请重试');
        return null;
      }
    },
    [buildSource, currency, ensureService, setError, setSummary, skipCrossSourceDuplicates, timezone],
  );

  return { plan, refreshPreview, updateMapping, run };
}
