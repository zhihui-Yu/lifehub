/**
 * 日志端口的辅助实现。
 *
 * 架构位置：core 包「工具」层。
 *
 * 安全约束（系统设计 §8.5）：日志通道**禁止**打印
 * 主口令、恢复码、salt、masterKey、DEK、明文业务数据（金额 / 对方 / 备注 / 分类 / 日记正文）。
 * 本实现只输出消息与错误码，不展开上下文里的业务字段。
 */
import type { Logger } from '../types/common';

/** 日志级别。 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 敏感上下文字段名清单：出现这些键时其值会被替换为 '[redacted]'。 */
const SENSITIVE_KEYS: readonly string[] = [
  'password',
  'passphrase',
  'recoveryCode',
  'salt',
  'masterKey',
  'dek',
  'key',
  'amount',
  'amountMinor',
  'counterparty',
  'note',
  'body',
  'content',
];

/**
 * 把上下文中的敏感字段脱敏。
 *
 * @param context 原始上下文
 * @returns 脱敏后的上下文
 */
function redact(context?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!context) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    out[key] = SENSITIVE_KEYS.includes(key) ? '[redacted]' : value;
  }
  return out;
}

/**
 * 控制台日志实现。
 *
 * 说明：`debug` / `info` 在生产构建下被丢弃（由 `enabled` 控制）。
 */
export class ConsoleLogger implements Logger {
  /** 是否输出 debug / info 级日志。 */
  private readonly verbose: boolean;

  /**
   * 构造控制台日志实现。
   *
   * @param verbose 是否输出 debug / info 级日志，默认 false
   */
  constructor(verbose = false) {
    this.verbose = verbose;
  }

  /**
   * 输出调试级日志（生产构建丢弃）。
   *
   * @param message 日志正文
   * @param context 可选上下文
   */
  debug(message: string, context?: Record<string, unknown>): void {
    if (!this.verbose) {
      return;
    }
    console.debug(message, redact(context) ?? '');
  }

  /**
   * 输出信息级日志（生产构建丢弃）。
   *
   * @param message 日志正文
   * @param context 可选上下文
   */
  info(message: string, context?: Record<string, unknown>): void {
    if (!this.verbose) {
      return;
    }
    console.info(message, redact(context) ?? '');
  }

  /**
   * 输出警告级日志。
   *
   * @param message 日志正文
   * @param context 可选上下文
   */
  warn(message: string, context?: unknown): void {
    console.warn(message, redact(context as Record<string, unknown> | undefined) ?? '');
  }

  /**
   * 输出错误级日志（只记错误码与堆栈）。
   *
   * @param message 日志正文
   * @param context 可选上下文
   */
  error(message: string, context?: Record<string, unknown>): void {
    console.error(message, redact(context) ?? '');
  }
}
