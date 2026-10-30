/**
 * 侧导航组件。
 *
 * 架构位置：apps/web 的「布局组件」层。
 *
 * 说明：桌面端 220px 侧导航；小屏（<900px）由 AppShell 的 CSS 折叠为底部 Tab。
 */
import { Box, List, ListItemButton, ListItemIcon, ListItemText, Typography } from '@mui/material';
import AddCircleOutline from '@mui/icons-material/AddCircleOutline';
import ReceiptLong from '@mui/icons-material/ReceiptLong';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import ShieldOutlined from '@mui/icons-material/ShieldOutlined';
import { NavLink, useLocation } from 'react-router-dom';

/** 侧导航项定义。 */
const NAV_ITEMS = [
  { path: '/import', label: '导入账单', icon: <AddCircleOutline fontSize="small" /> },
  { path: '/bills', label: '账单列表', icon: <ReceiptLong fontSize="small" /> },
  { path: '/security', label: '安全与加密', icon: <ShieldOutlined fontSize="small" /> },
  { path: '/settings', label: '设置', icon: <SettingsOutlined fontSize="small" /> },
];

/**
 * 渲染侧导航。
 *
 * @returns React 节点
 */
export function SideNav() {
  const location = useLocation();
  return (
    <Box
      component="nav"
      aria-label="主导航"
      className="lifehub-sidenav"
      sx={{ display: 'flex', flexDirection: 'column' }}
    >
      <Box sx={{ p: 2.5, pb: 1.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, color: 'var(--lifehub-text)' }}>
          LifeHub
        </Typography>
        <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
          本地优先 · 端到端加密
        </Typography>
      </Box>
      <List dense sx={{ flex: 1, overflowY: 'auto' }}>
        {NAV_ITEMS.map((item) => {
          const active = location.pathname.startsWith(item.path);
          return (
            <ListItemButton
              key={item.path}
              component={NavLink}
              to={item.path}
              selected={active}
              aria-current={active ? 'page' : undefined}
              sx={{ mx: 1, borderRadius: 1.5, mb: 0.5 }}
            >
              <ListItemIcon sx={{ minWidth: 34 }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 14 }} />
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );
}
