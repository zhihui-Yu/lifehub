/**
 * 导入服务：多格式文件 → 映射 → 方向推断 → 清洗去重 → 分批落库。
 *
 * 架构位置：core 包「服务」层，是 A-04 / A-05 / A-06 / A-11 / A-12 / A-21 / A-25 的编排中心。
 *
 * 两阶段设计（系统设计 §4.2 关键点 1）：
 * 1. `plan()`：只读探查（哈希、编码、表头、签名、模板匹配、建议映射、前 10 行预览、
 *    跨来源重复候选），**不落库**；
 * 2. `run()`：用户确认映射后执行真正的流式导入。
 *
 * 性能（NF-P-1）：整个过程**单次流式遍历**，每 1000 条一批落库，10 万行不整表驻留内存。
 *
 * 多格式（A-25）：`ImportSource` 可携带三种内容之一——
 * - 二进制 `bytes`（CSV / TSV 等分隔符文本，按编码解码后解析）；
 * - 已抽取的 `table`（XLSX / 网页表格等，由上层在浏览器里抽好再传入，core 保持零 DOM）；
 * - PDF 的 `text`（PDF 文本层已抽取成行文本，由 `parseBankStatementText` 规整成二维表）。
 *
 * 跨来源去重（A-21 / 用户需求）：同一笔「用微信 / 支付宝绑定银行卡付款」的交易会同时出现在
 * 微信 / 支付宝导出与银行流水里。当一条新账单的「日期 + 金额 + 方向」与一条**不同渠道**
 * （一端微信 / 支付宝、另一端银行）的既有账单吻合时，判为跨来源重复，默认跳过并计入
 * `rowCrossSourceDuplicate`，由用户在映射页确认（非静默丢弃）。
 */
import { IMPORT_BATCH_SIZE, IMPORT_PREVIEW_ROWS } from '../constants';
import { LifeHubError } from '../errors';
import type { CryptoProvider } from '../crypto/provider';
import { ColumnMapper, normalizeTableHeaders } from '../csv/column-mapper';
import type { MappedRow } from '../csv/column-mapper';
import { decodeBytes, detectEncoding } from '../csv/encoding';
import { CsvParser } from '../csv/parser';
import type { CsvRow } from '../csv/parser';
import { DirectionResolver } from '../csv/direction';
import { RowMapper } from '../csv/row-mapper';
import type { PreviewRow, RowContext } from '../csv/row-mapper';
import type { Bill, Direction } from '../models/bill';
import type { ImportBatch, ImportEncoding, ImportError, ImportSummary } from '../models/import-batch';
import type { CategoryRule, ColumnMapping, DirectionRule } from '../models/rule-template';
import type { SourceChannel } from '../models/source-channel';
import { classifySourceChannel } from '../models/source-channel';
import { CurrencyCode, DEFAULT_CURRENCY } from '../money/currency';
import { CategoryRuleEngine } from '../rules/category-rule';
import { Deduplicator } from '../rules/dedupe';
import { computeFileHash } from '../rules/fingerprint';
import { inferSystemCategoryName } from '../rules/transfer-detector';
import {
  USER_CATEGORY_MEMORY_SIGNATURE,
  USER_CATEGORY_MEMORY_TEMPLATE_ID,
  extractBillItemKey,
  normalizeCategoryName,
} from '../models/category';
import { BillRepository } from '../repositories/bill-repository';
import type { CategoryRepository } from '../repositories/category-repository';
import { ImportBatchRepository } from '../repositories/import-batch-repository';
import { RuleTemplateRepository } from '../repositories/rule-template-repository';
import type { Clock } from '../types/common';
import { uuidV7 } from '../utils/id';
import type { AuditLogger } from './audit-logger';
import { parseBankStatementText } from '../import/bank-statement';
import type { RawTable } from '../import/raw-table';

/** 导入源。 */
export interface ImportSource {
  /** 文件名。 */
  fileName: string;
  /** 文件字节数。 */
  sizeBytes: number;
  /** 文件字节内容（CSV / TSV 等分隔符文本）。 */
  bytes: Uint8Array;
  /** 文件格式提示；省略时按字节魔数 / 扩展名推断。 */
  format?: 'csv' | 'xlsx' | 'pdf';
  /** 已由上层（浏览器）抽好的规整二维表（XLSX / 网页表格等）。 */
  table?: RawTable;
  /** PDF 文本层已抽取的行文本（与 `format: 'pdf'` 配套）。 */
  text?: string;
}

