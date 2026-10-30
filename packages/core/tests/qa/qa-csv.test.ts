/**
 * QA 独立补测 · A-04 CSV 解析器 与 A-05 列头映射。
 *
 * 覆盖需求：A-04 ①②③④⑤；A-05 ①②③④⑤；系统设计 §7 T03 验收「夹具覆盖 ≥ 12 种边界用例」。
 *
 * 【本文件与工程师自写用例的差异】
 * 工程师的 `tests/unit/csv-parser.test.ts` 覆盖了基本解析、引号、字段内换行、BOM、分号推断。
 * 但以下**未被充分验证**：
 * 1. **GBK 中文夹具**：PRD A-04 ③ 要求「优先 UTF-8，失败回退 GBK/GB18030」，
 *    工程师的用例只用 4 字节的手写 GBK 片段，未验证真实中文账单；
 * 2. **CRLF 混排**（A-04 ①「CRLF/LF 混排行尾」）与 **BOM + CRLF + 字段内换行组合**；
 * 3. **列映射以 0 基列索引存储**（A-05 ①）—— 需要验证表头改版后映射依然有效；
 * 4. 解析入口的 `parseStream` 与 `parse` 结果一致性（跨 chunk 边界）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CsvParser } from '../../src/csv/parser';
import { ColumnMapper } from '../../src/csv/column-mapper';
import { decodeBytes, detectEncoding } from '../../src/csv/encoding';

/**
 * 读取 QA 夹具文件的原始字节。
 *
 * @param name 夹具文件名
 * @returns 文件字节数组
 */
function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
}

/**
 * 把整段文本切成一个 chunk。
 *
 * @param text 文本内容
 * @returns 只产出一个 chunk 的异步迭代器
 */
async function* singleChunk(text: string): AsyncGenerator<string> {
  yield text;
}

describe('A-04 · 编码探测：UTF-8 优先，回退 GBK / GB18030（A-04 ③）', () => {
  it('GBK 编码的中文账单被正确识别为 gbk 并解码出中文', () => {
    const bytes = fixtureBytes('gbk-chinese.csv');

    expect(detectEncoding(bytes)).toBe('gbk');

    const text = decodeBytes(bytes, 'gbk');
    expect(text).toContain('美团外卖');
    expect(text).toContain('星巴克');
    // 不应出现 UTF-8 解码产生的替换字符（乱码）。
    expect(text).not.toContain('�');
  });

  it('GBK 文件经解码后能被 CsvParser 正确解析出中文与字段内逗号', () => {
    const bytes = fixtureBytes('gbk-chinese.csv');
    const text = decodeBytes(bytes, detectEncoding(bytes));
    const table = new CsvParser().parse(text);

    expect(table.headers[0]).toBe('交易时间');
    expect(table.headers[2]).toBe('交易对方');
    expect(table.rows).toHaveLength(3);
    expect(table.rows[0]?.[2]).toBe('美团外卖');
    // 第 2 列备注含逗号，必须完整落在一个单元格内。
    expect(table.rows[0]?.[7]).toBe('含逗号, 的备注');
    expect(table.rows[2]?.[5]).toBe('收入');
  });

  it('纯 UTF-8 文件被识别为 utf-8（不回退）', () => {
    const bytes = new TextEncoder().encode('日期,金额\n2024-01-15,35.50\n');
    expect(detectEncoding(bytes)).toBe('utf-8');
  });

  it('带 BOM 的 UTF-8 文件被识别为 utf-8-bom 且 BOM 被剥离', () => {
    const bytes = fixtureBytes('bom-crlf-quoted-newline.csv');
    expect(detectEncoding(bytes)).toBe('utf-8-bom');

    const text = decodeBytes(bytes, 'utf-8-bom');
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(text.startsWith('a,b,c')).toBe(true);
  });
});

