# @lifehub/sync-server —— 自托管同步服务（只存密文）

LifeHub 的**可选**同步后端。它存在的唯一目的是在不同设备之间搬运**密文 blob**，
让客户端自己完成解密。

> **服务端只见密文。** 服务端没有密钥、不会解密、也不知道你的业务数据长什么样。

---

## 1. 它做什么 / 不做什么

| 能力 | 说明 |
| --- | --- |
| ✅ 接收密文 blob | `POST /v1/blobs`，请求体只允许白名单字段 |
| ✅ 增量拉取密文 blob | `GET /v1/blobs?since=<ISO 时间戳>&limit=<条数>` |
| ✅ 查询 / 删除单条 | `GET /v1/blobs/:id` / `DELETE /v1/blobs/:id` |
| ✅ 拒绝明文字段 | 出现金额 / 对方 / 备注 / 盐值 / DEK 等字段名直接返回 400，**且绝不落盘** |
| ✅ 设备级授权 | `Authorization: Bearer <token>`，未授权返回 401 |
| ✅ 健康检查 | `GET /health`（无需令牌，供容器探活） |
| ✅ 在线快照备份 | `scripts/snapshot.mjs`，定时快照 SQLite 并保留 N 份 |
| ❌ 解密任何数据 | 服务端没有 DEK、没有主口令、没有盐值，**物理上无法**解密 |
| ❌ 采集任何信息 | 不采集手机号 / 设备号 / 定位 / 通讯录，无埋点、无统计 SDK |
| ❌ 直连银行 | 不接入任何银行 / 支付平台开放接口 |

客户端与服务器的分工：

```
客户端 A                     同步服务                    客户端 B
   │  密文 blob                 │                            │
   │ ──── POST /v1/blobs ────► │                            │
   │                            │ ◄──── GET /v1/blobs ────── │  拉取增量
   │                            │ ──── 密文 blob ─────────► │  本地解密
```

**密钥永远不离开客户端**：A 用自己的 DEK 加密数据 → 密文上传 → B 用**同一把** DEK 解密。
服务端只是「密文的中转站」。

---

## 2. 能力边界（重要，请务必读完）

这条边界是本服务的**全部安全承诺**，也是它与「云端备份服务」的根本区别：

| 服务端**有** | 服务端**没有** |
| --- | --- |
| 密文字节（`ciphertext / iv / tag`） | 主口令、主密钥（`masterKey`） |
| 实体类型与实体 id（`entityType / entityId`） | 数据密钥（`DEK`）、被包裹的 DEK |
| 加密算法标识、密钥版本号 | 保险库盐值、恢复码 |
| 密文的更新时间与版本号 | **任何**业务明文：金额、方向、对方、备注、分类 |
| —— | 任何解密能力（连「尝试解密」的代码路径都不存在） |

由此推出三条**可验证**的结论：

1. **数据库整体泄露也无法还原任何业务内容** —— 库里根本没有明文列。
2. **服务端被攻破也无法读取你的数据** —— 它手里只有你客户端的公钥材料都算不上的东西。
3. **服务端运维者看不到你的消费记录** —— 它甚至不知道「哪条记录对应哪笔消费」。

**但也要如实说明服务端的「能看见」**（透明起见）：

- 服务端**知道**你有多少条加密记录、每条记录多长、什么时间改的。
- 服务端**知道**这些记录属于哪些实体类型（`bill` / `category` …）与实体 id。
- 服务端**知道**你用了哪个密钥版本，便于你轮换密钥时定位。

这些是**同步协议必需的元信息**，不含任何业务语义。
若你连这些都不愿意暴露，那就**不要自托管同步服务**——改用纯本地模式即可。

### 不提供长期可用性承诺（AS-7）

> **本服务由用户自行托管，运营方不承担可用性承诺（PRD AS-7）。**

服务停机、数据损坏、磁盘写满、忘记备份——**都由你自己负责**。
LifeHub 不托管你的同步服务，也不承诺它的长期可用性。
请务必配置**定期快照备份**（见 §6），并把快照放到**另一台设备 / 另一块磁盘**上。

---

## 3. 接口说明

所有 `/v1/*` 端点都需要 `Authorization: Bearer <token>`；未授权返回 **401**。

### 3.1 上传 / 覆盖一条密文 blob

```http
POST /v1/blobs
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "id": "blob-1",
  "entityType": "bill",
  "entityId": "bill-1",
  "ciphertext": "<base64>",
  "iv": "<base64>",
  "tag": "<base64>",
  "algorithm": "AES-256-GCM",
  "keyVersion": 1,
  "updatedAt": "2024-01-15T08:12:00.000Z",
  "version": 1
}
```

成功返回：

```json
{ "id": "blob-1", "status": "created", "version": 1, "updatedAt": "2024-01-15T08:12:00.000Z" }
```

`status` 的取值：

| 值 | 含义 |
| --- | --- |
| `created` | 首次写入，新建了记录 |
| `updated` | 版本号更高，覆盖了旧密文 |
| `unchanged` | 内容与库中完全一致（幂等重放，**不会**产生重复记录） |
| `stale` | 提交的版本比库中更旧，被**忽略**（防止离线设备把新密文回滚成旧密文） |

