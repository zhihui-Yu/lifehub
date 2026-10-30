# @lifehub/sync-server —— 自托管同步服务（只存密文）

LifeHub 的**可选**同步后端。它存在的唯一目的是在不同设备之间搬运**密文 blob**，
让客户端自己完成解密。

> **服务端只见密文。** 服务端没有密钥、不会解密、也不知道你的业务数据长什么样。

---

## 1. 它做什么 / 不做什么

| 能力 | 说明 |
| --- | --- |
| ✅ 接收密文 blob | `POST /v1/blobs`，请求体只允许白名单字段 |
| ✅ 增量拉取密文 blob | `GET /v1/blobs?cursor=<游标>&limit=<条数>` |
| ✅ 拒绝明文字段 | 出现金额 / 对方 / 备注 / 盐值 / DEK 等字段名直接返回 400 |
| ✅ 健康检查 | `GET /healthz` |
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

## 2. 接口说明

### 2.1 上传 / 覆盖一条密文 blob

```http
POST /v1/blobs
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
{ "id": "blob-1", "seq": 1, "updatedAt": "2024-01-15T08:12:00.000Z" }
```

请求体出现**任何**明文字段（`amountMinor` / `counterparty` / `note` / `localDate` / `salt` / `dek` / `masterKey` …）
或白名单之外的字段，服务端一律返回 `400`：

```json
{ "error": "服务端只接受密文，拒绝明文字段：amountMinor" }
```

### 2.2 增量拉取

```http
GET /v1/blobs?cursor=0&limit=100
```

```json
{
  "blobs": [ /* 密文 blob 列表，按 seq 升序 */ ],
  "nextCursor": 42
}
```

把返回的 `nextCursor` 作为下次的 `cursor` 传入即可实现增量同步。
`limit` 上限为 500。

### 2.3 健康检查

```http
GET /healthz
```

```json
{ "ok": true, "service": "lifehub-sync-server" }
```

---

## 3. 自托管方式

### 3.1 本地直接运行

```bash
# 安装依赖（根目录一次性安装即可）
npm install

# 编译并启动
npm run build:sync
npm run start --workspace @lifehub/sync-server
```

默认监听 `127.0.0.1:8787`，可用环境变量覆盖：

```bash
LIFEHUB_SYNC_PORT=9000 npm run start --workspace @lifehub/sync-server
```

### 3.2 Docker

构建上下文必须是**仓库根目录**：

```bash
docker build -f apps/sync-server/Dockerfile -t lifehub-sync-server .
docker run -d --name lifehub-sync -p 8787:8787 lifehub-sync-server
```

镜像以非 root 用户 `node` 运行，只包含编译产物与 `package.json`，不含源码与开发依赖。

### 3.3 接入客户端

客户端在**设置页**填写同步服务地址即可（地址本身不属于敏感数据）。
同步开关默认关闭——**不填地址就完全没有网络流量**。

---

## 4. 存储实现说明

当前实现用内存 `Map` 存储 blob，**进程重启即丢失**。
生产部署请实现 `BlobStore` 接口（`src/server.ts` 中已导出）并替换：

```ts
export interface BlobStore {
  upsert(blob: Omit<StoredBlob, 'seq'>): Promise<StoredBlob>;
  listSince(cursor: number, limit: number): Promise<StoredBlob[]>;
}
```

可替换为 SQLite、文件或对象存储；HTTP 层无需改动。
无论用哪种实现，**存进去的都必须是密文**——这是不可协商的底线。

---

## 5. 隐私与安全

- 服务端**不采集**任何个人数据：没有手机号、设备号、定位、通讯录，没有埋点与统计 SDK。
- 服务端**没有**主口令、DEK、盐值；数据库泄露也**无法**还原任何业务数据。
- 服务端**不做**银行 / 支付平台直连，也不引入任何第三方 SDK。
- 请求体大小限制 1MB，防止恶意大包。
- 建议在反向代理层再加一层 TLS 与访问控制（例如 Basic Auth 或 IP 白名单）。

相关文档：[`docs/architecture.md`](../../docs/architecture.md) ·
[`docs/compliance-checklist.md`](../../docs/compliance-checklist.md) ·
[`README.md`](../../README.md)
