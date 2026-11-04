/**
 * 分类仓储。
 *
 * 架构位置：core 包的「仓储」层。
 */
import { LifeHubError } from '../errors';
import type { Category } from '../models/category';
import { SYSTEM_CATEGORIES, normalizeCategoryName, validateCategory } from '../models/category';
import type { EncryptedStore } from '../storage/encrypted-store';
import { uuidV7 } from '../utils/id';

/** 旧版二字系统分类名称到标准四字系统分类名称的平滑升级映射。 */
const LEGACY_SYSTEM_NAME_MAP: Readonly<Record<string, string>> = {
  餐饮: '餐饮美食',
  交通: '交通出行',
  购物: '购物消费',
  居住: '居家住房',
  医疗: '医疗健康',
  工资: '工资薪水',
  理财: '投资理财',
  娱乐: '娱乐休闲',
  教育: '教育培训',
  通讯: '通讯话费',
  奖金: '奖金补贴',
};

/**
 * 分类仓储。
 *
 * 说明：分类名称在业务上是唯一的（大小写不敏感），写入前做一次查重。
 */
export class CategoryRepository {
  /** 加密存储门面。 */
  private readonly store: EncryptedStore;

  /**
   * 构造分类仓储。
   *
   * @param store 加密存储门面
   */
  constructor(store: EncryptedStore) {
    this.store = store;
  }

  /**
   * 列出全部分类。
   *
   * @returns 分类列表
   */
  async list(): Promise<Category[]> {
    const categories = await this.store.query<Category>('category');
    return categories.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /**
   * 按 id 取分类。
   *
   * @param id 分类 id
   * @returns 分类；不存在返回 null
   */
  async getById(id: string): Promise<Category | null> {
    const category = await this.store.get<Category>('category', id);
    return category ? validateCategory(category) : null;
  }

  /**
   * 按名称取分类（大小写不敏感）。
   *
   * @param name 分类名称
   * @returns 分类；不存在返回 null
   */
  async findByName(name: string): Promise<Category | null> {
    const target = normalizeCategoryName(name);
    const categories = await this.list();
    return categories.find((category) => normalizeCategoryName(category.name) === target) ?? null;
  }

  /**
   * 保存一个分类。
   *
   * @param category 分类实体
   * @returns 无异常
   * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 分类字段非法或名称重复
   */
  async save(category: Category): Promise<void> {
    const validated = validateCategory(category);
    const existing = await this.findByName(validated.name);
    if (existing && existing.id !== validated.id) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', `分类「${validated.name}」已存在`);
    }
    await this.store.put('category', validated as unknown as Record<string, unknown>);
  }

  /**
   * 删除一个分类。
   *
   * @param id 分类 id
   * @returns 无异常
   * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 系统预置分类不可删除
   */
  async delete(id: string): Promise<void> {
    const category = await this.getById(id);
    if (category?.isSystem) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', '系统预置分类不可删除');
    }
    await this.store.delete('category', id);
  }

  /**
   * 幂等初始化并平滑升级系统预置分类。
   *
   * 说明：
   * 1. 若本地库中存在旧版二字系统分类（如 `餐饮`、`交通`、`购物`、`居住`、`医疗`、`工资`、`理财`），
   *    自动保留原 `id` 并将其名称与排序属性升级为标准四字分类（如 `餐饮美食`、`交通出行` 等），
   *    确保既有账单上的 `categoryId` 引用不失效；
   * 2. 对 `SYSTEM_CATEGORIES` 中尚未落库的系统分类种子（包含 7 大标准四字分类与 `内部转账`），
   *    自动补齐并写入加密存储；
   * 3. 返回按 `sortOrder` 升序排列的完整分类列表。
   *
   * @param clock 时钟端口（提供 `nowIso()`）
   * @param deviceId 当前设备标识
   * @returns 包含全部系统预置分类的完整分类列表
   * @throws {LifeHubError} `LIFEHUB_E_STORAGE` —— 底层加密存储读写失败时抛出
   */
  async ensureSystemCategories(
    clock: { nowIso(): string },
    deviceId: string,
  ): Promise<Category[]> {
    const existing = await this.list();
    const byName = new Map<string, Category>();
    for (const cat of existing) {
      byName.set(normalizeCategoryName(cat.name), cat);
    }

    const now = clock.nowIso();

    // 第一步：将旧版二字系统分类原地平滑升级为标准四字分类（保留 id）。
    for (const cat of existing) {
      if (!cat.isSystem) {
        continue;
      }
      const upgradedName = LEGACY_SYSTEM_NAME_MAP[cat.name.trim()];
      if (!upgradedName) {
        continue;
      }
      const targetKey = normalizeCategoryName(upgradedName);
      if (byName.has(targetKey)) {
        continue;
      }
      const seed = SYSTEM_CATEGORIES.find((s) => s.name === upgradedName);
      const upgraded: Category = {
        ...cat,
        name: upgradedName,
        kind: seed?.kind ?? cat.kind,
        color: seed?.color ?? cat.color,
        icon: seed?.icon ?? cat.icon,
        sortOrder: seed?.sortOrder ?? cat.sortOrder,
        updatedAt: now,
        version: cat.version + 1,
        deviceId,
      };
      await this.store.put('category', upgraded as unknown as Record<string, unknown>);
      byName.delete(normalizeCategoryName(cat.name));
      byName.set(targetKey, upgraded);
    }

    // 第二步：补齐 SYSTEM_CATEGORIES 中缺失的系统预置分类。
    for (const seed of SYSTEM_CATEGORIES) {
      const key = normalizeCategoryName(seed.name);
      if (byName.has(key)) {
        continue;
      }
      const created: Category = {
        id: uuidV7(),
        name: seed.name,
        kind: seed.kind,
        parentId: seed.parentId,
        color: seed.color,
        icon: seed.icon,
        isSystem: seed.isSystem,
        sortOrder: seed.sortOrder,
        createdAt: now,
        updatedAt: now,
        version: 1,
        deviceId,
      };
      await this.store.put('category', created as unknown as Record<string, unknown>);
      byName.set(key, created);
    }

    return Array.from(byName.values()).sort((a, b) => a.sortOrder - b.sortOrder);
  }
}
