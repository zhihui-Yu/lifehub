/**
 * 账单增删改 Hook。
 *
 * 架构位置：apps/web 的「Hooks」层。
 *
 * 说明：封装「记一笔 / 编辑 / 删除」三个写操作——先经 `bill-factory` 组装并校验实体，
 * 再写入 `runtime.billRepository`，最后**重新拉取**整个账单工作集以保证内存态与本地库一致
 * （系统设计 §5：解密后的账单只驻留内存，过滤在内存工作集上完成）。
 *
 * 失败语义：写操作抛异常（校验失败 / 存储失败），由调用方（对话框）捕获并展示中文错误。
 */
import { useCallback } from 'react';
import { extractBillItemKey, extractBillItemLabel, type Bill } from '@lifehub/core';
import { useVault } from './useVault';
import { useBillStore, useSettingsStore } from '@/store';
import {
  applyBillEdit,
  buildManualBill,
  LOCAL_DEVICE_ID,
  type ManualBillInput,
} from '@/lib/bill-factory';
import {
  lookupRememberedCategoryId,
  persistCategoryMemoryToRepo,
  saveRememberedCategoryMapping,
} from '@/lib/category-memory';
import { syncAutoSnapshotToStorageDir } from '@/utils/download';

/** 账单分类动作的附加选项。 */
export interface BillCategoryActionOptions {
  /** 是否记住此次分类选择并批量更新存量相同未分类账单（默认 true）。 */
  rememberCategory?: boolean;
}

/** 账单分类记忆与存量自动归类的执行反馈结果。 */
export interface CategoryMemoryActionResult {
  /** 是否执行了分类记忆（当存在有效相同项标识且目标分类非空时为 true）。 */
  remembered: boolean;
  /** 记住的相同项可读名称（交易对方或备注）。 */
  itemLabel: string;
  /** 目标分类 ID。 */
  categoryId: string | null;
  /** 连带自动归类的存量相同未分类账单条数。 */
  autoCategorizedCount: number;
}

/**
 * 初始化账单增删改动作。
 *
 * @returns 三个写操作（均可能抛异常）
 */
