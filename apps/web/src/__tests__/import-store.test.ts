/**
 * 导入流程 store 单测。
 *
 * 覆盖需求：A-10（导入四步流程的状态流转）、A-11（导入摘要）、A-13（模板预填映射）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ColumnMapping, ImportPlan, ImportSummary, PreviewRow } from '@lifehub/core';
import { useImportStore } from '@/store/import-store';

/** 构造一份导入计划。 */
function plan(partial: Partial<ImportPlan> = {}): ImportPlan {
  return {
    fileHash: 'a'.repeat(64),
    encoding: 'utf-8',
    headers: ['日期', '金额', '对方'],
    delimiter: ',',
    rowCount: 2,
    fileSignature: 'b'.repeat(64),
    suggestedMapping: { 0: 'occurredAt', 1: 'amount', 2: 'counterparty' },
    matchedTemplateId: null,
    matchedTemplateName: null,
    preview: [],
    duplicateFile: false,
    duplicateOf: null,
    ...partial,
  };
}

/** 构造一条预览行。 */
function previewRow(partial: Partial<PreviewRow> = {}): PreviewRow {
  return {
    rowIndex: 0,
    occurredAt: '2024-01-15T08:12:00.000Z',
    localDate: '2024-01-15',
    amountMinor: 3550,
    direction: 'expense',
    counterparty: '星巴克',
    note: '',
    raw: '2024-01-15,35.50,星巴克',
    error: null,
    ...partial,
  };
}

/** 构造一份导入摘要。 */
function summary(partial: Partial<ImportSummary> = {}): ImportSummary {
  return {
    batchId: 'batch-1',
    rowTotal: 2,
    rowImported: 2,
    rowSkipped: 0,
    rowDuplicated: 0,
    errors: [],
    durationMs: 12,
    duplicateFile: false,
    ...partial,
  };
}

describe('useImportStore', () => {
  beforeEach(() => {
    useImportStore.getState().reset();
  });

  it('初始状态为空且处于 idle 阶段', () => {
    const state = useImportStore.getState();
    expect(state.stage).toBe('idle');
    expect(state.fileName).toBe('');
    expect(state.bytes).toBeNull();
    expect(state.plan).toBeNull();
    expect(state.mapping).toEqual({});
    expect(state.preview).toEqual([]);
    expect(state.summary).toBeNull();
    expect(state.error).toBeNull();
  });

  it('setSource 进入 planning 阶段并记录源文件', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    useImportStore.getState().setSource('a.csv', bytes);

    const state = useImportStore.getState();
    expect(state.stage).toBe('planning');
    expect(state.fileName).toBe('a.csv');
    expect(state.bytes).toBe(bytes);
  });

  it('setPlan 进入 mapping 阶段并用建议映射预填当前映射', () => {
    useImportStore.getState().setSource('a.csv', new Uint8Array([1]));
    useImportStore.getState().setPlan(plan());

    const state = useImportStore.getState();
    expect(state.stage).toBe('mapping');
    expect(state.plan?.headers).toEqual(['日期', '金额', '对方']);
    expect(state.mapping).toEqual({ 0: 'occurredAt', 1: 'amount', 2: 'counterparty' });
    expect(state.error).toBeNull();
  });

  it('setMapping 只更新映射，不改变阶段', () => {
    useImportStore.getState().setPlan(plan());
    const next: ColumnMapping = { 0: 'occurredAt', 1: 'amount' };
    useImportStore.getState().setMapping(next);

    const state = useImportStore.getState();
    expect(state.stage).toBe('mapping');
    expect(state.mapping).toEqual(next);
  });

  it('setPreview 更新实时预览行', () => {
    const rows = [previewRow()];
    useImportStore.getState().setPreview(rows);
    expect(useImportStore.getState().preview).toEqual(rows);
  });

  it('setSummary 进入 done 阶段并保留摘要', () => {
    const result = summary();
    useImportStore.getState().setSummary(result);

    const state = useImportStore.getState();
    expect(state.stage).toBe('done');
    expect(state.summary).toEqual(result);
  });

  it('setError 进入 error 阶段并记录中文提示', () => {
    useImportStore.getState().setError('文件解析失败，请检查文件格式');

    const state = useImportStore.getState();
    expect(state.stage).toBe('error');
    expect(state.error).toBe('文件解析失败，请检查文件格式');
  });

  it('reset 清空全部状态回到 idle', () => {
    useImportStore.getState().setSource('a.csv', new Uint8Array([1]));
    useImportStore.getState().setPlan(plan());
    useImportStore.getState().setPreview([previewRow()]);
    useImportStore.getState().setSummary(summary());
    useImportStore.getState().reset();

    const state = useImportStore.getState();
    expect(state.stage).toBe('idle');
    expect(state.fileName).toBe('');
    expect(state.bytes).toBeNull();
    expect(state.plan).toBeNull();
    expect(state.mapping).toEqual({});
    expect(state.preview).toEqual([]);
    expect(state.summary).toBeNull();
  });
});
