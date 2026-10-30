/**
 * 导入页面测试（UI-01）。
 *
 * 覆盖需求：A-08（拖拽 / 选择文件入口、文件类型校验、解析后跳转映射页、最近导入列表）。
 *
 * 说明：页面依赖 `useVault` 提供的平台运行时与 `useImportFlow` 的探查能力，
 * 这里把二者打桩成**引用稳定**的替身（若每次渲染都返回新对象，会触发无限重渲染），
 * 但**保留真实的 `ImportPage` 渲染逻辑**，从而真正验证：
 * 文件类型拦截、探查调用、路由跳转、最近导入列表渲染。
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportBatch, ImportPlan } from '@lifehub/core';
import { ImportPage } from '@/pages/ImportPage';
import { useImportStore } from '@/store';
import { makeBatch, makePlan } from '@/__tests__/test-utils/fixtures';
import { renderWithRouter } from '@/__tests__/test-utils/render';
// 说明：jsdom 未实现 Blob.arrayBuffer()，这里补齐后才能真实读取用户选择的 CSV 字节。
import '@/__tests__/test-utils/polyfills';

/** 打桩用的钩子替身（必须在 `vi.mock` 工厂里引用，故用 `vi.hoisted` 提前创建）。 */
const { plan, listBatches, FAKE_RUNTIME } = vi.hoisted(() => {
  const planFn = vi.fn<(fileName: string, bytes: Uint8Array) => Promise<ImportPlan | null>>();
  const listFn = vi.fn<() => Promise<ImportBatch[]>>();
  return {
    plan: planFn,
    listBatches: listFn,
    // 说明：runtime 必须引用稳定，否则导入页的 effect 会因依赖变化而反复触发。
    FAKE_RUNTIME: { importBatchRepository: { list: listFn } },
  };
});

vi.mock('@/hooks/useVault', () => ({
  useVault: () => ({
    runtime: FAKE_RUNTIME,
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

vi.mock('@/hooks/useImportFlow', () => ({
  useImportFlow: () => ({
    plan,
    refreshPreview: vi.fn(),
    updateMapping: vi.fn(),
    run: vi.fn(),
  }),
}));

/**
 * 构造一个测试用文件。
 *
 * @param name 文件名
 * @param type MIME 类型
 * @param content 文件内容
 * @returns File 实例
 */
function makeFile(name: string, type: string, content = '日期,金额\n2024-01-15,35.50\n'): File {
  return new File([content], name, { type });
}

/**
 * 取页面里的隐藏文件选择框。
 *
 * @returns HTMLInputElement
 */
function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!input) {
    throw new Error('未找到文件选择框');
  }
  return input as HTMLInputElement;
}

describe('ImportPage（A-08）', () => {
  beforeEach(() => {
    plan.mockReset();
    listBatches.mockReset();
    listBatches.mockResolvedValue([]);
    useImportStore.getState().reset();
  });

  it('同时提供「拖拽」与「选择文件」两个入口，并给出中文说明', async () => {
    renderWithRouter(<ImportPage />);

    // 拖拽区与说明文案。
    expect(screen.getByTestId('drop-zone')).toBeInTheDocument();
    expect(screen.getByText('把账单 CSV 文件拖到这里')).toBeInTheDocument();
    expect(screen.getByText(/文件只在本机解析，不会上传/)).toBeInTheDocument();

    // 「选择文件」按钮与隐藏的 file input 是同一个入口。
    expect(screen.getByRole('button', { name: '选择 CSV 文件' })).toBeInTheDocument();
    expect(fileInput()).toHaveAttribute('accept', '.csv,text/csv');

    // 等待「最近导入」列表加载完成，避免异步 setState 泄漏到下一个用例。
    await waitFor(() => {
      expect(listBatches).toHaveBeenCalled();
    });
  });

  it('拖入非 CSV 文件时给出中文提示「不支持的文件类型，请上传 .csv 文件」且不发起探查', async () => {
    renderWithRouter(<ImportPage />);
    const dropZone = screen.getByTestId('drop-zone');

    await act(async () => {
      fireEvent.drop(dropZone, { dataTransfer: { files: [makeFile('账单.xlsx', 'application/vnd.ms-excel')] } });
    });

    expect(await screen.findByText('不支持的文件类型，请上传 .csv 文件')).toBeInTheDocument();
    expect(plan).not.toHaveBeenCalled();
  });

  it('通过文件选择框选中 .csv 文件后发起探查，并在成功后跳转到 /import/mapping', async () => {
    plan.mockResolvedValue(makePlan());
    renderWithRouter(<ImportPage />, { route: '/import' });

    await act(async () => {
      fireEvent.change(fileInput(), { target: { files: [makeFile('微信支付.csv', 'text/csv')] } });
    });

    await waitFor(() => {
      expect(plan).toHaveBeenCalledTimes(1);
    });
    const [fileName, bytes] = plan.mock.calls[0] ?? [];
    expect(fileName).toBe('微信支付.csv');
    expect(bytes).toBeInstanceOf(Uint8Array);

    // 关键断言：解析成功后真的跳到了映射页路由。
    await waitFor(() => {
      expect(screen.getByTestId('location-pathname')).toHaveTextContent('/import/mapping');
    });
  });

  it('探查失败（返回 null）时停留在导入页，不跳转', async () => {
    plan.mockResolvedValue(null);
    renderWithRouter(<ImportPage />, { route: '/import' });

    await act(async () => {
      fireEvent.change(fileInput(), { target: { files: [makeFile('坏文件.csv', 'text/csv')] } });
    });

    await waitFor(() => {
      expect(plan).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('location-pathname')).toHaveTextContent('/import');
  });

  it('最近导入列表展示文件名、行数、相对时间与状态', async () => {
    const createdAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    listBatches.mockResolvedValue([
      makeBatch({ id: 'batch-a', fileName: '微信支付_2024-01.csv', rowImported: 118, createdAt }),
    ]);
    renderWithRouter(<ImportPage />);

    expect(await screen.findByText('最近导入')).toBeInTheDocument();
    expect(screen.getByText('微信支付_2024-01.csv')).toBeInTheDocument();
    expect(screen.getByText('118')).toBeInTheDocument();
    expect(screen.getByText('5 分钟前')).toBeInTheDocument();
    expect(screen.getByText('已导入')).toBeInTheDocument();
  });

  it('当前文件哈希与历史批次一致时标记「重复文件」', async () => {
    const hash = 'e'.repeat(64);
    listBatches.mockResolvedValue([makeBatch({ id: 'batch-a', fileHash: hash })]);
    useImportStore.setState({ plan: makePlan({ fileHash: hash }) });
    renderWithRouter(<ImportPage />);

    expect(await screen.findByText('重复文件')).toBeInTheDocument();
    expect(screen.queryByText('已导入')).not.toBeInTheDocument();
  });

  it('没有历史导入记录时不渲染「最近导入」区块', async () => {
    listBatches.mockResolvedValue([]);
    renderWithRouter(<ImportPage />);

    await waitFor(() => {
      expect(listBatches).toHaveBeenCalled();
    });
    expect(screen.queryByText('最近导入')).not.toBeInTheDocument();
  });

  it('导入流程 store 中残留的中文错误提示会展示在页面上', async () => {
    useImportStore.setState({ error: '文件解析失败，请检查文件格式' });
    renderWithRouter(<ImportPage />);

    expect(screen.getByText('文件解析失败，请检查文件格式')).toBeInTheDocument();

    await waitFor(() => {
      expect(listBatches).toHaveBeenCalled();
    });
  });
});
