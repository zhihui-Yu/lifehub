/**
 * 应用设置状态。
 *
 * 架构位置：apps/web 的「状态管理」层（Zustand）。
 *
 * 说明：设置本身明文存储在 `appSettings` 实体及浏览器 `localStorage` 中（PRD §3.1 允许），
 * 因为解锁前就需要读取时区、主题、月度预算与安全加密总开关。
 */
import { create } from 'zustand';
import type { CurrencyCode, ThemeMode, WeekStart } from '@lifehub/core';

/** 默认月度预算（整数分：500,000 分 = ¥5,000.00）。 */
export const DEFAULT_MONTHLY_BUDGET_CENTS = 500000;

/** localStorage 键名常量。 */
const STORAGE_KEYS = {
  timezone: 'lifehub.settings.timezone',
  monthlyBudgetCents: 'lifehub.monthlyBudgetCents',
  securityEnabled: 'lifehub.securityEnabled',
} as const;

/**
 * 从 localStorage 安全读取初始默认时区（IANA 时区名）。
 *
 * 说明：优先读取用户已持久化的时区设置；未存储或读取失败时回退至宿主环境时区或 `'UTC'`。
 *
 * @returns IANA 时区名称字符串
 * @throws 无；异常在内部捕获并回退默认值
 */
function loadInitialTimezone(): string {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(STORAGE_KEYS.timezone);
      if (raw && raw.trim() !== '') {
        return raw.trim();
      }
    }
  } catch {
    // 忽略受限环境下的 localStorage 读取异常。
  }
  return typeof Intl !== 'undefined'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    : 'UTC';
}

/**
 * 从 localStorage 安全读取初始月度预算（整数分）。
 *
 * 说明：当运行环境不支持 localStorage 或未存储有效正整数时，返回默认预算 `500000`（¥5,000.00）。
 *
 * @returns 月度预算整数分
 * @throws 无；异常在内部捕获并回退默认值
 */
function loadInitialMonthlyBudgetCents(): number {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(STORAGE_KEYS.monthlyBudgetCents);
      if (raw !== null) {
        const parsed = Number(raw);
        if (Number.isInteger(parsed) && parsed > 0) {
          return parsed;
        }
      }
    }
  } catch {
    // 忽略受限环境下的 localStorage 读取异常。
  }
  return DEFAULT_MONTHLY_BUDGET_CENTS;
}

/**
 * 从 localStorage 安全读取安全与加密总开关初始状态。
 *
 * 说明：默认返回 `false`（即默认登入不加密，打开即用）；仅当用户显式开启并持久化 `'true'` 时返回 `true`。
 *
 * @returns 是否开启主密码锁与强制加密保护
 * @throws 无；异常在内部捕获并回退默认值
 */
function loadInitialSecurityEnabled(): boolean {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(STORAGE_KEYS.securityEnabled) === 'true';
    }
  } catch {
    // 忽略受限环境下的 localStorage 读取异常。
  }
  return false;
}

/**
 * 安全写入 localStorage 键值。
 *
 * 说明：封装浏览器存储写入，防止隐私模式或配额超限抛出未捕获异常。
 *
 * @param key 存储键名
 * @param value 存储字符串值
 * @returns 无返回值
 * @throws 无；异常在内部捕获
 */
function safeSetLocalStorage(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // 忽略受限环境下的 localStorage 写入异常。
  }
}

/**
 * 设置 store 的状态与动作接口。
 *
 * 说明：管理应用级偏好设置、月度预算限额（A-23）与安全加密总开关。
 *
 * @param 无
 * @returns 状态与操作集合
 * @throws 无
 */
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
  /** 月度预算金额（整数分，默认 500000 即 ¥5,000.00）。 */
  monthlyBudgetCents: number;
  /** 安全与加密保护总开关（默认 false = 默认登入不加密，打开即用）。 */
  securityEnabled: boolean;
  /** 设置默认时区。 */
  setTimezone: (timezone: string) => void;
  /** 设置默认币种。 */
  setCurrency: (currency: CurrencyCode) => void;
  /** 设置主题模式。 */
  setTheme: (theme: ThemeMode) => void;
  /** 设置一周起始日。 */
  setWeekStart: (weekStart: WeekStart) => void;
  /** 设置月度预算金额（整数分）并持久化到 localStorage。 */
  setMonthlyBudgetCents: (cents: number) => void;
  /** 设置安全与加密保护总开关并持久化到 localStorage。 */
  setSecurityEnabled: (enabled: boolean) => void;
  /** 从持久化数据恢复设置。 */
  hydrate: (settings: Partial<SettingsState>) => void;
}

/**
 * 应用设置 Zustand Store。
 *
 * 说明：提供全局响应式设置读取与更新动作。
 *
 * @param set Zustand 状态更新函数
 * @returns SettingsState 实例
 * @throws 无
 */
export const useSettingsStore = create<SettingsState>((set) => ({
  timezone: loadInitialTimezone(),
  currency: 'CNY',
  theme: 'system',
  weekStart: 1,
  locale: 'zh-CN',
  monthlyBudgetCents: loadInitialMonthlyBudgetCents(),
  securityEnabled: loadInitialSecurityEnabled(),
  setTimezone: (timezone) => {
    safeSetLocalStorage(STORAGE_KEYS.timezone, timezone);
    set({ timezone });
  },
  setCurrency: (currency) => set({ currency }),
  setTheme: (theme) => set({ theme }),
  setWeekStart: (weekStart) => set({ weekStart }),
  setMonthlyBudgetCents: (cents) => {
    const validCents = Number.isFinite(cents) && cents > 0 ? Math.round(cents) : DEFAULT_MONTHLY_BUDGET_CENTS;
    safeSetLocalStorage(STORAGE_KEYS.monthlyBudgetCents, String(validCents));
    set({ monthlyBudgetCents: validCents });
  },
  setSecurityEnabled: (enabled) => {
    safeSetLocalStorage(STORAGE_KEYS.securityEnabled, String(Boolean(enabled)));
    set({ securityEnabled: Boolean(enabled) });
  },
  hydrate: (settings) => {
    if (typeof settings.timezone === 'string' && settings.timezone.trim() !== '') {
      safeSetLocalStorage(STORAGE_KEYS.timezone, settings.timezone);
    }
    if (typeof settings.monthlyBudgetCents === 'number') {
      safeSetLocalStorage(STORAGE_KEYS.monthlyBudgetCents, String(settings.monthlyBudgetCents));
    }
    if (typeof settings.securityEnabled === 'boolean') {
      safeSetLocalStorage(STORAGE_KEYS.securityEnabled, String(settings.securityEnabled));
    }
    set(settings);
  },
}));
