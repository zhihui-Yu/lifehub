/**
 * 树洞日记（模块 D：D-01 ~ D-05）本地全字段加密存储与服务层。
 *
 * 架构位置：apps/web 的「树洞日记模块」领域与持久化服务层。
 *
 * 核心安全与合规红线（PRD D-01 / D-02 / D-05）：
 * 1. **全字段加密落盘（D-01 ①）**：标题 `title`、正文 `body`、标签 `tags`、心情 `mood` 在写入 IndexedDB `diaryEntries` 表前，
 *    统一通过 WebCrypto `AES-GCM-256`（96-bit 随机 IV）加密为密文 `ciphertext`，数据库行内绝不出现明文标题、正文或标签；
 * 2. **AAD 强绑定条目 ID（D-01 ②）**：附加认证数据（AAD）固定为 `lifehub:diary:v1:${id}`，防止密文被跨记录篡改或替换；
 * 3. **纯本地无公开 UGC（D-02）**：仅提供本地加密存储、用户私有云存储加密同步与本地导出，无任何公开社区或外部分享入口；
 * 4. **内存态全文检索（D-05）**：关键词、标签与心情过滤均在解密后的内存数据上完成，不落盘任何明文倒排索引。
 */
import { LifeHubError } from '@lifehub/core';
import type { LifeHubDatabase } from '@/platform/db';
import { createDatabase } from '@/platform/db';
import { getTodayLocalDate } from '@/modules/shared/date-utils';
import { syncAutoSnapshotToStorageDir } from '@/utils/download';

/** 树洞本地包装密钥在 localStorage 中的键名（仅本机加解密使用）。 */
const DIARY_LOCAL_KEY_STORAGE_KEY = 'lifehub:diary:local-aes-key:v1';

/** 无 localStorage 环境下的内存后备密钥字节。 */
let fallbackDiaryKeyBytes: Uint8Array | null = null;

/** 预设心情选项列表。 */
export const DIARY_MOOD_OPTIONS = [
  '😊 开心',
  '🌿 平静',
  '💪 充实',
  '🤔 思考',
  '🌧️ 低落',
  '🔥 振奋',
] as const;

/**
 * 持久化在 Dexie `diaryEntries` 表中的密文行结构（不含任何明文标题、正文或标签）。
 */
export interface StoredEncryptedDiaryRecord {
  /** 条目唯一主键。 */
  id: string;
  /** 本地日历日 'YYYY-MM-DD'。 */
  localDate: string;
  /** 记录发生时刻 ISO 8601 UTC。 */
  occurredAt: string;
  /** 是否置顶。 */
  isPinned: boolean;
  /** AES-GCM 加密后的密文载荷（Base64）。 */
  ciphertext: string;
  /** AES-GCM 96-bit 随机初始向量（Base64）。 */
  iv: string;
  /** AAD 协议版本号。 */
  aadVersion: number;
  /** 创建时间 ISO 8601 UTC。 */
  createdAt: string;
  /** 更新时间 ISO 8601 UTC。 */
  updatedAt: string;
}

/**
 * 解密后的树洞日记条目完整明文结构（仅存在于内存、加密云同步载荷或用户显式导出中）。
 */
export interface DecryptedDiaryEntry {
  /** 条目唯一主键。 */
  id: string;
  /** 可选标题（为空时展示为随手记）。 */
  title: string;
  /** 树洞正文内容。 */
  body: string;
  /** 本地日历日 'YYYY-MM-DD'。 */
  localDate: string;
  /** 发生时刻 ISO 8601 UTC。 */
  occurredAt: string;
  /** 心情标记（如 '😊 开心'）。 */
  mood: string | null;
  /** 标签数组。 */
  tags: string[];
  /** 是否置顶。 */
  isPinned: boolean;
  /** 创建时间 ISO 8601 UTC。 */
  createdAt: string;
  /** 更新时间 ISO 8601 UTC。 */
  updatedAt: string;
}

/**
 * 新增或编辑树洞条目的输入参数。
 */
