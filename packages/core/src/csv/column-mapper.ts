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
    keywords: ['交易时间', '交易日期', '记账日期', '日期', '时间', 'date', 'time', '交易创建时间'],
  },
  { field: 'amount', keywords: ['金额', '发生额', '交易金额', 'amount', '金额(元)', '收支金额'] },
  { field: 'counterparty', keywords: ['交易对方', '对方名称', '对方账号', '商户名称', '交易方', 'counterparty', '付款方'] },
  { field: 'category', keywords: ['交易类型', '分类', '类别', 'category', '交易分类'] },
  { field: 'direction', keywords: ['收/支', '收支', '收支类型', '收/支类型', '方向', 'direction', '借贷标志'] },
  { field: 'balance', keywords: ['余额', '账户余额', 'balance', '交易后余额'] },
  { field: 'note', keywords: ['备注', '商品说明', 'note', 'memo', '摘要', '交易备注'] },
];

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
   * 根据表头关键词自动建议列映射。
   *
   * 说明：同一语义字段只绑定第一个命中的列，避免重复映射。
   *
   * @returns 建议的列映射（0 基列索引 → 语义字段）
   */
  suggest(): ColumnMapping {
    const mapping: ColumnMapping = {};
    const used = new Set<BillField>();
    for (const suggestion of HEADER_SUGGESTIONS) {
      for (let index = 0; index < this.columns.length; index += 1) {
        if (used.has(suggestion.field)) {
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
