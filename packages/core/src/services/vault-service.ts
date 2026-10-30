/**
 * 保险库服务。
 *
 * 架构位置：core 包的「服务」层，是 X-03 / X-04 / A-07 的主入口。
 *
 * 密钥体系（系统设计 §1.2 难点 6）：
 * ```
 * 用户口令 ──scrypt──► 主密钥(masterKey) ──包裹──► DEK ──AES-GCM──► 业务密文
 * 恢复码   ──scrypt──► 恢复密钥        ──包裹──► DEK（同一把）
 * ```
 * 主密钥只用于包裹 DEK，不直接加密业务数据；这样改口令时只需重包裹 + 重加密存量密文。
 *
 * 安全红线：
 * - **不存储口令哈希**：用主密钥加密固定哨兵 `lifehub:verify:v1` 来校验口令（A-07 ⑦）；
 * - 恢复码明文**不落本地库**，本地只存 checksum、恢复盐值、恢复 KDF 参数与被恢复密钥包裹的 DEK（X-03 ⑤）；
 * - 解锁失败同样记审计（X-07 ②）。
 *
 * 设计增量（主理人批准）：恢复码派生出的「恢复密钥」直接包裹 DEK，
 * 因此恢复码等价于一把能解开数据密钥的备用钥匙（PRD §3.3）。
 */
import {
  MIN_PASSWORD_LENGTH,
  UNLOCK_COOLDOWN_MS,
  UNLOCK_COOLDOWN_THRESHOLD,
  VAULT_VERIFIER_ID,
  VAULT_VERIFIER_PLAINTEXT,
} from '../constants';
import { LifeHubError } from '../errors';
import type { CryptoProvider } from '../crypto/provider';
import { createKdfParams, KdfParams } from '../crypto/kdf';
import { CryptoService } from '../crypto/service';
import { computeRecoveryChecksum, generateRecoveryCode, validateRecoveryCode } from '../crypto/recovery-code';
import type { AuditLog } from '../models/audit';
import type { PendingAuditEntry, RecoveryBundle, RecoveryMeta, VaultParams, WrappedDek } from '../models/vault';
import type { VaultRepository } from '../repositories/vault-repository';
import type { StorageAdapter } from '../storage/adapter';
import type { Clock } from '../types/common';
import { uuidV7 } from '../utils/id';
import type { AuditLogger } from './audit-logger';
import type { KeyRotationPlan } from './key-rotation-service';

/** 创建保险库的结果。 */
export interface VaultSetup {
  /** 已落盘的保险库参数。 */
  vaultParams: VaultParams;
  /** 恢复码包（一次性展示，用户确认已导出后由 UI 丢弃）。 */
  recoveryBundle: RecoveryBundle;
  /** 主密钥，仅驻留内存。 */
  masterKey: Uint8Array;
  /** 数据加密密钥，仅驻留内存。
   *
   * 说明：调用方必须把它装进自己的 `DekProvider`，
   * 否则建库之后立刻写入的业务数据会用错密钥加密（A-07）。 */
  dek: Uint8Array;
}

/** 解锁结果。 */
export interface UnlockedVault {
  /** 数据加密密钥。 */
  dek: Uint8Array;
  /** 主密钥，仅驻留内存。
   *
   * 说明：用恢复码解锁时返回的是**恢复密钥**——它同样能解开 DEK 包裹，
   * 但与口令派生的主密钥不是同一份材料（PRD §3.3）。 */
  masterKey: Uint8Array;
  /** 当前密钥版本。 */
  keyVersion: number;
}

/** 恢复码包的内部构造结果：对外的包 + 落盘的元数据。 */
interface BuiltRecoveryBundle {
  /** 对外暴露的恢复码包（用户导出用）。 */
  bundle: RecoveryBundle;
  /** 落盘的恢复码元数据（不含恢复码明文）。 */
  meta: RecoveryMeta;
}

/**
 * 保险库服务。
 */
