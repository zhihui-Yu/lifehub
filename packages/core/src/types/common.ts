/**
 * 跨实体共享的基础类型与注入端口。
 *
 * 架构位置：core 包的类型叶子模块。这里的接口全部是**端口（Port）**，
 * 只定义契约不实现，由外部（apps/web 的平台适配器或测试替身）注入。
 */

/**
 * 所有持久化实体的公共字段。
 *
 * 字段语义：
 * - `id`：UUIDv7，全局唯一且按时间递增，便于分页与冲突合并
 * - `createdAt` / `updatedAt`：ISO 8601 UTC 时间戳
 * - `version`：单调递增版本号，从 1 开始，冲突合并的辅助依据
 * - `deviceId`：产生该记录的设备 id（本地生成，**不是**硬件设备号）
 */
export interface BaseEntity {
  /** UUIDv7 主键。 */
  id: string;
  /** 创建时间，ISO 8601 UTC。 */
  createdAt: string;
  /** 最后更新时间，ISO 8601 UTC。 */
  updatedAt: string;
  /** 单调递增版本号，从 1 开始。 */
  version: number;
  /** 产生该记录的设备 id。 */
  deviceId: string;
}

/**
 * 可参与同步合并的实体最小契约。
 *
 * 取值依据：系统设计 §1.2 难点 5 的三方合并规则，需要 `(updatedAt, deviceId)` 作为决胜键。
 */
export interface MergeableEntity {
  /** 实体 id。 */
  id: string;
  /** 单调递增版本号。 */
  version: number;
  /** 最后更新时间，ISO 8601 UTC。 */
  updatedAt: string;
  /** 产生该记录的设备 id。 */
  deviceId: string;
}

/** 同步元信息：记录本地库最后一次成功同步的时间与游标。 */
export interface SyncMeta {
  /** 最后一次成功同步时间，ISO 8601 UTC；从未同步时为 null。 */
  lastSyncedAt: string | null;
  /** 服务端返回的增量游标；从未同步时为 null。 */
  lastSyncCursor: string | null;
}

/**
 * 时钟端口。
 *
 * 核心层禁止直接调用 `Date.now()`，统一经此端口取时间，
 * 便于测试注入固定时钟并保证时间戳口径一致。
 */
export interface Clock {
  /**
   * 取当前时刻。
   * @returns 当前时间的 Date 实例
   */
  now(): Date;
  /**
   * 取当前时刻的 ISO 8601 UTC 字符串。
   * @returns 形如 '2024-06-03T08:12:00.000Z' 的字符串
   */
  nowIso(): string;
}

/**
 * 日志端口。
 *
 * 用途仅为开发调试。系统设计 §8.5 明确禁止把口令、密钥、DEK、密文、金额、
 * 对方、备注写入任何日志通道。
 */
export interface Logger {
  /**
   * 输出调试级日志（生产构建应丢弃）。
   * @param message 日志正文
   * @param context 可选上下文（不得包含明文业务数据）
   */
  debug(message: string, context?: Record<string, unknown>): void;
  /**
   * 输出信息级日志。
   * @param message 日志正文
   * @param context 可选上下文（不得包含明文业务数据）
   */
  info(message: string, context?: Record<string, unknown>): void;
  /**
   * 输出警告级日志。
   * @param message 日志正文
   * @param context 可选上下文（不得包含明文业务数据）
   */
  warn(message: string, context?: unknown): void;
  /**
   * 输出错误级日志，只应记录错误码与堆栈。
   * @param message 日志正文
   * @param context 可选上下文（不得包含明文业务数据）
   */
  error(message: string, context?: Record<string, unknown>): void;
}

/**
 * 数据加密密钥（DEK）供给端口。
 *
 * 解锁后由 VaultService 把 DEK 注入各 Repository；锁定时实现应清零内存中的密钥。
 */
export interface DekProvider {
  /**
   * 当前是否处于解锁状态。
   * @returns 已解锁返回 true
   */
  isUnlocked(): boolean;
  /**
   * 按数据域取 DEK。
   * @param entityType 实体类型
   * @returns DEK 字节数组
   * @throws {LifeHubError} 未解锁时抛出 LIFEHUB_E_VAULT_NOT_FOUND
   */
  getDek(entityType: string): Uint8Array;
  /**
   * 取当前密钥版本号。
   * @returns 密钥版本，从 1 开始
   */
  getKeyVersion(): number;
}
