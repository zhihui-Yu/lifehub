#!/usr/bin/env sh
#
# LifeHub 同步服务 —— 快照备份的 crontab 包装脚本。
#
# 架构位置：scripts/snapshot.sh —— 供 NAS / VPS / 内网机器用 cron 定时调用。
#
# 用法（在 crontab 中，每晚 03:17 打一次快照）：
# ```cron
# 17 3 * * * /opt/lifehub/scripts/snapshot.sh >> /var/log/lifehub-snapshot.log 2>&1
# ```
#
# 说明：真正的备份逻辑在 `scripts/snapshot.mjs`（Node 内置模块，零 npm 依赖），
# 本脚本只负责定位仓库根目录、注入默认环境变量并调用它。
#
# 环境变量：
# | 变量 | 默认值 | 说明 |
# | --- | --- | --- |
# | `LIFEHUB_SYNC_DB_PATH` | `<仓库>/data/lifehub-sync.db` | 源数据库路径 |
# | `LIFEHUB_SYNC_SNAPSHOT_DIR` | `<仓库>/data/snapshots` | 快照输出目录 |
# | `LIFEHUB_SYNC_SNAPSHOT_KEEP` | `7` | 保留的快照份数 |
# | `LIFEHUB_SYNC_NODE_BIN` | `node` | Node 可执行文件 |

set -eu

# 定位仓库根目录（本脚本位于 <仓库>/scripts/ 下）。
SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(dirname -- "$SCRIPT_DIR")

# 注入默认值（已显式设置的环境变量优先，不覆盖）。
: "${LIFEHUB_SYNC_DB_PATH:=${REPO_ROOT}/data/lifehub-sync.db}"
: "${LIFEHUB_SYNC_SNAPSHOT_DIR:=${REPO_ROOT}/data/snapshots}"
: "${LIFEHUB_SYNC_SNAPSHOT_KEEP:=7}"
: "${LIFEHUB_SYNC_NODE_BIN:=node}"
export LIFEHUB_SYNC_DB_PATH LIFEHUB_SYNC_SNAPSHOT_DIR LIFEHUB_SYNC_SNAPSHOT_KEEP

# 源库不存在时直接退出（首次部署还没建库是正常情况，不该刷错误日志）。
if [ ! -f "$LIFEHUB_SYNC_DB_PATH" ]; then
  echo "[快照] 数据库不存在，跳过：$LIFEHUB_SYNC_DB_PATH"
  exit 0
fi

exec "$LIFEHUB_SYNC_NODE_BIN" "${SCRIPT_DIR}/snapshot.mjs"
