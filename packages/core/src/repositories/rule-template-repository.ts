/**
 * 规则模板仓储。
 *
 * 架构位置：core 包的「仓储」层，服务于 A-13（规则模板持久化与自动匹配）。
 */
import { LifeHubError } from '../errors';
import type { RuleTemplate } from '../models/rule-template';
import { validateRuleTemplate } from '../models/rule-template';
import type { EncryptedStore } from '../storage/encrypted-store';

/**
 * 规则模板仓储。
 *
 * 说明：模板按表头签名自动匹配，保证「同一格式的账单文件下次导入零配置」。
 */
export class RuleTemplateRepository {
  /** 加密存储门面。 */
  private readonly store: EncryptedStore;

  /**
   * 构造规则模板仓储。
   *
   * @param store 加密存储门面
   */
  constructor(store: EncryptedStore) {
    this.store = store;
  }

  /**
   * 列出全部规则模板。
   *
   * @returns 模板列表
   */
  async list(): Promise<RuleTemplate[]> {
    const templates = await this.store.query<RuleTemplate>('ruleTemplate');
    return templates.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * 按 id 取规则模板。
   *
   * @param id 模板 id
   * @returns 模板；不存在返回 null
   */
  async getById(id: string): Promise<RuleTemplate | null> {
    const template = await this.store.get<RuleTemplate>('ruleTemplate', id);
    return template ? validateRuleTemplate(template) : null;
  }

  /**
   * 按表头签名查找规则模板。
   *
   * @param fileSignature 表头行哈希
   * @returns 命中的模板；不存在返回 null
   */
  async findBySignature(fileSignature: string): Promise<RuleTemplate | null> {
    const templates = await this.list();
    return templates.find((template) => template.fileSignature === fileSignature) ?? null;
  }

  /**
   * 保存一个规则模板。
   *
   * @param template 模板实体
   * @returns 无异常
   * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 模板字段非法
   */
  async save(template: RuleTemplate): Promise<void> {
    const validated = validateRuleTemplate(template);
    await this.store.put('ruleTemplate', validated as unknown as Record<string, unknown>);
  }

  /**
   * 重命名一个规则模板。
   *
   * @param id 模板 id
   * @param name 新名称
   * @returns 无异常
   * @throws {LifeHubError} `LIFEHUB_E_ENTITY_NOT_FOUND` —— 模板不存在
   */
  async rename(id: string, name: string): Promise<void> {
    const template = await this.getById(id);
    if (!template) {
      throw new LifeHubError('LIFEHUB_E_ENTITY_NOT_FOUND');
    }
    const now = new Date().toISOString();
    await this.save({ ...template, name, updatedAt: now, version: template.version + 1 });
  }

  /**
   * 复制一个规则模板。
   *
   * @param id 源模板 id
   * @param newName 新模板名称
   * @returns 新建的模板
   * @throws {LifeHubError} `LIFEHUB_E_ENTITY_NOT_FOUND` —— 源模板不存在
   */
  async duplicate(id: string, newName: string): Promise<RuleTemplate> {
    const source = await this.getById(id);
    if (!source) {
      throw new LifeHubError('LIFEHUB_E_ENTITY_NOT_FOUND');
    }
    const now = new Date().toISOString();
    const copy: RuleTemplate = {
      ...source,
      id: `${source.id}-copy-${Date.now().toString(36)}`,
      name: newName,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.save(copy);
    return copy;
  }

  /**
   * 删除一个规则模板。
   *
   * @param id 模板 id
   * @returns 无异常
   */
  async delete(id: string): Promise<void> {
    await this.store.delete('ruleTemplate', id);
  }
}
