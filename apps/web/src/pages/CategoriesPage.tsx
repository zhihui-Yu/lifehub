/**
 * 分类管理页面（A-01 ② 分类维度维护）。
 *
 * 架构位置：apps/web 的「页面」层。
 *
 * 说明：解锁态下可新增 / 编辑 / 删除自定义分类；系统预置分类（`isSystem`）禁止删除，
 * 也禁止在编辑时被改造成普通分类（`buildCategory` 会保持 `isSystem` 原值）。
 * 列表按 `sortOrder` 升序展示，系统预置用角标区分。
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
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import EditOutlined from '@mui/icons-material/EditOutlined';
import type { Category, CategoryKind } from '@lifehub/core';
import { CATEGORY_ICON_OPTIONS, CategoryIcon } from '@/components/common/VisualIcons';
import { useVault } from '@/hooks/useVault';
import { useCategories } from '@/hooks/useCategories';
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
 * 分类编辑对话框（新增 / 编辑共用）。
 *
 * @param props 组件属性
 * @returns React 节点
 */
function CategoryEditDialog({ open, initial, onClose, onSubmit }: CategoryEditDialogProps) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [color, setColor] = useState('#2563EB');
  const [icon, setIcon] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // 打开或切换编辑对象时回填表单字段。
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

/**
 * 渲染分类管理页面。
 *
 * @returns React 节点
 */
export function CategoriesPage() {
  const { status } = useVault();
  const { categories, loading, error, addCategory, updateCategory, deleteCategory } = useCategories();

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
      await addCategory(input);
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

  const dialog = (
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
      <div data-testid="categories-page">
        <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)' }}>
          正在加载分类…
        </Typography>
      </div>
    );
  }

  return (
    <div data-testid="categories-page">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, fontSize: { xs: '1.1rem', sm: '1.25rem' } }}>
          分类管理
        </Typography>
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
      <Paper variant="outlined" sx={{ overflowX: 'auto', borderRadius: 3 }}>
        <Table size="small" sx={{ minWidth: 340 }}>
          <TableHead>
            <TableRow>
              <TableCell>名称</TableCell>
              <TableCell>方向</TableCell>
              <TableCell>类型</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {categories.map((category) => (
              <TableRow key={category.id} data-testid="category-row">
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CategoryIcon icon={category.icon} name={category.name} size={26} />
                    <Box
                      aria-hidden
                      sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: category.color, flexShrink: 0 }}
                    />
                    <span>{category.name}</span>
                  </Box>
                </TableCell>
                <TableCell>{KIND_LABEL[category.kind]}</TableCell>
                <TableCell>
                  {category.isSystem ? <Chip size="small" label="系统预置" color="default" variant="outlined" /> : <Chip size="small" label="自定义" color="primary" variant="outlined" />}
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  {interactive ? (
                    <Box sx={{ display: 'inline-flex', gap: 0.5 }}>
                      <Tooltip title="编辑">
                        <IconButton size="small" aria-label={`编辑分类 ${category.name}`} onClick={() => openEdit(category)}>
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
      {dialog}
      {confirmDialog}
    </div>
  );
}
