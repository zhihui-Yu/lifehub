/**
 * 多格式文件抽取测试（A-25）。
 *
 * 覆盖：CSV / XLSX / PDF 三种来源都能被 `buildImportSource` 正确转换成核心层 `ImportSource`，
 * 其中 XLSX 经 SheetJS 抽成规整二维表、PDF 经 pdfjs 抽成行文本（此处用替身验证路由与拼行逻辑）。
 */
import { describe, expect, it, vi } from 'vitest';
import type { ImportSource } from '@lifehub/core';
import { buildImportSource, parseJsonBillTable, readXlsxTable } from './extract';

vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs', () => ({
  WorkerMessageHandler: {},
}));

const DEFAULT_MOCK_PDF_PAGES = [
  [
    { str: '2026-08-01', transform: [1, 0, 0, 1, 10, 800] },
    { str: '11:03:18', transform: [1, 0, 0, 1, 60, 800] },
    { str: '20260801', transform: [1, 0, 0, 1, 120, 800] },
    { str: '快捷支付', transform: [1, 0, 0, 1, 180, 800] },
    { str: '支', transform: [1, 0, 0, 1, 240, 800] },
    { str: '-35.50', transform: [1, 0, 0, 1, 280, 800] },
    { str: '******', transform: [1, 0, 0, 1, 340, 800] },
  ],
];

let mockPdfPages = DEFAULT_MOCK_PDF_PAGES;

/**
 * pdfjs 替身：仅验证 PDF 路由与文本拼行逻辑，不加载真实 worker。
 * 必须放在模块顶层（Vitest 要求 `vi.mock` 在文件作用域）。
 */
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: () =>
    ({
      promise: Promise.resolve({
        get numPages() {
          return mockPdfPages.length;
        },
        getPage: async (pageNumber: number) => ({
          getTextContent: async () => ({
            items: mockPdfPages[pageNumber - 1] ?? [],
          }),
        }),
      }),
    }),
}));

/** 制造一个轻量 File 替身（只用到 name，避免 jsdom 中构造真实 File 的麻烦）。 */
function fakeFile(name: string): File {
  return { name, type: '' } as unknown as File;
}

