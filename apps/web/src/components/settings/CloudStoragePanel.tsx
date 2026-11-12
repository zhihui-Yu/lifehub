/**
 * 远程云存储连接与账单同步面板组件。
 *
 * 架构位置：apps/web 的「设置与安全组件」层。
 *
 * 说明：支持连接主流 5 大云存储服务商（阿里云 OSS、腾讯云 COS、华为云 OBS、坚果云 WebDAV、Amazon S3），
 * 上传时 100% 强制使用用户登录密码进行加密封装（生成 `.json.enc` 密文文件），
 * 并支持用户凭登录密码从云端拉取恢复账单，或直接用登录密码解密还原并下载原始 JSON 源文件内容。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import CloudDoneOutlined from '@mui/icons-material/CloudDoneOutlined';
import CloudDownloadOutlined from '@mui/icons-material/CloudDownloadOutlined';
import CloudQueueOutlined from '@mui/icons-material/CloudQueueOutlined';
import CloudUploadOutlined from '@mui/icons-material/CloudUploadOutlined';
import DownloadOutlined from '@mui/icons-material/DownloadOutlined';
import KeyOutlined from '@mui/icons-material/KeyOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import type { Category } from '@lifehub/core';
import {
  CLOUD_PROVIDERS,
  decryptCloudSourceJson,
  getCloudProviderPreset,
  loadCloudConfig,
  loadLatestCloudSyncRecord,
  pullSnapshotFromRemoteCloud,
  pushSnapshotToRemoteCloud,
  restoreBillsFromCloud,
  saveCloudConfig,
  testCloudConnection,
  uploadBillsToCloud,
  type CloudBackupExtraModules,
  type CloudProviderId,
  type CloudStorageConfig,
  type CloudSyncRecord,
} from '@/lib/cloud-storage';
import type { StoredScheduleSlot } from '@/modules/schedule/rrule';
import type { StoredHabit, StoredHabitCheckIn } from '@/modules/habits/habit-service';
import { DiaryService, type DecryptedDiaryEntry } from '@/modules/diary/diary-service';
import type { CompletionEvent } from '@/modules/shared/completion-event';
import { createDatabase } from '@/platform/db';
import { useBillStore } from '@/store';
import { useVault } from '@/hooks/useVault';
import { downloadText } from '@/utils/download';

/**
 * 渲染远程云存储连接与账单同步面板。
 *
 * 说明：在「设置」页提供云服务商切换、连接测试、基于登录密码的强制加密上传、云端拉取恢复及源文件内容解密还原。
 *
 * @param _props 组件无外部入参
 * @returns React 节点
 * @throws 无；所有异常均在组件内捕获并转为 Alert 提示
 */
