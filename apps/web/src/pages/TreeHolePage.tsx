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
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import EditOutlined from '@mui/icons-material/EditOutlined';
import LocalOfferOutlined from '@mui/icons-material/LocalOfferOutlined';
import PushPin from '@mui/icons-material/PushPin';
import PushPinOutlined from '@mui/icons-material/PushPinOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
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
  const [metaExpanded, setMetaExpanded] = useState(false);

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
      setMetaExpanded(false);
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
      {/* 极简标题行 */}
      <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: '-0.01em', mb: 2 }}>
        树洞
      </Typography>

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

      {/* 无内框一体式随手记输入舱 */}
      <Paper
        variant="outlined"
        data-testid="treehole-composer-card"
        sx={{
          p: { xs: 1.75, sm: 2.25 },
          mb: 2.5,
          borderRadius: '12px',
          backgroundColor: 'var(--lifehub-surface)',
          borderColor: 'var(--lifehub-border)',
        }}
      >
        <TextField
          placeholder="记录此刻的想法、灵感或心事…"
          multiline
          minRows={3}
          maxRows={8}
          fullWidth
          variant="standard"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          InputProps={{ disableUnderline: true }}
          inputProps={{ 'data-testid': 'treehole-body-input' }}
          sx={{
            '& .MuiInputBase-input': {
              fontSize: 14.5,
              lineHeight: 1.65,
              p: 0,
            },
          }}
        />

        {/* 可选标题与标签（默认折叠，点击展开） */}
        <Collapse in={metaExpanded}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.25}
            sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid var(--lifehub-border)' }}
          >
            <TextField
              placeholder="标题（选填）"
              size="small"
              fullWidth
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              inputProps={{ 'data-testid': 'treehole-title-input' }}
            />
            <TextField
              placeholder="标签（空格或逗号分隔，如：随想 规划）"
              size="small"
              fullWidth
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              inputProps={{ 'data-testid': 'treehole-tags-input' }}
            />
          </Stack>
        </Collapse>

        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
          spacing={1}
          sx={{ mt: 1.5, pt: 1.25, borderTop: '1px solid var(--lifehub-border)' }}
        >
          <Stack
            direction="row"
            spacing={0.5}
            flexWrap="wrap"
            useFlexGap
            alignItems="center"
            data-testid="treehole-mood-selector"
          >
            {DIARY_MOOD_OPTIONS.map((mood) => {
              const active = selectedMood === mood;
              return (
                <Chip
                  key={mood}
                  label={mood}
                  size="small"
                  onClick={() => setSelectedMood(active ? null : mood)}
                  sx={{
                    height: 26,
                    fontSize: 12,
                    border: 0,
                    cursor: 'pointer',
                    fontWeight: active ? 600 : 400,
                    backgroundColor: active
                      ? 'var(--lifehub-primary-soft)'
                      : 'var(--lifehub-surface-hover)',
                    color: active ? 'primary.main' : 'var(--lifehub-text-muted)',
                  }}
                />
              );
            })}

            <Button
              size="small"
              variant="text"
              startIcon={<LocalOfferOutlined sx={{ fontSize: 14 }} />}
              onClick={() => setMetaExpanded((prev) => !prev)}
              sx={{
                height: 26,
                px: 1,
                borderRadius: '6px',
                fontSize: 12,
                color: metaExpanded || title || tagsText ? 'primary.main' : 'var(--lifehub-text-muted)',
              }}
            >
              {metaExpanded ? '收起标题/标签' : '标题/标签'}
            </Button>
          </Stack>

          <Button
            size="small"
            variant="contained"
            disableElevation
            disabled={!body.trim()}
            onClick={() => void handleCreateEntry()}
            data-testid="treehole-submit-button"
            sx={{ height: 32, px: 2, borderRadius: '8px', fontWeight: 600, ml: 'auto' }}
          >
            投递
          </Button>
        </Stack>
      </Paper>

      {/* 轻量无边框检索与心情过滤行 */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.25}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <TextField
          size="small"
          placeholder="搜索内容或标签…"
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchOutlined sx={{ fontSize: 17, color: 'var(--lifehub-text-muted)' }} />
              </InputAdornment>
            ),
          }}
          sx={{
            minWidth: { sm: 220 },
            '& .MuiOutlinedInput-root': {
              borderRadius: '8px',
              backgroundColor: 'var(--lifehub-surface)',
              height: 34,
              fontSize: 13,
            },
          }}
          inputProps={{ 'data-testid': 'treehole-search-input' }}
        />

        <Stack
          direction="row"
          spacing={0.5}
          sx={{
            overflowX: 'auto',
            pb: { xs: 0.25, sm: 0 },
            scrollbarWidth: 'none',
            '&::-webkit-scrollbar': { display: 'none' },
          }}
        >
          <Chip
            label="全部"
            size="small"
            onClick={() => setMoodFilter('')}
            data-testid="treehole-filter-all"
            sx={{
              height: 28,
              fontSize: 12,
              flexShrink: 0,
              fontWeight: moodFilter === '' ? 600 : 400,
              backgroundColor:
                moodFilter === '' ? 'var(--lifehub-primary-soft)' : 'transparent',
              color: moodFilter === '' ? 'primary.main' : 'var(--lifehub-text-muted)',
            }}
          />
          {DIARY_MOOD_OPTIONS.map((mood) => {
            const active = moodFilter === mood;
            return (
              <Chip
                key={mood}
                label={mood}
                size="small"
                onClick={() => setMoodFilter(active ? '' : mood)}
                sx={{
                  height: 28,
                  fontSize: 12,
                  flexShrink: 0,
                  fontWeight: active ? 600 : 400,
                  backgroundColor: active ? 'var(--lifehub-primary-soft)' : 'transparent',
                  color: active ? 'primary.main' : 'var(--lifehub-text-muted)',
                }}
              />
            );
          })}
        </Stack>
      </Stack>

      {/* 树洞时间线列表 */}
      <Stack spacing={1.25} data-testid="treehole-list">
        {entries.length === 0 ? (
          <Paper
            variant="outlined"
            data-testid="treehole-empty-state"
            sx={{
              py: 6,
              px: 3,
              borderRadius: '12px',
              textAlign: 'center',
              backgroundColor: 'var(--lifehub-surface)',
              borderColor: 'var(--lifehub-border)',
            }}
          >
            <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)' }}>
              暂无记录
            </Typography>
          </Paper>
        ) : (
          entries.map((entry) => (
            <Paper
              key={entry.id}
              variant="outlined"
              data-testid="treehole-entry-card"
              sx={{
                px: { xs: 2, sm: 2.5 },
                py: { xs: 1.75, sm: 2 },
                borderRadius: '12px',
                backgroundColor: 'var(--lifehub-surface)',
                borderColor: entry.isPinned ? 'primary.main' : 'var(--lifehub-border)',
              }}
            >
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                spacing={1}
                sx={{ mb: 0.75 }}
              >
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  {entry.isPinned && (
                    <Typography
                      variant="caption"
                      data-testid="treehole-pinned-chip"
                      sx={{
                        color: 'primary.main',
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.25,
                      }}
                    >
                      <PushPin sx={{ fontSize: 13 }} />
                      置顶
                    </Typography>
                  )}
                  <Typography
                    variant="caption"
                    sx={{
                      color: 'var(--lifehub-text-muted)',
                      fontWeight: 600,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {entry.localDate}
                  </Typography>
                  {entry.mood && (
                    <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
                      {entry.mood}
                    </Typography>
                  )}
                </Stack>

                {/* 精简图标操作代替 3 个文字按钮 */}
                <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0, mr: -0.5 }}>
                  <Tooltip title={entry.isPinned ? '取消置顶' : '置顶'}>
                    <IconButton
                      size="small"
                      data-testid="treehole-pin-button"
                      aria-label={entry.isPinned ? '取消置顶' : '置顶'}
                      onClick={() => void handleTogglePin(entry.id)}
                      sx={{
                        p: 0.5,
                        color: entry.isPinned ? 'primary.main' : 'var(--lifehub-text-muted)',
                      }}
                    >
                      {entry.isPinned ? (
                        <PushPin sx={{ fontSize: 16 }} />
                      ) : (
                        <PushPinOutlined sx={{ fontSize: 16 }} />
                      )}
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="编辑">
                    <IconButton
                      size="small"
                      data-testid="treehole-edit-button"
                      aria-label="编辑"
                      onClick={() => handleOpenEdit(entry)}
                      sx={{ p: 0.5, color: 'var(--lifehub-text-muted)' }}
                    >
                      <EditOutlined sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="删除">
                    <IconButton
                      size="small"
                      color="error"
                      data-testid="treehole-delete-button"
                      aria-label="删除"
                      onClick={() => void handleDelete(entry.id)}
                      sx={{ p: 0.5, opacity: 0.75 }}
                    >
                      <DeleteOutline sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Stack>

              {entry.title && (
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5, fontSize: 15 }}>
                  {entry.title}
                </Typography>
              )}

              <Typography
                variant="body2"
                sx={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: 'var(--lifehub-text)',
                  lineHeight: 1.7,
                  fontSize: 14,
                }}
              >
                {entry.body}
              </Typography>

              {entry.tags.length > 0 && (
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1.25 }}>
                  {entry.tags.map((tag) => (
                    <Typography
                      key={tag}
                      variant="caption"
                      sx={{
                        px: 0.85,
                        py: 0.2,
                        borderRadius: '6px',
                        backgroundColor: 'var(--lifehub-surface-hover)',
                        color: 'var(--lifehub-text-muted)',
                        fontSize: 11.5,
                      }}
                    >
                      #{tag}
                    </Typography>
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
        <DialogTitle sx={{ fontWeight: 700 }}>编辑记录</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField
              label="标题（选填）"
              size="small"
              fullWidth
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              inputProps={{ 'data-testid': 'treehole-edit-title-input' }}
            />
            <TextField
              label="正文"
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
        <DialogActions sx={{ px: 2.5, py: 1.5 }}>
          <Button onClick={() => setEditingEntry(null)}>取消</Button>
          <Button
            variant="contained"
            disableElevation
            onClick={() => void handleSaveEdit()}
            data-testid="treehole-edit-save-button"
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
