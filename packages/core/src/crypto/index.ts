/**
 * 加密模块 barrel。
 *
 * 说明：**不导出** `node-crypto-provider`，避免浏览器构建意外引入 `node:crypto`；
 * Node 侧请通过 `@lifehub/core/node` 子路径单独引入。
 */
export { CryptoService } from './service';
export { createFallbackKdfParams, createKdfParams, deserializeKdfParams, getKdfParamsVersion, isKdfUpgradable, serializeKdfParams, validateKdfParams } from './kdf';
export type { KdfParams, SerializedKdfParams } from './kdf';
export type { CryptoProvider } from './provider';
export {
  assertKeyLength,
  generateDek,
  generateSalt,
  unwrapDek,
  wipeBytes,
  wrapDek,
} from './dek';
export {
  assertRecoveryCode,
  computeGroupCheck,
  computeRecoveryChecksum,
  defaultRandomBytes,
  generateRecoveryCode,
  normalizeRecoveryCode,
  splitRecoveryGroups,
  validateRecoveryCode,
} from './recovery-code';
export type { RecoveryCode, RecoveryGroup } from './recovery-code';
export { NobleCryptoProvider } from './providers/noble-fallback-provider';
export { WebCryptoProvider } from './providers/web-crypto-provider';
