/**
 * 加密存储门面。
 *
 * 架构位置：core 包的「存储」层，是**唯一允许写入业务实体的通道**（架构红线 R4）。
 *
 * 关键保证：
 * 1. 写入前必须先加密（`EncryptedPayload`），存储层永远看不到明文金额 / 对方 / 备注；
 * 2. AAD 绑定实体身份，密文被跨记录搬移后无法解密；
 * 3. 只保留**最小索引明文列**用于范围查询与排序（ADR-006）：
 *    entityType / localDate / occurredAt / createdAt / updatedAt / version / deviceId。
 */
import { LifeHubError } from '../errors';
import type { CryptoService } from '../crypto/service';
import type { EncryptedPayload, StoredRecord } from '../models/common';
import type { EntityType } from '../types/entity-type';
import type { DekProvider } from '../types/common';
import type { StorageAdapter, StorageQueryLike } from './adapter';

/** 加密存储需要的元信息。 */
export interface EncryptedStoreMeta {
  /** 实体 id。 */
  id: string;
  /** 版本号。 */
  version: number;
  /** 创建时间，ISO 8601 UTC。 */
  createdAt: string;
  /** 更新时间，ISO 8601 UTC。 */
  updatedAt: string;
  /** 设备 id。 */
  deviceId: string;
  /** 索引明文列：本地日历日。 */
  localDate?: string | null;
  /** 索引明文列：UTC 时间戳。 */
  occurredAt?: string | null;
}

/**
 * 加密存储门面。
 *
 * 说明：依赖 `DekProvider` 取当前密钥，未解锁时拒绝一切读写业务实体的操作。
 */
export class EncryptedStore {
  /** 底层存储适配器。 */
  private readonly adapter: StorageAdapter;
  /** 加密服务。 */
  private readonly crypto: CryptoService;
  /** 密钥供给器。 */
  private readonly dek: DekProvider;

  /**
   * 构造加密存储门面。
   *
   * @param deps 依赖集合
   */
  constructor(deps: { adapter: StorageAdapter; crypto: CryptoService; dek: DekProvider }) {
    this.adapter = deps.adapter;
    this.crypto = deps.crypto;
    this.dek = deps.dek;
  }

  /**
   * 写入一个业务实体（先加密后写）。
   *
   * @param entityType 实体类型
   * @param entity 业务实体（需含 id / version / createdAt / updatedAt / deviceId）
   * @param index 额外的索引明文列
   * @returns 无异常
   * @throws {LifeHubError} `LIFEHUB_E_VAULT_NOT_FOUND` —— 未解锁；`LIFEHUB_E_VALIDATION` —— 实体缺少必要字段
   */
  async put<T extends Record<string, unknown>>(
    entityType: EntityType,
    entity: T,
    index?: { localDate?: string | null; occurredAt?: string | null },
  ): Promise<void> {
    this.assertUnlocked();
    const meta = this.extractMeta(entity);
    const payload = await this.crypto.encryptRecord(
      this.dek.getDek(entityType),
      entityType,
      meta.id,
      this.dek.getKeyVersion(),
      entity,
    );
    const record: StoredRecord = {
      id: meta.id,
      entityType,
      version: meta.version,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      deviceId: meta.deviceId,
      localDate: index?.localDate ?? null,
      occurredAt: index?.occurredAt ?? null,
      payload,
    };
    await this.adapter.put(entityType, record);
  }

  /**
   * 批量写入业务实体。
   *
   * @param entityType 实体类型
   * @param entities 业务实体列表
   * @param indexOf 为每个实体提供索引明文列
   * @returns 无异常
   */
  async putMany<T extends Record<string, unknown>>(
    entityType: EntityType,
    entities: readonly T[],
    indexOf?: (entity: T) => { localDate?: string | null; occurredAt?: string | null },
  ): Promise<void> {
    this.assertUnlocked();
    const records: StoredRecord[] = [];
    const dek = this.dek.getDek(entityType);
    const keyVersion = this.dek.getKeyVersion();
    for (const entity of entities) {
      const meta = this.extractMeta(entity);
      const payload = await this.crypto.encryptRecord(dek, entityType, meta.id, keyVersion, entity);
      const index = indexOf?.(entity) ?? {};
      records.push({
        id: meta.id,
        entityType,
        version: meta.version,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        deviceId: meta.deviceId,
        localDate: index.localDate ?? null,
        occurredAt: index.occurredAt ?? null,
        payload,
      });
    }
    if (records.length > 0) {
      await this.adapter.putMany(entityType, records);
    }
  }

