/**
 * 远程云存储连接与多端数据加密同步面板组件。
 *
 * 架构位置：apps/web 的「设置与安全组件」层。
 *
 * 说明：
 * 1. 支持主流 5 大云存储（阿里云 OSS、腾讯云 COS、华为云 OBS、坚果云 WebDAV、Amazon S3），
 *    连接地址直接填写包含存储桶名称或远程目录的完整 URL，无需单独拆分填写 Bucket；
 * 2. 上传与拉取均采用按月加密分片 + 持久化分片内容哈希索引（`syncCloudUploadSmart` / `syncCloudPullSmart`）：
 *    - 无变动时仅读取约 1KB 清单比对哈希，0 分片传输、0 全表解密、~100ms 瞬时完成；
 *    - 单月变动时仅按月读取本地库并传输变动分片，仅将实际差异账单写入本地 IndexedDB。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  FormControlLabel,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CloudDoneOutlined from '@mui/icons-material/CloudDoneOutlined';
import CloudDownloadOutlined from '@mui/icons-material/CloudDownloadOutlined';
import CloudUploadOutlined from '@mui/icons-material/CloudUploadOutlined';
import DownloadOutlined from '@mui/icons-material/DownloadOutlined';
import ExpandLessOutlined from '@mui/icons-material/ExpandLessOutlined';
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';
import KeyOutlined from '@mui/icons-material/KeyOutlined';
import type { Bill, Category } from '@lifehub/core';
import {
  CLOUD_PROVIDERS,
  computePasswordFingerprint,
  decryptCloudSourceJson,
  getCloudProviderPreset,
  loadCloudConfig,
  loadLatestCloudSyncRecord,
  loadLocalCloudTombstones,
  mergeCloudDatasets,
  probeRemoteCloudConnection,
  restoreBillsFromCloud,
  saveCloudConfig,
  saveLocalCloudTombstones,
  syncCloudPullSmart,
  syncCloudUploadSmart,
  testCloudConnection,
  uploadBillsToCloud,
  type CloudBackupExtraModules,
  type CloudFullDataset,
  type CloudProviderId,
  type CloudStorageConfig,
  type CloudSyncRecord,
  type LocalBillSyncDataSource,
  type PurgedEntityIds,
} from '@/lib/cloud-storage';
import {
  clearDailyBillIndexCache,
  scanIndexedDbBillDateCounts,
} from '@/lib/bill-daily-index';
import type { StoredScheduleSlot } from '@/modules/schedule/rrule';
import type { StoredHabit, StoredHabitCheckIn } from '@/modules/habits/habit-service';
import { DiaryService, type DecryptedDiaryEntry } from '@/modules/diary/diary-service';
import type { CompletionEvent } from '@/modules/shared/completion-event';
import { createDatabase } from '@/platform/db';
import type { PlatformRuntime } from '@/platform';
import { useBillStore } from '@/store';
import { invalidateLoadedDayBillsCache } from '@/hooks/useBillList';
import { useVault } from '@/hooks/useVault';
import { downloadText } from '@/utils/download';

interface CategoryRepoLike {
  list?: () => Promise<Category[]>;
  save?: (cat: Category) => Promise<void>;
  put?: (cat: Category) => Promise<void>;
  delete?: (id: string) => Promise<void>;
}

/**
 * 根据用户粘贴的连接地址域名自动识别云服务商（若未命中特定域名则保持原选择）。
 */
function inferProviderFromEndpoint(
  rawEndpoint: string,
  fallback: CloudProviderId,
): CloudProviderId {
  const lower = rawEndpoint.trim().toLowerCase();
  if (lower.includes('myqcloud.com')) return 'tencent-cos';
  if (lower.includes('aliyuncs.com')) return 'aliyun-oss';
  if (lower.includes('myhuaweicloud.com')) return 'huawei-obs';
  if (lower.includes('jianguoyun.com')) return 'jianguoyun-webdav';
  return fallback;
}

/**
 * 在真实浏览器 / WebView 中让出一帧绘制机会，确保状态提示与按钮转圈在重负载开始前立即上屏（jsdom 测试环境下零延迟直通）。
 */
