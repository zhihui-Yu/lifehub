/**
 * 列头映射器。
 *
 * 架构位置：core 包「CSV 解析」模块，服务于 A-05（自定义列头映射）与 A-13（模板自动匹配）。
 *
 * 设计要点：
 * - 映射以 **0 基列索引** 存储，**不依赖表头文字**（表头改版不失效）；
 * - `suggest()` 用表头关键词给出建议映射，降低用户手工配置成本；
 * - `buildSignature()` 生成表头签名，用于下次导入时自动匹配规则模板。
 */
import { LifeHubError } from '../errors';
import type { BillField, ColumnMapping } from '../models/rule-template';
import { BILL_FIELDS, REQUIRED_BILL_FIELDS } from '../models/rule-template';
import { sha256Hex } from '../utils/hash';
import type { CryptoProvider } from '../crypto/provider';
import { utf8Encode } from '../utils/bytes';

/** 映射校验结果。 */
export interface MappingValidation {
  /** 是否通过校验。 */
  ok: boolean;
  /** 缺失的必填字段。 */
  missingRequired: BillField[];
  /** 被两个及以上列占用的字段。 */
  duplicatedFields: BillField[];
  /** 中文提示。 */
  message: string;
}

/** 按语义字段抽取出的行数据。 */
export interface MappedRow {
  /** 原始单元格数组。 */
  cells: readonly string[];
  /** 日期列文本。 */
  occurredAt: string;
  /** 金额列文本。 */
  amount: string;
  /** 交易对方列文本。 */
  counterparty: string;
  /** 分类列文本。 */
  category: string;
  /** 方向列文本。 */
  direction: string;
  /** 余额列文本。 */
  balance: string;
  /** 备注列文本。 */
  note: string;
}

/**
 * 表头关键词到语义字段的建议规则表。
 *
 * 说明：按「出现即命中」处理，命中多个时取表中靠前者；
 * 关键词表覆盖微信 / 支付宝 / 主流银行导出的常见表头措辞。
 */
const HEADER_SUGGESTIONS: readonly { field: BillField; keywords: readonly string[] }[] = [
  {
    field: 'occurredAt',
    keywords: [
      '交易时间',
      '记账日期',
      '日期',
      '时间',
      '账单日期',
      '交易日期',
      '创建时间',
      '付款时间',
      '发生时间',
      '交易创建时间',
      'date',
      'time',
      'datetime',
    ],
  },
  {
    field: 'amount',
    keywords: [
      '金额(元)',
      '金额（元）',
      '交易金额',
      '金额',
      '发生额',
      '记账金额',
      '实付金额',
      '收支金额',
      'amount',
      'money',
      'price',
    ],
  },
  {
    field: 'counterparty',
    keywords: [
      '交易对方',
      '对方户名',
      '对方名称',
      '商户名称',
      '商家',
      '商户',
      '交易用途',
      '对方账号',
      '交易方',
      '付款方',
      'counterparty',
      'payee',
      'merchant',
    ],
  },
  {
    field: 'category',
    keywords: ['交易类型', '交易分类', '分类', '类别', '账单分类', '消费类型', 'category'],
  },
  {
    field: 'direction',
    keywords: [
      '收/支',
      '支/收',
      '收支',
      '收支方向',
      '收支类型',
      '收/支类型',
      '交易方向',
      '资金方向',
      '借贷标志',
      '方向',
      'direction',
      'type',
    ],
  },
  {
    field: 'balance',
    keywords: ['账户余额', '余额(元)', '余额（元）', '余额', '可用余额', '本次余额', '交易后余额', 'balance'],
  },
  {
    field: 'note',
    keywords: [
      '备注',
      '商品说明',
      '商品名称',
      '商品',
      '摘要',
      '说明',
      '附言',
      '交易说明',
      '用途/备注',
      '交易备注',
      'note',
      'memo',
      'remark',
      'description',
    ],
  },
];

/** 样本日期特征正则（支持 YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD / YYYY年MM月DD日 / 8 位数字日期）。 */
const SAMPLE_DATE_PATTERN = /^(\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}|\d{8})$/;

