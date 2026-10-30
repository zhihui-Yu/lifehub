/**
 * 密文 blob 的 SQLite 持久化层。
 *
 * 架构位置：apps/sync-server —— 存储层，使用 Node 22 内置的 `node:sqlite`。
 *
 * 红线（X-01 ④ / R5）：
 * - 库里**只有一张表** `encrypted_blob`，字段与 `EncryptedBlob` 严格一一对应；
 * - 表中**没有任何业务明文列**（无金额、无方向、无对方、无备注、无索引明文列）；
 * - 服务端**没有密钥**，因此即使整个数据库文件泄露，也还原不出任何业务内容。
 *
 * 为什么用 `node:sqlite` 而不是 `better-sqlite3`：
 * - 零 npm 依赖（同步服务不引入任何第三方运行时依赖）；
 * - Node 22.5+ 内置，升级由 Node 官方负责，无原生模块编译链。
 */
import { DatabaseSync } from 'node:sqlite';

/** 服务端存储的一条密文 blob（与 `EncryptedBlob` 字段一一对应）。 */
export interface StoredBlob {
  /** blob id（全局唯一，主键）。 */
  id: string;
  /** 实体类型（如 `bill`）。 */
  entityType: string;
  /** 实体 id。 */
  entityId: string;
  /** 密文正文（base64）。 */
  ciphertext: string;
  /** 随机 IV（base64）。 */
  iv: string;
  /** GCM 认证标签（base64）。 */
  tag: string;
  /** 加密算法标识。 */
  algorithm: string;
  /** 密钥版本。 */
  keyVersion: number;
  /** 最后更新时间，ISO 8601 UTC（已归一化为定宽格式）。 */
  updatedAt: string;
  /** 版本号（单调递增）。 */
  version: number;
}

/** upsert 的结果状态。 */
export type UpsertStatus =
  /** 新记录插入成功。 */
  | 'created'
  /** 已有记录被新版本覆盖。 */
  | 'updated'
  /** 提交内容与库中完全一致（幂等重放）。 */
  | 'unchanged'
  /** 提交的版本比库中更旧，被忽略（不覆盖较新的密文）。 */
  | 'stale';

/** upsert 结果。 */
export interface UpsertResult {
  /** 本次写入的状态。 */
  status: UpsertStatus;
  /** 库中最终生效的 blob。 */
  blob: StoredBlob;
}

/** 增量拉取的结果。 */
export interface ListResult {
  /** 命中的 blob 列表（按 `updatedAt` 升序，同一时刻再按 `id` 升序）。 */
  blobs: StoredBlob[];
  /** 下一页游标时间（无数据时为 null）。 */
  nextSince: string | null;
  /** 下一页游标 id（无数据时为 null）。 */
  nextSinceId: string | null;
}

/** 建表语句：库里**只有** `encrypted_blob` 一张表。 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS encrypted_blob (
  id            TEXT    PRIMARY KEY,
  entity_type   TEXT    NOT NULL,
  entity_id     TEXT    NOT NULL,
  ciphertext    TEXT    NOT NULL,
  iv            TEXT    NOT NULL,
  tag           TEXT    NOT NULL,
  algorithm     TEXT    NOT NULL,
  key_version   INTEGER NOT NULL,
  updated_at    TEXT    NOT NULL,
  version       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_encrypted_blob_updated_at ON encrypted_blob (updated_at, id);
`;

/**
 * 把数据库行映射成 `StoredBlob`。
 *
 * @param row 数据库返回的行
 * @returns 映射后的 blob
 */
function toStoredBlob(row: Record<string, unknown>): StoredBlob {
  return {
    id: String(row['id']),
    entityType: String(row['entity_type']),
    entityId: String(row['entity_id']),
    ciphertext: String(row['ciphertext']),
    iv: String(row['iv']),
    tag: String(row['tag']),
    algorithm: String(row['algorithm']),
    keyVersion: Number(row['key_version']),
    updatedAt: String(row['updated_at']),
    version: Number(row['version']),
  };
}

/**
 * SQLite 密文 blob 存储。
 *
 * 说明：本类**只**负责持久化，不含任何业务语义；
 * 写入的都是客户端送来的密文字节，服务端既不解密也不改写密文。
 */
export class SqliteBlobStore {
  /** 底层数据库句柄。 */
  private readonly db: DatabaseSync;

