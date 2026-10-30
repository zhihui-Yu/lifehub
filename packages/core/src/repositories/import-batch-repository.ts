/**
 * 导入批次仓储。
 *
 * 架构位置：core 包的「仓储」层，服务于 A-11（导入摘要持久化）与 A-12（幂等导入）。
 */
import type { ImportBatch } from '../models/import-batch';
import { validateImportBatch } from '../models/import-batch';
import type { EncryptedStore } from '../storage/encrypted-store';

/**
 * 导入批次仓储。
 *
 * 说明：文件哈希用于幂等判定——同一文件重复导入时提示「该文件已导入过（时间戳）」。
 */
export class ImportBatchRepository {
  /** 加密存储门面。 */
  private readonly store: EncryptedStore;

  /**
   * 构造导入批次仓储。
   *
   * @param store 加密存储门面
   */
  constructor(store: EncryptedStore) {
    this.store = store;
  }

  /**
   * 列出全部导入批次。
   *
   * @returns 批次列表（按创建时间倒序）
   */
  async list(): Promise<ImportBatch[]> {
    const batches = await this.store.query<ImportBatch>('importBatch');
    return batches.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * 按 id 取导入批次。
   *
   * @param id 批次 id
   * @returns 批次；不存在返回 null
   */
  async getById(id: string): Promise<ImportBatch | null> {
    const batch = await this.store.get<ImportBatch>('importBatch', id);
    return batch ? validateImportBatch(batch) : null;
  }

  /**
   * 按文件哈希查找导入批次（幂等判定）。
   *
   * @param fileHash 文件 sha256 hex
   * @returns 命中的批次；不存在返回 null
   */
  async findByFileHash(fileHash: string): Promise<ImportBatch | null> {
    const batches = await this.list();
    return batches.find((batch) => batch.fileHash === fileHash) ?? null;
  }

  /**
   * 保存一个导入批次。
   *
   * @param batch 批次实体
   * @returns 无异常
   * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 批次字段非法
   */
  async save(batch: ImportBatch): Promise<void> {
    const validated = validateImportBatch(batch);
    await this.store.put('importBatch', validated as unknown as Record<string, unknown>);
  }

  /**
   * 删除一个导入批次。
   *
   * @param id 批次 id
   * @returns 无异常
   */
  async delete(id: string): Promise<void> {
    await this.store.delete('importBatch', id);
  }
}