/** 样本金额特征正则（支持可选正负号、可选货币符号、千分位及最多两位小数）。 */
const SAMPLE_AMOUNT_PATTERN = /^[+-]?[¥￥$]?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/;

/** 样本方向特征取值集合。 */
const SAMPLE_DIRECTION_VALUES: ReadonlySet<string> = new Set([
  '收入',
  '支出',
  '收',
  '支',
  '/',
  '不计收支',
  '中性交易',
  '借',
  '贷',
  '入',
  '出',
]);

/** 备注为空时可回退读取的候选商品名/摘要表头名。 */
const NOTE_FALLBACK_HEADERS: readonly string[] = ['商品', '商品说明', '商品名称', '摘要'];

/**
 * 判断单元格文本是否为微信/支付宝常见的空占位符（"/" 或 "--"）。
 *
 * @param value 单元格原始文本
 * @returns 是空占位符返回 true
 */
function isPlaceholderCell(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === '/' || trimmed === '--';
}

/** 表头归一化结果。 */
export interface NormalizedTable {
  /** 归一化后的真实表头行。 */
  headers: string[];
  /** 剥离前置说明行后的数据行。 */
  rows: string[][];
}

/**
 * 自动定位真实表头行并剥离前置汇总说明行。
 *
 * 说明：微信支付等导出的 CSV / XLSX 常在前 16~17 行放置汇总说明（如「微信支付账单明细」），
 * 第 18 行才是真正的「交易时间,交易类型,交易对方,商品,收/支,金额(元)...」表头行。
 * 本函数在前 35 行内扫描首个同时命中 `occurredAt` 与 `amount` 的行作为真实表头；
 * 若当前表头已命中或前 35 行均未命中，则原样返回。
 *
 * @param headers 初始首行表头
 * @param rows 初始数据行
 * @returns 归一化后的表头与数据行
 */
export function normalizeTableHeaders(headers: readonly string[], rows: readonly (readonly string[])[]): NormalizedTable {
  const hasCoreFields = (mapping: ColumnMapping): boolean => {
    const fields = new Set(Object.values(mapping));
    return fields.has('occurredAt') && fields.has('amount');
  };

  if (hasCoreFields(new ColumnMapper([...headers]).suggest())) {
    return { headers: [...headers], rows: rows.map((r) => [...r]) };
  }

  const scanLimit = Math.min(rows.length, 35);
  for (let i = 0; i < scanLimit; i += 1) {
    const candidate = (rows[i] ?? []).map((cell) => cell.trim());
    if (hasCoreFields(new ColumnMapper(candidate).suggest())) {
      return {
        headers: candidate,
        rows: rows.slice(i + 1).map((r) => [...r]),
      };
    }
  }

  return { headers: [...headers], rows: rows.map((r) => [...r]) };
}

/**
 * 在样本行中寻找超过半数非空单元格满足谓词的未映射列索引。
 *
 * @param mapping 当前已分配的列映射
 * @param columnCount 总列数
 * @param samples 样本行列表
 * @param predicate 单元格文本判定谓词
 * @returns 命中的 0 基列索引；未命中返回 -1
 */
function inferColumnBySamples(
  mapping: ColumnMapping,
  columnCount: number,
  samples: readonly (readonly string[])[],
  predicate: (value: string) => boolean,
): number {
  for (let colIdx = 0; colIdx < columnCount; colIdx += 1) {
    if (mapping[colIdx] !== undefined) {
      continue;
    }
    let nonEmpty = 0;
    let matched = 0;
    for (const row of samples) {
      const cell = (row[colIdx] ?? '').trim();
      if (cell !== '') {
        nonEmpty += 1;
        if (predicate(cell)) {
          matched += 1;
        }
      }
    }
    if (nonEmpty > 0 && matched > nonEmpty / 2) {
      return colIdx;
    }
  }
  return -1;
}

/**
 * 列头映射器。
 *
 * 说明：持有一份表头数组，用于建议、校验与签名计算。
 */
