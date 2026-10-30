/**
 * 保险库仓储。
 *
 * 架构位置：core 包的「仓储」层，服务于 X-03 / X-04（恢复码与保险库参数持久化）。
 *
 * 说明：`vaultParams` 与 `recoveryMeta` 走 `PlainStore`（明文白名单实体），
 * 因为解锁前就需要读取它们；其中存的是**公开 KDF 参数 + 哨兵密文 + 被包裹的 DEK**，
 * 不含任何明文密钥（X-04 ②）。
 */
import { LifeHubError } from '../errors';
import type { RecoveryMeta, VaultParams } from '../models/vault';
import { validateRecoveryMeta, validateVaultParams } from '../models/vault';
import type { PlainStore } from '../storage/plain-store';

/** 保险库参数与恢复码元数据的固定 id。 */
export const VAULT_PARAMS_ID = 'vault-params';
/** 恢复码元数据的固定 id。 */
export const RECOVERY_META_ID = 'default';

/**
 * 保险库仓储。
 */
export class VaultRepository {
  /** 明文存储门面。 */
  private readonly store: PlainStore;

  /**
   * 构造保险库仓储。
   *
   * @param store 明文存储门面
   */
  constructor(store: PlainStore) {
    this.store = store;
  }

  /**
   * 读取保险库参数。
   *
   * @returns 保险库参数；尚未创建返回 null
   */
  async load(): Promise<VaultParams | null> {
    const params = await this.store.get<VaultParams>('vaultParams', VAULT_PARAMS_ID);
    return params ? validateVaultParams(params) : null;
  }

  /**
   * 保存保险库参数。
   *
   * @param params 保险库参数
   * @returns 无异常
   * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 参数非法
   */
  async save(params: VaultParams): Promise<void> {
    const validated = validateVaultParams(params);
    await this.store.put('vaultParams', VAULT_PARAMS_ID, validated, {
      version: validated.keyVersion,
      createdAt: validated.createdAt,
      updatedAt: validated.updatedAt,
      deviceId: 'local',
    });
  }

  /**
   * 读取恢复码元数据。
   *
   * @returns 元数据；不存在返回 null
   */
  async loadRecoveryMeta(): Promise<RecoveryMeta | null> {
    const meta = await this.store.get<RecoveryMeta>('recoveryMeta', RECOVERY_META_ID);
    return meta ? validateRecoveryMeta(meta) : null;
  }

  /**
   * 保存恢复码元数据。
   *
   * 说明：**只存 checksum 与 exported 标记**，恢复码明文永不落库（X-03 ⑤）。
   *
   * @param meta 恢复码元数据
   * @returns 无异常
   * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 元数据非法
   */
  async saveRecoveryMeta(meta: RecoveryMeta): Promise<void> {
    const validated = validateRecoveryMeta(meta);
    await this.store.put('recoveryMeta', RECOVERY_META_ID, validated, {
      version: 1,
      createdAt: validated.createdAt,
      updatedAt: validated.createdAt,
      deviceId: 'local',
    });
  }

  /**
   * 标记恢复码已导出。
   *
   * @returns 成功标记恢复码导出状态后解析（无返回值）
   * @throws {LifeHubError} `LIFEHUB_E_ENTITY_NOT_FOUND` —— 尚未生成恢复码元数据
   */
  async markRecoveryExported(): Promise<void> {
    const meta = await this.loadRecoveryMeta();
    if (!meta) {
      throw new LifeHubError('LIFEHUB_E_ENTITY_NOT_FOUND');
    }
    await this.saveRecoveryMeta({ ...meta, exported: true });
  }
}
