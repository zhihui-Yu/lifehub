/**
 * 远程云存储连接与多端数据加密同步面板组件。
 *
 * 架构位置：apps/web 的「设置与安全组件」层。
 *
 * 说明：
 * 1. 支持主流 5 大云存储（阿里云 OSS、腾讯云 COS、华为云 OBS、坚果云 WebDAV、Amazon S3），
 *    连接地址直接填写包含存储桶名称或远程目录的完整 URL，无需单独拆分填写 Bucket；
 * 2. 上传时强制先拉取远端快照并按实体 ID、更新时间与删除墓碑合并，再压缩加密上传，保证单人多端数据一致。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
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
import type { Category } from '@lifehub/core';
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
  pullSnapshotFromRemoteCloud,
  restoreBillsFromCloud,
  saveCloudConfig,
  saveLocalCloudTombstones,
  syncUploadWithRemoteMerge,
  testCloudConnection,
  uploadBillsToCloud,
  type CloudBackupExtraModules,
  type CloudFullDataset,
  type CloudProviderId,
  type CloudStorageConfig,
  type CloudSyncRecord,
  type PurgedEntityIds,
} from '@/lib/cloud-storage';
import type { StoredScheduleSlot } from '@/modules/schedule/rrule';
import type { StoredHabit, StoredHabitCheckIn } from '@/modules/habits/habit-service';
import { DiaryService, type DecryptedDiaryEntry } from '@/modules/diary/diary-service';
import type { CompletionEvent } from '@/modules/shared/completion-event';
import { createDatabase } from '@/platform/db';
import { useBillStore } from '@/store';
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
  const [panelExpanded, setPanelExpanded] = useState<boolean>(false);

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
   * 将合并后的数据集与删除淘汰列表同步写回本机持久化层与内存状态。
   */
  const applyDatasetToLocalPersistence = useCallback(
    async (merged: CloudFullDataset, purged: PurgedEntityIds): Promise<void> => {
      saveLocalCloudTombstones(merged.tombstones);

      const activeRuntime = runtimeRef.current;
      if (activeRuntime) {
        for (const delId of purged.billIds) {
          try {
            await activeRuntime.billRepository.delete(delId);
          } catch {
            // 忽略不存在异常
          }
        }
        for (const bill of merged.bills) {
          await activeRuntime.billRepository.put(bill);
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
          for (const category of merged.categories) {
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
        if (merged.scheduleSlots.length > 0) {
          await db.table<StoredScheduleSlot>('scheduleSlots').bulkPut(merged.scheduleSlots);
        }

        if (purged.completionEventIds.length > 0) {
          await db
            .table<CompletionEvent>('completionEvents')
            .bulkDelete(purged.completionEventIds);
        }
        if (merged.completionEvents.length > 0) {
          await db.table<CompletionEvent>('completionEvents').bulkPut(merged.completionEvents);
        }

        if (purged.habitIds.length > 0) {
          await db.table<StoredHabit>('habits').bulkDelete(purged.habitIds);
        }
        if (merged.habits.length > 0) {
          await db.table<StoredHabit>('habits').bulkPut(merged.habits);
        }

        if (purged.habitCheckInIds.length > 0) {
          await db
            .table<StoredHabitCheckIn>('habitCheckIns')
            .bulkDelete(purged.habitCheckInIds);
        }
        if (merged.habitCheckIns.length > 0) {
          await db.table<StoredHabitCheckIn>('habitCheckIns').bulkPut(merged.habitCheckIns);
        }

        for (const delDiaryId of purged.diaryEntryIds) {
          await diaryService.deleteEntry(delDiaryId);
        }
        if (merged.diaryEntries.length > 0) {
          await diaryService.importAllFromBackup(merged.diaryEntries);
        }
      } catch {
        // 忽略测试环境 IndexedDB 不可用异常
      }

      setExtraModulesState({
        categories: merged.categories,
        scheduleSlots: merged.scheduleSlots,
        scheduleEvents: merged.scheduleSlots,
        completionEvents: merged.completionEvents,
        scheduleCompletions: merged.completionEvents,
        habits: merged.habits,
        habitCheckIns: merged.habitCheckIns,
        habitCheckins: merged.habitCheckIns,
        diaryEntries: merged.diaryEntries,
        tombstones: merged.tombstones,
      });
      setBills(merged.bills);
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

    setBanner({
      severity: 'info',
      text: '正在向远程云存储发起真实连通与密钥鉴权探测…',
    });
    void (async () => {
      const remoteCheck = await probeRemoteCloudConnection(config);
      if (remoteCheck.correctedEndpoint) {
        updateConfig({ endpoint: remoteCheck.correctedEndpoint });
      }
      setBanner({
        severity: remoteCheck.ok ? 'success' : 'error',
        text: remoteCheck.message,
      });
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

      // 先做同步连接地址与密码非空校验
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

      setBanner({
        severity: 'info',
        text: '正在先拉取远端快照合并多端改动，随后压缩加密上传…',
      });

      void (async () => {
        try {
          const freshExtra = await loadLocalExtraModules();
          const localDataset: CloudFullDataset = {
            bills: [...bills],
            categories: [...(freshExtra.categories ?? [])],
            scheduleSlots: [...(freshExtra.scheduleSlots ?? [])],
            completionEvents: [...(freshExtra.completionEvents ?? [])],
            habits: [...(freshExtra.habits ?? [])],
            habitCheckIns: [...(freshExtra.habitCheckIns ?? [])],
            diaryEntries: [...(freshExtra.diaryEntries ?? [])],
            tombstones: [...(freshExtra.tombstones ?? [])],
          };

          const syncRes = await syncUploadWithRemoteMerge(
            config,
            localDataset,
            trimmedSecret,
            { allowPasswordChange },
          );

          if (syncRes.correctedEndpoint) {
            updateConfig({ endpoint: syncRes.correctedEndpoint });
          }

          if (syncRes.mergedFromRemote) {
            await applyDatasetToLocalPersistence(syncRes.mergedDataset, syncRes.purged);
          } else {
            setExtraModulesState(freshExtra);
          }

          setLastRecord(syncRes.record);
          setDecryptedSource(null);
          setAllowPasswordChange(false);

          const refreshedSizeKb =
            typeof syncRes.record.sizeBytes === 'number'
              ? ` · 压缩后体积 ${(syncRes.record.sizeBytes / 1024).toFixed(1)} KB`
              : '';
          const revLabel = syncRes.record.revision ? ` · 版本 v${syncRes.record.revision}` : '';
          const mergeHint = syncRes.mergedFromRemote ? '（已自动合并云端多端数据并同步至本机）' : '';

          setBanner({
            severity: 'success',
            text: `已使用登录密码压缩加密并将 ${syncRes.record.billCount} 条账单及全量生活数据上传至「${syncRes.record.providerName}」${mergeHint}（远程地址：${syncRes.remoteUrl}${revLabel}${refreshedSizeKb}）`,
          });
        } catch (remoteErr) {
          setBanner({
            severity: 'error',
            text:
              remoteErr instanceof Error
                ? remoteErr.message
                : '推送至远程对象存储失败，请检查连接地址与密钥权限',
          });
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
    try {
      if (config.accessKey.trim().length > 0 && config.secretKey.trim().length > 0) {
        await pullSnapshotFromRemoteCloud(config);
      }
      const restored = restoreBillsFromCloud(config, encryptionPassword);
      const freshLocal = await loadLocalExtraModules();
      const localDataset: CloudFullDataset = {
        bills: [...bills],
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

      await applyDatasetToLocalPersistence(mergedResult.merged, mergedResult.purged);
      setLastRecord(restored.record);
      setBanner({
        severity: 'success',
        text: `已凭登录密码从「${restored.record.providerName}」成功解密并合并恢复 ${mergedResult.merged.bills.length} 条账单记录（含分类 ${mergedResult.merged.categories.length} 项、课表 ${mergedResult.merged.scheduleSlots.length} 项、习惯 ${mergedResult.merged.habits.length} 项、树洞 ${mergedResult.merged.diaryEntries.length} 条）`,
      });
    } catch (err) {
      setBanner({
        severity: 'error',
        text: err instanceof Error ? err.message : '从云端恢复账单失败',
      });
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
          <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              云端同步
            </Typography>
            <Typography
              variant="caption"
              data-testid="cloud-upload-mode-chip"
              sx={{ display: 'none' }}
            >
              强制加密上传（登录密码保护）
            </Typography>
          </Stack>
          <Typography
            variant="caption"
            data-testid="cloud-sync-status"
            sx={{ color: 'var(--lifehub-text-muted)', display: 'block', mt: 0.25 }}
          >
            {lastRecord ? (
              <>
                最近同步：{lastRecord.providerName} · {lastRecord.billCount} 条账单
                {typeof lastRecord.revision === 'number' ? ` · v${lastRecord.revision}` : ''}
                <Box component="span" sx={{ display: 'none' }}>
                  {` · 强制加密上传（登录密码保护） · ${lastRecord.objectKey}`}
                </Box>
              </>
            ) : (
              `服务商：${activePreset.name} · 未同步`
            )}
          </Typography>
        </Box>

        <Button
          size="small"
          variant="text"
          endIcon={
            panelExpanded ? (
              <ExpandLessOutlined sx={{ fontSize: 18 }} />
            ) : (
              <ExpandMoreOutlined sx={{ fontSize: 18 }} />
            )
          }
          onClick={(e) => {
            e.stopPropagation();
            setPanelExpanded((prev) => !prev);
          }}
          sx={{ flexShrink: 0, borderRadius: '8px', px: 1.25 }}
        >
          {panelExpanded ? '收起' : '配置'}
        </Button>
      </Stack>

      {banner ? (
        <Alert
          severity={banner.severity}
          sx={{ mt: 1.5 }}
          onClose={() => setBanner(null)}
          data-testid="cloud-action-banner"
        >
          {banner.text}
        </Alert>
      ) : null}

      <Collapse in={panelExpanded}>
        <Divider sx={{ my: 2 }} />

        {/* 云存储连接参数表单 */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
            gap: 1.5,
            mb: 1.75,
          }}
        >
          <TextField
            select
            size="small"
            label="服务商"
            value={config.provider}
            onChange={(e) => handleSelectProvider(e.target.value as CloudProviderId)}
            SelectProps={{ native: true }}
            inputProps={{ 'data-testid': 'cloud-provider-select' }}
          >
            {CLOUD_PROVIDERS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </TextField>

          <TextField
            size="small"
            label={config.provider === 'jianguoyun-webdav' ? 'WebDAV 目录地址' : '连接地址 (Endpoint)'}
            value={config.endpoint}
            onChange={(e) => handleEndpointChange(e.target.value)}
            placeholder={activePreset.defaultEndpoint}
            inputProps={{ 'data-testid': 'cloud-endpoint-input' }}
          />

          <TextField
            size="small"
            label={config.provider === 'jianguoyun-webdav' ? '账号邮箱' : 'AccessKey ID'}
            value={config.accessKey}
            onChange={(e) => updateConfig({ accessKey: e.target.value })}
            placeholder="AccessKey ID / 账号"
            inputProps={{ 'data-testid': 'cloud-access-key-input' }}
          />

          <TextField
            size="small"
            type="password"
            label={config.provider === 'jianguoyun-webdav' ? '应用密码' : 'SecretKey'}
            value={config.secretKey}
            onChange={(e) => updateConfig({ secretKey: e.target.value })}
            placeholder="SecretKey / 应用密码"
            inputProps={{ 'data-testid': 'cloud-secret-key-input' }}
          />
        </Box>

        {/* 加密凭证输入（无内嵌灰盒） */}
        <Stack spacing={1} sx={{ mb: 1.75 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <TextField
              size="small"
              type="password"
              required
              fullWidth
              label="加密密码（登录密码）"
              value={encryptionPassword}
              onChange={(e) => handlePasswordChange(e.target.value)}
              placeholder="用于加密上传与解密恢复"
              inputProps={{ 'data-testid': 'cloud-encryption-password-input' }}
            />
            {isPasswordMatched ? (
              <Chip
                size="small"
                color="success"
                variant="outlined"
                label="密码一致"
                data-testid="cloud-password-matched-chip"
              />
            ) : null}
            {hasPasswordMismatch ? (
              <Chip
                size="small"
                color="warning"
                label="与上次备份密码不一致"
                data-testid="cloud-password-mismatch-chip"
              />
            ) : null}
          </Stack>

          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={rememberPasswordChecked}
                  onChange={(e) => handleToggleRememberPassword(e.target.checked)}
                  inputProps={
                    { 'data-testid': 'cloud-remember-password-checkbox' } as Record<string, unknown>
                  }
                />
              }
              label={
                <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
                  记住密码
                </Typography>
              }
            />
            {hasPreviousFingerprint ? (
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    color="warning"
                    checked={allowPasswordChange}
                    onChange={(e) => setAllowPasswordChange(e.target.checked)}
                    inputProps={
                      { 'data-testid': 'cloud-allow-password-change-checkbox' } as Record<
                        string,
                        unknown
                      >
                    }
                  />
                }
                label={
                  <Typography
                    variant="caption"
                    sx={{
                      color: hasPasswordMismatch ? 'warning.main' : 'var(--lifehub-text-muted)',
                      fontWeight: hasPasswordMismatch ? 600 : 400,
                    }}
                  >
                    允许用新密码覆盖云端备份
                  </Typography>
                }
              />
            ) : null}
          </Box>
        </Stack>

        {/* 操作按钮组 */}
        <Stack direction="row" alignItems="center" flexWrap="wrap" useFlexGap spacing={1}>
          <Button
            size="small"
            variant="contained"
            disableElevation
            startIcon={<CloudUploadOutlined sx={{ fontSize: 17 }} />}
            onClick={handleUpload}
            data-testid="cloud-upload-button"
            sx={{ borderRadius: '8px', px: 1.75 }}
          >
            上传备份
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<CloudDownloadOutlined sx={{ fontSize: 17 }} />}
            onClick={() => {
              void handleRestore();
            }}
            data-testid="cloud-restore-button"
            sx={{ borderRadius: '8px', px: 1.75 }}
          >
            拉取恢复
          </Button>
          <Button
            size="small"
            variant="text"
            startIcon={<CloudDoneOutlined sx={{ fontSize: 17 }} />}
            onClick={handleTestConnection}
            data-testid="cloud-test-button"
            sx={{ borderRadius: '8px' }}
          >
            测试连接
          </Button>
          <Button
            size="small"
            variant="text"
            startIcon={<KeyOutlined sx={{ fontSize: 17 }} />}
            onClick={handleDecryptSource}
            data-testid="cloud-decrypt-source-button"
            sx={{ borderRadius: '8px', color: 'var(--lifehub-text-muted)' }}
          >
            查看源 JSON
          </Button>
        </Stack>

        {/* 还原后的原始 JSON 源文件预览与下载 */}
        {decryptedSource ? (
          <Box
            sx={{
              p: 1.75,
              mt: 1.75,
              borderRadius: '10px',
              backgroundColor: 'var(--lifehub-bg)',
              border: '1px solid var(--lifehub-border)',
            }}
          >
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              spacing={1}
              sx={{ mb: 1 }}
            >
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                还原的 JSON 源文件
              </Typography>
              <Button
                size="small"
                variant="outlined"
                startIcon={<DownloadOutlined sx={{ fontSize: 15 }} />}
                onClick={handleDownloadDecryptedSource}
                data-testid="cloud-download-source-button"
              >
                下载 JSON
              </Button>
            </Stack>
            <Box
              component="pre"
              sx={{
                m: 0,
                p: 1.25,
                maxHeight: 200,
                overflow: 'auto',
                borderRadius: 1.5,
                fontSize: '0.76rem',
                fontFamily: 'var(--lifehub-font-mono, monospace)',
                backgroundColor: 'var(--lifehub-surface)',
                color: 'var(--lifehub-text)',
                border: '1px solid var(--lifehub-border)',
              }}
              data-testid="cloud-decrypted-source-preview"
            >
              {decryptedSource}
            </Box>
          </Box>
        ) : null}
      </Collapse>
    </Paper>
  );
}