export class ColumnMapper {
  /** 表头单元格。 */
  private readonly columns: string[];

  /**
   * 构造列头映射器。
   *
   * @param columns 表头单元格数组
   */
  constructor(columns: string[]) {
    this.columns = [...columns];
  }

  /**
   * 取当前表头。
   *
   * @returns 表头单元格数组副本
   */
  getColumns(): string[] {
    return [...this.columns];
  }

  /**
   * 根据表头关键词与可选样本数据特征自动建议列映射。
   *
   * 说明：同一语义字段只绑定第一个命中的列，避免重复映射；
   * 若表头未能识别出日期、金额或收支方向且提供了样本行，则按单元格数据特征兜底推断。
   *
   * @param sampleRows 可选的前若干行数据样本，用于数据特征推断
   * @returns 建议的列映射（0 基列索引 → 语义字段）
   */
  suggest(sampleRows?: readonly (readonly string[])[]): ColumnMapping {
    const mapping: ColumnMapping = {};
    const used = new Set<BillField>();
    for (const suggestion of HEADER_SUGGESTIONS) {
      for (let index = 0; index < this.columns.length; index += 1) {
        if (used.has(suggestion.field) || mapping[index] !== undefined) {
          continue;
        }
        const header = (this.columns[index] ?? '').trim().toLowerCase();
        if (header === '') {
          continue;
        }
        const hit = suggestion.keywords.some((keyword) => header.includes(keyword.toLowerCase()));
        if (hit) {
          mapping[index] = suggestion.field;
          used.add(suggestion.field);
          break;
        }
      }
    }

    if (sampleRows && sampleRows.length > 0) {
      const samples = sampleRows.slice(0, 10);
      if (!used.has('occurredAt')) {
        const colIdx = inferColumnBySamples(mapping, this.columns.length, samples, (val) =>
          SAMPLE_DATE_PATTERN.test(val),
        );
        if (colIdx >= 0) {
          mapping[colIdx] = 'occurredAt';
          used.add('occurredAt');
        }
      }
      if (!used.has('amount')) {
        const colIdx = inferColumnBySamples(
          mapping,
          this.columns.length,
          samples,
          (val) => SAMPLE_AMOUNT_PATTERN.test(val) && !/^\d{8}$/.test(val),
        );
        if (colIdx >= 0) {
          mapping[colIdx] = 'amount';
          used.add('amount');
        }
      }
      if (!used.has('direction')) {
        const colIdx = inferColumnBySamples(mapping, this.columns.length, samples, (val) =>
          SAMPLE_DIRECTION_VALUES.has(val),
        );
        if (colIdx >= 0) {
          mapping[colIdx] = 'direction';
          used.add('direction');
        }
      }
    }

    return mapping;
  }

  /**
   * 校验映射完整性。
   *
   * @param mapping 待校验的列映射
   * @returns 校验结果（必填缺失 / 字段重复 / 中文提示）
   */
  validate(mapping: ColumnMapping): MappingValidation {
    const assigned = new Map<BillField, number[]>();
    for (const [indexText, field] of Object.entries(mapping)) {
      if (!(BILL_FIELDS as readonly string[]).includes(field)) {
        continue;
      }
      const index = Number.parseInt(indexText, 10);
      const list = assigned.get(field) ?? [];
      list.push(index);
      assigned.set(field, list);
    }

    const missingRequired = REQUIRED_BILL_FIELDS.filter((field) => !assigned.has(field));
    const duplicatedFields = [...assigned.entries()]
      .filter(([, indexes]) => indexes.length > 1)
      .map(([field]) => field);

    if (missingRequired.length > 0 || duplicatedFields.length > 0) {
      const messages: string[] = [];
      if (missingRequired.length > 0) {
        const names = missingRequired.map((field) => FIELD_LABELS[field] ?? field);
        // 固定文案口径：「请先映射『日期』和『金额』两列」。
        messages.push(`请先映射${names.map((name) => `『${name}』`).join('和')}两列`);
      }
      if (duplicatedFields.length > 0) {
        const names = duplicatedFields.map((field) => FIELD_LABELS[field] ?? field);
        messages.push(`同一字段不能映射到多列（${names.join('、')}）`);
      }
      return {
        ok: false,
        missingRequired: [...missingRequired],
        duplicatedFields,
        message: messages.join('；'),
      };
    }

    return { ok: true, missingRequired: [], duplicatedFields: [], message: '映射完整，可以导入' };
  }