describe('buildImportSource 路由', () => {
  it('CSV：仅给字节，不携带 format / table / text', async () => {
    const bytes = new TextEncoder().encode('日期,金额\n2024-01-15,35.50');
    const source = await buildImportSource(fakeFile('wechat.csv'), bytes);
    expect(source.format).toBeUndefined();
    expect(source.table).toBeUndefined();
    expect(source.text).toBeUndefined();
    expect(source.bytes).toBe(bytes);
    expect(source.fileName).toBe('wechat.csv');
  });

  it('XLSX：抽出规整二维表（表头 + 数据行）', async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([
      ['交易时间', '交易对方', '收/支', '金额(元)'],
      ['2024-01-15 10:00:00', '星巴克', '支出', '35.50'],
      ['2024-01-16 11:00:00', '麦当劳', '支出', '20.00'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const bytes = new Uint8Array(buf as ArrayBuffer);

    const source: ImportSource = await buildImportSource(fakeFile('微信支付.xlsx'), bytes);
    expect(source.format).toBe('xlsx');
    expect(source.table?.headers).toEqual(['交易时间', '交易对方', '收/支', '金额(元)']);
    expect(source.table?.rows).toHaveLength(2);
    expect(source.table?.rows[0]).toEqual(['2024-01-15 10:00:00', '星巴克', '支出', '35.50']);
  });

  it('readXlsxTable：首行作表头，空行被剔除', async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([
      ['A', 'B'],
      ['1', '2'],
      ['', ''],
      ['3', '4'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const table = await readXlsxTable(new Uint8Array(buf as ArrayBuffer));
    expect(table.headers).toEqual(['A', 'B']);
    expect(table.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });
});

describe('buildImportSource · PDF 路由（pdfjs 替身）', () => {
  it('PDF：抽出文本并按视觉行拼回主行，且挂载 globalThis.pdfjsWorker', async () => {
    mockPdfPages = DEFAULT_MOCK_PDF_PAGES;
    const bytes = new Uint8Array([1, 2, 3]);
    const source = await buildImportSource(fakeFile('兴业银行.pdf'), bytes);
    expect(source.format).toBe('pdf');
    expect(source.text).toBe('2026-08-01 11:03:18 20260801 快捷支付 支 -35.50 ******');
    expect((globalThis as Record<string, unknown>).pdfjsWorker).toBeDefined();
  });

  it('招商银行信用卡 PDF：支持跨页继承账单年月与分段、无交易日还款行、跨行商户摘要无缝拼接及页尾汇总剔除', async () => {
    mockPdfPages = [
      [
        { str: '招商银行信用卡对账单（个人消费卡账户 2026年08月）', transform: [1, 0, 0, 1, 95, 785] },
        { str: 'CMB Credit Card Statement (2026.08)', transform: [1, 0, 0, 1, 185, 765] },
        { str: '账单日', transform: [1, 0, 0, 1, 45, 616] },
        { str: '2026年08月24日', transform: [1, 0, 0, 1, 144, 606] },
        { str: '到期还款日', transform: [1, 0, 0, 1, 310, 616] },
        { str: '2026年09月11日', transform: [1, 0, 0, 1, 410, 606] },
        { str: '本期账务明细 Transaction Details', transform: [1, 0, 0, 1, 43, 424] },
        { str: '人民币账户 RMB A/C', transform: [1, 0, 0, 1, 43, 405] },
        { str: '交易日', transform: [1, 0, 0, 1, 43, 389] },
        { str: '记账日', transform: [1, 0, 0, 1, 92, 389] },
        { str: '交易摘要', transform: [1, 0, 0, 1, 140, 389] },
        { str: '人民币金额', transform: [1, 0, 0, 1, 369, 389] },
        { str: '卡号末四位', transform: [1, 0, 0, 1, 455, 389] },
        { str: '交易地金额', transform: [1, 0, 0, 1, 542, 389] },
        { str: '还款', transform: [1, 0, 0, 1, 43, 363] },
        { str: '07/24', transform: [1, 0, 0, 1, 94, 346] },
        { str: '手机银行还款', transform: [1, 0, 0, 1, 140, 346] },
        { str: '-200.00', transform: [1, 0, 0, 1, 388, 346] },
        { str: '1234', transform: [1, 0, 0, 1, 479, 346] },
        { str: '-200.00', transform: [1, 0, 0, 1, 561, 346] },
        { str: '消费', transform: [1, 0, 0, 1, 43, 330] },
        { str: '08/16', transform: [1, 0, 0, 1, 45, 315] },
        { str: '08/17', transform: [1, 0, 0, 1, 94, 315] },
        { str: '财付通-示例网络科技有', transform: [1, 0, 0, 1, 140, 315] },
        { str: '限公司', transform: [1, 0, 0, 1, 140, 307] },
        { str: '158.00', transform: [1, 0, 0, 1, 387, 315] },
        { str: '1234', transform: [1, 0, 0, 1, 479, 315] },
        { str: '158.00(CN)', transform: [1, 0, 0, 1, 543, 315] },
      ],
      [
        { str: '08/20', transform: [1, 0, 0, 1, 45, 740] },
        { str: '08/21', transform: [1, 0, 0, 1, 94, 740] },
        { str: '京东支付-示例超市', transform: [1, 0, 0, 1, 140, 740] },
        { str: '42.00', transform: [1, 0, 0, 1, 395, 740] },
        { str: '1234', transform: [1, 0, 0, 1, 479, 740] },
        { str: '42.00(CN)', transform: [1, 0, 0, 1, 551, 740] },
        { str: '本期应还金额 = 上期账单金额 - 上期还款金额 + 本期账单金额', transform: [1, 0, 0, 1, 43, 680] },
        { str: '¥ 200.00 = ¥ 200.00 - ¥ 200.00 + ¥ 200.00', transform: [1, 0, 0, 1, 43, 660] },
      ],
    ];
    try {
      const bytes = new Uint8Array([1, 2, 3]);
      const source = await buildImportSource(fakeFile('信用卡账单.pdf'), bytes);
      expect(source.format).toBe('pdf');
      expect(source.text).toContain('招商银行信用卡对账单 2026年08月');
      expect(source.text).toContain('07/24 手机银行还款 -200.00 1234');
      expect(source.text).toContain('08/16 08/17 财付通-示例网络科技有限公司 158.00 1234');
      expect(source.text).toContain('08/20 08/21 京东支付-示例超市 42.00 1234');
      expect(source.text).not.toContain('本期应还金额');
    } finally {
      mockPdfPages = DEFAULT_MOCK_PDF_PAGES;
    }
  });

  it('工商银行 11 列无对方信息横向 PDF：90° 旋转还原、斜向防伪水印过滤且自动跳过外币子账户购结汇行', async () => {
    mockPdfPages = [
      [
        // 30° 倾斜防伪水印（应被剔除）
        {
          str: '中国工商银行 0000 2026-10-01 09:00:00 DEMO',
          transform: [-10, 17.32, -17.32, -10, 298.12, 36.67],
        },
        // 表头行（transform = [0, 7, -7, 0, -y, x]）
        { str: '交易日期', transform: [0, 7, -7, 0, 63.01, 100.73] },
        { str: '账号', transform: [0, 7, -7, 0, 63.01, 187.09] },
        { str: '币种', transform: [0, 7, -7, 0, 63.01, 337.69] },
        { str: '钞汇', transform: [0, 7, -7, 0, 63.01, 373.3] },
        { str: '摘要', transform: [0, 7, -7, 0, 63.01, 414] },
        { str: '地区', transform: [0, 7, -7, 0, 63.01, 459.79] },
        { str: '收入/支出金额', transform: [0, 7, -7, 0, 63.01, 519.34] },
        { str: '余额', transform: [0, 7, -7, 0, 63.01, 644.98] },
        { str: '渠道', transform: [0, 7, -7, 0, 63.01, 725.36] },
        // 第 1 笔：人民币正常消费支出
        { str: '2026-10-05', transform: [0, 7, -7, 0, 77.51, 97.23] },
        { str: '12:30:00', transform: [0, 7, -7, 0, 84.51, 100.73] },
        { str: '6200000000000001234', transform: [0, 7, -7, 0, 81.01, 160.84] },
        { str: '人民币', transform: [0, 7, -7, 0, 81.01, 334.19] },
        { str: '钞', transform: [0, 7, -7, 0, 81.01, 376.8] },
        { str: '无卡支付', transform: [0, 7, -7, 0, 81.01, 407] },
        { str: '0200', transform: [0, 7, -7, 0, 81.01, 459.79] },
        { str: '-88.50', transform: [0, 7, -7, 0, 81.01, 529.84] },
        { str: '1,200.00', transform: [0, 7, -7, 0, 81.01, 637.98] },
        { str: '网上银行', transform: [0, 7, -7, 0, 81.01, 718.36] },
        // 第 2 笔：日元子账户购汇入账（外币面额应被跳过，避免按人民币重复或放大计入）
        { str: '2026-10-06', transform: [0, 7, -7, 0, 95.51, 97.23] },
        { str: '15:00:00', transform: [0, 7, -7, 0, 102.51, 100.73] },
        { str: '6200000000000001234', transform: [0, 7, -7, 0, 99.01, 160.84] },
        { str: '日元', transform: [0, 7, -7, 0, 99.01, 337.69] },
        { str: '汇', transform: [0, 7, -7, 0, 99.01, 376.8] },
        { str: '个人购汇', transform: [0, 7, -7, 0, 99.01, 407] },
        { str: '0200', transform: [0, 7, -7, 0, 99.01, 459.79] },
        { str: '+20,000.00', transform: [0, 7, -7, 0, 99.01, 524.59] },
        { str: '20,000.00', transform: [0, 7, -7, 0, 99.01, 630.98] },
        { str: '手机银行', transform: [0, 7, -7, 0, 99.01, 718.36] },
      ],
    ];
    try {
      const bytes = new Uint8Array([1, 2, 3]);
      const source = await buildImportSource(fakeFile('工商银行历史明细.pdf'), bytes);
      expect(source.format).toBe('pdf');
      expect(source.text).toContain('12:30:00 20261005 无卡支付 支 88.50 1,200.00');
      expect(source.text).toContain('网上银行');
      expect(source.text).not.toContain('20,000.00');
      expect(source.text).not.toContain('DEMO');
    } finally {
      mockPdfPages = DEFAULT_MOCK_PDF_PAGES;
    }
  });
});

describe('buildImportSource · JSON 路由与 parseJsonBillTable', () => {
  it('JSON：支持导出格式 { bills: [...] } 转换为标准二维表', async () => {
    const payload = {
      exportedAt: '2026-08-01T00:00:00.000Z',
      totalRecords: 2,
      bills: [
        {
          id: 'b-1',
          localDate: '2026-08-01',
          occurredAt: '2026-08-01T12:30:00.000Z',
          counterparty: '瑞幸咖啡',
          categoryName: '餐饮美食',
          direction: 'expense',
          amountMinor: 1990,
          currency: 'CNY',
          note: '生椰拿铁',
          sourceFile: '手动记账',
        },
        {
          id: 'b-2',
          localDate: '2026-08-02',
          occurredAt: '2026-08-02T09:00:00.000Z',
          counterparty: '某科技公司',
          categoryName: '工资薪水',
          direction: 'income',
          amountMinor: 1500000,
          currency: 'CNY',
          note: '8月工资',
          sourceFile: '手动记账',
        },
      ],
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const source = await buildImportSource(fakeFile('lifehub-bills-2026.json'), bytes);
    expect(source.format).toBe('csv');
    expect(source.table?.headers).toEqual([
      '交易时间',
      '收/支',
      '分类',
      '交易对方',
      '备注',
      '金额',
      '来源',
    ]);
    expect(source.table?.rows).toHaveLength(2);
    expect(source.table?.rows[0]).toEqual([
      '2026-08-01T12:30:00.000Z',
      '支出',
      '餐饮美食',
      '瑞幸咖啡',
      '生椰拿铁',
      '19.90',
      '手动记账',
    ]);
    expect(source.table?.rows[1]?.[1]).toBe('收入');
    expect(source.table?.rows[1]?.[5]).toBe('15000.00');
  });

  it('parseJsonBillTable：空文件或非法 JSON 抛出 LIFEHUB_E_IMPORT_PARSE_FAILED', () => {
    expect(() => parseJsonBillTable(new TextEncoder().encode('{invalid'))).toThrow(
      '无法从 JSON 文件中识别有效的账单记录',
    );
    expect(() => parseJsonBillTable(new TextEncoder().encode('{"bills": []}'))).toThrow(
      '无法从 JSON 文件中识别有效的账单记录',
    );
  });
});