export interface DiaryEntryInput {
  /** 可选标题。 */
  title?: string;
  /** 正文内容（必填，非空）。 */
  body: string;
  /** 可选指定日历日 'YYYY-MM-DD'（默认当天）。 */
  localDate?: string;
  /** 可选心情标记。 */
  mood?: string | null;
  /** 可选标签列表。 */
  tags?: string[];
  /** 是否置顶。 */
  isPinned?: boolean;
}

/**
 * 树洞列表检索过滤条件。
 */
export interface DiaryListFilter {
  /** 关键词（匹配标题、正文或标签）。 */
  keyword?: string;
  /** 按心情过滤。 */
  mood?: string;
  /** 按标签过滤。 */
  tag?: string;
}

/** 被加密封装的内部明文载荷结构。 */
interface DiarySecretPayload {
  title: string;
  body: string;
  mood: string | null;
  tags: string[];
}

/**
 * 将字节数组编码为 Base64 字符串。
 *
 * @param bytes 待编码的字节数组
 * @returns Base64 字符串
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

/**
 * 将 Base64 字符串解码为字节数组。
 *
 * @param b64 Base64 字符串
 * @returns 解码后的 `Uint8Array`
 */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * 获取或初始化本机树洞专用的 256-bit AES-GCM 密钥。
 *
 * @returns WebCrypto `CryptoKey`
 */
async function getOrCreateDiaryCryptoKey(): Promise<CryptoKey> {
  let rawBytes: Uint8Array | null = null;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const existing = window.localStorage.getItem(DIARY_LOCAL_KEY_STORAGE_KEY);
      if (existing) {
        const decoded = base64ToBytes(existing);
        if (decoded.byteLength === 32) {
          rawBytes = decoded;
        }
      }
    }
  } catch {
    // 忽略 localStorage 读取异常
  }

  if (!rawBytes) {
    if (fallbackDiaryKeyBytes && fallbackDiaryKeyBytes.byteLength === 32) {
      rawBytes = fallbackDiaryKeyBytes;
    } else {
      rawBytes = new Uint8Array(32);
      crypto.getRandomValues(rawBytes);
      fallbackDiaryKeyBytes = rawBytes;
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(DIARY_LOCAL_KEY_STORAGE_KEY, bytesToBase64(rawBytes));
        }
      } catch {
        // 忽略 localStorage 写入异常
      }
    }
  }

  const keyBuf = new ArrayBuffer(32);
  new Uint8Array(keyBuf).set(rawBytes.subarray(0, 32));
  return crypto.subtle.importKey('raw', keyBuf, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * 构造绑定到条目 ID 的 AAD 字节（D-01 ②）。
 *
 * @param entryId 条目唯一 ID
 * @returns UTF-8 编码的 AAD `ArrayBuffer`
 */
function buildEntryAadBuffer(entryId: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(`lifehub:diary:v1:${entryId}`);
  const buf = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buf).set(encoded);
  return buf;
}

/**
 * 使用 AES-GCM-256 与绑定条目 ID 的 AAD 加密树洞敏感字段。
 *
 * @param entryId 条目 ID（绑定到 AAD）
 * @param payload 明文载荷
 * @returns 包含 Base64 密文与 IV 的对象
 */
async function encryptDiaryPayload(
  entryId: string,
  payload: DiarySecretPayload,
): Promise<{ ciphertext: string; iv: string }> {
  const key = await getOrCreateDiaryCryptoKey();
  const ivBytes = new Uint8Array(12);
  crypto.getRandomValues(ivBytes);
  const ivBuf = new ArrayBuffer(12);
  new Uint8Array(ivBuf).set(ivBytes);

  const plainBytes = new TextEncoder().encode(JSON.stringify(payload));
  const plainBuf = new ArrayBuffer(plainBytes.byteLength);
  new Uint8Array(plainBuf).set(plainBytes);

  const encryptedBuf = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: ivBuf,
      additionalData: buildEntryAadBuffer(entryId),
    },
    key,
    plainBuf,
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(encryptedBuf)),
    iv: bytesToBase64(ivBytes),
  };
}

