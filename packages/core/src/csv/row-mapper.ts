/**
 * 行映射器：把一行 CSV 单元格转成 Bill 实体或预览行。
 *
 * 架构位置：core 包「CSV 解析」模块，服务于 A-05 ④（映射预览）与 A-11 ①（坏行不中断）。
 *
 * 错误处理：任一必填字段非法时抛 `ParseRowError`，
 * 异常携带 `rowIndex` / `columnIndex` / `reason` / `raw`，供 UI 展示「跳过明细」。
 */
import { LifeHubError } from '../errors';
import type { Bill, Direction } from '../models/bill';
import type { ColumnMapping } from '../models/rule-template';
import { CurrencyCode, DEFAULT_CURRENCY } from '../money/currency';
import { parseAmountToMinor } from '../money/amount';
import { parseFlexibleDate } from '../time/datetime';
import type { Clock } from '../types/common';
import { uuidV7 } from '../utils/id';
import type { ColumnMapper, MappedRow } from './column-mapper';
import type { DirectionResolver } from './direction';

/** 行解析错误。 */
export class ParseRowError extends LifeHubError {
  /** 出错的行号（0 基，不含表头）。 */
  readonly rowIndex: number;
  /** 出错的列索引；无法定位时为 null。 */
  readonly columnIndex: number | null;
  /** 出错行的原始文本。 */
  readonly raw: string;

  /**
   * 构造行解析错误。
   *
   * @param rowIndex 行号
   * @param columnIndex 列索引
   * @param reason 中文原因
   * @param raw 原始行文本
   */
  constructor(rowIndex: number, columnIndex: number | null, reason: string, raw: string) {
    super('LIFEHUB_E_IMPORT_ROW', reason, { rowIndex, columnIndex });
    this.name = 'ParseRowError';
    this.rowIndex = rowIndex;
    this.columnIndex = columnIndex;
    this.raw = raw;
  }
}

/** 行映射上下文。 */
export interface RowContext {
  /** 来源文件（导入批次）id。 */
  sourceFileId: string;
  /** 源文件内的 0 基行号。 */
  sourceRowIndex: number;
  /** 来源时区。 */
  sourceTimeZone: string;
  /** 用户时区（决定 localDate）。 */
  userTimeZone: string;
  /** 币种。 */
  currency: CurrencyCode;
  /** 设备 id。 */
  deviceId: string;
  /** 时钟端口。 */
  clock: Clock;
}

/** 预览行：用于映射页实时预览，不含 id 与版本号。 */
export interface PreviewRow {
  /** 行号。 */
  rowIndex: number;
  /** 解析出的日期。 */
  occurredAt: string;
  /** 本地日历日。 */
  localDate: string;
  /** 金额（整数分）。 */
  amountMinor: number;
  /** 收支方向；无法判定时为 null。 */
  direction: Direction | null;
  /** 交易对方。 */
  counterparty: string;
  /** 备注。 */
  note: string;
  /** 原始行文本。 */
  raw: string;
  /** 解析失败时的中文原因；成功时为 null。 */
  error: string | null;
}

/**
 * 行映射器。
 */
export class RowMapper {
  /** 方向推断器。 */
  private readonly direction: DirectionResolver;
  /** 列映射器。 */
  private readonly mapper: ColumnMapper;
  /** 默认币种。 */
  private readonly currency: CurrencyCode;
  /** 默认来源时区。 */
  private readonly defaultTimeZone: string;

  /**
   * 构造行映射器。
   *
   * @param deps 依赖集合
   */
  constructor(deps: {
    direction: DirectionResolver;
    mapper: ColumnMapper;
    currency: CurrencyCode;
    defaultTimeZone: string;
  }) {
    this.direction = deps.direction;
    this.mapper = deps.mapper;
    this.currency = deps.currency;
    this.defaultTimeZone = deps.defaultTimeZone;
  }

