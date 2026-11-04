/**
 * 分类与来源渠道可视化图标组件库。
 *
 * 架构位置：apps/web 的「通用组件」层。
 *
 * 说明：统一将分类名称 / 图标标识（如 `restaurant`、`directions_bus`）与来源渠道
 * （微信支付、支付宝、银行流水、信用卡等）映射为带语义配色的 MUI 图标徽标。
 */
import type { ReactNode } from 'react';
import { Box } from '@mui/material';
import AccountBalanceOutlined from '@mui/icons-material/AccountBalanceOutlined';
import AccountBalanceWalletOutlined from '@mui/icons-material/AccountBalanceWalletOutlined';
import AttachMoneyOutlined from '@mui/icons-material/AttachMoneyOutlined';
import CategoryOutlined from '@mui/icons-material/CategoryOutlined';
import ChatBubbleOutline from '@mui/icons-material/ChatBubbleOutline';
import CheckroomOutlined from '@mui/icons-material/CheckroomOutlined';
import CreditCardOutlined from '@mui/icons-material/CreditCardOutlined';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import DirectionsBusOutlined from '@mui/icons-material/DirectionsBusOutlined';
import HomeOutlined from '@mui/icons-material/HomeOutlined';
import LocalHospitalOutlined from '@mui/icons-material/LocalHospitalOutlined';
import MoreHorizOutlined from '@mui/icons-material/MoreHorizOutlined';
import MovieOutlined from '@mui/icons-material/MovieOutlined';
import PhoneIphoneOutlined from '@mui/icons-material/PhoneIphoneOutlined';
import RedeemOutlined from '@mui/icons-material/RedeemOutlined';
import RestaurantOutlined from '@mui/icons-material/RestaurantOutlined';
import SavingsOutlined from '@mui/icons-material/SavingsOutlined';
import SchoolOutlined from '@mui/icons-material/SchoolOutlined';
import ShoppingBagOutlined from '@mui/icons-material/ShoppingBagOutlined';
import SwapHorizOutlined from '@mui/icons-material/SwapHorizOutlined';
import TrendingUpOutlined from '@mui/icons-material/TrendingUpOutlined';
import WorkOutline from '@mui/icons-material/WorkOutline';
import { classifySourceChannel, type SourceChannel } from '@lifehub/core';

/** 分类图标候选项定义。 */
export interface CategoryIconOption {
  /** 图标存储键值（写入 Category.icon）。 */
  key: string;
  /** 图标中文显示名称。 */
  label: string;
  /** 图标主题色。 */
  color: string;
}

/**
 * 预设分类可视化图标选项表。
 *
 * 说明：供分类新增/编辑弹窗的图标选择器以及账单/分类列表渲染使用。
 */
export const CATEGORY_ICON_OPTIONS: readonly CategoryIconOption[] = [
  { key: 'restaurant', label: '餐饮美食', color: '#f97316' },
  { key: 'directions_bus', label: '交通出行', color: '#3b82f6' },
  { key: 'shopping_bag', label: '购物消费', color: '#ec4899' },
  { key: 'home', label: '居家住房', color: '#8b5cf6' },
  { key: 'movie', label: '休闲娱乐', color: '#a855f7' },
  { key: 'local_hospital', label: '医疗健康', color: '#ef4444' },
  { key: 'school', label: '文教学习', color: '#06b6d4' },
  { key: 'phone_iphone', label: '通讯数码', color: '#0ea5e9' },
  { key: 'checkroom', label: '服饰美容', color: '#f43f5e' },
  { key: 'work', label: '工资薪水', color: '#16a34a' },
  { key: 'savings', label: '奖金补贴', color: '#10b981' },
  { key: 'trending_up', label: '投资理财', color: '#eab308' },
  { key: 'redeem', label: '人情红包', color: '#e11d48' },
  { key: 'swap_horiz', label: '转账往来', color: '#6366f1' },
  { key: 'attach_money', label: '其他收入', color: '#22c55e' },
  { key: 'more_horiz', label: '其他未分', color: '#64748b' },
] as const;

