/**
 * 保险库状态卡。
 *
 * 架构位置：apps/web 的「安全组件」层。
 *
 * 说明：展示算法 / KDF 参数 / 密钥版本（PRD UI-04）。
 */
import { Box, Chip, Paper, Typography } from '@mui/material';
import EnhancedEncryptionOutlined from '@mui/icons-material/EnhancedEncryptionOutlined';
import KeyOutlined from '@mui/icons-material/KeyOutlined';
import LockOpenOutlined from '@mui/icons-material/LockOpenOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import MemoryOutlined from '@mui/icons-material/MemoryOutlined';
import ShieldOutlined from '@mui/icons-material/ShieldOutlined';
import TagOutlined from '@mui/icons-material/TagOutlined';

/** 保险库状态卡的属性。 */
export interface VaultStatusCardProps {
  /** 是否已创建保险库。 */
  created: boolean;
  /** 是否已解锁。 */
  unlocked: boolean;
  /** KDF 参数摘要。 */
  kdfSummary: string;
  /** 密钥版本。 */
  keyVersion: number;
  /** 密码学实现标识。 */
  providerName: string;
}

/**
 * 渲染保险库状态卡。
 *
 * 说明：统一采用「上方字段标签（块级 div + 图标） + 下方字段值（垂直居中）」的子卡片结构，
 * 避免行内 Chip 与行内 caption 挤在同一行导致位置错位。
 *
 * @param props 组件属性
 * @returns React 节点
 * @throws 无；纯展示组件不抛出异常
 */
export function VaultStatusCard({ created, unlocked, kdfSummary, keyVersion, providerName }: VaultStatusCardProps) {
  const statusText = created ? (unlocked ? '已解锁' : '已锁定') : '尚未创建';
  const fieldCardSx = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 0.75,
    p: 1.5,
    borderRadius: 1.5,
    backgroundColor: 'var(--lifehub-bg)',
    border: '1px solid var(--lifehub-border)',
  } as const;

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }} data-testid="vault-status-card">
      <Typography
        variant="h6"
        sx={{ mb: 1.5, color: 'var(--lifehub-text)', display: 'flex', alignItems: 'center', gap: 1 }}
      >
        <ShieldOutlined fontSize="small" color="primary" />
        加密状态
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 1.5 }}>
        <Box sx={fieldCardSx} data-testid="vault-status-field-status">
          <Typography
            variant="caption"
            component="div"
            sx={{ color: 'var(--lifehub-text-muted)', display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
            {unlocked ? <LockOpenOutlined sx={{ fontSize: 15 }} /> : <LockOutlined sx={{ fontSize: 15 }} />}
            状态
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 24 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--lifehub-text)' }}>
              {statusText}
            </Typography>
          </Box>
        </Box>

        <Box sx={fieldCardSx} data-testid="vault-status-field-algorithm">
          <Typography
            variant="caption"
            component="div"
            sx={{ color: 'var(--lifehub-text-muted)', display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
            <EnhancedEncryptionOutlined sx={{ fontSize: 15 }} />
            算法
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 24 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--lifehub-text)' }}>
              AES-256-GCM
            </Typography>
          </Box>
        </Box>

        <Box sx={fieldCardSx} data-testid="vault-status-field-kdf">
          <Typography
            variant="caption"
            component="div"
            sx={{ color: 'var(--lifehub-text-muted)', display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
            <KeyOutlined sx={{ fontSize: 15 }} />
            密钥派生
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 24 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--lifehub-text)' }}>
              {kdfSummary}
            </Typography>
          </Box>
        </Box>

        <Box sx={fieldCardSx} data-testid="vault-status-field-version">
          <Typography
            variant="caption"
            component="div"
            sx={{ color: 'var(--lifehub-text-muted)', display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
            <TagOutlined sx={{ fontSize: 15 }} />
            密钥版本
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 24 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--lifehub-text)' }}>
              v{keyVersion}
            </Typography>
          </Box>
        </Box>

        <Box sx={fieldCardSx} data-testid="vault-status-field-provider">
          <Typography
            variant="caption"
            component="div"
            sx={{ color: 'var(--lifehub-text-muted)', display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
            <MemoryOutlined sx={{ fontSize: 15 }} />
            实现
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 24 }}>
            <Chip
              size="small"
              label={providerName}
              variant="outlined"
              sx={{ color: 'var(--lifehub-text)', borderColor: 'var(--lifehub-border)', fontWeight: 500 }}
            />
          </Box>
        </Box>
      </Box>
    </Paper>
  );
}
