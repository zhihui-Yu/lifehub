/**
 * 账单分类选择记忆与跨端规则模板持久化工具。
 *
 * 架构位置：apps/web 的「领域辅助工具」层。
 *
 * 说明：
 * 1. 维护浏览器端轻量化键值字典（`localStorage['lifehub.categoryMemory.v1']` + 内存缓存），
 *    供「记一笔 / 编辑账单」弹窗同步实时匹配已知交易对方或备注的记住分类；
 * 2. 将用户记住的「相同项 → 分类 ID」映射同步写入 `runtime.ruleTemplateRepository`
 *    下的全局分类记忆模板（`sys-user-category-memory`），使后续文件导入（`ImportService.run`）
 *    也能以最高优先级自动归类。
 */
import {
  USER_CATEGORY_MEMORY_SIGNATURE,
  USER_CATEGORY_MEMORY_TEMPLATE_ID,
  createDefaultDirectionRule,
  extractBillItemKey,
  type Bill,
  type CategoryRule,
  type RuleTemplate,
} from '@lifehub/core';

/** 本地存储键名。 */
export const CATEGORY_MEMORY_STORAGE_KEY = 'lifehub.categoryMemory.v1';

/** 内存态分类记忆表（兼容无 localStorage 或测试隔离场景）。 */
let memoryCache: Record<string, string> = {};

/**
 * 读取当前已记住的「归一化相同项键 → 分类 ID」映射表。
 *
 * 说明：优先合并内存缓存与 `localStorage` 中的持久化数据；解析失败时安全降级为空字典。
 *
 * @returns 归一化项键到分类 ID 的只读字典副本
 * @throws 无；内部捕获存储读取异常并安全降级
 */
export function readRememberedCategoryMap(): Record<string, string> {
  const merged: Record<string, string> = { ...memoryCache };
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(CATEGORY_MEMORY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (typeof parsed === 'object' && parsed !== null) {
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof k === 'string' && typeof v === 'string' && k !== '' && v !== '') {
              merged[k] = v;
            }
          }
        }
      }
    }
  } catch {
    // 忽略无痕模式或测试环境下的存储访问异常
  }
  return merged;
}

/**
 * 保存单条「归一化相同项键 → 分类 ID」记忆映射到本地缓存与 localStorage。
 *
 * 说明：当 `itemKey` 或 `categoryId` 为空时直接忽略，不写入无效项。
 *
 * @param itemKey 经 `extractBillItemKey` 归一化后的非空键
 * @param categoryId 目标分类 ID
 * @returns 无返回值
 * @throws 无；存储异常在内部静默降级到内存缓存
 */
export function saveRememberedCategoryMapping(itemKey: string, categoryId: string): void {
  const normalizedKey = itemKey.trim().toLowerCase();
  if (!normalizedKey || !categoryId) {
    return;
  }
  const current = readRememberedCategoryMap();
  current[normalizedKey] = categoryId;
  memoryCache = current;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(CATEGORY_MEMORY_STORAGE_KEY, JSON.stringify(current));
    }
  } catch {
    // 忽略配额或隐私限制异常
  }
}

/**
 * 根据交易对方、备注及可选的既有账单列表查询已记住的分类 ID。
 *
 * 说明：先查显式记住的 `lifehub.categoryMemory.v1` 映射表；若未命中且提供了既有账单列表，
 * 则按 `updatedAt` 降序查找相同项已分类账单的历史分类 ID。
 *
 * @param input 待匹配的交易对方与备注
 * @param existingBills 可选的既有账单列表（用于回退查询历史相同项分类）
 * @returns 命中的分类 ID；未命中返回 `null`
 * @throws 无；纯查询函数不抛出异常
 */
