/**
 * 加密备份服务。
 *
 * 架构位置：core 包「服务」层，服务于 A-24（加密备份导出）与 NF-PR-6。
 *
 * 核心保证（系统设计 §4.4）：
 * 1. 备份文件**直接搬运存储层密文**，不「解密再加密」，因此文件内必然不含明文；
 * 2. 备份文件**不含 salt / DEK / 主密钥**，也**不含索引明文列**；
 * 3. 导入时校验 magic / version / algorithm，不匹配给中文提示。
 */
import { BACKUP_MAGIC, BACKUP_VERSION } from '../constants';
import { LifeHubError } from '../errors';
import type { CryptoProvider } from '../crypto/provider';
import type { EncryptedBlob } from '../models/encrypted-blob';
import type { ImportSummary } from '../models/import-batch';
import type { StorageAdapter } from '../storage/adapter';
import { createRestoredStoredRecord } from '../storage/restored-record';
import type { Clock } from '../types/common';
import { EntityType } from '../types/entity-type';
import { assertCiphertextOnly } from './sync/sync-payload';

/** 备份文件结构。 */
export interface BackupFile {
  /** 文件魔数，固定为 'LIFEHUB-BACKUP'。 */
  magic: 'LIFEHUB-BACKUP';
  /** 结构版本号。 */
  version: 1;
  /** 导出时间，ISO 8601 UTC。 */
  exportedAt: string;
  /** 加密算法标识。 */
  algorithm: 'AES-256-GCM';
  /** 密钥版本。 */
  keyVersion: number;
  /** 密文 blob 列表。 */
  blobs: EncryptedBlob[];
}

/** 参与备份的业务实体类型。 */
const BACKUP_ENTITY_TYPES: readonly EntityType[] = [
  'bill',
  'category',
  'ruleTemplate',
  'importBatch',
  'auditLog',
];

/**
 * 加密备份服务。
 */
export class BackupService {
  /** 存储适配器。 */
  private readonly adapter: StorageAdapter;
  /** 时钟端口。 */
  private readonly clock: Clock;
  /** 密码学能力端口。 */
  private readonly provider: CryptoProvider;

  /**
   * 构造加密备份服务。
   *
   * @param deps 依赖集合
   */
  constructor(deps: { adapter: StorageAdapter; clock: Clock; provider: CryptoProvider }) {
    this.adapter = deps.adapter;
    this.clock = deps.clock;
    this.provider = deps.provider;
  }

  /**
   * 导出加密备份。
   *
   * @returns 备份文件对象
   */
  async exportBackup(): Promise<BackupFile> {
    const blobs: EncryptedBlob[] = [];
    let keyVersion = 1;

    for (const entityType of BACKUP_ENTITY_TYPES) {
      const records = await this.adapter.query(entityType);
      for (const record of records) {
        if (record.payload.kind !== 'encrypted') {
          // 明文载荷（vaultParams 等）**不参与备份**：
          // 备份文件不含盐值与被包裹的 DEK，导入时由用户自行保管自己的保险库。
          continue;
        }
        const payload = record.payload;
        keyVersion = Math.max(keyVersion, payload.keyVersion);
        blobs.push({
          id: record.id,
          entityType: record.entityType,
          entityId: record.id,
          ciphertext: payload.ciphertext,
          iv: payload.iv,
          tag: payload.tag,
          algorithm: 'AES-256-GCM',
          keyVersion: payload.keyVersion,
          updatedAt: record.updatedAt,
          version: record.version,
        });
      }
    }

    const file: BackupFile = {
      magic: BACKUP_MAGIC,
      version: BACKUP_VERSION,
      exportedAt: this.clock.nowIso(),
      algorithm: 'AES-256-GCM',
      keyVersion,
      blobs,
    };
    // 与同步载荷共用同一条明文断言，确保备份文件里没有漏网的明文字段（R5）。
    assertCiphertextOnly(file);
    return file;
  }

  /**
   * 导入加密备份。
   *
   * @param file 待导入的备份文件
   * @returns 导入摘要
   * @throws {LifeHubError} `LIFEHUB_E_BACKUP_INVALID` —— 魔数 / 版本 / 算法不匹配或内容非法
   */
  async importBackup(file: BackupFile): Promise<ImportSummary> {
    this.assertBackupFile(file);
    const startedAt = this.clock.now();

    let rowImported = 0;
    let rowSkipped = 0;

    for (const blob of file.blobs) {
      try {
        // 存储记录由存储层构造：索引明文列在备份中不存在，一律置 null 表示「未知」。
        const record = createRestoredStoredRecord({
          entityId: blob.entityId,
          entityType: blob.entityType,
          version: blob.version,
          updatedAt: blob.updatedAt,
          payload: {
            kind: 'encrypted',
            algorithm: 'AES-256-GCM',
            iv: blob.iv,
            ciphertext: blob.ciphertext,
            tag: blob.tag,
            keyVersion: blob.keyVersion,
          },
        });
        await this.adapter.put(blob.entityType, record);
        rowImported += 1;
      } catch {
        rowSkipped += 1;
      }
    }

    return {
      batchId: 'backup-import',
      rowTotal: file.blobs.length,
      rowImported,
      rowSkipped,
      rowDuplicated: 0,
      rowCrossSourceDuplicate: 0,
      errors: [],
      durationMs: this.clock.now().getTime() - startedAt.getTime(),
      duplicateFile: false,
    };
  }

  /**
   * 校验备份文件结构。
   *
   * @param file 待校验的备份文件
   * @returns 无异常
   * @throws {LifeHubError} `LIFEHUB_E_BACKUP_INVALID` —— 结构非法
   */
  private assertBackupFile(file: BackupFile): void {
    if (typeof file !== 'object' || file === null) {
      throw new LifeHubError('LIFEHUB_E_BACKUP_INVALID');
    }
    if (file.magic !== BACKUP_MAGIC) {
      throw new LifeHubError('LIFEHUB_E_BACKUP_INVALID');
    }
    if (file.version !== BACKUP_VERSION) {
      throw new LifeHubError('LIFEHUB_E_BACKUP_INVALID');
    }
    if (file.algorithm !== 'AES-256-GCM') {
      throw new LifeHubError('LIFEHUB_E_BACKUP_INVALID');
    }
    if (!Array.isArray(file.blobs)) {
      throw new LifeHubError('LIFEHUB_E_BACKUP_INVALID');
    }
    try {
      assertCiphertextOnly(file);
    } catch {
      throw new LifeHubError('LIFEHUB_E_BACKUP_INVALID');
    }
  }
}