export class VaultService {
  /** 存储适配器。 */
  private readonly adapter: StorageAdapter;
  /** 加密服务。 */
  private readonly crypto: CryptoService;
  /** 密码学能力端口。 */
  private readonly provider: CryptoProvider;
  /** 保险库仓储。 */
  private readonly repository: VaultRepository;
  /** 审计日志服务。 */
  private readonly audit: AuditLogger;
  /** 时钟端口。 */
  private readonly clock: Clock;
  /** 当前会话的 DEK（仅驻留内存）；重新生成恢复码时需要用它重新包裹。 */
  private sessionDek: Uint8Array | null = null;
  /** 外部 DEK 供给器（可选）：用于在服务实例重建后仍能取到当前 DEK。 */
  private readonly currentDekProvider: (() => Uint8Array | null) | undefined;
  /** DEK 就绪回调（可选）：调用方用它把 DEK 装进自己的 `DekProvider`。 */
  private readonly onDekAvailable: ((dek: Uint8Array, keyVersion: number) => void) | undefined;

  /** 连续解锁失败次数（速率限制用）。 */
  private failedAttempts = 0;
  /** 冷却截止时间戳；为 0 表示未冷却。 */
  private cooldownUntil = 0;

  /**
   * 构造保险库服务。
   *
   * @param deps 依赖集合
   */
  constructor(deps: {
    adapter: StorageAdapter;
    crypto: CryptoService;
    provider: CryptoProvider;
    repository: VaultRepository;
    audit: AuditLogger;
    clock: Clock;
    /** 可选：返回当前 DEK 的供给函数；重新生成恢复码时需要复用同一把 DEK。 */
    currentDek?: () => Uint8Array | null;
    /** 可选：DEK 就绪回调；在写「建库 / 解锁」审计之前调用。 */
    onDekAvailable?: (dek: Uint8Array, keyVersion: number) => void;
  }) {
    this.adapter = deps.adapter;
    this.crypto = deps.crypto;
    this.provider = deps.provider;
    this.repository = deps.repository;
    this.audit = deps.audit;
    this.clock = deps.clock;
    this.currentDekProvider = deps.currentDek;
    this.onDekAvailable = deps.onDekAvailable;
    // 解锁失败时加密审计写不进去（锁定态），交给 VaultService 暂存到明文白名单，
    // 成功解锁后再刷入加密审计（X-07 ② / B-4）。
    this.audit.setOnWriteFailure((entry) => this.stageFailedAudit(entry));
  }

  /**
   * 判断是否已创建过保险库（首次进入引导）。
   *
   * @returns 已创建返回 true
   */
  async isVaultCreated(): Promise<boolean> {
    const params = await this.repository.load();
    return params !== null;
  }

