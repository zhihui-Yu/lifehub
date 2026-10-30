/**
 * 导入流程状态。
 *
 * 架构位置：apps/web 的「状态管理」层（Zustand）。
 *
 * 说明：承载「源文件 → 计划 → 映射 → 摘要」四段式导入流程（系统设计 §4.2）。
 */
import { create } from 'zustand';
import type { ColumnMapping, ImportPlan, ImportSummary, PreviewRow } from '@lifehub/core';

/** 导入流程的当前阶段。 */
export type ImportStage = 'idle' | 'planning' | 'mapping' | 'running' | 'done' | 'error';

/** 导入 store 的状态与动作。 */
export interface ImportState {
  /** 当前阶段。 */
  stage: ImportStage;
  /** 源文件名。 */
  fileName: string;
  /** 源文件字节。 */
  bytes: Uint8Array | null;
  /** 探查得到的计划。 */
  plan: ImportPlan | null;
  /** 当前列映射。 */
  mapping: ColumnMapping;
  /** 实时预览行。 */
  preview: PreviewRow[];
  /** 导入摘要。 */
  summary: ImportSummary | null;
  /** 中文错误提示。 */
  error: string | null;
  /** 设置源文件并进入 planning 阶段。 */
  setSource: (fileName: string, bytes: Uint8Array) => void;
  /** 设置计划与初始映射。 */
  setPlan: (plan: ImportPlan) => void;
  /** 更新列映射。 */
  setMapping: (mapping: ColumnMapping) => void;
  /** 更新预览行。 */
  setPreview: (preview: PreviewRow[]) => void;
  /** 设置导入摘要并进入 done 阶段。 */
  setSummary: (summary: ImportSummary) => void;
  /** 设置错误并进入 error 阶段。 */
  setError: (message: string) => void;
  /** 重置整个流程。 */
  reset: () => void;
}

/**
 * 导入流程 store。
 */
export const useImportStore = create<ImportState>((set) => ({
  stage: 'idle',
  fileName: '',
  bytes: null,
  plan: null,
  mapping: {},
  preview: [],
  summary: null,
  error: null,
  setSource: (fileName, bytes) => set({ stage: 'planning', fileName, bytes, error: null, summary: null }),
  setPlan: (plan) => set({ stage: 'mapping', plan, mapping: { ...plan.suggestedMapping }, error: null }),
  setMapping: (mapping) => set({ mapping }),
  setPreview: (preview) => set({ preview }),
  setSummary: (summary) => set({ stage: 'done', summary }),
  setError: (message) => set({ stage: 'error', error: message }),
  reset: () =>
    set({
      stage: 'idle',
      fileName: '',
      bytes: null,
      plan: null,
      mapping: {},
      preview: [],
      summary: null,
      error: null,
    }),
}));
