/**
 * 多端云同步删除墓碑（Tombstone）记录模块。
 *
 * 架构位置：apps/web 的「应用基础设施（lib）」层。
 *
 * 说明：用于单人多端错峰使用场景下记录本地已删除的实体主键与删除时间，
 * 在「上传前强制先拉取合并」时防止一端已删除的数据被另一端旧快照复活。
 */

/** 支持云端多端合并的实体类型。 */
export type SyncableEntityType =
  | 'bill'
  | 'category'
  | 'scheduleSlot'
  | 'completionEvent'
  | 'habit'
  | 'habitCheckIn'
  | 'diaryEntry';

/** 单条删除墓碑记录。 */
export interface DeletedEntityTombstone {
  /** 被删除实体的主键 ID。 */
  id: string;
  /** 实体所属集合类型。 */
  entityType: SyncableEntityType;
  /** 删除发生时刻（ISO 8601 UTC）。 */
  deletedAt: string;
}

/** 本地删除墓碑在 localStorage 中的持久化键名。 */
export const CLOUD_TOMBSTONES_STORAGE_KEY = 'lifehub.cloudStorage.tombstones';

/** 本地保留删除墓碑的最大条数上限，避免无界增长。 */
const MAX_TOMBSTONES = 5000;

const VALID_ENTITY_TYPES = new Set<SyncableEntityType>([
  'bill',
  'category',
  'scheduleSlot',
  'completionEvent',
  'habit',
  'habitCheckIn',
  'diaryEntry',
]);

/**
 * 合并并去重多组删除墓碑（同一 `entityType + id` 保留最新 `deletedAt`）。
 */
export function normalizeCloudTombstones(
  items: readonly DeletedEntityTombstone[],
): DeletedEntityTombstone[] {
  const byKey = new Map<string, DeletedEntityTombstone>();
  for (const item of items) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !item.id ||
      typeof item.deletedAt !== 'string' ||
      !item.deletedAt ||
      !VALID_ENTITY_TYPES.has(item.entityType)
    ) {
      continue;
    }
    const key = `${item.entityType}::${item.id}`;
    const prev = byKey.get(key);
    if (!prev || item.deletedAt > prev.deletedAt) {
      byKey.set(key, {
        id: item.id,
        entityType: item.entityType,
        deletedAt: item.deletedAt,
      });
    }
  }
  const merged = Array.from(byKey.values());
  if (merged.length <= MAX_TOMBSTONES) {
    return merged;
  }
  merged.sort((a, b) => (a.deletedAt < b.deletedAt ? -1 : a.deletedAt > b.deletedAt ? 1 : 0));
  return merged.slice(merged.length - MAX_TOMBSTONES);
}

/**
 * 读取本机记录的删除墓碑列表。
 */
export function loadLocalCloudTombstones(): DeletedEntityTombstone[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return [];
    }
    const raw = window.localStorage.getItem(CLOUD_TOMBSTONES_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return normalizeCloudTombstones(parsed as DeletedEntityTombstone[]);
  } catch {
    return [];
  }
}

/**
 * 持久化保存本机删除墓碑列表。
 */
export function saveLocalCloudTombstones(items: readonly DeletedEntityTombstone[]): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    const normalized = normalizeCloudTombstones(items);
    window.localStorage.setItem(CLOUD_TOMBSTONES_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // 忽略配额或隐私模式异常
  }
}

/**
 * 记录单个实体的本地删除墓碑。
 */
export function recordCloudTombstone(
  entityType: SyncableEntityType,
  id: string,
  deletedAt: string = new Date().toISOString(),
): void {
  if (!id) {
    return;
  }
  recordCloudTombstones(entityType, [id], deletedAt);
}

/**
 * 批量记录多个实体的本地删除墓碑。
 */
export function recordCloudTombstones(
  entityType: SyncableEntityType,
  ids: readonly string[],
  deletedAt: string = new Date().toISOString(),
): void {
  const validIds = ids.filter((id) => typeof id === 'string' && id.length > 0);
  if (validIds.length === 0) {
    return;
  }
  const existing = loadLocalCloudTombstones();
  const appended: DeletedEntityTombstone[] = validIds.map((id) => ({
    id,
    entityType,
    deletedAt,
  }));
  saveLocalCloudTombstones([...existing, ...appended]);
}
