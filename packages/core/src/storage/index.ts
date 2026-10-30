/**
 * 存储模块 barrel。
 *
 * 说明：统一从这里导出，避免上层出现深层相对路径（系统设计 §8.1 导入路径约定）。
 */
export type { StorageAdapter, StorageQueryLike } from './adapter';
export { EncryptedStore } from './encrypted-store';
export type { EncryptedStoreMeta } from './encrypted-store';
export { MemoryStorageAdapter } from './memory-adapter';
export { PlainStore } from './plain-store';
export { createRestoredStoredRecord } from './restored-record';
