/**
 * 侧导航组件。
 *
 * 架构位置：apps/web 的「布局组件」层。
 *
 * 说明：桌面端 220px 侧导航；小屏（<900px）由 AppShell 的 CSS 折叠为底部 Tab。
 */
import { useEffect, useState } from 'react';
import { Box, List, ListItemButton, ListItemIcon, ListItemText, Typography } from '@mui/material';
import AddCircleOutline from '@mui/icons-material/AddCircleOutline';
import ReceiptLong from '@mui/icons-material/ReceiptLong';
import CategoryOutlined from '@mui/icons-material/CategoryOutlined';
import EventNoteOutlined from '@mui/icons-material/EventNoteOutlined';
import TaskAltOutlined from '@mui/icons-material/TaskAltOutlined';
import ParkOutlined from '@mui/icons-material/ParkOutlined';
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import { NavLink, useLocation } from 'react-router-dom';

const NON_KEYBOARD_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/**
 * 判断当前聚焦元素是否为会唤起手机端软键盘的文本输入控件。
 */
function isSoftKeyboardTarget(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) {
    return !el.readOnly && !el.disabled;
  }
  if (el instanceof HTMLInputElement) {
    const type = (el.type || 'text').toLowerCase();
    return !NON_KEYBOARD_INPUT_TYPES.has(type) && !el.readOnly && !el.disabled;
  }
  if (el instanceof HTMLElement && el.isContentEditable) {
    return true;
  }
  return false;
}

/** 侧导航项定义。 */
const NAV_ITEMS = [
  { path: '/import', label: '导入账单', icon: <AddCircleOutline fontSize="small" />, desktopOnly: true },
  { path: '/bills', label: '账单列表', icon: <ReceiptLong fontSize="small" />, desktopOnly: false },
  { path: '/categories', label: '分类管理', icon: <CategoryOutlined fontSize="small" />, desktopOnly: true },
  { path: '/schedule', label: '生活课表', icon: <EventNoteOutlined fontSize="small" />, desktopOnly: false },
  { path: '/habits', label: '习惯打卡', icon: <TaskAltOutlined fontSize="small" />, desktopOnly: true },
  { path: '/treehole', label: '树洞', icon: <ParkOutlined fontSize="small" />, desktopOnly: false },
  { path: '/ai', label: 'AI 分析', icon: <AutoAwesomeOutlined fontSize="small" />, desktopOnly: false },
  { path: '/settings', label: '设置', icon: <SettingsOutlined fontSize="small" />, desktopOnly: false },
];

/**
 * 渲染侧导航。
 *
 * @returns React 节点
 */
export function SideNav() {
  const location = useLocation();
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const getViewportHeight = () => window.visualViewport?.height ?? window.innerHeight;
    let maxHeight = getViewportHeight();
    let blurTimer: ReturnType<typeof setTimeout> | null = null;

    const handleFocusIn = (e: FocusEvent) => {
      if (blurTimer) {
        clearTimeout(blurTimer);
        blurTimer = null;
      }
      const target = (e.target as Element | null) ?? document.activeElement;
      if (isSoftKeyboardTarget(target)) {
        setKeyboardOpen(true);
      }
    };

    const handleFocusOut = () => {
      if (blurTimer) {
        clearTimeout(blurTimer);
      }
      blurTimer = setTimeout(() => {
        const curH = getViewportHeight();
        const isShrunk = maxHeight - curH > 120;
        if (!isSoftKeyboardTarget(document.activeElement) && !isShrunk) {
          setKeyboardOpen(false);
        }
      }, 80);
    };

    const handleViewportResize = () => {
      const curH = getViewportHeight();
      if (curH > maxHeight) {
        maxHeight = curH;
      }
      const delta = maxHeight - curH;
      if (delta > 120) {
        setKeyboardOpen(true);
      } else if (delta <= 80) {
        // 用户通过安卓返回手势/收起键盘按钮关闭了输入法（此时输入框可能仍处于 focus 状态）
        setKeyboardOpen(false);
      }
    };

    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('focusout', handleFocusOut, true);
    window.addEventListener('resize', handleViewportResize);
    window.visualViewport?.addEventListener('resize', handleViewportResize);

    return () => {
      if (blurTimer) {
        clearTimeout(blurTimer);
      }
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('focusout', handleFocusOut, true);
      window.removeEventListener('resize', handleViewportResize);
      window.visualViewport?.removeEventListener('resize', handleViewportResize);
      document.body.classList.remove('lifehub-keyboard-open');
    };
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('lifehub-keyboard-open', keyboardOpen);
    }
  }, [keyboardOpen]);

  return (
    <Box
      component="nav"
      aria-label="主导航"
      className={`lifehub-sidenav${keyboardOpen ? ' lifehub-sidenav--keyboard-open' : ''}`}
      sx={{ display: 'flex', flexDirection: 'column' }}
    >
      <Box sx={{ p: 2.5, pb: 1.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, color: 'var(--lifehub-text)' }}>
          LifeHub
        </Typography>
        <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
          本地优先 · 数据自持
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
