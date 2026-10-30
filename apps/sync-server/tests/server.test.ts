/**
 * 同步服务 HTTP 端点测试。
 *
 * 架构位置：apps/sync-server/tests —— 起真实实例 + `fetch` 打真实 HTTP。
 *
 * 覆盖的红线：
 * - 服务端只见密文：明文字段一律 400 且**绝不落盘**；
 * - 设备级授权：未授权 / 令牌错误一律 401；
 * - 幂等 upsert：同一 id 重复提交不产生重复记录；
 * - 增量拉取：只返回 `updatedAt` 晚于 `since` 的 blob。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildBlob,
  request,
  startTestServer,
  TEST_TOKEN,
  TEST_TOKEN_2,
  type TestServer,
} from './helpers.ts';

/** 每个用例前起实例、每个用例后关实例。 */
describe('同步服务 HTTP 端点', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  describe('健康检查', () => {
    it('GET /health 返回 ok 且不需要令牌', async () => {
      const response = await request(server.baseUrl, '/health', {}, null);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { ok: boolean; service: string };
      expect(body.ok).toBe(true);
      expect(body.service).toBe('lifehub-sync-server');
    });

    it('健康检查不泄露任何业务数据字段', async () => {
      const response = await request(server.baseUrl, '/health', {}, null);
      const body = (await response.json()) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(['ok', 'service', 'uptimeSeconds']);
    });
  });

  describe('设备级授权', () => {
    it('缺少 Authorization 头返回 401', async () => {
      const response = await request(
        server.baseUrl,
        '/v1/blobs',
        { method: 'POST', body: JSON.stringify(buildBlob()) },
        null,
      );
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Bearer');
    });

    it('令牌错误返回 401', async () => {
      const response = await request(
        server.baseUrl,
        '/v1/blobs',
        { method: 'POST', body: JSON.stringify(buildBlob()) },
        'wrong-token',
      );
      expect(response.status).toBe(401);
    });

    it('授权失败时数据不落盘', async () => {
      await request(
        server.baseUrl,
        '/v1/blobs',
        { method: 'POST', body: JSON.stringify(buildBlob()) },
        'wrong-token',
      );
      expect(server.store.count()).toBe(0);
    });

    it('第二个设备的令牌同样可以访问', async () => {
      const response = await request(
        server.baseUrl,
        '/v1/blobs',
        { method: 'POST', body: JSON.stringify(buildBlob()) },
        TEST_TOKEN_2,
      );
      expect(response.status).toBe(200);
    });
  });

  describe('POST /v1/blobs 幂等 upsert', () => {
    it('首次提交创建记录', async () => {
      const response = await request(server.baseUrl, '/v1/blobs', {
        method: 'POST',
        body: JSON.stringify(buildBlob()),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { id: string; status: string };
      expect(body.id).toBe('b1');
      expect(body.status).toBe('created');
      expect(server.store.count()).toBe(1);
    });

    it('同一 id 重复提交不产生重复记录', async () => {
      const payload = JSON.stringify(buildBlob());
      await request(server.baseUrl, '/v1/blobs', { method: 'POST', body: payload });
      const second = await request(server.baseUrl, '/v1/blobs', { method: 'POST', body: payload });

      expect(second.status).toBe(200);
      const body = (await second.json()) as { status: string };
      expect(body.status).toBe('unchanged');
      expect(server.store.count()).toBe(1);
    });

    it('更高版本覆盖旧记录', async () => {
      await request(server.baseUrl, '/v1/blobs', {
        method: 'POST',
        body: JSON.stringify(buildBlob({ ciphertext: 'b2xk' })),
      });
      const response = await request(server.baseUrl, '/v1/blobs', {
        method: 'POST',
        body: JSON.stringify(
          buildBlob({ ciphertext: 'bmV3', version: 2, updatedAt: '2026-02-01T00:00:00.000Z' }),
        ),
      });
      const body = (await response.json()) as { status: string };
      expect(body.status).toBe('updated');
      expect(server.store.count()).toBe(1);
      expect(server.store.get('b1')?.ciphertext).toBe('bmV3');
    });

    it('更旧的版本不会回滚较新的密文', async () => {
      await request(server.baseUrl, '/v1/blobs', {
        method: 'POST',
        body: JSON.stringify(buildBlob({ ciphertext: 'bmV3', version: 5 })),
      });
      const response = await request(server.baseUrl, '/v1/blobs', {
        method: 'POST',
        body: JSON.stringify(buildBlob({ ciphertext: 'b2xk', version: 1 })),
      });
      const body = (await response.json()) as { status: string };
      expect(body.status).toBe('stale');
      expect(server.store.get('b1')?.ciphertext).toBe('bmV3');
    });
  });

  describe('服务端只见密文（明文字段一律拒绝）', () => {
    const forbiddenCases: Array<[string, Record<string, unknown>]> = [
      ['amount', { amount: 100 }],
      ['amountMinor', { amountMinor: 10000 }],
      ['counterparty', { counterparty: '星巴克' }],
      ['note', { note: 'LIFEHUB-SAMPLE-NOTE' }],
      ['title', { title: '午饭' }],
      ['body', { body: '正文' }],
      ['salt', { salt: 'c2FsdA==' }],
      ['dek', { dek: 'ZGVr' }],
      ['masterKey', { masterKey: 'bWFzdGVy' }],
      ['recoveryCode', { recoveryCode: 'ABCDEF-GHIJKL' }],
    ];

    for (const [field, extra] of forbiddenCases) {
      it(`含明文字段 ${field} 的请求返回 400`, async () => {
        const response = await request(server.baseUrl, '/v1/blobs', {
          method: 'POST',
          body: JSON.stringify(buildBlob({ id: `bad-${field}`, ...extra })),
        });
        expect(response.status).toBe(400);
        const body = (await response.json()) as { error: string };
        expect(body.error).toContain('拒绝明文字段');
        expect(body.error).toContain(field);
      });
    }

    it('明文字段被拒绝时绝不落盘', async () => {
      await request(server.baseUrl, '/v1/blobs', {
        method: 'POST',
        body: JSON.stringify(buildBlob({ id: 'bad-1', amount: 100 })),
      });
      expect(server.store.count()).toBe(0);
      expect(server.store.get('bad-1')).toBeNull();
    });

    it('嵌套在子对象里的明文字段同样被拒绝', async () => {
      const response = await request(server.baseUrl, '/v1/blobs', {
        method: 'POST',
        body: JSON.stringify(buildBlob({ id: 'bad-nested', meta: { amount: 100 } })),
      });
      expect(response.status).toBe(400);
      expect(server.store.count()).toBe(0);
    });

    it('出现白名单之外的字段返回 400', async () => {
      const response = await request(server.baseUrl, '/v1/blobs', {
        method: 'POST',
        body: JSON.stringify(buildBlob({ id: 'bad-extra', unexpectedField: 'x' })),
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain('未允许的字段');
    });

    it('缺少必填字段返回 400', async () => {
      const incomplete = buildBlob();
      delete incomplete['ciphertext'];
      const response = await request(server.baseUrl, '/v1/blobs', {
        method: 'POST',
        body: JSON.stringify(incomplete),
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain('缺少必填字段');
    });

    it('请求体不是合法 JSON 返回 400', async () => {
      const response = await request(server.baseUrl, '/v1/blobs', {
        method: 'POST',
        body: '{ not json',
      });
      expect(response.status).toBe(400);
    });
  });

  describe('GET /v1/blobs 增量拉取', () => {
    it('只返回 updatedAt 晚于 since 的 blob', async () => {
      await request(server.baseUrl, '/v1/blobs', {
        method: 'POST',
        body: JSON.stringify(buildBlob({ id: 'old', updatedAt: '2026-01-01T00:00:00.000Z' })),
      });
      await request(server.baseUrl, '/v1/blobs', {
        method: 'POST',
        body: JSON.stringify(buildBlob({ id: 'new', updatedAt: '2026-06-01T00:00:00.000Z' })),
      });

      const response = await request(server.baseUrl, '/v1/blobs?since=2026-03-01T00:00:00.000Z');
      expect(response.status).toBe(200);
      const body = (await response.json()) as { blobs: Array<{ id: string }>; count: number };
      expect(body.count).toBe(1);
      expect(body.blobs[0]?.id).toBe('new');
    });

    it('不传 since 时返回全部 blob', async () => {
      await request(server.baseUrl, '/v1/blobs', {
        method: 'POST',
        body: JSON.stringify(buildBlob({ id: 'a' })),
      });
      await request(server.baseUrl, '/v1/blobs', {
        method: 'POST',
        body: JSON.stringify(buildBlob({ id: 'b' })),
      });
      const response = await request(server.baseUrl, '/v1/blobs');
      const body = (await response.json()) as { count: number };
      expect(body.count).toBe(2);
    });

    it('limit 生效', async () => {
      for (const id of ['a', 'b', 'c']) {
        await request(server.baseUrl, '/v1/blobs', {
          method: 'POST',
          body: JSON.stringify(buildBlob({ id })),
        });
      }
      const response = await request(server.baseUrl, '/v1/blobs?limit=2');
      const body = (await response.json()) as { count: number };
      expect(body.count).toBe(2);
    });

    it('返回的 blob 只含密文与元信息，没有任何明文字段', async () => {
      await request(server.baseUrl, '/v1/blobs', {
        method: 'POST',
        body: JSON.stringify(buildBlob()),
      });
      const response = await request(server.baseUrl, '/v1/blobs');
      const body = (await response.json()) as { blobs: Array<Record<string, unknown>> };
      expect(Object.keys(body.blobs[0] ?? {}).sort()).toEqual([
        'algorithm',
        'ciphertext',
        'entityId',
        'entityType',
        'id',
        'iv',
        'keyVersion',
        'tag',
        'updatedAt',
        'version',
      ]);
    });

    it('返回 nextSince 游标供下次增量使用', async () => {
      await request(server.baseUrl, '/v1/blobs', {
        method: 'POST',
        body: JSON.stringify(buildBlob({ id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' })),
      });
      const response = await request(server.baseUrl, '/v1/blobs');
      const body = (await response.json()) as {
        nextSince: string | null;
        nextSinceId: string | null;
      };
      expect(body.nextSince).toBe('2026-01-01T00:00:00.000Z');
      expect(body.nextSinceId).toBe('a');
    });
  });

  describe('GET /v1/blobs/:id 单条查询', () => {
    it('存在时返回该 blob', async () => {
      await request(server.baseUrl, '/v1/blobs', {
        method: 'POST',
        body: JSON.stringify(buildBlob()),
      });
      const response = await request(server.baseUrl, '/v1/blobs/b1');
      expect(response.status).toBe(200);
      const body = (await response.json()) as { id: string; ciphertext: string };
      expect(body.id).toBe('b1');
      expect(body.ciphertext).toBe('Y2lwaGVydGV4dA==');
    });

    it('不存在时返回 404', async () => {
      const response = await request(server.baseUrl, '/v1/blobs/nope');
      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /v1/blobs/:id 删除', () => {
    it('删除已存在的 blob', async () => {
      await request(server.baseUrl, '/v1/blobs', {
        method: 'POST',
        body: JSON.stringify(buildBlob()),
      });
      const response = await request(server.baseUrl, '/v1/blobs/b1', { method: 'DELETE' });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { deleted: boolean };
      expect(body.deleted).toBe(true);
      expect(server.store.count()).toBe(0);
    });

    it('删除不存在的 blob 返回 404', async () => {
      const response = await request(server.baseUrl, '/v1/blobs/nope', { method: 'DELETE' });
      expect(response.status).toBe(404);
    });
  });

  describe('其他', () => {
    it('未知路径返回 404', async () => {
      const response = await request(server.baseUrl, '/v1/unknown');
      expect(response.status).toBe(404);
    });

    it('数据库中只有 encrypted_blob 一张表，且没有任何明文列', () => {
      const tables = server.store.listTableNames();
      expect(tables).toEqual(['encrypted_blob']);
      expect(server.store.listColumnNames()).toEqual([
        'id',
        'entity_type',
        'entity_id',
        'ciphertext',
        'iv',
        'tag',
        'algorithm',
        'key_version',
        'updated_at',
        'version',
      ]);
    });
  });
});
