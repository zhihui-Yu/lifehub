/**
 * 时区解析与推断。
 *
 * 架构位置：core 包「值对象」模块，为账单导入提供来源时区语义（A-03 ③）。
 */
import { LifeHubError } from '../errors';

/**
 * 常见账单来源时区候选表。
 *
 * 取值依据：国内用户主要在东八区，但账单文件可能来自港澳台与海外账户，
 * 因此保留一份候选表供导入向导提示用户确认。
 */
export const TIMEZONE_CANDIDATES: readonly string[] = [
  'Asia/Shanghai',
  'Asia/Chongqing',
  'Asia/Harbin',
  'Asia/Urumqi',
  'Asia/Hong_Kong',
  'Asia/Macau',
  'Asia/Taipei',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Europe/London',
  'America/New_York',
  'UTC',
];

/** 系统默认时区（无法探测时的兜底值）。 */
export const DEFAULT_TIME_ZONE = 'UTC';

/**
 * 判断某个字符串是否为 Intl 可接受的 IANA 时区名。
 *
 * @param timeZone 待校验的时区名
 * @returns 合法返回 true
 */
export function isValidTimeZone(timeZone: string): boolean {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * 解析出当前运行环境的默认时区。
 *
 * 说明：优先取 `Intl` 解析出的系统时区；不可用时回退到 'UTC'。
 * 核心层不使用 `Date.prototype.toString()` 反解时区，避免依赖引擎实现细节。
 *
 * @param fallback 解析失败时的兜底时区，默认 'UTC'
 * @returns IANA 时区名
 */
export function resolveTimeZone(fallback: string = DEFAULT_TIME_ZONE): string {
  try {
    const resolved = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof resolved === 'string' && resolved !== '' && isValidTimeZone(resolved)) {
      return resolved;
    }
  } catch {
    // 某些精简运行时可能不实现 resolvedOptions，继续走兜底分支。
  }
  return isValidTimeZone(fallback) ? fallback : DEFAULT_TIME_ZONE;
}

/**
 * 从账单文件内容线索推断来源时区。
 *
 * 说明：微信 / 支付宝导出的账单通常不含时区信息，但其「交易时间」列是本地时间，
 * 因此默认使用运行环境时区作为来源时区，并允许通过 hint 覆盖。
 *
 * @param hints 用户在导入向导中显式指定的时区名
 * @returns 推断出的来源时区名
 */
export function guessSourceTimeZone(hints?: readonly string[]): string {
  const explicit = hints?.find((hint) => isValidTimeZone(hint));
  if (explicit) {
    return explicit;
  }
  return resolveTimeZone();
}

/**
 * 校验并返回时区名，非法时抛出中文提示。
 *
 * @param timeZone 待校验的时区名
 * @returns 合法时区名
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 时区名非法
 */
export function assertTimeZone(timeZone: string): string {
  if (!isValidTimeZone(timeZone)) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', `无法识别的时区：${timeZone}`);
  }
  return timeZone;
}
