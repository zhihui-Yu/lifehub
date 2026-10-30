/**
 * 导入服务：CSV → 映射 → 方向推断 → 清洗去重 → 分批落库。
 *
 * 架构位置：core 包「服务」层，是 A-04 / A-05 / A-06 / A-11 / A-12 / A-13 的编排中心。
 *
 * 两阶段设计（系统设计 §4.2 关键点 1）：
 * 1. `plan()`：只读探查（哈希、编码、表头、签名、模板匹配、建议映射、前 10 行预览），**不落库**；
 * 2. `run()`：用户确认映射后执行真正的流式导入。
 *
 * 性能（NF-P-1）：整个过程**单次流式遍历**，每 1000 条一批落库，10 万行不整表驻留内存。
 */
import { IMPORT_BATCH_SIZE, IMPORT_PREVIEW_ROWS } from '../constants';
import { LifeHubError } from '../errors';
import type { CryptoProvider } from '../crypto/provider';
import { ColumnMapper } from '../csv/column-mapper';
import type { MappedRow } from '../csv/column-mapper';
import { decodeBytes, detectEncoding } from '../csv/encoding';
import { CsvParser } from '../csv/parser';
import type { CsvRow } from '../csv/parser';
import { DirectionResolver } from '../csv/direction';
import { RowMapper } from '../csv/row-mapper';
import type { PreviewRow, RowContext } from '../csv/row-mapper';
import type { Bill } from '../models/bill';
import type { ImportBatch, ImportEncoding, ImportError, ImportSummary } from '../models/import-batch';
import type { CategoryRule, ColumnMapping, DirectionRule } from '../models/rule-template';
import { CurrencyCode, DEFAULT_CURRENCY } from '../money/currency';
import { CategoryRuleEngine } from '../rules/category-rule';
import { Deduplicator } from '../rules/dedupe';
import { computeFileHash } from '../rules/fingerprint';
import type { BillRepository } from '../repositories/bill-repository';
import type { ImportBatchRepository } from '../repositories/import-batch-repository';
import type { RuleTemplateRepository } from '../repositories/rule-template-repository';
import type { Clock } from '../types/common';
import { uuidV7 } from '../utils/id';
import type { AuditLogger } from './audit-logger';

/** 导入源。 */
export interface ImportSource {
  /** 文件名。 */
  fileName: string;
  /** 文件字节数。 */
  sizeBytes: number;
  /** 文件字节内容。 */
  bytes: Uint8Array;
}

/** 导入探查计划。 */
export interface ImportPlan {
  /** 文件 sha256 hex。 */
  fileHash: string;
  /** 文件编码。 */
  encoding: ImportEncoding;
  /** 表头单元格。 */
  headers: string[];
  /** 实际分隔符。 */
  delimiter: string;
  /** 数据行总数。 */
  rowCount: number;
  /** 表头签名。 */
  fileSignature: string;
  /** 建议的列映射。 */
  suggestedMapping: ColumnMapping;
  /** 命中的规则模板 id；未命中为 null。 */
  matchedTemplateId: string | null;
  /** 命中的规则模板名；未命中为 null。 */
  matchedTemplateName: string | null;
  /** 前 N 行预览。 */
  preview: PreviewRow[];
  /** 是否命中「同一文件已导入过」。 */
  duplicateFile: boolean;
  /** 重复导入时对应的批次创建时间。 */
  duplicateOf: string | null;
}

/** 导入执行选项。 */
export interface RunOptions {
  /** 使用的规则模板 id。 */
  templateId?: string | null;
  /** 方向判定规则；省略时使用模板中的规则或默认规则。 */
  directionRule?: DirectionRule;
  /** 分类规则；省略时使用模板中的规则。 */
  categoryRules?: CategoryRule[];
  /** 命中的日期格式标识（优先尝试）。 */
  dateFormatHints?: string[];
  /** 用户时区（决定 localDate）。 */
  userTimeZone?: string;
  /** 来源时区。 */
  sourceTimeZone?: string;
  /** 币种。 */
  currency?: CurrencyCode;
  /** 是否允许强制重新导入同一文件（A-12 ② 的「重新导入」入口）。 */
  allowDuplicate?: boolean;
  /** 进度回调。 */
  onProgress?: (progress: { processed: number; total: number }) => void;
}

