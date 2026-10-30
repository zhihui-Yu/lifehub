/**
 * 分类实体与系统预置分类种子。
 *
 * 架构位置：core 包的领域模型层，服务于模块 A（记账）的分类维度与 A-20 分类规则。
 */
import { ISO_UTC_PATTERN } from '../constants';
import { LifeHubError } from '../errors';
import type { BaseEntity } from '../types/common';

/** 分类适用方向。 */
export type CategoryKind = 'income' | 'expense' | 'both';

/** 分类实体。 */
export interface Category extends BaseEntity {
  /** 分类 id。 */
  id: string;
  /** 分类名称，大小写不敏感去重后判重。 */
  name: string;
  /** 适用方向。 */
  kind: CategoryKind;
  /** 父分类 id；顶层为 null。 */
  parentId: string | null;
  /** 主题色 '#RRGGBB'。 */
  color: string;
  /** 图标名，如 'restaurant'。 */
  icon: string;
  /** 是否为系统预置分类（不可删除）。 */
  isSystem: boolean;
  /** 排序权重。 */
  sortOrder: number;
}

/** 系统预置分类的种子定义（不含 id / 时间戳 / 版本 / 设备字段）。 */
export type SystemCategorySeed = Omit<Category, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'deviceId'>;

/**
 * 系统预置分类种子表。
 *
 * 取值依据：PRD A-01 ②「系统预置若干常用分类」；
 * 覆盖国内用户最常见的收支分类，后续由 A-20 规则引擎做自动归类。
 */
export const SYSTEM_CATEGORIES: readonly SystemCategorySeed[] = [
  { name: '餐饮', kind: 'expense', parentId: null, color: '#DC2626', icon: 'restaurant', isSystem: true, sortOrder: 100 },
  { name: '交通', kind: 'expense', parentId: null, color: '#EA580C', icon: 'commute', isSystem: true, sortOrder: 200 },
  { name: '购物', kind: 'expense', parentId: null, color: '#D97706', icon: 'shopping', isSystem: true, sortOrder: 300 },
  { name: '居住', kind: 'expense', parentId: null, color: '#CA8A04', icon: 'home', isSystem: true, sortOrder: 400 },
  { name: '娱乐', kind: 'expense', parentId: null, color: '#16A34A', icon: 'movie', isSystem: true, sortOrder: 500 },
  { name: '医疗', kind: 'expense', parentId: null, color: '#0D9488', icon: 'medical', isSystem: true, sortOrder: 600 },
  { name: '教育', kind: 'expense', parentId: null, color: '#2563EB', icon: 'school', isSystem: true, sortOrder: 700 },
  { name: '通讯', kind: 'expense', parentId: null, color: '#4F46E5', icon: 'phone', isSystem: true, sortOrder: 800 },
  { name: '工资', kind: 'income', parentId: null, color: '#16A34A', icon: 'salary', isSystem: true, sortOrder: 900 },
  { name: '奖金', kind: 'income', parentId: null, color: '#059669', icon: 'bonus', isSystem: true, sortOrder: 1000 },
  { name: '理财', kind: 'income', parentId: null, color: '#0891B2', icon: 'investment', isSystem: true, sortOrder: 1100 },
  { name: '其他', kind: 'both', parentId: null, color: '#6B7280', icon: 'more', isSystem: true, sortOrder: 1200 },
];

/**
 * 校验并返回一个合法的 Category。
 *
 * @param category 待校验的未知值
 * @returns 校验通过的 Category 对象
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 任一字段不满足约束
 */
export function validateCategory(category: unknown): Category {
  if (typeof category !== 'object' || category === null) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '分类必须是对象');
  }
  const candidate = category as Record<string, unknown>;

  if (typeof candidate['id'] !== 'string' || candidate['id'] === '') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '分类 id 非法');
  }
  if (typeof candidate['name'] !== 'string' || candidate['name'].trim() === '') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '分类名称不能为空');
  }
  const kind = candidate['kind'];
  if (kind !== 'income' && kind !== 'expense' && kind !== 'both') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '分类方向非法');
  }
  const parentId = candidate['parentId'];
  if (parentId !== null && typeof parentId !== 'string') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '分类父级 id 非法');
  }
  if (typeof candidate['color'] !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(candidate['color'])) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '分类颜色必须是 #RRGGBB');
  }
  if (typeof candidate['icon'] !== 'string') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '分类图标必须是字符串');
  }
  if (typeof candidate['isSystem'] !== 'boolean') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '分类 isSystem 必须是布尔值');
  }
  if (typeof candidate['sortOrder'] !== 'number' || !Number.isInteger(candidate['sortOrder'])) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '分类排序值必须是整数');
  }
  if (typeof candidate['createdAt'] !== 'string' || !ISO_UTC_PATTERN.test(candidate['createdAt'])) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '分类创建时间必须是 ISO 8601 UTC');
  }
  if (typeof candidate['updatedAt'] !== 'string' || !ISO_UTC_PATTERN.test(candidate['updatedAt'])) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '分类更新时间必须是 ISO 8601 UTC');
  }
  if (typeof candidate['version'] !== 'number' || !Number.isInteger(candidate['version'])) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '分类版本号必须是整数');
  }
  if (typeof candidate['deviceId'] !== 'string' || candidate['deviceId'] === '') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '分类设备 id 非法');
  }

  return candidate as unknown as Category;
}

/**
 * 把分类名归一为判重键（去空白 + 转小写）。
 *
 * @param name 原始分类名
 * @returns 归一后的判重键
 */
export function normalizeCategoryName(name: string): string {
  return name.trim().toLowerCase();
}
