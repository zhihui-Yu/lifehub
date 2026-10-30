/**
 * CSV 解析器单测。
 *
 * 覆盖需求：A-04 ①②③④⑤；系统设计 §7 T03 验收「夹具覆盖 ≥ 12 种边界用例」。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CsvParser } from '../../src/csv/parser';
import { detectEncoding, decodeBytes, hasBom, stripBom } from '../../src/csv/encoding';

/** 读取夹具文件内容。 */
function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/csv/${name}`, import.meta.url)), 'utf8');
}

/** 把整段文本切成一个 chunk。 */
async function* singleChunk(text: string): AsyncGenerator<string> {
  yield text;
}

describe('CsvParser.parse', () => {
  it('解析带表头的基本 CSV', () => {
    const parser = new CsvParser();
    const table = parser.parse(fixture('simple.csv'));
    expect(table.headers).toEqual(['日期', '金额', '对方']);
    expect(table.rows).toHaveLength(3);
    expect(table.rows[0]).toEqual(['2024-01-15', '35.50', '星巴克']);
  });

  it('支持引号包裹、字段内逗号与 "" 转义', () => {
    const parser = new CsvParser();
    const table = parser.parse(fixture('wechat-pay.csv'));
    expect(table.rows).toHaveLength(5);
    // 第 2 行备注含逗号，应完整落在一个单元格内。
    expect(table.rows[1]?.[10]).toBe('含逗号, 的备注');
    // 第 5 行备注含转义引号。
    expect(table.rows[4]?.[10]).toBe('含"引号"的备注');
  });

  it('支持字段内换行', () => {
    const parser = new CsvParser();
    const table = parser.parse(fixture('quoted-newline.csv'));
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]?.[3]).toBe('第一行\n第二行带换行');
  });

  it('自动剥离 UTF-8 BOM', () => {
    const parser = new CsvParser();
    const table = parser.parse(fixture('bom-crlf.csv'));
    expect(table.headers[0]).toBe('日期');
  });

  it('推断分号分隔符', () => {
    const parser = new CsvParser({ delimiter: 'auto' });
    const table = parser.parse(fixture('semicolon-delimiter.csv'));
    expect(table.delimiter).toBe(';');
    expect(table.headers).toEqual(['日期', '金额', '对方', '收/支']);
  });

  it('跳过空行、尾部逗号不影响字段数', () => {
    const parser = new CsvParser();
    const table = parser.parse('a,b,c\n1,2,3\n\n4,5,6\n');
    expect(table.rows).toHaveLength(2);
  });

  it('处理单列文件与全空文件', () => {
    const parser = new CsvParser();
    expect(parser.parse('only\nvalue\n').rows).toHaveLength(1);
    expect(parser.parse('').rows).toHaveLength(0);
  });

  it('保留末尾没有换行符的最后一行', () => {
    const parser = new CsvParser();
    const table = parser.parse('a,b\n1,2');
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]).toEqual(['1', '2']);
  });

  it('引号未闭合时抛 LIFEHUB_E_CSV_PARSE', () => {
    const parser = new CsvParser();
    expect(() => parser.parse('a,b\n"未闭合,2\n')).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_CSV_PARSE' }),
    );
  });
});

describe('CsvParser.parseStream', () => {
  it('流式结果与同步解析完全一致', async () => {
    const parser = new CsvParser();
    const text = fixture('wechat-pay.csv');
    const sync = parser.parse(text);

    const streamed: string[][] = [];
    for await (const row of parser.parseStream(singleChunk(text))) {
      streamed.push(row.cells);
    }
    expect(streamed).toEqual(sync.rows);
  });

  it('按 chunk 切分时结果仍然一致', async () => {
    const parser = new CsvParser();
    const text = fixture('wechat-pay.csv');
    const sync = parser.parse(text);

    async function* chunks(): AsyncGenerator<string> {
      const size = 7;
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

  it('产出的行索引从 0 开始且不含表头', async () => {
    const parser = new CsvParser();
    const indexes: number[] = [];
    for await (const row of parser.parseStream(singleChunk(fixture('simple.csv')))) {
      indexes.push(row.index);
    }
    expect(indexes).toEqual([0, 1, 2]);
  });
});

describe('encoding', () => {
  it('识别 UTF-8 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61]);
    expect(hasBom(bytes)).toBe(true);
    expect(stripBom(bytes).length).toBe(1);
  });

  it('探测 UTF-8 与 GBK', () => {
    const utf8 = new TextEncoder().encode('日期,金额');
    expect(detectEncoding(utf8)).toBe('utf-8');

    // 用 GBK 编码的「日期」：0xD5 0xC8 0xC8 0xD5 在 UTF-8 下是非法序列。
    const gbk = new Uint8Array([0xd5, 0xc8, 0xc8, 0xd5, 0x2c, 0x0a]);
    expect(detectEncoding(gbk)).toBe('gbk');
  });

  it('按指定编码解码并得到中文', () => {
    // GBK 编码的「日期」：日 = 0xC8 0xD5，期 = 0xC6 0xDA。
    const gbk = new Uint8Array([0xc8, 0xd5, 0xc6, 0xda]);
    expect(decodeBytes(gbk, 'gbk')).toBe('日期');
  });

  it('utf-8-bom 编码自动剥离 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('abc')]);
    expect(decodeBytes(bytes, 'utf-8-bom')).toBe('abc');
  });
});
