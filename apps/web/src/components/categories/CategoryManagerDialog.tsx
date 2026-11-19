/**
 * 分类管理面板与弹窗组件（内嵌于账单列表页与记账弹窗，兼顾桌面端与移动端 APK 窄屏）。
 *
 * 架构位置：apps/web 的「分类组件」层。
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddOutlined from '@mui/icons-material/AddOutlined';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import EditOutlined from '@mui/icons-material/EditOutlined';
import type { Category, CategoryKind } from '@lifehub/core';
import { CATEGORY_ICON_OPTIONS, CategoryIcon } from '@/components/common/VisualIcons';
import { useVault } from '@/hooks/useVault';
import { useCategories, type UseCategoriesResult } from '@/hooks/useCategories';
import type { CategoryInput } from '@/lib/category-factory';

/** 方向中文标签。 */
const KIND_LABEL: Record<CategoryKind, string> = {
  income: '收入',
  expense: '支出',
  both: '收支',
};

/** 方向选项。 */
const KIND_OPTIONS: { value: CategoryKind; label: string }[] = [
  { value: 'expense', label: '支出' },
  { value: 'income', label: '收入' },
  { value: 'both', label: '收支通用' },
];

/** 分类编辑对话框的属性。 */
interface CategoryEditDialogProps {
  /** 是否打开。 */
  open: boolean;
  /** 被编辑的分类；null 表示新增。 */
  initial: Category | null;
  /** 关闭回调。 */
  onClose: () => void;
  /** 提交回调。 */
  onSubmit: (input: CategoryInput) => Promise<boolean>;
}

/**
 * 分类编辑子对话框（新增 / 编辑共用）。
 */
