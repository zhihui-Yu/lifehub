/**
 * 导入流程 Hook 与导入结果提示测试（A-11 / A-12）。
 *
 * 覆盖需求：
 * - A-10：探查 → 映射 → 预览的流程编排；
 * - A-11 ①：坏行不中断导入（错误行被收集进摘要，不影响其它行）；
 * - A-11 ②：导入结束给出中文摘要「成功导入 N 条，跳过 M 条」；
 * - A-11 ③：被跳过的行以「行号 + 原因」展示；
 * - A-12 ②：同一文件重复导入时给出「该文件已导入过（时间戳）」提示。
 *
 * 说明：`@/platform` 的 `createImportService` 被替换成受控替身，
 * 但**真实的 `useImportFlow` Hook**、**真实的 import-store** 与
 * **真实的映射页渲染逻辑**全部保留，因此断言的是真实的状态流转与 UI 文案。
 */
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ColumnMapping, ImportPlan, ImportSummary } from '@lifehub/core';
import { useImportFlow } from '@/hooks/useImportFlow';
import { MappingPage } from '@/pages/MappingPage';
import { useImportStore } from '@/store';
import { makePlan, makePreviewRow, makeSummary } from '@/__tests__/test-utils/fixtures';
import { renderWithRouter } from '@/__tests__/test-utils/render';

/** 受控的导入服务替身与保险库会话替身。 */
const { service, vaultState } = vi.hoisted(() => ({
  service: {
    plan: vi.fn<(source: unknown, options?: unknown) => Promise<ImportPlan>>(),
    preview: vi.fn<(source: unknown, mapping: ColumnMapping, rowCount?: number, options?: unknown) => Promise<unknown[]>>(),
    run: vi.fn<(source: unknown, mapping: ColumnMapping, options?: unknown) => Promise<ImportSummary>>(),
  },
  vaultState: {
    runtime: { cryptoProvider: { name: 'web-crypto' } } as unknown,
  },
}));

vi.mock('@/platform', () => ({
  createImportService: vi.fn(() => service),
}));

vi.mock('@/hooks/useVault', () => ({
  useVault: () => ({
    runtime: vaultState.runtime,
    status: 'unlocked',
    vaultCreated: true,
    error: null,
    failedAttempts: 0,
    recoveryBundle: null,
    createVault: vi.fn(),
    unlock: vi.fn(),
    unlockWithRecoveryCode: vi.fn(),
    regenerateRecoveryCode: vi.fn(),
    lock: vi.fn(),
  }),
}));

/** 假的源文件字节。 */
const BYTES = new Uint8Array([1, 2, 3, 4]);

describe('useImportFlow 流程编排（A-10 / A-11 / A-12）', () => {
  beforeEach(() => {
    service.plan.mockReset();
    service.preview.mockReset();
    service.run.mockReset();
    vaultState.runtime = { cryptoProvider: { name: 'web-crypto' } };
    useImportStore.getState().reset();
  });

  it('plan 记录源文件、写入计划与预览，并把阶段推进到 mapping', async () => {
    const plan = makePlan({ preview: [makePreviewRow()] });
    service.plan.mockResolvedValue(plan);

    const { result } = renderHook(() => useImportFlow());

    let returned: ImportPlan | null = null;
    await act(async () => {
      returned = await result.current.plan('微信支付.csv', BYTES);
    });

    expect(service.plan).toHaveBeenCalledTimes(1);
    const state = useImportStore.getState();
    expect(state.stage).toBe('mapping');
    expect(state.fileName).toBe('微信支付.csv');
    expect(state.bytes).toBe(BYTES);
    expect(state.plan?.headers).toEqual(['日期', '金额', '对方']);
    expect(state.mapping).toEqual({ 0: 'occurredAt', 1: 'amount', 2: 'counterparty' });
    expect(state.preview).toHaveLength(1);
    expect(returned).toEqual(plan);
  });

  it('plan 失败时给出中文错误提示并进入 error 阶段', async () => {
    service.plan.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useImportFlow());

    let returned: ImportPlan | null = null;
    await act(async () => {
      returned = await result.current.plan('坏文件.csv', BYTES);
    });

    expect(returned).toBeNull();
    const state = useImportStore.getState();
    expect(state.stage).toBe('error');
    expect(state.error).toBe('文件解析失败，请检查文件格式');
  });

  it('updateMapping 更新映射并按 10 行上限重算预览', async () => {
    service.plan.mockResolvedValue(makePlan());
    service.preview.mockResolvedValue([makePreviewRow({ counterparty: '重算结果' })]);
    const { result } = renderHook(() => useImportFlow());

    await act(async () => {
      await result.current.plan('a.csv', BYTES);
    });

    const next: ColumnMapping = { 0: 'occurredAt', 1: 'amount' };
    await act(async () => {
      await result.current.updateMapping(next);
    });

    expect(useImportStore.getState().mapping).toEqual(next);
    expect(service.preview).toHaveBeenCalledTimes(1);
    expect(service.preview.mock.calls[0]?.[2]).toBe(10);
    expect(useImportStore.getState().preview[0]?.counterparty).toBe('重算结果');
  });

  it('run 返回中文摘要所需的数据并把阶段推进到 done', async () => {
    const summary = makeSummary({ rowTotal: 3, rowImported: 2, rowSkipped: 1 });
    service.plan.mockResolvedValue(makePlan());
    service.run.mockResolvedValue(summary);
    const { result } = renderHook(() => useImportFlow());

    await act(async () => {
      await result.current.plan('a.csv', BYTES);
    });

    let returned: ImportSummary | null = null;
    await act(async () => {
      returned = await result.current.run({ 0: 'occurredAt', 1: 'amount' });
    });

    expect(returned).toEqual(summary);
    const state = useImportStore.getState();
    expect(state.stage).toBe('done');
    expect(state.summary?.rowImported).toBe(2);
    expect(state.summary?.rowSkipped).toBe(1);
  });

  it('run 失败时给出中文错误提示并进入 error 阶段', async () => {
    service.plan.mockResolvedValue(makePlan());
    service.run.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useImportFlow());

    await act(async () => {
      await result.current.plan('a.csv', BYTES);
    });

    let returned: ImportSummary | null = null;
    await act(async () => {
      returned = await result.current.run({ 0: 'occurredAt', 1: 'amount' });
    });

    expect(returned).toBeNull();
    expect(useImportStore.getState().stage).toBe('error');
    expect(useImportStore.getState().error).toBe('导入失败，请重试');
  });

  it('平台运行时未就绪时给出「本地数据尚未就绪」提示', async () => {
    vaultState.runtime = null;
    const { result } = renderHook(() => useImportFlow());

    let returned: ImportPlan | null = null;
    await act(async () => {
      returned = await result.current.plan('a.csv', BYTES);
    });

    expect(returned).toBeNull();
    expect(useImportStore.getState().error).toBe('本地数据尚未就绪，请稍后再试');
  });
});

