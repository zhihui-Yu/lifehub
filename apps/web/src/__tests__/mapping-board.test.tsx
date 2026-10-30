/**
 * 列头映射看板与映射页测试（A-10）。
 *
 * 覆盖需求：A-10 ①（下拉映射 / 整列拖拽两种方式）、A-10 ②（映射变更实时更新前 10 行预览）、
 * A-10 ③（必填字段未映射时禁用导入并给中文提示）、A-10 ④（同一字段被两列占用时给冲突提示）。
 *
 * 说明：
 * 1. 看板用真实的 `ColumnMappingBoard` 组件，**不 mock 交互**——
 *    下拉用 MUI Select 的真实开合 + 选项点击，拖拽用真实的 dragstart/drop 事件，
 *    这样才能验证「两种方式结果一致」这条 PRD 硬要求；
 * 2. 页面层只 mock `useImportFlow`（它需要真实的平台运行时），
 *    页面本身的校验、提示、按钮禁用逻辑全部走真实代码。
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ColumnMapping, ImportSummary } from '@lifehub/core';
import { ColumnMappingBoard } from '@/components/mapping/ColumnMappingBoard';
import { MappingPage } from '@/pages/MappingPage';
import { useImportStore } from '@/store';
import { makePlan, makePreviewRow, makeSummary } from '@/__tests__/test-utils/fixtures';
import { renderWithRouter } from '@/__tests__/test-utils/render';

/** 打桩用的钩子替身（`vi.mock` 工厂会被提升，必须用 `vi.hoisted` 提前创建）。 */
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

/** 看板默认表头。 */
const HEADERS = ['日期', '金额', '对方'];

/**
 * 通过下拉框把某个语义字段绑定到指定列。
 *
 * @param field 语义字段（用于定位槽位）
 * @param columnIndex 目标列的 0 基索引
 * @returns 无异常
 */
async function assignBySelect(field: string, columnIndex: number): Promise<void> {
  const slot = screen.getByTestId(`field-slot-${field}`);
  const combobox = within(slot).getByRole('combobox');
  await act(async () => {
    fireEvent.mouseDown(combobox);
  });
  const option = await screen.findByRole('option', { name: new RegExp(`^第 ${columnIndex + 1} 列`) });
  await act(async () => {
    fireEvent.click(option);
  });
}

/**
 * 把某个源列整列拖拽到语义字段槽位。
 *
 * @param columnIndex 源列的 0 基索引
 * @param field 目标语义字段
 * @returns 无异常
 */
function assignByDrag(columnIndex: number, field: string): void {
  const source = screen.getByTestId(`source-column-${columnIndex}`);
  const slot = screen.getByTestId(`field-slot-${field}`);
  fireEvent.dragStart(source);
  fireEvent.drop(slot);
}

