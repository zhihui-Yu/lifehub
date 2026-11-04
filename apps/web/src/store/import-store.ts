/**
 * 导入流程状态。
 *
 * 架构位置：apps/web 的「状态管理」层（Zustand）。
 *
 * 说明：承载「源文件 → 计划 → 映射 → 摘要」四段式导入流程（系统设计 §4.2）。
 */
import { create } from 'zustand';
import type {
  ColumnMapping,
  ImportPlan,
  ImportSummary,
  PreviewRow,
  RawTable,
} from '@lifehub/core';

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
  /** 文件格式（xlsx / pdf 时携带，用于 core 选择解析路径）。 */
  format?: 'csv' | 'xlsx' | 'pdf';
  /** 已抽取的规整二维表（xlsx 来源）。 */
  table?: RawTable;
  /** 已抽取的 PDF 文本（pdf 来源）。 */
  text?: string;
  /** 是否跳过跨来源重复（微信 / 支付宝 与 银行视为同一笔）。默认 true。 */
  skipCrossSourceDuplicates: boolean;
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
  setSource: (
    fileName: string,
    bytes: Uint8Array,
    extra?: { format?: 'csv' | 'xlsx' | 'pdf'; table?: RawTable; text?: string },
  ) => void;
  /** 设置计划与初始映射。 */
  setPlan: (plan: ImportPlan) => void;
  /** 更新列映射。 */
  setMapping: (mapping: ColumnMapping) => void;
  /** 更新预览行。 */
  setPreview: (preview: PreviewRow[]) => void;
  /** 设置是否跳过跨来源重复。 */
  setSkipCrossSourceDuplicates: (value: boolean) => void;
  /** 设置导入摘要并进入 done 阶段。 */
  setSummary: (summary: ImportSummary) => void;
  /** 设置错误并进入 error 阶段（传 null 时清除错误）。 */
  setError: (message: string | null) => void;
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
  format: undefined,
  table: undefined,
  text: undefined,
  skipCrossSourceDuplicates: true,
  plan: null,
  mapping: {},
  preview: [],
  summary: null,
  error: null,
  setSource: (fileName, bytes, extra) =>
    set({
      stage: 'planning',
      fileName,
      bytes,
      format: extra?.format,
      table: extra?.table,
      text: extra?.text,
      skipCrossSourceDuplicates: true,
      error: null,
      summary: null,
    }),
  setPlan: (plan) => set({ stage: 'mapping', plan, mapping: { ...plan.suggestedMapping }, error: null }),
  setMapping: (mapping) => set({ mapping }),
  setPreview: (preview) => set({ preview }),
  setSkipCrossSourceDuplicates: (value) => set({ skipCrossSourceDuplicates: value }),
  setSummary: (summary) => set({ stage: 'done', summary }),
  setError: (message) =>
    set((state) => ({
      stage: message === null ? (state.stage === 'error' ? 'idle' : state.stage) : 'error',
      error: message,
    })),
  reset: () =>
    set({
      stage: 'idle',
      fileName: '',
      bytes: null,
      format: undefined,
      table: undefined,
      text: undefined,
      skipCrossSourceDuplicates: true,
      plan: null,
      mapping: {},
      preview: [],
      summary: null,
      error: null,
    }),
}));
