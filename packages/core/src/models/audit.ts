/**
 * 审计日志模型。
 *
 * 架构位置：core 包的领域模型层，服务于 X-07（审计日志）。
 *
 * 说明：审计日志与业务数据一致地**加密落盘**，解锁后才能查看；
 * 本地留存、提供查看与清除入口，**不随同步上传**（NF-PR-5）。
 */
import { ISO_UTC_PATTERN } from '../constants';
import { LifeHubError } from '../errors';

/**
 * 审计动作枚举。
 *
 * 取值依据：系统设计 §3.1.4，覆盖「建库 / 解锁 / 失败解锁 / 解密 / 导入 / 导出 /
 * 轮换 / 恢复 / 清空审计」九类安全相关动作。
 */
export type AuditAction =
  | 'create_vault'
  | 'unlock'
  | 'failed_unlock'
  | 'decrypt'
  | 'import'
  | 'export'
  | 'rotate_key'
  | 'recover'
  | 'clear_audit';

/** 全部审计动作值。 */
export const AUDIT_ACTIONS: readonly AuditAction[] = [
  'create_vault',
  'unlock',
  'failed_unlock',
  'decrypt',
  'import',
  'export',
  'rotate_key',
  'recover',
  'clear_audit',
];

/** 审计动作的中文文案，供 UI 直接展示。 */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  create_vault: '创建保险库',
  unlock: '解锁成功',
  failed_unlock: '解锁失败',
  decrypt: '解密数据',
  import: '导入账单',
  export: '导出备份',
  rotate_key: '轮换密钥',
  recover: '恢复码解锁',
  clear_audit: '清空审计日志',
};

/** 审计日志条目。 */
export interface AuditLog {
  /** 日志 id（UUIDv7）。 */
  id: string;
  /** 发生时间，ISO 8601 UTC。 */
  at: string;
  /** 审计动作。 */
  action: AuditAction;
  /** 作用对象（实体名 / 文件名 / 空串）。 */
  target: string;
  /** 设备标签，形如 '本机 · Chrome'。 */
  deviceLabel: string;
  /** 操作是否成功。 */
  success: boolean;
}

/**
 * 校验并返回一个合法的 AuditLog。
 *
 * @param log 待校验的未知值
 * @returns 校验通过的 AuditLog 对象
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 任一字段不满足约束
 */
export function validateAuditLog(log: unknown): AuditLog {
  if (typeof log !== 'object' || log === null) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '审计日志必须是对象');
  }
  const candidate = log as Record<string, unknown>;
  if (typeof candidate['id'] !== 'string' || candidate['id'] === '') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '审计日志 id 非法');
  }
  if (typeof candidate['at'] !== 'string' || !ISO_UTC_PATTERN.test(candidate['at'])) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '审计日志时间必须是 ISO 8601 UTC');
  }
  const action = candidate['action'];
  if (typeof action !== 'string' || !(AUDIT_ACTIONS as readonly string[]).includes(action)) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '审计动作非法');
  }
  if (typeof candidate['target'] !== 'string') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '审计对象必须是字符串');
  }
  if (typeof candidate['deviceLabel'] !== 'string') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '审计设备标签必须是字符串');
  }
  if (typeof candidate['success'] !== 'boolean') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '审计结果必须是布尔值');
  }
  return candidate as unknown as AuditLog;
}
