/**
 * 仓储模块 barrel。
 *
 * 说明：统一从这里导出，避免上层出现深层相对路径（系统设计 §8.1 导入路径约定）。
 */
export { AuditLogRepository } from './audit-log-repository';
export { BillRepository } from './bill-repository';
export type { BillQuery } from './bill-repository';
export { CategoryRepository } from './category-repository';
export { ImportBatchRepository } from './import-batch-repository';
export { RECOVERY_META_ID, VAULT_PARAMS_ID, VaultRepository } from './vault-repository';
export { RuleTemplateRepository } from './rule-template-repository';
