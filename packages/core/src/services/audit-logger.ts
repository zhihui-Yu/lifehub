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
  /** 写入失败回调：调用方借它暂存「写不进加密库」的失败审计条目。 */
  private onWriteFailure: ((entry: AuditLog) => void | Promise<void>) | undefined;

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
   * 注册审计写入失败回调。
   *
   * 说明：解锁失败时保险库处于锁定态、加密审计库写不进去，
   * 调用方（如 `VaultService`）用此回调把条目暂存到明文白名单内，
   * 成功解锁后再刷入加密审计（X-07 ② / B-4）。
   *
   * @param handler 写入失败时的回调
   * @returns 无异常
   */
  setOnWriteFailure(handler: (entry: AuditLog) => void | Promise<void>): void {
    this.onWriteFailure = handler;
  }

  /**
   * 记录一条审计日志。
   *
   * 说明：审计失败**不应中断主流程**（例如解密失败本身要记日志，
   * 若此时日志写库也失败会造成递归），因此这里吞掉异常但保留接口契约，
   * 并交给 `onWriteFailure` 回调兜底（若已注册）。
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
      try {
        await this.onWriteFailure?.(entry);
      } catch {
        // 兜底回调自身失败也吞掉：审计始终是旁路能力。
      }
    }
    return entry;
  }

  /**
   * 尝试把一条已构造好的审计条目直接写库（用于刷入暂存条目）。
   *
   * @param entry 已构造好的审计条目
   * @returns 写入成功返回 true；写入失败返回 false（调用方可继续暂存）
   */
  async restore(entry: AuditLog): Promise<boolean> {
    try {
      await this.repository.save(entry);
      return true;
    } catch {
      return false;
    }
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
