/**
 * 盐值备份面板。
 *
 * 架构位置：apps/web 的「安全组件」层。
 *
 * 说明：下载的盐值备份文件包含「盐值 + KDF 参数 + 哨兵密文 + 恢复码」，
 * **不含任何明文业务数据**，也不含主密码（PRD UI-04 交互要点 3）。
 */
import { Alert, Box, Button, Paper, Typography } from '@mui/material';
import CloudDownloadOutlined from '@mui/icons-material/CloudDownloadOutlined';
import type { RecoveryBundle } from '@lifehub/core';
import { buildDatedFileName, downloadText } from '@/utils/download';

/** 盐值备份面板的属性。 */
export interface SaltBackupPanelProps {
  /** 恢复码包。 */
  bundle: RecoveryBundle | null;
}

/**
 * 渲染盐值备份面板。
 *
 * @param props 组件属性
 * @returns React 节点
 */
export function SaltBackupPanel({ bundle }: SaltBackupPanelProps) {
  const handleDownload = (): void => {
    if (!bundle) {
      return;
    }
    const payload = {
      version: 1,
      type: 'lifehub-salt-backup',
      createdAt: bundle.createdAt,
      recoveryCode: bundle.recoveryCode,
      salt: Array.from(bundle.salt),
      kdfParams: bundle.kdfParams,
      verifier: {
        iv: Array.from(bundle.verifier.iv),
        ciphertext: Array.from(bundle.verifier.ciphertext),
        tag: Array.from(bundle.verifier.tag),
        algorithm: bundle.verifier.algorithm,
        keyVersion: bundle.verifier.keyVersion,
      },
      checksum: bundle.checksum,
    };
    downloadText(buildDatedFileName('lifehub-salt-backup', '.salt.json'), JSON.stringify(payload, null, 2));
  };

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }} data-testid="salt-backup-panel">
      <Typography
        variant="h6"
        sx={{ mb: 1, color: 'var(--lifehub-text)', display: 'flex', alignItems: 'center', gap: 1 }}
      >
        <CloudDownloadOutlined fontSize="small" color="primary" />
        盐值备份
      </Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        盐值备份文件含恢复码，可用于在主密码丢失时解锁保险库。请妥善保管，勿与主密码存放在一起。
      </Alert>
      <Box>
        <Button size="small" variant="outlined" disabled={!bundle} onClick={handleDownload}>
          下载盐值备份
        </Button>
      </Box>
    </Paper>
  );
}
