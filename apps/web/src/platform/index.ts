/**
 * 平台适配层装配。
 *
 * 架构位置：apps/web 的「平台适配」层入口。
 *
 * 说明：这里是**唯一**把 core 的端口与浏览器具体实现缝合起来的地方。
 * 领域层（packages/core）通过依赖注入拿到 `CryptoProvider` / `StorageAdapter`，
 * 从而保持零 DOM 依赖（架构红线 R1 / PRD X-08）。
 */
import {
  AuditLogRepository,
  AuditLogger,
  BillRepository,
  CategoryRepository,
  CsvParser,
  CryptoService,
  EncryptedStore,
  ImportBatchRepository,
  ImportService,
  PlainStore,
  RuleTemplateRepository,
  VaultRepository,
  VaultService,
  type Clock,
  type CryptoProvider,
  type DekProvider,
  type StorageAdapter,
} from '@lifehub/core';
import { createClock } from './clock';
import { createDatabase, type LifeHubDatabase } from './db';
import { createDeviceLabel } from './device-label';
import { DexieStorageAdapter } from './indexeddb-storage-adapter';
import { createWebCryptoProvider } from './web-crypto-provider';

/**
 * 会话级 DEK 供给器。
 *
 * 说明：core 的 `DekProvider` 端口是**只读**的（仓储只负责取密钥）；
 * 平台层额外需要「写入 DEK」的能力（解锁成功后把密钥装进内存供给器），
 * 因此这里定义一个带写入方法的扩展端口。
 */
export interface SessionDekProvider extends DekProvider {
  /**
   * 写入 DEK（解锁 / 建库成功后调用）。
   *
   * @param dek DEK 字节数组
   * @param keyVersion 密钥版本
   * @returns 无异常
   */
  setDek(dek: Uint8Array, keyVersion: number): void;
}

/**
 * 平台运行时：把全部适配器与仓储装配成一个可用的对象图。
 */
export interface PlatformRuntime {
  /** 时钟。 */
  clock: Clock;
  /** 密码学能力。 */
  cryptoProvider: CryptoProvider;
  /** 加密服务。 */
  cryptoService: CryptoService;
  /** 存储适配器。 */
  storageAdapter: StorageAdapter;
  /** 明文存储门面。 */
  plainStore: PlainStore;
  /** 加密存储门面。 */
  encryptedStore: EncryptedStore;
  /** 保险库仓储。 */
  vaultRepository: VaultRepository;
  /** 账单仓储。 */
  billRepository: BillRepository;
  /** 分类仓储。 */
  categoryRepository: CategoryRepository;
  /** 规则模板仓储。 */
  ruleTemplateRepository: RuleTemplateRepository;
  /** 导入批次仓储。 */
  importBatchRepository: ImportBatchRepository;
  /** 审计日志仓储。 */
  auditLogRepository: AuditLogRepository;
  /** 审计日志服务。 */
  auditLogger: AuditLogger;
  /** DEK 供给器（密钥只驻留内存）。 */
  dekProvider: SessionDekProvider;
  /** 设备标签。 */
  deviceLabel: string;
  /** 数据库实例（供测试清理）。 */
  database: LifeHubDatabase;
}

/**
 * 装配平台运行时。
 *
 * @param dekProvider DEK 供给器（由保险库会话注入）
 * @param database 可选的数据库实例（测试时注入独立库名）
 * @returns 平台运行时
 */
export function createPlatformRuntime(
  dekProvider: SessionDekProvider,
  database?: LifeHubDatabase,
): PlatformRuntime {
  const db = database ?? createDatabase();
  const storageAdapter = new DexieStorageAdapter(db);
  const clock = createClock();
  const cryptoProvider = createWebCryptoProvider();
  const cryptoService = new CryptoService(cryptoProvider);
  const plainStore = new PlainStore(storageAdapter);
  const encryptedStore = new EncryptedStore({ adapter: storageAdapter, crypto: cryptoService, dek: dekProvider });
  const deviceLabel = createDeviceLabel(clock);

  const vaultRepository = new VaultRepository(plainStore);
  const auditLogRepository = new AuditLogRepository(encryptedStore, deviceLabel);
  const auditLogger = new AuditLogger({ repository: auditLogRepository, clock, deviceLabel });

  return {
    clock,
    cryptoProvider,
    cryptoService,
    storageAdapter,
    plainStore,
    encryptedStore,
    vaultRepository,
    billRepository: new BillRepository({ store: encryptedStore, dek: dekProvider }),
    categoryRepository: new CategoryRepository(encryptedStore),
    ruleTemplateRepository: new RuleTemplateRepository(encryptedStore),
    importBatchRepository: new ImportBatchRepository(encryptedStore),
    auditLogRepository,
    auditLogger,
    dekProvider,
    deviceLabel,
    database: db,
  };
}

/**
 * 创建导入服务。
 *
 * @param runtime 平台运行时
 * @param deviceId 设备 id
 * @returns 导入服务
 */
export function createImportService(runtime: PlatformRuntime, deviceId: string): ImportService {
  return new ImportService({
    provider: runtime.cryptoProvider,
    parser: new CsvParser(),
    templates: runtime.ruleTemplateRepository,
    batches: runtime.importBatchRepository,
    bills: runtime.billRepository,
    categories: runtime.categoryRepository,
    audit: runtime.auditLogger,
    clock: runtime.clock,
    deviceId,
  });
}

/**
 * 创建保险库服务。
 *
 * 说明：`onDekAvailable` 让建库 / 解锁成功后立刻把 DEK 装进内存供给器，
 * 这样紧随其后的「建库 / 解锁」审计日志会用正确密钥加密落盘；
 * `currentDek` 则让「重新生成恢复码」能够复用同一把 DEK。
 *
 * @param runtime 平台运行时
 * @returns 保险库服务
 */
export function createVaultService(runtime: PlatformRuntime): VaultService {
  return new VaultService({
    adapter: runtime.storageAdapter,
    crypto: runtime.cryptoService,
    provider: runtime.cryptoProvider,
    repository: runtime.vaultRepository,
    audit: runtime.auditLogger,
    clock: runtime.clock,
    onDekAvailable: (dek, keyVersion) => runtime.dekProvider.setDek(dek, keyVersion),
    currentDek: () => (runtime.dekProvider.isUnlocked() ? runtime.dekProvider.getDek('bill') : null),
  });
}
