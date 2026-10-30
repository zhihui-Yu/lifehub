/**
 * 同步载荷构造与明文断言。
 *
 * 架构位置：core 包的「同步」模块，服务于 X-01 ④ / R5。
 *
 * 红线：同步载荷**只接受** `EncryptedBlob[]`，
 * 其中每个 blob 只能包含 `ciphertext / iv / tag / algorithm / keyVersion / updatedAt / version`，
 * **不得携带**索引明文列（`localDate` / `occurredAt` 等）或任何业务语义字段。
 */
import { LifeHubError } from '../../errors';
import type { EncryptedBlob, SyncPayload } from '../../models/encrypted-blob';
import { validateEncryptedBlob } from '../../models/encrypted-blob';

/** 同步载荷中允许出现的 blob 字段白名单。 */
export const SYNC_BLOB_ALLOWED_FIELDS: readonly string[] = [
  'id',
  'entityType',
  'entityId',
  'ciphertext',
  'iv',
  'tag',
  'algorithm',
  'keyVersion',
  'updatedAt',
  'version',
];

/** 构造同步载荷。
 *
 * @param blobs 待同步的密文 blob 列表
 * @param createdAt 载荷构造时间，ISO 8601 UTC；省略时取当前时间
 * @returns 同步载荷
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 存在不合法的 blob
 */
export function buildSyncPayload(blobs: readonly EncryptedBlob[], createdAt: string = new Date().toISOString()): SyncPayload {
  const validated = blobs.map((blob) => validateEncryptedBlob(blob));
  assertCiphertextOnly({ blobs: validated });
  return { version: 1, createdAt, blobs: validated };
}

/**
 * 断言一个对象只包含密文字段。
 *
 * 说明：递归检查键名白名单——同步载荷与备份文件共用这条断言，
 * 保证「服务端只存密文」这一红线在代码层可验证（X-01 ④）。
 *
 * @param payload 待检查的对象
 * @returns 无异常
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 出现白名单之外的字段
 */
export function assertCiphertextOnly(payload: unknown): void {
  if (typeof payload !== 'object' || payload === null) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '同步载荷必须是对象');
  }
  walk(payload, '');
}

/**
 * 递归检查对象中的字段名。
 *
 * @param node 当前节点
 * @param path 当前路径（用于错误提示）
 * @returns 无异常
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 出现禁止字段
 */
function walk(node: unknown, path: string): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => walk(item, `${path}[${index}]`));
    return;
  }
  // Uint8Array 是二进制载荷（密文 / IV / tag），内部是字节序号而非字段名，直接跳过。
  if (node instanceof Uint8Array) {
    return;
  }
  if (typeof node !== 'object' || node === null) {
    return;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const currentPath = path === '' ? key : `${path}.${key}`;
    if (!SYNC_BLOB_ALLOWED_FIELDS.includes(key) && !['version', 'createdAt', 'blobs', 'magic', 'exportedAt'].includes(key)) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', `同步载荷出现不允许的字段：${currentPath}`);
    }
    walk(value, currentPath);
  }
}