/** 分类图标组件的属性。 */
export interface CategoryIconProps {
  /** 分类图标标识（如 `restaurant`）。 */
  icon?: string | null;
  /** 分类中文名称（用于未显式设置图标标识时按语义推断）。 */
  name?: string;
  /** 徽标尺寸（像素，默认 24）。 */
  size?: number;
}

/**
 * 根据图标键值或分类中文名解析图标节点与配色。
 *
 * 说明：优先匹配 `icon` 键值，若未匹配则按分类名称中的关键词推断。
 *
 * @param icon 图标标识
 * @param name 分类名称
 * @param fontSize 内部 SVG 字号
 * @returns 图标节点与主题色
 * @throws 无；任何未知输入均回退到默认分类图标
 */
function resolveCategoryVisual(
  icon: string | null | undefined,
  name: string | undefined,
  fontSize: number,
): { node: ReactNode; color: string } {
  const key = (icon ?? '').trim().toLowerCase();
  const label = (name ?? '').trim();

  if (key === 'restaurant' || label.includes('餐') || label.includes('食') || label.includes('外卖')) {
    return { node: <RestaurantOutlined sx={{ fontSize }} />, color: '#f97316' };
  }
  if (
    key === 'commute' ||
    key === 'directions_bus' ||
    label.includes('交通') ||
    label.includes('出行') ||
    label.includes('打车')
  ) {
    return { node: <DirectionsBusOutlined sx={{ fontSize }} />, color: '#3b82f6' };
  }
  if (
    key === 'shopping' ||
    key === 'shopping_bag' ||
    label.includes('购物') ||
    label.includes('消费') ||
    label.includes('超市') ||
    label.includes('百货')
  ) {
    return { node: <ShoppingBagOutlined sx={{ fontSize }} />, color: '#ec4899' };
  }
  if (key === 'home' || label.includes('居家') || label.includes('住') || label.includes('房') || label.includes('水电')) {
    return { node: <HomeOutlined sx={{ fontSize }} />, color: '#8b5cf6' };
  }
  if (key === 'movie' || label.includes('娱乐') || label.includes('电影') || label.includes('旅游')) {
    return { node: <MovieOutlined sx={{ fontSize }} />, color: '#a855f7' };
  }
  if (
    key === 'medical' ||
    key === 'local_hospital' ||
    label.includes('医') ||
    label.includes('药') ||
    label.includes('健康')
  ) {
    return { node: <LocalHospitalOutlined sx={{ fontSize }} />, color: '#ef4444' };
  }
  if (key === 'school' || label.includes('文教') || label.includes('教育') || label.includes('学习') || label.includes('书')) {
    return { node: <SchoolOutlined sx={{ fontSize }} />, color: '#06b6d4' };
  }
  if (
    key === 'phone' ||
    key === 'phone_iphone' ||
    label.includes('通讯') ||
    label.includes('数码') ||
    label.includes('话费')
  ) {
    return { node: <PhoneIphoneOutlined sx={{ fontSize }} />, color: '#0ea5e9' };
  }
  if (key === 'checkroom' || label.includes('服') || label.includes('美容') || label.includes('穿搭')) {
    return { node: <CheckroomOutlined sx={{ fontSize }} />, color: '#f43f5e' };
  }
  if (key === 'salary' || key === 'work' || label.includes('工资') || label.includes('薪')) {
    return { node: <WorkOutline sx={{ fontSize }} />, color: '#16a34a' };
  }
  if (key === 'bonus' || key === 'savings' || label.includes('奖金') || label.includes('补贴') || label.includes('兼职')) {
    return { node: <SavingsOutlined sx={{ fontSize }} />, color: '#10b981' };
  }
  if (
    key === 'investment' ||
    key === 'trending_up' ||
    label.includes('投资') ||
    label.includes('理财') ||
    label.includes('收益')
  ) {
    return { node: <TrendingUpOutlined sx={{ fontSize }} />, color: '#eab308' };
  }
  if (key === 'redeem' || label.includes('红包') || label.includes('人情') || label.includes('礼金')) {
    return { node: <RedeemOutlined sx={{ fontSize }} />, color: '#e11d48' };
  }
  if (key === 'transfer' || key === 'swap_horiz' || label.includes('转账') || label.includes('还款')) {
    return { node: <SwapHorizOutlined sx={{ fontSize }} />, color: '#6366f1' };
  }
  if (key === 'attach_money' || label.includes('收入')) {
    return { node: <AttachMoneyOutlined sx={{ fontSize }} />, color: '#22c55e' };
  }
  if (key === 'more' || key === 'more_horiz' || label.includes('其他') || label.includes('未分类')) {
    return { node: <MoreHorizOutlined sx={{ fontSize }} />, color: '#64748b' };
  }
  return { node: <CategoryOutlined sx={{ fontSize }} />, color: '#6366f1' };
}

