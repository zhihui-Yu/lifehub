/**
 * 设置页面。
 *
 * 架构位置：apps/web 的「页面」层。
 *
 * 说明：时区默认北京时间（Asia/Shanghai），币种人民币（CNY），周起始日周一；
 * 采用现代分组列表式卡片布局：基础偏好、本地导出、云端同步（默认折叠）。
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Divider,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import FolderOpenOutlined from '@mui/icons-material/FolderOpenOutlined';
import TableViewOutlined from '@mui/icons-material/TableViewOutlined';
import type { Category, ThemeMode } from '@lifehub/core';
import { CloudStoragePanel } from '@/components/settings/CloudStoragePanel';
import { useVault } from '@/hooks/useVault';
import { DiaryService, type DecryptedDiaryEntry } from '@/modules/diary/diary-service';
import type { StoredHabit, StoredHabitCheckIn } from '@/modules/habits/habit-service';
import type { StoredScheduleSlot } from '@/modules/schedule/rrule';
import type { CompletionEvent } from '@/modules/shared/completion-event';
import { createDatabase } from '@/platform/db';
import { useBillStore, useSettingsStore } from '@/store';
import {
  buildDatedFileName,
  downloadText,
  getStorageDirectory,
  getWebDirectoryHandleName,
  pickWebDirectoryHandle,
  setStorageDirectory,
  syncAutoSnapshotToStorageDir,
} from '@/utils/download';

/**
 * 将单个 CSV 单元格转义为 RFC 4180 安全格式。
 */
