/**
 * 导入批次实体与导入结果结构。
 *
 * 架构位置：core 包的领域模型层，服务于 A-11（坏行不中断 + 导入摘要）与
 * A-12（去重与幂等导入）。
 */
import { ISO_UTC_PATTERN } from '../constants';
import { LifeHubError } from '../errors';
import type { BaseEntity } from '../types/common';

/** CSV 文件编码类型。 */
export type ImportEncoding = 'utf-8' | 'utf-8-bom' | 'gbk' | 'gb18030';

/** 导入批次实体。 */
export interface ImportBatch extends BaseEntity {
  /** 批次 id。 */
  id: string;
  /** 源文件名。 */
  fileName: string;
  /** 源文件字节数。 */
  fileSize: number;
  /** 文件 sha256 hex，用于幂等判定（A-12 ②）。 */
  fileHash: string;
  /** 文件编码。 */
  encoding: ImportEncoding;
  /** 数据行总数。 */
  rowTotal: number;
  /** 成功导入行数。 */
  rowImported: number;
  /** 跳过行数（含重复与错误行）。 */
  rowSkipped: number;
  /** 使用的规则模板 id；未使用模板为 null。 */
  templateId: string | null;
}

/**
 * 单行导入错误。
 *
 * 说明：坏行不中断导入（A-11 ①），错误明细在导入结束后统一展示并持久化。
 */
export interface ImportError {
  /** 出错的源文件行号（0 基，不含表头）。 */
  rowIndex: number;
  /** 出错的列索引；无法定位时为 null。 */
  columnIndex: number | null;
  /** 中文原因说明。 */
  reason: string;
  /** 出错行的原始文本（用于用户核对，不含其它行的敏感数据）。 */
  raw: string;
}

/**
 * 导入摘要。
 *
 * 说明：UI 层据此展示「成功导入 N 条，跳过 M 条」以及跳过错��明细。
 */
export interface ImportSummary {
  /** 导入批次 id。 */
  batchId: string;
  /** 数据行总数。 */
  rowTotal: number;
  /** 成功导入行数。 */
  rowImported: number;
  /** 跳过行数。 */
  rowSkipped: number;
  /** 其中因重复而跳过的行数。 */
  rowDuplicated: number;
  /** 错误明细。 */
  errors: ImportError[];
  /** 耗时（毫秒）。 */
  durationMs: number;
  /** 是否命中「同一文件已导入过」（A-12 ②）。 */
  duplicateFile: boolean;
}

/**
 * 校验并返回一个合法的 ImportBatch。
 *
 * @param batch 待校验的未知值
 * @returns 校验通过的 ImportBatch 对象
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 任一字段不满足约束
 */
export function validateImportBatch(batch: unknown): ImportBatch {
  if (typeof batch !== 'object' || batch === null) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '导入批次必须是对象');
  }
  const candidate = batch as Record<string, unknown>;

  if (typeof candidate['id'] !== 'string' || candidate['id'] === '') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '导入批次 id 非法');
  }
  if (typeof candidate['fileName'] !== 'string' || candidate['fileName'] === '') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '导入批次文件名非法');
  }
  if (typeof candidate['fileSize'] !== 'number' || candidate['fileSize'] < 0) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '导入批次文件大小非法');
  }
  if (typeof candidate['fileHash'] !== 'string' || !/^[0-9a-f]{64}$/.test(candidate['fileHash'])) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '导入批次文件哈希非法');
  }
  const encoding = candidate['encoding'];
  if (encoding !== 'utf-8' && encoding !== 'utf-8-bom' && encoding !== 'gbk' && encoding !== 'gb18030') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '导入批次编码非法');
  }
  for (const key of ['rowTotal', 'rowImported', 'rowSkipped'] as const) {
    const value = candidate[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', '导入批次行数统计非法');
    }
  }
  const templateId = candidate['templateId'];
  if (templateId !== null && typeof templateId !== 'string') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '导入批次模板 id 非法');
  }
  if (typeof candidate['createdAt'] !== 'string' || !ISO_UTC_PATTERN.test(candidate['createdAt'])) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '导入批次创建时间必须是 ISO 8601 UTC');
  }
  if (typeof candidate['updatedAt'] !== 'string' || !ISO_UTC_PATTERN.test(candidate['updatedAt'])) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '导入批次更新时间必须是 ISO 8601 UTC');
  }
  if (typeof candidate['version'] !== 'number' || !Number.isInteger(candidate['version'])) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '导入批次版本号必须是整数');
  }
  if (typeof candidate['deviceId'] !== 'string' || candidate['deviceId'] === '') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '导入批次设备 id 非法');
  }

  return candidate as unknown as ImportBatch;
}
