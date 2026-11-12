/**
 * 同步服务测试夹具。
 *
 * 架构位置：apps/sync-server/tests —— 起真实 HTTP 实例 + `fetch` 客户端。
 *
 * 说明：
 * - 数据库用 `:memory:`，**不落盘**，测试之间互不干扰；
 * - 端口用 `0` 让操作系统分配空闲端口，避免并发跑测试时端口冲突；
 * - 令牌在测试里明文给出是**故意的**：它验证的是「令牌从外部注入」这条路径，
 *   生产环境令牌只来自环境变量（见 `config.ts`）。
 */
import type { AddressInfo } from 'node:net';
import { DeviceAuthorizer } from '../src/auth.ts';
import type { SyncServerConfig } from '../src/config.ts';
import { createSyncServer } from '../src/server.ts';
import { SqliteBlobStore } from '../src/store.ts';

/** 测试用设备令牌。 */
export const TEST_TOKEN = 'test-device-token-0123456789';

/** 测试用第二个设备令牌（用于验证多设备授权）。 */
export const TEST_TOKEN_2 = 'test-device-token-9876543210';

/** 一个已经起好的同步服务实例。 */
export interface TestServer {
  /** 服务基地址（含协议与端口）。 */
  baseUrl: string;
  /** 底层存储，供断言库内真实内容。 */
  store: SqliteBlobStore;
  /** 关闭服务并释放资源。 */
  close: () => Promise<void>;
}

/**
 * 构造一份测试用配置。
 *
 * @returns 测试用运行时配置
 */
function createTestConfig(): SyncServerConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    databasePath: ':memory:',
    credentials: [
      { deviceId: 'device-a', secret: TEST_TOKEN },
      { deviceId: 'device-b', secret: TEST_TOKEN_2 },
    ],
    defaultPageSize: 100,
    maxPageSize: 500,
    maxBodyBytes: 1024 * 1024,
    corsOrigin: '',
  };
}

/** WhatWG Fetch 规范禁止访问的高手位端口（如 10080 / 6000 / 6665-6669 / 6697），若 OS 随机分配命中则重新绑定。 */
const FETCH_BAD_PORTS = new Set([6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080]);

/**
 * 起一个临时的同步服务实例。
 *
 * @returns 实例句柄（含基地址与关闭方法）
 */
export async function startTestServer(): Promise<TestServer> {
  const config = createTestConfig();
  const store = new SqliteBlobStore(':memory:');
  const authorizer = new DeviceAuthorizer(config.credentials);
  let server = createSyncServer({ store, authorizer, config });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  let address = server.address() as AddressInfo;
  while (FETCH_BAD_PORTS.has(address.port)) {
    const prev = server;
    server = createSyncServer({ store, authorizer, config });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    await new Promise<void>((resolve) => {
      prev.close(() => resolve());
    });
    address = server.address() as AddressInfo;
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    store,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
      store.close();
    },
  };
}

/**
 * 构造一条合法的密文 blob 请求体。
 *
 * @param overrides 需要覆盖的字段
 * @returns 请求体对象
 */
export function buildBlob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'b1',
    entityType: 'bill',
    entityId: 'e1',
    ciphertext: 'Y2lwaGVydGV4dA==',
    iv: 'aXYxMjM0NTY3ODkw',
    tag: 'dGFnMTIzNDU2Nzg5MA==',
    algorithm: 'AES-256-GCM',
    keyVersion: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

/**
 * 发起一次带设备令牌的请求。
 *
 * @param baseUrl 服务基地址
 * @param path 请求路径
 * @param init fetch 初始化参数
 * @param token 设备令牌；传 null 表示不带 Authorization 头
 * @returns fetch 响应
 */
export function request(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
  token: string | null = TEST_TOKEN,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (token !== null) {
    headers.set('authorization', `Bearer ${token}`);
  }
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
