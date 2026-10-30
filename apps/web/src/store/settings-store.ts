/**
 * 应用设置状态。
 *
 * 架构位置：apps/web 的「状态管理」层（Zustand）。
 *
 * 说明：设置本身明文存储在 `appSettings` 实体中（PRD §3.1 允许），
 * 因为解锁前就需要读取时区 / 主题。
 */
import { create } from 'zustand';
import type { CurrencyCode, ThemeMode, WeekStart } from '@lifehub/core';

/** 设置 store 的状态与动作。 */
export interface SettingsState {
  /** 默认时区 IANA 名。 */
  timezone: string;
  /** 默认币种。 */
  currency: CurrencyCode;
  /** 主题模式。 */
  theme: ThemeMode;
  /** 一周起始日。 */
  weekStart: WeekStart;
  /** 界面语言标识。 */
  locale: string;
  /** 设置默认时区。 */
  setTimezone: (timezone: string) => void;
  /** 设置默认币种。 */
  setCurrency: (currency: CurrencyCode) => void;
  /** 设置主题模式。 */
  setTheme: (theme: ThemeMode) => void;
  /** 设置一周起始日。 */
  setWeekStart: (weekStart: WeekStart) => void;
  /** 从持久化数据恢复设置。 */
  hydrate: (settings: Partial<SettingsState>) => void;
}

/**
 * 应用设置 store。
 */
export const useSettingsStore = create<SettingsState>((set) => ({
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  currency: 'CNY',
  theme: 'system',
  weekStart: 1,
  locale: 'zh-CN',
  setTimezone: (timezone) => set({ timezone }),
  setCurrency: (currency) => set({ currency }),
  setTheme: (theme) => set({ theme }),
  setWeekStart: (weekStart) => set({ weekStart }),
  hydrate: (settings) => set(settings),
}));