请求体出现**任何**明文字段（`amount` / `amountMinor` / `counterparty` / `note` / `title` / `body` /
`localDate` / `salt` / `dek` / `masterKey` / `recoveryCode` …）或白名单之外的字段，
服务端一律返回 `400`，并且**这条请求不会写入数据库**：

```json
{ "error": "服务端只接受密文，拒绝明文字段：amount（位置 amount）" }
```

### 3.2 增量拉取

```http
GET /v1/blobs?since=<ISO 时间戳>&limit=<条数>
```

```json
{
  "blobs": [ /* 密文 blob 列表，按 updatedAt 升序 */ ],
  "count": 2,
  "nextSince": "2024-01-15T08:12:00.000Z",
  "nextSinceId": "blob-2"
}
```

- `since` 省略时返回全部；`limit` 上限 500，默认 100。
- 分页游标是 `nextSince` + `nextSinceId` **一对**：把 `nextSince` 作为下次的 `since`，
  把 `nextSinceId` 作为下次的 `sinceId` 一起传回，即可在「同一毫秒有多条记录」时也不漏拉。
- 服务端只返回 `updatedAt` **晚于** `since` 的记录。

### 3.3 查询单条

```http
GET /v1/blobs/:id
```

命中返回该 blob（字段同上），未命中返回 `404`。

### 3.4 删除单条

```http
DELETE /v1/blobs/:id
```

```json
{ "id": "blob-1", "deleted": true }
```

未命中返回 `404`。

> ⚠️ 当前删除是**硬删除**，不产生墓碑（tombstone）。
> 这意味着「A 端删除、B 端仍在」时，B 端不会自动感知删除——
> 墓碑协议属于同步协议本身的设计（见 `docs/roadmap.md` 阶段 5 的前置提醒），尚未实现。

### 3.5 健康检查

```http
GET /health
```

```json
{ "ok": true, "service": "lifehub-sync-server", "uptimeSeconds": 42 }
```

不需要令牌（便于容器探活），且**不暴露任何业务信息**。

---

## 4. 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LIFEHUB_SYNC_TOKENS` | —— | **必填**。设备令牌，逗号分隔。支持 `标签=令牌` 写法（如 `phone=abc,laptop=def`）；裸令牌自动获得 `device-N` 标识 |
| `LIFEHUB_SYNC_TOKEN_FILE` | —— | 令牌文件路径，一行一条（`标签=令牌`）。与上一项**同时**设置时两者都会生效 |
| `LIFEHUB_SYNC_HOST` | `127.0.0.1` | 监听地址。容器内必须设为 `0.0.0.0` |
| `LIFEHUB_SYNC_PORT` | `8787` | 监听端口 |
| `LIFEHUB_SYNC_DB_PATH` | `./data/lifehub-sync.db` | SQLite 文件路径 |
| `LIFEHUB_SYNC_DEFAULT_PAGE_SIZE` | `100` | 增量拉取默认条数 |
| `LIFEHUB_SYNC_MAX_PAGE_SIZE` | `500` | 增量拉取最大条数 |
| `LIFEHUB_SYNC_MAX_BODY_BYTES` | `1048576` | 请求体大小上限（1MB） |
| `LIFEHUB_SYNC_CORS_ORIGIN` | 空（不启用） | 允许的跨域来源。**默认关闭**，仅在浏览器直连时按需开启 |

> **未配置任何令牌时服务会拒绝启动**（fail-closed），绝不会退化成「匿名可写」。
> 令牌**不硬编码、不入库、不落日志**；进程内只保留其 SHA-256 摘要，
> 比对使用 `timingSafeEqual`（防时序攻击）。

---

## 5. 自托管部署

### 5.1 本地直接运行（开发 / 单机试用）

```bash
# 仓库根目录一次性安装依赖
npm install

# 编译同步服务
npm run build:sync

# 起服务（令牌由环境变量注入）
export LIFEHUB_SYNC_TOKENS="dev-token-$(node -e 'console.log(require("node:crypto").randomBytes(16).toString("hex"))')"
export LIFEHUB_SYNC_DB_PATH="./data/lifehub-sync.db"
npm run start --workspace @lifehub/sync-server
```

验证：

```bash
curl http://127.0.0.1:8787/health
# => {"ok":true,"service":"lifehub-sync-server","uptimeSeconds":0}
```

### 5.2 Docker Compose（推荐）

见仓库根目录的 [`docker-compose.yml`](../../docker-compose.yml)：

```bash
cp .env.example .env          # 填入 LIFEHUB_SYNC_TOKENS
docker compose up -d
docker compose logs -f lifehub-sync
```

### 5.3 三种典型场景

#### 场景 A：NAS（群晖 / 威联通 / 极空间）

