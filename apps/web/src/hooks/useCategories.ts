/**
 * 分类 Hook。
 *
 * 架构位置：apps/web 的「Hooks」层。
 *
 * 说明：封装分类的**列表 + 增删改**。写操作后调用 `reload()` 重新拉取，保证内存态一致。
 * 系统预置分类不可删除（`CategoryRepository.delete` 会抛错），这里原样向上抛，由调用方提示。
 */
import { useCallback, useEffect, useState } from 'react';
import type { Category } from '@lifehub/core';
import { useVault } from './useVault';
import {
  buildCategory,
  CATEGORY_LOCAL_DEVICE_ID,
  type CategoryInput,
} from '@/lib/category-factory';
import { syncAutoSnapshotToStorageDir } from '@/utils/download';

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
  /** 新增分类。 */
  addCategory: (input: CategoryInput) => Promise<void>;
  /** 更新分类。 */
  updateCategory: (existing: Category, input: CategoryInput) => Promise<void>;
  /** 删除分类（系统预置会抛错）。 */
  deleteCategory: (id: string) => Promise<void>;
}

/**
 * 初始化分类列表与写操作。
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
      const list =
        typeof runtime.categoryRepository.ensureSystemCategories === 'function' && runtime.clock
          ? await runtime.categoryRepository.ensureSystemCategories(
              runtime.clock,
              CATEGORY_LOCAL_DEVICE_ID,
            )
          : await runtime.categoryRepository.list();
      setCategories(list);
      setError(null);
      syncAutoSnapshotToStorageDir(
        JSON.stringify(
          {
            schema: 'lifehub-categories-v1',
            updatedAt: new Date().toISOString(),
            categoryCount: list.length,
            categories: list,
          },
          null,
          2,
        ),
        'lifehub-categories.json',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '本地数据读写失败');
    } finally {
      setLoading(false);
    }
  }, [runtime, status]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const addCategory = useCallback(
    async (input: CategoryInput): Promise<void> => {
      if (!runtime) {
        throw new Error('保险库未就绪');
      }
      const category = buildCategory(input, {
        clock: runtime.clock,
        deviceId: CATEGORY_LOCAL_DEVICE_ID,
      });
      await runtime.categoryRepository.save(category);
      await reload();
    },
    [runtime, reload],
  );

  const updateCategory = useCallback(
    async (existing: Category, input: CategoryInput): Promise<void> => {
      if (!runtime) {
        throw new Error('保险库未就绪');
      }
      const category = buildCategory(input, { clock: runtime.clock, deviceId: CATEGORY_LOCAL_DEVICE_ID }, existing);
      await runtime.categoryRepository.save(category);
      await reload();
    },
    [runtime, reload],
  );

  const deleteCategory = useCallback(
    async (id: string): Promise<void> => {
      if (!runtime) {
        throw new Error('保险库未就绪');
      }
      await runtime.categoryRepository.delete(id);
      await reload();
    },
    [runtime, reload],
  );

  return { categories, loading, error, reload, addCategory, updateCategory, deleteCategory };
}
