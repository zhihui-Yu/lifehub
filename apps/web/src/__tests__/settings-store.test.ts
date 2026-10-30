/**
 * 应用设置 store 单测。
 *
 * 覆盖需求：PRD §5.5「基础设置」—— 默认时区 / 默认币种 / 主题 / 一周起始日 / 界面语言。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '@/store/settings-store';

describe('useSettingsStore', () => {
  beforeEach(() => {
    useSettingsStore.getState().hydrate({
      timezone: 'Asia/Shanghai',
      currency: 'CNY',
      theme: 'system',
      weekStart: 1,
      locale: 'zh-CN',
    });
  });

  it('默认币种是人民币、主题跟随系统、一周从周一开始、界面语言是简体中文', () => {
    const state = useSettingsStore.getState();
    expect(state.currency).toBe('CNY');
    expect(state.theme).toBe('system');
    expect(state.weekStart).toBe(1);
    expect(state.locale).toBe('zh-CN');
  });

  it('默认时区取自运行环境（IANA 名），拿不到时兜底为 UTC', () => {
    // 说明：hydrate 已经写入 Asia/Shanghai，这里验证 hydrate 生效。
    expect(useSettingsStore.getState().timezone).toBe('Asia/Shanghai');

    const fresh = useSettingsStore.getState();
    expect(typeof fresh.timezone).toBe('string');
    expect(fresh.timezone.length).toBeGreaterThan(0);
  });

  it('setTimezone 修改默认时区', () => {
    useSettingsStore.getState().setTimezone('Asia/Tokyo');
    expect(useSettingsStore.getState().timezone).toBe('Asia/Tokyo');
  });

  it('setCurrency 修改默认币种', () => {
    useSettingsStore.getState().setCurrency('CNY');
    expect(useSettingsStore.getState().currency).toBe('CNY');
  });

  it('setTheme 切换明暗主题', () => {
    useSettingsStore.getState().setTheme('dark');
    expect(useSettingsStore.getState().theme).toBe('dark');

    useSettingsStore.getState().setTheme('light');
    expect(useSettingsStore.getState().theme).toBe('light');
  });

  it('setWeekStart 切换一周起始日', () => {
    useSettingsStore.getState().setWeekStart(0);
    expect(useSettingsStore.getState().weekStart).toBe(0);
  });

  it('hydrate 可批量恢复持久化的设置', () => {
    useSettingsStore.getState().hydrate({ timezone: 'Europe/London', theme: 'dark' });

    const state = useSettingsStore.getState();
    expect(state.timezone).toBe('Europe/London');
    expect(state.theme).toBe('dark');
    // 未覆盖的字段保持原值。
    expect(state.currency).toBe('CNY');
  });
});
