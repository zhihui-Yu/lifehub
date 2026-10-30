/**
 * CSV 解析器（手写流式状态机）。
 *
 * 架构位置：core 包「CSV 解析」模块的核心，服务于 A-04 / A-05 / A-10。
 *
 * 为什么自研而不用 papaparse（系统设计 §1.3）：
 * - 需要**真正的流式**解析（10 万行 / 10MB ≤ 3s，NF-P-1），多数库只提供全量 API；
 * - 零第三方依赖，减小供应链风险（NF-S-5）。
 *
 * 支持的 RFC 4180 特性：
 * - 引号包裹字段，字段内可含逗号 / 换行 / 引号；
 * - `""` 转义为单个双引号；
 * - CRLF / LF / CR 三种换行混排；
 * - UTF-8 BOM 自动剥离；
 * - 字段内换行时 `raw` 保留原始多行文本，便于错误定位。
 */
import { LifeHubError } from '../errors';

/** 解析器构造选项。 */
export interface CsvParserOptions {
  /** 分隔符；'auto' 表示按首行出现次数最多者推断，默认 ','。 */
  delimiter?: 'auto' | string;
  /** 引号字符，默认 '"'。 */
  quote?: string;
  /** 是否裁剪表头空白，默认 true。 */
  trimHeader?: boolean;
  /** 是否跳过空行，默认 true。 */
  skipEmptyLines?: boolean;
}

/** 单次解析的选项。 */
export interface ParseOptions extends CsvParserOptions {
  /** 表头行索引，默认 0。 */
  headerRow?: number;
}

/** 解析出的完整表格。 */
export interface CsvTable {
  /** 表头单元格。 */
  headers: string[];
  /** 数据行。 */
  rows: string[][];
  /** 实际使用的分隔符。 */
  delimiter: string;
}

/** 流式解析出的一行。 */
export interface CsvRow {
  /** 行索引（数据行从 0 开始，不含表头）。 */
  index: number;
  /** 单元格数组。 */
  cells: string[];
  /** 原始行文本。 */
  raw: string;
}

/** 候选分隔符集合。 */
const CANDIDATE_DELIMITERS = [',', ';', '\t', '|'] as const;

/**
 * CSV 状态机。
 *
 * 说明：把「字符流 → 行」的核心逻辑集中在一处，
 * 同步入口（`parseRows`）与流式入口（`parseStream`）共用同一份实现，
 * 保证两条路径的解析结果**完全一致**（这一点由单测断言）。
 *
 * 关键：`push` 需要看到**下一个字符**才能判断 `""` 是转义还是引号结束，
 * 因此采用一字符前瞻；调用方负责在处理完转义对后跳过第二个引号。
 */
class CsvStateMachine {
  /** 引号字符。 */
  private readonly quote: string;
  /** 分隔符。 */
  private readonly delimiter: string;
  /** 是否跳过空行。 */
  private readonly skipEmptyLines: boolean;
  /** 当前行的单元格。 */
  private cells: string[] = [];
  /** 当前字段内容。 */
  private field = '';
  /** 当前是否处于引号字段内。 */
  private inQuotes = false;
  /** 引号是否已闭合（闭合后只允许分隔符或换行）。 */
  private quoteClosed = false;
  /** 当前行原始文本。 */
  private raw = '';
  /** 当前行号（0 基，指向即将完成的行）。 */
  private currentRow = 0;

  /**
   * 构造状态机。
   *
   * @param options 状态机选项
   */
  constructor(options: { quote: string; delimiter: string; skipEmptyLines: boolean }) {
    this.quote = options.quote;
    this.delimiter = options.delimiter;
    this.skipEmptyLines = options.skipEmptyLines;
  }

  /**
   * 输入一个字符。
   *
   * @param char 待输入字符
   * @param next 下一个字符（用于判断 `""` 转义）；可以是 undefined
   * @param onRow 行完成回调
   * @returns 需要额外跳过的字符数（0 或 1，处理 `""` 转义时为 1）
   * @throws {LifeHubError} `LIFEHUB_E_CSV_PARSE` —— 引号后出现非法字符
   */
  push(char: string, next: string | undefined, onRow: (row: CsvRow) => void): number {
    if (this.inQuotes) {
      if (char === this.quote) {
        if (next === this.quote) {
          // `""` 是转义序列，表示一个字面引号。
          this.field += this.quote;
          this.raw += this.quote + this.quote;
          return 1;
        }
        // 引号字段结束。
        this.inQuotes = false;
        this.quoteClosed = true;
        this.raw += char;
        return 0;
      }
      this.field += char;
      this.raw += char;
      return 0;
    }

    if (this.quoteClosed) {
      if (char === this.delimiter) {
        this.finishField();
        this.raw += char;
        return 0;
      }
      if (char === '\n' || char === '\r') {
        this.finishRow(onRow);
        return 0;
      }
      throw new LifeHubError('LIFEHUB_E_CSV_PARSE', `引号字段后出现非法字符：${char}`);
    }

    if (char === this.quote) {
      this.inQuotes = true;
      this.raw += char;
      return 0;
    }
    if (char === this.delimiter) {
      this.finishField();
      this.raw += char;
      return 0;
    }
    if (char === '\n' || char === '\r') {
      this.finishRow(onRow);
      return 0;
    }
    this.field += char;
    this.raw += char;
    return 0;
  }

