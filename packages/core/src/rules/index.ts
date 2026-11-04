/**
 * 规则模块 barrel。
 *
 * 说明：统一从这里导出，避免上层出现深层相对路径（系统设计 §8.1 导入路径约定）。
 */
export { CategoryRuleEngine } from './category-rule';
export { Deduplicator } from './dedupe';
export { computeBillFingerprint, computeFileHash, normalizeHeaders } from './fingerprint';
export {
  detectTransferPairs,
  inferSystemCategoryName,
  isInternalTransferBill,
  isTransferCategory,
} from './transfer-detector';
export type { CategoryInferenceInput, TransferPair } from './transfer-detector';

