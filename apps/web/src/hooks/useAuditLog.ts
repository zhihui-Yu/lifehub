/**
 * 审计日志 Hook。
 *
 * 架构位置：apps/web 的「Hooks」层。
 */
import { useCallback, useEffect, useState } from 'react';
import type { AuditLog } from '@lifehub/core';
import { useVault } from './useVault';

/** 审计日志 Hook 的返回值。 */
export interface UseAuditLogResult {
  /** 日志列表。 */
  logs: AuditLog[];
  /** 是否正在加载。 */
  loading: boolean;
  /** 中文错误提示。 */
  error: string | null;
  /** 重新加载。 */
  reload: () => Promise<void>;
  /** 清空日志（调用方需先二次确认）。 */
  clear: () => Promise<void>;
}

/**
 * 初始化审计日志列表。
 *
 * @returns 审计日志 Hook 的返回值
 */
export function useAuditLog(): UseAuditLogResult {
  const { runtime, status } = useVault();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!runtime || status !== 'unlocked') {
      return;
    }
    setLoading(true);
    try {
      const list = await runtime.auditLogger.list({ limit: 200 });
      setLogs(list);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '本地数据读写失败');
    } finally {
      setLoading(false);
    }
  }, [runtime, status]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const clear = useCallback(async () => {
    if (!runtime) {
      return;
    }
    await runtime.auditLogger.clear();
    await reload();
  }, [reload, runtime]);

  return { logs, loading, error, reload, clear };
}
