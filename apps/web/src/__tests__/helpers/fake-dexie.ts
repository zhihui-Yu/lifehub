/**
 * 测试用「假 Dexie」数据库。
 *
 * 架构位置：apps/web 测试助手，仅用于 jsdom 环境下替代真实 IndexedDB（jsdom 不实现 IndexedDB）。
 *
 * 说明：只实现仓库实际用到的子集——`table().add / put / get / delete / toArray / clear`，
 * 因此仓库在真机与测试里的查询路径完全一致（都是 `toArray` 后在内存过滤），
 * 避免维护两套查询逻辑。返回类型用 `any` 以兼容 `LifeHubDatabase` 的形态。
 */
interface FakeRow {
  id: string;
  [key: string]: unknown;
}

/**
 * 内存表，模拟 Dexie Table 的最小子集。
 */
class FakeTable<T extends FakeRow> {
  /** 主键到行的映射。 */
  private readonly rows = new Map<string, T>();

  /**
   * 新增一行；主键重复抛 ConstraintError（模拟 IndexedDB 主键唯一约束）。
   *
   * @param item 要新增的行
   * @returns 新增行的主键
   * @throws {Error} 主键已存在时抛 ConstraintError
   */
  async add(item: T): Promise<string> {
    if (this.rows.has(item.id)) {
      throw new Error('ConstraintError');
    }
    this.rows.set(item.id, { ...item });
    return item.id;
  }

  /**
   * 新增或覆盖一行。
   *
   * @param item 要写入的行
   * @returns 写入行的主键
   */
  async put(item: T): Promise<string> {
    this.rows.set(item.id, { ...item });
    return item.id;
  }

  /**
   * 按主键读取一行。
   *
   * @param id 主键
   * @returns 行对象（副本），不存在返回 undefined
   */
  async get(id: string): Promise<T | undefined> {
    const found = this.rows.get(id);
    return found ? { ...found } : undefined;
  }

  /**
   * 按主键删除一行。
   *
   * @param id 主键
   * @returns 无
   */
  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }

  /**
   * 读取全部行。
   *
   * @returns 所有行的副本数组
   */
  async toArray(): Promise<T[]> {
    return [...this.rows.values()].map((value) => ({ ...value }));
  }

  /**
   * 清空表。
   *
   * @returns 无
   */
  async clear(): Promise<void> {
    this.rows.clear();
  }
}

/**
 * 创建假数据库实例。
 *
 * 说明：每个表名对应一个稳定的内存表实例，保证同一次测试内数据持久。
 * 测试文件应在顶层用 `vi.mock('@/platform/db', () => ({ createDatabase: () => createFakeDatabase(), LifeHubDatabase: class {} }))` 注入。
 *
 * @returns 兼容 `LifeHubDatabase` 形态的假数据库
 */
export function createFakeDatabase(): unknown {
  const tables = new Map<string, FakeTable<FakeRow>>();
  const table = (name: string): FakeTable<FakeRow> => {
    if (!tables.has(name)) {
      tables.set(name, new FakeTable<FakeRow>());
    }
    return tables.get(name) as FakeTable<FakeRow>;
  };
  return {
    table,
    open: async () => undefined,
    close: async () => undefined,
  };
}