export function CloudStoragePanel() {
  const { runtime } = useVault();
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const bills = useBillStore((state) => state.bills);
  const setBills = useBillStore((state) => state.setBills);

  const [config, setConfig] = useState<CloudStorageConfig>(() => loadCloudConfig());
  const [encryptionPassword, setEncryptionPassword] = useState<string>('');
  const [decryptedSource, setDecryptedSource] = useState<string | null>(null);
  const [extraModulesState, setExtraModulesState] = useState<CloudBackupExtraModules>({});
  const [lastRecord, setLastRecord] = useState<CloudSyncRecord | null>(() =>
    loadLatestCloudSyncRecord(),
  );
  const [banner, setBanner] = useState<{
    severity: 'success' | 'info' | 'warning' | 'error';
    text: string;
  } | null>(null);

  const loadLocalExtraModules = useCallback(async (): Promise<CloudBackupExtraModules> => {
    let categories: Category[] = [];
    let scheduleSlots: StoredScheduleSlot[] = [];
    let completionEvents: CompletionEvent[] = [];
    let habits: StoredHabit[] = [];
    let habitCheckIns: StoredHabitCheckIn[] = [];
    let diaryEntries: DecryptedDiaryEntry[] = [];

    try {
      const catRepo = (
        runtimeRef.current as { categoryRepository?: { list?: () => Promise<Category[]> } } | null
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
    };
  }, []);

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
      const next = { ...prev, ...patch, encryptUpload: true };
      saveCloudConfig(next);
      return next;
    });
  };

  const handleSelectProvider = (providerId: CloudProviderId): void => {
    const preset = getCloudProviderPreset(providerId);
    updateConfig({
      provider: providerId,
      endpoint: preset.defaultEndpoint,
      bucket: preset.defaultBucket,
    });
    setBanner({
      severity: 'info',
      text: `已切换至「${preset.name}」预设端点（${preset.defaultEndpoint}）`,
    });
  };

  const handleTestConnection = (): void => {
    saveCloudConfig(config);
    const result = testCloudConnection(config);
    setBanner({
      severity: result.ok ? 'success' : 'error',
      text: result.message,
    });
  };

  const handleUpload = (): void => {
    try {
      const record = uploadBillsToCloud(config, bills, encryptionPassword, extraModulesState);
      setLastRecord(record);
      setDecryptedSource(null);

      const hasCredentials =
        config.accessKey.trim().length > 0 && config.secretKey.trim().length > 0;
      if (!hasCredentials) {
        setBanner({
          severity: 'warning',
          text: `已在本地生成加密快照（${record.objectKey}），但尚未填写 AccessKey ID 与 AccessKey Secret，文件尚未推送到远程「${record.providerName}」存储桶！请在上方填入密钥后再点击上传。`,
        });
      } else {
        setBanner({
          severity: 'info',
          text: `正在将加密备份推送至远程「${record.providerName}」（${record.objectKey}）…`,
        });
      }

      void (async () => {
        try {
          const freshExtra = await loadLocalExtraModules();
          setExtraModulesState(freshExtra);
          const refreshedRecord = uploadBillsToCloud(
            config,
            bills,
            encryptionPassword,
            freshExtra,
          );
          setLastRecord(refreshedRecord);

          if (hasCredentials) {
            const remoteRes = await pushSnapshotToRemoteCloud(config);
            if (remoteRes.correctedEndpoint) {
              updateConfig({ endpoint: remoteRes.correctedEndpoint });
            }
            setBanner({
              severity: 'success',
              text: `已使用登录密码加密并将 ${refreshedRecord.billCount} 条账单及全量生活数据真实上传至「${refreshedRecord.providerName}」（远程地址：${remoteRes.remoteUrl}）`,
            });
          }
        } catch (remoteErr) {
          setBanner({
            severity: 'error',
            text:
              remoteErr instanceof Error
                ? remoteErr.message
                : '推送至远程对象存储失败，请检查 Endpoint、Bucket 与密钥权限',
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
      const {
        bills: restoredBills,
        record,
        categories: restoredCategories,
        scheduleSlots: restoredSlots,
        completionEvents: restoredEvents,
        habits: restoredHabits,
        habitCheckIns: restoredCheckIns,
        diaryEntries: restoredDiaries,
        extraModules,
      } = restoreBillsFromCloud(config, encryptionPassword);
      if (runtime) {
        for (const bill of restoredBills) {
          await runtime.billRepository.put(bill);
        }
        const catRepo = (
          runtime as { categoryRepository?: { put?: (cat: Category) => Promise<void> } } | null
        )?.categoryRepository;
        if (catRepo && typeof catRepo.put === 'function') {
          for (const category of restoredCategories) {
            await catRepo.put(category);
          }
        }
      }
      try {
        const db = createDatabase();
        const diaryService = new DiaryService(db);
        if (restoredSlots.length > 0) {
          await db.table<StoredScheduleSlot>('scheduleSlots').bulkPut(restoredSlots);
        }
        if (restoredEvents.length > 0) {
          await db.table<CompletionEvent>('completionEvents').bulkPut(restoredEvents);
        }
        if (restoredHabits.length > 0) {
          await db.table<StoredHabit>('habits').bulkPut(restoredHabits);
        }
        if (restoredCheckIns.length > 0) {
          await db.table<StoredHabitCheckIn>('habitCheckIns').bulkPut(restoredCheckIns);
        }
        if (restoredDiaries.length > 0) {
          await diaryService.importAllFromBackup(restoredDiaries);
        }
      } catch {
        // 忽略测试环境 IndexedDB 不可用异常
      }
      setExtraModulesState(extraModules);
      setBills(restoredBills);
      setLastRecord(record);
      setBanner({
        severity: 'success',
        text: `已凭登录密码从「${record.providerName}」成功解密并恢复 ${restoredBills.length} 条账单记录（含分类 ${restoredCategories.length} 项、课表 ${restoredSlots.length} 项、习惯 ${restoredHabits.length} 项、树洞 ${restoredDiaries.length} 条）`,
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
    downloadText('lifehub-bills-source-restored.json', decryptedSource, 'application/json');
  };

  const activePreset = getCloudProviderPreset(config.provider);

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 3,
        mb: 3,
        backgroundColor: 'var(--lifehub-surface)',
        borderColor: 'var(--lifehub-border)',
      }}
      data-testid="cloud-storage-panel"
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1,
          mb: 1,
        }}
      >
        <Typography
          variant="subtitle1"
          sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}
        >
          <CloudQueueOutlined fontSize="small" color="primary" />
          远程云存储连接与备份（支持主流云盘）
        </Typography>
        <Chip
          size="small"
          icon={<LockOutlined fontSize="small" />}
          color="success"
          label="强制加密上传（登录密码保护）"
          data-testid="cloud-upload-mode-chip"
        />
      </Box>

      <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)', mb: 2 }}>
        连接你自己的主流对象存储或 WebDAV 云盘同步账单数据。上传时强制使用你的登录密码进行加密封装（生成 .json.enc 密文）；如需查看或导出原始明文，可随时输入登录密码还原源文件内容。
      </Typography>

      {/* 云存储连接参数表单（仅保留下拉框选择云厂商，不再冗余平铺厂商卡片） */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 2,
          mb: 2,
        }}
      >
        <TextField
          select
          size="small"
          label="云存储服务商"
          value={config.provider}
          onChange={(e) => handleSelectProvider(e.target.value as CloudProviderId)}
          SelectProps={{ native: true }}
          inputProps={{ 'data-testid': 'cloud-provider-select' }}
          helperText={activePreset.description}
        >
          {CLOUD_PROVIDERS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </TextField>

        <TextField
          size="small"
          label="Endpoint 服务端点地址"
          value={config.endpoint}
          onChange={(e) => updateConfig({ endpoint: e.target.value })}
          placeholder={activePreset.defaultEndpoint}
          inputProps={{ 'data-testid': 'cloud-endpoint-input' }}
          helperText="如 https://oss-cn-hangzhou.aliyuncs.com"
        />

        <TextField
          size="small"
          label={
            config.provider === 'jianguoyun-webdav'
              ? 'WebDAV 远程文件夹路径'
              : 'Bucket 存储桶名称'
          }
          value={config.bucket}
          onChange={(e) => updateConfig({ bucket: e.target.value })}
          placeholder={activePreset.defaultBucket}
          inputProps={{ 'data-testid': 'cloud-bucket-input' }}
          helperText="用于存放账单备份文件的存储桶或目录"
        />

        <TextField
          size="small"
          label={
            config.provider === 'jianguoyun-webdav'
              ? '坚果云账号邮箱'
              : 'AccessKey ID / 访问账号'
          }
          value={config.accessKey}
          onChange={(e) => updateConfig({ accessKey: e.target.value })}
          placeholder="选填或填入云存储 AccessKey"
          inputProps={{ 'data-testid': 'cloud-access-key-input' }}
        />

        <TextField
          size="small"
          type="password"
          label={
            config.provider === 'jianguoyun-webdav'
              ? 'WebDAV 应用密码'
              : 'SecretKey / 访问密钥'
          }
          value={config.secretKey}
          onChange={(e) => updateConfig({ secretKey: e.target.value })}
          placeholder="选填或填入云存储 SecretKey"
          inputProps={{ 'data-testid': 'cloud-secret-key-input' }}
        />
      </Box>

      {/* 强制加密上传（使用登录密码作为加密与还原密钥）安全区 */}
      <Box
        sx={{
          p: 2,
          mb: 2,
          borderRadius: 1.5,
          backgroundColor: 'var(--lifehub-bg)',
          border: '1px solid var(--lifehub-border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--lifehub-text)', display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <KeyOutlined fontSize="small" color="primary" />
              登录密码加密与源文件还原保护（强制开启）
            </Typography>
            <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
              上传云端时固定使用下方登录密码进行加密；从云端恢复账单或需要查看原始 JSON 源文件内容时，输入同一登录密码即可解密还原。
            </Typography>
          </Box>
        </Box>
        <TextField
          size="small"
          type="password"
          fullWidth
          label="登录密码（加密上传与还原凭证）"
          value={encryptionPassword}
          onChange={(e) => setEncryptionPassword(e.target.value)}
          placeholder="请输入登录密码用于加密上传或还原源文件内容"
          inputProps={{ 'data-testid': 'cloud-encryption-password-input' }}
        />
      </Box>

      {/* 操作按钮组 */}
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
        <Button
          variant="outlined"
          startIcon={<CloudDoneOutlined />}
          onClick={handleTestConnection}
          data-testid="cloud-test-button"
        >
          测试连接
        </Button>
        <Button
          variant="contained"
          startIcon={<CloudUploadOutlined />}
          onClick={handleUpload}
          data-testid="cloud-upload-button"
        >
          立即上传备份至云端
        </Button>
        <Button
          variant="outlined"
          color="secondary"
          startIcon={<CloudDownloadOutlined />}
          onClick={() => {
            void handleRestore();
          }}
          data-testid="cloud-restore-button"
        >
          从云端拉取恢复
        </Button>
        <Button
          variant="outlined"
          color="primary"
          startIcon={<KeyOutlined />}
          onClick={handleDecryptSource}
          data-testid="cloud-decrypt-source-button"
        >
          用登录密码还原源文件内容
        </Button>
      </Box>

      {/* 状态反馈与最近同步记录 */}
      {banner ? (
        <Alert
          severity={banner.severity}
          sx={{ mb: 1.5 }}
          onClose={() => setBanner(null)}
          data-testid="cloud-action-banner"
        >
          {banner.text}
        </Alert>
      ) : null}

      {/* 还原后的原始 JSON 源文件预览与下载 */}
      {decryptedSource ? (
        <Box
          sx={{
            p: 2,
            mb: 1.5,
            borderRadius: 1.5,
            backgroundColor: 'var(--lifehub-bg)',
            border: '1px solid var(--lifehub-border)',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--lifehub-text)' }}>
              已凭登录密码还原的 JSON 源文件内容
            </Typography>
            <Button
              size="small"
              variant="outlined"
              startIcon={<DownloadOutlined />}
              onClick={handleDownloadDecryptedSource}
              data-testid="cloud-download-source-button"
            >
              下载还原后的 JSON 源文件
            </Button>
          </Box>
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 1.5,
              maxHeight: 220,
              overflow: 'auto',
              borderRadius: 1,
              fontSize: '0.78rem',
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

      <Box
        sx={{
          p: 1.5,
          borderRadius: 1,
          backgroundColor: 'var(--lifehub-bg)',
          border: '1px solid var(--lifehub-border)',
        }}
        data-testid="cloud-sync-status"
      >
        {lastRecord ? (
          <Typography variant="caption" sx={{ color: 'var(--lifehub-text)', display: 'block' }}>
            最近云端同步：{lastRecord.providerName} · 共 {lastRecord.billCount} 条账单 · 模式：
            强制加密上传（登录密码保护） · 路径：{lastRecord.objectKey}
          </Typography>
        ) : (
          <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)', display: 'block' }}>
            当前云端同步状态：尚未上传备份（当前选择：{activePreset.name}，强制使用登录密码加密上传）
          </Typography>
        )}
      </Box>
    </Paper>
  );
}