describe('A-04 · RFC 4180 边界场景（A-04 ①⑤）', () => {
  it('场景 1：BOM + CRLF + 字段内换行 的组合夹具', () => {
    const bytes = fixtureBytes('bom-crlf-quoted-newline.csv');
    const table = new CsvParser().parse(decodeBytes(bytes, 'utf-8-bom'));

    expect(table.headers).toEqual(['a', 'b', 'c']);
    // 字段内的 CRLF 换行必须被完整保留在同一个单元格里。
    expect(table.rows[0]?.[2]).toBe('x\r\ny');
    expect(table.rows).toHaveLength(3);
    expect(table.rows[2]).toEqual(['6', '7', '8']);
  });

  it('场景 2：CRLF / LF 混排行尾', () => {
    const bytes = fixtureBytes('mixed-line-endings.csv');
    const table = new CsvParser().parse(new TextDecoder().decode(bytes));

    expect(table.headers).toEqual(['a', 'b', 'c']);
    expect(table.rows).toHaveLength(3);
    expect(table.rows[0]).toEqual(['1', '2', '3']);
    expect(table.rows[1]).toEqual(['4', '5', '6']);
    expect(table.rows[2]).toEqual(['7', '8', '9']);
    // 行尾不得残留 \r。
    for (const row of table.rows) {
      for (const cell of row) {
        expect(cell).not.toContain('\r');
      }
    }
  });

  it('场景 3：单列文件', () => {
    const bytes = fixtureBytes('single-column.csv');
    const table = new CsvParser().parse(new TextDecoder().decode(bytes));
    expect(table.headers).toEqual(['a']);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]).toEqual(['1']);
  });

  it('场景 4：分隔符为分号', () => {
    const bytes = fixtureBytes('semicolon.csv');
    const table = new CsvParser({ delimiter: 'auto' }).parse(new TextDecoder().decode(bytes));
    expect(table.delimiter).toBe(';');
    expect(table.headers).toEqual(['a', 'b', 'c']);
    expect(table.rows[0]).toEqual(['1', '2', '3']);
  });

  it('场景 5：空行（整行为空）被跳过', () => {
    const table = new CsvParser().parse('a,b,c\n\n1,2,3\n\n\n4,5,6\n');
    expect(table.rows).toHaveLength(2);
  });

  it('场景 6：空行出现在**首行**（表头之前）', () => {
    const table = new CsvParser().parse('\na,b,c\n1,2,3\n');
    expect(table.headers).toEqual(['a', 'b', 'c']);
    expect(table.rows).toHaveLength(1);
  });

  it('场景 7：尾部逗号（最后一列留空）', () => {
    const table = new CsvParser().parse('a,b,c\n1,2,\n');
    expect(table.rows[0]).toEqual(['1', '2', '']);
    expect(table.rows[0]).toHaveLength(3);
  });

  it('场景 8：全空文件', () => {
    const table = new CsvParser().parse('');
    expect(table.headers).toEqual([]);
    expect(table.rows).toHaveLength(0);
  });

  it('场景 9：字段内引号（"" 转义为单个双引号）', () => {
    const table = new CsvParser().parse('a,b\n"he said ""hi""",x\n');
    expect(table.rows[0]?.[0]).toBe('he said "hi"');
  });

  it('场景 10：字段内换行（LF）', () => {
    const table = new CsvParser().parse('a,b\n"line1\nline2",x\n');
    expect(table.rows[0]?.[0]).toBe('line1\nline2');
    expect(table.rows).toHaveLength(1);
  });

  it('场景 11：缺失末尾换行符的最后一行仍被保留', () => {
    const table = new CsvParser().parse('a,b\n1,2');
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]).toEqual(['1', '2']);
  });

  it('场景 12：含中文的引号字段', () => {
    const table = new CsvParser().parse('a,b\n"中文,带逗号",其他\n');
    expect(table.rows[0]?.[0]).toBe('中文,带逗号');
    expect(table.rows[0]?.[1]).toBe('其他');
  });

  it('场景 13：引号未闭合时抛 LIFEHUB_E_CSV_PARSE（不崩溃）', () => {
    expect(() => new CsvParser().parse('a,b\n"未闭合,2\n')).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_CSV_PARSE' }),
    );
  });
});

describe('A-04 · parseStream 与 parse 结果一致（A-04 ④）', () => {
  it('GBK 中文文件流式解析与同步解析完全一致', async () => {
    const bytes = fixtureBytes('gbk-chinese.csv');
    const text = decodeBytes(bytes, detectEncoding(bytes));
    const parser = new CsvParser();
    const sync = parser.parse(text);

    const streamed: string[][] = [];
    for await (const row of parser.parseStream(singleChunk(text))) {
      streamed.push(row.cells);
    }
    expect(streamed).toEqual(sync.rows);
  });

  it('CRLF 夹具在按 chunk 切分时结果仍然一致', async () => {
    const bytes = fixtureBytes('bom-crlf-quoted-newline.csv');
    const text = decodeBytes(bytes, 'utf-8-bom');
    const parser = new CsvParser();
    const sync = parser.parse(text);

    async function* chunks(): AsyncGenerator<string> {
      const size = 5;
      for (let index = 0; index < text.length; index += size) {
        yield text.slice(index, index + size);
      }
    }

    const streamed: string[][] = [];
    for await (const row of parser.parseStream(chunks())) {
      streamed.push(row.cells);
    }
    expect(streamed).toEqual(sync.rows);
  });
});

