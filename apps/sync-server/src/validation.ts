/**
 * 密文 blob 请求体的字段白名单 / 黑名单与形状校验。
 *
 * 架构位置：apps/sync-server —— HTTP 层与存储层之间的「只收密文」闸门。
 *
 * 红线（X-01 ④ / R5 / X-12）：
 * - **白名单**：请求体顶层只允许出现 `EncryptedBlob` 的 10 个字段，出现别的字段一律 400；
 * - **黑名单**：明文字段名（金额 / 对方 / 备注 / 盐值 / DEK …）命中即 400，
 *   并且是**递归**扫描——夹带在嵌套对象里的明文字段同样会被拒绝；
 * - 服务端**不会**去校验密文本身是否正确（它没有密钥，只能校验**形状**）。
 *
 * 校验失败一律抛 `ValidationError`，由 HTTP 层转成 400。
 */

/** 允许出现在请求体顶层的 blob 字段白名单（与 core 的 `EncryptedBlob` 一一对应）。 */
export const ALLOWED_BLOB_FIELDS: readonly string[] = [
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

/**
 * 明文字段黑名单：出现即拒绝（服务端只存密文）。
 *
 * 说明：这些名字既覆盖业务语义字段（金额 / 方向 / 对方 / 备注 …），
 * 也覆盖密钥材料（盐值 / DEK / 主密钥 / 恢复码）与索引明文列（`localDate`）。
 */
export const FORBIDDEN_FIELDS: readonly string[] = [
  'amountMinor',
  'amount',
  'counterparty',
  'categoryId',
  'localDate',
  'occurredAt',
  'direction',
  'note',
  'title',
  'body',
  'content',
  'password',
  'salt',
  'dek',
  'masterKey',
  'wrappedDek',
  'recoveryCode',
  'plaintext',
];

/** 服务端当前接受的加密算法标识。 */
export const SUPPORTED_ALGORITHMS: readonly string[] = ['AES-256-GCM'];

/** 各字符串字段的最大长度（字节），用于挡住超大字段。 */
const MAX_LENGTHS: Readonly<Record<string, number>> = {
  id: 200,
  entityType: 64,
  entityId: 200,
  ciphertext: 8 * 1024 * 1024,
  iv: 256,
  tag: 256,
  algorithm: 32,
};

/** 请求体校验失败。 */
export class ValidationError extends Error {
  /**
   * 构造校验错误。
   *
   * @param message 中文错误提示
   */
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * 把 ISO-8601 时间戳归一化为 `YYYY-MM-DDTHH:mm:ss.sssZ`。
 *
 * 说明：归一化是**必须的**——增量拉取用字符串比较 `updated_at`，
 * 只有固定宽度 + 统一 UTC 的格式才能保证字典序等于时间序。
 *
 * @param raw 原始时间串
 * @returns 归一化后的 UTC 时间串
 * @throws {ValidationError} 不是合法的 ISO-8601 时间戳时抛出
 */
export function normalizeTimestamp(raw: string, fieldName: string): string {
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    throw new ValidationError(`字段 ${fieldName} 必须是合法的 ISO-8601 时间戳`);
  }
  return new Date(parsed).toISOString();
}

/**
 * 递归扫描对象，找出所有命中黑名单的字段名。
 *
 * 说明：只检查**键名**，不检查值——服务端没有密钥，
 * 无法判断某个字符串是密文还是明文，因此「明文字段名」是唯一可执行的红线。
 *
 * @param node 待扫描的节点
 * @param path 当前路径（用于错误提示）
 * @returns 无异常
 * @throws {ValidationError} 命中黑名单字段名时抛出
 */
function assertNoForbiddenField(node: unknown, path: string): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => assertNoForbiddenField(item, `${path}[${index}]`));
    return;
  }
  if (typeof node !== 'object' || node === null) {
    return;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const currentPath = path === '' ? key : `${path}.${key}`;
    if (FORBIDDEN_FIELDS.includes(key)) {
      throw new ValidationError(`服务端只接受密文，拒绝明文字段：${key}（位置 ${currentPath}）`);
    }
    assertNoForbiddenField(value, currentPath);
  }
}

/**
 * 校验并规范化一个密文 blob 请求体。
 *
 * 说明：
 * 1. 先递归扫黑名单（明文字段）——给出最直观的拒绝原因；
 * 2. 再校验顶层白名单——任何多余字段都拒绝，杜绝「夹带」；
 * 3. 最后逐字段做类型与长度校验，并把 `updatedAt` 归一化。
 *
 * @param body 已解析的请求体
 * @returns 规范化后的 blob 字段
 * @throws {ValidationError} 任一校验不通过时抛出
 */
export function validateBlobBody(body: unknown): {
  id: string;
  entityType: string;
  entityId: string;
  ciphertext: string;
  iv: string;
  tag: string;
  algorithm: string;
  keyVersion: number;
  updatedAt: string;
  version: number;
} {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError('请求体必须是对象');
  }
  const candidate = body as Record<string, unknown>;

  // 明文字段一律拒绝——服务端只见密文。
  assertNoForbiddenField(candidate, '');

  // 白名单之外的字段也拒绝，避免夹带。
  for (const key of Object.keys(candidate)) {
    if (!ALLOWED_BLOB_FIELDS.includes(key)) {
      throw new ValidationError(`出现未允许的字段：${key}`);
    }
  }

  const required = ALLOWED_BLOB_FIELDS;
  for (const key of required) {
    const value = candidate[key];
    if (value === undefined || value === null || value === '') {
      throw new ValidationError(`缺少必填字段：${key}`);
    }
  }

  const strings: Record<string, string> = {};
  for (const key of ['id', 'entityType', 'entityId', 'ciphertext', 'iv', 'tag', 'algorithm']) {
    const value = candidate[key];
    if (typeof value !== 'string') {
      throw new ValidationError(`字段 ${key} 必须是字符串`);
    }
    const max = MAX_LENGTHS[key] ?? 1024;
    if (value.length > max) {
      throw new ValidationError(`字段 ${key} 长度超过上限（${max}）`);
    }
    strings[key] = value;
  }

  if (!SUPPORTED_ALGORITHMS.includes(strings['algorithm'] ?? '')) {
    throw new ValidationError(`不支持的加密算法：${strings['algorithm'] ?? ''}`);
  }

  const keyVersion = candidate['keyVersion'];
  const version = candidate['version'];
  if (typeof keyVersion !== 'number' || !Number.isInteger(keyVersion) || keyVersion < 0) {
    throw new ValidationError('keyVersion 必须是非负整数');
  }
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    throw new ValidationError('version 必须是非负整数');
  }

  const rawUpdatedAt = candidate['updatedAt'];
  if (typeof rawUpdatedAt !== 'string') {
    throw new ValidationError('字段 updatedAt 必须是字符串');
  }

  return {
    id: strings['id'] ?? '',
    entityType: strings['entityType'] ?? '',
    entityId: strings['entityId'] ?? '',
    ciphertext: strings['ciphertext'] ?? '',
    iv: strings['iv'] ?? '',
    tag: strings['tag'] ?? '',
    algorithm: strings['algorithm'] ?? '',
    keyVersion,
    updatedAt: normalizeTimestamp(rawUpdatedAt, 'updatedAt'),
    version,
  };
}