  /**
   * 结束当前字段。
   *
   * 说明：同时复位 `quoteClosed`——引号闭合状态只对**当前字段**有效，
   * 字段结束后必须复位，否则下一个字段的首字符会被误判为「引号后的非法字符」。
   *
   * @returns 无异常
   */
  finishField(): void {
    this.cells.push(this.field);
    this.field = '';
    this.quoteClosed = false;
  }

  /**
   * 结束当前行并回调。
   *
   * @param onRow 行完成回调
   * @returns 无异常
   */
  finishRow(onRow: (row: CsvRow) => void): void {
    this.finishField();
    const isEmpty = this.cells.length === 1 && this.cells[0] === '';
    if (!(this.skipEmptyLines && isEmpty)) {
      onRow({ index: this.currentRow, cells: this.cells, raw: this.raw });
      this.currentRow += 1;
    }
    this.cells = [];
    this.raw = '';
    this.quoteClosed = false;
  }

  /**
   * 结束输入（处理末尾无换行符的最后一行）。
   *
   * @param onRow 行完成回调
   * @returns 无异常
   * @throws {LifeHubError} `LIFEHUB_E_CSV_PARSE` —— 引号未闭合
   */
  finish(onRow: (row: CsvRow) => void): void {
    if (this.inQuotes) {
      throw new LifeHubError('LIFEHUB_E_CSV_PARSE', 'CSV 引号未闭合');
    }
    if (this.field !== '' || this.cells.length > 0) {
      this.finishRow(onRow);
    }
  }
}

/**
 * CSV 解析器。
 */
export class CsvParser {
  /** 构造选项。 */
  private readonly options: CsvParserOptions;
  /**
   * 跨 chunk 保留的待处理字符。
   *
   * 说明：状态机需要**一字符前瞻**才能判断 `""` 是转义还是引号结束。
   * 当 `""` 恰好跨越 chunk 边界时，若不保留上一个 chunk 的最后一个字符，
   * 就会把转义误判为「引号闭合」，进而抛出「引号字段后出现非法字符」。
   */
  private pendingChar: string | null = null;

  /**
   * 构造 CSV 解析器。
   *
   * @param options 解析选项
   */
  constructor(options?: CsvParserOptions) {
    this.options = options ?? {};
  }

  /**
   * 解析完整文本并返回表格（供测试与小文件使用）。
   *
   * @param text CSV 文本
   * @param options 单次解析选项
   * @returns 解析出的表格
   * @throws {LifeHubError} `LIFEHUB_E_CSV_PARSE` —— 引号未闭合等语法异常
   */
  parse(text: string, options?: ParseOptions): CsvTable {
    const rows = this.parseRows(text, options);
    const headerRowIndex = options?.headerRow ?? 0;
    const headers = rows[headerRowIndex] ?? [];
    const dataRows = rows.slice(headerRowIndex + 1);
    return {
      headers: this.shouldTrimHeader(options) ? headers.map((cell) => cell.trim()) : headers,
      rows: dataRows,
      delimiter: this.resolveDelimiter(text, options),
    };
  }

  /**
   * 解析完整文本并返回所有行（含表头行）。
   *
   * @param text CSV 文本
   * @param options 单次解析选项
   * @returns 行数组
   * @throws {LifeHubError} `LIFEHUB_E_CSV_PARSE` —— 语法异常
   */
  parseRows(text: string, options?: ParseOptions): string[][] {
    this.pendingChar = null;
    const machine = this.createMachine(text, options);
    const rows: string[][] = [];
    const onRow = (row: CsvRow): void => {
      rows.push(row.cells);
    };
    this.feedText(machine, text, onRow);
    this.flushPending(machine, onRow);
    machine.finish(onRow);
    return rows;
  }