describe('A-05 · 列映射以 0 基列索引存储（A-05 ①）', () => {
  it('映射表的键是 0 基列索引，且与表头文字无关', async () => {
    const mapper = new ColumnMapper(['交易时间', '金额', '对方']);
    const mapping = { 0: 'occurredAt', 1: 'amount', 2: 'counterparty' } as const;

    // 键必须是数字字符串 "0" / "1" / "2"，不能是表头文字。
    expect(Object.keys(mapping)).toEqual(['0', '1', '2']);

    const validation = mapper.validate(mapping);
    expect(validation.ok).toBe(true);
  });

  it('表头改版后（表头文字全变）同一套列索引映射依然有效', async () => {
    // 这是 A-05 ① 的核心意图：「同一文件表头改版不失效」。
    const oldMapper = new ColumnMapper(['交易时间', '金额(元)', '交易对方']);
    const newMapper = new ColumnMapper(['Timestamp', 'Amount', 'Payee']);

    const mapping = { 0: 'occurredAt', 1: 'amount', 2: 'counterparty' } as const;

    // 旧表头下映射结果正确。
    const oldRow = oldMapper.mapRow(['2024-01-15', '35.50', '星巴克'], mapping);
    expect(oldRow.occurredAt).toBe('2024-01-15');
    expect(oldRow.amount).toBe('35.50');
    expect(oldRow.counterparty).toBe('星巴克');

    // 表头全改后，同一套列索引映射依然抽到同样的语义字段。
    const newRow = newMapper.mapRow(['2024-01-15', '35.50', '星巴克'], mapping);
    expect(newRow.occurredAt).toBe('2024-01-15');
    expect(newRow.amount).toBe('35.50');
    expect(newRow.counterparty).toBe('星巴克');
  });

  it('映射变更后解析结果相应改变（A-05 ⑤）', () => {
    const mapper = new ColumnMapper(['日期', '金额', '对方']);
    const row = ['2024-01-15', '35.50', '星巴克'];

    const before = mapper.mapRow(row, { 0: 'occurredAt', 1: 'amount', 2: 'counterparty' });
    const after = mapper.mapRow(row, { 0: 'occurredAt', 2: 'amount', 1: 'counterparty' });

    expect(before.amount).toBe('35.50');
    expect(before.counterparty).toBe('星巴克');
    // 列索引对调后，取到的值必须跟着变。
    expect(after.amount).toBe('星巴克');
    expect(after.counterparty).toBe('35.50');
  });

  it('可以标记「忽略」列（A-05 ②）', () => {
    const mapper = new ColumnMapper(['日期', '金额', '备注', '对方']);
    const mapping = { 0: 'occurredAt', 1: 'amount', 2: 'ignore', 3: 'counterparty' } as const;

    const validation = mapper.validate(mapping);
    expect(validation.ok).toBe(true);

    const row = mapper.mapRow(['2024-01-15', '35.50', '不该被采集', '星巴克'], mapping);
    expect(row.note).toBe('');
  });

  it('必填字段（日期、金额）未映射时校验失败并给中文提示（A-05 ③）', () => {
    const mapper = new ColumnMapper(['日期', '金额', '对方']);
    const validation = mapper.validate({ 2: 'counterparty' });

    expect(validation.ok).toBe(false);
    expect(validation.missingRequired).toEqual(['occurredAt', 'amount']);
    expect(validation.message).toBe('请先映射『日期』和『金额』两列');
  });

  it('同一字段被两个列占用时给出 duplicatedFields 与中文提示（A-10 ④）', () => {
    const mapper = new ColumnMapper(['日期', '金额', '金额2']);
    const validation = mapper.validate({ 0: 'occurredAt', 1: 'amount', 2: 'amount' });

    expect(validation.ok).toBe(false);
    expect(validation.duplicatedFields).toEqual(['amount']);
    expect(validation.message).toContain('同一字段不能映射到多列');
  });

  it('表头签名对空格与大小写差异不敏感（模板可复用，A-13 ②）', async () => {
    const provider = new (await import('../../src/crypto/providers/web-crypto-provider')).WebCryptoProvider();
    const mapper = new ColumnMapper(['交易时间', '金额']);

    const a = await mapper.buildSignature(['交易时间', '金额'], provider);
    const b = await mapper.buildSignature([' 交易时间 ', '金额'], provider);
    const c = await mapper.buildSignature(['交易时间', '金额2'], provider);

    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
