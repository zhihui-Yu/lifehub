/**
 * 设备标签。
 *
 * 架构位置：apps/web 的「平台适配」层。
 *
 * 隐私约束（X-05 / NF-PR-1）：本模块**只读取浏览器名称**用于本地展示，
 * 不采集设备号、IMEI、指纹等任何可识别设备身份的标识；
 * 标签仅写入本地加密的审计日志，不上传任何服务器。
 */
import type { Clock } from '@lifehub/core';

/**
 * 取浏览器名称。
 *
 * 说明：只做 UA 字符串的关键词匹配，不做指纹采集。
 *
 * @returns 浏览器中文名称；无法识别时返回 '未知浏览器'
 */
export function detectBrowserName(): string {
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (userAgent.includes('Edg/')) {
    return 'Edge';
  }
  if (userAgent.includes('Chrome/')) {
    return 'Chrome';
  }
  if (userAgent.includes('Firefox/')) {
    return 'Firefox';
  }
  if (userAgent.includes('Safari/')) {
    return 'Safari';
  }
  return '未知浏览器';
}

/**
 * 生成设备标签，形如 '本机 · Chrome'。
 *
 * @param clock 时钟端口（用于注入测试固定时间）
 * @returns 设备标签
 */
export function createDeviceLabel(clock?: Clock): string {
  void clock;
  return `本机 · ${detectBrowserName()}`;
}
