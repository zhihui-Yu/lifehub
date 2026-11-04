/**
 * 安全与加密页面（UI-04）。
 *
 * 架构位置：apps/web 的「页面」层。
 *
 * 说明：展示加密状态、常驻风险提示、恢复码与盐值备份、审计日志与清除（二次确认）。
 */
import { useState } from 'react';
import { Alert, Box, Button, Paper, Typography } from '@mui/material';
import LockOutlined from '@mui/icons-material/LockOutlined';
import PrivacyTipOutlined from '@mui/icons-material/PrivacyTipOutlined';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { AuditLogTable } from '@/components/security/AuditLogTable';
import { RecoveryCodePanel } from '@/components/security/RecoveryCodePanel';
import { SaltBackupPanel } from '@/components/security/SaltBackupPanel';
import { SecurityMasterToggleCard } from '@/components/security/SecurityMasterToggleCard';
import { SetPasswordDialog } from '@/components/security/SetPasswordDialog';
import { VaultStatusCard } from '@/components/security/VaultStatusCard';
import { useAuditLog } from '@/hooks/useAuditLog';
import { useVault } from '@/hooks/useVault';

/**
 * 渲染安全与加密页面。
 *
 * 说明：顶部提供「安全与加密保护总开关」（默认免密直入不加密），下方展示加密状态、常驻风险提示与高级主密码/恢复码/审计日志设置。
 *
 * @param _props 页面无外部入参
 * @returns React 节点
 * @throws 无；组件内部捕获异常并安全降级
 */
export function SecurityPage() {
  const { status, vaultCreated, recoveryBundle, regenerateRecoveryCode, runtime, createVault, unlock, error } =
    useVault();
  const { logs, clear } = useAuditLog();
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);

  return (
    <div data-testid="security-page">
      <SecurityMasterToggleCard />

      <Alert severity="warning" sx={{ mb: 2, width: '100%', boxSizing: 'border-box' }}>
        忘记主密码且没有恢复码时，数据将永久无法恢复。
      </Alert>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}>
        <VaultStatusCard
          created={vaultCreated}
          unlocked={status === 'unlocked'}
          kdfSummary="scrypt (N=32768, r=8, p=1)"
          keyVersion={1}
          providerName={runtime?.cryptoProvider.name ?? 'web-crypto'}
        />

        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, width: '100%', borderRadius: 3 }}>
          <Typography
            variant="h6"
            sx={{ mb: 1, color: 'var(--lifehub-text)', display: 'flex', alignItems: 'center', gap: 1 }}
          >
            <LockOutlined fontSize="small" color="primary" />
            主密码
          </Typography>
          <Typography variant="body2" sx={{ mb: 1.5, color: 'var(--lifehub-text-muted)' }}>
            主密码只在本机用于派生密钥，从不离开你的设备，也无法找回。
          </Typography>
          <Button size="small" variant="outlined" onClick={() => setPasswordDialogOpen(true)}>
            {vaultCreated ? '解锁保险库' : '设置主密码'}
          </Button>
        </Paper>

        <RecoveryCodePanel
          bundle={recoveryBundle}
          onRegenerate={() => void regenerateRecoveryCode()}
          onDownloadSalt={() => undefined}
        />

        <SaltBackupPanel bundle={recoveryBundle} />

        <AuditLogTable logs={logs} onClear={() => setClearDialogOpen(true)} />

        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, width: '100%', borderRadius: 3 }}>
          <Typography
            variant="h6"
            sx={{ mb: 1, color: 'var(--lifehub-text)', display: 'flex', alignItems: 'center', gap: 1 }}
          >
            <PrivacyTipOutlined fontSize="small" color="primary" />
            隐私说明
          </Typography>
          <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)' }}>
            本应用不采集手机号 / 设备号 / 定位 / 通讯录，不做埋点统计，不直连任何银行接口。
            所有账单数据加密后仅保存在本机浏览器中，不会上传到任何服务器。
          </Typography>
        </Paper>
      </Box>

      <SetPasswordDialog
        open={passwordDialogOpen}
        mode={vaultCreated ? 'unlock' : 'create'}
        error={error}
        onSubmit={async (password) => {
          const ok = vaultCreated ? await unlock(password) : await createVault(password);
          if (ok) {
            setPasswordDialogOpen(false);
          }
          return ok;
        }}
        onCancel={() => setPasswordDialogOpen(false)}
      />

      <ConfirmDialog
        open={clearDialogOpen}
        title="清除全部审计日志？"
        description="清除后无法恢复这些审计记录。业务数据不受影响。"
        confirmText="清除"
        onCancel={() => setClearDialogOpen(false)}
        onConfirm={() => {
          setClearDialogOpen(false);
          void clear();
        }}
      />
    </div>
  );
}
