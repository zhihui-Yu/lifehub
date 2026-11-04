/**
 * 领域模型 barrel。
 *
 * 说明：统一从这里导出，避免上层出现深层相对路径（系统设计 §8.1 导入路径约定）。
 */
export { DIRECTIONS, isDirection, validateBill } from './bill';
export type { Bill, Direction } from './bill';

export {
  SYSTEM_CATEGORIES,
  USER_CATEGORY_MEMORY_SIGNATURE,
  USER_CATEGORY_MEMORY_TEMPLATE_ID,
  extractBillItemKey,
  extractBillItemLabel,
  normalizeCategoryName,
  validateCategory,
} from './category';
export type { Category, CategoryKind, SystemCategorySeed } from './category';

export {
  BILL_FIELDS,
  REQUIRED_BILL_FIELDS,
  createDefaultDirectionRule,
  validateRuleTemplate,
} from './rule-template';
export type {
  BillField,
  CategoryMatchType,
  CategoryRule,
  ColumnMapping,
  DirectionRule,
  DirectionRuleMode,
  RuleTemplate,
} from './rule-template';

export { validateImportBatch } from './import-batch';
export type { ImportBatch, ImportEncoding, ImportError, ImportSummary } from './import-batch';

export {
  SOURCE_CHANNELS,
  SOURCE_CHANNEL_LABELS,
  classifySourceChannel,
  isSourceChannel,
} from './source-channel';
export type { SourceChannel } from './source-channel';

export { validateRecoveryMeta, validateVaultParams } from './vault';
export type { RecoveryBundle, RecoveryMeta, VaultKdfParams, VaultParams, WrappedDek } from './vault';

export { AUDIT_ACTIONS, AUDIT_ACTION_LABELS, validateAuditLog } from './audit';
export type { AuditAction, AuditLog } from './audit';

export { validateEncryptedBlob } from './encrypted-blob';
export type { EncryptedBlob, SyncPayload } from './encrypted-blob';

export type {
  AIAnalysisRequest,
  AppSettings,
  CompletionEvent,
  DiaryEntry,
  Habit,
  HabitCheckIn,
  ScheduleSlot,
  ThemeMode,
  WeekStart,
} from './app-settings';

export type { EncryptedPayload, PlainPayload, StorageQuery, StoredRecord } from './common';
