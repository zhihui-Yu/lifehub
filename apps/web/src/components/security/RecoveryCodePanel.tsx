/**
 * 恢复码面板。
 *
 * 架构位置：apps/web 的「安全组件」层。
 *
 * 说明：恢复码**默认不展示明文**，只提示「已生成，请立即导出备份」；
 * 用户可主动选择「显示一次」（PRD UI-04 交互要点 2）。
 */
import { useState } from 'react';
import { Alert, Box, Button, Paper, Typography } from '@mui/material';
import type { RecoveryBundle } from '@lifehub/core';

/** 恢复码面板的属性。 */
export interface RecoveryCodePanelProps {
  /** 恢复码包；为 null 表示尚未生成。 */
  bundle: RecoveryBundle | null;
  /** 重新生成回调。 */
  onRegenerate: () => void;
  /** 下载盐值备份回调。 */
  onDownloadSalt: (bundle: RecoveryBundle) => void;
}

/**
 * 渲染恢复码面板。
 *
 * @param props 组件属性
 * @returns React 节点
 */
export function RecoveryCodePanel({ bundle, onRegenerate, onDownloadSalt }: RecoveryCodePanelProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }} data-testid="recovery-code-panel">
      <Typography variant="h6" sx={{ mb: 1, color: 'var(--lifehub-text)' }}>
        恢复码
      </Typography>
      <Alert severity="warning" sx={{ mb: 2 }}>
        忘记主密码且没有恢复码时，数据将永久无法恢复。请把恢复码与盐值备份另存到本机之外。
      </Alert>

      {bundle ? (
        <Box>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {revealed ? '恢复码（仅显示这一次，请立即抄写）：' : '已生成恢复码（默认隐藏）。'}
          </Typography>
          {revealed ? (
            <Box
              sx={{
                p: 1.5,
                mb: 1.5,
                borderRadius: 1.5,
                backgroundColor: 'var(--lifehub-bg)',
                fontFamily: 'monospace',
                wordBreak: 'break-all',
              }}
              data-testid="recovery-code-text"
            >
              {bundle.recoveryCode}
            </Box>
          ) : (
            <Typography variant="body2" sx={{ mb: 1.5, color: 'var(--lifehub-text-muted)' }}>
              ••••-•••••-•••••-•••••-•••••-•••••-•••••-•••••-•••••-•••••-•••••-•••••
            </Typography>
          )}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button size="small" variant="outlined" onClick={() => setRevealed((value) => !value)}>
              {revealed ? '隐藏' : '显示一次'}
            </Button>
            <Button size="small" variant="outlined" onClick={() => onDownloadSalt(bundle)}>
              下载盐值备份
            </Button>
            <Button size="small" color="warning" onClick={onRegenerate}>
              重新生成
            </Button>
          </Box>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button size="small" variant="contained" onClick={onRegenerate}>
            生成恢复码
          </Button>
        </Box>
      )}
    </Paper>
  );
}
