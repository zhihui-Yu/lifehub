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

/**
 * pdfjs 替身：仅验证 PDF 路由与文本拼行逻辑，不加载真实 worker。
 * 必须放在模块顶层（Vitest 要求 `vi.mock` 在文件作用域）。
 */
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: () =>
    ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({
            items: [
              { str: '2026-08-01', transform: [1, 0, 0, 1, 10, 800] },
              { str: '11:03:18', transform: [1, 0, 0, 1, 60, 800] },
              { str: '20260801', transform: [1, 0, 0, 1, 120, 800] },
              { str: '快捷支付', transform: [1, 0, 0, 1, 180, 800] },
              { str: '支', transform: [1, 0, 0, 1, 240, 800] },
              { str: '-35.50', transform: [1, 0, 0, 1, 280, 800] },
              { str: '******', transform: [1, 0, 0, 1, 340, 800] },
            ],
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
    const bytes = new Uint8Array([1, 2, 3]);
    const source = await buildImportSource(fakeFile('兴业银行.pdf'), bytes);
    expect(source.format).toBe('pdf');
    expect(source.text).toBe('2026-08-01 11:03:18 20260801 快捷支付 支 -35.50 ******');
    expect((globalThis as Record<string, unknown>).pdfjsWorker).toBeDefined();
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

