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
import { recordCloudTombstone, recordCloudTombstones } from '@/lib/cloud-tombstones';
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

interface BatchCapableBillRepo {
  put: (bill: Bill) => Promise<void>;
  putMany?: (bills: readonly Bill[]) => Promise<void>;
}

let pendingBillsSnapshotTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 合并防抖更新本地存储目录中的账单快照，避免万级账单高频点击分类/编辑时阻塞主线程或重复全量写盘。
 */
function scheduleBillsAutoSnapshot(list: readonly Bill[]): void {
  if (pendingBillsSnapshotTimer !== null) {
    clearTimeout(pendingBillsSnapshotTimer);
  }
  pendingBillsSnapshotTimer = setTimeout(() => {
    pendingBillsSnapshotTimer = null;
    try {
      const readableBills = list.map((b) => ({
        ...b,
        amountYuan: Number((b.amountMinor / 100).toFixed(2)),
      }));
      const payload = {
        schema: 'lifehub-bills-v1',
        updatedAt: new Date().toISOString(),
        billCount: readableBills.length,
        bills: readableBills,
      };
      // 大账单集省去缩进空白，降低 35%+ 体积并提速 3 倍序列化
      const serialized =
        readableBills.length > 500
          ? JSON.stringify(payload)
          : JSON.stringify(payload, null, 2);
      syncAutoSnapshotToStorageDir(serialized, 'lifehub-bills.json');
    } catch {
      // 忽略后台快照序列化异常
    }
  }, 300);
}

async function putBillsBatch(repo: BatchCapableBillRepo, items: readonly Bill[]): Promise<void> {
  if (items.length === 0) {
    return;
  }
  if (items.length > 1 && typeof repo.putMany === 'function') {
    await repo.putMany(items);
    return;
  }
  for (const item of items) {
    await repo.put(item);
  }
}