  /**
   * 创建保险库。
   *
   * 流程：派生主密钥 → 生成 DEK → 包裹 DEK → 写哨兵 → 生成恢复码 → 落盘 → 记审计。
   *
   * @param password 用户设置的主口令
   * @returns 保险库参数、恢复码包与主密钥
   * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 口令过短；`LIFEHUB_E_VAULT_NOT_FOUND` —— 存储不可用
   */
  async createVault(password: string): Promise<VaultSetup> {
    this.assertPasswordStrength(password);
    await this.assertNotCreated();

    const salt = this.provider.randomBytes(16);
    const kdfParams = createKdfParams(salt);
    const masterKey = await this.provider.deriveKey(kdfParams, password);

    const keyVersion = 1;
    const dek = this.provider.randomBytes(32);
    const currentDek: WrappedDek = await this.crypto.wrapDek(masterKey, dek, keyVersion);

    // 哨兵：用主密钥加密固定明文，解锁时解密成功即证明口令正确（不存口令哈希）。
    const verifier = await this.crypto.encryptRecord(
      masterKey,
      'vaultParams',
      VAULT_VERIFIER_ID,
      keyVersion,
      VAULT_VERIFIER_PLAINTEXT,
    );

    const now = this.clock.nowIso();
    const vaultParams: VaultParams = {
      kdf: 'scrypt',
      n: kdfParams.n,
      r: kdfParams.r,
      p: kdfParams.p,
      keyLength: kdfParams.keyLength,
      salt: kdfParams.salt,
      verifier,
      paramsVersion: 1,
      keyVersion,
      currentDek,
      previousDek: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.save(vaultParams);

    // 恢复码包：用恢复密钥包裹同一把 DEK，恢复码因此可独立解开数据（PRD §3.3）。
    const recovery = await this.buildRecoveryBundle(dek, keyVersion);
    await this.repository.saveRecoveryMeta(recovery.meta);

    this.sessionDek = dek;
    // 先把 DEK 交给调用方装进 `DekProvider`，
    // 这样「建库」这条审计日志才会用**正确**的密钥加密落盘（否则它会写失败或写错密钥）。
    this.onDekAvailable?.(dek, keyVersion);
    await this.audit.log('create_vault', 'vault', true);
    return { vaultParams, recoveryBundle: recovery.bundle, masterKey, dek };
  }

  /**
   * 用口令解锁保险库。
   *
   * @param password 用户输入的主口令
   * @returns 解锁结果（DEK + 主密钥 + 密钥版本）
   * @throws {LifeHubError} `LIFEHUB_E_VAULT_NOT_FOUND` —— 尚未创建；`LIFEHUB_E_VAULT_PASSWORD_WRONG` —— 口令错误
   */
  async unlock(password: string): Promise<UnlockedVault> {
    const params = await this.repository.load();
    if (!params) {
      throw new LifeHubError('LIFEHUB_E_VAULT_NOT_FOUND');
    }
    // 从持久化状态恢复速率限制（NF-S-8：刷新页面后冷却不失效，B-4）。
    this.restoreRateLimitState(params);
    this.assertNotCoolingDown();

    const kdfParams = this.toKdfParams(params);
    const masterKey = await this.provider.deriveKey(kdfParams, password);
    const ok = await this.crypto.verifyPassword(masterKey, params.verifier);
    if (!ok) {
      // 锁定态下这条审计写不进加密库，会经 onWriteFailure 暂存到明文白名单。
      await this.recordFailedUnlock('');
      // 统一抛「口令不正确」，不区分「口令错」与「数据损坏」，避免信息泄露（§4.3 关键点 2）。
      throw new LifeHubError('LIFEHUB_E_VAULT_PASSWORD_WRONG');
    }

    this.failedAttempts = 0;
    this.cooldownUntil = 0;
    const dek = await this.crypto.unwrapDek(masterKey, params.currentDek);
    this.sessionDek = dek;
    // 同建库流程：先安装 DEK，再写审计，保证审计条目用的是当前密钥。
    this.onDekAvailable?.(dek, params.keyVersion);
    // 先刷入暂存的失败审计（现在 DEK 已安装），再清零速率限制状态。
    const flushed = await this.flushPendingAudits(params);
    await this.repository.save({
      ...flushed,
      failedAttempts: 0,
      cooldownUntil: 0,
      updatedAt: this.clock.nowIso(),
    });
    await this.audit.log('unlock', '', true);
    return { dek, masterKey, keyVersion: params.keyVersion };
  }

  /**
   * 用恢复码解锁保险库。
   *
   * 说明：恢复码先用「恢复盐值 + 恢复 KDF 参数」派生出恢复密钥，
   * 再用恢复密钥解开被它包裹的 DEK——因此恢复码等价于一把「恢复 DEK」的备用钥匙
   * （PRD §3.3，主理人批准的设计增量）。
   *
   * 错误码约定：
   * - 恢复码格式非法 / 本地没有恢复码元数据 → `LIFEHUB_E_RECOVERY_INVALID`；
   * - 恢复码本身不匹配（校验和不符或解包失败）→ `LIFEHUB_E_VAULT_PASSWORD_WRONG`，
   *   与口令错误保持同一文案，避免向攻击者泄露「恢复码存在但不对」这类信息。
   *
   * @param code 用户输入的恢复码
   * @returns 解锁结果（DEK + 恢复密钥 + 密钥版本）
   * @throws {LifeHubError} `LIFEHUB_E_VAULT_NOT_FOUND` —— 尚未创建；`LIFEHUB_E_RECOVERY_INVALID` —— 恢复码格式错误；`LIFEHUB_E_VAULT_PASSWORD_WRONG` —— 恢复码不匹配
   */
  async unlockWithRecoveryCode(code: string): Promise<UnlockedVault> {
    const params = await this.repository.load();
    if (!params) {
      throw new LifeHubError('LIFEHUB_E_VAULT_NOT_FOUND');
    }
    // 从持久化状态恢复速率限制（与口令解锁一致，B-4）。
    this.restoreRateLimitState(params);
    this.assertNotCoolingDown();

    const meta = await this.repository.loadRecoveryMeta();
    if (!meta) {
      throw new LifeHubError('LIFEHUB_E_RECOVERY_INVALID', '尚未生成恢复码，请先在安全页生成并导出');
    }

    // 第零步：先校验恢复码的**格式**（分组数、字符集、组内校验位）。
    // 必须先做格式校验再比对 checksum：格式非法的输入其 checksum 必然对不上，
    // 若跳过这一步会误报为「口令不正确」，让用户以为恢复码本身是错的。
    // 错误码约定见系统设计 §3.4：格式或校验位错误 → LIFEHUB_E_RECOVERY_INVALID；
    // 格式合法但内容不匹配 → LIFEHUB_E_VAULT_PASSWORD_WRONG（PRD X-03 ④「提示格式错误」）。
    if (!validateRecoveryCode(code)) {
      // 解锁失败同样要记审计（X-07 ②），否则用户无法察觉有人在爆破恢复码。
      await this.recordFailedUnlock('recovery');
      throw new LifeHubError('LIFEHUB_E_RECOVERY_INVALID');
    }

    // 第一步：用恢复盐值校验恢复码本身（sha256(恢复码 + 盐值)）。
    const checksum = await computeRecoveryChecksum(this.provider, code, meta.salt);
    if (checksum !== meta.checksum) {
      await this.recordFailedUnlock('recovery');
      throw new LifeHubError('LIFEHUB_E_VAULT_PASSWORD_WRONG');
    }

    // 第二步：用恢复码派生恢复密钥，再解包被它包裹的 DEK。
    const recoveryKey = await this.provider.deriveKey(this.toRecoveryKdfParams(meta), code);
    let dek: Uint8Array;
    try {
      dek = await this.crypto.unwrapDek(recoveryKey, meta.wrappedDek);
    } catch {
      // 校验和能对上但解包失败，说明本地数据被篡改或损坏；对外仍统一为「口令不正确」。
      await this.recordFailedUnlock('recovery');
      throw new LifeHubError('LIFEHUB_E_VAULT_PASSWORD_WRONG');
    }

    this.failedAttempts = 0;
    this.cooldownUntil = 0;
    this.sessionDek = dek;
    // 同建库流程：先安装 DEK，再写审计，保证审计条目用的是当前密钥。
    this.onDekAvailable?.(dek, params.keyVersion);
    // 先刷入暂存的失败审计，再清零速率限制状态。
    const flushed = await this.flushPendingAudits(params);
    await this.repository.save({
      ...flushed,
      failedAttempts: 0,
      cooldownUntil: 0,
      updatedAt: this.clock.nowIso(),
    });
    await this.audit.log('recover', 'recovery', true);
    return { dek, masterKey: recoveryKey, keyVersion: params.keyVersion };
  }

  /**
   * 生成 / 重新生成恢复码与盐值备份。
   *
   * 说明：幂等语义为「新生成会使旧恢复码失效」——
   * 重新生成会换用**新的恢复盐值、新的恢复 KDF 参数与新的包裹密钥**，
   * 并用**同一把 DEK** 重新包裹（DEK 本身不变，只换包裹它的恢复密钥），
   * 因此旧恢复码的校验和与包裹内容同时失效。
   *
   * @returns 新的恢复码包
   * @throws {LifeHubError} `LIFEHUB_E_VAULT_NOT_FOUND` —— 尚未创建保险库，或保险库未解锁（无法取得 DEK）
   */
  async generateRecoveryBundle(): Promise<RecoveryBundle> {
    const params = await this.repository.load();
    if (!params) {
      throw new LifeHubError('LIFEHUB_E_VAULT_NOT_FOUND');
    }
    const dek = this.resolveCurrentDek();
    if (!dek) {
      throw new LifeHubError('LIFEHUB_E_VAULT_NOT_FOUND', '请先解锁保险库后再重新生成恢复码');
    }
    const recovery = await this.buildRecoveryBundle(dek, params.keyVersion);
    await this.repository.saveRecoveryMeta(recovery.meta);
    return recovery.bundle;
  }

  /**
   * 修改主密码。
   *
   * 说明：本轮（Sprint 0）只落**接口 + 参数校验 + 轮换计划**，
   * 完整的「重包裹 DEK + 重加密存量密文 + 可中断续跑」在阶段 5 实现
   * （系统设计 §1.2 难点 6、X-10）。
   *
   * @param oldPassword 旧主口令
   * @param newPassword 新主口令
   * @returns 轮换计划
   * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 参数非法；`LIFEHUB_E_VAULT_PASSWORD_WRONG` —— 旧口令错误
   */
  async rotateMasterKey(oldPassword: string, newPassword: string): Promise<KeyRotationPlan> {
    this.assertPasswordStrength(newPassword);
    if (oldPassword === newPassword) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', '新口令不能与旧口令相同');
    }
    // 校验旧口令正确，确保轮换计划建立在合法前提上。
    await this.unlock(oldPassword);
    const params = await this.repository.load();
    if (!params) {
      throw new LifeHubError('LIFEHUB_E_VAULT_NOT_FOUND');
    }
    await this.audit.log('rotate_key', 'master-key', true);
    return {
      jobId: uuidV7(),
      createdAt: this.clock.nowIso(),
      fromKeyVersion: params.keyVersion,
      toKeyVersion: params.keyVersion + 1,
      reason: 'rotate-master-key',
      estimatedRecords: 0,
    };
  }

