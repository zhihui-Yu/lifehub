/**
 * 服务模块 barrel。
 *
 * 说明：统一从这里导出，避免上层出现深层相对路径（系统设计 §8.1 导入路径约定）。
 */
export { AuditLogger } from './audit-logger';
export { BackupService } from './backup-service';
export type { BackupFile } from './backup-service';
export { ImportService } from './import-service';
export type { ImportPlan, ImportServiceDeps, ImportSource, PlanOptions, RunOptions } from './import-service';
export { KeyRotationService } from './key-rotation-service';
export type { KeyRotationPlan, KeyRotationResult, RotationState, RotationStatus } from './key-rotation-service';
export { mergeRecord } from './sync/merge';
export type { FieldConflict, MergeResult } from './sync/merge';
export { SYNC_BLOB_ALLOWED_FIELDS, assertCiphertextOnly, buildSyncPayload } from './sync/sync-payload';
export { VaultService } from './vault-service';
export type { UnlockedVault, VaultSetup } from './vault-service';
