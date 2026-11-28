/**
 * 云存储连接地址内嵌存储桶解析、Android 原生免 CORS 桥接与多端上传前强制拉取合并测试。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Category } from '@lifehub/core';
import { makeBill } from '@/__tests__/test-utils/fixtures';
import {
  buildSignedCloudHttpRequest,
  CLOUD_CONFIG_STORAGE_KEY,
  CLOUD_SNAPSHOT_STORAGE_KEY,
  compressBackupJson,
  decompressBackupJson,
  loadCloudConfig,
  mergeCloudDatasets,
  probeRemoteCloudConnection,
  recordCloudTombstone,
  resolveCloudEndpointTarget,
  restoreBillsFromCloud,
  syncCloudPullSmart,
  syncCloudUploadSmart,
  syncUploadWithRemoteMerge,
  testCloudConnection,
  uploadBillsToCloud,
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

describe('Emoji UTF-16 代理对无损压缩加密与历史受损快照自动自愈回归测试', () => {
  it('包含多个同高代理项 Emoji（如 💧/📚/💤 及 🏃/🌿）的习惯与树洞上传后可 100% 无损解密合并，绝不误报密码错误', async () => {
    const store = new Map<string, string>();
    const responseQueue = new Map<string, string>();
    g.LifeHubAndroid = {
      startCloudHttpRequest(reqId, targetUrl, method, _headersJson, bodyText) {
        const objectUrl = targetUrl.split('?')[0] ?? targetUrl;
        if (method === 'GET') {
          const existing = store.get(objectUrl);
          responseQueue.set(
            reqId,
            existing
              ? JSON.stringify({ proxied: true, status: 200, body: existing })
              : JSON.stringify({ proxied: true, status: 404, body: '<Error><Code>NoSuchKey</Code></Error>' }),
          );
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
      accessKey: 'AKID_EMOJI_TEST',
      secretKey: 'SECRET_EMOJI_TEST',
      encryptUpload: true,
    };

    const dataset1 = emptyDataset({
      bills: [makeBill({ id: 'b-emoji-1', note: '早餐 ☕️ + 🍎' })],
      habits: [
        {
          id: 'h-water',
          name: '喝水',
          unit: 'ml',
          targetPerPeriod: 7,
          trackingMode: 'quantity',
          defaultIncrement: 250,
          dailyTarget: 2000,
          icon: '💧', // \uD83D\uDCA7
          color: '#0284C7',
          createdAt: '2026-11-20T00:00:00.000Z',
          updatedAt: '2026-11-20T00:00:00.000Z',
        },
        {
          id: 'h-read',
          name: '阅读',
          unit: '页',
          targetPerPeriod: 7,
          trackingMode: 'quantity',
          defaultIncrement: 20,
          dailyTarget: 1000, // 与上方同以 "000" 结尾 + 紧接 "icon":"\uD83D..."，精确复现代理对边界
          icon: '📚', // \uD83D\uDCDA
          color: '#4F46E5',
          createdAt: '2026-11-20T00:00:00.000Z',
          updatedAt: '2026-11-20T00:00:00.000Z',
        },
        {
          id: 'h-run',
          name: '跑步',
          unit: 'km',
          targetPerPeriod: 7,
          trackingMode: 'quantity',
          dailyTarget: 5,
          icon: '🏃', // \uD83C\uDFC3
          color: '#16A34A',
          createdAt: '2026-11-20T00:00:00.000Z',
          updatedAt: '2026-11-20T00:00:00.000Z',
        },
      ],
      diaryEntries: [
        {
          id: 'd-1',
          title: '晚间复盘',
          body: '今天跑了 3.5km 🏃，心情 🌿 很放松',
          mood: '🌿 平静', // \uD83C\uDF3F
          tags: ['运动'],
          isPinned: false,
          localDate: '2026-11-23',
          occurredAt: '2026-11-23T12:00:00.000Z',
          createdAt: '2026-11-23T12:00:00.000Z',
          updatedAt: '2026-11-23T12:00:00.000Z',
        },
      ],
    });

    // 验证压缩结果不含任何孤立代理项，经过 UTF-8 编解码 100% 恒等
    const rawJson = JSON.stringify(dataset1);
    const compressed = compressBackupJson(rawJson);
    const utf8Roundtrip = new TextDecoder().decode(new TextEncoder().encode(compressed));
    expect(utf8Roundtrip).toBe(compressed);
    expect(decompressBackupJson(compressed)).toBe(rawJson);

    // 第一次上传至远端
    await syncUploadWithRemoteMerge(cosConfig, dataset1, 'MySamePass!123');

    // 第二次从 App 端执行 Pull-Merge-Push 上传：解密远端快照并合并成功，绝不抛「登录密码错误」
    const dataset2 = emptyDataset({
      bills: [makeBill({ id: 'b-emoji-2', note: '晚餐 🍜' })],
    });
    const secondSync = await syncUploadWithRemoteMerge(cosConfig, dataset2, 'MySamePass!123');
    expect(secondSync.mergedFromRemote).toBe(true);
    expect(secondSync.mergedDataset.bills).toHaveLength(2);
    expect(secondSync.mergedDataset.habits.map((h) => h.icon)).toEqual(['💧', '📚', '🏃']);
    expect(secondSync.mergedDataset.diaryEntries[0]?.mood).toBe('🌿 平静');
  });

  it('当远端已存有旧版因代理对截断导致 authTag 偏移的历史快照时，凭正确同指纹密码可自动自愈恢复，错误密码仍严格拒绝', () => {
    const cosConfig: CloudStorageConfig = {
      provider: 'tencent-cos',
      endpoint: 'https://example-bucket-1250000000.cos.ap-guangzhou.myqcloud.com',
      bucket: '',
      accessKey: '',
      secretKey: '',
      encryptUpload: true,
    };

    // 先生成一份正常快照作为模板
    uploadBillsToCloud(
      cosConfig,
      [makeBill({ id: 'b-legacy-1', counterparty: '历史账单' })],
      'CorrectPass888',
      {
        habits: [
          {
            id: 'h-w',
            name: '喝水',
            unit: 'ml',
            targetPerPeriod: 7,
            dailyTarget: 2000,
            icon: '💧',
            color: '#0284C7',
            createdAt: '2026-11-20T00:00:00.000Z',
            updatedAt: '2026-11-20T00:00:00.000Z',
          },
          {
            id: 'h-r',
            name: '阅读',
            unit: '页',
            targetPerPeriod: 7,
            dailyTarget: 1000,
            icon: '📚',
            color: '#4F46E5',
            createdAt: '2026-11-20T00:00:00.000Z',
            updatedAt: '2026-11-20T00:00:00.000Z',
          },
        ],
      },
    );

    // 模拟旧版 Bug 现场：将快照内某个孤立低代理项变成 U+FFFD 后加密（此时解密得到含 U+FFFD 的文本，但 authTag 仍是变化前的值）
    const templateSnap = JSON.parse(
      window.localStorage.getItem(CLOUD_SNAPSHOT_STORAGE_KEY) ?? '{}',
    ) as {
      meta: Record<string, unknown>;
      ciphertextBase64: string;
      salt: string;
      authTag: string;
      compression: string;
    };
    const originalAuthTag = templateSnap.authTag;

    // 再次生成含 U+FFFD 的密文载荷，保留原密码指纹但注入不匹配的旧 authTag
    uploadBillsToCloud(
      cosConfig,
      [makeBill({ id: 'b-legacy-1', counterparty: '历史账单' })],
      'CorrectPass888',
      {
        habits: [
          {
            id: 'h-w',
            name: '喝水',
            unit: 'ml',
            targetPerPeriod: 7,
            dailyTarget: 2000,
            icon: '💧',
            color: '#0284C7',
            createdAt: '2026-11-20T00:00:00.000Z',
            updatedAt: '2026-11-20T00:00:00.000Z',
          },
          {
            id: 'h-r',
            name: '阅读',
            unit: '页',
            targetPerPeriod: 7,
            dailyTarget: 1000,
            icon: '\ufffd',
            color: '#4F46E5',
            createdAt: '2026-11-20T00:00:00.000Z',
            updatedAt: '2026-11-20T00:00:00.000Z',
          },
        ],
      },
    );
    const corruptedSnap = JSON.parse(
      window.localStorage.getItem(CLOUD_SNAPSHOT_STORAGE_KEY) ?? '{}',
    ) as typeof templateSnap;
    corruptedSnap.authTag = originalAuthTag;
    window.localStorage.setItem(CLOUD_SNAPSHOT_STORAGE_KEY, JSON.stringify(corruptedSnap));

    // 1. 密码真正错误时：指纹不匹配，依然严格拦截报错
    expect(() => restoreBillsFromCloud(cosConfig, 'WrongPass999')).toThrow(
      '登录密码错误，无法解密还原云端数据',
    );

    // 2. 密码正确（指纹一致）时：自动自愈还原账单与习惯数据，且受损图标回退为合理图标 📚
    const healed = restoreBillsFromCloud(cosConfig, 'CorrectPass888');
    expect(healed.bills).toHaveLength(1);
    expect(healed.bills[0]?.counterparty).toBe('历史账单');
    expect(healed.habits.map((h) => h.icon)).toEqual(['💧', '📚']);
  });

  it('同类边界防护：WebDAV 含非 ASCII 账号密码不抛 btoa 异常，且 localStorage 超配额时自动切换内存兜底绝不上传旧快照', async () => {
    const webdavSigned = await buildSignedCloudHttpRequest(
      {
        provider: 'jianguoyun-webdav',
        endpoint: 'https://dav.jianguoyun.com/dav/LifeHubBackup/',
        bucket: '',
        accessKey: '测试账号@example.com',
        secretKey: '密码测试123',
        encryptUpload: true,
      },
      'PUT',
    );
    expect(webdavSigned.headers.Authorization).toMatch(/^Basic [A-Za-z0-9+/=]+$/);

    // 模拟浏览器 localStorage 已存有一份旧快照，随后新快照写入触发 QuotaExceededError
    const cosConfig: CloudStorageConfig = {
      provider: 'tencent-cos',
      endpoint: 'https://example-bucket-1250000000.cos.ap-guangzhou.myqcloud.com',
      bucket: '',
      accessKey: '',
      secretKey: '',
      encryptUpload: true,
    };
    uploadBillsToCloud(cosConfig, [makeBill({ id: 'old-bill', counterparty: '旧账单' })], 'QuotaPass1');

    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation((key: string) => {
        if (key === CLOUD_SNAPSHOT_STORAGE_KEY) {
          throw new DOMException('QuotaExceededError', 'QuotaExceededError');
        }
      });

    uploadBillsToCloud(
      cosConfig,
      [
        makeBill({ id: 'new-bill-1', counterparty: '超大容量新账单1' }),
        makeBill({ id: 'new-bill-2', counterparty: '超大容量新账单2' }),
      ],
      'QuotaPass1',
    );

    const restored = restoreBillsFromCloud(cosConfig, 'QuotaPass1');
    expect(restored.bills.map((b) => b.id)).toEqual(['new-bill-1', 'new-bill-2']);
    setItemSpy.mockRestore();
  });

  it('按月切分加密分片 + 内容哈希对比：无变动零重传、单月改动仅重传该月分片、且无缝兼容旧版单文件迁移', async () => {
    const store = new Map<string, string>();
    const responseQueue = new Map<string, string>();
    const calls: Array<{ method: string; objectName: string }> = [];

    g.LifeHubAndroid = {
      startCloudHttpRequest(reqId, targetUrl, method, _headersJson, bodyText) {
        const cleanUrl = targetUrl.split('?')[0] ?? targetUrl;
        const objectName = cleanUrl.split('/').pop() ?? cleanUrl;
        calls.push({ method, objectName });
        if (method === 'GET') {
          const existing = store.get(cleanUrl);
          responseQueue.set(
            reqId,
            existing
              ? JSON.stringify({ proxied: true, status: 200, body: existing })
              : JSON.stringify({ proxied: true, status: 404, body: '<Error><Code>NoSuchKey</Code></Error>' }),
          );
        } else if (method === 'PUT') {
          store.set(cleanUrl, bodyText);
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
      accessKey: 'AKID_SHARD_TEST',
      secretKey: 'SECRET_SHARD_TEST',
      encryptUpload: true,
    };

    // 0. 预置一份旧版单文件 `lifehub-backup.json.enc` 到远端桶，验证首次同步自动合并升级为分片结构
    uploadBillsToCloud(
      cosConfig,
      [
        makeBill({
          id: 'legacy-sep-1',
          localDate: '2026-09-10',
          occurredAt: '2026-09-10T08:00:00.000Z',
          counterparty: '九月历史账单',
          amountMinor: 1200,
        }),
      ],
      'ShardPass#2026',
    );
    const legacySnapshotRaw = window.localStorage.getItem(CLOUD_SNAPSHOT_STORAGE_KEY) ?? '';
    store.set(
      'https://example-bucket-1250000000.cos.ap-guangzhou.myqcloud.com/lifehub-backup.json.enc',
      legacySnapshotRaw,
    );
    window.localStorage.clear();
    calls.length = 0;

    // 1. 首次同步：本地有 10 月与 11 月账单，自动拉取合并旧版 9 月单文件，并生成 core + 09 + 10 + 11 四个分片及清单
    const octBill = makeBill({
      id: 'oct-1',
      localDate: '2026-10-15',
      occurredAt: '2026-10-15T09:00:00.000Z',
      counterparty: '十月超市',
      amountMinor: 5600,
    });
    const novBill1 = makeBill({
      id: 'nov-1',
      localDate: '2026-11-20',
      occurredAt: '2026-11-20T10:00:00.000Z',
      counterparty: '十一月午餐',
      amountMinor: 2800,
    });
    const sync1 = await syncUploadWithRemoteMerge(
      cosConfig,
      emptyDataset({ bills: [octBill, novBill1] }),
      'ShardPass#2026',
    );
    expect(sync1.mergedFromRemote).toBe(true);
    expect(sync1.mergedDataset.bills).toHaveLength(3);
    expect(sync1.totalShardCount).toBe(4); // core + 2026-09 + 2026-10 + 2026-11
    expect(sync1.uploadedShardCount).toBe(4);
    expect(sync1.skippedUnchangedUpload).toBe(false);

    // 2. 数据完全未变时再次同步：仅 GET 清单比对哈希，0 次下载分片、0 次 PUT 重传！
    calls.length = 0;
    const sync2 = await syncUploadWithRemoteMerge(
      cosConfig,
      sync1.mergedDataset,
      'ShardPass#2026',
    );
    expect(sync2.skippedUnchangedUpload).toBe(true);
    expect(sync2.uploadedShardCount).toBe(0);
    expect(sync2.downloadedShardCount).toBe(0);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect(calls.filter((c) => c.method === 'GET').map((c) => c.objectName)).toEqual([
      'lifehub-sync-manifest.json.enc',
    ]);

    // 3. 仅在 2026-11 新增一笔账单：9月、10月与 core 分片均不下载也不重传，仅 PUT 2026-11 分片与清单！
    calls.length = 0;
    const novBill2 = makeBill({
      id: 'nov-2',
      localDate: '2026-11-28',
      occurredAt: '2026-11-28T12:00:00.000Z',
      counterparty: '十一月晚餐新增',
      amountMinor: 4500,
    });
    const datasetWithNovAdd = emptyDataset({
      bills: [...sync1.mergedDataset.bills, novBill2],
    });
    const sync3 = await syncUploadWithRemoteMerge(
      cosConfig,
      datasetWithNovAdd,
      'ShardPass#2026',
    );
    expect(sync3.skippedUnchangedUpload).toBe(false);
    expect(sync3.uploadedShardCount).toBe(1);
    expect(sync3.downloadedShardCount).toBe(0);
    const putObjects = calls.filter((c) => c.method === 'PUT').map((c) => c.objectName);
    expect(putObjects).toEqual([
      'lifehub-shard-bills-2026-11.json.enc',
      'lifehub-sync-manifest.json.enc',
    ]);
    expect(putObjects).not.toContain('lifehub-shard-bills-2026-09.json.enc');
    expect(putObjects).not.toContain('lifehub-shard-bills-2026-10.json.enc');
    expect(putObjects).not.toContain('lifehub-shard-core.json.enc');

    // 4. 验证按日懒加载模式下（内存 bills 为空），syncCloudUploadSmart 与 syncCloudPullSmart 0 次全表读取即可秒级跳过或仅按月读取差异！
    calls.length = 0;
    const loadAllSpy = vi.fn(async () => sync3.mergedDataset.bills);
    const loadMonthSpy = vi.fn(async (month: string) =>
      sync3.mergedDataset.bills.filter((b) => b.localDate.slice(0, 7) === month),
    );
    const smartUploadNoop = await syncCloudUploadSmart(
      cosConfig,
      'ShardPass#2026',
      {},
      {
        getLocalBillCount: async () => sync3.mergedDataset.bills.length,
        loadMonthLocalBills: loadMonthSpy,
        loadAllLocalBills: loadAllSpy,
      },
    );
    expect(smartUploadNoop.skippedUnchangedUpload).toBe(true);
    expect(smartUploadNoop.billsToPut).toHaveLength(0);
    expect(loadAllSpy).not.toHaveBeenCalled();
    expect(loadMonthSpy).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);

    calls.length = 0;
    const smartPullNoop = await syncCloudPullSmart(
      cosConfig,
      'ShardPass#2026',
      {},
      {
        getLocalBillCount: async () => sync3.mergedDataset.bills.length,
        loadMonthLocalBills: loadMonthSpy,
        loadAllLocalBills: loadAllSpy,
      },
    );
    expect(smartPullNoop.unchanged).toBe(true);
    expect(smartPullNoop.downloadedShardCount).toBe(0);
    expect(smartPullNoop.billsToPut).toHaveLength(0);
    expect(loadAllSpy).not.toHaveBeenCalled();
    expect(calls).toEqual([{ method: 'GET', objectName: 'lifehub-sync-manifest.json.enc' }]);

    // 5. 验证新设备空库拉取恢复时实时回调进度，且落盘后提交 syncedShards，二次拉取立即进入 0 下载快路！
    window.localStorage.clear();
    calls.length = 0;
    const progressLogs: string[] = [];
    const firstDeviceRestore = await syncCloudPullSmart(
      cosConfig,
      'ShardPass#2026',
      {},
      {
        getLocalBillCount: async () => 0,
        loadMonthLocalBills: async () => [],
        loadAllLocalBills: async () => [],
      },
      { onProgress: (msg) => progressLogs.push(msg) },
    );
    expect(firstDeviceRestore.unchanged).toBe(false);
    expect(firstDeviceRestore.billsToPut).toHaveLength(4);
    expect(progressLogs.some((m) => m.includes('正在连接云端读取分片清单'))).toBe(true);
    expect(typeof firstDeviceRestore.commitSyncedStateAfterPersist).toBe('function');
    firstDeviceRestore.commitSyncedStateAfterPersist?.();

    calls.length = 0;
    const secondPullAfterRestore = await syncCloudPullSmart(
      cosConfig,
      'ShardPass#2026',
      {},
      {
        getLocalBillCount: async () => 4,
        loadMonthLocalBills: loadMonthSpy,
        loadAllLocalBills: loadAllSpy,
      },
    );
    expect(secondPullAfterRestore.unchanged).toBe(true);
    expect(secondPullAfterRestore.downloadedShardCount).toBe(0);
    expect(loadAllSpy).not.toHaveBeenCalled();
    expect(calls).toEqual([{ method: 'GET', objectName: 'lifehub-sync-manifest.json.enc' }]);
  });

  it('大规模账单备份压缩与解压保持毫秒级线性吞吐且 100% 无损，彻底消除 V8 大字符串扁平化卡死', () => {
    const manyBills = Array.from({ length: 3000 }, (_, idx) =>
      makeBill({
        id: `perf-bill-${String(idx).padStart(5, '0')}`,
        localDate: `2026-10-${String((idx % 28) + 1).padStart(2, '0')}`,
        occurredAt: `2026-10-${String((idx % 28) + 1).padStart(2, '0')}T08:30:00.000Z`,
        counterparty: `高频餐饮商户_${idx % 120} 🍜`,
        note: `工作餐支付明细 #${idx} ☕️`,
        amountMinor: 1500 + (idx % 9000),
      }),
    );
    const largeJson = JSON.stringify({
      format: 'lifehub-cloud-shard-bills-v1',
      month: '2026-10',
      bills: manyBills,
    });
    const t0 = performance.now();
    const compressed = compressBackupJson(largeJson);
    const t1 = performance.now();
    const restored = decompressBackupJson(compressed);
    const t2 = performance.now();

    expect(restored).toBe(largeJson);
    expect(t1 - t0).toBeLessThan(1500);
    expect(t2 - t1).toBeLessThan(500);
  });
});
