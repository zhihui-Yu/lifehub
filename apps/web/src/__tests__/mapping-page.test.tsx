/**
 * 列头映射页面测试。
 *
 * 覆盖需求：A-05（自定义列头映射）、A-10（映射确认与实时预览）、A-11（导入结果提示）。
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ColumnMapping, ImportPlan, ImportSummary, PreviewRow } from '@lifehub/core';
import { MappingPage } from '@/pages/MappingPage';
import { useImportStore } from '@/store/import-store';

/**
 * 打桩用的钩子替身。
 *
 * 说明：必须用 `vi.hoisted` 提前创建——
 * `vi.mock` 的工厂函数会被提升到模块顶层，直接引用后面声明的 `const` 会踩到 TDZ。
 */
const { updateMapping, run } = vi.hoisted(() => ({
  updateMapping: vi.fn<(mapping: ColumnMapping) => Promise<void>>(),
  run: vi.fn<(mapping: ColumnMapping) => Promise<ImportSummary | null>>(),
}));

vi.mock('@/hooks/useImportFlow', () => ({
  useImportFlow: () => ({
    plan: vi.fn(),
    refreshPreview: vi.fn(),
    updateMapping,
    run,
  }),
}));

/** 构造一份导入计划。 */
function plan(partial: Partial<ImportPlan> = {}): ImportPlan {
  return {
    fileHash: 'a'.repeat(64),
    encoding: 'utf-8',
    headers: ['日期', '金额', '对方'],
    delimiter: ',',
    rowCount: 1,
    fileSignature: 'b'.repeat(64),
    suggestedMapping: { 0: 'occurredAt', 1: 'amount', 2: 'counterparty' },
    matchedTemplateId: null,
    matchedTemplateName: null,
    preview: [],
    duplicateFile: false,
    duplicateOf: null,
    sourceChannel: 'csv',
    crossSourceCandidates: [],
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
    note: '拿铁',
    raw: '2024-01-15,35.50,星巴克,拿铁',
    error: null,
    ...partial,
  };
}

/** 渲染映射页（页面内部使用 `useNavigate`，需要路由上下文）。 */
function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/import']}>
      <MappingPage />
    </MemoryRouter>,
  );
}