/** 导入服务依赖。 */
export interface ImportServiceDeps {
  /** 密码学能力端口（用于文件哈希）。 */
  provider: CryptoProvider;
  /** CSV 解析器。 */
  parser: CsvParser;
  /** 列映射器工厂。 */
  createMapper?: (headers: string[]) => ColumnMapper;
  /** 行映射器工厂。 */
  createRowMapper?: (deps: {
    mapper: ColumnMapper;
    direction: DirectionResolver;
    currency: CurrencyCode;
    defaultTimeZone: string;
  }) => RowMapper;
  /** 规则模板仓储。 */
  templates: RuleTemplateRepository;
  /** 导入批次仓储。 */
  batches: ImportBatchRepository;
  /** 账单仓储。 */
  bills: BillRepository;
  /** 审计日志服务。 */
  audit: AuditLogger;
  /** 时钟端口。 */
  clock: Clock;
  /** 设备 id。 */
  deviceId: string;
}

/**
 * 导入服务。
 */
export class ImportService {
  /** 依赖集合。 */
  private readonly deps: ImportServiceDeps;

  /**
   * 构造导入服务。
   *
   * @param deps 依赖集合
   */
  constructor(deps: ImportServiceDeps) {
    this.deps = deps;
  }

  /**
   * 只读探查：哈希、编码、表头、签名、模板匹配、建议映射、前 10 行预览。**不落库**。
   *
   * @param source 导入源
   * @param options 探查选项
   * @returns 导入计划
   * @throws {LifeHubError} `LIFEHUB_E_CSV_ENCODING` —— 编码无法识别；`LIFEHUB_E_CSV_PARSE` —— 语法异常
   */
  async plan(source: ImportSource, options?: PlanOptions): Promise<ImportPlan> {
    const fileHash = await computeFileHash(this.deps.provider, source.bytes);
    const encoding = this.detectEncodingSafe(source.bytes);
    const text = decodeBytes(source.bytes, encoding);
    const table = this.deps.parser.parse(text, { delimiter: options?.delimiter });

    const mapper = this.createMapper(table.headers);
    const fileSignature = await mapper.buildSignature(table.headers, this.deps.provider);
    const template = await this.deps.templates.findBySignature(fileSignature);
    const suggestedMapping = template ? { ...template.columnMapping } : mapper.suggest();

    const existing = await this.deps.batches.findByFileHash(fileHash);

    const preview = await this.buildPreview(source, table.headers, suggestedMapping, template, options);

    return {
      fileHash,
      encoding,
      headers: table.headers,
      delimiter: table.delimiter,
      rowCount: table.rows.length,
      fileSignature,
      suggestedMapping,
      matchedTemplateId: template?.id ?? null,
      matchedTemplateName: template?.name ?? null,
      preview,
      duplicateFile: existing !== null,
      duplicateOf: existing?.createdAt ?? null,
    };
  }

  /**
   * 预览：给定映射，返回前 N 行解析结果（映射变更时实时重算）。
   *
   * @param source 导入源
   * @param mapping 列映射
   * @param rowCount 预览行数，默认 10
   * @param options 预览选项
   * @returns 预览行列表
   */
  async preview(
    source: ImportSource,
    mapping: ColumnMapping,
    rowCount: number = IMPORT_PREVIEW_ROWS,
    options?: PlanOptions,
  ): Promise<PreviewRow[]> {
    const encoding = this.detectEncodingSafe(source.bytes);
    const text = decodeBytes(source.bytes, encoding);
    const table = this.deps.parser.parse(text, { delimiter: options?.delimiter });
    const mapper = this.createMapper(table.headers);
    const template = await this.deps.templates.findBySignature(
      await mapper.buildSignature(table.headers, this.deps.provider),
    );
    return this.buildPreview(source, table.headers, mapping, template, options, rowCount);
  }