export function useBillActions() {
  const { runtime, status } = useVault();
  const setBills = useBillStore((state) => state.setBills);
  const setError = useBillStore((state) => state.setError);

  const refresh = useCallback(async () => {
    if (!runtime || status !== 'unlocked') {
      return;
    }
    try {
      const list = await runtime.billRepository.list();
      setBills(list);
      // 自动同步更新本地存储目录下的实时数据文件 lifehub-auto-snapshot.json
      const readableBills = list.map((b) => ({
        ...b,
        amountYuan: Number((b.amountMinor / 100).toFixed(2)),
      }));
      syncAutoSnapshotToStorageDir(
        JSON.stringify(
          {
            schema: 'lifehub-bills-v1',
            updatedAt: new Date().toISOString(),
            billCount: readableBills.length,
            bills: readableBills,
          },
          null,
          2,
        ),
        'lifehub-bills.json',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '本地数据读写失败');
    }
  }, [runtime, setBills, setError, status]);

  const applyCategoryMemory = useCallback(
    async (
      targetBill: Bill,
      options?: BillCategoryActionOptions,
    ): Promise<CategoryMemoryActionResult> => {
      const shouldRemember = options?.rememberCategory !== false;
      if (!runtime || !shouldRemember || !targetBill.categoryId) {
        return {
          remembered: false,
          itemLabel: '',
          categoryId: targetBill.categoryId,
          autoCategorizedCount: 0,
        };
      }
      const itemKey = extractBillItemKey(targetBill);
      const itemLabel = extractBillItemLabel(targetBill);
      if (!itemKey) {
        return {
          remembered: false,
          itemLabel: '',
          categoryId: targetBill.categoryId,
          autoCategorizedCount: 0,
        };
      }

      const now = runtime.clock?.nowIso ? runtime.clock.nowIso() : new Date().toISOString();
      saveRememberedCategoryMapping(itemKey, targetBill.categoryId);
      await persistCategoryMemoryToRepo(
        runtime.ruleTemplateRepository,
        itemKey,
        targetBill.categoryId,
        now,
        LOCAL_DEVICE_ID,
      );

      let autoCategorizedCount = 0;
      const allBills = await runtime.billRepository.list();
      for (const candidate of allBills) {
        if (
          candidate.id !== targetBill.id &&
          (candidate.categoryId === null || candidate.categoryId === '') &&
          extractBillItemKey(candidate) === itemKey
        ) {
          const updatedCandidate: Bill = {
            ...candidate,
            categoryId: targetBill.categoryId,
            updatedAt: now,
            version: candidate.version + 1,
            deviceId: LOCAL_DEVICE_ID,
          };
          await runtime.billRepository.put(updatedCandidate);
          autoCategorizedCount += 1;
        }
      }

      return {
        remembered: true,
        itemLabel,
        categoryId: targetBill.categoryId,
        autoCategorizedCount,
      };
    },
    [runtime],
  );

  const addBill = useCallback(
    async (
      input: ManualBillInput,
      options?: BillCategoryActionOptions,
    ): Promise<CategoryMemoryActionResult> => {
      if (!runtime) {
        throw new Error('保险库未就绪');
      }
      // 时区优先使用用户在「设置」中配置的默认时区（回退到宿主时区或 UTC）。
      const timeZone =
        useSettingsStore.getState().timezone ||
        (typeof Intl !== 'undefined'
          ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
          : 'UTC');
      const effectiveCategoryId =
        input.categoryId ??
        lookupRememberedCategoryId(
          { counterparty: input.counterparty, note: input.note },
          useBillStore.getState().bills,
        );
      const built = buildManualBill(
        { ...input, categoryId: effectiveCategoryId },
        {
          clock: runtime.clock,
          deviceId: LOCAL_DEVICE_ID,
          timeZone,
        },
      );
      await runtime.billRepository.put(built);
      const memoryResult = await applyCategoryMemory(built, options);
      await refresh();
      return memoryResult;
    },
    [runtime, applyCategoryMemory, refresh],
  );

  const updateBill = useCallback(
    async (
      existing: Bill,
      input: ManualBillInput,
      options?: BillCategoryActionOptions,
    ): Promise<CategoryMemoryActionResult> => {
      if (!runtime) {
        throw new Error('保险库未就绪');
      }
      const timeZone =
        useSettingsStore.getState().timezone ||
        (typeof Intl !== 'undefined'
          ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
          : 'UTC');
      const updated = applyBillEdit(existing, input, {
        clock: runtime.clock,
        deviceId: LOCAL_DEVICE_ID,
        timeZone,
      });
      await runtime.billRepository.put(updated);
      const memoryResult = await applyCategoryMemory(updated, options);
      await refresh();
      return memoryResult;
    },
    [runtime, applyCategoryMemory, refresh],
  );

  const deleteBill = useCallback(
    async (id: string): Promise<void> => {
      if (!runtime) {
        throw new Error('保险库未就绪');
      }
      await runtime.billRepository.delete(id);
      await refresh();
    },
    [runtime, refresh],
  );

  const deleteBillsBySource = useCallback(
    async (sourceFileId: string): Promise<number> => {
      if (!runtime) {
        throw new Error('保险库未就绪');
      }
      let deleted = 0;
      if (runtime.billRepository.deleteBySourceFileId) {
        deleted = await runtime.billRepository.deleteBySourceFileId(sourceFileId);
      } else {
        const list = await runtime.billRepository.list();
        for (const bill of list) {
          if (bill.sourceFileId === sourceFileId) {
            await runtime.billRepository.delete(bill.id);
            deleted += 1;
          }
        }
      }
      await refresh();
      return deleted;
    },
    [runtime, refresh],
  );

  const clearAllBills = useCallback(async (): Promise<number> => {
    if (!runtime) {
      throw new Error('保险库未就绪');
    }
    let deleted = 0;
    if (runtime.billRepository.clearAll) {
      deleted = await runtime.billRepository.clearAll();
    } else {
      const list = await runtime.billRepository.list();
      for (const bill of list) {
        await runtime.billRepository.delete(bill.id);
        deleted += 1;
      }
    }
    if (runtime.importBatchRepository?.list && runtime.importBatchRepository?.delete) {
      const batches = await runtime.importBatchRepository.list();
      for (const batch of batches) {
        await runtime.importBatchRepository.delete(batch.id);
      }
    }
    setBills([]);
    return deleted;
  }, [runtime, setBills]);

  const setBillCategoryId = useCallback(
    async (
      existing: Bill,
      categoryId: string | null,
      options?: BillCategoryActionOptions,
    ): Promise<CategoryMemoryActionResult> => {
      if (!runtime) {
        throw new Error('保险库未就绪');
      }
      const now = runtime.clock?.nowIso ? runtime.clock.nowIso() : new Date().toISOString();
      const updated: Bill = {
        ...existing,
        categoryId,
        updatedAt: now,
        version: existing.version + 1,
        deviceId: LOCAL_DEVICE_ID,
      };
      await runtime.billRepository.put(updated);
      const memoryResult = await applyCategoryMemory(updated, options);
      await refresh();
      return memoryResult;
    },
    [runtime, applyCategoryMemory, refresh],
  );

  const markBillsAsTransfer = useCallback(
    async (billsToMark: readonly Bill[], transferCategoryId: string): Promise<void> => {
      if (!runtime) {
        throw new Error('保险库未就绪');
      }
      const now = runtime.clock?.nowIso ? runtime.clock.nowIso() : new Date().toISOString();
      for (const bill of billsToMark) {
        if (bill.categoryId === transferCategoryId) {
          continue;
        }
        const updated: Bill = {
          ...bill,
          categoryId: transferCategoryId,
          updatedAt: now,
          version: bill.version + 1,
          deviceId: LOCAL_DEVICE_ID,
        };
        await runtime.billRepository.put(updated);
      }
      await refresh();
    },
    [runtime, refresh],
  );

  return {
    addBill,
    updateBill,
    deleteBill,
    deleteBillsBySource,
    clearAllBills,
    setBillCategoryId,
    markBillsAsTransfer,
  };
}
