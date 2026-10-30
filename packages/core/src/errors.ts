/**
 * 统一错误类型与错误码表。
 *
 * 架构位置：core 包的最底层叶子模块，只依赖本文件自身，不引用任何其它模块。
 * 系统设计 §8.3 约定：核心层**只抛 LifeHubError**，UI 层按 `code` 分支处理，
 * 严禁 `throw new Error('中文')`，避免中文文案散落各处。
 */

/**
 * 错误码枚举，取值与系统设计 §3.4 错误码表逐条对应。
 */
export const LIFEHUB_ERROR_CODES = [
  'LIFEHUB_E_VALIDATION',
  'LIFEHUB_E_AMOUNT_INVALID',
  'LIFEHUB_E_DATE_INVALID',
  'LIFEHUB_E_DIRECTION_UNKNOWN',
  'LIFEHUB_E_CSV_PARSE',
  'LIFEHUB_E_CSV_ENCODING',
  'LIFEHUB_E_MAPPING_INCOMPLETE',
  'LIFEHUB_E_MAPPING_CONFLICT',
  'LIFEHUB_E_VAULT_NOT_FOUND',
  'LIFEHUB_E_VAULT_PASSWORD_WRONG',
  'LIFEHUB_E_RECOVERY_INVALID',
  'LIFEHUB_E_CRYPTO_AUTH_FAILED',
  'LIFEHUB_E_STORAGE',
  'LIFEHUB_E_DUPLICATE_FILE',
  'LIFEHUB_E_BACKUP_INVALID',
  'LIFEHUB_E_ROTATION_IN_PROGRESS',
  'LIFEHUB_E_ENTITY_NOT_FOUND',
  'LIFEHUB_E_IMPORT_ROW',
] as const;

/** 错误码字面量联合类型。 */
export type LifeHubErrorCode = (typeof LIFEHUB_ERROR_CODES)[number];

/**
 * 错误码到中文提示文案的映射（系统设计 §3.4 第四列）。
 *
 * UI 层只需展示 `LifeHubError.message`，无需在组件内重复翻译。
 */
export const ERROR_MESSAGES: Record<LifeHubErrorCode, string> = {
  LIFEHUB_E_VALIDATION: '数据格式不正确',
  LIFEHUB_E_AMOUNT_INVALID: '金额无法解析为数字',
  LIFEHUB_E_DATE_INVALID: '日期格式无法识别',
  LIFEHUB_E_DIRECTION_UNKNOWN: '无法判断收支方向',
  LIFEHUB_E_CSV_PARSE: '文件格式异常，无法解析',
  LIFEHUB_E_CSV_ENCODING: '文件编码无法识别，请另存为 UTF-8 后重试',
  LIFEHUB_E_MAPPING_INCOMPLETE: '请先映射『日期』和『金额』两列',
  LIFEHUB_E_MAPPING_CONFLICT: '同一字段不能映射到多列',
  LIFEHUB_E_VAULT_NOT_FOUND: '请先设置主密码',
  LIFEHUB_E_VAULT_PASSWORD_WRONG: '主口令不正确',
  LIFEHUB_E_RECOVERY_INVALID: '恢复码格式不正确，请检查后重试',
  LIFEHUB_E_CRYPTO_AUTH_FAILED: '数据校验失败，可能已被损坏',
  LIFEHUB_E_STORAGE: '本地数据读写失败',
  LIFEHUB_E_DUPLICATE_FILE: '该文件已导入过',
  LIFEHUB_E_BACKUP_INVALID: '备份文件格式不正确',
  LIFEHUB_E_ROTATION_IN_PROGRESS: '密钥轮换尚未完成，请先继续上一次任务',
  LIFEHUB_E_ENTITY_NOT_FOUND: '未找到对应记录',
  LIFEHUB_E_IMPORT_ROW: '该行数据无法导入，已跳过',
};

/**
 * LifeHub 领域异常。
 *
 * 所有可预期的失败都必须以本异常抛出，携带机器可读的 `code` 与面向用户的中文 `message`。
 */
export class LifeHubError extends Error {
  /** 机器可读错误码，供 UI 分支处理。 */
  readonly code: LifeHubErrorCode;
  /** 可选的诊断上下文，禁止放入明文业务数据（金额 / 对方 / 备注）。 */
  readonly details: Record<string, unknown> | undefined;

  /**
   * 构造领域异常。
   *
   * @param code 错误码，取值见 LIFEHUB_ERROR_CODES
   * @param message 中文提示文案；省略时使用错误码默认文案
   * @param details 可选的诊断上下文（仅允许非业务语义字段）
   */
  constructor(code: LifeHubErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ?? ERROR_MESSAGES[code]);
    this.name = 'LifeHubError';
    this.code = code;
    this.details = details;
    // 修复 ES5 目标下继承内置 Error 的原型链问题，保证 instanceof 判定可靠。
    Object.setPrototypeOf(this, LifeHubError.prototype);
  }
}

/**
 * 类型守卫：判断一个未知值是否为 LifeHubError。
 *
 * @param value 待判定的未知值
 * @returns 是 LifeHubError 时返回 true
 */
export function isLifeHubError(value: unknown): value is LifeHubError {
  return value instanceof LifeHubError;
}

/**
 * 把任意未知异常归一为 LifeHubError。
 *
 * 未知异常统一转成 LIFEHUB_E_VALIDATION 并保留原始 message，
 * 避免底层实现差异（例如 Node 的 TypeError）泄漏到 UI。
 *
 * @param value 待归一的未知异常
 * @param fallbackCode 当传入值不是 LifeHubError 时使用的错误码
 * @returns 归一后的 LifeHubError
 */
export function toLifeHubError(value: unknown, fallbackCode: LifeHubErrorCode = 'LIFEHUB_E_VALIDATION'): LifeHubError {
  if (isLifeHubError(value)) {
    return value;
  }
  const raw = value instanceof Error ? value.message : String(value);
  return new LifeHubError(fallbackCode, raw);
}
