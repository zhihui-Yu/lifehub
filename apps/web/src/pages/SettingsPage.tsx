/**
 * 设置页面（P2 占位）。
 *
 * 架构位置：apps/web 的「页面」层。
 *
 * 说明：本轮只提供时区 / 币种 / 周起始三项基础设置（PRD §5.5 中标记为后续阶段的功能不在此实现）。
 */
import { Box, MenuItem, Paper, Select, TextField, Typography } from '@mui/material';
import { useSettingsStore } from '@/store';

/**
 * 渲染设置页面。
 *
 * @returns React 节点
 */
export function SettingsPage() {
  const timezone = useSettingsStore((state) => state.timezone);
  const currency = useSettingsStore((state) => state.currency);
  const weekStart = useSettingsStore((state) => state.weekStart);
  const setTimezone = useSettingsStore((state) => state.setTimezone);
  const setCurrency = useSettingsStore((state) => state.setCurrency);
  const setWeekStart = useSettingsStore((state) => state.setWeekStart);

  return (
    <div data-testid="settings-page">
      <Paper variant="outlined" sx={{ p: 2.5, maxWidth: 560 }}>
        <Typography variant="h6" sx={{ mb: 2, color: 'var(--lifehub-text)' }}>
          基础设置
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            size="small"
            label="默认时区"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            helperText="IANA 时区名，例如 Asia/Shanghai。用于计算本地日历日。"
          />
          <Select
            size="small"
            value={currency}
            onChange={(event) => setCurrency(event.target.value as 'CNY')}
            inputProps={{ 'aria-label': '默认币种' }}
          >
            <MenuItem value="CNY">人民币 CNY</MenuItem>
          </Select>
          <Select
            size="small"
            value={weekStart}
            onChange={(event) => setWeekStart(Number(event.target.value) as 0 | 1)}
            inputProps={{ 'aria-label': '一周起始日' }}
          >
            <MenuItem value={1}>周一</MenuItem>
            <MenuItem value={0}>周日</MenuItem>
          </Select>
        </Box>
      </Paper>
    </div>
  );
}