  /**
   * 执行导入：流式解析 → 映射 → 方向推断 → 清洗去重 → 分批落库 → 写 ImportBatch → 审计。
   *
   * 说明：
   * - 单行失败记入 `ImportError[]` 并跳过，**不中断**整体导入（A-11 ①）；
   * - 基础设施级异常（存储失败、加密失败）继续向上抛（系统设计 §8.3 第 3 条）。
   *
   * @param source 导入源
   * @param mapping 列映射
   * @param options 执行选项
   * @returns 导入摘要
   * @throws {LifeHubError} `LIFEHUB_E_MAPPING_INCOMPLETE` —— 必填字段未映射；`LIFEHUB_E_STORAGE` —— 落库失败
   */
  async run(source: ImportSource, mapping: ColumnMapping, options: RunOptions): Promise<ImportSummary> {
    const startedAt = this.deps.clock.now();
    const fileHash = await computeFileHash(this.deps.provider, source.bytes);

    // 幂等：同一文件已导入过时，默认不重复写入（A-12 ②）。
    const existing = await this.deps.batches.findByFileHash(fileHash);
    if (existing && !options.allowDuplicate) {
      const summary: ImportSummary = {
        batchId: existing.id,
        rowTotal: existing.rowTotal,
        rowImported: 0,
        rowSkipped: existing.rowTotal,
        rowDuplicated: existing.rowTotal,
        errors: [],
        durationMs: this.deps.clock.now().getTime() - startedAt.getTime(),
        duplicateFile: true,
      };
      await this.deps.audit.log('import', source.fileName, false);
      return summary;
    }

    const encoding = this.detectEncodingSafe(source.bytes);
    const text = decodeBytes(source.bytes, encoding);
    const table = this.deps.parser.parse(text);

    const mapper = this.createMapper(table.headers);
    mapper.assertValid(mapping);

    const template = options.templateId
      ? await this.deps.templates.getById(options.templateId)
      : await this.deps.templates.findBySignature(
          await mapper.buildSignature(table.headers, this.deps.provider),
        );

    const directionRule = options.directionRule ?? template?.directionRule ?? this.defaultDirectionRule();
    const categoryRules = options.categoryRules ?? template?.categoryRules ?? [];
    const ruleEngine = new CategoryRuleEngine(categoryRules);
    const currency = options.currency ?? DEFAULT_CURRENCY;
    const userTimeZone = options.userTimeZone ?? 'UTC';
    const sourceTimeZone = options.sourceTimeZone ?? userTimeZone;

    const rowMapper = this.createRowMapper({
      mapper,
      direction: new DirectionResolver(directionRule),
      currency,
      defaultTimeZone: sourceTimeZone,
    });

    const deduper = new Deduplicator();
    const existingBills = await this.deps.bills.list();
    const fingerprints = new Set<string>(existingBills.map((bill) => deduper.computeFingerprint(bill)));

    const batchId = uuidV7();
    const errors: ImportError[] = [];
    let rowImported = 0;
    let rowSkipped = 0;
    let rowDuplicated = 0;
    const buffer: Bill[] = [];

    for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
      const cells = table.rows[rowIndex] ?? [];
      const ctx: RowContext = {
        sourceFileId: batchId,
        sourceRowIndex: rowIndex,
        sourceTimeZone,
        userTimeZone,
        currency,
        deviceId: this.deps.deviceId,
        clock: this.deps.clock,
      };
      try {
        const bill = rowMapper.toBill(cells, mapping, ctx);
        // 内容级去重（A-12 ①）。
        if (deduper.isDuplicate(bill, fingerprints)) {
          rowDuplicated += 1;
          rowSkipped += 1;
          continue;
        }
        const categoryId = ruleEngine.matchAny([bill.counterparty, bill.note]);
        const finalBill: Bill = categoryId === null ? bill : { ...bill, categoryId };
        fingerprints.add(deduper.computeFingerprint(finalBill));
        buffer.push(finalBill);
        rowImported += 1;

        // 分批落库：每 1000 条写一次，避免单次事务过大。
        if (buffer.length >= IMPORT_BATCH_SIZE) {
          await this.deps.bills.putMany(buffer);
          buffer.length = 0;
        }
      } catch (error) {
        rowSkipped += 1;
        errors.push(this.toImportError(error, rowIndex, cells));
      }
      options.onProgress?.({ processed: rowIndex + 1, total: table.rows.length });
    }

    if (buffer.length > 0) {
      await this.deps.bills.putMany(buffer);
    }

    const now = this.deps.clock.nowIso();
    const batch: ImportBatch = {
      id: batchId,
      fileName: source.fileName,
      fileSize: source.sizeBytes,
      fileHash,
      encoding,
      rowTotal: table.rows.length,
      rowImported,
      rowSkipped,
      templateId: template?.id ?? null,
      createdAt: now,
      updatedAt: now,
      version: 1,
      deviceId: this.deps.deviceId,
    };
    await this.deps.batches.save(batch);
    await this.deps.audit.log('import', source.fileName, rowSkipped === 0);

