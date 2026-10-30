/**
 * 分类 Hook。
 *
 * 架构位置：apps/web 的「Hooks」层。
 */
import { useCallback, useEffect, useState } from 'react';
import type { Category } from '@lifehub/core';
import { useVault } from './useVault';

/** 分类 Hook 的返回值。 */
export interface UseCategoriesResult {
  /** 分类列表。 */
  categories: Category[];
  /** 是否正在加载。 */
  loading: boolean;
  /** 中文错误提示。 */
  error: string | null;
  /** 重新加载。 */
  reload: () => Promise<void>;
}

/**
 * 初始化分类列表。
 *
 * @returns 分类 Hook 的返回值
 */
export function useCategories(): UseCategoriesResult {
  const { runtime, status } = useVault();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!runtime || status !== 'unlocked') {
      return;
    }
    setLoading(true);
    try {
      const list = await runtime.categoryRepository.list();
      setCategories(list);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '本地数据读写失败');
    } finally {
      setLoading(false);
    }
  }, [runtime, status]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { categories, loading, error, reload };
}
