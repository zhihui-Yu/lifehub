/**
 * 设置页面（P2 占位）。
 *
 * 架构位置：apps/web 的「页面」层。
 *
 * 说明：时区固定默认为北京时间（Asia/Shanghai），币种固定为人民币（CNY），周起始日固定为周一；
 * 提供快捷功能中心、全量数据开放导出（JSON / CSV 方便迁移至其他应用）、远程云存储连接与外观主题设置。
 */
import { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, MenuItem, Paper, Select, Stack, TextField, Typography } from '@mui/material';
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined';
import DownloadOutlined from '@mui/icons-material/DownloadOutlined';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import FolderOpenOutlined from '@mui/icons-material/FolderOpenOutlined';
import PublicOutlined from '@mui/icons-material/PublicOutlined';
import TableViewOutlined from '@mui/icons-material/TableViewOutlined';
import TuneOutlined from '@mui/icons-material/TuneOutlined';
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
} from '@/utils/download';

/**
 * 将单个 CSV 单元格转义为 RFC 4180 安全格式。
 *
 * @param val 原始单元格字符串
 * @returns 转义后的 CSV 字段
 */
function escapeCsvCell(val: string | number | null | undefined): string {
  const text = String(val ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * 渲染设置页面。
 *
 * 说明：展示快捷功能中心、全量数据开放导出卡片、远程云存储连接与备份面板，以及外观主题基础设置。
 *
 * @param _props 页面无外部入参
 * @returns React 节点
 * @throws 无；纯展示与本地配置组件不抛出异常
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
  const [pickedDirName, setPickedDirName] = useState<string | null>(() => getWebDirectoryHandleName());
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

  const handleSaveStorageDir = () => {
    const normalized = setStorageDirectory(storageDir);
    setStorageDir(normalized);
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
        setStorageDirSavedMsg(`已选择并保存本地目录：${formatEffectiveStoragePath(picked)}`);
      }
    } finally {
      setPickingDir(false);
    }
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
      `已导出全量数据 ${fileName}（含 ${readableBills.length} 笔账单、${scheduleSlots.length} 个课表时段、${habits.length} 个习惯、${diaryEntries.length} 条树洞），已保存至「${dirLabel}」目录。`,
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
    setExportBanner(
      `已导出通用账单表格 ${fileName}（共 ${bills.length} 笔账单），可直接用 Excel 或其他记账软件导入，手机端已保存至「下载 (Download)」目录。`,
    );
  };

  return (
    <div data-testid="settings-page">
      {/* 移动端快捷功能中心（ML-05：聚合低频页面入口，仅移动端显示，Web/桌面端左侧已有导航栏故隐藏） */}
      <Paper
        variant="outlined"
        className="lifehub-mobile-only"
        data-testid="mobile-quick-hub-card"
        sx={{
          display: { xs: 'block', md: 'none' },
          p: { xs: 2, sm: 2.5 },
          mb: 3,
          width: '100%',
          borderRadius: 3,
          backgroundColor: 'var(--lifehub-surface)',
          borderColor: 'var(--lifehub-border)',
        }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5, color: 'var(--lifehub-text)' }}>
          快捷功能中心
        </Typography>
        <Box
          data-testid="mobile-settings-quick-nav"
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))' },
            gap: 1.25,
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
            sx={{ py: 1.25, borderRadius: 2.5, justifyContent: 'flex-start' }}
          >
            📂 导入账单文件
          </Button>
          <Button
            variant="outlined"
            data-testid="quick-nav-categories"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.hash = '#/categories';
              }
            }}
            sx={{ py: 1.25, borderRadius: 2.5, justifyContent: 'flex-start' }}
          >
            🏷️ 分类管理
          </Button>
          <Button
            variant="outlined"
            data-testid="quick-nav-habits"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.hash = '#/habits';
              }
            }}
            sx={{ py: 1.25, borderRadius: 2.5, justifyContent: 'flex-start' }}
          >
            🔥 习惯打卡
          </Button>
        </Box>
      </Paper>

      {/* 全量数据导出与迁移模块：无锁开放格式，方便用户备份或更换其他 App */}
      <Paper
        variant="outlined"
        data-testid="data-export-card"
        sx={{
          p: { xs: 2, sm: 3 },
          mb: 3,
          width: '100%',
          borderRadius: 3,
          backgroundColor: 'var(--lifehub-surface)',
          borderColor: 'var(--lifehub-border)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 1 }}>
          <Typography
            variant="h6"
            sx={{ color: 'var(--lifehub-text)', display: 'flex', alignItems: 'center', gap: 1 }}
          >
            <DownloadOutlined fontSize="small" color="primary" />
            导出所有数据（随时迁移）
          </Typography>
          <Chip size="small" color="success" variant="outlined" label="开放明文格式 · 无绑定" />
        </Box>
        <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)', mb: 2 }}>
          支持一键导出全部数据（账单、分类、生活课表、习惯打卡记录）为通用文件，直接保存在手机「下载 (Download)」目录，方便随时迁移到其他软件或用表格查看。
        </Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <Button
            variant="contained"
            startIcon={<FileDownloadOutlined />}
            onClick={() => void handleExportAllJson()}
            data-testid="export-all-json-button"
            sx={{ flex: 1, py: 1.1 }}
          >
            导出全部数据 (JSON)
          </Button>
          <Button
            variant="outlined"
            startIcon={<TableViewOutlined />}
            onClick={() => void handleExportBillsCsv()}
            data-testid="export-bills-csv-button"
            sx={{ flex: 1, py: 1.1 }}
          >
            导出账单表格 (CSV / Excel)
          </Button>
        </Stack>

        {exportBanner && (
          <Alert
            severity="success"
            sx={{ mt: 2 }}
            onClose={() => setExportBanner(null)}
            data-testid="data-export-banner"
          >
            {exportBanner}
          </Alert>
        )}
      </Paper>

      <CloudStoragePanel />
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 2, sm: 3 },
          width: '100%',
          borderRadius: 3,
          backgroundColor: 'var(--lifehub-surface)',
          borderColor: 'var(--lifehub-border)',
        }}
        data-testid="basic-settings-card"
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 2 }}>
          <Typography
            variant="h6"
            sx={{ color: 'var(--lifehub-text)', display: 'flex', alignItems: 'center', gap: 1 }}
          >
            <TuneOutlined fontSize="small" color="primary" />
            基础设置
          </Typography>
          <Chip
            size="small"
            icon={<PublicOutlined sx={{ fontSize: 15 }} />}
            label="默认时区：北京时间 (Asia/Shanghai)"
            variant="outlined"
            data-testid="default-timezone-chip"
          />
        </Box>
        <Box>
          <Typography
            variant="caption"
            component="div"
            sx={{ mb: 0.75, color: 'var(--lifehub-text-muted)', display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
            <DarkModeOutlined sx={{ fontSize: 15 }} />
            外观主题
          </Typography>
          <Select
            fullWidth
            size="small"
            value={theme}
            onChange={(event) => setTheme(event.target.value as ThemeMode)}
            inputProps={{ 'aria-label': '外观主题' }}
          >
            <MenuItem value="system">跟随系统</MenuItem>
            <MenuItem value="light">浅色模式</MenuItem>
            <MenuItem value="dark">深色模式</MenuItem>
          </Select>
        </Box>

        {/* 文件存储目录设置 */}
        <Box sx={{ mt: 2.5 }} data-testid="storage-dir-setting">
          <Typography
            variant="caption"
            component="div"
            sx={{ mb: 0.75, color: 'var(--lifehub-text-muted)', display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
            <FolderOpenOutlined sx={{ fontSize: 15 }} />
            文件存储目录（手机端保存在系统「下载 / Download」下的子目录，桌面端支持直接选择本地文件夹）
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField
              size="small"
              fullWidth
              value={storageDir}
              onChange={(e) => setStorageDir(e.target.value)}
              placeholder="例如：LifeHub 或 LifeHub/Backup"
              inputProps={{
                'aria-label': '文件存储目录',
                'data-testid': 'storage-dir-input',
              }}
            />
            <Button
              variant="contained"
              onClick={handleSaveStorageDir}
              data-testid="save-storage-dir-button"
              sx={{ whiteSpace: 'nowrap' }}
            >
              保存目录
            </Button>
            <Button
              variant="outlined"
              startIcon={<FolderOpenOutlined />}
              disabled={pickingDir}
              onClick={() => void handlePickWebDir()}
              data-testid="pick-storage-dir-button"
              sx={{ whiteSpace: 'nowrap' }}
            >
              {pickingDir ? '正在打开目录选择…' : '选择本地文件夹'}
            </Button>
          </Stack>
          <Typography variant="caption" sx={{ display: 'block', mt: 0.75, color: 'var(--lifehub-text-muted)' }}>
            当前生效路径：<code>{formatEffectiveStoragePath(storageDir)}</code>
            {pickedDirName ? `（已选择目录：${pickedDirName}）` : ''}
          </Typography>
          {storageDirSavedMsg && (
            <Alert
              severity="success"
              sx={{ mt: 1 }}
              onClose={() => setStorageDirSavedMsg(null)}
              data-testid="storage-dir-saved-alert"
            >
              {storageDirSavedMsg}
            </Alert>
          )}
        </Box>
      </Paper>
    </div>
  );
}