describe('MappingPage', () => {
  beforeEach(() => {
    updateMapping.mockReset();
    run.mockReset();
    useImportStore.getState().reset();
  });

  it('没有计划时提示先在导入页选择文件', () => {
    renderPage();
    expect(screen.getByText(/请先在导入页选择一个 CSV 文件/)).toBeInTheDocument();
    expect(screen.queryByTestId('mapping-page')).not.toBeInTheDocument();
  });

  it('必填字段未映射时给出中文提示并禁用「开始导入」', () => {
    useImportStore.setState({
      plan: plan({ suggestedMapping: {} }),
      mapping: {},
      stage: 'mapping',
    });
    renderPage();

    const validation = screen.getByTestId('mapping-validation');
    expect(validation).toHaveTextContent('请先映射『日期』和『金额』两列');
    expect(screen.getByTestId('run-import-button')).toBeDisabled();
  });

  it('必填字段映射完整后提示消失且「开始导入」可用', () => {
    useImportStore.setState({
      plan: plan(),
      mapping: { 0: 'occurredAt', 1: 'amount', 2: 'counterparty' },
      stage: 'mapping',
    });
    renderPage();

    expect(screen.queryByTestId('mapping-validation')).not.toBeInTheDocument();
    expect(screen.getByTestId('run-import-button')).toBeEnabled();
  });

  it('实时预览展示映射后的前 N 行', () => {
    useImportStore.setState({
      plan: plan(),
      mapping: { 0: 'occurredAt', 1: 'amount', 2: 'counterparty' },
      preview: [previewRow()],
      stage: 'mapping',
    });
    renderPage();

    expect(screen.getByText('星巴克')).toBeInTheDocument();
    expect(screen.getByText('¥35.50')).toBeInTheDocument();
    expect(screen.getByText('2024-01-15')).toBeInTheDocument();
  });

  it('修改映射会触发实时重算预览', async () => {
    useImportStore.setState({
      plan: plan(),
      mapping: { 0: 'occurredAt', 1: 'amount', 2: 'counterparty' },
      stage: 'mapping',
    });
    renderPage();

    // 点击源列即解除该列的映射（看板的「点击可解除」交互）。
    const sourceColumn = screen.getByTestId('source-column-2');
    await act(async () => {
      sourceColumn.click();
    });

    await waitFor(() => {
      expect(updateMapping).toHaveBeenCalledTimes(1);
    });
    const next = updateMapping.mock.calls[0]?.[0] as ColumnMapping;
    expect(next[2]).toBeUndefined();
    expect(next[0]).toBe('occurredAt');
  });

  it('导入成功后弹出「成功导入 N 条，跳过 M 条」提示', async () => {
    run.mockResolvedValue({
      batchId: 'batch-1',
      rowTotal: 2,
      rowImported: 2,
      rowSkipped: 0,
      rowDuplicated: 0,
      errors: [],
      durationMs: 5,
      duplicateFile: false,
      rowCrossSourceDuplicate: 0,
    });
    useImportStore.setState({
      plan: plan(),
      mapping: { 0: 'occurredAt', 1: 'amount', 2: 'counterparty' },
      stage: 'mapping',
    });
    renderPage();

    const button = screen.getByTestId('run-import-button');
    await act(async () => {
      button.click();
    });

    await waitFor(() => {
      expect(screen.getByText('成功导入 2 条')).toBeInTheDocument();
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('自动识别全部必填字段后展示零配置横幅与字段摘要 Chip，支持顶部「直接开始导入」一键入库', async () => {
    run.mockResolvedValue({
      batchId: 'batch-quick',
      rowTotal: 64,
      rowImported: 63,
      rowSkipped: 1,
      rowDuplicated: 0,
      errors: [],
      durationMs: 8,
      duplicateFile: false,
      rowCrossSourceDuplicate: 0,
    });
    useImportStore.setState({
      plan: plan({ rowCount: 64 }),
      mapping: { 0: 'occurredAt', 1: 'amount', 2: 'counterparty' },
      stage: 'mapping',
    });
    renderPage();

    const banner = screen.getByTestId('auto-mapping-banner');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent('系统已自动识别并完成全部字段匹配（共 64 行待导入），无需手动选择字段！');
    expect(banner).toHaveTextContent('日期 ← 日期');
    expect(banner).toHaveTextContent('金额 ← 金额');
    expect(banner).toHaveTextContent('交易对方 ← 对方');

    const quickBtn = screen.getByTestId('quick-commit-button');
    expect(quickBtn).toBeEnabled();
    await act(async () => {
      quickBtn.click();
    });

    await waitFor(() => {
      expect(run).toHaveBeenCalledTimes(1);
    });
  });

  it('支持通过「收起字段映射 / 展开字段映射」按钮折叠或展开映射看板并同步更新 aria-expanded', async () => {
    useImportStore.setState({
      plan: plan(),
      mapping: { 0: 'occurredAt', 1: 'amount', 2: 'counterparty' },
      stage: 'mapping',
    });
    renderPage();

    const toggleBtn = screen.getByTestId('toggle-mapping-details');
    expect(toggleBtn).toHaveTextContent('收起字段映射');
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');

    await act(async () => {
      toggleBtn.click();
    });
    expect(toggleBtn).toHaveTextContent('展开字段映射');
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
  });

  it('检测到重复文件时展示覆盖重导复选框与「立即重新导入」按钮，点击后传入 allowDuplicate 与 overwriteExisting', async () => {
    run.mockResolvedValue({
      batchId: 'batch-reimport',
      rowTotal: 10,
      rowImported: 10,
      rowSkipped: 0,
      rowDuplicated: 0,
      errors: [],
      durationMs: 6,
      duplicateFile: false,
      rowCrossSourceDuplicate: 0,
    });
    const mapping: ColumnMapping = { 0: 'occurredAt', 1: 'amount', 2: 'counterparty' };
    useImportStore.setState({
      plan: plan({ duplicateFile: true, duplicateOf: '2024-01-15T08:00:00.000Z' }),
      mapping,
      stage: 'mapping',
    });
    renderPage();

    expect(screen.getByTestId('duplicate-file-alert')).toBeInTheDocument();
    const reimportBtn = screen.getByTestId('reimport-button');
    expect(reimportBtn).toBeEnabled();

    await act(async () => {
      reimportBtn.click();
    });

    await waitFor(() => {
      expect(run).toHaveBeenCalledWith(mapping, { allowDuplicate: true, overwriteExisting: true });
    });
  });
});
