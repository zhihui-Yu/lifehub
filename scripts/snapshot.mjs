#!/usr/bin/env node
/**
 * LifeHub 同步服务 —— SQLite 快照备份脚本。
 *
 * 架构位置：scripts/snapshot.mjs —— 运维脚本（零 npm 依赖，只用 Node 内置模块）。
 *
 * 用途：
 * - 对同步服务的 SQLite 库做**在线一致性快照**（用 `node:sqlite` 的 `backup()`，
 *   服务运行中也能安全备份，不需要停机，也不会拿到半截的 WAL 文件）；
 * - 快照**只含密文**——服务端库里本来就没有明文，快照自然也没有；
 * - 按保留份数滚动清理旧快照，避免磁盘被撑满。
 *
 * 用法：
 * ```bash
 * node scripts/snapshot.mjs                      # 用默认环境变量
 * LIFEHUB_SYNC_DB_PATH=./data/sync.db \
 * LIFEHUB_SYNC_SNAPSHOT_DIR=./data/snapshots \
 * LIFEHUB_SYNC_SNAPSHOT_KEEP=7 node scripts/snapshot.mjs
 * ```
 *
 * 环境变量：
 * | 变量 | 默认值 | 说明 |
 * | --- | --- | --- |
 * | `LIFEHUB_SYNC_DB_PATH` | `./data/lifehub-sync.db` | 源数据库路径 |
 * | `LIFEHUB_SYNC_SNAPSHOT_DIR` | `./data/snapshots` | 快照输出目录 |
 * | `LIFEHUB_SYNC_SNAPSHOT_KEEP` | `7` | 保留的快照份数 |
 */
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

/** 源数据库路径。 */
const DB_PATH = process.env['LIFEHUB_SYNC_DB_PATH'] ?? './data/lifehub-sync.db';

/** 快照输出目录。 */
const SNAPSHOT_DIR = process.env['LIFEHUB_SYNC_SNAPSHOT_DIR'] ?? './data/snapshots';

/** 保留的快照份数。 */
const KEEP = Math.max(
  1,
  Number.parseInt(process.env['LIFEHUB_SYNC_SNAPSHOT_KEEP'] ?? '7', 10) || 7,
);

/** 快照文件名前缀。 */
const PREFIX = 'lifehub-sync-';

/** 快照文件扩展名。 */
const SUFFIX = '.db';

/**
 * 生成快照文件名（按时间排序，便于按名清理旧的）。
 *
 * @param {Date} date 快照时间
 * @returns {string} 形如 `lifehub-sync-20260101T000000Z.db` 的文件名
 */
function snapshotName(date) {
  const stamp = date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  return `${PREFIX}${stamp}${SUFFIX}`;
}

/**
 * 列出已有的快照文件（按时间从新到旧排序）。
 *
 * @param {string} dir 快照目录
 * @returns {string[]} 快照文件路径数组
 */
function listSnapshots(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.startsWith(PREFIX) && name.endsWith(SUFFIX))
    .map((name) => join(dir, name))
    .sort((left, right) => right.localeCompare(left));
}

/**
 * 执行一次快照并按份数清理旧快照。
 *
 * @returns {Promise<void>} 无异常；失败时以非零退出码结束
 */
async function main() {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const target = join(SNAPSHOT_DIR, snapshotName(new Date()));

  // 以只读方式打开源库：快照过程不会改动线上数据。
  const source = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const pages = await backup(source, target);
    console.log(`[快照] 已创建 ${target}（${pages} 页）`);
  } finally {
    source.close();
  }

  // 清理超出保留份数的旧快照。
  const snapshots = listSnapshots(SNAPSHOT_DIR);
  for (const stale of snapshots.slice(KEEP)) {
    try {
      const size = statSync(stale).size;
      rmSync(stale, { force: true });
      console.log(`[快照] 已清理旧快照 ${stale}（${size} 字节）`);
    } catch {
      // 清理失败不影响本次快照结果。
    }
  }

  console.log(`[快照] 当前保留 ${Math.min(snapshots.length, KEEP)} 份快照（目录 ${SNAPSHOT_DIR}）`);
}

main().catch((error) => {
  console.error('[快照] 失败：', error instanceof Error ? error.message : error);
  process.exit(1);
});