/** 探查得到的跨来源重复候选。 */
export interface CrossSourceCandidate {
  /** 候选在预览里的行号（0 基，不含表头）。 */
  rowIndex: number;
  /** 本地日历日。 */
  localDate: string;
  /** 金额（整数分）。 */
  amountMinor: number;
  /** 收支方向。 */
  direction: Direction;
  /** 命中既有的来源渠道。 */
  existingChannel: SourceChannel;
}

/** 导入探查计划。 */
export interface ImportPlan {
  /** 文件 sha256 hex。 */
  fileHash: string;
  /** 文件编码。 */
  encoding: ImportEncoding;
  /** 表头单元格。 */
  headers: string[];
  /** 实际分隔符（非分隔符来源为空串）。 */
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
  /** 推断出的来源渠道。 */
  sourceChannel: SourceChannel;
  /** 跨来源重复候选（微信 / 支付宝 与 银行卡 可能为同一笔）。 */
  crossSourceCandidates: CrossSourceCandidate[];
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
  /** 重新导入同一文件时是否先覆盖清理该文件此前导入的旧批次与旧账单。 */
  overwriteExisting?: boolean;
  /** 来源渠道；省略时按文件名字推断。 */
  sourceChannel?: SourceChannel;
  /** 是否跳过跨来源重复（默认 true）。 */
  skipCrossSourceDuplicates?: boolean;
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
  /** 分类仓储（可选；提供时自动初始化系统预置分类并在无自定义规则命中时执行智能归类）。 */
  categories?: CategoryRepository;
  /** 审计日志服务。 */
  audit: AuditLogger;
  /** 时钟端口。 */
  clock: Clock;
  /** 设备 id。 */
  deviceId: string;
}

/** 跨来源去重命中的渠道组合：一端为微信 / 支付宝、另一端为银行。 */
const PAYMENT_CHANNELS: ReadonlySet<SourceChannel> = new Set<SourceChannel>(['wechat', 'alipay']);

/**
 * 判断两条账单是否构成「跨来源重复」组合。
 *
 * 说明：只有「一端是微信 / 支付宝、另一端是银行」才判为跨来源重复，
 * 这正好对应「用微信 / 支付宝绑定银行卡付款」的真实场景；
 * 同渠道之间的重复交给内容级指纹（含对方户名）去重，避免误杀。
 *
 * @param a 第一条账单的来源渠道
 * @param b 第二条账单的来源渠道
 * @returns 构成跨来源重复组合返回 true
 */
function isCrossSourcePair(a: SourceChannel, b: SourceChannel): boolean {
  return (PAYMENT_CHANNELS.has(a) && b === 'bank') || (PAYMENT_CHANNELS.has(b) && a === 'bank');
}

/**
 * 计算一条账单的跨来源去重键（不含对方户名，只用日期 + 金额 + 方向 + 币种）。
 *
 * @param bill 账单实体
 * @returns 跨来源去重键
 */
