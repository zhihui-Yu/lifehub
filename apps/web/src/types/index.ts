/**
 * Web 端专用类型。
 *
 * 架构位置：apps/web 的「类型」层。
 * 说明：只放 Web 表现层特有的类型，不污染 core 包（系统设计 §8.4）。
 */
import type { ReactNode } from 'react';

/** 顶部栏的账户状态。 */
export interface AccountStatus {
  /** 状态胶囊文案，如 '本地 · 已加密 🔒'。 */
  label: string;
  /** 是否处于已解锁状态。 */
  unlocked: boolean;
}

/** 侧导航项。 */
export interface NavItem {
  /** 路由路径。 */
  path: string;
  /** 中文标签。 */
  label: string;
  /** 图标节点。 */
  icon: ReactNode;
}

/** 导入步骤指示器的步骤定义。 */
export interface ImportStep {
  /** 步骤序号，从 1 开始。 */
  index: number;
  /** 中文标题。 */
  title: string;
  /** 中文描述。 */
  description: string;
}

/** 映射页的列方向（拖拽映射）。 */
export type ColumnSide = 'left' | 'right';

/** 拖拽映射的载荷。 */
export interface DragPayload {
  /** 源列索引。 */
  columnIndex: number;
  /** 源侧。 */
  from: ColumnSide;
}