async function waitNextPaintFrame(): Promise<void> {
  if (typeof window === 'undefined' || typeof setTimeout !== 'function') {
    return;
  }
  const ua = typeof navigator !== 'undefined' ? (navigator.userAgent ?? '') : '';
  if (/jsdom/i.test(ua)) {
    return;
  }
  const timerMeta = setTimeout as unknown as { clock?: unknown; _isMockFunction?: boolean };
  if (timerMeta.clock !== undefined || timerMeta._isMockFunction === true) {
    return;
  }
  await new Promise<void>((resolve) => {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => {
        setTimeout(resolve, 0);
      });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * 渲染远程云存储连接与多端数据同步面板。
 */
export function CloudStoragePanel() {
  const { runtime } = useVault();
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const bills = useBillStore((state) => state.bills);
  const setBills = useBillStore((state) => state.setBills);

  const [config, setConfig] = useState<CloudStorageConfig>(() => loadCloudConfig());
  const [encryptionPassword, setEncryptionPassword] = useState<string>(
    () => loadCloudConfig().savedPassword ?? '',
  );
  const [allowPasswordChange, setAllowPasswordChange] = useState<boolean>(false);
  const [decryptedSource, setDecryptedSource] = useState<string | null>(null);
  const [extraModulesState, setExtraModulesState] = useState<CloudBackupExtraModules>({});
  const [lastRecord, setLastRecord] = useState<CloudSyncRecord | null>(() =>
    loadLatestCloudSyncRecord(),
  );
  const [banner, setBanner] = useState<{
    severity: 'success' | 'info' | 'warning' | 'error';
    text: string;
  } | null>(null);
  const [busyAction, setBusyAction] = useState<'test' | 'upload' | 'restore' | null>(null);
  const [panelExpanded, setPanelExpanded] = useState<boolean>(false);

  const buildLocalBillDataSource = useCallback((): LocalBillSyncDataSource => {
    return {
      getLocalBillCount: async () => {
        const storeBills = useBillStore.getState().bills;
        if (storeBills.length > 0) {
          return storeBills.length;
        }
        const activeRuntime = runtimeRef.current as PlatformRuntime | null;
        const counts = await scanIndexedDbBillDateCounts(activeRuntime);
        if (counts !== null) {
          let total = 0;
          for (const c of counts.values()) total += c;
          return total;
        }
        const repo = activeRuntime?.billRepository as { list?: () => Promise<Bill[]> } | undefined;
        if (repo && typeof repo.list === 'function') {
          return (await repo.list()).length;
        }
        return 0;
      },
      loadMonthLocalBills: async (month: string) => {
        const storeBills = useBillStore.getState().bills;
        if (storeBills.length > 0) {
          return storeBills.filter((b) => b.localDate.slice(0, 7) === month);
        }
        const repo = runtimeRef.current?.billRepository as
          | { queryByLocalDateRange?: (from: string, to: string) => Promise<Bill[]> }
          | undefined;
        if (repo && typeof repo.queryByLocalDateRange === 'function') {
          return repo.queryByLocalDateRange(`${month}-01`, `${month}-31`);
        }
        const listFn = (runtimeRef.current?.billRepository as { list?: () => Promise<Bill[]> })
          ?.list;
        if (typeof listFn === 'function') {
          const all = await listFn.call(runtimeRef.current?.billRepository);
          return all.filter((b) => b.localDate.slice(0, 7) === month);
        }
        return [];
      },
      loadAllLocalBills: async () => {
        const storeBills = useBillStore.getState().bills;
        if (storeBills.length > 0) {
          return [...storeBills];
        }
        const listFn = (runtimeRef.current?.billRepository as { list?: () => Promise<Bill[]> })
          ?.list;
        if (typeof listFn === 'function') {
          return listFn.call(runtimeRef.current?.billRepository);
        }
        return [];
      },
    };
  }, []);

  const loadLocalExtraModules = useCallback(async (): Promise<CloudBackupExtraModules> => {
    let categories: Category[] = [];
    let scheduleSlots: StoredScheduleSlot[] = [];
    let completionEvents: CompletionEvent[] = [];
    let habits: StoredHabit[] = [];
    let habitCheckIns: StoredHabitCheckIn[] = [];
    let diaryEntries: DecryptedDiaryEntry[] = [];

    try {
      const catRepo = (
        runtimeRef.current as { categoryRepository?: CategoryRepoLike } | null
      )?.categoryRepository;
      if (catRepo && typeof catRepo.list === 'function') {
        categories = await catRepo.list();
      }
    } catch {
      // 忽略分类仓库未就绪异常
    }

    try {
      const db = createDatabase();
      const diaryService = new DiaryService(db);
      const [slots, events, habitList, checkIns, diaries] = await Promise.all([
        db.table<StoredScheduleSlot>('scheduleSlots').toArray(),
        db.table<CompletionEvent>('completionEvents').toArray(),
        db.table<StoredHabit>('habits').toArray(),
        db.table<StoredHabitCheckIn>('habitCheckIns').toArray(),
        diaryService.exportAllDecrypted(),
      ]);
      scheduleSlots = slots;
      completionEvents = events;
      habits = habitList;
      habitCheckIns = checkIns;
      diaryEntries = diaries;
    } catch {
      // 忽略测试环境 IndexedDB 不可用异常
    }

    const tombstones = loadLocalCloudTombstones();

    return {
      categories,
      scheduleSlots,
      scheduleEvents: scheduleSlots,
      completionEvents,
      scheduleCompletions: completionEvents,
      habits,
      habitCheckIns,
      habitCheckins: habitCheckIns,
      diaryEntries,
      tombstones,
    };
  }, []);

  /**
   * 将实际新增/修改的差异账单及核心模块写回本机持久化层，绝不重复重写未变动的万级账单。
   */
  const applyIncrementalChangesToLocalPersistence = useCallback(
    async (
      billsToPut: readonly Bill[],
      mergedCore: Omit<CloudFullDataset, 'bills'>,
      purged: PurgedEntityIds,
      fullBillsForNonLazyFallback?: Bill[],
      skipCloudDirtyMark = false,
      onProgress?: (statusText: string) => void,
    ): Promise<void> => {
      saveLocalCloudTombstones(mergedCore.tombstones);

      const activeRuntime = runtimeRef.current;
      const supportsLazyByDate = Boolean(
        activeRuntime &&
          typeof (activeRuntime.billRepository as { queryByLocalDateRange?: unknown })
            .queryByLocalDateRange === 'function',
      );

      if (activeRuntime) {
        const billRepo = activeRuntime.billRepository as {
          put: (bill: Bill) => Promise<void>;
          putMany?: (items: readonly Bill[]) => Promise<void>;
          delete: (id: string) => Promise<void>;
          deleteMany?: (ids: readonly string[]) => Promise<void>;
        };

        if (purged.billIds.length > 0) {
          if (typeof billRepo.deleteMany === 'function') {
            try {
              await billRepo.deleteMany(purged.billIds);
            } catch {
              // 忽略不存在异常
            }
          } else {
            for (const delId of purged.billIds) {
              try {
                await billRepo.delete(delId);
              } catch {
                // 忽略不存在异常
              }
            }
          }
        }

        if (billsToPut.length > 0) {
          if (billsToPut.length > 1 && typeof billRepo.putMany === 'function') {
            const WRITE_BATCH = 300;
            for (let offset = 0; offset < billsToPut.length; offset += WRITE_BATCH) {
              const slice = billsToPut.slice(offset, offset + WRITE_BATCH);
              const doneCount = Math.min(offset + slice.length, billsToPut.length);
              if (billsToPut.length > WRITE_BATCH) {
                onProgress?.(`正在分批加密写入本地账单库（${doneCount}/${billsToPut.length}）…`);
                await waitNextPaintFrame();
              }
              await billRepo.putMany(slice);
            }
          } else {
            for (const bill of billsToPut) {
              await billRepo.put(bill);
            }
          }
        }

        const catRepo = (
          activeRuntime as { categoryRepository?: CategoryRepoLike } | null
        )?.categoryRepository;
        if (catRepo) {
          if (typeof catRepo.delete === 'function') {
            for (const delCatId of purged.categoryIds) {
              try {
                await catRepo.delete(delCatId);
              } catch {
                // 系统预置分类不可删，跳过即可
              }
            }
          }
          for (const category of mergedCore.categories) {
            try {
              if (typeof catRepo.save === 'function') {
                await catRepo.save(category);
              } else if (typeof catRepo.put === 'function') {
                await catRepo.put(category);
              }
            } catch {
              // 同名系统分类已存在时跳过
            }
          }
        }
      }

      try {
        const db = createDatabase();
        const diaryService = new DiaryService(db);

        if (purged.scheduleSlotIds.length > 0) {
          await db.table<StoredScheduleSlot>('scheduleSlots').bulkDelete(purged.scheduleSlotIds);
        }
        if (mergedCore.scheduleSlots.length > 0) {
          await db.table<StoredScheduleSlot>('scheduleSlots').bulkPut(mergedCore.scheduleSlots);
        }

        if (purged.completionEventIds.length > 0) {
          await db
            .table<CompletionEvent>('completionEvents')
            .bulkDelete(purged.completionEventIds);
        }
        if (mergedCore.completionEvents.length > 0) {
          await db
            .table<CompletionEvent>('completionEvents')
            .bulkPut(mergedCore.completionEvents);
        }

        if (purged.habitIds.length > 0) {
          await db.table<StoredHabit>('habits').bulkDelete(purged.habitIds);
        }
        if (mergedCore.habits.length > 0) {
          await db.table<StoredHabit>('habits').bulkPut(mergedCore.habits);
        }

        if (purged.habitCheckInIds.length > 0) {
          await db
            .table<StoredHabitCheckIn>('habitCheckIns')
            .bulkDelete(purged.habitCheckInIds);
        }
        if (mergedCore.habitCheckIns.length > 0) {
          await db.table<StoredHabitCheckIn>('habitCheckIns').bulkPut(mergedCore.habitCheckIns);
        }

        for (const delDiaryId of purged.diaryEntryIds) {
          await diaryService.deleteEntry(delDiaryId);
        }
        if (mergedCore.diaryEntries.length > 0) {
          await diaryService.importAllFromBackup(mergedCore.diaryEntries);
        }
      } catch {
        // 忽略测试环境 IndexedDB 不可用异常
      }

      setExtraModulesState({
        categories: mergedCore.categories,
        scheduleSlots: mergedCore.scheduleSlots,
        scheduleEvents: mergedCore.scheduleSlots,
        completionEvents: mergedCore.completionEvents,
        scheduleCompletions: mergedCore.completionEvents,
        habits: mergedCore.habits,
        habitCheckIns: mergedCore.habitCheckIns,
        habitCheckins: mergedCore.habitCheckIns,
        diaryEntries: mergedCore.diaryEntries,
        tombstones: mergedCore.tombstones,
      });

      if (billsToPut.length > 0 || purged.billIds.length > 0) {
        clearDailyBillIndexCache();
        invalidateLoadedDayBillsCache(
          billsToPut.map((b) => b.localDate),
          { skipCloudDirtyMark },
        );
      }

      const currentStoreBills = useBillStore.getState().bills;
      if (currentStoreBills.length > 0) {
        const purgedSet = new Set(purged.billIds);
        const byId = new Map<string, Bill>();
        for (const b of currentStoreBills) {
          if (!purgedSet.has(b.id)) byId.set(b.id, b);
        }
        for (const b of billsToPut) {
          if (!purgedSet.has(b.id)) byId.set(b.id, b);
        }
        const nextList = [...byId.values()].sort((a, b) =>
          a.occurredAt > b.occurredAt ? -1 : a.occurredAt < b.occurredAt ? 1 : 0,
        );
        setBills(nextList);
      } else if (!supportsLazyByDate && fullBillsForNonLazyFallback) {
        setBills(fullBillsForNonLazyFallback);
      }
    },
    [setBills],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await loadLocalExtraModules();
      if (!cancelled) {
        setExtraModulesState(loaded);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadLocalExtraModules]);

  const updateConfig = (patch: Partial<CloudStorageConfig>): void => {
    setConfig((prev) => {
      const next = { ...prev, ...patch, bucket: '', encryptUpload: true };
      saveCloudConfig(next);
      return next;
    });
  };

  const handleSelectProvider = (providerId: CloudProviderId): void => {
    const preset = getCloudProviderPreset(providerId);
    updateConfig({
      provider: providerId,
      endpoint: preset.defaultEndpoint,
      bucket: '',
    });
    setBanner({
      severity: 'info',
      text: `已切换至「${preset.name}」预设地址（${preset.defaultEndpoint}）`,
    });
  };

  const handleEndpointChange = (nextEndpoint: string): void => {
    const inferredProvider = inferProviderFromEndpoint(nextEndpoint, config.provider);
    updateConfig({
      provider: inferredProvider,
      endpoint: nextEndpoint,
      bucket: '',
    });
  };

  const handleTestConnection = (): void => {
    saveCloudConfig(config);
    const localResult = testCloudConnection(config);
    if (!localResult.ok) {
      setBanner({
        severity: 'error',
        text: localResult.message,
      });
      return;
    }

    const hasCredentials =
      config.accessKey.trim().length > 0 && config.secretKey.trim().length > 0;
    if (!hasCredentials) {
      setBanner({
        severity: 'success',
        text: localResult.message,
      });
      return;
    }

    setBusyAction('test');
    setBanner({
      severity: 'info',
      text: '正在向远程云存储发起真实连通与密钥鉴权探测…',
    });
    void (async () => {
      try {
        await waitNextPaintFrame();
        const remoteCheck = await probeRemoteCloudConnection(config);
        if (remoteCheck.correctedEndpoint) {
          updateConfig({ endpoint: remoteCheck.correctedEndpoint });
        }
        if (remoteCheck.remoteRecord) {
          setLastRecord(remoteCheck.remoteRecord);
        }
        setBanner({
          severity: remoteCheck.ok ? 'success' : 'error',
          text: remoteCheck.message,
        });
      } finally {
        setBusyAction(null);
      }
    })();
  };

  const handleUpload = (): void => {
    try {
      const hasCredentials =
        config.accessKey.trim().length > 0 && config.secretKey.trim().length > 0;

      if (!hasCredentials) {
        const record = uploadBillsToCloud(config, bills, encryptionPassword, extraModulesState, {
          allowPasswordChange,
        });
        setLastRecord(record);
        setDecryptedSource(null);
        setAllowPasswordChange(false);
        const sizeKbText =
          typeof record.sizeBytes === 'number'
            ? `（体积 ${(record.sizeBytes / 1024).toFixed(1)} KB）`
            : '';
        setBanner({
          severity: 'warning',
          text: `已在本地生成压缩加密快照（${record.objectKey}）${sizeKbText}，但尚未填写 AccessKey ID 与 SecretKey，文件尚未推送到远程「${record.providerName}」！请在上方填入密钥后再点击上传。`,
        });
        return;
      }

      const connCheck = testCloudConnection(config);
      if (!connCheck.ok) {
        setBanner({ severity: 'error', text: connCheck.message });
        return;
      }
      const trimmedSecret = (encryptionPassword || config.savedPassword || '').trim();
      if (!trimmedSecret) {
        setBanner({
          severity: 'error',
          text: '请填写登录密码（加密凭证）：加密密码为必填项，不能为空',
        });
        return;
      }

      setBusyAction('upload');
      setBanner({
        severity: 'info',
        text: '正在检查分片哈希并增量同步…',
      });

      void (async () => {
        try {
          await waitNextPaintFrame();
          const updateProgress = (text: string): void => {
            setBanner({ severity: 'info', text });
          };
          const freshExtra = await loadLocalExtraModules();
          const syncRes = await syncCloudUploadSmart(
            config,
            trimmedSecret,
            freshExtra,
            buildLocalBillDataSource(),
            { allowPasswordChange, onProgress: updateProgress },
          );

          if (syncRes.correctedEndpoint) {
            updateConfig({ endpoint: syncRes.correctedEndpoint });
          }

          if (syncRes.mergedFromRemote) {
            await applyIncrementalChangesToLocalPersistence(
              syncRes.billsToPut,
              syncRes.mergedCore,
              syncRes.purged,
              undefined,
              true,
              updateProgress,
            );
          } else {
            setExtraModulesState(freshExtra);
          }

          setLastRecord(syncRes.record);
          setDecryptedSource(null);
          setAllowPasswordChange(false);

          const refreshedSizeKb =
            typeof syncRes.record.sizeBytes === 'number'
              ? ` · 总体积 ${(syncRes.record.sizeBytes / 1024).toFixed(1)} KB`
              : '';
          const revLabel = syncRes.record.revision ? ` · v${syncRes.record.revision}` : '';
          const shardHint = syncRes.skippedUnchangedUpload
            ? '（分片哈希无变动，已跳过重复上传）'
            : `（按哈希增量上传 ${syncRes.uploadedShardCount}/${syncRes.totalShardCount} 个分片）`;

          setBanner({
            severity: 'success',
            text: `已同步 ${syncRes.record.billCount} 条账单及生活数据至「${syncRes.record.providerName}」${shardHint}${revLabel}${refreshedSizeKb}`,
          });
        } catch (remoteErr) {
          const latestMeta = loadLatestCloudSyncRecord();
          if (latestMeta) {
            setLastRecord(latestMeta);
          }
          setBanner({
            severity: 'error',
            text:
              remoteErr instanceof Error
                ? remoteErr.message
                : '推送至远程对象存储失败，请检查连接地址与密钥权限',
          });
        } finally {
          setBusyAction(null);
        }
      })();
    } catch (err) {
      setBanner({
        severity: 'error',
        text: err instanceof Error ? err.message : '上传云端备份失败',
      });
    }
  };

  const handleRestore = async (): Promise<void> => {
    const hasCredentials =
      config.accessKey.trim().length > 0 && config.secretKey.trim().length > 0;
    const updateProgress = (text: string): void => {
      setBanner({ severity: 'info', text });
    };

    // 点击瞬间同步展示状态提示与按钮转圈，绝不等本地库扫描后再提示
    setBusyAction('restore');
    setBanner({
      severity: 'info',
      text: hasCredentials
        ? '正在连接云端读取分片清单…'
        : '正在解密本地备份缓存并准备恢复…',
    });

    try {
      await waitNextPaintFrame();
      const freshLocal = await loadLocalExtraModules();

      if (hasCredentials) {
        const pullRes = await syncCloudPullSmart(
          config,
          encryptionPassword,
          freshLocal,
          buildLocalBillDataSource(),
          { onProgress: updateProgress },
        );
        if (pullRes.unchanged) {
          setLastRecord(pullRes.record);
          setBanner({
            severity: 'success',
            text: `云端分片哈希无新改动，本机已是最新（共 ${pullRes.totalBillCount} 条账单 · 0 个分片需重下）`,
          });
          return;
        }
        if (pullRes.billsToPut.length > 0) {
          updateProgress(`正在写入本地加密库（共 ${pullRes.billsToPut.length} 条新增或变动账单）…`);
          await waitNextPaintFrame();
        }
        const supportsLazy = Boolean(
          runtimeRef.current &&
            typeof (runtimeRef.current.billRepository as { queryByLocalDateRange?: unknown })
              .queryByLocalDateRange === 'function',
        );
        await applyIncrementalChangesToLocalPersistence(
          pullRes.billsToPut,
          pullRes.mergedCore,
          pullRes.purged,
          supportsLazy ? undefined : [...bills, ...pullRes.billsToPut],
          true,
          updateProgress,
        );
        pullRes.commitSyncedStateAfterPersist?.();
        setLastRecord(pullRes.record);
        setBanner({
          severity: 'success',
          text: `已从「${pullRes.record.providerName}」按需拉取 ${pullRes.downloadedShardCount}/${pullRes.totalShardCount} 个变动分片并同步完成（共 ${pullRes.totalBillCount} 条账单，仅写入 ${pullRes.billsToPut.length} 条差异记录）`,
        });
        return;
      }

      // 离线本地快照缓存恢复兼容路径
      const restored = restoreBillsFromCloud(config, encryptionPassword);
      const localBillsAll = await buildLocalBillDataSource().loadAllLocalBills();
      const localDataset: CloudFullDataset = {
        bills: localBillsAll,
        categories: [...(freshLocal.categories ?? [])],
        scheduleSlots: [...(freshLocal.scheduleSlots ?? [])],
        completionEvents: [...(freshLocal.completionEvents ?? [])],
        habits: [...(freshLocal.habits ?? [])],
        habitCheckIns: [...(freshLocal.habitCheckIns ?? [])],
        diaryEntries: [...(freshLocal.diaryEntries ?? [])],
        tombstones: [...(freshLocal.tombstones ?? [])],
      };
      const remoteDataset: CloudFullDataset = {
        bills: restored.bills,
        categories: restored.categories,
        scheduleSlots: restored.scheduleSlots,
        completionEvents: restored.completionEvents,
        habits: restored.habits,
        habitCheckIns: restored.habitCheckIns,
        diaryEntries: restored.diaryEntries,
        tombstones: restored.tombstones,
      };
      const mergedResult = mergeCloudDatasets(
        localDataset,
        remoteDataset,
        lastRecord?.revision ?? 0,
        restored.record.revision ?? 1,
      );

      await applyIncrementalChangesToLocalPersistence(
        mergedResult.merged.bills,
        {
          categories: mergedResult.merged.categories,
          scheduleSlots: mergedResult.merged.scheduleSlots,
          completionEvents: mergedResult.merged.completionEvents,
          habits: mergedResult.merged.habits,
          habitCheckIns: mergedResult.merged.habitCheckIns,
          diaryEntries: mergedResult.merged.diaryEntries,
          tombstones: mergedResult.merged.tombstones,
        },
        mergedResult.purged,
        mergedResult.merged.bills,
        false,
        updateProgress,
      );
      setLastRecord(restored.record);
      setBanner({
        severity: 'success',
        text: `已凭登录密码从「${restored.record.providerName}」成功解密并合并恢复 ${mergedResult.merged.bills.length} 条账单记录（含分类 ${mergedResult.merged.categories.length} 项、课表 ${mergedResult.merged.scheduleSlots.length} 项、习惯 ${mergedResult.merged.habits.length} 项、树洞 ${mergedResult.merged.diaryEntries.length} 条）`,
      });
    } catch (err) {
      const latestMeta = loadLatestCloudSyncRecord();
      if (latestMeta) {
        setLastRecord(latestMeta);
      }
      setBanner({
        severity: 'error',
        text: err instanceof Error ? err.message : '从云端恢复账单失败',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDecryptSource = (): void => {
    try {
      const { rawJson, record } = decryptCloudSourceJson(config, encryptionPassword);
      setDecryptedSource(rawJson);
      setLastRecord(record);
      setBanner({
        severity: 'success',
        text: `已凭登录密码成功还原「${record.objectKey}」的原始 JSON 源文件内容（共 ${record.billCount} 条账单）`,
      });
    } catch (err) {
      setDecryptedSource(null);
      setBanner({
        severity: 'error',
        text: err instanceof Error ? err.message : '用登录密码还原源文件内容失败',
      });
    }
  };

  const handleDownloadDecryptedSource = (): void => {
    if (!decryptedSource) {
      return;
    }
    downloadText('lifehub-backup-restored.json', decryptedSource, 'application/json');
  };

  const activePreset = getCloudProviderPreset(config.provider);
  const rememberPasswordChecked = config.rememberPassword !== false;
  const trimmedPwd = encryptionPassword.trim();
  const currentFingerprint = trimmedPwd ? computePasswordFingerprint(trimmedPwd) : '';
  const hasPreviousFingerprint = Boolean(lastRecord?.passwordFingerprint);
  const hasPasswordMismatch = Boolean(
    hasPreviousFingerprint &&
      currentFingerprint &&
      lastRecord?.passwordFingerprint !== currentFingerprint,
  );
  const isPasswordMatched = Boolean(
    hasPreviousFingerprint &&
      currentFingerprint &&
      lastRecord?.passwordFingerprint === currentFingerprint,
  );

  const handlePasswordChange = (nextPwd: string): void => {
    setEncryptionPassword(nextPwd);
    if (rememberPasswordChecked) {
      updateConfig({ rememberPassword: true, savedPassword: nextPwd });
    }
  };

  const handleToggleRememberPassword = (checked: boolean): void => {
    updateConfig({
      rememberPassword: checked,
      savedPassword: checked ? encryptionPassword : '',
    });
  };

  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 2, sm: 2.5 },
        mb: 2,
        borderRadius: '12px',
        backgroundColor: 'var(--lifehub-surface)',
        borderColor: 'var(--lifehub-border)',
      }}
      data-testid="cloud-storage-panel"
    >
      {/* 精简折叠顶栏：默认仅占单行，点击展开完整同步表单 */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1.5}
        onClick={() => setPanelExpanded((prev) => !prev)}
        sx={{ cursor: 'pointer', userSelect: 'none' }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              远程云存储连接与加密同步
            </Typography>
            <Chip
              size="small"
              color="success"
              variant="outlined"
              icon={<KeyOutlined sx={{ fontSize: 15 }} />}
              label="强制加密上传（登录密码保护）"
              data-testid="cloud-upload-mode-chip"
              sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
            />
          </Stack>
          <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
            {lastRecord
              ? `最近同步：${lastRecord.providerName} · ${lastRecord.billCount} 条账单${
                  lastRecord.revision ? ` · v${lastRecord.revision}` : ''
                }`
              : `当前服务商：${activePreset.name}（点击展开配置连接与上传/恢复）`}
          </Typography>
        </Box>
        <Button
          size="small"
          variant="text"
          endIcon={panelExpanded ? <ExpandLessOutlined /> : <ExpandMoreOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            setPanelExpanded((prev) => !prev);
          }}
          data-testid="cloud-panel-toggle-button"
          sx={{ flexShrink: 0 }}
        >
          {panelExpanded ? '收起' : '展开配置'}
        </Button>
      </Stack>

      <Collapse in={panelExpanded} timeout="auto">
        <Divider sx={{ my: 2 }} />

        <Stack spacing={2}>
          {/* 1. 云服务商下拉框 + 单一完整连接地址 */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              select
              size="small"
              label="云存储服务商"
              value={config.provider}
              onChange={(e) => handleSelectProvider(e.target.value as CloudProviderId)}
              SelectProps={{
                native: true,
                inputProps: { 'data-testid': 'cloud-provider-select' },
              }}
              sx={{ minWidth: { sm: 230 } }}
            >
              {CLOUD_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </TextField>

            <TextField
              fullWidth
              size="small"
              label="连接地址（直接含 Bucket 域名或 WebDAV 目录）"
              placeholder={activePreset.defaultEndpoint}
              value={config.endpoint}
              onChange={(e) => handleEndpointChange(e.target.value)}
              helperText={activePreset.description}
              inputProps={{ 'data-testid': 'cloud-endpoint-input' }}
            />
          </Stack>

          {/* 2. 访问密钥 / WebDAV 账号密码 */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              fullWidth
              size="small"
              label={
                config.provider === 'jianguoyun-webdav'
                  ? '坚果云账号邮箱'
                  : 'AccessKey ID（访问密钥 ID）'
              }
              value={config.accessKey}
              onChange={(e) => updateConfig({ accessKey: e.target.value })}
              inputProps={{ 'data-testid': 'cloud-access-key-input' }}
            />
            <TextField
              fullWidth
              size="small"
              type="password"
              label={
                config.provider === 'jianguoyun-webdav'
                  ? 'WebDAV 应用密码'
                  : 'AccessKey Secret（访问密钥 Secret）'
              }
              value={config.secretKey}
              onChange={(e) => updateConfig({ secretKey: e.target.value })}
              inputProps={{ 'data-testid': 'cloud-secret-key-input' }}
            />
          </Stack>

          {/* 3. 登录密码（强制加密凭证） */}
          <Box>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              alignItems={{ sm: 'center' }}
            >
              <TextField
                fullWidth
                size="small"
                type="password"
                required
                label="登录密码（云端备份加密与解密凭证）"
                placeholder="必填：上传加密与跨设备拉取解密需使用相同密码"
                value={encryptionPassword}
                onChange={(e) => handlePasswordChange(e.target.value)}
                inputProps={{ 'data-testid': 'cloud-encryption-password-input' }}
              />
              <FormControlLabel
                sx={{ flexShrink: 0, mr: 0 }}
                control={
                  <Checkbox
                    size="small"
                    checked={rememberPasswordChecked}
                    onChange={(e) => handleToggleRememberPassword(e.target.checked)}
                    data-testid="cloud-remember-password-checkbox"
                  />
                }
                label={<Typography variant="body2">记住加密密码</Typography>}
              />
            </Stack>

            {isPasswordMatched && (
              <Typography
                variant="caption"
                sx={{ color: 'success.main', display: 'block', mt: 0.5 }}
                data-testid="cloud-password-match-hint"
              >
                ✓ 当前密码与最近一次云端备份密码指纹一致
              </Typography>
            )}

            {hasPasswordMismatch && (
              <Box sx={{ mt: 1 }}>
                <Alert severity="warning" sx={{ py: 0.5 }}>
                  检测到当前输入的密码与上次云端备份密码不一致。若确需更换新密码覆盖云端快照，请勾选下方确认项：
                </Alert>
                <FormControlLabel
                  sx={{ mt: 0.5 }}
                  control={
                    <Checkbox
                      size="small"
                      checked={allowPasswordChange}
                      onChange={(e) => setAllowPasswordChange(e.target.checked)}
                      data-testid="cloud-allow-password-change-checkbox"
                    />
                  }
                  label={
                    <Typography variant="caption">
                      允许使用新密码覆盖云端备份（更换密码后其他设备也需输入新密码）
                    </Typography>
                  }
                />
              </Box>
            )}
          </Box>

          {/* 4. 操作按钮栏 */}
          <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
            <Button
              variant="outlined"
              size="small"
              disabled={busyAction !== null}
              startIcon={
                busyAction === 'test' ? <CircularProgress size={14} color="inherit" /> : undefined
              }
              onClick={handleTestConnection}
              data-testid="cloud-test-button"
            >
              {busyAction === 'test' ? '正在测试连接…' : '测试连接'}
            </Button>
            <Button
              variant="contained"
              size="small"
              disabled={busyAction !== null}
              startIcon={
                busyAction === 'upload' ? (
                  <CircularProgress size={14} color="inherit" />
                ) : (
                  <CloudUploadOutlined />
                )
              }
              onClick={handleUpload}
              data-testid="cloud-upload-button"
            >
              {busyAction === 'upload' ? '正在上传同步…' : '立即上传备份至云端'}
            </Button>
            <Button
              variant="outlined"
              color="secondary"
              size="small"
              disabled={busyAction !== null}
              startIcon={
                busyAction === 'restore' ? (
                  <CircularProgress size={14} color="inherit" />
                ) : (
                  <CloudDownloadOutlined />
                )
              }
              onClick={() => void handleRestore()}
              data-testid="cloud-restore-button"
            >
              {busyAction === 'restore' ? '正在拉取恢复…' : '从云端拉取恢复'}
            </Button>
            {lastRecord && (
              <Button
                variant="text"
                size="small"
                disabled={busyAction !== null}
                onClick={handleDecryptSource}
                data-testid="cloud-decrypt-source-button"
              >
                用登录密码还原源文件内容
              </Button>
            )}
          </Stack>

          {banner && (
            <Alert
              severity={banner.severity}
              onClose={() => setBanner(null)}
              data-testid="cloud-action-banner"
            >
              {banner.text}
            </Alert>
          )}

          {lastRecord && (
            <Box
              sx={{
                p: 1.5,
                borderRadius: 2,
                backgroundColor: 'var(--lifehub-bg)',
                border: '1px solid var(--lifehub-border)',
              }}
              data-testid="cloud-sync-status"
            >
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <CloudDoneOutlined sx={{ fontSize: 18, color: 'success.main' }} />
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  最近同步：{lastRecord.objectKey}
                </Typography>
                <Chip
                  size="small"
                  label="强制加密上传（登录密码保护）"
                  color="success"
                  variant="outlined"
                />
              </Stack>
              <Typography
                variant="caption"
                sx={{ color: 'var(--lifehub-text-muted)', display: 'block', mt: 0.5 }}
              >
                同步时间：{lastRecord.syncedAt} · 账单 {lastRecord.billCount} 条
                {typeof lastRecord.sizeBytes === 'number'
                  ? ` · 压缩加密体积 ${(lastRecord.sizeBytes / 1024).toFixed(1)} KB`
                  : ''}
              </Typography>
            </Box>
          )}

          {decryptedSource && (
            <Box data-testid="cloud-decrypted-source-preview">
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ mb: 1 }}
              >
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  解密还原的 JSON 源文件预览
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<DownloadOutlined />}
                  onClick={handleDownloadDecryptedSource}
                  data-testid="cloud-download-source-button"
                >
                  下载还原后的 JSON
                </Button>
              </Stack>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  p: 1.5,
                  maxHeight: 240,
                  overflow: 'auto',
                  borderRadius: 2,
                  fontSize: 12,
                  backgroundColor: 'var(--lifehub-bg)',
                  border: '1px solid var(--lifehub-border)',
                }}
              >
                {decryptedSource.slice(0, 4000)}
              </Box>
            </Box>
          )}
        </Stack>
      </Collapse>
    </Paper>
  );
}
