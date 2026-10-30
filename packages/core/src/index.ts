/**
 * @lifehub/core 唯一对外入口（barrel）。
 *
 * 架构位置：core 包的公共 API 面。上层（apps/web、apps/sync-server、未来 apps/app）
 * **只允许**从这里导入，不要越过 barrel 直接引用深层路径，
 * 这样后续重构内部结构不会破坏外部契约。
 *
 * 说明：`node-crypto-provider` **不在**此导出，它只通过 `@lifehub/core/node` 子路径提供，
 * 以免浏览器构建意外引入 `node:crypto`。
 */

// ── 常量与错误 ────────────────────────────────────────────────────────
export {
  APP_VERSION,
  BACKUP_FILE_EXTENSION,
  BACKUP_MAGIC,
  BACKUP_VERSION,
  DEK_LENGTH,
  DIRECTION_EXPENSE_KEYWORDS,
  DIRECTION_INCOME_KEYWORDS,
  ENCRYPTION_ALGORITHM,
  GCM_TAG_LENGTH,
  IMPORT_BATCH_SIZE,
  IMPORT_PREVIEW_ROWS,
  ISO_UTC_PATTERN,
  IV_LENGTH,
  KDF_DEFAULT_PARAMS,
  KDF_FALLBACK_PARAMS,
  KDF_PARAMS_VERSION,
  LOCAL_DATE_PATTERN,
  MAX_IMPORT_FILE_SIZE,
  MIN_PASSWORD_LENGTH,
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_GROUP_COUNT,
  RECOVERY_CODE_GROUP_LENGTH,
  SALT_BACKUP_FILE_EXTENSION,
  UNLOCK_COOLDOWN_MS,
  UNLOCK_COOLDOWN_THRESHOLD,
  VAULT_VERIFIER_ID,
  VAULT_VERIFIER_PLAINTEXT,
  WALL_CLOCK_PATTERN,
} from './constants';
export { ERROR_MESSAGES, LIFEHUB_ERROR_CODES, LifeHubError, isLifeHubError, toLifeHubError } from './errors';
export type { LifeHubErrorCode } from './errors';

// ── 类型 ──────────────────────────────────────────────────────────────
export type { BaseEntity, Clock, DekProvider, Logger, MergeableEntity, SyncMeta } from './types/common';
export {
  ENTITY_TYPES,
  INDEX_COLUMNS,
  PLAIN_ENTITY_TYPES,
  isEntityType,
  isIndexColumn,
  isPlainEntityType,
} from './types/entity-type';
export type { EntityType, IndexColumn, PlainEntityType } from './types/entity-type';

// ── 领域模型 ──────────────────────────────────────────────────────────
export * from './models';

// ── 金额与时间 ────────────────────────────────────────────────────────
export {
  CURRENCY_EXPONENT,
  DEFAULT_CURRENCY,
  detectAmountSign,
  formatMinor,
  getExponent,
  isCurrencyCode,
  minorToDecimal,
  normalizeAmountText,
  parseAmountToMinor,
  sumMinor,
} from './money';
export type { CurrencyCode, NormalizedAmountText, ParseAmountOptions } from './money';
export {
  DATE_FORMATS,
  DEFAULT_TIME_ZONE,
  TIMEZONE_CANDIDATES,
  addDays,
  assertTimeZone,
  buildUtcDate,
  diffDays,
  excelSerialToDate,
  formatIsoUtc,
  guessSourceTimeZone,
  isExcelSerialDate,
  isIsoUtc,
  isValidDateParts,
  isValidTimeZone,
  parseFlexibleDate,
  parseOffsetMinutes,
  resolveTimeZone,
  toLocalDate,
  toWallClock,
} from './time';
export type { DateFormatDescriptor, ParseDateOptions, ParsedDate } from './time';

// ── 加密层 ────────────────────────────────────────────────────────────
export {
  CryptoService,
  NobleCryptoProvider,
  WebCryptoProvider,
  assertKeyLength,
  assertRecoveryCode,
  computeGroupCheck,
  computeRecoveryChecksum,
  createFallbackKdfParams,
  createKdfParams,
  defaultRandomBytes,
  deserializeKdfParams,
  generateDek,
  generateRecoveryCode,
  generateSalt,
  getKdfParamsVersion,
  isKdfUpgradable,
  normalizeRecoveryCode,
  serializeKdfParams,
  splitRecoveryGroups,
  unwrapDek,
  validateKdfParams,
  validateRecoveryCode,
  wipeBytes,
  wrapDek,
} from './crypto';
export type { CryptoProvider, KdfParams, RecoveryCode, RecoveryGroup, SerializedKdfParams } from './crypto';

// ── CSV 解析 ──────────────────────────────────────────────────────────
export {
  ColumnMapper,
  CsvParser,
  DirectionResolver,
  ParseRowError,
  RowMapper,
  UTF8_BOM,
  decodeBytes,
  decodeChunks,
  detectEncoding,
  hasBom,
  stripBom,
} from './csv';
export type {
  CsvParserOptions,
  CsvRow,
  CsvTable,
  DirectionResult,
  MappedRow,
  MappingValidation,
  ParseOptions,
  PreviewRow,
  RowContext,
} from './csv';

// ── 规则引擎 ──────────────────────────────────────────────────────────
export { CategoryRuleEngine, Deduplicator, computeBillFingerprint, computeFileHash, normalizeHeaders } from './rules';

// ── 存储抽象 ──────────────────────────────────────────────────────────
export { EncryptedStore, MemoryStorageAdapter, PlainStore } from './storage';
export type { EncryptedStoreMeta, StorageAdapter, StorageQueryLike } from './storage';

// ── 仓储 ──────────────────────────────────────────────────────────────
export {
  AuditLogRepository,
  BillRepository,
  CategoryRepository,
  ImportBatchRepository,
  RECOVERY_META_ID,
  RuleTemplateRepository,
  VAULT_PARAMS_ID,
  VaultRepository,
} from './repositories';
export type { BillQuery } from './repositories';

// ── 服务 ──────────────────────────────────────────────────────────────
export {
  AuditLogger,
  BackupService,
  ImportService,
  KeyRotationService,
  SYNC_BLOB_ALLOWED_FIELDS,
  VaultService,
  assertCiphertextOnly,
  buildSyncPayload,
  mergeRecord,
} from './services';
export type {
  BackupFile,
  FieldConflict,
  ImportPlan,
  ImportServiceDeps,
  ImportSource,
  KeyRotationPlan,
  KeyRotationResult,
  MergeResult,
  PlanOptions,
  RotationState,
  RotationStatus,
  RunOptions,
  UnlockedVault,
  VaultSetup,
} from './services';

// ── 工具 ──────────────────────────────────────────────────────────────
export {
  asText,
  bytesEqual,
  chunk,
  concatBytes,
  ConsoleLogger,
  fromBase64,
  fromHex,
  isDirection,
  isEncryptedPayload,
  isNonEmptyString,
  isPlainPayload,
  isStoredRecord,
  nowMillis,
  range,
  sha256Hex,
  toBase64,
  toHex,
  utf8Decode,
  utf8Encode,
  uuidV7,
  yieldToMainThread,
} from './utils';
export type { LogLevel } from './utils';
