/**
 * 全局领域常量。
 *
 * 架构位置：core 包的常量「单一事实来源」。系统设计 §8.2 要求所有魔法数字上提到此处，
 * 并注明取值依据与关联需求编号，避免散落在业务代码里导致口径漂移。
 */

/** 应用语义化版本号，写入审计日志与备份文件元信息。 */
export const APP_VERSION = '0.1.0';

/** ISO 8601 UTC 时间戳格式：YYYY-MM-DDTHH:mm:ss.sssZ（系统设计 §8.2）。 */
export const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** 本地日历日格式：YYYY-MM-DD（系统设计 §8.2）。 */
export const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 墙钟时间格式：HH:mm（系统设计 §8.2）。 */
export const WALL_CLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * 口令哨兵明文常量。
 *
 * 取值依据：A-07 ⑦「不存储口令哈希，改用主密钥加密固定哨兵」；
 * 关联需求 X-04 ④「不得落盘任何可离线爆破的口令派生值」。
 */
export const VAULT_VERIFIER_PLAINTEXT = 'lifehub:verify:v1';

/** 哨兵实体 id：哨兵密文以固定 id 存放，便于解密校验。 */
export const VAULT_VERIFIER_ID = 'verifier';

/**
 * scrypt 默认 KDF 参数。
 *
 * 取值依据：PRD Q4 / Q5 拍板 scrypt，N=2^15 在抗爆破强度与解锁耗时（NF-P-3 P95 ≤ 1s）之间取平衡；
 * r=8、p=1 为 scrypt 官方推荐起点；keyLength=32 对应 AES-256。
 */
export const KDF_DEFAULT_PARAMS = {
  n: 32768,
  r: 8,
  p: 1,
  keyLength: 32,
  saltLength: 16,
} as const;

/**
 * 降级 KDF 参数（低性能设备 / 老旧浏览器使用）。
 *
 * 取值依据：系统设计 §5 假设 A-7「解锁耗时 P95 ≤ 1.0s」，必要时可切换到 N=2^14；
 * 但低于 N=2^14 时 UI 需提示「强度不足，建议调高参数」（NF-P-3）。
 */
export const KDF_FALLBACK_PARAMS = {
  n: 16384,
  r: 8,
  p: 1,
  keyLength: 32,
  saltLength: 16,
} as const;

/** KDF 参数版本号：未来升级 scrypt 参数后，旧参数仍可用于校验已有保险库（A-07 ⑥）。 */
export const KDF_PARAMS_VERSION = 1;

/** 加密算法标识，唯一合法值为 AES-256-GCM（NF-S-3）。 */
export const ENCRYPTION_ALGORITHM = 'AES-256-GCM';

/** AES-GCM 随机 IV 字节长度（96 位，WebCrypto 推荐值）。 */
export const IV_LENGTH = 12;

/** AES-GCM 认证标签字节长度（128 位）。 */
export const GCM_TAG_LENGTH = 16;

/** 数据加密密钥（DEK）字节长度：32 字节对应 AES-256（NF-S-3）。 */
export const DEK_LENGTH = 32;

/** 加密备份文件魔数，导入时用于快速识别文件类型（A-24 ③）。 */
export const BACKUP_MAGIC = 'LIFEHUB-BACKUP';

/** 加密备份文件版本号。 */
export const BACKUP_VERSION = 1;

/** 加密备份文件扩展名。 */
export const BACKUP_FILE_EXTENSION = '.enc.json';

/** 盐值备份文件扩展名。 */
export const SALT_BACKUP_FILE_EXTENSION = '.salt.json';

/**
 * 默认收入方向关键词（中文）。
 *
 * 取值依据：A-06 ①「关键词推断方向」，词表覆盖常见支付平台的交易摘要措辞；
 * 关联需求 A-06 ②「无法判定时该行跳过并计入错误明细」。
 */
export const DIRECTION_INCOME_KEYWORDS: readonly string[] = [
  '收入',
  '收款',
  '入账',
  '存入',
  '进账',
  '转入',
  '工资',
  '退款',
  '返现',
  '收款成功',
  '已收款',
  '入账成功',
];

/**
 * 默认支出方向关键词（中文）。
 *
 * 取值依据：同上，与 DIRECTION_INCOME_KEYWORDS 构成互斥词表。
 */
export const DIRECTION_EXPENSE_KEYWORDS: readonly string[] = [
  '支出',
  '付款',
  '消费',
  '转出',
  '出账',
  '扣款',
  '缴费',
  '已付款',
  '付款成功',
  '消费支出',
  '转账支出',
];

/** 导入落库批大小：每 1000 条写一次库，避免 10 万行时单次事务过大（NF-P-1）。 */
export const IMPORT_BATCH_SIZE = 1000;

/** 导入预览默认展示行数（A-05 ④：映射变更时实时预览前 10 行）。 */
export const IMPORT_PREVIEW_ROWS = 10;

/** 恢复码分组数（Q6：12 组 × 6 字符 Base32）。 */
export const RECOVERY_CODE_GROUP_COUNT = 12;

/** 恢复码每组字符数（Q6）。 */
export const RECOVERY_CODE_GROUP_LENGTH = 6;

/**
 * 恢复码字符集（Base32 Crockford 变体，剔除易混字符 I / O / 0 / 1）。
 *
 * 取值依据：NF-S-8「恢复码具备校验位，输错可识别」，剔除易混字符降低人工抄写错误率。
 */
export const RECOVERY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 恢复码分组分隔符。 */
export const RECOVERY_CODE_SEPARATOR = '-';

/** 口令最小长度（A-07 ①：主密码长度 ≥ 8）。 */
export const MIN_PASSWORD_LENGTH = 8;

/** 解锁失败达到该次数后进入冷却（NF-S-8：连续 5 次错误后冷却 30 秒）。 */
export const UNLOCK_COOLDOWN_THRESHOLD = 5;

/** 解锁冷却时长（毫秒），对应 NF-S-8。 */
export const UNLOCK_COOLDOWN_MS = 30_000;

/** 单个 CSV 文件最大字节数，防止超大文件耗尽内存（10MB 基准的 5 倍冗余）。 */
export const MAX_IMPORT_FILE_SIZE = 50 * 1024 * 1024;

/** 系统预置分类种子数量对应的排序步长，保证新分类稳定排在末尾。 */
export const CATEGORY_SORT_STEP = 100;
