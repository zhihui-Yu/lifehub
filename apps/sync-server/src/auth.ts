/**
 * 设备级令牌鉴权。
 *
 * 架构位置：apps/sync-server —— HTTP 层的第一道闸门。
 *
 * 红线（X-12 / AS-7）：
 * - 令牌**只**来自环境变量或令牌文件，不硬编码、不入库、不落日志；
 * - 进程内只保留令牌的 SHA-256 摘要，明文在构造鉴权器后即被丢弃；
 * - 比对使用 `timingSafeEqual`，避免通过响应时间逐字节猜出令牌；
 * - 未授权一律返回 401，且不泄露「令牌是否存在 / 设备是否存在」这类信息。
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { DeviceCredential } from './config.ts';

/** 鉴权结果。 */
export type AuthorizeResult = { ok: true; deviceId: string } | { ok: false; reason: string };

/** 设备令牌鉴权器。 */
export class DeviceAuthorizer {
  /** 令牌 SHA-256 摘要 → 设备标识。 */
  private readonly digests = new Map<string, string>();

  /**
   * 构造鉴权器并吸收设备凭据。
   *
   * 说明：凭据中的明文令牌在此处被哈希后丢弃，鉴权器内部不再持有明文。
   *
   * @param credentials 设备凭据列表
   */
  constructor(credentials: readonly DeviceCredential[]) {
    for (const credential of credentials) {
      this.digests.set(DeviceAuthorizer.hash(credential.secret), credential.deviceId);
    }
  }

  /**
   * 计算令牌的 SHA-256 摘要。
   *
   * @param secret 令牌明文
   * @returns 十六进制摘要字符串
   */
  private static hash(secret: string): string {
    return createHash('sha256').update(secret, 'utf8').digest('hex');
  }

  /**
   * 校验 `Authorization` 请求头。
   *
   * @param headerValue 请求头原始值；缺失时传 undefined
   * @returns 鉴权结果；成功时携带设备标识
   */
  authorize(headerValue: string | undefined): AuthorizeResult {
    if (headerValue === undefined || headerValue.trim() === '') {
      return { ok: false, reason: '缺少 Authorization 请求头' };
    }
    const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
    if (match === null) {
      return { ok: false, reason: 'Authorization 请求头格式非法，应为 Bearer <token>' };
    }
    const presented = DeviceAuthorizer.hash(match[1] ?? '');
    for (const [digest, deviceId] of this.digests) {
      // 长度相同（都是 SHA-256 十六进制串）时 timingSafeEqual 不会抛错。
      if (timingSafeEqual(Buffer.from(presented, 'utf8'), Buffer.from(digest, 'utf8'))) {
        return { ok: true, deviceId };
      }
    }
    return { ok: false, reason: '设备令牌无效' };
  }
}