  /**
   * 打开（或创建）数据库并建表。
   *
   * @param databasePath SQLite 文件路径；`:memory:` 表示内存库（测试用）
   */
  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    // WAL 提升读写并发；busy_timeout 避免并发写入时立刻抛 SQLITE_BUSY。
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec(SCHEMA_SQL);
  }

  /**
   * 幂等 upsert 一条密文 blob。
   *
   * 说明：
   * - `id` 是主键，**同一 id 重复提交不会产生重复记录**（X-12 幂等要求）；
   * - 版本号更高才允许覆盖；版本更低视为陈旧写入并忽略，
   *   避免离线设备把新密文回滚成旧密文；
   * - 版本号相同且内容一致时返回 `unchanged`，让客户端的重试是安全的。
   *
   * @param blob 待写入的密文 blob
   * @returns 写入状态与最终生效的 blob
   */
  upsert(blob: Omit<StoredBlob, never>): UpsertResult {
    const existing = this.db.prepare('SELECT * FROM encrypted_blob WHERE id = ?').get(blob.id) as
      Record<string, unknown> | undefined;

    if (existing === undefined) {
      this.db
        .prepare(
          `INSERT INTO encrypted_blob
             (id, entity_type, entity_id, ciphertext, iv, tag, algorithm, key_version, updated_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          blob.id,
          blob.entityType,
          blob.entityId,
          blob.ciphertext,
          blob.iv,
          blob.tag,
          blob.algorithm,
          blob.keyVersion,
          blob.updatedAt,
          blob.version,
        );
      return { status: 'created', blob };
    }

    const current = toStoredBlob(existing);
    if (blob.version < current.version) {
      // 陈旧写入：保留库中较新的密文。
      return { status: 'stale', blob: current };
    }

    const sameContent =
      current.ciphertext === blob.ciphertext &&
      current.iv === blob.iv &&
      current.tag === blob.tag &&
      current.algorithm === blob.algorithm &&
      current.keyVersion === blob.keyVersion &&
      current.entityType === blob.entityType &&
      current.entityId === blob.entityId &&
      current.updatedAt === blob.updatedAt;
    if (sameContent) {
      return { status: 'unchanged', blob: current };
    }

    this.db
      .prepare(
        `UPDATE encrypted_blob
            SET entity_type = ?, entity_id = ?, ciphertext = ?, iv = ?, tag = ?,
                algorithm = ?, key_version = ?, updated_at = ?, version = ?
          WHERE id = ?`,
      )
      .run(
        blob.entityType,
        blob.entityId,
        blob.ciphertext,
        blob.iv,
        blob.tag,
        blob.algorithm,
        blob.keyVersion,
        blob.updatedAt,
        blob.version,
        blob.id,
      );
    return { status: 'updated', blob: { ...blob } };
  }

  /**
   * 按 `since` 增量拉取密文 blob。
   *
   * 说明：默认只返回 `updatedAt` **晚于** `since` 的 blob；
   * 传入 `sinceId` 时，同一时刻的记录再按 `id` 继续向后取，
   * 从而避免「同一毫秒的多条记录被整批跳过」的漏拉问题。
   *
   * @param since 增量起点时间（ISO 8601 UTC，已归一化）
   * @param sinceId 同一时刻的续传 id；不传则只按时间比较
   * @param limit 最多返回条数
   * @returns 命中的 blob 与下一页游标
   */
  listSince(since: string, sinceId: string | null, limit: number): ListResult {
    const rows =
      sinceId === null
        ? (this.db
            .prepare(
              `SELECT * FROM encrypted_blob
                WHERE updated_at > ?
                ORDER BY updated_at ASC, id ASC
                LIMIT ?`,
            )
            .all(since, limit) as Record<string, unknown>[])
        : (this.db
            .prepare(
              `SELECT * FROM encrypted_blob
                WHERE updated_at > ? OR (updated_at = ? AND id > ?)
                ORDER BY updated_at ASC, id ASC
                LIMIT ?`,
            )
            .all(since, since, sinceId, limit) as Record<string, unknown>[]);

    const blobs = rows.map(toStoredBlob);
    const last = blobs.length > 0 ? blobs[blobs.length - 1] : undefined;
    return {
      blobs,
      nextSince: last?.updatedAt ?? null,
      nextSinceId: last?.id ?? null,
    };
  }

  /**
   * 按 id 查询单条密文 blob。
   *
   * @param id blob id
   * @returns 命中的 blob；不存在时返回 null
   */
  get(id: string): StoredBlob | null {
    const row = this.db.prepare('SELECT * FROM encrypted_blob WHERE id = ?').get(id) as
      Record<string, unknown> | undefined;
    return row === undefined ? null : toStoredBlob(row);
  }

  /**
   * 按 id 删除一条密文 blob。
   *
   * @param id blob id
   * @returns 是否真的删除了记录
   */
  remove(id: string): boolean {
    const result = this.db.prepare('DELETE FROM encrypted_blob WHERE id = ?').run(id);
    return Number(result.changes) > 0;
  }

  /**
   * 统计库中密文 blob 的条数。
   *
   * @returns blob 总数
   */
  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS total FROM encrypted_blob').get() as
      Record<string, unknown> | undefined;
    return Number(row?.['total'] ?? 0);
  }

  /**
   * 列出库中的所有表名。
   *
   * 说明：用于测试断言「库里**只有** `encrypted_blob` 一张表」这条红线。
   *
   * @returns 表名列表（不含索引与视图）
   */
  listTableNames(): string[] {
    const rows = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Record<string, unknown>[];
    return rows.map((row) => String(row['name']));
  }

  /**
   * 列出 `encrypted_blob` 表的列名。
   *
   * 说明：用于测试断言「表里没有任何业务明文列」这条红线。
   *
   * @returns 列名列表（按建表顺序）
   */
  listColumnNames(): string[] {
    const rows = this.db.prepare('PRAGMA table_info(encrypted_blob)').all() as Record<
      string,
      unknown
    >[];
    return rows.map((row) => String(row['name']));
  }

  /**
   * 关闭数据库连接。
   *
   * @returns 无异常
   */
  close(): void {
    this.db.close();
  }
}
