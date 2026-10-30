# LifeHub 同步服务（自托管 · 只存密文）
#
# 构建上下文必须是**仓库根目录**：
#   docker build -f apps/sync-server/Dockerfile -t lifehub-sync-server .
#
# 说明：镜像里**没有任何密钥材料**，服务端只见密文（X-01 ④ / R5）。
# 基础镜像用 node:22-alpine，体积小、启动快。

FROM node:22-alpine AS builder

WORKDIR /app

# 只复制编译所需的清单、配置与源码。
COPY tsconfig.base.json /tsconfig.base.json
COPY apps/sync-server/package.json apps/sync-server/tsconfig.json ./
COPY apps/sync-server/src ./src

# 编译 TypeScript：同步服务零第三方依赖，只需要 tsc。
RUN npm install --no-save --no-audit --no-fund typescript@5.7.2 \
  && npx tsc -p tsconfig.json \
  && npm uninstall --no-save typescript

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV LIFEHUB_SYNC_PORT=8787

# 只带运行期产物，不带任何源码与开发依赖。
COPY --from=builder /app/dist ./dist
COPY apps/sync-server/package.json ./

# 以非 root 用户运行。
USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.LIFEHUB_SYNC_PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