describe('ColumnMappingBoard（A-10 ①④）', () => {
  it('下拉映射：把「金额」字段绑到第 2 列', async () => {
    const onChange = vi.fn();
    renderWithRouter(<ColumnMappingBoard headers={HEADERS} mapping={{ 0: 'occurredAt' }} onChange={onChange} />);

    await assignBySelect('amount', 1);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toEqual({ 0: 'occurredAt', 1: 'amount' });
  });

  it('整列拖拽：把第 3 列拖到「金额」槽位', () => {
    const onChange = vi.fn();
    renderWithRouter(<ColumnMappingBoard headers={HEADERS} mapping={{ 0: 'occurredAt' }} onChange={onChange} />);

    assignByDrag(2, 'amount');

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toEqual({ 0: 'occurredAt', 2: 'amount' });
  });

  it('下拉与拖拽两种方式产出的映射结果完全一致', async () => {
    const bySelect = vi.fn();
    const byDrag = vi.fn();

    const selectView = renderWithRouter(
      <ColumnMappingBoard headers={HEADERS} mapping={{ 0: 'occurredAt' }} onChange={bySelect} />,
    );
    await assignBySelect('amount', 1);
    selectView.unmount();

    renderWithRouter(<ColumnMappingBoard headers={HEADERS} mapping={{ 0: 'occurredAt' }} onChange={byDrag} />);
    assignByDrag(1, 'amount');

    expect(bySelect).toHaveBeenCalledTimes(1);
    expect(byDrag).toHaveBeenCalledTimes(1);
    expect(byDrag.mock.calls[0]?.[0]).toEqual(bySelect.mock.calls[0]?.[0]);
    expect(byDrag.mock.calls[0]?.[0]).toEqual({ 0: 'occurredAt', 1: 'amount' });
  });

  it('目标字段已被其它列占用时，拖拽会解除原占用（一个字段只能绑一列）', () => {
    const onChange = vi.fn();
    renderWithRouter(
      <ColumnMappingBoard headers={HEADERS} mapping={{ 0: 'occurredAt', 1: 'amount' }} onChange={onChange} />,
    );

    assignByDrag(2, 'amount');

    expect(onChange.mock.calls[0]?.[0]).toEqual({ 0: 'occurredAt', 2: 'amount' });
  });

  it('源列展示当前映射状态文案', () => {
    renderWithRouter(
      <ColumnMappingBoard headers={HEADERS} mapping={{ 0: 'occurredAt' }} onChange={vi.fn()} />,
    );

    expect(screen.getByText('已映射到「日期」')).toBeInTheDocument();
    expect(screen.getAllByText('未映射（点击可解除）')).toHaveLength(2);
  });

  it('点击源列可以解除该列的映射', () => {
    const onChange = vi.fn();
    renderWithRouter(
      <ColumnMappingBoard headers={HEADERS} mapping={{ 0: 'occurredAt', 2: 'counterparty' }} onChange={onChange} />,
    );

    fireEvent.click(screen.getByTestId('source-column-2'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toEqual({ 0: 'occurredAt' });
  });

  it('下拉选择「未映射」可以解除绑定', async () => {
    const onChange = vi.fn();
    renderWithRouter(
      <ColumnMappingBoard headers={HEADERS} mapping={{ 0: 'occurredAt', 1: 'amount' }} onChange={onChange} />,
    );

    const slot = screen.getByTestId('field-slot-amount');
    await act(async () => {
      fireEvent.mouseDown(within(slot).getByRole('combobox'));
    });
    const option = await screen.findByRole('option', { name: '未映射' });
    await act(async () => {
      fireEvent.click(option);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toEqual({ 0: 'occurredAt' });
  });
});

describe('MappingPage 校验与提示（A-10 ②③④）', () => {
  beforeEach(() => {
    updateMapping.mockReset();
    run.mockReset();
    useImportStore.getState().reset();
  });

  /**
   * 直接把映射页的 store 置为指定状态。
   *
   * @param partial store 状态覆盖项
   * @returns 无异常
   */
  function setupStore(partial: Partial<ReturnType<typeof useImportStore.getState>>): void {
    useImportStore.setState({
      stage: 'mapping',
      plan: makePlan(),
      mapping: { 0: 'occurredAt', 1: 'amount', 2: 'counterparty' },
      preview: [],
      ...partial,
    });
  }

  it('必填字段（日期 / 金额）未映射时给出中文提示并禁用「开始导入」', () => {
    setupStore({ plan: makePlan({ suggestedMapping: {} }), mapping: {} });
    renderWithRouter(<MappingPage />);

    const validation = screen.getByTestId('mapping-validation');
    expect(validation).toHaveTextContent('请先映射『日期』和『金额』两列');
    expect(screen.getByTestId('run-import-button')).toBeDisabled();
  });

  it('只映射了日期、缺金额时，提示文案只点名缺失的字段', () => {
    setupStore({ mapping: { 0: 'occurredAt' } });
    renderWithRouter(<MappingPage />);

    expect(screen.getByTestId('mapping-validation')).toHaveTextContent('请先映射『金额』两列');
    expect(screen.getByTestId('run-import-button')).toBeDisabled();
  });

  it('同一字段被两列占用时给出冲突提示并禁用「开始导入」', () => {
    setupStore({ mapping: { 0: 'occurredAt', 1: 'amount', 2: 'amount' } });
    renderWithRouter(<MappingPage />);

    expect(screen.getByTestId('mapping-validation')).toHaveTextContent('同一字段不能映射到多列（金额）');
    expect(screen.getByTestId('run-import-button')).toBeDisabled();
  });

  it('必填齐全且无冲突时提示消失、导入按钮可用', () => {
    setupStore({});
    renderWithRouter(<MappingPage />);

    expect(screen.queryByTestId('mapping-validation')).not.toBeInTheDocument();
    expect(screen.getByTestId('run-import-button')).toBeEnabled();
  });

  it('映射变更后实时刷新「前 10 行预览」', async () => {
    // 替身模拟真实 hook 的行为：写回映射并重算预览。
    updateMapping.mockImplementation(async (mapping: ColumnMapping) => {
      useImportStore.getState().setMapping(mapping);
      useImportStore.getState().setPreview([makePreviewRow({ counterparty: '实时预览值' })]);
    });
    setupStore({});
    renderWithRouter(<MappingPage />);

    expect(screen.queryByText('实时预览值')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId('source-column-2'));
    });

    await waitFor(() => {
      expect(updateMapping).toHaveBeenCalledTimes(1);
    });
    // 预览表格应立刻反映新的映射结果。
    expect(screen.getByText('实时预览值')).toBeInTheDocument();
  });

  it('预览区展示映射后的日期、金额与交易对方', () => {
    setupStore({ preview: [makePreviewRow({ counterparty: '星巴克', amountMinor: 3550, localDate: '2024-01-15' })] });
    renderWithRouter(<MappingPage />);

    expect(screen.getByText('2024-01-15')).toBeInTheDocument();
    expect(screen.getByText('¥35.50')).toBeInTheDocument();
    expect(screen.getByText('星巴克')).toBeInTheDocument();
    expect(screen.getByText('前 10 行预览')).toBeInTheDocument();
  });

  it('没有计划时提示先回导入页选择文件', () => {
    setupStore({ plan: null, stage: 'idle' });
    renderWithRouter(<MappingPage />, { route: '/import/mapping' });

    expect(screen.getByText(/请先在导入页选择一个 CSV 文件/)).toBeInTheDocument();
    expect(screen.queryByTestId('mapping-page')).not.toBeInTheDocument();
  });

  it('导入成功后给出「成功导入 N 条，跳过 M 条」中文摘要并提供跳转入口', async () => {
    const summary = makeSummary({ rowTotal: 3, rowImported: 2, rowSkipped: 1 });
    // 替身复刻真实 hook 的行为：把摘要写回 store 后再返回。
    run.mockImplementation(async () => {
      useImportStore.getState().setSummary(summary);
      return summary;
    });
    setupStore({});
    renderWithRouter(<MappingPage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('run-import-button'));
    });

    await waitFor(() => {
      expect(screen.getByText('成功导入 2 条，跳过 1 条（重复）')).toBeInTheDocument();
    });
    expect(run).toHaveBeenCalledTimes(1);
    // 摘要落进 store，并出现「查看账单列表」入口（页面正文与 Snackbar 各有一个）。
    expect(useImportStore.getState().summary?.rowImported).toBe(2);
    expect(screen.getAllByRole('button', { name: '查看账单列表' }).length).toBeGreaterThan(0);
  });
});
