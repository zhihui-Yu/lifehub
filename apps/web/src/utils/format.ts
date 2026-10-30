/**
 * 格式化工具。
 *
 * 架构位置：apps/web 的「工具」层。
 *
 * 红线：`formatMinor` 的结果**只用于渲染**，禁止回写存储（系统设计 §8.2）。
 */
import { formatMinor, type CurrencyCode } from '@lifehub/core';

/**
 * 格式化金额为展示字符串。
 *
 * @param amountMinor 以分为单位的整数金额
 * @param currency 币种，默认 CNY
 * @returns 形如 '12.34' 的字符串
 */
export function formatAmount(amountMinor: number, currency: CurrencyCode = 'CNY'): string {
  return formatMinor(amountMinor, currency);
}

/**
 * 格式化金额并加上方向标识。
 *
 * @param amountMinor 以分为单位的整数金额
 * @param direction 收支方向
 * @param currency 币种，默认 CNY
 * @returns 形如 '支出 ¥12.34' 的字符串
 */
export function formatAmountWithDirection(
  amountMinor: number,
  direction: 'income' | 'expense' | 'refund',
  currency: CurrencyCode = 'CNY',
): string {
  const label = direction === 'expense' ? '支出' : direction === 'refund' ? '退款' : '收入';
  return `${label} ¥${formatAmount(amountMinor, currency)}`;
}

/**
 * 格式化本地日历日为中文可读形式。
 *
 * @param localDate 'YYYY-MM-DD' 形式的日历日
 * @returns 形如 '2024年6月3日' 的字符串
 */
export function formatLocalDate(localDate: string): string {
  const parts = localDate.split('-');
  const year = parts[0] ?? '';
  const month = parts[1] ?? '';
  const day = parts[2] ?? '';
  return `${year}年${Number.parseInt(month, 10)}月${Number.parseInt(day, 10)}日`;
}

/**
 * 取本地日历日的星期中文名。
 *
 * @param localDate 'YYYY-MM-DD' 形式的日历日
 * @returns 形如 '星期一' 的字符串
 */
export function formatWeekday(localDate: string): string {
  const names = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const parts = localDate.split('-').map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1));
  return names[date.getUTCDay()] ?? '';
}

/**
 * 格式化相对时间（如「3 分钟前」）。
 *
 * @param isoTime ISO 8601 UTC 时间戳
 * @param now 当前时间戳，默认取当前时间
 * @returns 相对时间描述
 */
export function formatRelativeTime(isoTime: string, now: number = Date.now()): string {
  const target = new Date(isoTime).getTime();
  if (Number.isNaN(target)) {
    return '';
  }
  const diffSeconds = Math.round((target - now) / 1000);
  const absSeconds = Math.abs(diffSeconds);
  if (absSeconds < 60) {
    return '刚刚';
  }
  if (absSeconds < 3600) {
    return `${Math.floor(absSeconds / 60)} 分钟${diffSeconds > 0 ? '后' : '前'}`;
  }
  if (absSeconds < 86_400) {
    return `${Math.floor(absSeconds / 3600)} 小时${diffSeconds > 0 ? '后' : '前'}`;
  }
  if (absSeconds < 2_592_000) {
    return `${Math.floor(absSeconds / 86_400)} 天${diffSeconds > 0 ? '后' : '前'}`;
  }
  return formatLocalDate(isoTime.slice(0, 10));
}

/**
 * 格式化字节数为可读形式。
 *
 * @param bytes 字节数
 * @returns 形如 '1.2 MB' 的字符串
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