function crossSourceKey(bill: Bill): string {
  return [bill.localDate, bill.amountMinor, bill.direction, bill.currency].join('|');
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
   * 只读探查：哈希、编码、表头、签名、模板匹配、建议映射、前 10 行预览、跨来源重复候选。**不落库**。
   *
   * @param source 导入源
   * @param options 探查选项
   * @returns 导入计划
   * @throws {LifeHubError} `LIFEHUB_E_CSV_ENCODING` —— 编码无法识别；`LIFEHUB_E_CSV_PARSE` —— 语法异常
   */
  async plan(source: ImportSource, options?: PlanOptions): Promise<ImportPlan> {
    const fileHash = await computeFileHash(this.deps.provider, source.bytes);
    const { table, encoding, delimiter } = this.resolveTable(source, options);

    const mapper = this.createMapper(table.headers);
    const fileSignature = await mapper.buildSignature(table.headers, this.deps.provider);
    const template = await this.deps.templates.findBySignature(fileSignature);
    const suggestedMapping = template ? { ...template.columnMapping } : mapper.suggest(table.rows.slice(0, 10));

    const allBatches = await this.deps.batches.list();
    const duplicate = allBatches.find((batch) => batch.fileHash === fileHash) ?? null;

    const preview = await this.buildPreview(source, table.headers, suggestedMapping, template, options);

    const sourceChannel = options?.sourceChannel ?? classifySourceChannel(source.fileName);
    const crossSourceCandidates = await this.detectCrossSourceCandidates(sourceChannel, preview, allBatches);

    return {
      fileHash,
      encoding,
      headers: table.headers,
      delimiter,
      rowCount: table.rows.length,
      fileSignature,
      suggestedMapping,
      matchedTemplateId: template?.id ?? null,
      matchedTemplateName: template?.name ?? null,
      preview,
      duplicateFile: duplicate !== null,
      duplicateOf: duplicate?.createdAt ?? null,
      sourceChannel,
      crossSourceCandidates,
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
    const { table } = this.resolveTable(source, options);
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
    const existingBatch = await this.deps.batches.findByFileHash(fileHash);
    if (existingBatch && !options.allowDuplicate && !options.overwriteExisting) {
      const summary: ImportSummary = {
        batchId: existingBatch.id,
        rowTotal: existingBatch.rowTotal,
        rowImported: 0,
        rowSkipped: existingBatch.rowTotal,
        rowDuplicated: existingBatch.rowTotal,
        rowCrossSourceDuplicate: 0,
        errors: [],
        durationMs: this.deps.clock.now().getTime() - startedAt.getTime(),
        duplicateFile: true,
      };
      await this.deps.audit.log('import', source.fileName, false);
      return summary;
    }

    // 覆盖重导：当调用方显式指定 overwriteExisting 时，先清理同名哈希旧批次及关联账单，再全量重新导入。
    if (existingBatch && options.overwriteExisting) {
      const batches = await this.deps.batches.list();
      for (const batch of batches) {
        if (batch.fileHash === fileHash) {
          await this.deps.bills.deleteBySourceFileId(batch.id);
          await this.deps.batches.delete(batch.id);
        }
      }
    }

    const { table, encoding } = this.resolveTable(source, options);

    const mapper = this.createMapper(table.headers);
    mapper.assertValid(mapping);

    const template = options.templateId
      ? await this.deps.templates.getById(options.templateId)
      : await this.deps.templates.findBySignature(
          await mapper.buildSignature(table.headers, this.deps.provider),
        );
    const memoryTemplate =
      (await this.deps.templates.getById(USER_CATEGORY_MEMORY_TEMPLATE_ID)) ??
      (await this.deps.templates.findBySignature(USER_CATEGORY_MEMORY_SIGNATURE));

    const directionRule = options.directionRule ?? template?.directionRule ?? this.defaultDirectionRule();
    const baseCategoryRules = options.categoryRules ?? template?.categoryRules ?? [];
    const categoryRules = [...(memoryTemplate?.categoryRules ?? []), ...baseCategoryRules];
    const ruleEngine = new CategoryRuleEngine(categoryRules);
    const currency = options.currency ?? DEFAULT_CURRENCY;
    const userTimeZone = options.userTimeZone ?? 'UTC';
    const sourceTimeZone = options.sourceTimeZone ?? userTimeZone;

    // 自动确保 7 大标准系统分类与「内部转账」分类已落库，并构建名称 → ID 查找表供智能归类使用。
    const categoryIdByName = new Map<string, string>();
    if (this.deps.categories) {
      const ensured = await this.deps.categories.ensureSystemCategories(
        this.deps.clock,
        this.deps.deviceId,
      );
      for (const cat of ensured) {
        categoryIdByName.set(normalizeCategoryName(cat.name), cat.id);
      }
    }
    const categoryColEntry = Object.entries(mapping).find(([, field]) => field === 'category');
    const categoryColIndex =
      categoryColEntry !== undefined ? Number(categoryColEntry[0]) : undefined;

    const rowMapper = this.createRowMapper({
      mapper,
      direction: new DirectionResolver(directionRule),
      currency,
      defaultTimeZone: sourceTimeZone,
    });

    const deduper = new Deduplicator();
    const existingBills = await this.deps.bills.list();
    const existingFingerprints = new Set<string>(existingBills.map((bill) => deduper.computeFingerprint(bill)));
    const batchFingerprints = new Set<string>();

    // 历史相同项分类记忆索引：按 updatedAt 降序遍历已分类历史账单，记住相同交易对方/备注对应的最新分类 ID。
    const historicalCategoryMemory = new Map<string, string>();
    const categorizedHistory = existingBills
      .filter((bill): bill is Bill & { categoryId: string } => typeof bill.categoryId === 'string' && bill.categoryId !== '')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    for (const historicalBill of categorizedHistory) {
      const key = extractBillItemKey(historicalBill);
      if (key !== '' && !historicalCategoryMemory.has(key)) {
        historicalCategoryMemory.set(key, historicalBill.categoryId);
      }
    }

    // 跨来源去重：把既有账单按「日期 | 金额 | 方向 | 币种」归并到各自渠道。
    const allBatches = await this.deps.batches.list();
    const channelByFileId = new Map<string, SourceChannel>(
      allBatches.map((batch) => [batch.id, batch.sourceChannel]),
    );
    const existingCross = new Map<string, SourceChannel[]>();
    for (const bill of existingBills) {
      const channel = channelByFileId.get(bill.sourceFileId) ?? 'other';
      const key = crossSourceKey(bill);
      existingCross.set(key, [...(existingCross.get(key) ?? []), channel]);
    }
    const currentChannel = options.sourceChannel ?? classifySourceChannel(source.fileName);

    const batchId = uuidV7();
    const errors: ImportError[] = [];
    let rowImported = 0;
    let rowSkipped = 0;
    let rowDuplicated = 0;
    let rowCrossSourceDuplicate = 0;
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
        const intraBatchKey = `${deduper.computeFingerprint(bill)}|${bill.occurredAt}|${bill.note.trim()}`;
        // 内容级去重（A-12 ①）：跨批次按指纹去重；同批次内仅当时间戳与备注也完全一致时才判为重复行（保留同一天同商户不同时间的多笔真实消费）。
        if (deduper.isDuplicate(bill, existingFingerprints) || batchFingerprints.has(intraBatchKey)) {
          rowDuplicated += 1;
          rowSkipped += 1;
          continue;
        }
        // 跨来源去重：与「另一渠道（一端微信/支付宝、一端银行）」的既有账单吻合时跳过。
        if (options.skipCrossSourceDuplicates !== false) {
          const hit = (existingCross.get(crossSourceKey(bill)) ?? []).find((channel) =>
            isCrossSourcePair(currentChannel, channel),
          );
          if (hit) {
            rowCrossSourceDuplicate += 1;
            rowSkipped += 1;
            continue;
          }
        }
        const itemKey = extractBillItemKey(bill);
        let categoryId = ruleEngine.matchAny([itemKey, bill.counterparty, bill.note]);
        if (categoryId === null && itemKey !== '') {
          categoryId = historicalCategoryMemory.get(itemKey) ?? null;
        }
        if (categoryId === null && categoryIdByName.size > 0) {
          const rawCategory =
            categoryColIndex !== undefined && Number.isInteger(categoryColIndex)
              ? (cells[categoryColIndex] ?? '').trim()
              : '';
          const inferredName = inferSystemCategoryName({
            counterparty: bill.counterparty,
            note: bill.note,
            direction: bill.direction,
            rawCategory,
          });
          if (inferredName) {
            categoryId = categoryIdByName.get(normalizeCategoryName(inferredName)) ?? null;
          }
        }
        if (categoryId !== null && itemKey !== '' && !historicalCategoryMemory.has(itemKey)) {
          historicalCategoryMemory.set(itemKey, categoryId);
        }
        const finalBill: Bill = categoryId === null ? bill : { ...bill, categoryId };
        batchFingerprints.add(intraBatchKey);
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
      sourceChannel: currentChannel,
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
      rowCrossSourceDuplicate,
      errors,
      durationMs: this.deps.clock.now().getTime() - startedAt.getTime(),
      duplicateFile: false,
    };
  }

  /**
   * 按导入批次 ID 删除该批次及关联的全部账单记录。
   *
   * 说明：先删除 `sourceFileId === batchId` 的全部账单，再移除 `ImportBatch` 元数据记录，
   * 使该文件后续再次导入时不再被判定为重复文件。
   *
   * @param batchId 导入批次 ID
   * @returns 实际删除的账单条数统计
   * @throws {LifeHubError} `LIFEHUB_E_STORAGE` —— 底层加密存储删除失败时抛出
   */
  async deleteBatch(batchId: string): Promise<{ deletedBills: number }> {
    const deletedBills = await this.deps.bills.deleteBySourceFileId(batchId);
    await this.deps.batches.delete(batchId);
    return { deletedBills };
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
    const { table } = this.resolveTable(source, options);
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
   * 把任意来源解析为规整二维表。
   *
   * 说明：按优先级处理三种内容——已抽取的 `table` 直接使用；PDF 的 `text` 经
   * `parseBankStatementText` 规整；其余（含仅给 `bytes` 的分隔符文本）按编码解码后用 CSV 解析器处理。
   *
   * @param source 导入源
   * @param options 探查选项（仅分隔符文本路径用得到）
   * @returns 规整二维表、编码与分隔符
   */
  private resolveTable(
    source: ImportSource,
    options?: PlanOptions,
  ): { table: RawTable; encoding: ImportEncoding; delimiter: string } {
    if (source.table) {
      const normalized = normalizeTableHeaders(source.table.headers, source.table.rows);
      return { table: normalized, encoding: 'utf-8', delimiter: '' };
    }
    if (source.format === 'pdf' && source.text) {
      return { table: parseBankStatementText(splitLines(source.text)), encoding: 'utf-8', delimiter: '' };
    }
    const encoding = this.detectEncodingSafe(source.bytes);
    const text = decodeBytes(source.bytes, encoding);
    const parsed = this.deps.parser.parse(text, { delimiter: options?.delimiter });
    const normalized = normalizeTableHeaders(parsed.headers, parsed.rows);
    return {
      table: { headers: normalized.headers, rows: normalized.rows },
      encoding,
      delimiter: parsed.delimiter,
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
   * 检测跨来源重复候选：把预览行与既有账单按「日期 + 金额 + 方向」比对，
   * 仅当命中「一端微信 / 支付宝、另一端银行」时计入。
   *
   * @param sourceChannel 本次导入的来源渠道
   * @param preview 前 N 行预览
   * @param allBatches 全部既有导入批次（用于渠道映射）
   * @returns 跨来源重复候选列表（最多 50 条）
   */
  private async detectCrossSourceCandidates(
    sourceChannel: SourceChannel,
    preview: PreviewRow[],
    allBatches: ImportBatch[],
  ): Promise<CrossSourceCandidate[]> {
    const channelByFileId = new Map<string, SourceChannel>(
      allBatches.map((batch) => [batch.id, batch.sourceChannel]),
    );
    const existingBills = await this.deps.bills.list();
    const existingCross = new Map<string, SourceChannel[]>();
    for (const bill of existingBills) {
      const channel = channelByFileId.get(bill.sourceFileId) ?? 'other';
      const key = crossSourceKey(bill);
      existingCross.set(key, [...(existingCross.get(key) ?? []), channel]);
    }

    const candidates: CrossSourceCandidate[] = [];
    for (const row of preview) {
      if (row.error !== null || row.direction === null) {
        continue;
      }
      const key = [row.localDate, row.amountMinor, row.direction, DEFAULT_CURRENCY].join('|');
      const hit = (existingCross.get(key) ?? []).find((channel) => isCrossSourcePair(sourceChannel, channel));
      if (hit) {
        candidates.push({
          rowIndex: row.rowIndex,
          localDate: row.localDate,
          amountMinor: row.amountMinor,
          direction: row.direction,
          existingChannel: hit,
        });
      }
      if (candidates.length >= 50) {
        break;
      }
    }
    return candidates;
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
  /** 来源渠道；省略时按文件名字推断。 */
  sourceChannel?: SourceChannel;
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

/**
 * 把多余文本切成行（兼容 `\r\n` / `\n` / `\r`）。
 *
 * @param text 待切分的文本
 * @returns 行数组
 */
function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/** 导出类型别名，便于上层引用。 */
export type { CsvRow, MappedRow, RawTable };