  /**
   * 按映射抽取一行中的语义字段。
   *
   * @param row 原始单元格数组
   * @param mapping 列映射
   * @returns 抽取后的语义字段
   */
  mapRow(row: readonly string[], mapping: ColumnMapping): MappedRow {
    const result: MappedRow = {
      cells: row,
      occurredAt: '',
      amount: '',
      counterparty: '',
      category: '',
      direction: '',
      balance: '',
      note: '',
    };
    for (const [indexText, field] of Object.entries(mapping)) {
      const index = Number.parseInt(indexText, 10);
      const value = row[index] ?? '';
      switch (field) {
        case 'occurredAt':
          result.occurredAt = value;
          break;
        case 'amount':
          result.amount = value;
          break;
        case 'counterparty':
          result.counterparty = value;
          break;
        case 'category':
          result.category = value;
          break;
        case 'direction':
          result.direction = value;
          break;
        case 'balance':
          result.balance = value;
          break;
        case 'note':
          result.note = value;
          break;
        case 'ignore':
          break;
        default:
          break;
      }
    }
    if (isPlaceholderCell(result.counterparty)) {
      result.counterparty = '';
    }
    if (isPlaceholderCell(result.category)) {
      result.category = '';
    }
    if (isPlaceholderCell(result.note)) {
      result.note = '';
    }
    const hasNoteMapped = Object.values(mapping).includes('note');
    if (hasNoteMapped && result.note.trim() === '') {
      for (let i = 0; i < this.columns.length; i += 1) {
        if (mapping[i] !== undefined) {
          continue;
        }
        const header = (this.columns[i] ?? '').trim().toLowerCase();
        if (NOTE_FALLBACK_HEADERS.includes(header)) {
          const candidate = (row[i] ?? '').trim();
          if (candidate !== '' && !isPlaceholderCell(candidate)) {
            result.note = candidate;
            break;
          }
        }
      }
    }
    return result;
  }

  /**
   * 计算表头签名。
   *
   * 说明：先归一化（去空白、转小写、用 '|' 连接）再取 sha256，
   * 这样「交易时间,金额」与「交易时间 , 金额 」会得到同一个签名，
   * 容忍导出工具的空格差异。
   *
   * @param headers 表头单元格
   * @param provider 密码学能力端口（用于 sha256）
   * @returns 表头签名的 hex 字符串
   */
  async buildSignature(headers: readonly string[], provider: CryptoProvider): Promise<string> {
    const normalized = headers.map((header) => header.trim().toLowerCase()).join('|');
    return sha256Hex(provider, utf8Encode(normalized));
  }

  /**
   * 断言映射合法，失败时抛出中文异常。
   *
   * @param mapping 待校验的列映射
   * @returns 无异常
   * @throws {LifeHubError} `LIFEHUB_E_MAPPING_INCOMPLETE` —— 必填字段缺失；`LIFEHUB_E_MAPPING_CONFLICT` —— 字段重复
   */
  assertValid(mapping: ColumnMapping): void {
    const result = this.validate(mapping);
    if (!result.ok) {
      if (result.duplicatedFields.length > 0) {
        throw new LifeHubError('LIFEHUB_E_MAPPING_CONFLICT', result.message);
      }
      throw new LifeHubError('LIFEHUB_E_MAPPING_INCOMPLETE', result.message);
    }
  }
}

/** 语义字段的中文标签（用于提示文案）。 */
const FIELD_LABELS: Record<BillField, string> = {
  occurredAt: '日期',
  amount: '金额',
  counterparty: '交易对方',
  category: '分类',
  direction: '收支方向',
  balance: '余额',
  note: '备注',
  ignore: '忽略',
};