  /**
   * 构造恢复码包与对应的恢复码元数据。
   *
   * 说明：恢复码用**独立的盐值**派生一把「恢复密钥」，
   * 它与口令派生的主密钥相互独立，因此恢复码泄露不影响口令安全，反之亦然。
   * 恢复密钥负责包裹 DEK——这正是「恢复码等价于一把恢复 DEK 的备用钥匙」的实现方式。
   *
   * @param dek 待包裹的数据加密密钥（必须与保险库当前 DEK 相同）
   * @param keyVersion 当前密钥版本
   * @returns 恢复码包与恢复码元数据
   */
  private async buildRecoveryBundle(dek: Uint8Array, keyVersion: number): Promise<BuiltRecoveryBundle> {
    const recoverySalt = this.provider.randomBytes(16);
    const recoveryCode = generateRecoveryCode((length) => this.provider.randomBytes(length));
    const recoveryKdf: KdfParams = createKdfParams(recoverySalt);
    const recoveryKey = await this.provider.deriveKey(recoveryKdf, recoveryCode);
    // 用恢复密钥包裹 DEK：只有恢复码能把它解开。
    const wrappedDek: WrappedDek = await this.crypto.wrapDek(recoveryKey, dek, keyVersion);
    const verifier = await this.crypto.encryptRecord(
      recoveryKey,
      'vaultParams',
      VAULT_VERIFIER_ID,
      keyVersion,
      VAULT_VERIFIER_PLAINTEXT,
    );
    const checksum = await computeRecoveryChecksum(this.provider, recoveryCode, recoverySalt);
    const createdAt = this.clock.nowIso();
    const kdfParams = {
      kdf: 'scrypt' as const,
      n: recoveryKdf.n,
      r: recoveryKdf.r,
      p: recoveryKdf.p,
      keyLength: recoveryKdf.keyLength,
    };
    return {
      bundle: {
        version: 1,
        recoveryCode,
        salt: recoverySalt,
        kdfParams,
        verifier,
        checksum,
        createdAt,
      },
      meta: {
        id: 'default',
        checksum,
        exported: false,
        createdAt,
        salt: recoverySalt,
        kdfParams,
        wrappedDek,
      },
    };
  }

