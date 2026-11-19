/**
 * 云存储连接地址内嵌存储桶解析、Android 原生免 CORS 桥接与多端上传前强制拉取合并测试。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Category } from '@lifehub/core';
import { makeBill } from '@/__tests__/test-utils/fixtures';
import {
  buildSignedCloudHttpRequest,
  CLOUD_CONFIG_STORAGE_KEY,
  loadCloudConfig,
  mergeCloudDatasets,
  probeRemoteCloudConnection,
  recordCloudTombstone,
  resolveCloudEndpointTarget,
  syncUploadWithRemoteMerge,
  testCloudConnection,
  type CloudFullDataset,
  type CloudStorageConfig,
} from '@/lib/cloud-storage';

interface MockAndroidCloudBridge {
  startCloudHttpRequest: (
    requestId: string,
    targetUrl: string,
    method: string,
    headersJson: string,
    bodyText: string,
  ) => void;
  takeCloudHttpResponse: (requestId: string) => string;
}

const g = globalThis as unknown as { LifeHubAndroid?: MockAndroidCloudBridge };

function emptyDataset(partial: Partial<CloudFullDataset> = {}): CloudFullDataset {
  return {
    bills: partial.bills ?? [],
    categories: partial.categories ?? [],
    scheduleSlots: partial.scheduleSlots ?? [],
    completionEvents: partial.completionEvents ?? [],
    habits: partial.habits ?? [],
    habitCheckIns: partial.habitCheckIns ?? [],
    diaryEntries: partial.diaryEntries ?? [],
    tombstones: partial.tombstones ?? [],
  };
}

beforeEach(() => {
  window.localStorage.clear();
  delete g.LifeHubAndroid;
});

afterEach(() => {
  delete g.LifeHubAndroid;
  vi.restoreAllMocks();
});

describe('云存储连接地址直接包含存储桶名称（免拆分 Bucket）', () => {
  it('直接解析腾讯云 COS 访问域名 https://example-bucket-1250000000.cos.ap-guangzhou.myqcloud.com 并生成合法签名，忽略旧默认桶名', async () => {
    const config: CloudStorageConfig = {
      provider: 'aliyun-oss', // 即使下拉框停留在默认项，也能根据域名自动识别为腾讯云 COS
      endpoint: 'https://example-bucket-1250000000.cos.ap-guangzhou.myqcloud.com',
      bucket: 'lifehub-bills-oss', // 即使残留旧默认桶名，也不会错误拼接出双层桶域名
      accessKey: 'AKID_COS_DEMO',
      secretKey: 'COS_SECRET_DEMO',
      encryptUpload: true,
    };

    const resolved = resolveCloudEndpointTarget(config);
    expect(resolved.ok).toBe(true);
    expect(resolved.effectiveProvider).toBe('tencent-cos');
    expect(resolved.bucketName).toBe('example-bucket-1250000000');
    expect(resolved.host).toBe('example-bucket-1250000000.cos.ap-guangzhou.myqcloud.com');
    expect(resolved.objectKey).toBe('example-bucket-1250000000/lifehub-backup.json.enc');

    const signed = await buildSignedCloudHttpRequest(config, 'PUT');
    expect(signed.url.startsWith('https://example-bucket-1250000000.cos.ap-guangzhou.myqcloud.com/lifehub-backup.json.enc?')).toBe(
      true,
    );
    expect(signed.url).toContain('q-sign-algorithm=sha1');
    expect(signed.url).not.toContain('lifehub-bills-oss');
  });

  it('当连接地址仅填裸地域域名且无存储桶时，testCloudConnection 明确提示在地址中包含存储桶名', () => {
    const res = testCloudConnection({
      provider: 'tencent-cos',
      endpoint: 'https://cos.ap-guangzhou.myqcloud.com',
      bucket: '',
      accessKey: '',
      secretKey: '',
      encryptUpload: true,
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain('包含存储桶名称');
  });

  it('loadCloudConfig 自动将旧版拆分的 endpoint + bucket 平滑合并为单一完整连接地址', () => {
    window.localStorage.setItem(
      CLOUD_CONFIG_STORAGE_KEY,
      JSON.stringify({
        provider: 'tencent-cos',
        endpoint: 'https://cos.ap-guangzhou.myqcloud.com',
        bucket: 'example-bucket-1250000000',
        accessKey: 'AKID_LEGACY',
        secretKey: 'SEC_LEGACY',
      }),
    );

    const upgraded = loadCloudConfig();
    expect(upgraded.endpoint).toBe('https://example-bucket-1250000000.cos.ap-guangzhou.myqcloud.com');
    expect(upgraded.bucket).toBe('');
  });
});

describe('Android 原生免 CORS 云存储桥接与真实连通测试', () => {
  it('在 Android 容器中优先通过 LifeHubAndroid 原生桥接发起 COS 探测与上传，不触发 WebView fetch CORS 失败', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const store = new Map<string, string>();
    const responseQueue = new Map<string, string>();
    const recordedCalls: Array<{ method: string; url: string }> = [];

    g.LifeHubAndroid = {
      startCloudHttpRequest(reqId, targetUrl, method, _headersJson, bodyText) {
        recordedCalls.push({ method, url: targetUrl });
        const objectUrl = targetUrl.split('?')[0] ?? targetUrl;
        if (method === 'GET') {
          const existing = store.get(objectUrl);
          if (existing) {
            responseQueue.set(reqId, JSON.stringify({ proxied: true, status: 200, body: existing }));
          } else {
            responseQueue.set(
              reqId,
              JSON.stringify({
                proxied: true,
                status: 404,
                body: '<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>',
              }),
            );
          }
        } else if (method === 'PUT') {
          store.set(objectUrl, bodyText);
          responseQueue.set(reqId, JSON.stringify({ proxied: true, status: 200, body: '' }));
        }
        queueMicrotask(() => {
          window.dispatchEvent(
            new CustomEvent('lifehub:android-http-done', { detail: { requestId: reqId } }),
          );
        });
      },
      takeCloudHttpResponse(reqId) {
        const val = responseQueue.get(reqId) ?? '';
        responseQueue.delete(reqId);
        return val;
      },
    };

    const cosConfig: CloudStorageConfig = {
      provider: 'tencent-cos',
      endpoint: 'https://example-bucket-1250000000.cos.ap-guangzhou.myqcloud.com',
      bucket: '',
      accessKey: 'AKID_ANDROID_TEST',
      secretKey: 'SECRET_ANDROID_TEST',
      encryptUpload: true,
    };

    // 1. 真实测试连接：远端尚无文件（404 NoSuchKey），判定桶可达且鉴权通过
    const probeEmpty = await probeRemoteCloudConnection(cosConfig);
    expect(probeEmpty.ok).toBe(true);
    expect(probeEmpty.message).toContain('通过密钥鉴权校验');
    expect(fetchSpy).not.toHaveBeenCalled();

    // 2. 手机端首次上传：先 GET (404) 再 PUT (200)
    const phoneDataset = emptyDataset({
      bills: [
        makeBill({
          id: 'phone-b1',
          counterparty: '手机端早餐店',
          amountMinor: 1500,
          updatedAt: '2026-11-19T01:00:00.000Z',
        }),
        makeBill({
          id: 'shared-b2',
          counterparty: '待删除旧账单',
          amountMinor: 2000,
          updatedAt: '2026-11-19T01:00:00.000Z',
        }),
      ],
    });
    const upload1 = await syncUploadWithRemoteMerge(cosConfig, phoneDataset, 'SyncPass#2026');
    expect(upload1.mergedFromRemote).toBe(false);
    expect(upload1.record.revision).toBe(1);
    expect(upload1.record.billCount).toBe(2);

    // 3. 模拟另一台设备（桌面端）本地新增了 desktop-b3、修改了 phone-b1 的备注、删除了 shared-b2，直接点击上传！
    window.localStorage.clear();
    recordCloudTombstone('bill', 'shared-b2', '2026-11-19T03:00:00.000Z');
    const desktopDataset = emptyDataset({
      bills: [
        makeBill({
          id: 'phone-b1',
          counterparty: '手机端早餐店（桌面补充备注）',
          amountMinor: 1500,
          updatedAt: '2026-11-19T02:30:00.000Z',
        }),
        makeBill({
          id: 'desktop-b3',
          counterparty: '桌面端咖啡馆',
          amountMinor: 3200,
          updatedAt: '2026-11-19T02:45:00.000Z',
        }),
      ],
      tombstones: [
        {
          id: 'shared-b2',
          entityType: 'bill',
          deletedAt: '2026-11-19T03:00:00.000Z',
        },
      ],
    });

    const upload2 = await syncUploadWithRemoteMerge(cosConfig, desktopDataset, 'SyncPass#2026');
    expect(upload2.mergedFromRemote).toBe(true);
    expect(upload2.record.revision).toBe(2);
    expect(upload2.purged.billIds).toContain('shared-b2');
    expect(upload2.mergedDataset.bills.map((b) => b.id).sort()).toEqual(['desktop-b3', 'phone-b1']);
    expect(
      upload2.mergedDataset.bills.find((b) => b.id === 'phone-b1')?.counterparty,
    ).toBe('手机端早餐店（桌面补充备注）');
    expect(recordedCalls.some((c) => c.method === 'PUT')).toBe(true);
  });

  it('当 COS 返回 403 SignatureDoesNotMatch 时，probeRemoteCloudConnection 准确报告鉴权失败而非假成功', async () => {
    const responseQueue = new Map<string, string>();
    g.LifeHubAndroid = {
      startCloudHttpRequest(reqId) {
        responseQueue.set(
          reqId,
          JSON.stringify({
            proxied: true,
            status: 403,
            body: '<Error><Code>SignatureDoesNotMatch</Code><Message>The Signature you specified is invalid.</Message></Error>',
          }),
        );
        queueMicrotask(() => {
          window.dispatchEvent(
            new CustomEvent('lifehub:android-http-done', { detail: { requestId: reqId } }),
          );
        });
      },
      takeCloudHttpResponse(reqId) {
        return responseQueue.get(reqId) ?? '';
      },
    };

    const probe = await probeRemoteCloudConnection({
      provider: 'tencent-cos',
      endpoint: 'https://example-bucket-1250000000.cos.ap-guangzhou.myqcloud.com',
      bucket: '',
      accessKey: 'AKID_WRONG',
      secretKey: 'SECRET_WRONG',
      encryptUpload: true,
    });
    expect(probe.ok).toBe(false);
    expect(probe.message).toContain('SignatureDoesNotMatch');
  });
});

describe('mergeCloudDatasets 多端系统分类 ID 自动对齐', () => {
  it('两端独立初始化的同名系统分类自动对齐为本机分类 ID，远端账单不会因跨端 UUID 不同而丢失分类', () => {
    const localSysCat: Category = {
      id: 'cat-desktop-food',
      name: '餐饮美食',
      kind: 'expense',
      parentId: null,
      color: '#EF4444',
      icon: 'restaurant',
      isSystem: true,
      sortOrder: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: 1,
      deviceId: 'desktop',
    };
    const remoteSysCat: Category = {
      ...localSysCat,
      id: 'cat-phone-food',
      deviceId: 'phone',
    };

    const res = mergeCloudDatasets(
      emptyDataset({ categories: [localSysCat] }),
      emptyDataset({
        categories: [remoteSysCat],
        bills: [makeBill({ id: 'remote-meal', categoryId: 'cat-phone-food' })],
      }),
      1,
      1,
    );

    expect(res.merged.categories).toHaveLength(1);
    expect(res.merged.categories[0]?.id).toBe('cat-desktop-food');
    expect(res.merged.bills[0]?.categoryId).toBe('cat-desktop-food');
  });
});