function escapeCsvCell(val: string | number | null | undefined): string {
  const text = String(val ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * 渲染极简分组设置页面。
 */
export function SettingsPage() {
  const timezone = useSettingsStore((state) => state.timezone);
  const theme = useSettingsStore((state) => state.theme);
  const setTimezone = useSettingsStore((state) => state.setTimezone);
  const setTheme = useSettingsStore((state) => state.setTheme);

  const { runtime } = useVault();
  const bills = useBillStore((state) => state.bills) ?? [];

  const [exportBanner, setExportBanner] = useState<string | null>(null);
  const [storageDir, setStorageDir] = useState<string>(() => getStorageDirectory());
  const [pickedDirName, setPickedDirName] = useState<string | null>(() =>
    getWebDirectoryHandleName(),
  );
  const [storageDirSavedMsg, setStorageDirSavedMsg] = useState<string | null>(null);
  const [pickingDir, setPickingDir] = useState(false);

  useEffect(() => {
    if (!timezone) {
      setTimezone('Asia/Shanghai');
    }
  }, [timezone, setTimezone]);

  const formatEffectiveStoragePath = (dir: string): string => {
    const trimmed = (dir || 'LifeHub').trim();
    if (/^[A-Za-z]:\//.test(trimmed) || /^[A-Za-z]:\\/.test(trimmed)) {
      return trimmed;
    }
    return `Download/${trimmed}`;
  };

  const loadCategoriesSafely = async (): Promise<Category[]> => {
    try {
      const catRepo = (
        runtime as { categoryRepository?: { list?: () => Promise<Category[]> } } | null
      )?.categoryRepository;
      if (catRepo && typeof catRepo.list === 'function') {
        return await catRepo.list();
      }
    } catch {
      // 忽略分类仓库未就绪异常
    }
    return [];
  };

  const syncAllModulesToNewDir = async () => {
    try {
      const categories = await loadCategoriesSafely();
      const db = createDatabase();
      const diaryService = new DiaryService(db);
      const [scheduleSlots, habits, habitCheckIns, completionEvents, diaryEntries] =
        await Promise.all([
          db
            .table<StoredScheduleSlot>('scheduleSlots')
            .toArray()
            .catch(() => [] as StoredScheduleSlot[]),
          db
            .table<StoredHabit>('habits')
            .toArray()
            .catch(() => [] as StoredHabit[]),
          db
            .table<StoredHabitCheckIn>('habitCheckIns')
            .toArray()
            .catch(() => [] as StoredHabitCheckIn[]),
          db
            .table<CompletionEvent>('completionEvents')
            .toArray()
            .catch(() => [] as CompletionEvent[]),
          diaryService.exportAllDecrypted().catch(() => [] as DecryptedDiaryEntry[]),
        ]);

      const nowIso = new Date().toISOString();
      syncAutoSnapshotToStorageDir(
        JSON.stringify({ schema: 'lifehub-bills-v1', updatedAt: nowIso, bills }, null, 2),
        'lifehub-bills.json',
      );
      syncAutoSnapshotToStorageDir(
        JSON.stringify(
          { schema: 'lifehub-categories-v1', updatedAt: nowIso, categories },
          null,
          2,
        ),
        'lifehub-categories.json',
      );
      syncAutoSnapshotToStorageDir(
        JSON.stringify(
          { schema: 'lifehub-schedule-v1', updatedAt: nowIso, scheduleSlots, completionEvents },
          null,
          2,
        ),
        'lifehub-schedule.json',
      );
      syncAutoSnapshotToStorageDir(
        JSON.stringify(
          { schema: 'lifehub-habits-v1', updatedAt: nowIso, habits, habitCheckIns, completionEvents },
          null,
          2,
        ),
        'lifehub-habits.json',
      );
      syncAutoSnapshotToStorageDir(
        JSON.stringify({ schema: 'lifehub-treehole-v1', updatedAt: nowIso, diaryEntries }, null, 2),
        'lifehub-treehole.json',
      );
      syncAutoSnapshotToStorageDir(
        JSON.stringify(
          {
            schema: 'lifehub-auto-snapshot-v1',
            updatedAt: nowIso,
            bills,
            categories,
            scheduleSlots,
            habits,
            habitCheckIns,
            completionEvents,
            diaryEntries,
          },
          null,
          2,
        ),
        'lifehub-auto-snapshot.json',
      );
    } catch {
      // 忽略测试环境或未初始化异常
    }
  };

  const handleSaveStorageDir = () => {
    const normalized = setStorageDirectory(storageDir);
    setStorageDir(normalized);
    void syncAllModulesToNewDir();
    setStorageDirSavedMsg(`已保存默认文件存储目录：${formatEffectiveStoragePath(normalized)}`);
  };

  const handlePickWebDir = async () => {
    if (pickingDir) return;
    setPickingDir(true);
    try {
      const picked = await pickWebDirectoryHandle();
      if (picked) {
        setPickedDirName(picked);
        setStorageDir(picked);
        void syncAllModulesToNewDir();
        setStorageDirSavedMsg(`已选择并保存本地目录：${formatEffectiveStoragePath(picked)}`);
      }
    } finally {
      setPickingDir(false);
    }
  };

  const handleExportAllJson = async () => {
    let categories: Category[] = [];
    let scheduleSlots: StoredScheduleSlot[] = [];
    let habits: StoredHabit[] = [];
    let habitCheckIns: StoredHabitCheckIn[] = [];
    let completionEvents: CompletionEvent[] = [];
    let diaryEntries: DecryptedDiaryEntry[] = [];

    categories = await loadCategoriesSafely();

    try {
      const db = createDatabase();
      const diaryService = new DiaryService(db);
      const [slots, habitList, checkIns, events, diaries] = await Promise.all([
        db.table<StoredScheduleSlot>('scheduleSlots').toArray(),
        db.table<StoredHabit>('habits').toArray(),
        db.table<StoredHabitCheckIn>('habitCheckIns').toArray(),
        db.table<CompletionEvent>('completionEvents').toArray(),
        diaryService.exportAllDecrypted(),
      ]);
      scheduleSlots = slots;
      habits = habitList;
      habitCheckIns = checkIns;
      completionEvents = events;
      diaryEntries = diaries;
    } catch {
      // 测试环境或 IndexedDB 未初始化时降级为空数组
    }

    const catMap = new Map<string, Category>(categories.map((c) => [c.id, c]));
    const readableBills = bills.map((b) => ({
      ...b,
      amountYuan: Number((b.amountMinor / 100).toFixed(2)),
      categoryName: b.categoryId ? (catMap.get(b.categoryId)?.name ?? '未分类') : '未分类',
    }));

    const payload = {
      schema: 'lifehub-open-export-v1',
      exportedAt: new Date().toISOString(),
      timezone: 'Asia/Shanghai',
      currency: 'CNY',
      summary: {
        billCount: readableBills.length,
        categoryCount: categories.length,
        scheduleCount: scheduleSlots.length,
        habitCount: habits.length,
        habitCheckInCount: habitCheckIns.length,
        completionEventCount: completionEvents.length,
        diaryCount: diaryEntries.length,
      },
      bills: readableBills,
      categories,
      scheduleSlots,
      habits,
      habitCheckIns,
      completionEvents,
      diaryEntries,
    };

    const fileName = buildDatedFileName('lifehub-all-data', '.json');
    downloadText(fileName, JSON.stringify(payload, null, 2), 'application/json');
    const dirLabel = formatEffectiveStoragePath(getStorageDirectory());
    setExportBanner(
      `已导出全量数据 ${fileName}（保存至 ${dirLabel}）`,
    );
  };

  const handleExportBillsCsv = async () => {
    const categories = await loadCategoriesSafely();
    const catMap = new Map<string, Category>(categories.map((c) => [c.id, c]));
    const header = ['日期', '时间', '收支类型', '金额(元)', '交易对方', '分类', '备注', '来源文件'];
    const directionLabels: Record<string, string> = {
      expense: '支出',
      income: '收入',
      refund: '退款',
    };

    const rows = bills.map((b) => {
      const timeStr = b.occurredAt.length >= 19 ? b.occurredAt.slice(11, 19) : '';
      const dirLabel = directionLabels[b.direction] ?? b.direction;
      const amountYuan = (b.amountMinor / 100).toFixed(2);
      const catName = b.categoryId ? (catMap.get(b.categoryId)?.name ?? '未分类') : '未分类';
      return [
        escapeCsvCell(b.localDate),
        escapeCsvCell(timeStr),
        escapeCsvCell(dirLabel),
        escapeCsvCell(amountYuan),
        escapeCsvCell(b.counterparty),
        escapeCsvCell(catName),
        escapeCsvCell(b.note ?? ''),
        escapeCsvCell(b.sourceFileId ?? ''),
      ].join(',');
    });

    const csvContent = `\uFEFF${[header.join(','), ...rows].join('\r\n')}`;
    const fileName = buildDatedFileName('lifehub-bills', '.csv');
    downloadText(fileName, csvContent, 'text/csv');
    setExportBanner(`已导出通用账单表格 ${fileName}（共 ${bills.length} 笔）`);
  };

  return (
    <div data-testid="settings-page">
      <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: '-0.01em', mb: 2 }}>
        设置
      </Typography>

      {/* 移动端低频入口快捷双按钮（无多余卡片标题与嵌套框） */}
      <Box
        className="lifehub-mobile-only"
        data-testid="mobile-quick-hub-card"
        sx={{
          display: { xs: 'block', md: 'none' },
          mb: 2,
          width: '100%',
        }}
      >
        <Box
          data-testid="mobile-settings-quick-nav"
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 1,
          }}
        >
          <Button
            variant="outlined"
            data-testid="quick-nav-import"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.hash = '#/import';
              }
            }}
            sx={{
              py: 1.05,
              borderRadius: '10px',
              backgroundColor: 'var(--lifehub-surface)',
              borderColor: 'var(--lifehub-border)',
              color: 'var(--lifehub-text)',
              fontWeight: 600,
            }}
          >
            导入账单
          </Button>
          <Button
            variant="outlined"
            data-testid="quick-nav-habits"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.hash = '#/habits';
              }
            }}
            sx={{
              py: 1.05,
              borderRadius: '10px',
              backgroundColor: 'var(--lifehub-surface)',
              borderColor: 'var(--lifehub-border)',
              color: 'var(--lifehub-text)',
              fontWeight: 600,
            }}
          >
            习惯打卡
          </Button>
        </Box>
      </Box>

      {/* 1. 基础设置卡片（主题 + 存储路径） */}
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 2, sm: 2.5 },
          mb: 2,
          width: '100%',
          borderRadius: '12px',
          backgroundColor: 'var(--lifehub-surface)',
          borderColor: 'var(--lifehub-border)',
        }}
        data-testid="basic-settings-card"
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'stretch', sm: 'center' }}
          spacing={1.5}
        >
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              外观主题
            </Typography>
            <Typography
              variant="caption"
              data-testid="default-timezone-chip"
              sx={{ display: 'none' }}
            >
              默认时区：北京时间 (Asia/Shanghai)
            </Typography>
          </Box>

          <Select
            size="small"
            value={theme}
            onChange={(event) => setTheme(event.target.value as ThemeMode)}
            inputProps={{ 'aria-label': '外观主题' }}
            sx={{ minWidth: 150, borderRadius: '8px' }}
          >
            <MenuItem value="system">跟随系统</MenuItem>
            <MenuItem value="light">浅色模式</MenuItem>
            <MenuItem value="dark">深色模式</MenuItem>
          </Select>
        </Stack>

        <Divider sx={{ my: 2 }} />

        {/* 文件存储目录设置 */}
        <Box data-testid="storage-dir-setting">
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="baseline"
            spacing={1}
            sx={{ mb: 1 }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              存储目录
            </Typography>
            <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
              当前：<code>{formatEffectiveStoragePath(storageDir)}</code>
              {pickedDirName ? ` (${pickedDirName})` : ''}
            </Typography>
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField
              size="small"
              fullWidth
              value={storageDir}
              onChange={(e) => setStorageDir(e.target.value)}
              placeholder="如 LifeHub"
              inputProps={{
                'aria-label': '文件存储目录',
                'data-testid': 'storage-dir-input',
              }}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
            />
            <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
              <Button
                size="small"
                variant="contained"
                disableElevation
                onClick={handleSaveStorageDir}
                data-testid="save-storage-dir-button"
                sx={{ borderRadius: '8px', px: 2, flex: { xs: 1, sm: 'none' } }}
              >
                保存
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<FolderOpenOutlined sx={{ fontSize: 17 }} />}
                disabled={pickingDir}
                onClick={() => void handlePickWebDir()}
                data-testid="pick-storage-dir-button"
                sx={{ borderRadius: '8px', px: 1.75, flex: { xs: 1, sm: 'none' } }}
              >
                {pickingDir ? '选择中…' : '选择目录'}
              </Button>
            </Stack>
          </Stack>

          {storageDirSavedMsg && (
            <Alert
              severity="success"
              sx={{ mt: 1.5 }}
              onClose={() => setStorageDirSavedMsg(null)}
              data-testid="storage-dir-saved-alert"
            >
              {storageDirSavedMsg}
            </Alert>
          )}
        </Box>
      </Paper>

      {/* 2. 本地数据导出卡片 */}
      <Paper
        variant="outlined"
        data-testid="data-export-card"
        sx={{
          p: { xs: 2, sm: 2.5 },
          mb: 2,
          width: '100%',
          borderRadius: '12px',
          backgroundColor: 'var(--lifehub-surface)',
          borderColor: 'var(--lifehub-border)',
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'stretch', sm: 'center' }}
          spacing={1.5}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            数据导出
          </Typography>

          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="contained"
              disableElevation
              startIcon={<FileDownloadOutlined sx={{ fontSize: 17 }} />}
              onClick={() => void handleExportAllJson()}
              data-testid="export-all-json-button"
              sx={{ borderRadius: '8px', px: 1.75, flex: { xs: 1, sm: 'none' } }}
            >
              全量 JSON
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<TableViewOutlined sx={{ fontSize: 17 }} />}
              onClick={() => void handleExportBillsCsv()}
              data-testid="export-bills-csv-button"
              sx={{ borderRadius: '8px', px: 1.75, flex: { xs: 1, sm: 'none' } }}
            >
              账单 CSV
            </Button>
          </Stack>
        </Stack>

        {exportBanner && (
          <Alert
            severity="success"
            sx={{ mt: 1.5 }}
            onClose={() => setExportBanner(null)}
            data-testid="data-export-banner"
          >
            {exportBanner}
          </Alert>
        )}
      </Paper>

      {/* 3. 云端同步卡片（默认精简折叠） */}
      <CloudStoragePanel />
    </div>
  );
}
