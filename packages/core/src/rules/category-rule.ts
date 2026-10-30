/**
 * 分类规则引擎。
 *
 * 架构位置：core 包「规则」模块，服务于 A-20（自动分类规则引擎）。
 *
 * 匹配规则：
 * - 支持 `contains` / `prefix` / `exact` / `regex` 四种匹配类型；
 * - 按 `priority` **降序**匹配，命中即停；
 * - 未命中时归入「未分类」（categoryId = null）而**不是丢弃**该行。
 */
import type { CategoryRule } from '../models/rule-template';

/**
 * 分类规则引擎。
 */
export class CategoryRuleEngine {
  /** 规则列表（已按优先级降序排序）。 */
  private readonly rules: CategoryRule[];

  /**
   * 构造规则引擎。
   *
   * @param rules 规则列表；构造时会按优先级降序排序
   */
  constructor(rules: readonly CategoryRule[]) {
    this.rules = [...rules].sort((a, b) => b.priority - a.priority);
  }

  /**
   * 用给定文本匹配分类。
   *
   * @param text 待匹配文本（通常是「对方 + 备注 + 分类」的组合）
   * @returns 命中的分类 id；未命中返回 null
   */
  match(text: string): string | null {
    if (typeof text !== 'string' || text === '') {
      return null;
    }
    const haystack = text.toLowerCase();
    for (const rule of this.rules) {
      if (this.matchRule(rule, haystack)) {
        return rule.categoryId;
      }
    }
    return null;
  }

  /**
   * 用多个候选文本依次匹配（第一个命中的文本决定结果）。
   *
   * 说明：优先级仍由规则决定，因此这里对每个文本都跑一遍引擎，
   * 取「优先级最高的命中」而不是「第一个文本的命中」。
   *
   * @param texts 候选文本列表
   * @returns 命中的分类 id；未命中返回 null
   */
  matchAny(texts: readonly string[]): string | null {
    let best: { categoryId: string; priority: number } | null = null;
    for (const text of texts) {
      if (typeof text !== 'string' || text === '') {
        continue;
      }
      const categoryId = this.match(text);
      if (categoryId === null) {
        continue;
      }
      const rule = this.rules.find((item) => item.categoryId === categoryId);
      const priority = rule?.priority ?? 0;
      if (best === null || priority > best.priority) {
        best = { categoryId, priority };
      }
    }
    return best?.categoryId ?? null;
  }

  /**
   * 取当前规则列表（按优先级降序）。
   *
   * @returns 规则数组副本
   */
  listRules(): CategoryRule[] {
    return [...this.rules];
  }

  /**
   * 判断单条规则是否命中给定文本。
   *
   * @param rule 规则
   * @param haystack 已转小写的待匹配文本
   * @returns 命中返回 true
   */
  private matchRule(rule: CategoryRule, haystack: string): boolean {
    const pattern = rule.pattern.toLowerCase();
    switch (rule.matchType) {
      case 'contains':
        return pattern !== '' && haystack.includes(pattern);
      case 'prefix':
        return pattern !== '' && haystack.trimStart().startsWith(pattern);
      case 'exact':
        return haystack.trim() === pattern;
      case 'regex':
        try {
          return new RegExp(rule.pattern, 'i').test(haystack);
        } catch {
          // 非法正则不中断整体匹配，跳过该条规则。
          return false;
        }
      default:
        return false;
    }
  }
}
