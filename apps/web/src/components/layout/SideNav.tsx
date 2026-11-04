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
import CategoryOutlined from '@mui/icons-material/CategoryOutlined';
import EventNoteOutlined from '@mui/icons-material/EventNoteOutlined';
import TaskAltOutlined from '@mui/icons-material/TaskAltOutlined';
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import ShieldOutlined from '@mui/icons-material/ShieldOutlined';
import { NavLink, useLocation } from 'react-router-dom';

/** 侧导航项定义。 */
const NAV_ITEMS = [
  { path: '/import', label: '导入账单', icon: <AddCircleOutline fontSize="small" />, desktopOnly: true },
  { path: '/bills', label: '账单列表', icon: <ReceiptLong fontSize="small" />, desktopOnly: false },
  { path: '/categories', label: '分类管理', icon: <CategoryOutlined fontSize="small" />, desktopOnly: true },
  { path: '/schedule', label: '生活课表', icon: <EventNoteOutlined fontSize="small" />, desktopOnly: false },
  { path: '/habits', label: '习惯打卡', icon: <TaskAltOutlined fontSize="small" />, desktopOnly: true },
  { path: '/ai', label: 'AI 分析', icon: <AutoAwesomeOutlined fontSize="small" />, desktopOnly: false },
  { path: '/security', label: '安全与加密', icon: <ShieldOutlined fontSize="small" />, desktopOnly: true },
  { path: '/settings', label: '设置', icon: <SettingsOutlined fontSize="small" />, desktopOnly: false },
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
      <List dense className="lifehub-sidenav__list" sx={{ flex: 1, overflowY: 'auto' }}>
        {NAV_ITEMS.map((item) => {
          const active = location.pathname.startsWith(item.path);
          const itemClasses = [
            'lifehub-sidenav__link',
            active ? 'lifehub-sidenav__link--active' : '',
            item.desktopOnly
              ? 'lifehub-sidenav__item--desktop-only lifehub-sidenav__link--desktop-only'
              : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <ListItemButton
              key={item.path}
              component={NavLink}
              to={item.path}
              selected={active}
              className={itemClasses}
              aria-current={active ? 'page' : undefined}
              sx={{
                mx: 1,
                borderRadius: 2,
                mb: 0.5,
                color: active ? 'primary.main' : 'var(--lifehub-text)',
                '&.Mui-selected': {
                  backgroundColor: 'var(--lifehub-primary-soft)',
                  color: 'primary.main',
                  '&:hover': {
                    backgroundColor: 'rgba(99, 102, 241, 0.22)',
                  },
                },
              }}
            >
              <ListItemIcon
                sx={{
                  minWidth: 36,
                  color: active ? 'primary.main' : 'var(--lifehub-text-muted)',
                }}
              >
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={item.label}
                primaryTypographyProps={{
                  fontSize: 14,
                  fontWeight: active ? 600 : 500,
                  color: active ? 'primary.main' : 'var(--lifehub-text)',
                }}
              />
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );
}
