/**
 * 测试夹具工厂。
 *
 * 架构位置：apps/web 的「测试辅助」层（位于 `src/__tests__/test-utils/`，仅被测试文件引用，不参与生产构建）。
 *
 * 说明：集中构造 `Bill` / `ImportPlan` / `ImportSummary` / `ImportBatch` / `AuditLog` /
 * `RecoveryBundle` 等实体，避免各测试文件重复手写字面量造成字段漂移；
 * 每个工厂都提供「部分覆盖」参数，测试只需写自己关心的字段。
 */
import type {
  AuditLog,
  Bill,
  ColumnMapping,
  CrossSourceCandidate,
  Direction,
  ImportBatch,
  ImportPlan,
  ImportSummary,
  PreviewRow,
  RecoveryBundle,
  SourceChannel,
} from '@lifehub/core';

/** 账单实体的默认构造参数。 */
const BILL_DEFAULTS = {
  amountMinor: 1000,
  currency: 'CNY' as const,
  direction: 'expense' as Direction,
  occurredAt: '2024-01-15T08:12:00.000Z',
  localDate: '2024-01-15',
  sourceTimeZone: 'Asia/Shanghai',
  counterparty: '星巴克',
  categoryId: null as string | null,
  note: '',
  sourceFileId: 'batch-1',
  sourceRowIndex: 0,
  createdAt: '2024-01-15T08:12:00.000Z',
  updatedAt: '2024-01-15T08:12:00.000Z',
  version: 1,
  deviceId: 'test-device',
};

/**
 * 构造一条账单实体。
 *
 * @param partial 需要覆盖的字段
 * @returns 合法的账单对象
 */
export function makeBill(partial: Partial<Bill> = {}): Bill {
  return { ...BILL_DEFAULTS, ...partial, id: partial.id ?? `bill-${partial.sourceRowIndex ?? 0}` };
}

/**
 * 构造一份导入计划。
 *
 * @param partial 需要覆盖的字段
 * @returns 合法的导入计划对象
 */
export function makePlan(partial: Partial<ImportPlan> = {}): ImportPlan {
  return {
    fileHash: 'a'.repeat(64),
    encoding: 'utf-8',
    headers: ['日期', '金额', '对方'],
    delimiter: ',',
    rowCount: 1,
    fileSignature: 'b'.repeat(64),
    suggestedMapping: { 0: 'occurredAt', 1: 'amount', 2: 'counterparty' },
    matchedTemplateId: null,
    matchedTemplateName: null,
    preview: [],
    duplicateFile: false,
    duplicateOf: null,
    sourceChannel: 'csv' as SourceChannel,
    crossSourceCandidates: [] as CrossSourceCandidate[],
    ...partial,
  } as ImportPlan;
}

/**
 * 构造一条预览行。
 *
 * @param partial 需要覆盖的字段
 * @returns 合法的预览行对象
 */
export function makePreviewRow(partial: Partial<PreviewRow> = {}): PreviewRow {
  return {
    rowIndex: 0,
    occurredAt: '2024-01-15T08:12:00.000Z',
    localDate: '2024-01-15',
    amountMinor: 3550,
    direction: 'expense',
    counterparty: '星巴克',
    note: '拿铁',
    raw: '2024-01-15,35.50,星巴克,拿铁',
    error: null,
    ...partial,
  };
}

/**
 * 构造一份导入摘要。
 *
 * @param partial 需要覆盖的字段
 * @returns 合法的导入摘要对象
 */
export function makeSummary(partial: Partial<ImportSummary> = {}): ImportSummary {
  return {
    batchId: 'batch-1',
    rowTotal: 1,
    rowImported: 1,
    rowSkipped: 0,
    rowDuplicated: 0,
    errors: [],
    durationMs: 12,
    duplicateFile: false,
    rowCrossSourceDuplicate: 0,
    ...partial,
  } as ImportSummary;
}

/**
 * 构造一个导入批次实体。
 *
 * @param partial 需要覆盖的字段
 * @returns 合法的导入批次对象
 */
export function makeBatch(partial: Partial<ImportBatch> = {}): ImportBatch {
  return {
    id: 'batch-1',
    fileName: '微信支付_2024-01.csv',
    fileSize: 2048,
    fileHash: 'c'.repeat(64),
    encoding: 'utf-8',
    rowTotal: 120,
    rowImported: 118,
    rowSkipped: 2,
    templateId: null,
    sourceChannel: 'wechat' as SourceChannel,
    createdAt: '2024-01-15T08:12:00.000Z',
    updatedAt: '2024-01-15T08:12:00.000Z',
    version: 1,
    deviceId: 'test-device',
    ...partial,
  } as ImportBatch;
}

/**
 * 构造一条审计日志。
 *
 * @param partial 需要覆盖的字段
 * @returns 合法的审计日志对象
 */
export function makeAuditLog(partial: Partial<AuditLog> = {}): AuditLog {
  return {
    id: 'log-1',
    at: '2024-01-15T08:12:00.000Z',
    action: 'unlock',
    target: '',
    deviceLabel: '本机 · Chrome',
    success: true,
    ...partial,
  };
}

/**
 * 构造一份恢复码包。
 *
 * 说明：这里的盐值与哨兵密文都是**构造出来的假值**，
 * 仅用于验证「默认不展示明文 / 点『显示一次』才展示」这类 UI 契约，不参与任何密码学运算。
 *
 * @param partial 需要覆盖的字段
 * @returns 合法的恢复码包对象
 */
export function makeRecoveryBundle(partial: Partial<RecoveryBundle> = {}): RecoveryBundle {
  return {
    version: 1,
    recoveryCode: 'ABCDEF-GHIJKL-MNOPQR-STUVWX-YZ0123-345678-9ABCDE-FGHIJK-LMNO-PQRS-TUV',
    salt: new Uint8Array(16).fill(7),
    kdfParams: { kdf: 'scrypt', n: 32768, r: 8, p: 1, keyLength: 32 },
    verifier: {
      kind: 'encrypted',
      algorithm: 'AES-256-GCM',
      iv: new Uint8Array(12).fill(1),
      ciphertext: new Uint8Array(16).fill(2),
      tag: new Uint8Array(16).fill(3),
      keyVersion: 1,
    },
    checksum: 'd'.repeat(64),
    createdAt: '2024-01-15T08:12:00.000Z',
    ...partial,
  };
}

/**
 * 构造列映射。
 *
 * @param entries 「列索引 → 语义字段」键值对
 * @returns 列映射对象
 */
export function makeMapping(entries: Record<number, ColumnMapping[number]>): ColumnMapping {
  return { ...entries };
}