  /**
   * 读取并解密一个业务实体。
   *
   * @param entityType 实体类型
   * @param id 实体 id
   * @returns 业务实体；不存在返回 null
   */
  async get<T>(entityType: EntityType, id: string): Promise<T | null> {
    this.assertUnlocked();
    const record = await this.adapter.get(entityType, id);
    if (!record) {
      return null;
    }
    return this.decryptRecord<T>(entityType, record);
  }

  /**
   * 批量读取并解密业务实体。
   *
   * @param entityType 实体类型
   * @param ids 实体 id 列表
   * @returns 业务实体列表
   */
  async getMany<T>(entityType: EntityType, ids: readonly string[]): Promise<T[]> {
    this.assertUnlocked();
    const records = await this.adapter.getMany(entityType, ids);
    const out: T[] = [];
    for (const record of records) {
      out.push(await this.decryptRecord<T>(entityType, record));
    }
    return out;
  }

  /**
   * 条件查询并解密业务实体。
   *
   * 说明：范围过滤与排序在存储层用**索引明文列**完成，只有返回的页内记录才解密，
   * 因此 10 万行场景下不会全量解密（系统设计 §4.3 关键点 5）。
   *
   * @param entityType 实体类型
   * @param filter 查询条件
   * @returns 业务实体列表
   */
  async query<T>(entityType: EntityType, filter?: StorageQueryLike): Promise<T[]> {
    this.assertUnlocked();
    const records = await this.adapter.query(entityType, filter);
    const out: T[] = [];
    for (const record of records) {
      out.push(await this.decryptRecord<T>(entityType, record));
    }
    return out;
  }

  /**
   * 删除一个业务实体。
   *
   * @param entityType 实体类型
   * @param id 实体 id
   * @returns 无异常
   */
  async delete(entityType: EntityType, id: string): Promise<void> {
    this.assertUnlocked();
    await this.adapter.delete(entityType, id);
  }

  /**
   * 批量删除业务实体。
   *
   * @param entityType 实体类型
   * @param ids 实体 id 列表
   * @returns 无异常
   */
  async deleteMany(entityType: EntityType, ids: readonly string[]): Promise<void> {
    this.assertUnlocked();
    await this.adapter.deleteMany(entityType, ids);
  }

  /**
   * 统计符合条件的记录数。
   *
   * @param entityType 实体类型
   * @param filter 查询条件
   * @returns 记录数
   */
  async count(entityType: EntityType, filter?: StorageQueryLike): Promise<number> {
    this.assertUnlocked();
    return this.adapter.count(entityType, filter);
  }

  /**
   * 清空某类业务实体。
   *
   * @param entityType 实体类型
   * @returns 无异常
   */
  async clear(entityType: EntityType): Promise<void> {
    this.assertUnlocked();
    await this.adapter.clear(entityType);
  }

  /**
   * 解密单条存储记录。
   *
   * @param entityType 实体类型
   * @param record 存储记录
   * @returns 业务实体
   * @throws {LifeHubError} `LIFEHUB_E_CRYPTO_AUTH_FAILED` —— 认证失败
   */
  private async decryptRecord<T>(entityType: EntityType, record: StoredRecord): Promise<T> {
    if (record.payload.kind !== 'encrypted') {
      throw new LifeHubError('LIFEHUB_E_CRYPTO_AUTH_FAILED', '业务实体必须是密文载荷');
    }
    const payload = record.payload as EncryptedPayload;
    return this.crypto.decryptRecord<T>(
      this.dek.getDek(entityType),
      entityType,
      record.id,
      payload.keyVersion,
      payload,
    );
  }

  /**
   * 从业务实体中抽取存储元信息。
   *
   * @param entity 业务实体
   * @returns 存储元信息
   * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 缺少必要字段
   */
  private extractMeta(entity: Record<string, unknown>): EncryptedStoreMeta {
    const id = entity['id'];
    const version = entity['version'];
    const createdAt = entity['createdAt'];
    const updatedAt = entity['updatedAt'];
    const deviceId = entity['deviceId'];
    if (
      typeof id !== 'string' ||
      typeof version !== 'number' ||
      typeof createdAt !== 'string' ||
      typeof updatedAt !== 'string' ||
      typeof deviceId !== 'string'
    ) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', '实体缺少 id / version / createdAt / updatedAt / deviceId');
    }
    return { id, version, createdAt, updatedAt, deviceId };
  }

  /**
   * 断言当前保险库已解锁。
   *
   * @returns 无异常
   * @throws {LifeHubError} `LIFEHUB_E_VAULT_NOT_FOUND` —— 未解锁
   */
  private assertUnlocked(): void {
    if (!this.dek.isUnlocked()) {
      throw new LifeHubError('LIFEHUB_E_VAULT_NOT_FOUND');
    }
  }
}
