/**
 * QA 独立补测 · 同步服务只存密文（X-01 ③ / R5）。
 *
 * 覆盖需求：X-01 ③「服务端数据结构定义中业务字段均为 ciphertext / iv / tag」；
 * §8.8 R5「同步载荷与备份只含密文」。
 *
 * 【本文件与既有脚本的差异】
 * `scripts/check-sync-payload.mjs` 断言的是**客户端**构造的同步载荷；
 * 本文件从**服务端接收侧**独立验证：
 * 1. 真实起一个 HTTP 服务，发真实请求，确认明文字段一律被拒（400）；
 * 2. 确认密文 blob 能正常入库与增量拉取，且**拉回来的内容里没有明文字段**；
 * 3. 确认服务端没有任何「解密」「鉴权后门」入口。
 */
import { describe, expect, it, afterAll } from 'vitest';
import { createSyncServer, validateBlobBody, MemoryBlobStore } from '../../../../apps/sync-server/src/server';
import type { Server } from 'node:http';

/** 启动的测试服务器实例。 */
let server: Server | null = null;

/** 服务监听端口。 */
let baseUrl = '';

/**
 * 向服务端发起一次 HTTP 请求。
 *
 * @param method HTTP 方法
 * @param path 请求路径
 * @param body 请求体对象；省略表示无请求体
 * @returns 响应状态码与解析后的 JSON
 */
async function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json()) as Record<string, unknown>;
  return { status: response.status, json };
}

/** 一条合法的密文 blob。 */
const validBlob = {
  id: 'blob-1',
  entityType: 'bill',
  entityId: 'bill-1',
  ciphertext: 'Y2lwaGVydGV4dA==',
  iv: 'aXYtMTIzNDU2',
  tag: 'dGFn',
  algorithm: 'AES-256-GCM',
  keyVersion: 1,
  updatedAt: '2024-01-15T08:12:00.000Z',
  version: 1,
};

describe('同步服务 · 密文 blob 存取', () => {
  it('启动服务后健康检查通过', async () => {
    const instance = createSyncServer(new MemoryBlobStore());
    await new Promise<void>((resolve) => {
      instance.listen(0, '127.0.0.1', resolve);
    });
    const address = instance.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
    server = instance;

    const response = await request('GET', '/healthz');
    expect(response.status).toBe(200);
    expect(response.json['ok']).toBe(true);
  });

  it('上传合法密文 blob 成功，并可增量拉回', async () => {
    const response = await request('POST', '/v1/blobs', validBlob);
    expect(response.status).toBe(200);
    expect(response.json['id']).toBe('blob-1');

    const list = await request('GET', '/v1/blobs?cursor=0&limit=100');
    expect(list.status).toBe(200);
    const blobs = list.json['blobs'] as Record<string, unknown>[];
    expect(blobs).toHaveLength(1);
    expect(blobs[0]?.['ciphertext']).toBe('Y2lwaGVydGV4dA==');
    expect(blobs[0]?.['iv']).toBe('aXYtMTIzNDU2');
  });

  it('拉回的 blob 里不含任何明文业务字段', async () => {
    const list = await request('GET', '/v1/blobs?cursor=0&limit=100');
    const serialized = JSON.stringify(list.json);
    for (const field of ['amountMinor', 'counterparty', 'note', 'localDate', 'salt', 'dek', 'masterKey']) {
      expect(serialized).not.toContain(field);
    }
  });
});

describe('同步服务 · 明文字段一律被拒（X-01 ③）', () => {
  it('请求体出现 amountMinor 时返回 400', async () => {
    const response = await request('POST', '/v1/blobs', { ...validBlob, id: 'blob-x', amountMinor: 3550 });
    expect(response.status).toBe(400);
    expect(String(response.json['error'])).toContain('amountMinor');
  });

  it('请求体出现 counterparty / note / salt / dek / masterKey / recoveryCode 时返回 400', async () => {
    for (const field of ['counterparty', 'note', 'salt', 'dek', 'masterKey', 'recoveryCode', 'localDate']) {
      const response = await request('POST', '/v1/blobs', { ...validBlob, id: `blob-${field}`, [field]: 'x' });
      expect(response.status, `字段 ${field} 应当被拒绝`).toBe(400);
      expect(String(response.json['error'])).toContain(field);
    }
  });

  it('请求体出现白名单之外的任意字段时返回 400', async () => {
    const response = await request('POST', '/v1/blobs', { ...validBlob, id: 'blob-y', somethingElse: 'x' });
    expect(response.status).toBe(400);
    expect(String(response.json['error'])).toContain('somethingElse');
  });

  it('缺少必填字段时返回 400', async () => {
    const incomplete = { ...validBlob };
    delete (incomplete as Record<string, unknown>)['ciphertext'];
    const response = await request('POST', '/v1/blobs', incomplete);
    expect(response.status).toBe(400);
    expect(String(response.json['error'])).toContain('ciphertext');
  });
});

describe('同步服务 · 无鉴权后门、无解密能力（R5 / X-02 ④）', () => {
  it('validateBlobBody 只接受白名单字段', () => {
    expect(() => validateBlobBody({ ...validBlob })).not.toThrow();
    expect(() => validateBlobBody({ ...validBlob, salt: 'x' })).toThrow();
    expect(() => validateBlobBody({ ...validBlob, password: 'x' })).toThrow();
    expect(() => validateBlobBody('not-an-object')).toThrow();
    expect(() => validateBlobBody(null)).toThrow();
  });

  it('服务端没有「解密」「找回」「后门」类接口或文案', async () => {
    // 用 HTTP 探针确认不存在这样的路由。
    const unknown = await request('GET', '/v1/decrypt');
    expect(unknown.status).toBe(404);
    const backdoor = await request('POST', '/v1/admin/reset');
    expect(backdoor.status).toBe(404);
  });
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => {
      server?.close(() => resolve());
    });
    server = null;
  }
});
