/**
 * 保险库状态卡。
 *
 * 架构位置：apps/web 的「安全组件」层。
 *
 * 说明：展示算法 / KDF 参数 / 密钥版本（PRD UI-04）。
 */
import { Box, Chip, Paper, Typography } from '@mui/material';

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
 * @param props 组件属性
 * @returns React 节点
 */
export function VaultStatusCard({ created, unlocked, kdfSummary, keyVersion, providerName }: VaultStatusCardProps) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5 }} data-testid="vault-status-card">
      <Typography variant="h6" sx={{ mb: 1.5, color: 'var(--lifehub-text)' }}>
        加密状态
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 1.5 }}>
        <Box>
          <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
            状态
          </Typography>
          <Typography variant="body2">
            {created ? (unlocked ? '已解锁' : '已锁定') : '尚未创建'}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
            算法
          </Typography>
          <Typography variant="body2">AES-256-GCM</Typography>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
            密钥派生
          </Typography>
          <Typography variant="body2">{kdfSummary}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
            密钥版本
          </Typography>
          <Typography variant="body2">v{keyVersion}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
            实现
          </Typography>
          <Chip size="small" label={providerName} variant="outlined" />
        </Box>
      </Box>
    </Paper>
  );
}