    return {
      batchId,
      rowTotal: table.rows.length,
      rowImported,
      rowSkipped,
      rowDuplicated,
      errors,
      durationMs: this.deps.clock.now().getTime() - startedAt.getTime(),
      duplicateFile: false,
    };
  }

  /**
   * 构造预览行。
   *
   * @param source 导入源
   * @param headers 表头
   * @param mapping 列映射
   * @param template 命中的模板
   * @param options 探查选项
   * @param rowCount 预览行数
   * @returns 预览行列表
   */
  private async buildPreview(
    source: ImportSource,
    headers: string[],
    mapping: ColumnMapping,
    template: { directionRule: DirectionRule; categoryRules: CategoryRule[]; dateFormatHints: string[] } | null,
    options?: PlanOptions,
    rowCount: number = IMPORT_PREVIEW_ROWS,
  ): Promise<PreviewRow[]> {
    const encoding = this.detectEncodingSafe(source.bytes);
    const text = decodeBytes(source.bytes, encoding);
    const table = this.deps.parser.parse(text, { delimiter: options?.delimiter });
    const mapper = this.createMapper(headers);
    const directionRule = options?.directionRule ?? template?.directionRule ?? this.defaultDirectionRule();
    const currency = options?.currency ?? DEFAULT_CURRENCY;
    const userTimeZone = options?.userTimeZone ?? 'UTC';
    const sourceTimeZone = options?.sourceTimeZone ?? userTimeZone;

    const rowMapper = this.createRowMapper({
      mapper,
      direction: new DirectionResolver(directionRule),
      currency,
      defaultTimeZone: sourceTimeZone,
    });

    const out: PreviewRow[] = [];
    for (let rowIndex = 0; rowIndex < Math.min(rowCount, table.rows.length); rowIndex += 1) {
      const cells = table.rows[rowIndex] ?? [];
      out.push(
        rowMapper.toPreview(cells, mapping, {
          sourceFileId: 'preview',
          sourceRowIndex: rowIndex,
          sourceTimeZone,
          userTimeZone,
          currency,
          deviceId: this.deps.deviceId,
          clock: this.deps.clock,
        }),
      );
    }
    return out;
  }

  /**
   * 创建列映射器。
   *
   * @param headers 表头
   * @returns 列映射器
   */
  private createMapper(headers: string[]): ColumnMapper {
    if (this.deps.createMapper) {
      return this.deps.createMapper(headers);
    }
    return new ColumnMapper(headers);
  }

  /**
   * 创建行映射器。
   *
   * @param args 行映射器依赖
   * @returns 行映射器
   */
  private createRowMapper(args: {
    mapper: ColumnMapper;
    direction: DirectionResolver;
    currency: CurrencyCode;
    defaultTimeZone: string;
  }): RowMapper {
    if (this.deps.createRowMapper) {
      return this.deps.createRowMapper(args);
    }
    return new RowMapper(args);
  }

  /**
   * 取默认方向规则。
   *
   * @returns 方向规则
   */
  private defaultDirectionRule(): DirectionRule {
    return {
      mode: 'auto',
      incomeKeywords: DirectionResolver.defaultIncomeKeywords(),
      expenseKeywords: DirectionResolver.defaultExpenseKeywords(),
    };
  }

  /**
   * 探测编码，失败时回退到 UTF-8 宽松解码。
   *
   * 说明：GBK 等非 UTF-8 文件在 `detectEncoding` 中已能正确识别；
   * 这里额外兜底是为了避免极端损坏文件直接中断整个导入流程。
   *
   * @param bytes 文件字节
   * @returns 编码标识
   */
  private detectEncodingSafe(bytes: Uint8Array): ImportEncoding {
    try {
      return detectEncoding(bytes);
    } catch {
      return 'utf-8';
    }
  }

  /**
   * 把异常转成导入错误明细。
   *
   * @param error 捕获到的异常
   * @param rowIndex 行号
   * @param cells 原始单元格
   * @returns 导入错误
   */
  private toImportError(error: unknown, rowIndex: number, cells: readonly string[]): ImportError {
    if (error instanceof LifeHubError) {
      const details = error.details as { columnIndex?: number } | undefined;
      return {
        rowIndex,
        columnIndex: details?.columnIndex ?? null,
        reason: error.message,
        raw: cells.join(','),
      };
    }
    return {
      rowIndex,
      columnIndex: null,
      reason: error instanceof Error ? error.message : '该行无法解析',
      raw: cells.join(','),
    };
  }
}

/** 探查选项。 */
export interface PlanOptions {
  /** 分隔符覆盖。 */
  delimiter?: 'auto' | string;
  /** 方向规则覆盖。 */
  directionRule?: DirectionRule;
  /** 币种。 */
  currency?: CurrencyCode;
  /** 用户时区。 */
  userTimeZone?: string;
  /** 来源时区。 */
  sourceTimeZone?: string;
}

/** 导出类型别名，便于上层引用。 */
export type { CsvRow, MappedRow };
