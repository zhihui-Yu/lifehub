/**
 * 分类构造工厂。
 *
 * 架构位置：apps/web 的「领域辅助」层。
 *
 * 说明：把分类表单输入组装成合法的 `Category` 实体，复用 core 的 `uuidV7` / `validateCategory`。
 * 系统预置分类（`SYSTEM_CATEGORIES`）不可被删除，也不可被覆盖——编辑时 `isSystem` 保持原值。
 */
import {
  LifeHubError,
  type Category,
  type CategoryKind,
  uuidV7,
  validateCategory,
} from '@lifehub/core';
import { LOCAL_DEVICE_ID } from './bill-factory';

/** 分类表单输入。 */
export interface CategoryInput {
  /** 分类名称（大小写不敏感去重）。 */
  name: string;
  /** 适用方向。 */
  kind: CategoryKind;
  /** 主题色 '#RRGGBB'。 */
  color: string;
  /** 图标名（如 'restaurant'）。 */
  icon: string;
}

/** 构造分类所需的上下文。 */
export interface CategoryBuildContext {
  /** 时钟端口。 */
  clock: { nowIso(): string };
  /** 设备 id。 */
  deviceId: string;
}

/**
 * 把分类表单输入组装成合法 `Category`。
 *
 * @param input 表单输入
 * @param ctx 运行时上下文
 * @param existing 被编辑的既有分类（新增时为 null）
 * @returns 经 `validateCategory` 校验通过的分类实体
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 名称 / 颜色等非法
 */
export function buildCategory(
  input: CategoryInput,
  ctx: CategoryBuildContext,
  existing: Category | null = null,
): Category {
  const name = input.name.trim();
  if (name === '') {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '分类名称不能为空');
  }
  if (!/^#[0-9A-Fa-f]{6}$/.test(input.color)) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '分类颜色必须是 #RRGGBB');
  }
  const now = ctx.clock.nowIso();
  const category: Category = {
    id: existing?.id ?? uuidV7(),
    name,
    kind: input.kind,
    parentId: existing?.parentId ?? null,
    color: input.color,
    icon: input.icon.trim() === '' ? 'more' : input.icon.trim(),
    // 系统预置分类不可被改造成普通分类；编辑时保持原值。
    isSystem: existing?.isSystem ?? false,
    // 新分类排在系统预置（sortOrder ≤ 1200）之后。
    sortOrder: existing?.sortOrder ?? 5000,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    version: (existing?.version ?? 0) + 1,
    deviceId: existing?.deviceId ?? ctx.deviceId,
  };
  return validateCategory(category);
}

/** 本地设备 id（与账单、导入流程保持一致）。 */
export const CATEGORY_LOCAL_DEVICE_ID = LOCAL_DEVICE_ID;
