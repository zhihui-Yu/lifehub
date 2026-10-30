/**
 * 防抖值 Hook 单测。
 *
 * 覆盖需求：A-09 ① —— 搜索框使用 **200ms 防抖**，避免每敲一个字符就触发一次全量解密过滤。
 *
 * 说明：这里用 vitest 假定时器精确控制时间轴，
 * 断言「未到 200ms 不生效」「到 200ms 生效」「连续输入会重置计时」三条真实行为。
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from '@/hooks/useDebouncedValue';

describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('默认防抖时长是 200ms', () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(200);
  });

  it('值变化后在防抖窗口内不更新，超过窗口才更新', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
      initialProps: { value: '初始' },
    });

    expect(result.current).toBe('初始');

    rerender({ value: '星巴克' });

    // 还没到 200ms：保持旧值。
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(result.current).toBe('初始');

    // 到 200ms：更新为新值。
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('星巴克');
  });

  it('连续输入会重置计时，只有最后一个值生效', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
      initialProps: { value: '' },
    });

    rerender({ value: '星' });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    rerender({ value: '星巴' });
    act(() => {
      vi.advanceTimersByTime(150);
    });

    // 计时器已被重置，累计 300ms 也还没到新的 200ms 窗口。
    expect(result.current).toBe('');

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe('星巴');
  });

  it('支持自定义防抖时长', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 50), {
      initialProps: { value: 'a' },
    });

    rerender({ value: 'b' });
    act(() => {
      vi.advanceTimersByTime(49);
    });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('b');
  });
});
