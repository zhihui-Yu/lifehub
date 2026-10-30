/**
 * 明文存储门面。
 *
 * 架构位置：core 包的「存储」层。
 *
 * 职责边界（架构红线 R4 / 系统设计 §1.4 规则 4）：
 * - `PlainStore` **只允许**操作 `vaultParams` / `recoveryMeta` / `appSettings` 三类实体；
 * - 这三类实体本身不含明文密钥（保险库参数里存的是公开 KDF 参数 + 哨兵密文 + 被包裹的 DEK）；
 * - 其余业务实体一律必须走 `EncryptedStore`，**不存在绕过加密的写入口**。
 */
import { LifeHubError } from '../errors';
import { isPlainEntityType, PlainEntityType } from '../types/entity-type';
import type { PlainPayload, StoredRecord } from '../models/common';
import { parseWithBytes, stringifyWithBytes } from '../utils/serialize';
import type { StorageAdapter } from './adapter';

/**
 * 明文存储门面。
 *
 * 说明：所有写入都会先经过实体类型白名单校验，越权直接抛中文异常。
 */
export class PlainStore {
  /** 底层存储适配器。 */
  private readonly adapter: StorageAdapter;

  /**
   * 构造明文存储门面。
   *
   * @param adapter 存储适配器
   */
  constructor(adapter: StorageAdapter) {
    this.adapter = adapter;
  }

  /**
   * 读取一个明文实体。
   *
   * @param entityType 实体类型（必须在白名单内）
   * @param id 实体 id
   * @returns 反序列化后的对象；不存在返回 null
   * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 实体类型不在白名单内
   */
  async get<T>(entityType: PlainEntityType, id: string): Promise<T | null> {
    this.assertPlain(entityType);
    const record = await this.adapter.get(entityType, id);
    if (!record) {
      return null;
    }
    return this.parse<T>(record);
  }

  /**
   * 写入一个明文实体。
   *
   * @param entityType 实体类型（必须在白名单内）
   * @param id 实体 id
   * @param value 待写入的对象
   * @param meta 索引与版本元信息
   * @returns 无异常
   * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 实体类型不在白名单内或序列化失败
   */
  async put<T>(
    entityType: PlainEntityType,
    id: string,
    value: T,
    meta: { version: number; createdAt: string; updatedAt: string; deviceId: string },
  ): Promise<void> {
    this.assertPlain(entityType);
    const payload: PlainPayload = { kind: 'plain', json: stringifyWithBytes(value) };
    const record: StoredRecord = {
      id,
      entityType,
      version: meta.version,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      deviceId: meta.deviceId,
      localDate: null,
      occurredAt: null,
      payload,
    };
    await this.adapter.put(entityType, record);
  }

  /**
   * 删除一个明文实体。
   *
   * @param entityType 实体类型（必须在白名单内）
   * @param id 实体 id
   * @returns 无异常
   * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 实体类型不在白名单内
   */
  async delete(entityType: PlainEntityType, id: string): Promise<void> {
    this.assertPlain(entityType);
    await this.adapter.delete(entityType, id);
  }

  /**
   * 校验实体类型是否在明文白名单内。
   *
   * @param entityType 实体类型
   * @returns 无异常
   * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 实体类型不允许明文存储
   */
  private assertPlain(entityType: PlainEntityType): void {
    if (!isPlainEntityType(entityType)) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', `实体 ${entityType} 不允许明文存储，必须加密后写入`);
    }
  }

  /**
   * 解析存储记录中的明文载荷。
   *
   * @param record 存储记录
   * @returns 反序列化后的对象
   * @throws {LifeHubError} `LIFEHUB_E_STORAGE` —— 载荷类型异常或 JSON 非法
   */
  private parse<T>(record: StoredRecord): T {
    if (record.payload.kind !== 'plain') {
      throw new LifeHubError('LIFEHUB_E_STORAGE', '记录载荷不是明文类型');
    }
    try {
      return parseWithBytes(record.payload.json) as T;
    } catch {
      throw new LifeHubError('LIFEHUB_E_STORAGE', '明文载荷无法解析');
    }
  }
}