  /**
   * 把一行单元格转成 Bill 实体。
   *
   * @param row 原始单元格数组
   * @param mapping 列映射
   * @param ctx 行上下文
   * @returns Bill 实体
   * @throws {ParseRowError} 任一必填字段非法
   */
  toBill(row: readonly string[], mapping: ColumnMapping, ctx: RowContext): Bill {
    const mapped = this.mapper.mapRow(row, mapping);
    const raw = row.join(',');

    if (mapped.amount.trim() === '') {
      throw new ParseRowError(ctx.sourceRowIndex, this.findColumn(mapping, 'amount'), '金额为空', raw);
    }
    if (mapped.occurredAt.trim() === '') {
      throw new ParseRowError(ctx.sourceRowIndex, this.findColumn(mapping, 'occurredAt'), '日期为空', raw);
    }

    // 金额：一律解析为整数分，且取绝对值——方向由 direction 表达（PRD Q8 裁决）。
    // 必须允许负号：CSV 里带负号的金额（如银行导出的 '-35.00'）本身就是**方向证据**，
    // 若在这里被判非法，整行会被跳过，PRD A-06 ①「金额正负号」策略就形同虚设。
    // 负号的识别口径与方向推断共用 `normalizeAmountText()`，两处不会漂移。
    let amountMinor: number;
    try {
      amountMinor = Math.abs(
        parseAmountToMinor(mapped.amount, { currency: ctx.currency, allowNegative: true }),
      );
    } catch {
      throw new ParseRowError(ctx.sourceRowIndex, this.findColumn(mapping, 'amount'), '金额无法解析为数字', raw);
    }

    // 日期：解析为 UTC 时间戳 + 用户本地日历日。
    let occurredAt: string;
    let localDate: string;
    let sourceTimeZone: string;
    try {
      const parsed = parseFlexibleDate(mapped.occurredAt, {
        timeZone: ctx.userTimeZone,
        sourceTimeZone: ctx.sourceTimeZone || this.defaultTimeZone,
      });
      occurredAt = parsed.occurredAt;
      localDate = parsed.localDate;
      sourceTimeZone = parsed.sourceTimeZone;
    } catch {
      throw new ParseRowError(ctx.sourceRowIndex, this.findColumn(mapping, 'occurredAt'), '日期格式无法识别', raw);
    }

    // 方向：无法判定时该行跳过并记录原因（PRD A-06 ②）。
    const directionResult = this.direction.resolve(mapped);
    if (directionResult.direction === null) {
      throw new ParseRowError(
        ctx.sourceRowIndex,
        this.findColumn(mapping, 'direction'),
        `无法判断收支方向：${directionResult.reason}`,
        raw,
      );
    }

    const now = ctx.clock.nowIso();
    return {
      id: uuidV7(),
      amountMinor,
      currency: ctx.currency,
      direction: directionResult.direction,
      occurredAt,
      localDate,
      sourceTimeZone,
      counterparty: mapped.counterparty.trim(),
      categoryId: null,
      note: mapped.note.trim(),
      sourceFileId: ctx.sourceFileId,
      sourceRowIndex: ctx.sourceRowIndex,
      createdAt: now,
      updatedAt: now,
      version: 1,
      deviceId: ctx.deviceId,
    };
  }

  /**
   * 把一行单元格转成预览行（映射页实时预览）。
   *
   * 说明：与 `toBill` 共用解析逻辑，但**不抛异常**——
   * 预览需要把错误显示在表格里，而不是中断整个预览（A-05 ④）。
   *
   * @param row 原始单元格数组
   * @param mapping 列映射
   * @param ctx 行上下文
   * @returns 预览行
   */
  toPreview(row: readonly string[], mapping: ColumnMapping, ctx: RowContext): PreviewRow {
    const raw = row.join(',');
    try {
      const bill = this.toBill(row, mapping, ctx);
      return {
        rowIndex: ctx.sourceRowIndex,
        occurredAt: bill.occurredAt,
        localDate: bill.localDate,
        amountMinor: bill.amountMinor,
        direction: bill.direction,
        counterparty: bill.counterparty,
        note: bill.note,
        raw,
        error: null,
      };
    } catch (error) {
      const reason = error instanceof LifeHubError ? error.message : '该行无法解析';
      return {
        rowIndex: ctx.sourceRowIndex,
        occurredAt: '',
        localDate: '',
        amountMinor: 0,
        direction: null,
        counterparty: '',
        note: '',
        raw,
        error: reason,
      };
    }
  }

  /**
   * 找出某个语义字段对应的列索引。
   *
   * @param mapping 列映射
   * @param field 语义字段
   * @returns 列索引；未映射返回 null
   */
  private findColumn(mapping: ColumnMapping, field: string): number | null {
    for (const [indexText, mappedField] of Object.entries(mapping)) {
      if (mappedField === field) {
        return Number.parseInt(indexText, 10);
      }
    }
    return null;
  }
}
