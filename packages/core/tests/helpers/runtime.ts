/**
 * 测试辅助：构造一个可运行的内存版 core 运行时。
 *
 * 说明：所有集成测试都在 Node 环境跑，**不使用 jsdom**，
 * 这本身就是「核心层零 DOM 依赖」的可执行证明（PRD A-01 ①）。
 */
import {
  AuditLogRepository,
  AuditLogger,
  BillRepository,
  CategoryRepository,
  ColumnMapper,
  CsvParser,
  CryptoService,
  DirectionResolver,
  Deduplicator,
  EncryptedStore,
  ImportBatchRepository,
  ImportService,
  MemoryStorageAdapter,
  PlainStore,
  RuleTemplateRepository,
  VaultRepository,
  VaultService,
  WebCryptoProvider,
  createDefaultDirectionRule,
  type Clock,
  type ColumnMapping,
  type DekProvider,
  type EntityType,
} from '../../src/index';

/** 固定时钟，便于断言时间戳。 */
export class FixedClock implements Clock {
  /** 当前时刻。 */
  private current: Date;

  /**
   * 构造固定时钟。
   *
   * @param iso 初始时刻
   */
  constructor(iso = '2024-01-15T08:12:00.000Z') {
    this.current = new Date(iso);
  }

  /**
   * 取当前时刻。
   *
   * @returns 当前时间
   */
  now(): Date {
    return this.current;
  }

  /**
   * 取当前时刻的 ISO 字符串。
   *
   * @returns ISO 8601 UTC 字符串
   */
  nowIso(): string {
    return this.current.toISOString();
  }

  /**
   * 推进时钟。
   *
   * @param ms 毫秒数
   * @returns 无异常
   */
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** 测试用 DEK 供给器。 */
export class TestDekProvider implements DekProvider {
  /** DEK。 */
  private dek: Uint8Array;
  /** 是否处于解锁态；默认已解锁，便于现有测试，锁定时用于模拟「锁定态写不进加密库」。 */
  private unlocked = true;

  /**
   * 构造测试用 DEK 供给器。
   *
   * @param dek DEK 字节数组
   */
  constructor(dek: Uint8Array) {
    this.dek = dek;
  }

  /**
   * 是否已解锁。
   *
   * @returns 未锁定时返回 true
   */
  isUnlocked(): boolean {
    return this.unlocked;
  }

  /**
   * 切换锁定态（用于模拟解锁失败时加密库不可写，B-4）。
   *
   * @param unlocked 是否解锁
   * @returns 无异常
   */
  setUnlocked(unlocked: boolean): void {
    this.unlocked = unlocked;
  }

  /**
   * 取 DEK。
   *
   * @param _entityType 实体类型
   * @returns DEK 字节数组
   */
  getDek(_entityType: EntityType): Uint8Array {
    return this.dek;
  }

  /**
   * 取密钥版本。
   *
   * @returns 恒为 1
   */
  getKeyVersion(): number {
    return 1;
  }

  /**
   * 替换 DEK（用于测试轮换）。
   *
   * @param dek 新 DEK
   * @returns 无异常
   */
  setDek(dek: Uint8Array): void {
    this.dek = dek;
  }
}

/** 集成测试运行时。 */
export interface TestRuntime {
  /** 存储适配器。 */
  adapter: MemoryStorageAdapter;
  /** DEK 供给器。 */
  dek: TestDekProvider;
  /** 加密存储门面。 */
  store: EncryptedStore;
  /** 密码学实现。 */
  provider: WebCryptoProvider;
  /** 加密服务。 */
  crypto: CryptoService;
  /** 保险库服务。 */
  vault: VaultService;
  /** 保险库仓储。 */
  vaultRepository: VaultRepository;
  /** 账单仓储。 */
  bills: BillRepository;
  /** 分类仓储。 */
  categories: CategoryRepository;
  /** 规则模板仓储。 */
  templates: RuleTemplateRepository;
  /** 导入批次仓储。 */
  batches: ImportBatchRepository;
  /** 审计日志服务。 */
  audit: AuditLogger;
  /** 导入服务。 */
  importService: ImportService;
  /** 时钟。 */
  clock: FixedClock;
}

/**
 * 构造一个完整的内存版运行时。
 *
 * @returns 测试运行时
 */
export function createTestRuntime(): TestRuntime {
  const adapter = new MemoryStorageAdapter();
  const provider = new WebCryptoProvider();
  const crypto = new CryptoService(provider);
  const dek = new TestDekProvider(provider.randomBytes(32));
  const store = new EncryptedStore({ adapter, crypto, dek });
  const plainStore = new PlainStore(adapter);
  const vaultRepository = new VaultRepository(plainStore);
  const clock = new FixedClock();
  const audit = new AuditLogger({
    repository: new AuditLogRepository(store),
    clock,
    deviceLabel: '本机 · 测试',
  });
  const vault = new VaultService({
    adapter,
    crypto,
    provider,
    repository: vaultRepository,
    audit,
    clock,
    // 建库 / 解锁时把 DEK 装进供给器并切换为解锁态，
    // 这样「建库 / 解锁」两条审计日志才会用当前密钥加密落盘。
    onDekAvailable: (newDek) => {
      dek.setDek(newDek);
      dek.setUnlocked(true);
    },
    currentDek: () => dek.getDek('bill'),
  });
  const bills = new BillRepository({ store, dek });
  const categories = new CategoryRepository(store);
  const templates = new RuleTemplateRepository(store);
  const batches = new ImportBatchRepository(store);
  const importService = new ImportService({
    provider,
    parser: new CsvParser(),
    templates,
    batches,
    bills,
    audit,
    clock,
    deviceId: 'test-device',
  });

  return {
    adapter,
    dek,
    store,
    provider,
    crypto,
    vault,
    vaultRepository,
    bills,
    categories,
    templates,
    batches,
    audit,
    importService,
    clock,
  };
}

/**
 * 构造一份「已解锁」的运行时（跳过建库流程）。
 *
 * @returns 测试运行时
 */
export async function createUnlockedRuntime(): Promise<TestRuntime> {
  const runtime = createTestRuntime();
  await runtime.vault.createVault('test-password-123');
  const unlocked = await runtime.vault.unlock('test-password-123');
  runtime.dek.setDek(unlocked.dek);
  return runtime;
}

/**
 * 构造一份常用列映射。
 *
 * @returns 列映射
 */
export function standardMapping(): ColumnMapping {
  return { 0: 'occurredAt', 1: 'amount', 2: 'counterparty', 3: 'direction', 4: 'note' };
}

/**
 * 构造一份方向规则（auto 模式）。
 *
 * @returns 方向规则
 */
export function autoDirectionRule(): ReturnType<typeof createDefaultDirectionRule> {
  return {
    ...createDefaultDirectionRule('auto'),
    incomeKeywords: DirectionResolver.defaultIncomeKeywords(),
    expenseKeywords: DirectionResolver.defaultExpenseKeywords(),
  };
}

/**
 * 构造一个列映射器。
 *
 * @param headers 表头
 * @returns 列映射器
 */
export function createMapper(headers: string[]): ColumnMapper {
  return new ColumnMapper(headers);
}

/**
 * 构造一个去重器。
 *
 * @returns 去重器
 */
export function createDeduper(): Deduplicator {
  return new Deduplicator();
}
