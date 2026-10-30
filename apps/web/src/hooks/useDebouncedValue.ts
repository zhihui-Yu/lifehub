/**
 * 防抖值 Hook。
 *
 * 架构位置：apps/web 的「Hooks」层。
 *
 * 说明：搜索框使用 200ms 防抖（A-09 ①），
 * 避免每敲一个字符就触发一次全量解密过滤。
 */
import { useEffect, useState } from 'react';

/** 搜索防抖时长（毫秒），对应 PRD A-09 ①。 */
export const SEARCH_DEBOUNCE_MS = 200;

/**
 * 返回防抖后的值。
 *
 * @param value 原始值
 * @param delay 防抖时长，默认 200ms
 * @returns 防抖后的值
 */
export function useDebouncedValue<T>(value: T, delay: number = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
