/**
 * 分类规则引擎单测。
 *
 * 覆盖需求：A-20；系统设计 §7 T03 交付内容第 6 条。
 */
import { describe, expect, it } from 'vitest';
import { CategoryRuleEngine } from '../../src/rules/category-rule';
import type { CategoryRule } from '../../src/models/rule-template';

/** 构造一条分类规则。 */
function rule(partial: Partial<CategoryRule>): CategoryRule {
  return {
    id: `rule-${partial.pattern ?? 'x'}`,
    priority: 10,
    matchType: 'contains',
    pattern: '',
    categoryId: 'category-default',
    ...partial,
  };
}

describe('CategoryRuleEngine', () => {
  it('contains 匹配命中', () => {
    const engine = new CategoryRuleEngine([rule({ pattern: '星巴克', categoryId: 'cat-coffee' })]);
    expect(engine.match('星巴克(国贸店)')).toBe('cat-coffee');
    expect(engine.match('便利店')).toBeNull();
  });

  it('prefix 匹配命中', () => {
    const engine = new CategoryRuleEngine([rule({ matchType: 'prefix', pattern: '美团', categoryId: 'cat-meituan' })]);
    expect(engine.match('美团外卖')).toBe('cat-meituan');
    expect(engine.match('外卖美团')).toBeNull();
  });

  it('exact 匹配命中', () => {
    const engine = new CategoryRuleEngine([rule({ matchType: 'exact', pattern: '工资', categoryId: 'cat-salary' })]);
    expect(engine.match('工资')).toBe('cat-salary');
    expect(engine.match('工资条')).toBeNull();
  });

  it('regex 匹配命中', () => {
    const engine = new CategoryRuleEngine([rule({ matchType: 'regex', pattern: '^TX-\\d+$', categoryId: 'cat-tx' })]);
    expect(engine.match('TX-12345')).toBe('cat-tx');
    expect(engine.match('prefix TX-12345')).toBeNull();
  });

  it('非法正则不会中断匹配', () => {
    const engine = new CategoryRuleEngine([
      rule({ matchType: 'regex', pattern: '([', categoryId: 'cat-bad', priority: 100 }),
      rule({ pattern: '咖啡', categoryId: 'cat-coffee', priority: 10 }),
    ]);
    expect(engine.match('咖啡')).toBe('cat-coffee');
  });

  it('按 priority 降序匹配，命中即停', () => {
    const engine = new CategoryRuleEngine([
      rule({ pattern: '咖啡', categoryId: 'cat-low', priority: 1 }),
      rule({ pattern: '星巴克咖啡', categoryId: 'cat-high', priority: 100 }),
    ]);
    expect(engine.match('星巴克咖啡')).toBe('cat-high');
  });

  it('未命中返回 null（调用方归入「未分类」而非丢弃）', () => {
    const engine = new CategoryRuleEngine([rule({ pattern: '咖啡' })]);
    expect(engine.match('完全无关')).toBeNull();
  });

  it('matchAny 在多个候选文本中取优先级最高的命中', () => {
    const engine = new CategoryRuleEngine([
      rule({ pattern: '咖啡', categoryId: 'cat-low', priority: 1 }),
      rule({ pattern: '星巴克', categoryId: 'cat-high', priority: 100 }),
    ]);
    expect(engine.matchAny(['便利店', '星巴克咖啡'])).toBe('cat-high');
  });

  it('空文本不匹配', () => {
    const engine = new CategoryRuleEngine([rule({ pattern: '咖啡' })]);
    expect(engine.match('')).toBeNull();
    expect(engine.matchAny([])).toBeNull();
  });
});