function CategoryEditDialog({ open, initial, onClose, onSubmit }: CategoryEditDialogProps) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [color, setColor] = useState('#2563EB');
  const [icon, setIcon] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (initial) {
      setName(initial.name);
      setKind(initial.kind);
      setColor(initial.color);
      setIcon(initial.icon === 'more' ? '' : initial.icon);
    } else {
      setName('');
      setKind('expense');
      setColor('#2563EB');
      setIcon('');
    }
    setBusy(false);
    setLocalError(null);
  }, [open, initial]);

  const handleSubmit = async (): Promise<void> => {
    setBusy(true);
    setLocalError(null);
    try {
      const input: CategoryInput = { name, kind, color, icon };
      const ok = await onSubmit(input);
      if (ok) {
        onClose();
      }
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : '保存失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth aria-labelledby="category-edit-title">
      <DialogTitle id="category-edit-title">{initial ? '编辑分类' : '新增分类'}</DialogTitle>
      <DialogContent>
        <TextField
          fullWidth
          size="small"
          margin="dense"
          label="分类名称"
          value={name}
          onChange={(event) => setName(event.target.value)}
          inputProps={{ 'aria-label': '分类名称' }}
        />
        <FormControl fullWidth size="small" margin="dense">
          <InputLabel id="category-kind-label">适用方向</InputLabel>
          <Select
            labelId="category-kind-label"
            label="适用方向"
            value={kind}
            onChange={(event) => setKind(event.target.value as CategoryKind)}
          >
            {KIND_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1.5 }}>
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            aria-label="分类颜色"
            style={{ width: 42, height: 34, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
          />
          <TextField
            fullWidth
            size="small"
            label="主题色 #RRGGBB"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            inputProps={{ 'aria-label': '主题色' }}
          />
        </Box>
        <TextField
          fullWidth
          size="small"
          margin="dense"
          label="图标名（可选）"
          value={icon}
          onChange={(event) => setIcon(event.target.value)}
          helperText="如 restaurant / salary，留空使用默认图标"
        />
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)', display: 'block', mb: 0.75 }}>
            快捷选择可视化图标：
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {CATEGORY_ICON_OPTIONS.map((opt) => {
              const selected = icon === opt.key;
              return (
                <Chip
                  key={opt.key}
                  size="small"
                  icon={<CategoryIcon icon={opt.key} name={opt.label} size={18} />}
                  label={opt.label}
                  variant={selected ? 'filled' : 'outlined'}
                  color={selected ? 'primary' : 'default'}
                  onClick={() => {
                    setIcon(opt.key);
                    setColor(opt.color);
                  }}
                />
              );
            })}
          </Box>
        </Box>
        {localError ? (
          <Typography variant="body2" color="error" sx={{ mt: 1 }}>
            {localError}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          取消
        </Button>
        <Button variant="contained" onClick={() => void handleSubmit()} disabled={busy}>
          {initial ? '保存' : '新增'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** 分类管理面板属性。 */
export interface CategoryManagerPanelProps {
  /** 可选由父页面（如 BillsPage）传入的共享分类状态，确保增删改实时同步至父页面筛选器与弹窗。 */
  categoriesState?: UseCategoriesResult;
  /** 是否隐藏面板内置顶栏标题（嵌在弹窗中时由 DialogTitle 承载标题）。 */
  hideHeaderTitle?: boolean;
  /** 新增分类成功时的回调（便于记一笔弹窗自动选中刚新建的分类）。 */
  onCategoryCreated?: (created: Category) => void;
}

/**
 * 分类管理核心内容面板（可嵌入弹窗或独立路由页）。
 */
export function CategoryManagerPanel({
  categoriesState,
  hideHeaderTitle = false,
  onCategoryCreated,
}: CategoryManagerPanelProps) {
  const { status } = useVault();
  const internalState = useCategories();
  const activeState = categoriesState ?? internalState;
  const { categories, loading, error, addCategory, updateCategory, deleteCategory } = activeState;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Category | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const interactive = status === 'unlocked';

  const openCreate = (): void => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (category: Category): void => {
    setEditing(category);
    setDialogOpen(true);
  };
  const handleSubmit = async (input: CategoryInput): Promise<boolean> => {
    if (editing) {
      await updateCategory(editing, input);
    } else {
      const created = await addCategory(input);
      if (created && onCategoryCreated) {
        onCategoryCreated(created);
      }
    }
    return true;
  };
  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) {
      return;
    }
    setDeleteError(null);
    try {
      await deleteCategory(pendingDelete.id);
      setPendingDelete(null);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : '删除失败');
    }
  };

  const editDialog = (
    <CategoryEditDialog
      open={dialogOpen}
      initial={editing}
      onClose={() => setDialogOpen(false)}
      onSubmit={handleSubmit}
    />
  );

  const confirmDialog = (
    <Dialog open={pendingDelete !== null} onClose={() => setPendingDelete(null)} maxWidth="xs" fullWidth>
      <DialogTitle>确认删除分类</DialogTitle>
      <DialogContent>
        <Typography variant="body2">
          确定要删除分类「{pendingDelete?.name}」吗？已使用该分类的账单不会被自动重新归类（仍保留原分类引用）。
        </Typography>
        {deleteError ? (
          <Typography variant="body2" color="error" sx={{ mt: 1 }}>
            {deleteError}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setPendingDelete(null)}>取消</Button>
        <Button variant="contained" color="error" onClick={() => void confirmDelete()}>
          删除
        </Button>
      </DialogActions>
    </Dialog>
  );

  if (loading && categories.length === 0) {
    return (
      <div data-testid="categories-panel">
        <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)' }}>
          正在加载分类…
        </Typography>
      </div>
    );
  }

  return (
    <div data-testid="categories-panel">
      <Box
        sx={{
          display: 'flex',
          justifyContent: hideHeaderTitle ? 'flex-end' : 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1,
          mb: 1.5,
        }}
      >
        {!hideHeaderTitle ? (
          <Typography variant="h6" sx={{ fontWeight: 700, fontSize: { xs: '1.1rem', sm: '1.25rem' } }}>
            分类管理
          </Typography>
        ) : null}
        {interactive ? (
          <Button variant="contained" size="small" startIcon={<AddOutlined />} onClick={openCreate}>
            新增分类
          </Button>
        ) : null}
      </Box>
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}
      <Paper variant="outlined" sx={{ overflowX: 'auto', borderRadius: 2.5 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ px: { xs: 1.25, sm: 2 } }}>名称</TableCell>
              <TableCell sx={{ px: { xs: 1, sm: 2 }, whiteSpace: 'nowrap' }}>方向</TableCell>
              <TableCell sx={{ px: { xs: 1, sm: 2 }, whiteSpace: 'nowrap' }}>类型</TableCell>
              <TableCell align="right" sx={{ px: { xs: 1, sm: 2 }, whiteSpace: 'nowrap' }}>
                操作
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {categories.map((category) => (
              <TableRow key={category.id} data-testid="category-row">
                <TableCell sx={{ py: 1, px: { xs: 1.25, sm: 2 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <CategoryIcon icon={category.icon} name={category.name} size={24} />
                    <Box
                      aria-hidden
                      sx={{
                        width: 9,
                        height: 9,
                        borderRadius: '50%',
                        backgroundColor: category.color,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontWeight: 500 }}>{category.name}</span>
                  </Box>
                </TableCell>
                <TableCell sx={{ px: { xs: 1, sm: 2 }, whiteSpace: 'nowrap' }}>
                  {KIND_LABEL[category.kind]}
                </TableCell>
                <TableCell sx={{ px: { xs: 1, sm: 2 }, whiteSpace: 'nowrap' }}>
                  {category.isSystem ? (
                    <Chip size="small" label="系统预置" color="default" variant="outlined" />
                  ) : (
                    <Chip size="small" label="自定义" color="primary" variant="outlined" />
                  )}
                </TableCell>
                <TableCell align="right" sx={{ px: { xs: 1, sm: 2 }, whiteSpace: 'nowrap' }}>
                  {interactive ? (
                    <Box sx={{ display: 'inline-flex', gap: 0.25 }}>
                      <Tooltip title="编辑">
                        <IconButton
                          size="small"
                          aria-label={`编辑分类 ${category.name}`}
                          onClick={() => openEdit(category)}
                        >
                          <EditOutlined fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={category.isSystem ? '系统预置分类不可删除' : '删除'}>
                        <span>
                          <IconButton
                            size="small"
                            aria-label={`删除分类 ${category.name}`}
                            disabled={category.isSystem}
                            onClick={() => setPendingDelete(category)}
                          >
                            <DeleteOutline fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Box>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
            {categories.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)', py: 1 }}>
                    还没有分类，点击右上角「新增分类」创建第一个。
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Paper>
      {editDialog}
      {confirmDialog}
    </div>
  );
}

/** 分类管理弹窗属性。 */
export interface CategoryManagerDialogProps {
  /** 是否打开弹窗。 */
  open: boolean;
  /** 关闭回调。 */
  onClose: () => void;
  /** 共享分类状态（来自账单列表页）。 */
  categoriesState?: UseCategoriesResult;
  /** 新增分类完成回调。 */
  onCategoryCreated?: (created: Category) => void;
}

/**
 * 账单页与记账对话框内唤起的「分类管理」弹窗（同时适配 Windows 桌面端与 Android 窄屏）。
 */
export function CategoryManagerDialog({
  open,
  onClose,
  categoriesState,
  onCategoryCreated,
}: CategoryManagerDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="category-manager-dialog-title"
      data-testid="category-manager-dialog"
    >
      <DialogTitle
        id="category-manager-dialog-title"
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pb: 1,
          px: { xs: 2, sm: 3 },
        }}
      >
        <Typography component="span" variant="subtitle1" sx={{ fontWeight: 700 }}>
          分类管理
        </Typography>
        <IconButton size="small" aria-label="关闭分类管理" onClick={onClose}>
          <CloseOutlined fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ px: { xs: 1.5, sm: 3 }, pb: 2.5 }}>
        <CategoryManagerPanel
          categoriesState={categoriesState}
          hideHeaderTitle
          onCategoryCreated={onCategoryCreated}
        />
      </DialogContent>
    </Dialog>
  );
}
