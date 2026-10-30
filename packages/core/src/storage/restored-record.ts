/**
 * 备份恢复用的存储记录工厂。
 *
 * 架构位置：core 包的「存储」层。
 *
 * 为什么单独放在这里：
 * 备份文件（`BackupFile`）只搬运**密文 blob**，不含索引明文列；
 * 但把 blob 写回本地库时，存储层仍然要求一条完整的 `StoredRecord`
 * （其中索引明文列一律为 `null`，表示「未知」）。
 * 这条记录的形状属于**存储层**的知识，因此由存储层负责构造，
 * 备份服务只负责「把 blob 交给存储层」，不必知道索引列的存在。
 */
import type { EncryptedPayload, StoredRecord } from '../models/common';
import type { EntityType } from '../types/entity-type';

/** 恢复记录的设备标识：备份来自其它设备，因此固定标记为 'restored'。 */
const RESTORED_DEVICE_ID = 'restored';

/**
 * 构造一条「从备份恢复」的存储记录。
 *
 * 说明：索引明文列（`localDate` / `occurredAt`）在备份中不存在，
 * 这里一律置 `null`——语义是「未知」，而不是「清空」。
 *
 * @param params 恢复参数
 * @returns 可直接写入存储适配器的存储记录
 */
export function createRestoredStoredRecord(params: {
  /** 实体 id。 */
  entityId: string;
  /** 实体类型。 */
  entityType: EntityType;
  /** 版本号。 */
  version: number;
  /** 最后更新时间，ISO 8601 UTC。 */
  updatedAt: string;
  /** 密文载荷。 */
  payload: EncryptedPayload;
}): StoredRecord {
  return {
    id: params.entityId,
    entityType: params.entityType,
    version: params.version,
    createdAt: params.updatedAt,
    updatedAt: params.updatedAt,
    deviceId: RESTORED_DEVICE_ID,
    localDate: null,
    occurredAt: null,
    payload: params.payload,
  };
}