/**
 * 解密单条树洞密文记录，校验 AAD 与 GCM 认证标签。
 *
 * @param record 密文数据库记录
 * @returns 解密后的树洞明文条目
 * @throws {LifeHubError} 当密文、IV 或 AAD 被篡改时抛出解密失败异常
 */
export async function decryptDiaryRecord(
  record: StoredEncryptedDiaryRecord,
): Promise<DecryptedDiaryEntry> {
  try {
    const key = await getOrCreateDiaryCryptoKey();
    const ivBytes = base64ToBytes(record.iv);
    const ivBuf = new ArrayBuffer(ivBytes.byteLength);
    new Uint8Array(ivBuf).set(ivBytes);

    const cipherBytes = base64ToBytes(record.ciphertext);
    const cipherBuf = new ArrayBuffer(cipherBytes.byteLength);
    new Uint8Array(cipherBuf).set(cipherBytes);

    const decryptedBuf = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: ivBuf,
        additionalData: buildEntryAadBuffer(record.id),
      },
      key,
      cipherBuf,
    );

    const jsonText = new TextDecoder().decode(new Uint8Array(decryptedBuf));
    const parsed = JSON.parse(jsonText) as Partial<DiarySecretPayload>;
    return {
      id: record.id,
      title: typeof parsed.title === 'string' ? parsed.title : '',
      body: typeof parsed.body === 'string' ? parsed.body : '',
      localDate: record.localDate,
      occurredAt: record.occurredAt,
      mood: typeof parsed.mood === 'string' && parsed.mood.length > 0 ? parsed.mood : null,
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        : [],
      isPinned: Boolean(record.isPinned),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  } catch (err) {
    throw new LifeHubError(
      'LIFEHUB_E_CRYPTO_AUTH_FAILED',
      `树洞条目解密失败（可能已被篡改或密钥不匹配）：${err instanceof Error ? err.message : '未知错误'}`,
    );
  }
}

/**
 * 生成树洞条目唯一主键。
 *
 * @returns 字符串 ID
 */
