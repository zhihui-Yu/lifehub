/**
 * 树洞日记页面（模块 D：D-01 ~ D-05）。
 *
 * 架构位置：apps/web 的「页面组件」层，路由 `/treehole`。
 *
 * 功能覆盖：
 * - D-01：随手记时间线卡片（正文必填、可选标题、心情图标、标签、置顶），底层经 WebCrypto AES-GCM-256 全字段加密落盘；
 * - D-02：纯本地私密空间，无公开社区或外部分享入口，自动纳入设置页「远程云存储加密同步」与「导出全部数据 (JSON)」；
 * - D-05：支持在解密后的内存数据上按关键词、心情与标签实时检索过滤。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import LockOutlined from '@mui/icons-material/LockOutlined';
import PushPinOutlined from '@mui/icons-material/PushPinOutlined';
import {
  DIARY_MOOD_OPTIONS,
  DiaryService,
  type DecryptedDiaryEntry,
} from '@/modules/diary/diary-service';
import { syncAutoSnapshotToStorageDir } from '@/utils/download';

/**
 * 将逗号、空格或顿号分隔的标签字符串拆分为数组。
 *
 * @param raw 原始输入字符串
 * @returns 标签字符串数组
 */
function parseTagsInput(raw: string): string[] {
  return raw
    .split(/[,，、\s]+/)
    .map((s) => s.trim().replace(/^#+/, '').trim())
    .filter((s) => s.length > 0);
}

/**
 * 渲染私密树洞日记页面。
 *
 * @returns React 节点
 * @throws 无
 */
export function TreeHolePage() {
  const service = useMemo(() => new DiaryService(), []);

  // 顶部随手记发布区状态
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [selectedMood, setSelectedMood] = useState<string | null>('🌿 平静');
  const [tagsText, setTagsText] = useState('');

  // 检索与筛选状态
  const [searchKeyword, setSearchKeyword] = useState('');
  const [moodFilter, setMoodFilter] = useState<string>('');

  // 列表与反馈状态
  const [entries, setEntries] = useState<DecryptedDiaryEntry[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  // 编辑弹窗状态
  const [editingEntry, setEditingEntry] = useState<DecryptedDiaryEntry | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editMood, setEditMood] = useState<string | null>(null);
  const [editTagsText, setEditTagsText] = useState('');

  const reloadEntries = useCallback(async () => {
    try {
      const list = await service.listEntries({
        keyword: searchKeyword,
        mood: moodFilter || undefined,
      });
      setEntries(list);
      setErrorMsg(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '加载树洞记录失败');
    }
  }, [moodFilter, searchKeyword, service]);

  useEffect(() => {
    void reloadEntries();
  }, [reloadEntries]);

  const handleCreateEntry = async () => {
    try {
      setErrorMsg(null);
      setBannerMsg(null);
      await service.createEntry({
        title,
        body,
        mood: selectedMood,
        tags: parseTagsInput(tagsText),
      });
      setTitle('');
      setBody('');
      setTagsText('');
      setBannerMsg('已加密投递至本地树洞（AES-GCM-256 保护）');
      await reloadEntries();
      const allDiaries = await service.exportAllDecrypted();
      syncAutoSnapshotToStorageDir(
        JSON.stringify(
          {
            schema: 'lifehub-auto-snapshot-v1',
            updatedAt: new Date().toISOString(),
            diaryCount: allDiaries.length,
            diaryEntries: allDiaries,
          },
          null,
          2,
        ),
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '投递树洞失败');
    }
  };

  const handleTogglePin = async (id: string) => {
    try {
      await service.togglePin(id);
      await reloadEntries();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '切换置顶失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await service.deleteEntry(id);
      await reloadEntries();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleOpenEdit = (entry: DecryptedDiaryEntry) => {
    setEditingEntry(entry);
    setEditTitle(entry.title);
    setEditBody(entry.body);
    setEditMood(entry.mood);
    setEditTagsText(entry.tags.join(' '));
  };

  const handleSaveEdit = async () => {
    if (!editingEntry) return;
    try {
      await service.updateEntry(editingEntry.id, {
        title: editTitle,
        body: editBody,
        mood: editMood,
        tags: parseTagsInput(editTagsText),
      });
      setEditingEntry(null);
      await reloadEntries();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '更新树洞记录失败');
    }
  };

  return (
    <Box data-testid="treehole-page" sx={{ width: '100%' }}>
      {/* 顶部标题与隐私声明 */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={1}
        sx={{ mb: 2.5 }}
      >
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700, color: 'var(--lifehub-text)' }}>
            🌲 私密树洞
          </Typography>
          <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)' }}>
            随时记录心事、灵感与未来规划 · 全字段本地加密，同步与导出自动受保护
          </Typography>
        </Box>
        <Chip
          icon={<LockOutlined fontSize="small" />}
          label="AES-GCM 全字段加密 · 零公开分享"
          color="primary"
          variant="outlined"
          size="small"
          data-testid="treehole-encryption-badge"
        />
      </Stack>

      {errorMsg && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorMsg(null)}>
          {errorMsg}
        </Alert>
      )}

      {bannerMsg && (
        <Alert
          severity="success"
          sx={{ mb: 2 }}
          data-testid="treehole-success-banner"
          onClose={() => setBannerMsg(null)}
        >
          {bannerMsg}
        </Alert>
      )}

      {/* 随手记投递卡片 */}
      <Paper
        variant="outlined"
        data-testid="treehole-composer-card"
        sx={{
          p: { xs: 2, sm: 2.5 },
          mb: 3,
          borderRadius: 3,
          backgroundColor: 'var(--lifehub-surface)',
          borderColor: 'var(--lifehub-border)',
        }}
      >
        <Stack spacing={1.5}>
          <TextField
            placeholder="写下此刻的想法、心事、人物观察或未来规划…（必填）"
            multiline
            minRows={3}
            fullWidth
            size="small"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            inputProps={{ 'data-testid': 'treehole-body-input' }}
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              label="标题（可选）"
              size="small"
              fullWidth
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              inputProps={{ 'data-testid': 'treehole-title-input' }}
            />
            <TextField
              label="标签（可选，空格或逗号分隔，如：规划 随想）"
              size="small"
              fullWidth
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              inputProps={{ 'data-testid': 'treehole-tags-input' }}
            />
          </Stack>

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'stretch', sm: 'center' }}
            spacing={1.5}
          >
            <Stack
              direction="row"
              spacing={0.75}
              flexWrap="wrap"
              useFlexGap
              alignItems="center"
              data-testid="treehole-mood-selector"
            >
              <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)', mr: 0.5 }}>
                心情：
              </Typography>
              {DIARY_MOOD_OPTIONS.map((mood) => {
                const active = selectedMood === mood;
                return (
                  <Chip
                    key={mood}
                    label={mood}
                    size="small"
                    color={active ? 'primary' : 'default'}
                    variant={active ? 'filled' : 'outlined'}
                    onClick={() => setSelectedMood(active ? null : mood)}
                    sx={{ cursor: 'pointer' }}
                  />
                );
              })}
            </Stack>

            <Button
              variant="contained"
              onClick={() => void handleCreateEntry()}
              data-testid="treehole-submit-button"
              sx={{ alignSelf: { xs: 'stretch', sm: 'auto' }, px: 3 }}
            >
              投递到树洞
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {/* 关键词与心情筛选栏 */}
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 1.5, sm: 2 },
          mb: 2.5,
          borderRadius: 3,
          backgroundColor: 'var(--lifehub-surface)',
          borderColor: 'var(--lifehub-border)',
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          alignItems={{ xs: 'stretch', sm: 'center' }}
          justifyContent="space-between"
        >
          <TextField
            size="small"
            placeholder="搜索树洞正文、标题或标签…"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            sx={{ minWidth: { sm: 260 } }}
            inputProps={{ 'data-testid': 'treehole-search-input' }}
          />
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
            <Chip
              label="全部"
              size="small"
              color={moodFilter === '' ? 'primary' : 'default'}
              variant={moodFilter === '' ? 'filled' : 'outlined'}
              onClick={() => setMoodFilter('')}
              data-testid="treehole-filter-all"
            />
            {DIARY_MOOD_OPTIONS.map((mood) => (
              <Chip
                key={mood}
                label={mood}
                size="small"
                color={moodFilter === mood ? 'primary' : 'default'}
                variant={moodFilter === mood ? 'filled' : 'outlined'}
                onClick={() => setMoodFilter(moodFilter === mood ? '' : mood)}
              />
            ))}
          </Stack>
        </Stack>
      </Paper>

      {/* 树洞时间线列表 */}
      <Stack spacing={1.5} data-testid="treehole-list">
        {entries.length === 0 ? (
          <Paper
            variant="outlined"
            data-testid="treehole-empty-state"
            sx={{
              p: 4,
              borderRadius: 3,
              textAlign: 'center',
              backgroundColor: 'var(--lifehub-surface)',
              borderColor: 'var(--lifehub-border)',
            }}
          >
            <Typography variant="body1" sx={{ fontWeight: 600, mb: 0.5 }}>
              树洞里还没有记录
            </Typography>
            <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)' }}>
              在上方输入框写下第一条随手记，所有内容均在本地加密保存。
            </Typography>
          </Paper>
        ) : (
          entries.map((entry) => (
            <Paper
              key={entry.id}
              variant="outlined"
              data-testid="treehole-entry-card"
              sx={{
                p: { xs: 2, sm: 2.25 },
                borderRadius: 3,
                backgroundColor: 'var(--lifehub-surface)',
                borderColor: entry.isPinned ? 'primary.main' : 'var(--lifehub-border)',
                borderWidth: entry.isPinned ? 1.5 : 1,
              }}
            >
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                spacing={1}
                sx={{ mb: 1 }}
              >
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  {entry.isPinned && (
                    <Chip
                      icon={<PushPinOutlined sx={{ fontSize: 14 }} />}
                      label="置顶"
                      size="small"
                      color="primary"
                      data-testid="treehole-pinned-chip"
                    />
                  )}
                  <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)', fontWeight: 600 }}>
                    {entry.localDate}
                  </Typography>
                  {entry.mood && <Chip label={entry.mood} size="small" variant="outlined" />}
                </Stack>

                <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                  <Button
                    size="small"
                    variant="text"
                    data-testid="treehole-pin-button"
                    onClick={() => void handleTogglePin(entry.id)}
                  >
                    {entry.isPinned ? '取消置顶' : '置顶'}
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    data-testid="treehole-edit-button"
                    onClick={() => handleOpenEdit(entry)}
                  >
                    编辑
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    color="error"
                    data-testid="treehole-delete-button"
                    onClick={() => void handleDelete(entry.id)}
                  >
                    删除
                  </Button>
                </Stack>
              </Stack>

              {entry.title && (
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
                  {entry.title}
                </Typography>
              )}

              <Typography
                variant="body2"
                sx={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: 'var(--lifehub-text)',
                  lineHeight: 1.65,
                }}
              >
                {entry.body}
              </Typography>

              {entry.tags.length > 0 && (
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1.25 }}>
                  {entry.tags.map((tag) => (
                    <Chip key={tag} label={`#${tag}`} size="small" variant="outlined" />
                  ))}
                </Stack>
              )}
            </Paper>
          ))
        )}
      </Stack>

      {/* 编辑树洞弹窗 */}
      <Dialog
        open={Boolean(editingEntry)}
        onClose={() => setEditingEntry(null)}
        fullWidth
        maxWidth="sm"
        data-testid="treehole-edit-dialog"
      >
        <DialogTitle>编辑树洞记录</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField
              label="标题（可选）"
              size="small"
              fullWidth
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              inputProps={{ 'data-testid': 'treehole-edit-title-input' }}
            />
            <TextField
              label="正文内容"
              multiline
              minRows={4}
              size="small"
              fullWidth
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              inputProps={{ 'data-testid': 'treehole-edit-body-input' }}
            />
            <TextField
              label="标签（空格或逗号分隔）"
              size="small"
              fullWidth
              value={editTagsText}
              onChange={(e) => setEditTagsText(e.target.value)}
              inputProps={{ 'data-testid': 'treehole-edit-tags-input' }}
            />
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
              <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
                心情：
              </Typography>
              {DIARY_MOOD_OPTIONS.map((mood) => (
                <Chip
                  key={mood}
                  label={mood}
                  size="small"
                  color={editMood === mood ? 'primary' : 'default'}
                  variant={editMood === mood ? 'filled' : 'outlined'}
                  onClick={() => setEditMood(editMood === mood ? null : mood)}
                />
              ))}
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingEntry(null)}>取消</Button>
          <Button
            variant="contained"
            onClick={() => void handleSaveEdit()}
            data-testid="treehole-edit-save-button"
          >
            保存修改
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