/**
 * 初始化账单增删改动作。
 *
 * @returns 写操作集合（均可能抛异常）
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
      scheduleBillsAutoSnapshot(list);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '本地数据读写失败');
    }
  }, [runtime, setBills, setError, status]);

  const applyCategoryMemory = useCallback(
    async (
      targetBill: Bill,
      workingBills: readonly Bill[],
      options?: BillCategoryActionOptions,
    ): Promise<{ result: CategoryMemoryActionResult; updatedMap: Map<string, Bill> }> => {
      const updatedMap = new Map<string, Bill>();
      const shouldRemember = options?.rememberCategory !== false;
      if (!runtime || !shouldRemember || !targetBill.categoryId) {
        return {
          result: {
            remembered: false,
            itemLabel: '',
            categoryId: targetBill.categoryId,
            autoCategorizedCount: 0,
          },
          updatedMap,
        };
      }
      const itemKey = extractBillItemKey(targetBill);
      const itemLabel = extractBillItemLabel(targetBill);
      if (!itemKey) {
        return {
          result: {
            remembered: false,
            itemLabel: '',
            categoryId: targetBill.categoryId,
            autoCategorizedCount: 0,
          },
          updatedMap,
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

      const batchUpdates: Bill[] = [];
      for (const candidate of workingBills) {
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
          batchUpdates.push(updatedCandidate);
          updatedMap.set(updatedCandidate.id, updatedCandidate);
        }
      }

      if (batchUpdates.length > 0) {
        await putBillsBatch(runtime.billRepository as BatchCapableBillRepo, batchUpdates);
      }

      return {
        result: {
          remembered: true,
          itemLabel,
          categoryId: targetBill.categoryId,
          autoCategorizedCount: batchUpdates.length,
        },
        updatedMap,
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
      const timeZone =
        useSettingsStore.getState().timezone ||
        (typeof Intl !== 'undefined'
          ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
          : 'UTC');
      const storeBills = useBillStore.getState().bills;
      const workingBills = storeBills.length > 0 ? storeBills : await runtime.billRepository.list();
      const effectiveCategoryId =
        input.categoryId ??
        lookupRememberedCategoryId(
          { counterparty: input.counterparty, note: input.note },
          workingBills,
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
      const { result: memoryResult, updatedMap } = await applyCategoryMemory(
        built,
        workingBills,
        options,
      );
      if (storeBills.length > 0) {
        const nextBills = [
          built,
          ...storeBills.map((b) => updatedMap.get(b.id) ?? b),
        ];
        setBills(nextBills);
        scheduleBillsAutoSnapshot(nextBills);
      } else {
        await refresh();
      }
      return memoryResult;
    },
    [runtime, applyCategoryMemory, refresh, setBills],
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
      const storeBills = useBillStore.getState().bills;
      const workingBills = storeBills.length > 0 ? storeBills : await runtime.billRepository.list();
      const { result: memoryResult, updatedMap } = await applyCategoryMemory(
        updated,
        workingBills,
        options,
      );
      if (storeBills.length > 0) {
        const nextBills = storeBills.map((b) =>
          b.id === updated.id ? updated : (updatedMap.get(b.id) ?? b),
        );
        setBills(nextBills);
        scheduleBillsAutoSnapshot(nextBills);
      } else {
        await refresh();
      }
      return memoryResult;
    },
    [runtime, applyCategoryMemory, refresh, setBills],
  );

  const deleteBill = useCallback(
    async (id: string): Promise<void> => {
      if (!runtime) {
        throw new Error('保险库未就绪');
      }
      await runtime.billRepository.delete(id);
      recordCloudTombstone('bill', id);
      const storeBills = useBillStore.getState().bills;
      if (storeBills.length > 0) {
        const nextBills = storeBills.filter((b) => b.id !== id);
        setBills(nextBills);
        scheduleBillsAutoSnapshot(nextBills);
      } else {
        await refresh();
      }
    },
    [runtime, refresh, setBills],
  );

  const deleteBillsBySource = useCallback(
    async (sourceFileId: string): Promise<number> => {
      if (!runtime) {
        throw new Error('保险库未就绪');
      }
      const storeBills = useBillStore.getState().bills;
      const beforeList = storeBills.length > 0 ? storeBills : await runtime.billRepository.list();
      const targetIds = beforeList
        .filter((bill) => bill.sourceFileId === sourceFileId)
        .map((bill) => bill.id);
      let deleted = 0;
      if (runtime.billRepository.deleteBySourceFileId) {
        deleted = await runtime.billRepository.deleteBySourceFileId(sourceFileId);
      } else {
        for (const id of targetIds) {
          await runtime.billRepository.delete(id);
          deleted += 1;
        }
      }
      recordCloudTombstones('bill', targetIds);
      if (storeBills.length > 0) {
        const nextBills = storeBills.filter((bill) => bill.sourceFileId !== sourceFileId);
        setBills(nextBills);
        scheduleBillsAutoSnapshot(nextBills);
      } else {
        await refresh();
      }
      return deleted;
    },
    [runtime, refresh, setBills],
  );

  const clearAllBills = useCallback(async (): Promise<number> => {
    if (!runtime) {
      throw new Error('保险库未就绪');
    }
    const storeBills = useBillStore.getState().bills;
    const beforeList = storeBills.length > 0 ? storeBills : await runtime.billRepository.list();
    const allIds = beforeList.map((bill) => bill.id);
    let deleted = 0;
    if (runtime.billRepository.clearAll) {
      deleted = await runtime.billRepository.clearAll();
    } else {
      for (const id of allIds) {
        await runtime.billRepository.delete(id);
        deleted += 1;
      }
    }
    recordCloudTombstones('bill', allIds);
    if (runtime.importBatchRepository?.list && runtime.importBatchRepository?.delete) {
      const batches = await runtime.importBatchRepository.list();
      for (const batch of batches) {
        await runtime.importBatchRepository.delete(batch.id);
      }
    }
    setBills([]);
    scheduleBillsAutoSnapshot([]);
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
      const storeBills = useBillStore.getState().bills;
      const workingBills = storeBills.length > 0 ? storeBills : await runtime.billRepository.list();
      const { result: memoryResult, updatedMap } = await applyCategoryMemory(
        updated,
        workingBills,
        options,
      );
      if (storeBills.length > 0) {
        const nextBills = storeBills.map((b) =>
          b.id === updated.id ? updated : (updatedMap.get(b.id) ?? b),
        );
        setBills(nextBills);
        scheduleBillsAutoSnapshot(nextBills);
      } else {
        await refresh();
      }
      return memoryResult;
    },
    [runtime, applyCategoryMemory, refresh, setBills],
  );

  const markBillsAsTransfer = useCallback(
    async (billsToMark: readonly Bill[], transferCategoryId: string): Promise<void> => {
      if (!runtime) {
        throw new Error('保险库未就绪');
      }
      const now = runtime.clock?.nowIso ? runtime.clock.nowIso() : new Date().toISOString();
      const batchUpdates: Bill[] = [];
      const updatedMap = new Map<string, Bill>();
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
        batchUpdates.push(updated);
        updatedMap.set(updated.id, updated);
      }
      await putBillsBatch(runtime.billRepository as BatchCapableBillRepo, batchUpdates);
      const storeBills = useBillStore.getState().bills;
      if (storeBills.length > 0 && updatedMap.size > 0) {
        const nextBills = storeBills.map((b) => updatedMap.get(b.id) ?? b);
        setBills(nextBills);
        scheduleBillsAutoSnapshot(nextBills);
      } else {
        await refresh();
      }
    },
    [runtime, refresh, setBills],
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