function generateDiaryId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `diary-${crypto.randomUUID()}`;
  }
  return `diary-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 归一化标签列表（去重、去空白）。
 *
 * @param tags 原始标签数组
 * @returns 规整后的标签数组
 */
function normalizeTags(tags?: readonly string[]): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const cleaned = raw.trim().replace(/^#+/, '').trim();
    if (cleaned.length > 0 && !seen.has(cleaned)) {
      seen.add(cleaned);
      result.push(cleaned);
    }
  }
  return result;
}

/**
 * 树洞日记业务与加密存储服务。
 */
export class DiaryService {
  private readonly db: LifeHubDatabase;

  /**
   * 构造树洞日记服务实例。
   *
   * @param db 可选注入的数据库实例（默认创建全局单例库）
   */
  constructor(db?: LifeHubDatabase) {
    this.db = db ?? createDatabase();
  }

  /**
   * 获取底层 `diaryEntries` 表引用。
   */
  private get table() {
    return this.db.table<StoredEncryptedDiaryRecord, string>('diaryEntries');
  }

  /**
   * 创建一条新的加密树洞记录。
   *
   * @param input 树洞条目输入参数
   * @returns 解密态的新增树洞条目
   * @throws {LifeHubError} 正文为空时抛出 `LIFEHUB_E_VALIDATION`
   */
  async createEntry(input: DiaryEntryInput): Promise<DecryptedDiaryEntry> {
    const trimmedBody = (input.body ?? '').trim();
    if (trimmedBody.length === 0) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', '树洞正文内容不能为空');
    }

    const nowIso = new Date().toISOString();
    const id = generateDiaryId();
    const localDate =
      input.localDate && /^\d{4}-\d{2}-\d{2}$/.test(input.localDate.trim())
        ? input.localDate.trim()
        : getTodayLocalDate();
    const trimmedTitle = (input.title ?? '').trim();
    const mood = input.mood && input.mood.trim().length > 0 ? input.mood.trim() : null;
    const tags = normalizeTags(input.tags);
    const isPinned = Boolean(input.isPinned);

    const encrypted = await encryptDiaryPayload(id, {
      title: trimmedTitle,
      body: trimmedBody,
      mood,
      tags,
    });

    const record: StoredEncryptedDiaryRecord = {
      id,
      localDate,
      occurredAt: nowIso,
      isPinned,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      aadVersion: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await this.table.put(record);
    await this.persistModuleSnapshot();
    return {
      id,
      title: trimmedTitle,
      body: trimmedBody,
      localDate,
      occurredAt: nowIso,
      mood,
      tags,
      isPinned,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  }

  /**
   * 将当前树洞记录同步落盘至用户配置目录下的 `lifehub-treehole.json`。
   */
  private async persistModuleSnapshot(): Promise<void> {
    try {
      const entries = await this.exportAllDecrypted();
      syncAutoSnapshotToStorageDir(
        JSON.stringify(
          {
            schema: 'lifehub-treehole-v1',
            updatedAt: new Date().toISOString(),
            diaryCount: entries.length,
            diaryEntries: entries,
          },
          null,
          2,
        ),
        'lifehub-treehole.json',
      );
    } catch {
      // 忽略快照写入异常
    }
  }

  /**
   * 更新已有的树洞记录并重新生成随机 IV 与 AES-GCM 密文。
   *
   * @param id 条目主键 ID
   * @param patch 待更新的字段集合
   * @returns 更新后的明文树洞条目
   * @throws {LifeHubError} 条目不存在或正文为空时抛出异常
   */
  async updateEntry(id: string, patch: Partial<DiaryEntryInput>): Promise<DecryptedDiaryEntry> {
    const existingRecord = await this.table.get(id);
    if (!existingRecord) {
      throw new LifeHubError('LIFEHUB_E_ENTITY_NOT_FOUND', `未找到树洞条目：${id}`);
    }
    const current = await decryptDiaryRecord(existingRecord);

    const nextBody = patch.body !== undefined ? patch.body.trim() : current.body;
    if (nextBody.length === 0) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', '树洞正文内容不能为空');
    }
    const nextTitle = patch.title !== undefined ? patch.title.trim() : current.title;
    const nextMood =
      patch.mood !== undefined
        ? patch.mood && patch.mood.trim().length > 0
          ? patch.mood.trim()
          : null
        : current.mood;
    const nextTags = patch.tags !== undefined ? normalizeTags(patch.tags) : current.tags;
    const nextPinned = patch.isPinned !== undefined ? Boolean(patch.isPinned) : current.isPinned;
    const nextLocalDate =
      patch.localDate && /^\d{4}-\d{2}-\d{2}$/.test(patch.localDate.trim())
        ? patch.localDate.trim()
        : current.localDate;
    const updatedAt = new Date().toISOString();

    const encrypted = await encryptDiaryPayload(id, {
      title: nextTitle,
      body: nextBody,
      mood: nextMood,
      tags: nextTags,
    });

    const nextRecord: StoredEncryptedDiaryRecord = {
      ...existingRecord,
      localDate: nextLocalDate,
      isPinned: nextPinned,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      updatedAt,
    };

    await this.table.put(nextRecord);
    await this.persistModuleSnapshot();
    return {
      ...current,
      title: nextTitle,
      body: nextBody,
      localDate: nextLocalDate,
      mood: nextMood,
      tags: nextTags,
      isPinned: nextPinned,
      updatedAt,
    };
  }

  /**
   * 切换某条树洞记录的置顶状态。
   *
   * @param id 条目主键 ID
   * @returns 切换后的树洞条目
   */
  async togglePin(id: string): Promise<DecryptedDiaryEntry> {
    const existingRecord = await this.table.get(id);
    if (!existingRecord) {
      throw new LifeHubError('LIFEHUB_E_ENTITY_NOT_FOUND', `未找到树洞条目：${id}`);
    }
    const current = await decryptDiaryRecord(existingRecord);
    return this.updateEntry(id, { isPinned: !current.isPinned });
  }

  /**
   * 删除指定的树洞条目。
   *
   * @param id 条目主键 ID
   * @returns 无
   */
  async deleteEntry(id: string): Promise<void> {
    await this.table.delete(id);
    await this.persistModuleSnapshot();
  }

  /**
   * 读取所有底层原始密文记录（仅供加密合规验证测试使用）。
   *
   * @returns 原始密文记录列表
   */
  async listRawEncryptedRecords(): Promise<StoredEncryptedDiaryRecord[]> {
    return this.table.toArray();
  }

  /**
   * 解密并列出树洞条目，支持在内存中按关键词、心情与标签检索（置顶优先 + 时间倒序）。
   *
   * @param filter 可选检索过滤条件
   * @returns 排序与过滤后的树洞条目列表
   */
  async listEntries(filter?: DiaryListFilter): Promise<DecryptedDiaryEntry[]> {
    const rawRecords = await this.table.toArray();
    const decrypted: DecryptedDiaryEntry[] = [];
    for (const rec of rawRecords) {
      try {
        const entry = await decryptDiaryRecord(rec);
        decrypted.push(entry);
      } catch {
        // 忽略损坏的单条记录，避免阻塞整体列表读取
      }
    }

    const kw = (filter?.keyword ?? '').trim().toLowerCase();
    const moodFilter = (filter?.mood ?? '').trim();
    const tagFilter = (filter?.tag ?? '').trim().toLowerCase();

    const filtered = decrypted.filter((entry) => {
      if (moodFilter && entry.mood !== moodFilter) {
        return false;
      }
      if (tagFilter && !entry.tags.some((t) => t.toLowerCase() === tagFilter)) {
        return false;
      }
      if (kw) {
        const inTitle = entry.title.toLowerCase().includes(kw);
        const inBody = entry.body.toLowerCase().includes(kw);
        const inTags = entry.tags.some((t) => t.toLowerCase().includes(kw));
        const inDate = entry.localDate.includes(kw);
        if (!inTitle && !inBody && !inTags && !inDate) {
          return false;
        }
      }
      return true;
    });

    filtered.sort((a, b) => {
      if (a.isPinned !== b.isPinned) {
        return a.isPinned ? -1 : 1;
      }
      return b.occurredAt.localeCompare(a.occurredAt);
    });

    return filtered;
  }

  /**
   * 导出全部已解密的树洞条目（供云存储加密打包上传或全量 JSON 迁移导出使用）。
   *
   * @returns 全部树洞明文条目数组
   */
  async exportAllDecrypted(): Promise<DecryptedDiaryEntry[]> {
    return this.listEntries();
  }

  /**
   * 从云端备份或全量导入包中批量恢复树洞条目（重新以本机密钥和绑定 AAD 加密落盘）。
   *
   * @param entries 待导入的树洞条目数组
   * @returns 成功导入并加密落盘的条目数量
   */
  async importAllFromBackup(entries: readonly DecryptedDiaryEntry[]): Promise<number> {
    let count = 0;
    for (const item of entries) {
      if (!item || typeof item.id !== 'string' || typeof item.body !== 'string') {
        continue;
      }
      const trimmedBody = item.body.trim();
      if (trimmedBody.length === 0) {
        continue;
      }
      const encrypted = await encryptDiaryPayload(item.id, {
        title: typeof item.title === 'string' ? item.title : '',
        body: trimmedBody,
        mood: typeof item.mood === 'string' ? item.mood : null,
        tags: Array.isArray(item.tags) ? normalizeTags(item.tags) : [],
      });
      const record: StoredEncryptedDiaryRecord = {
        id: item.id,
        localDate: item.localDate || getTodayLocalDate(),
        occurredAt: item.occurredAt || new Date().toISOString(),
        isPinned: Boolean(item.isPinned),
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        aadVersion: 1,
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: item.updatedAt || new Date().toISOString(),
      };
      await this.table.put(record);
      count += 1;
    }
    return count;
  }
}
