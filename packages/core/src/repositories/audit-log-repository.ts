/**
 * 审计日志仓储。
 *
 * 架构位置：core 包的「仓储」层，服务于 X-07（审计日志）。
 *
 * 说明：审计日志与业务数据一致地**加密落盘**，解锁后才能查看（系统设计 §5 假设 A-3）。
 */
import type { AuditLog } from '../models/audit';
import { validateAuditLog } from '../models/audit';
import type { EncryptedStore } from '../storage/encrypted-store';

/** 审计日志落盘时补齐的初始版本号。 */
const AUDIT_INITIAL_VERSION = 1;

/** 设备 id 的缺省值（未显式注入时使用）。 */
const DEFAULT_DEVICE_ID = 'local';

/**
 * 审计日志仓储。
 */
export class AuditLogRepository {
  /** 加密存储门面。 */
  private readonly store: EncryptedStore;
  /** 写入索引明文列 `deviceId` 的设备标识。 */
  private readonly deviceId: string;

  /**
   * 构造审计日志仓储。
   *
   * @param store 加密存储门面
   * @param deviceId 设备标识；写入索引明文列 `deviceId`，缺省为 'local'
   */
  constructor(store: EncryptedStore, deviceId: string = DEFAULT_DEVICE_ID) {
    this.store = store;
    this.deviceId = deviceId;
  }

  /**
   * 列出审计日志。
   *
   * @param query 分页参数
   * @returns 日志列表（按时间倒序）
   */
  async list(query?: { limit?: number; offset?: number }): Promise<AuditLog[]> {
    const logs = await this.store.query<AuditLog>('auditLog', {
      orderBy: { column: 'createdAt', direction: 'desc' },
      limit: query?.limit,
      offset: query?.offset,
    });
    // createdAt 是索引明文列，但排序前需要兜底排序保证时间序准确。
    return logs.sort((a, b) => b.at.localeCompare(a.at));
  }

  /**
   * 保存一条审计日志。
   *
   * 说明：领域模型 `AuditLog`（PRD §3.1）只有 `id / at / action / target / deviceLabel / success`
   * 六个业务字段，而 `EncryptedStore` 要求实体携带 `id / version / createdAt / updatedAt / deviceId`
   * 五个**存储元字段**。这里在**落库环节**补齐存储元字段，
   * 领域模型本身保持不变（系统设计 §3.1.4）。
   *
   * @param log 日志条目
   * @returns 无异常
   * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 日志字段非法
   */
  async save(log: AuditLog): Promise<void> {
    const validated = validateAuditLog(log);
    const stored = {
      ...validated,
      version: AUDIT_INITIAL_VERSION,
      createdAt: validated.at,
      updatedAt: validated.at,
      deviceId: this.deviceId,
    };
    await this.store.put('auditLog', stored, { occurredAt: validated.at });
  }

  /**
   * 清空全部审计日志。
   *
   * 说明：调用方（UI）必须先做二次确认（X-07 ④）。
   *
   * @returns 无异常
   */
  async clear(): Promise<void> {
    await this.store.clear('auditLog');
  }
}
