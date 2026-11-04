/**
 * 安全与加密保护总开关卡片组件。
 *
 * 架构位置：apps/web 的「安全组件」层。
 *
 * 说明：允许用户一键切换「默认免密直入模式（不设密码锁、默认不强制加密，打开即用）」与
 * 「主密码锁 + AES-256-GCM 端到端加密保护模式」。
 */
import { Box, Chip, FormControlLabel, Paper, Switch, Typography } from '@mui/material';
import LockOpenOutlined from '@mui/icons-material/LockOpenOutlined';
import ShieldOutlined from '@mui/icons-material/ShieldOutlined';
import { dekProvider, useSettingsStore, useVaultStore } from '@/store';

/**
 * 渲染「安全与加密保护总开关」卡片。
 *
 * 说明：默认关闭（`securityEnabled === false`），用户无需设置主密码即可直接使用全部记账、导入与云同步功能；
 * 开启后（`securityEnabled === true`）将启用本地主密码锁与 AES-256-GCM 强制加密保护。
 *
 * @param _props 组件无外部入参
 * @returns React 节点
 * @throws 无；纯状态切换组件不抛出异常
 */
export function SecurityMasterToggleCard() {
  const securityEnabled = useSettingsStore((state) => state.securityEnabled);
  const setSecurityEnabled = useSettingsStore((state) => state.setSecurityEnabled);

  const handleToggle = (enabled: boolean): void => {
    setSecurityEnabled(enabled);
    if (!enabled) {
      const defaultDek = new Uint8Array(32).fill(7);
      if (!dekProvider.isUnlocked()) {
        dekProvider.setDek(defaultDek, 1);
      }
      useVaultStore.getState().setUnlocked(defaultDek, 1);
    }
  };

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 3,
        mb: 3,
        backgroundColor: 'var(--lifehub-surface)',
        borderColor: 'var(--lifehub-border)',
      }}
      data-testid="security-master-toggle-card"
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1.5,
        }}
      >
        <Box sx={{ flex: 1, minWidth: 240 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75, flexWrap: 'wrap' }}>
            {securityEnabled ? (
              <ShieldOutlined fontSize="small" color="primary" />
            ) : (
              <LockOpenOutlined fontSize="small" color="action" />
            )}
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              安全与加密保护总开关
            </Typography>
            <Chip
              size="small"
              color={securityEnabled ? 'success' : 'default'}
              label={securityEnabled ? '已启用密码锁与加密' : '默认免密直入（不加密）'}
              data-testid="security-mode-chip"
            />
          </Box>
          <Typography
            variant="body2"
            sx={{ color: 'var(--lifehub-text-muted)' }}
            data-testid="security-mode-description"
          >
            {securityEnabled
              ? '已开启本地主密码锁与 AES-256-GCM 端到端加密保护。每次启动或锁定后需输入主密码解锁。'
              : '当前已关闭密码锁与强制加密（默认登入不加密，打开即用）。如你需要主密码锁保护本地账本，可随时开启右侧开关。'}
          </Typography>
        </Box>

        <FormControlLabel
          control={
            <Switch
              checked={securityEnabled}
              onChange={(e) => handleToggle(e.target.checked)}
              inputProps={{
                'aria-label': '安全与加密保护总开关',
                ...({ 'data-testid': 'security-encryption-switch' } as Record<string, string>),
              }}
            />
          }
          label={securityEnabled ? '加密与密码锁已开启' : '免密直入（默认关闭）'}
        />
      </Box>
    </Paper>
  );
}
