/**
 * 分类构造工厂测试。
 *
 * 覆盖：buildCategory 的字段归属、颜色校验、系统预置保持、版本递增。
 */
import { describe, expect, it } from 'vitest';
import { buildCategory, CATEGORY_LOCAL_DEVICE_ID } from '@/lib/category-factory';
import { LOCAL_DEVICE_ID } from '@/lib/bill-factory';
import type { Category } from '@lifehub/core';

const CLOCK = { nowIso: () => '2024-01-01T00:00:00.000Z' };
const CTX = { clock: CLOCK, deviceId: CATEGORY_LOCAL_DEVICE_ID };

describe('buildCategory', () => {
  it('新增分类：默认非系统、排系统预置之后、生成 id 与时间戳', () => {
    const category = buildCategory({ name: ' 健身 ', kind: 'expense', color: '#123ABC', icon: 'gym' }, CTX);
    expect(category.name).toBe('健身');
    expect(category.kind).toBe('expense');
    expect(category.color).toBe('#123ABC');
    expect(category.icon).toBe('gym');
    expect(category.isSystem).toBe(false);
    expect(category.sortOrder).toBe(5000);
    expect(category.deviceId).toBe(LOCAL_DEVICE_ID);
    expect(category.version).toBe(1);
    expect(category.createdAt).toBe(CLOCK.nowIso());
    expect(category.updatedAt).toBe(CLOCK.nowIso());
    expect(category.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('空图标降级为默认 more', () => {
    const category = buildCategory({ name: '订阅', kind: 'both', color: '#6B7280', icon: '   ' }, CTX);
    expect(category.icon).toBe('more');
  });

  it('非法颜色抛中文错误', () => {
    expect(() => buildCategory({ name: '测试', kind: 'expense', color: 'red', icon: '' }, CTX)).toThrow('分类颜色必须是 #RRGGBB');
  });

  it('空名称抛中文错误', () => {
    expect(() => buildCategory({ name: '   ', kind: 'expense', color: '#123456', icon: '' }, CTX)).toThrow('分类名称不能为空');
  });

  it('编辑系统预置时保持 isSystem 原值与 id', () => {
    const existing: Category = {
      id: 'sys-1',
      name: '餐饮',
      kind: 'expense',
      parentId: null,
      color: '#DC2626',
      icon: 'restaurant',
      isSystem: true,
      sortOrder: 100,
      createdAt: '2023-01-01T00:00:00.000Z',
      updatedAt: '2023-01-01T00:00:00.000Z',
      version: 1,
      deviceId: 'seed',
    };
    const updated = buildCategory({ name: '餐饮改名', kind: 'expense', color: '#DC2626', icon: 'restaurant' }, CTX, existing);
    expect(updated.id).toBe('sys-1');
    expect(updated.isSystem).toBe(true);
    expect(updated.sortOrder).toBe(100);
    expect(updated.version).toBe(2);
    expect(updated.createdAt).toBe(existing.createdAt);
    expect(updated.deviceId).toBe('seed');
  });
});