export function lookupRememberedCategoryId(
  input: { counterparty?: string | null; note?: string | null },
  existingBills?: readonly Bill[],
): string | null {
  const itemKey = extractBillItemKey(input);
  if (!itemKey) {
    return null;
  }
  const map = readRememberedCategoryMap();
  if (map[itemKey]) {
    return map[itemKey] ?? null;
  }
  if (existingBills && existingBills.length > 0) {
    const matched = existingBills
      .filter(
        (b): b is Bill & { categoryId: string } =>
          typeof b.categoryId === 'string' && b.categoryId !== '' && extractBillItemKey(b) === itemKey,
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (matched.length > 0 && matched[0]) {
      return matched[0].categoryId;
    }
  }
  return null;
}

/**
 * 清空本地分类选择记忆缓存（用于重置或测试清理）。
 *
 * 说明：同时清理内存字典与 `localStorage` 中的对应键。
 *
 * @returns 无返回值
 * @throws 无；异常在内部捕获忽略
 */
export function clearRememberedCategoryMap(): void {
  memoryCache = {};
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(CATEGORY_MEMORY_STORAGE_KEY);
    }
  } catch {
    // 忽略异常
  }
}

/** 具备规则模板读写能力的最小运行时接口。 */
interface RuleTemplateRepoLike {
  /** 按 ID 获取规则模板。 */
  getById?: (id: string) => Promise<RuleTemplate | null>;
  /** 按表头签名查找规则模板。 */
  findBySignature?: (signature: string) => Promise<RuleTemplate | null>;
  /** 保存规则模板。 */
  save?: (template: RuleTemplate) => Promise<void>;
}

/**
 * 将用户记住的「相同项 → 分类 ID」映射同步持久化到 `runtime.ruleTemplateRepository`。
 *
 * 说明：若运行时未挂载 `ruleTemplateRepository`（如部分轻量级单元测试桩）则安全跳过，
 * 不阻塞账单保存主流程。
 *
 * @param repo 规则模板仓储实例（可为空或部分实现）
 * @param itemKey 归一化相同项键
 * @param categoryId 目标分类 ID
 * @param nowIso 当前 ISO UTC 时间戳
 * @param deviceId 当前设备 ID
 * @returns 异步完成 Promise
 * @throws 无；内部捕获存储异常以免影响主流程
 */
export async function persistCategoryMemoryToRepo(
  repo: RuleTemplateRepoLike | undefined | null,
  itemKey: string,
  categoryId: string,
  nowIso: string,
  deviceId: string,
): Promise<void> {
  const normalizedKey = itemKey.trim().toLowerCase();
  if (!repo || typeof repo.save !== 'function' || !normalizedKey || !categoryId) {
    return;
  }
  try {
    const existing =
      (typeof repo.getById === 'function'
        ? await repo.getById(USER_CATEGORY_MEMORY_TEMPLATE_ID)
        : null) ??
      (typeof repo.findBySignature === 'function'
        ? await repo.findBySignature(USER_CATEGORY_MEMORY_SIGNATURE)
        : null);

    const newRule: CategoryRule = {
      id: `mem-${normalizedKey}`,
      priority: 1000,
      matchType: 'exact',
      pattern: normalizedKey,
      categoryId,
    };

    const prevRules = existing?.categoryRules ?? [];
    const filteredRules = prevRules.filter(
      (r) => r.id !== newRule.id && r.pattern.trim().toLowerCase() !== normalizedKey,
    );

    const updatedTemplate: RuleTemplate = existing
      ? {
          ...existing,
          categoryRules: [newRule, ...filteredRules],
          updatedAt: nowIso,
          version: existing.version + 1,
          deviceId,
        }
      : {
          id: USER_CATEGORY_MEMORY_TEMPLATE_ID,
          name: '用户分类记忆规则',
          fileSignature: USER_CATEGORY_MEMORY_SIGNATURE,
          columnMapping: {},
          directionRule: createDefaultDirectionRule('auto'),
          categoryRules: [newRule],
          dateFormatHints: [],
          createdAt: nowIso,
          updatedAt: nowIso,
          version: 1,
          deviceId,
        };

    await repo.save(updatedTemplate);
  } catch {
    // 规则模板写入异常不阻断账单落库
  }
}