  /**
   * 流式解析：逐行产出，不把整表驻留内存。
   *
   * 说明：这是 10 万行 / 10MB ≤ 3s 的关键路径（NF-P-1）。
   *
   * @param chunks 文本块异步迭代器（已完成编码解码）
   * @param options 单次解析选项
   * @returns 逐行产出的异步迭代器
   * @throws {LifeHubError} `LIFEHUB_E_CSV_PARSE` —— 语法异常
   */
  async *parseStream(
    chunks: AsyncIterable<Uint8Array | string>,
    options?: ParseOptions,
  ): AsyncGenerator<CsvRow> {
    this.pendingChar = null;
    const headerRowIndex = options?.headerRow ?? 0;
    const quote = options?.quote ?? this.options.quote ?? '"';
    const skipEmptyLines = options?.skipEmptyLines ?? this.options.skipEmptyLines ?? true;
    const delimiter = options?.delimiter ?? this.options.delimiter ?? ',';
    // 流式模式下无法预读全文，'auto' 分隔符退化为 ','（多数账单文件都是逗号分隔）。
    const resolvedDelimiter = delimiter === 'auto' ? ',' : delimiter;

    const machine = new CsvStateMachine({ quote, delimiter: resolvedDelimiter, skipEmptyLines });
    let dataIndex = -1;
    // 说明：状态机的行回调是同步函数，不能在里面 yield；
    // 因此先把一个 chunk 内完成的行收集起来，再统一 yield 出去。
    const buffer: CsvRow[] = [];

    const onRow = (row: CsvRow): void => {
      // 表头行本身不产出数据行；数据行的 0 基索引 = 物理行号 - 表头行号 - 1。
      if (row.index <= headerRowIndex) {
        return;
      }
      dataIndex = row.index - headerRowIndex - 1;
      buffer.push({ index: dataIndex, cells: row.cells, raw: row.raw });
    };

    for await (const chunk of chunks) {
      const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      buffer.length = 0;
      this.feedText(machine, text, onRow);
      for (const row of buffer) {
        yield row;
      }
    }
    buffer.length = 0;
    this.flushPending(machine, onRow);
    machine.finish(onRow);
    for (const row of buffer) {
      yield row;
    }
  }

  /**
   * 创建状态机实例。
   *
   * @param text CSV 文本（用于推断分隔符）
   * @param options 单次解析选项
   * @returns 状态机
   */
  private createMachine(text: string, options?: ParseOptions): CsvStateMachine {
    return new CsvStateMachine({
      quote: options?.quote ?? this.options.quote ?? '"',
      delimiter: this.resolveDelimiter(text, options),
      skipEmptyLines: options?.skipEmptyLines ?? this.options.skipEmptyLines ?? true,
    });
  }

  /**
   * 把文本喂给状态机。
   *
   * 说明：采用一字符前瞻，把「当前字符 + 下一个字符」一起交给状态机，
   * 由状态机决定 `""` 是转义还是引号结束。
   *
   * @param machine 状态机
   * @param text 待处理文本
   * @param onRow 行完成回调
   * @returns 无异常
   */
  private feedText(
    machine: CsvStateMachine,
    text: string,
    onRow: (row: CsvRow) => void,
  ): void {
    // 把上一个 chunk 末尾留下的字符接到本次输入前面，
    // 否则 `""` 转义恰好跨 chunk 边界时会被误判为「引号闭合 + 非法字符」。
    const source = this.pendingChar === null ? text : this.pendingChar + text;
    this.pendingChar = null;
    let index = 0;
    while (index < source.length) {
      const char = source[index] ?? '';
      const next = source[index + 1];
      if (next === undefined) {
        // 末尾字符无法前瞻，留到下一个 chunk（或输入结束时）再处理。
        this.pendingChar = char;
        break;
      }
      const skipped = machine.push(char, next, onRow);
      index += 1 + skipped;
    }
  }

  /**
   * 处理跨 chunk 保留的最后一个字符。
   *
   * 说明：输入结束时已经没有下一个字符可前瞻，按「无后继字符」语义推入状态机。
   *
   * @param machine 状态机
   * @param onRow 行完成回调
   * @returns 无异常
   */
  private flushPending(machine: CsvStateMachine, onRow: (row: CsvRow) => void): void {
    if (this.pendingChar === null) {
      return;
    }
    const char = this.pendingChar;
    this.pendingChar = null;
    machine.push(char, undefined, onRow);
  }

  /**
   * 推断实际使用的分隔符。
   *
   * 说明：'auto' 模式下统计首行各候选分隔符的出现次数，取最多者；
   * 全部为 0 时回退到 ','（RFC 4180 默认）。
   *
   * @param text CSV 文本
   * @param options 单次解析选项
   * @returns 分隔符
   */
  private resolveDelimiter(text: string, options?: ParseOptions): string {
    const configured = options?.delimiter ?? this.options.delimiter ?? ',';
    if (configured !== 'auto') {
      return configured;
    }
    const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? '';
    let best = ',';
    let bestCount = 0;
    for (const candidate of CANDIDATE_DELIMITERS) {
      const count = countOccurrences(firstLine, candidate);
      if (count > bestCount) {
        best = candidate;
        bestCount = count;
      }
    }
    return best;
  }

  /**
   * 判断是否裁剪表头空白。
   *
   * @param options 单次解析选项
   * @returns 需要裁剪返回 true
   */
  private shouldTrimHeader(options?: ParseOptions): boolean {
    return options?.trimHeader ?? this.options.trimHeader ?? true;
  }
}

/**
 * 统计子串在文本中的出现次数。
 *
 * @param text 待统计文本
 * @param needle 目标子串
 * @returns 出现次数
 */
function countOccurrences(text: string, needle: string): number {
  if (needle === '' || text === '') {
    return 0;
  }
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}
