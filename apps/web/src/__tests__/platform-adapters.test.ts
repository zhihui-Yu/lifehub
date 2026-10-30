/**
 * 平台适配层测试。
 *
 * 覆盖需求：X-08（平台适配层是唯一缝合 core 端口与浏览器实现的地方）、
 * X-05 / NF-PR-1（设备标签只读浏览器名称，不采集设备标识）、A-01 ①（本地优先，无网络出口）。
 *
 * 说明：jsdom 不实现 IndexedDB，因此这里验证的是适配器的**构造与失败路径**
 * （打开失败要给出中文异常），而不是真的读写数据库；
 * 密码学实现只验证「能拿到随机源 / 实现标识正确」，不重复 core 包已有的加解密用例。
 */
import { describe, expect, it } from 'vitest';
import { LifeHubError } from '@lifehub/core';
import { createClock, SystemClock } from '@/platform/clock';
import { createDatabase, LifeHubDatabase } from '@/platform/db';
import { createDeviceLabel, detectBrowserName } from '@/platform/device-label';
import { DexieStorageAdapter } from '@/platform/indexeddb-storage-adapter';
import { createImportService, createPlatformRuntime, createVaultService } from '@/platform';
import { createWebCryptoProvider } from '@/platform/web-crypto-provider';
import { dekProvider } from '@/store/vault-store';

describe('SystemClock', () => {
  it('now 返回当前时刻的 Date 实例', () => {
    const clock = new SystemClock();
    const before = Date.now();
    const value = clock.now();
    const after = Date.now();

    expect(value).toBeInstanceOf(Date);
    expect(value.getTime()).toBeGreaterThanOrEqual(before);
    expect(value.getTime()).toBeLessThanOrEqual(after);
  });

  it('nowIso 返回 ISO 8601 UTC 字符串', () => {
    const iso = createClock().nowIso();
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(iso).toISOString()).toBe(iso);
  });
});

describe('detectBrowserName / createDeviceLabel', () => {
  /**
   * 临时改写 navigator.userAgent。
   *
   * @param userAgent 新的 UA 字符串
   * @returns 还原函数
   */
  function stubUserAgent(userAgent: string): () => void {
    const original = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent');
    Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });
    return () => {
      if (original) {
        Object.defineProperty(window.navigator, 'userAgent', original);
      }
    };
  }

  it('按 UA 关键词识别浏览器名称', () => {
    const restore = stubUserAgent('Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36');
    expect(detectBrowserName()).toBe('Chrome');
    restore();

    const restoreEdge = stubUserAgent('Mozilla/5.0 Edg/120.0.0.0');
    expect(detectBrowserName()).toBe('Edge');
    restoreEdge();

    const restoreFirefox = stubUserAgent('Mozilla/5.0 Firefox/121.0');
    expect(detectBrowserName()).toBe('Firefox');
    restoreFirefox();

    const restoreSafari = stubUserAgent('Mozilla/5.0 Version/17.0 Safari/605.1');
    expect(detectBrowserName()).toBe('Safari');
    restoreSafari();
  });

  it('无法识别时返回「未知浏览器」', () => {
    const restore = stubUserAgent('SomeCustomAgent/1.0');
    expect(detectBrowserName()).toBe('未知浏览器');
    restore();
  });

  it('设备标签形如「本机 · Chrome」，且只含浏览器名不含设备标识', () => {
    const restore = stubUserAgent('Mozilla/5.0 Chrome/120.0.0.0');
    const label = createDeviceLabel(createClock());

    expect(label).toBe('本机 · Chrome');
    expect(label).not.toMatch(/IMEI|设备号|指纹|uuid/i);
    restore();
  });
});

describe('createWebCryptoProvider', () => {
  it('返回的实现标识是 web-crypto', () => {
    expect(createWebCryptoProvider().name).toBe('web-crypto');
  });

  it('可以生成密码学随机字节', () => {
    const provider = createWebCryptoProvider();
    const bytes = provider.randomBytes(16);

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes).toHaveLength(16);
  });

  it('随机字节长度非法时抛出中文异常', () => {
    expect(() => createWebCryptoProvider().randomBytes(0)).toThrow('随机字节长度必须是不小于 1 的整数');
  });
});

describe('DexieStorageAdapter（IndexedDB 缺失时的失败路径）', () => {
  it('打开失败时抛出中文异常「无法打开本地数据库」', async () => {
    const adapter = new DexieStorageAdapter(createDatabase('lifehub-web-test'));

    await expect(adapter.open()).rejects.toThrow('无法打开本地数据库');
    await expect(adapter.open()).rejects.toBeInstanceOf(LifeHubError);
  });

  it('关闭数据库不抛异常', async () => {
    const adapter = new DexieStorageAdapter(createDatabase('lifehub-web-test-close'));
    await expect(adapter.close()).resolves.toBeUndefined();
  });
});

describe('LifeHubDatabase', () => {
  it('构造实例并声明 records 表', () => {
    const db = createDatabase('lifehub-web-test-db');
    expect(db).toBeInstanceOf(LifeHubDatabase);
    expect(db.tables.map((table) => table.name)).toContain('records');
    db.close();
  });
});

describe('createPlatformRuntime（平台适配层装配）', () => {
  it('装配出完整的运行时对象图', () => {
    const runtime = createPlatformRuntime(dekProvider, createDatabase('lifehub-web-test-runtime'));

    expect(runtime.cryptoProvider.name).toBe('web-crypto');
    expect(runtime.cryptoService).toBeDefined();
    expect(runtime.storageAdapter).toBeInstanceOf(DexieStorageAdapter);
    expect(runtime.plainStore).toBeDefined();
    expect(runtime.encryptedStore).toBeDefined();
    expect(runtime.vaultRepository).toBeDefined();
    expect(runtime.billRepository).toBeDefined();
    expect(runtime.categoryRepository).toBeDefined();
    expect(runtime.ruleTemplateRepository).toBeDefined();
    expect(runtime.importBatchRepository).toBeDefined();
    expect(runtime.auditLogRepository).toBeDefined();
    expect(runtime.auditLogger).toBeDefined();
    expect(runtime.dekProvider).toBe(dekProvider);
    // 设备标签只含「本机 · 浏览器名」，不含任何设备标识。
    expect(runtime.deviceLabel.startsWith('本机 · ')).toBe(true);
    expect(runtime.database).toBeDefined();

    runtime.database.close();
  });

  it('createImportService / createVaultService 能基于运行时构造服务', () => {
    const runtime = createPlatformRuntime(dekProvider, createDatabase('lifehub-web-test-services'));

    expect(createImportService(runtime, 'local-device')).toBeDefined();
    expect(createVaultService(runtime)).toBeDefined();

    runtime.database.close();
  });
});