/**
 * 渲染分类可视化圆形图标徽标。
 *
 * 说明：根据分类 `icon` 字段或分类名称智能匹配语义图标与柔和背景色，提升分类辨识度。
 *
 * @param props 组件属性
 * @returns React 节点
 * @throws 无；纯展示组件不抛出异常
 */
export function CategoryIcon({ icon, name, size = 24 }: CategoryIconProps) {
  const fontSize = Math.max(13, Math.round(size * 0.62));
  const { node, color } = resolveCategoryVisual(icon, name, fontSize);

  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: `${color}1f`,
        color,
        flexShrink: 0,
        verticalAlign: 'middle',
      }}
      aria-hidden="true"
    >
      {node}
    </Box>
  );
}

/** 来源渠道图标组件的属性。 */
export interface ChannelIconProps {
  /** 来源渠道枚举（可选）。 */
  channel?: SourceChannel;
  /** 来源文件名（可选，未传 channel 时按文件名推断）。 */
  fileName?: string;
  /** 徽标尺寸（像素，默认 20）。 */
  size?: number;
}

/**
 * 渲染账单来源渠道可视化图标徽标。
 *
 * 说明：支持微信支付（绿）、支付宝（蓝）、银行卡/储蓄卡（琥珀）、信用卡（紫）及通用文件图标。
 *
 * @param props 组件属性
 * @returns React 节点
 * @throws 无；纯展示组件不抛出异常
 */
export function ChannelIcon({ channel, fileName, size = 20 }: ChannelIconProps) {
  const fontSize = Math.max(12, Math.round(size * 0.65));
  const lower = (fileName ?? '').toLowerCase();

  let effectiveChannel: SourceChannel | 'credit_card' = channel ?? 'other';
  if (!channel && lower) {
    if (lower.includes('信用卡') || lower.includes('credit')) {
      effectiveChannel = 'credit_card';
    } else {
      const classified = classifySourceChannel(fileName ?? '');
      if (classified !== 'other' && classified !== 'csv') {
        effectiveChannel = classified;
      } else if (
        lower.includes('招行') ||
        lower.includes('工行') ||
        lower.includes('建行') ||
        lower.includes('农行') ||
        lower.includes('中行') ||
        lower.includes('兴业')
      ) {
        effectiveChannel = 'bank';
      }
    }
  }

  let color = '#64748b';
  let node: ReactNode = <DescriptionOutlined sx={{ fontSize }} />;

  if (effectiveChannel === 'wechat') {
    color = '#16a34a';
    node = <ChatBubbleOutline sx={{ fontSize }} />;
  } else if (effectiveChannel === 'alipay') {
    color = '#0284c7';
    node = <AccountBalanceWalletOutlined sx={{ fontSize }} />;
  } else if (effectiveChannel === 'bank') {
    color = '#d97706';
    node = <AccountBalanceOutlined sx={{ fontSize }} />;
  } else if (effectiveChannel === 'credit_card') {
    color = '#7c3aed';
    node = <CreditCardOutlined sx={{ fontSize }} />;
  }

  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: 1,
        backgroundColor: `${color}1f`,
        color,
        flexShrink: 0,
        verticalAlign: 'middle',
      }}
      aria-hidden="true"
    >
      {node}
    </Box>
  );
}