describe('MappingPage 导入结果提示（A-11 / A-12）', () => {
  beforeEach(() => {
    service.plan.mockReset();
    service.preview.mockReset();
    service.run.mockReset();
    vaultState.runtime = { cryptoProvider: { name: 'web-crypto' } };
    useImportStore.getState().reset();
  });

  it('坏行不中断：被跳过的行以「行号 + 原因」展示，导入仍然完成', () => {
    useImportStore.setState({
      stage: 'mapping',
      plan: makePlan(),
      mapping: { 0: 'occurredAt', 1: 'amount', 2: 'counterparty' },
      preview: [makePreviewRow()],
      summary: makeSummary({
        rowTotal: 4,
        rowImported: 2,
        rowSkipped: 2,
        errors: [
          { rowIndex: 2, columnIndex: 1, reason: '金额不是合法数字', raw: 'abc' },
          { rowIndex: 3, columnIndex: 0, reason: '日期无法解析', raw: '???' },
        ],
      }),
    });

    renderWithRouter(<MappingPage />);

    const summaryBox = screen.getByTestId('error-summary');
    expect(summaryBox).toHaveTextContent('已跳过 2 行');
    expect(summaryBox).toHaveTextContent('第 3 行：金额不是合法数字');
    expect(summaryBox).toHaveTextContent('第 4 行：日期无法解析');
  });

  it('重复文件：计划里标记 duplicateFile 时给出「该文件已导入过（时间戳）」告警', () => {
    useImportStore.setState({
      stage: 'mapping',
      plan: makePlan({ duplicateFile: true, duplicateOf: '2024-01-15T08:12:00.000Z' }),
      mapping: { 0: 'occurredAt', 1: 'amount' },
    });

    renderWithRouter(<MappingPage />);

    expect(screen.getByText(/该文件已导入过（2024-01-15T08:12:00.000Z）/)).toBeInTheDocument();
  });

  it('重复文件：导入结果标记 duplicateFile 时给出「内容完全相同，已跳过重复写入」提示', async () => {
    service.run.mockResolvedValue(makeSummary({ duplicateFile: true, rowImported: 0, rowSkipped: 0 }));
    useImportStore.setState({
      stage: 'mapping',
      plan: makePlan(),
      mapping: { 0: 'occurredAt', 1: 'amount' },
      bytes: BYTES,
      fileName: 'a.csv',
    });
    renderWithRouter(<MappingPage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('run-import-button'));
    });

    await waitFor(() => {
      expect(screen.getByText('该文件已导入过（内容完全相同），已跳过重复写入')).toBeInTheDocument();
    });
  });

  it('坏行全部被跳过时仍给出「成功导入 0 条」摘要', async () => {
    service.run.mockResolvedValue(
      makeSummary({
        rowTotal: 1,
        rowImported: 0,
        rowSkipped: 1,
        errors: [{ rowIndex: 0, columnIndex: 1, reason: '金额不是合法数字', raw: 'abc' }],
      }),
    );
    useImportStore.setState({
      stage: 'mapping',
      plan: makePlan(),
      mapping: { 0: 'occurredAt', 1: 'amount' },
      bytes: BYTES,
      fileName: 'a.csv',
    });
    renderWithRouter(<MappingPage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('run-import-button'));
    });

    await waitFor(() => {
      expect(screen.getByText('成功导入 0 条，跳过 1 条（重复）')).toBeInTheDocument();
    });
    expect(screen.getByTestId('error-summary')).toHaveTextContent('已跳过 1 行');
    expect(screen.getByTestId('error-summary')).toHaveTextContent('第 1 行：金额不是合法数字');
  });
});