1. 用 Container Station / Docker 应用新建项目，指向仓库的 `docker-compose.yml`；
2. 在 `.env` 里填 `LIFEHUB_SYNC_TOKENS`，**每台设备一个令牌**；
3. 端口映射建议只绑 `127.0.0.1:8787`，再用反向代理（群晖的「反向代理」或 nginx）套 TLS；
4. 把数据卷 `lifehub-sync-data` 指向 NAS 的共享文件夹（便于 NAS 自带的快照 / 备份）；
5. **把 NAS 的定时备份指向 `/data/snapshots`**——这是你的第二道防线。

#### 场景 B：VPS（公网服务器）

1. `docker compose up -d`，但把端口映射改成 `127.0.0.1:8787:8787`（**不要**直接暴露公网）；
2. 用 nginx / Caddy 反代并开启 TLS（Let's Encrypt 自动签发）；
3. 在反代层再加一层限流与 IP 白名单；
4. 客户端填写 `https://你的域名` 作为同步地址。

> ⚠️ 公网暴露的同步服务会成为攻击面。即使服务端只见密文，
> 攻击者仍可**用你的令牌写入垃圾数据**或**打满你的磁盘**。
> 令牌务必保密、定期轮换，并务必配置快照备份。

#### 场景 C：内网 / 局域网

1. 直接监听内网地址：`LIFEHUB_SYNC_HOST=0.0.0.0` + 端口映射到局域网；
2. 若客户端是浏览器直连，另设 `LIFEHUB_SYNC_CORS_ORIGIN=http://<你的前端地址>`；
3. 内网也**建议**走 TLS（自签名证书或内网 CA），避免令牌在局域网内明文传输。

### 5.4 接入客户端

客户端在**设置页**填写同步服务地址即可（地址本身不属于敏感数据）。
同步开关默认关闭——**不填地址就完全没有网络流量**。

每台设备使用**各自独立的令牌**，这样某台设备丢失时可以单独吊销它。

---

## 6. 备份与快照

服务端数据库里虽然只有密文，但**丢了就没了**（那是你的数据）。

```bash
# 手动做一次快照
LIFEHUB_SYNC_DB_PATH=./data/lifehub-sync.db \
LIFEHUB_SYNC_SNAPSHOT_DIR=./data/snapshots \
LIFEHUB_SYNC_SNAPSHOT_KEEP=7 \
node scripts/snapshot.mjs
```

快照使用 SQLite 的**在线备份 API**（`node:sqlite` 的 `backup()`），
因此**服务运行中也能安全备份**，不会拿到半截的 WAL 文件。

用 cron 定时执行（`scripts/snapshot.sh` 是包装脚本）：

```cron
17 3 * * * /opt/lifehub/scripts/snapshot.sh >> /var/log/lifehub-snapshot.log 2>&1
```

Docker Compose 里的 `lifehub-sync-snapshot` 服务已经内置了每晚 03:17 的定时快照。

> **务必把快照复制到另一台设备 / 另一块磁盘**——同一块盘上的备份，
> 在磁盘损坏时和你一起消失。

---

## 7. 存储实现说明

数据库使用 Node 22 内置的 `node:sqlite`（**零 npm 依赖**，无原生模块编译链）。
库里**只有一张表** `encrypted_blob`，字段与 `EncryptedBlob` 严格一一对应：

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT | blob id（主键，**幂等 upsert 的依据**） |
| `entity_type` | TEXT | 实体类型 |
| `entity_id` | TEXT | 实体 id |
| `ciphertext` | TEXT | 密文正文（base64） |
| `iv` | TEXT | 随机 IV（base64） |
| `tag` | TEXT | GCM 认证标签（base64） |
| `algorithm` | TEXT | 加密算法标识 |
| `key_version` | INTEGER | 密钥版本 |
| `updated_at` | TEXT | 最后更新时间（增量同步游标） |
| `version` | INTEGER | 版本号（幂等与仲裁） |

**没有**任何业务明文列，也**没有**本地存储那 7 个索引明文列
（`localDate` / `occurredAt` / `deviceId` 等）——服务端连「哪天有消费」都看不到。
详见 [`ADR-007`](../../docs/adr/ADR-007-同步协议与密文blob格式.md)。

---

## 8. 隐私与安全

- 服务端**不采集**任何个人数据：没有手机号、设备号、定位、通讯录，没有埋点与统计 SDK。
- 服务端**没有**主口令、DEK、盐值；数据库泄露也**无法**还原任何业务数据。
- 服务端**不做**银行 / 支付平台直连，也不引入任何第三方 SDK。
- 请求体大小限制 1MB，防止恶意大包。
- 令牌比对使用 `timingSafeEqual`，防时序攻击；令牌只以 SHA-256 摘要形式驻留内存。
- 建议在反向代理层再加一层 TLS 与访问控制（例如 Basic Auth 或 IP 白名单）。

相关文档：[`docs/architecture.md`](../../docs/architecture.md) ·
[`docs/compliance-checklist.md`](../../docs/compliance-checklist.md) ·
[`docs/adr/ADR-007`](../../docs/adr/ADR-007-同步协议与密文blob格式.md) ·
[`README.md`](../../README.md)
