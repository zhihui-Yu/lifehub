# LifeHub 同步服务（自托管 · 只存密文）
#
# 构建上下文必须是**仓库根目录**：
#   docker build -f apps/sync-server/Dockerfile -t lifehub-sync-server .
#
# 说明：
# - 多阶段构建：builder 阶段只负责把 TypeScript 编译成 JS，运行阶段只带产物；
# - 运行阶段**零 npm 依赖**（只用 Node 内置模块），镜像里没有任何第三方包；
# - 镜像里**没有任何密钥材料**，服务端只见密文（X-01 ④ / R5）；
# - 数据库落在 /data（挂卷），容器重建不丢数据；
# - 设备令牌**不写进镜像**，由运行时环境变量或 /run/secrets 注入。

# ── 构建阶段 ────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /build

# 只复制编译所需的清单、配置与源码。
# 说明：
# - tsconfig.base.json 放在 /build 的父级——这里的相对路径 `../../tsconfig.base.json`
#   是相对 /build/tsconfig.json 解析的；
# - package.json **必须**一起复制：它带 "type": "module"，决定了 TypeScript 的模块格式。
#   缺了它会退化成 CommonJS，`import.meta` 直接编译报错（TS1470）。
COPY tsconfig.base.json /tsconfig.base.json
COPY apps/sync-server/package.json ./package.json
COPY apps/sync-server/tsconfig.json ./tsconfig.json
COPY apps/sync-server/src ./src

# 编译 TypeScript：同步服务零第三方依赖，只需要 tsc 与 @types/node。
# 说明：
# - 用与仓库一致的 TypeScript 版本，避免构建产物与本地不一致；
# - @types/node 是**类型声明**（编译期依赖），不进入运行阶段镜像。
RUN npm install --no-save --no-audit --no-fund typescript@5.9.3 @types/node@22.20.5 \
  && npx tsc -p tsconfig.json \
  && npm uninstall --no-save typescript @types/node

# ── 运行阶段 ────────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production \
    LIFEHUB_SYNC_HOST=0.0.0.0 \
    LIFEHUB_SYNC_PORT=8787 \
    LIFEHUB_SYNC_DB_PATH=/data/lifehub-sync.db

# 只带运行期产物，不带任何源码与开发依赖。
COPY --from=builder /build/dist ./dist
COPY apps/sync-server/package.json ./

# 数据目录：SQLite 库与快照都放在这里。
RUN mkdir -p /data /snapshots \
  && chown -R node:node /data /snapshots

# 以非 root 用户运行。
USER node

# 数据卷：SQLite 库与快照。
VOLUME ["/data"]

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.LIFEHUB_SYNC_PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
