/**
 * 密钥轮换服务。
 *
 * 架构位置：core 包的「服务」层，服务于 X-10（密钥轮换）。
 *
 * 交付边界（系统设计 §1.2 难点 6）：
 * 本轮（Sprint 0）**只落数据结构与 `planRotation()` 骨架**，
 * 完整的「换 DEK 不换主密码语义 + 逐条重加密 + 可中断续跑 + 旧密钥销毁」排期在阶段 5。
 *
 * 轮换模型：
 * ```
 * newMaster ──包裹──► newDek
 *                       │
 *   oldDek ──解密──► 旧密文 ──加密(newDek)──► 新密文
 * ```
 * `previousDek` 字段用于保存「被新主密钥包裹的旧 DEK」，保证轮换中断时仍可解开未重加密的数据。
 */
import { LifeHubError } from '../errors';
import type { Clock } from '../types/common';
import { uuidV7 } from '../utils/id';

/** 轮换作业状态。 */
export type RotationStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * 轮换计划。
 *
 * 说明：由 `planRotation()` 生成，描述「要把哪些记录从哪个密钥版本迁到哪个密钥版本」。
 */
export interface KeyRotationPlan {
  /** 作业 id（用于续跑时定位状态）。 */
  jobId: string;
  /** 计划创建时间，ISO 8601 UTC。 */
  createdAt: string;
  /** 源密钥版本。 */
  fromKeyVersion: number;
  /** 目标密钥版本。 */
  toKeyVersion: number;
  /** 触发原因。 */
  reason: string;
  /** 待重加密的记录总数；本轮仅给出估算值。 */
  estimatedRecords: number;
}

/**
 * 轮换作业状态实体。
 *
 * 说明：持久化后支持 `resume(jobId)` 续跑（NF-S-7）。
 */
export interface RotationState {
  /** 作业 id。 */
  jobId: string;
  /** 当前处理到的游标（实体 id）。 */
  cursor: string | null;
  /** 已处理记录数。 */
  processedRecords: number;
  /** 作业状态。 */
  status: RotationStatus;
  /** 创建时间，ISO 8601 UTC。 */
  createdAt: string;
  /** 最后更新时间，ISO 8601 UTC。 */
  updatedAt: string;
}

/**
 * 轮换结果。
 */
export interface KeyRotationResult {
  /** 作业 id。 */
  jobId: string;
  /** 已重加密的记录数。 */
  processedRecords: number;
  /** 跳过的记录数。 */
  skippedRecords: number;
  /** 是否完成。 */
  completed: boolean;
}

/**
 * 密钥轮换服务。
 *
 * 说明：本轮只提供计划生成与状态数据结构；`execute` / `resume` 抛「未实现」异常，
 * 由阶段 5 补齐（系统设计 §7 T03 交付内容第 11 条）。
 */
export class KeyRotationService {
  /** 时钟端口。 */
  private readonly clock: Clock;

  /** 进行中的作业状态表（进程内；阶段 5 改为落库）。 */
  private readonly states = new Map<string, RotationState>();

  /**
   * 构造密钥轮换服务。
   *
   * @param deps 依赖集合
   */
  constructor(deps: { clock: Clock }) {
    this.clock = deps.clock;
  }

  /**
   * 生成一份轮换计划。
   *
   * 说明：只做计划，不做任何实际改动（阶段 5 才执行）。
   *
   * @param currentKeyVersion 当前密钥版本
   * @param reason 触发原因，如 'rotate-master-key'
   * @param estimatedRecords 待重加密记录数的估算值
   * @returns 轮换计划
   */
  async planRotation(
    currentKeyVersion: number,
    reason: string,
    estimatedRecords = 0,
  ): Promise<KeyRotationPlan> {
    const now = this.clock.nowIso();
    const plan: KeyRotationPlan = {
      jobId: uuidV7(),
      createdAt: now,
      fromKeyVersion: currentKeyVersion,
      toKeyVersion: currentKeyVersion + 1,
      reason,
      estimatedRecords,
    };
    this.states.set(plan.jobId, {
      jobId: plan.jobId,
      cursor: null,
      processedRecords: 0,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });
    return plan;
  }

  /**
   * 读取轮换作业状态。
   *
   * @param jobId 作业 id
   * @returns 作业状态；不存在返回 null
   */
  async getState(jobId: string): Promise<RotationState | null> {
    return this.states.get(jobId) ?? null;
  }

  /**
   * 列出全部轮换作业状态。
   *
   * @returns 作业状态列表
   */
  async listStates(): Promise<RotationState[]> {
    return [...this.states.values()];
  }

  /**
   * 执行轮换作业（本轮未实现）。
   *
   * @param jobId 作业 id
   * @returns 轮换结果
   * @throws {LifeHubError} `LIFEHUB_E_ROTATION_IN_PROGRESS` —— 完整实现排期在阶段 5
   */
  async execute(jobId: string): Promise<KeyRotationResult> {
    void jobId;
    throw new LifeHubError(
      'LIFEHUB_E_ROTATION_IN_PROGRESS',
      '密钥轮换的完整实现将在阶段 5 交付，本轮仅生成轮换计划',
    );
  }

  /**
   * 续跑轮换作业（本轮未实现）。
   *
   * @param jobId 作业 id
   * @returns 轮换结果
   * @throws {LifeHubError} `LIFEHUB_E_ROTATION_IN_PROGRESS` —— 完整实现排期在阶段 5
   */
  async resume(jobId: string): Promise<KeyRotationResult> {
    void jobId;
    throw new LifeHubError(
      'LIFEHUB_E_ROTATION_IN_PROGRESS',
      '密钥轮换的完整实现将在阶段 5 交付，本轮仅生成轮换计划',
    );
  }
}