  /**
   * 把恢复码元数据还原为 KDF 参数对象。
   *
   * @param meta 恢复码元数据
   * @returns 恢复用的 KDF 参数
   */
  private toRecoveryKdfParams(meta: RecoveryMeta): KdfParams {
    return {
      algorithm: 'scrypt',
      n: meta.kdfParams.n,
      r: meta.kdfParams.r,
      p: meta.kdfParams.p,
      keyLength: meta.kdfParams.keyLength,
      salt: meta.salt,
    };
  }

  /**
   * 取得当前可用的 DEK。
   *
   * 说明：优先用本会话解锁时拿到的 DEK；服务实例被重建时退回到外部供给器。
   * 两者都拿不到说明保险库未解锁——此时无法用恢复密钥重新包裹 DEK。
   *
   * @returns DEK 字节数组；不可用返回 null
   */
  private resolveCurrentDek(): Uint8Array | null {
    if (this.sessionDek) {
      return this.sessionDek;
    }
    return this.currentDekProvider?.() ?? null;
  }

  /**
   * 把保险库参数还原为 KDF 参数对象。
   *
   * @param params 保险库参数
   * @returns KDF 参数
   */
  private toKdfParams(params: VaultParams): KdfParams {
    return {
      algorithm: 'scrypt',
      n: params.n,
      r: params.r,
      p: params.p,
      keyLength: params.keyLength,
      salt: params.salt,
    };
  }

