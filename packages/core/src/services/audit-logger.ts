/**
 * 审计日志服务。
 *
 * 架构位置：core 包的「服务」层，服务于 X-07（审计日志）。
 *
 * 规则（系统设计 §8.5）：
 * - 日志落本地库、加密、不上传；
 * - 必记 `at` / `action` / `target` / `deviceLabel` / `success`；
 * - 提供 `clear()`，但调用方必须做二次确认（X-07 ④）。
 */
import type { AuditAction, AuditLog } from '../models/audit';
import type { AuditLogRepository } from '../repositories/audit-log-repository';
import type { Clock } from '../types/common';
import { uuidV7 } from '../utils/id';

/**
 * 审计日志服务。
 */
export class AuditLogger {
  /** 审计日志仓储。 */
  private readonly repository: AuditLogRepository;
  /** 时钟端口。 */
  private readonly clock: Clock;
  /** 设备标签，形如 '本机 · Chrome'。 */
  private readonly deviceLabel: string;

  /**
   * 构造审计日志服务。
   *
   * @param deps 依赖集合
   */
  constructor(deps: { repository: AuditLogRepository; clock: Clock; deviceLabel: string }) {
    this.repository = deps.repository;
    this.clock = deps.clock;
    this.deviceLabel = deps.deviceLabel;
  }

  /**
   * 记录一条审计日志。
   *
   * 说明：审计失败**不应中断主流程**（例如解密失败本身要记日志，
   * 若此时日志写库也失败会造成递归），因此这里吞掉异常但保留接口契约。
   *
   * @param action 审计动作
   * @param target 作用对象（实体名 / 文件名 / 空串）
   * @param success 操作是否成功
   * @returns 写入的日志条目
   */
  async log(action: AuditAction, target: string, success: boolean): Promise<AuditLog> {
    const entry: AuditLog = {
      id: uuidV7(),
      at: this.clock.nowIso(),
      action,
      target,
      deviceLabel: this.deviceLabel,
      success,
    };
    try {
      await this.repository.save(entry);
    } catch {
      // 审计写入失败不抛出：审计是旁路能力，不能因为它让主流程失败。
    }
    return entry;
  }

  /**
   * 列出审计日志。
   *
   * @param query 分页参数
   * @returns 日志列表（按时间倒序）
   */
  async list(query?: { limit?: number; offset?: number }): Promise<AuditLog[]> {
    return this.repository.list(query);
  }

  /**
   * 清空审计日志（调用方必须先做二次确认）。
   *
   * @returns 无异常
   */
  async clear(): Promise<void> {
    await this.repository.clear();
  }
}
