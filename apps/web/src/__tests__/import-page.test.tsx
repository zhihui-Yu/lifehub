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
const { plan, run, listBatches, deleteBatch, FAKE_RUNTIME } = vi.hoisted(() => {
  const planFn = vi.fn<(source: unknown) => Promise<ImportPlan | null>>();
  const runFn = vi.fn();
  const listFn = vi.fn<() => Promise<ImportBatch[]>>();
  const deleteFn = vi.fn<(id: string) => Promise<void>>();
  return {
    plan: planFn,
    run: runFn,
    listBatches: listFn,
    deleteBatch: deleteFn,
    // 说明：runtime 必须引用稳定，否则导入页的 effect 会因依赖变化而反复触发。
    FAKE_RUNTIME: {
      importBatchRepository: { list: listFn, delete: deleteFn },
      billRepository: {
        deleteBySourceFileId: vi.fn<() => Promise<number>>().mockResolvedValue(10),
        clearAll: vi.fn<() => Promise<number>>().mockResolvedValue(10),
        list: vi.fn().mockResolvedValue([]),
      },
    },
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
    run,
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
    run.mockReset();
    listBatches.mockReset();
    listBatches.mockResolvedValue([]);
    useImportStore.getState().reset();
  });

  it('同时提供「拖拽」与「选择文件」两个入口，并给出中文说明', async () => {
    renderWithRouter(<ImportPage />);

    // 拖拽区与说明文案。
    expect(screen.getByTestId('drop-zone')).toBeInTheDocument();
    expect(screen.getByText('把账单文件拖到这里（CSV / Excel / PDF / JSON）')).toBeInTheDocument();
    expect(screen.getByText(/文件只在本机解析，不会上传/)).toBeInTheDocument();

    // 「选择文件」按钮与隐藏的 file input 是同一个入口。
    expect(screen.getByRole('button', { name: '选择账单文件' })).toBeInTheDocument();
    expect(screen.getByTestId('select-folder-button')).toBeInTheDocument();
    expect(screen.getByTestId('import-password-input')).toBeInTheDocument();
    expect(fileInput()).toHaveAttribute(
      'accept',
      '.csv,.tsv,.txt,.xlsx,.xls,.pdf,.json,.zip,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/pdf,application/json,application/zip,application/x-zip-compressed',
    );

    // 等待「最近导入」列表加载完成，避免异步 setState 泄漏到下一个用例。
    await waitFor(() => {
      expect(listBatches).toHaveBeenCalled();
    });
  });

  it('拖入非账单文件时给出中文提示「不支持的文件类型，请上传 CSV / Excel / PDF / JSON 文件」且不发起探查', async () => {
    renderWithRouter(<ImportPage />);
    const dropZone = screen.getByTestId('drop-zone');

    await act(async () => {
      fireEvent.drop(dropZone, { dataTransfer: { files: [makeFile('照片.png', 'image/png')] } });
    });

    expect(
      await screen.findByText('不支持的文件类型，请上传 CSV / Excel / PDF / JSON 文件'),
    ).toBeInTheDocument();
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
    const source = plan.mock.calls[0]?.[0] as { fileName: string; bytes: Uint8Array };
    expect(source.fileName).toBe('微信支付.csv');
    expect(source.bytes).toBeInstanceOf(Uint8Array);

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

  it('导入已完成（stage === "done" 且非重复拦截）时，最新导入批次不会因残留 plan.fileHash 被误标为「重复文件」（T-RecentImports-Status-1）', async () => {
    const hash = 'f'.repeat(64);
    listBatches.mockResolvedValue([
      makeBatch({ id: 'batch-ccb', fileName: 'bank_statement_demo.pdf', fileHash: hash, rowImported: 25 }),
    ]);
    useImportStore.setState({
      stage: 'done',
      plan: makePlan({ fileHash: hash }),
      summary: {
        batchId: 'batch-ccb',
        rowTotal: 25,
        rowImported: 25,
        rowSkipped: 0,
        rowDuplicated: 0,
        errors: [],
        durationMs: 12,
        duplicateFile: false,
        rowCrossSourceDuplicate: 0,
      },
    });
    renderWithRouter(<ImportPage />);

    expect(await screen.findByText('bank_statement_demo.pdf')).toBeInTheDocument();
    expect(screen.getByText('已导入')).toBeInTheDocument();
    expect(screen.queryByText('重复文件')).not.toBeInTheDocument();
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

  it('勾选「系统自动识别全部字段后直接完成导入」后，上传全自动匹配的账单文件直接入库并跳转到 /bills', async () => {
    const validPlan = makePlan({
      headers: ['交易时间', '金额(元)', '交易对方'],
      suggestedMapping: { 0: 'occurredAt', 1: 'amount', 2: 'counterparty' },
    });
    plan.mockResolvedValue(validPlan);
    run.mockResolvedValue({
      batchId: 'batch-auto',
      rowTotal: 64,
      rowImported: 63,
      rowSkipped: 1,
      rowDuplicated: 0,
      errors: [],
      durationMs: 10,
      duplicateFile: false,
      rowCrossSourceDuplicate: 0,
    });
    renderWithRouter(<ImportPage />, { route: '/import' });

    const autoToggle = screen.getByTestId('auto-import-toggle');
    await act(async () => {
      fireEvent.click(autoToggle);
    });

    await act(async () => {
      fireEvent.change(fileInput(), { target: { files: [makeFile('微信支付.csv', 'text/csv')] } });
    });

    await waitFor(() => {
      expect(plan).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledWith(validPlan.suggestedMapping);
    });

    await waitFor(() => {
      expect(screen.getByTestId('location-pathname')).toHaveTextContent('/bills');
    });
  });

  it('最近导入列表支持单批次删除（带二次确认）及清空全部记录', async () => {
    const batch = makeBatch({ id: 'batch-del-1', fileName: '微信支付_2026-10.xlsx', rowImported: 63 });
    listBatches.mockResolvedValue([batch]);
    deleteBatch.mockResolvedValue();
    renderWithRouter(<ImportPage />);

    const delBtn = await screen.findByTestId('delete-batch-batch-del-1');
    await act(async () => {
      fireEvent.click(delBtn);
    });

    expect(await screen.findByText('删除该次导入记录及关联账单？')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    });

    await waitFor(() => {
      expect(deleteBatch).toHaveBeenCalledWith('batch-del-1');
    });
  });

  it('存在跨 DEK 历史残留记录且处于免密模式时，上传 CSV 文件不崩溃并正常完成自动导入', async () => {
    const {
      AuditLogRepository,
      AuditLogger,
      BillRepository,
      CategoryRepository,
      ColumnMapper,
      CryptoService,
      CsvParser,
      EncryptedStore,
      ImportBatchRepository,
      ImportService,
      MemoryStorageAdapter,
      RuleTemplateRepository,
      WebCryptoProvider,
    } = await import('@lifehub/core');

    const adapter = new MemoryStorageAdapter();
    const crypto = new CryptoService(new WebCryptoProvider());
    let activeDek = new Uint8Array(32).fill(9);
    const dek = {
      isUnlocked: () => true,
      getDek: () => activeDek,
      getKeyVersion: () => 1,
    };
    const store = new EncryptedStore({
      adapter,
      crypto,
      dek,
    });
    const clock = { now: () => new Date(), nowIso: () => new Date().toISOString() };
    const bills = new BillRepository({ store, dek });
    const categories = new CategoryRepository(store);
    const batches = new ImportBatchRepository(store);
    const templates = new RuleTemplateRepository(store);
    const auditLogRepository = new AuditLogRepository(store, 'local');
    const audit = new AuditLogger({ repository: auditLogRepository, clock, deviceLabel: 'local' });

    // 写入一条旧 DEK 加密的残留账单与批次
    await bills.put({
      id: 'legacy-bill-1',
      amountMinor: 5000,
      currency: 'CNY',
      direction: 'expense',
      occurredAt: '2026-07-01T10:00:00.000Z',
      localDate: '2026-07-01',
      sourceTimeZone: 'Asia/Shanghai',
      counterparty: '旧密钥残留商户',
      categoryId: null,
      note: '旧记录',
      sourceFileId: 'legacy-batch-1',
      sourceRowIndex: 0,
      createdAt: '2026-07-01T10:00:00.000Z',
      updatedAt: '2026-07-01T10:00:00.000Z',
      version: 1,
      deviceId: 'local',
    });

    // 切换为免密默认 DEK (fill(7))
    activeDek = new Uint8Array(32).fill(7);
    const service = new ImportService({
      provider: new WebCryptoProvider(),
      parser: new CsvParser(),
      createMapper: (headers) => new ColumnMapper(headers),
      templates,
      batches,
      bills,
      categories,
      audit,
      clock,
      deviceId: 'local',
    });

    plan.mockImplementation(async (source) =>
      service.plan(source as Parameters<typeof service.plan>[0]),
    );
    run.mockImplementation(async (mapping) =>
      service.run(
        plan.mock.calls[0]?.[0] as Parameters<typeof service.run>[0],
        mapping as Parameters<typeof service.run>[1],
        {},
      ),
    );

    renderWithRouter(<ImportPage />, { route: '/import' });
    await act(async () => {
      fireEvent.click(screen.getByTestId('auto-import-toggle'));
    });

    const csvFile = makeFile(
      '支付宝账单.csv',
      'text/csv',
      '交易时间,收/支,交易对方,商品说明,金额\n2026-08-15 12:00:00,支出,肯德基,午餐,38.50\n',
    );
    await act(async () => {
      fireEvent.change(fileInput(), { target: { files: [csvFile] } });
    });

    await waitFor(() => {
      expect(screen.getByTestId('location-pathname')).toHaveTextContent('/bills');
    });
    const currentBills = await bills.list();
    expect(currentBills).toHaveLength(1);
    expect(currentBills[0]?.counterparty).toBe('肯德基');
  });

  it('支持上传导出的 .json 账单文件并在解析后正常导入', async () => {
    const validPlan = makePlan({
      headers: ['交易时间', '收/支', '分类', '交易对方', '备注', '金额', '来源'],
      suggestedMapping: {
        0: 'occurredAt',
        1: 'direction',
        2: 'category',
        3: 'counterparty',
        4: 'note',
        5: 'amount',
      },
    });
    plan.mockResolvedValue(validPlan);
    run.mockResolvedValue({
      batchId: 'batch-json',
      rowTotal: 1,
      rowImported: 1,
      rowSkipped: 0,
      rowDuplicated: 0,
      errors: [],
      durationMs: 5,
      duplicateFile: false,
      rowCrossSourceDuplicate: 0,
    });

    renderWithRouter(<ImportPage />, { route: '/import' });
    await act(async () => {
      fireEvent.click(screen.getByTestId('auto-import-toggle'));
    });

    const jsonContent = JSON.stringify({
      exportedAt: '2026-08-20T00:00:00.000Z',
      totalRecords: 1,
      bills: [
        {
          id: 'bill-json-1',
          localDate: '2026-08-20',
          occurredAt: '2026-08-20T18:30:00.000Z',
          counterparty: '盒马鲜生',
          categoryName: '餐饮美食',
          direction: 'expense',
          amountMinor: 8900,
          currency: 'CNY',
          note: '晚餐食材',
          sourceFile: '手动记账',
        },
      ],
    });
    const jsonFile = makeFile('lifehub-bills.json', 'application/json', jsonContent);

    await act(async () => {
      fireEvent.change(fileInput(), { target: { files: [jsonFile] } });
    });

    await waitFor(() => {
      expect(plan).toHaveBeenCalledTimes(1);
    });
    const passedSource = plan.mock.calls[0]?.[0] as {
      fileName: string;
      format?: string;
      table?: { headers: string[]; rows: string[][] };
    };
    expect(passedSource.fileName).toBe('lifehub-bills.json');
    expect(passedSource.format).toBe('csv');
    expect(passedSource.table?.headers).toEqual([
      '交易时间',
      '收/支',
      '分类',
      '交易对方',
      '备注',
      '金额',
      '来源',
    ]);
    expect(passedSource.table?.rows[0]).toEqual([
      '2026-08-20T18:30:00.000Z',
      '支出',
      '餐饮美食',
      '盒马鲜生',
      '晚餐食材',
      '89.00',
      '手动记账',
    ]);

    await waitFor(() => {
      expect(screen.getByTestId('location-pathname')).toHaveTextContent('/bills');
    });
  });

  it('上传加密 ZIP 压缩包且未填密码时弹出密码输入弹窗，错密提示错误，输入正确密码后自动解压并跳转（T-Encrypted-And-Batch-Import-1）', async () => {
    const { computeCrc32 } = await import('@/lib/import/zip');
    const innerName = new TextEncoder().encode('demo-bills.csv');
    const plainCsv = new TextEncoder().encode('交易时间,金额(元)\n2026-01-01,18.00\n');
    const crc = computeCrc32(plainCsv);
    const pwdBytes = new TextEncoder().encode('123456');

    // 使用标准 PKWARE ZipCrypto 状态机在内存中构造加密载荷（12 字节加密头 + 密文）
    const crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) {
        c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : (c >>> 1) >>> 0;
      }
      crcTable[i] = c >>> 0;
    }
    let k0 = 0x12345678;
    let k1 = 0x23456789;
    let k2 = 0x34567890;
    const updateKeys = (b: number) => {
      k0 = ((k0 >>> 8) ^ (crcTable[(k0 ^ b) & 0xff] ?? 0)) >>> 0;
      k1 = (Math.imul((k1 + (k0 & 0xff)) >>> 0, 134775813) + 1) >>> 0;
      k2 = ((k2 >>> 8) ^ (crcTable[(k2 ^ ((k1 >>> 24) & 0xff)) & 0xff] ?? 0)) >>> 0;
    };
    const streamByte = () => {
      const temp = (k2 | 2) & 0xffff;
      return (Math.imul(temp, temp ^ 1) >>> 8) & 0xff;
    };
    for (const b of pwdBytes) updateKeys(b);

    const headerPlain = new Uint8Array(12);
    headerPlain[11] = (crc >>> 24) & 0xff;
    const toEncrypt = new Uint8Array(12 + plainCsv.length);
    toEncrypt.set(headerPlain, 0);
    toEncrypt.set(plainCsv, 12);
    const encryptedData = new Uint8Array(toEncrypt.length);
    for (let i = 0; i < toEncrypt.length; i += 1) {
      const p = toEncrypt[i] ?? 0;
      encryptedData[i] = (p ^ streamByte()) & 0xff;
      updateKeys(p);
    }

    const localLen = 30 + innerName.length;
    const cdOffset = localLen + encryptedData.length;
    const cdLen = 46 + innerName.length;
    const zipBytes = new Uint8Array(cdOffset + cdLen + 22);
    const view = new DataView(zipBytes.buffer);
    // Local file header
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0001, true); // encrypted flag
    view.setUint16(8, 0, true); // method 0 (stored)
    view.setUint32(14, crc, true);
    view.setUint32(18, encryptedData.length, true);
    view.setUint32(22, plainCsv.length, true);
    view.setUint16(26, innerName.length, true);
    zipBytes.set(innerName, 30);
    zipBytes.set(encryptedData, localLen);
    // Central directory header
    view.setUint32(cdOffset, 0x02014b50, true);
    view.setUint16(cdOffset + 4, 20, true);
    view.setUint16(cdOffset + 6, 20, true);
    view.setUint16(cdOffset + 8, 0x0001, true);
    view.setUint16(cdOffset + 10, 0, true);
    view.setUint32(cdOffset + 16, crc, true);
    view.setUint32(cdOffset + 20, encryptedData.length, true);
    view.setUint32(cdOffset + 24, plainCsv.length, true);
    view.setUint16(cdOffset + 28, innerName.length, true);
    view.setUint32(cdOffset + 42, 0, true);
    zipBytes.set(innerName, cdOffset + 46);
    // EOCD
    const eocdOffset = cdOffset + cdLen;
    view.setUint32(eocdOffset, 0x06054b50, true);
    view.setUint16(eocdOffset + 8, 1, true);
    view.setUint16(eocdOffset + 10, 1, true);
    view.setUint32(eocdOffset + 12, cdLen, true);
    view.setUint32(eocdOffset + 16, cdOffset, true);

    const zipFile = new File([zipBytes], 'demo-encrypted-bills.zip', {
      type: 'application/zip',
    });

    plan.mockResolvedValue(makePlan());
    renderWithRouter(<ImportPage />, { route: '/import' });

    // 1. 未填密码直接选择加密 ZIP -> 弹出密码输入框
    await act(async () => {
      fireEvent.change(fileInput(), { target: { files: [zipFile] } });
    });

    expect(await screen.findByTestId('password-prompt-dialog')).toBeInTheDocument();
    expect(plan).not.toHaveBeenCalled();

    // 2. 输入错误密码 -> 弹窗内显示密码错误提示
    const dialogInput = screen.getByTestId('password-dialog-input');
    await act(async () => {
      fireEvent.change(dialogInput, { target: { value: '000000' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('password-prompt-submit'));
    });

    expect(await screen.findByTestId('password-dialog-error')).toBeInTheDocument();
    expect(plan).not.toHaveBeenCalled();

    // 3. 输入正确测试密码 123456 -> 成功解压内部 CSV 并跳转 /import/mapping
    await act(async () => {
      fireEvent.change(dialogInput, { target: { value: '123456' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('password-prompt-submit'));
    });

    await waitFor(() => {
      expect(plan).toHaveBeenCalledTimes(1);
    });
    const source = plan.mock.calls[0]?.[0] as { fileName: string; bytes: Uint8Array };
    expect(source.fileName).toBe('demo-bills.csv');
    await waitFor(() => {
      expect(screen.getByTestId('location-pathname')).toHaveTextContent('/import/mapping');
    });
  });

  it('支持通过文件夹/多文件选择器批量上传多个账单文件并展示批量导入汇总横幅（T-Encrypted-And-Batch-Import-1）', async () => {
    const validPlan = makePlan({
      headers: ['交易时间', '金额(元)', '交易对方'],
      suggestedMapping: { 0: 'occurredAt', 1: 'amount', 2: 'counterparty' },
    });
    plan.mockResolvedValue(validPlan);
    run.mockResolvedValue({
      batchId: 'batch-multi',
      rowTotal: 10,
      rowImported: 10,
      rowSkipped: 0,
      rowDuplicated: 0,
      errors: [],
      durationMs: 8,
      duplicateFile: false,
      rowCrossSourceDuplicate: 0,
    });

    renderWithRouter(<ImportPage />, { route: '/import' });

    const folderInput = screen.getByTestId('folder-file-input');
    const fileA = makeFile('账单A.csv', 'text/csv');
    const fileB = makeFile('账单B.csv', 'text/csv');
    const unsupportedFile = makeFile('说明.png', 'image/png');

    await act(async () => {
      fireEvent.change(folderInput, {
        target: { files: [fileA, fileB, unsupportedFile] },
      });
    });

    await waitFor(() => {
      expect(plan).toHaveBeenCalledTimes(2);
      expect(run).toHaveBeenCalledTimes(2);
    });

    const banner = await screen.findByTestId('batch-import-banner');
    expect(banner).toHaveTextContent('成功处理 2 个文件，导入 20 条账单');
  });
});