  /**
   * 校验口令强度。
   *
   * @param password 待校验口令
   * @returns 无异常
   * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 口令长度不足
   */
  private assertPasswordStrength(password: string): void {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', `主口令长度至少 ${MIN_PASSWORD_LENGTH} 位`);
    }
  }

  /**
   * 断言保险库尚未创建。
   *
   * @returns 无异常
   * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 保险库已存在
   */
  private async assertNotCreated(): Promise<void> {
    const params = await this.repository.load();
    if (params) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', '保险库已存在，不能重复创建');
    }
  }

  /**
   * 断言当前不在冷却期。
   *
   * @returns 无异常
   * @throws {LifeHubError} `LIFEHUB_E_VAULT_PASSWORD_WRONG` —— 冷却中
   */
  private assertNotCoolingDown(): void {
    if (this.cooldownUntil > Date.now()) {
      throw new LifeHubError('LIFEHUB_E_VAULT_PASSWORD_WRONG', '尝试次数过多，请稍后再试');
    }
  }

  /**
   * 失败次数达到阈值时进入冷却（NF-S-8：连续 5 次错误后冷却 30 秒）。
   *
   * @returns 无异常
   */
  private applyCooldownIfNeeded(): void {
    if (this.failedAttempts >= UNLOCK_COOLDOWN_THRESHOLD) {
      this.cooldownUntil = Date.now() + UNLOCK_COOLDOWN_MS;
      this.failedAttempts = 0;
    }
  }

  /**
   * 从持久化的保险库参数恢复速率限制状态。
   *
   * 说明：`failedAttempts` / `cooldownUntil` 落盘在明文 `vaultParams` 中，
   * 服务实例重建（刷新页面）后从这里恢复，冷却不会因刷新而失效（B-4）。
   *
   * @param params 保险库参数
   * @returns 无异常
   */
  private restoreRateLimitState(params: VaultParams): void {
    this.failedAttempts = params.failedAttempts ?? 0;
    this.cooldownUntil = params.cooldownUntil ?? 0;
  }

  /**
   * 把当前速率限制状态持久化到保险库参数。
   *
   * 说明：从存储重新读取最新参数后再写回，避免覆盖并发暂存的
   * `pendingAuditEntries`；同时更新 `updatedAt`。这些字段是明文白名单内的
   * 元数据，不含任何业务语义（B-4）。
   *
   * @returns 无异常
   */
  private async persistRateLimitState(): Promise<void> {
    const latest = await this.repository.load();
    if (!latest) {
      return;
    }
    await this.repository.save({
      ...latest,
      failedAttempts: this.failedAttempts,
      cooldownUntil: this.cooldownUntil,
      updatedAt: this.clock.nowIso(),
    });
  }

  /**
   * 记录一次解锁失败并持久化速率限制状态。
   *
   * 说明：锁定态下 `failed_unlock` 审计写不进加密库，会经 `onWriteFailure`
   * 暂存到明文白名单；这里同时把失败计数与冷却状态落盘（B-4）。
   *
   * @param target 作用对象（口令解锁为空串，恢复码为 'recovery'）
   * @returns 无异常
   */
  private async recordFailedUnlock(target: string): Promise<void> {
    this.failedAttempts += 1;
    await this.audit.log('failed_unlock', target, false);
    this.applyCooldownIfNeeded();
    await this.persistRateLimitState();
  }

  /**
   * 暂存一条写不进加密库的失败审计条目。
   *
   * 说明：这是 `AuditLogger.onWriteFailure` 的回调实现——解锁失败时保险库锁定、
   * 加密审计写不进去，条目先暂存到 `vaultParams.pendingAuditEntries`
   * （只含时间 / 动作 / 对象 / 设备标签 / 成败，**无任何业务数据**）。
   *
   * @param entry 写库失败的审计条目
   * @returns 无异常
   */
  private async stageFailedAudit(entry: AuditLog): Promise<void> {
    const params = await this.repository.load();
    if (!params) {
      return;
    }
    const pending = [...(params.pendingAuditEntries ?? [])];
    pending.push({
      at: entry.at,
      action: entry.action,
      target: entry.target,
      deviceLabel: entry.deviceLabel,
      success: entry.success,
    });
    await this.repository.save({ ...params, pendingAuditEntries: pending, updatedAt: this.clock.nowIso() });
  }

  /**
   * 把暂存的失败审计条目刷入加密审计库。
   *
   * 说明：成功解锁后 DEK 已安装，此时把之前因锁定态写不进去的失败条目补写入库；
   * 仍写不进的条目保留在队列里，下次解锁再试。
   *
   * @param params 保险库参数
   * @returns 刷入后（可能已清空暂存队列）的保险库参数
   */
  private async flushPendingAudits(params: VaultParams): Promise<VaultParams> {
    const pending = params.pendingAuditEntries ?? [];
    if (pending.length === 0) {
      return params;
    }
    const remaining: PendingAuditEntry[] = [];
    for (const entry of pending) {
      const ok = await this.audit.restore({
        id: uuidV7(),
        at: entry.at,
        action: entry.action,
        target: entry.target,
        deviceLabel: entry.deviceLabel,
        success: entry.success,
      });
      if (!ok) {
        remaining.push(entry);
      }
    }
    if (remaining.length === pending.length) {
      return params;
    }
    return { ...params, pendingAuditEntries: remaining, updatedAt: this.clock.nowIso() };
  }

  /**
   * 取当前连续失败次数（供 UI 展示剩余尝试次数）。
   *
   * @returns 失败次数
   */
  getFailedAttempts(): number {
    return this.failedAttempts;
  }

  /**
   * 取当前冷却剩余毫秒数。
   *
   * @returns 剩余毫秒数；未冷却返回 0
   */
  getCooldownRemainingMs(): number {
    return Math.max(0, this.cooldownUntil - Date.now());
  }

  /**
   * 读取恢复码元数据（不含恢复码明文）。
   *
   * @returns 元数据；不存在返回 null
   */
  async loadRecoveryMeta(): Promise<RecoveryMeta | null> {
    return this.repository.loadRecoveryMeta();
  }

  /**
   * 取得底层存储适配器（供备份服务等协作者复用同一份连接）。
   *
   * @returns 存储适配器
   */
  getAdapter(): StorageAdapter {
    return this.adapter;
  }
}
