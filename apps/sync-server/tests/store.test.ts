/**
 * SQLite 存储层测试。
 *
 * 架构位置：apps/sync-server/tests —— 直接测 `SqliteBlobStore`，不起 HTTP。
 *
 * 覆盖：幂等 upsert、版本仲裁、增量拉取游标、删除、表结构红线。
 */
import { describe, expect, it } from 'vitest';
import { SqliteBlobStore, type StoredBlob } from '../src/store.ts';

/**
 * 构造一条测试用的密文 blob。
 *
 * @param overrides 需要覆盖的字段
 * @returns blob 对象
 */
function makeBlob(overrides: Partial<StoredBlob> = {}): StoredBlob {
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

describe('SqliteBlobStore', () => {
  describe('幂等 upsert', () => {
    it('首次写入返回 created', () => {
      const store = new SqliteBlobStore(':memory:');
      expect(store.upsert(makeBlob()).status).toBe('created');
      store.close();
    });

    it('同一 id 重复写入不产生重复记录', () => {
      const store = new SqliteBlobStore(':memory:');
      store.upsert(makeBlob());
      store.upsert(makeBlob());
      store.upsert(makeBlob());
      expect(store.count()).toBe(1);
      store.close();
    });

    it('内容完全一致时返回 unchanged', () => {
      const store = new SqliteBlobStore(':memory:');
      store.upsert(makeBlob());
      expect(store.upsert(makeBlob()).status).toBe('unchanged');
      store.close();
    });

    it('更高版本覆盖旧密文', () => {
      const store = new SqliteBlobStore(':memory:');
      store.upsert(makeBlob());
      const result = store.upsert(makeBlob({ ciphertext: 'bmV3', version: 2 }));
      expect(result.status).toBe('updated');
      expect(store.get('b1')?.ciphertext).toBe('bmV3');
      expect(store.count()).toBe(1);
      store.close();
    });

    it('更低版本被忽略，不回滚较新的密文', () => {
      const store = new SqliteBlobStore(':memory:');
      store.upsert(makeBlob({ ciphertext: 'bmV3', version: 9 }));
      const result = store.upsert(makeBlob({ ciphertext: 'b2xk', version: 2 }));
      expect(result.status).toBe('stale');
      expect(store.get('b1')?.ciphertext).toBe('bmV3');
      store.close();
    });
  });

  describe('增量拉取', () => {
    it('只返回 updatedAt 晚于 since 的记录', () => {
      const store = new SqliteBlobStore(':memory:');
      store.upsert(makeBlob({ id: 'old', updatedAt: '2026-01-01T00:00:00.000Z' }));
      store.upsert(makeBlob({ id: 'new', updatedAt: '2026-06-01T00:00:00.000Z' }));

      const result = store.listSince('2026-03-01T00:00:00.000Z', null, 100);
      expect(result.blobs).toHaveLength(1);
      expect(result.blobs[0]?.id).toBe('new');
      store.close();
    });

    it('since 之后没有记录时返回空数组', () => {
      const store = new SqliteBlobStore(':memory:');
      store.upsert(makeBlob({ updatedAt: '2026-01-01T00:00:00.000Z' }));
      const result = store.listSince('2027-01-01T00:00:00.000Z', null, 100);
      expect(result.blobs).toHaveLength(0);
      expect(result.nextSince).toBeNull();
      store.close();
    });

    it('结果按 updatedAt 升序', () => {
      const store = new SqliteBlobStore(':memory:');
      store.upsert(makeBlob({ id: 'c', updatedAt: '2026-03-01T00:00:00.000Z' }));
      store.upsert(makeBlob({ id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' }));
      store.upsert(makeBlob({ id: 'b', updatedAt: '2026-02-01T00:00:00.000Z' }));

      const result = store.listSince('2025-01-01T00:00:00.000Z', null, 100);
      expect(result.blobs.map((blob) => blob.id)).toEqual(['a', 'b', 'c']);
      store.close();
    });

    it('limit 生效', () => {
      const store = new SqliteBlobStore(':memory:');
      for (const id of ['a', 'b', 'c']) {
        store.upsert(makeBlob({ id }));
      }
      expect(store.listSince('2025-01-01T00:00:00.000Z', null, 2).blobs).toHaveLength(2);
      store.close();
    });

    it('sinceId 可以在同一时刻内继续向后取，避免漏拉', () => {
      const store = new SqliteBlobStore(':memory:');
      const sameMoment = '2026-01-01T00:00:00.000Z';
      store.upsert(makeBlob({ id: 'a', updatedAt: sameMoment }));
      store.upsert(makeBlob({ id: 'b', updatedAt: sameMoment }));

      const firstPage = store.listSince('2025-01-01T00:00:00.000Z', null, 1);
      expect(firstPage.blobs.map((blob) => blob.id)).toEqual(['a']);

      const secondPage = store.listSince(firstPage.nextSince ?? '', firstPage.nextSinceId, 1);
      expect(secondPage.blobs.map((blob) => blob.id)).toEqual(['b']);
      store.close();
    });
  });

  describe('查询与删除', () => {
    it('get 命中返回 blob，不存在返回 null', () => {
      const store = new SqliteBlobStore(':memory:');
      store.upsert(makeBlob());
      expect(store.get('b1')?.id).toBe('b1');
      expect(store.get('missing')).toBeNull();
      store.close();
    });

    it('remove 返回是否真的删除', () => {
      const store = new SqliteBlobStore(':memory:');
      store.upsert(makeBlob());
      expect(store.remove('b1')).toBe(true);
      expect(store.remove('b1')).toBe(false);
      expect(store.count()).toBe(0);
      store.close();
    });
  });

  describe('表结构红线', () => {
    it('库里只有 encrypted_blob 一张表', () => {
      const store = new SqliteBlobStore(':memory:');
      expect(store.listTableNames()).toEqual(['encrypted_blob']);
      store.close();
    });

    it('encrypted_blob 的列与 EncryptedBlob 严格一一对应，无任何明文列', () => {
      const store = new SqliteBlobStore(':memory:');
      expect(store.listColumnNames()).toEqual([
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
      store.close();
    });

    it('列名中不含任何业务明文字段名', () => {
      const store = new SqliteBlobStore(':memory:');
      const columns = store.listColumnNames();
      for (const forbidden of [
        'amount',
        'amount_minor',
        'counterparty',
        'note',
        'local_date',
        'salt',
        'dek',
      ]) {
        expect(columns).not.toContain(forbidden);
      }
      store.close();
    });
  });
});
