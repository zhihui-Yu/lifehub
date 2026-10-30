/**
 * 分类仓储。
 *
 * 架构位置：core 包的「仓储」层。
 */
import { LifeHubError } from '../errors';
import type { Category } from '../models/category';
import { normalizeCategoryName, validateCategory } from '../models/category';
import type { EncryptedStore } from '../storage/encrypted-store';

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
}
