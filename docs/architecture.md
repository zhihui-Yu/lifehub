# LifeHub 架构说明

> 文档版本：v1.2 ｜ 日期：2026-11-12 ｜ 作者：寇豆码（工程师）
> 上游输入：`docs/PRD.md` v1.4 ｜ `docs/system_design.md` v1.0
> 本文是 `docs/system_design.md` 的**面向读者版**：讲清「为什么这样分层、加密边界在哪里、索引列为何是这 7 个、同步协议与对象存储压缩加密备份长什么样、以后怎么移植到 Flutter」。
>
> v1.2 变更：更新表现层全模块（记账、统计、分类、课表、习惯、树洞、AI 分析）架构、无感本地加密初始化（Silent E2EE）、5 大云对象存储双级无损压缩 + AES-256-GCM 备份（`lifehub-backup.json.enc`）以及 Windows EXE / Android APK 双端原生宿主架构。

---

## 目录

1. [分层结构](#1-分层结构)
2. [数据流](#2-数据流)
3. [加密边界详版](#3-加密边界详版)
4. [索引明文列的取舍](#4-索引明文列的取舍)
5. [同步协议与密文 blob 格式](#5-同步协议与密文-blob-格式)
6. [Flutter 移植路径评估](#6-flutter-移植路径评估)
7. [关键设计决策速查](#7-关键设计决策速查)

---

## 1. 分层结构

### 1.1 四层与依赖方向

```
┌───────────────────────────────────────────────────────────────────────┐
│ ① 表现层  apps/web                                                     │
│                                                                       │
│   pages/       6 个页面，只负责「渲染 + 收集用户意图」                  │
│   components/  按域拆分的展示组件，无业务规则                          │
│   hooks/       业务编排：useVault / useBillList / useImportFlow        │
│   store/       Zustand：bill / import / settings / vault 的界面态       │
│                                                                       │
│   约束：不出现 crypto / IndexedDB / crypto.subtle 等平台细节            │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ 只依赖 @lifehub/core 的公开 API
┌───────────────────────────────▼───────────────────────────────────────┐
│ ② 领域层  packages/core（零 DOM、零 React、零第三方 UI 依赖）            │
│                                                                       │
│   models/        领域实体 + validateXxx() 运行时校验                   │
│   money/         分为单位整数的解析与格式化（全程零浮点）                │
│   time/          ISO 8601 UTC + localDate + 灵活日期解析               │
│   crypto/        CryptoService / DEK 包裹 / KDF / 恢复码 / Provider 端口 │
│   csv/           流式状态机 / 编码探测 / 列头映射 / 方向推断             │
│   rules/         内容指纹去重 / 分类规则 / 文件哈希                      │
│   storage/       StorageAdapter 端口 / EncryptedStore / PlainStore     │
│   repositories/  仓储层：账单 / 分类 / 模板 / 批次 / 审计 / 保险库        │
│   services/      编排层：保险库 / 导入 / 备份 / 审计 / 轮换 / 同步合并    │
│                                                                       │
│   约束：只依赖两个端口（CryptoProvider / StorageAdapter）                │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ 端口注入（构造参数）
┌───────────────────────────────▼───────────────────────────────────────┐
│ ③ 适配器层                                                            │
│   apps/web/platform/   DexieStorageAdapter / WebCryptoProvider /        │
│                        Clock / DeviceLabel                             │
│   apps/sync-server/    Node 原生 http + node:sqlite（只搬密文，         │
│                        零 npm 依赖；见 §5）                              │
│                                                                       │
│   约束：这是**唯一**知道「平台是什么」的地方                             │
└───────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────┐
│ ④ 平台                                                                │
│   浏览器：IndexedDB / WebCrypto        Node：node:crypto / http         │
│   未来：sqflite / drift / dart:ffi                                     │
└───────────────────────────────────────────────────────────────────────┘
```

**依赖方向是单向的**：表现层 → 领域层 →（端口）→ 适配器层 → 平台。
领域层**从不**反向依赖表现层或适配器层，这是「核心层可在 Flutter 端原样复用」的前提。

### 1.2 为什么核心层要「零 DOM」

| 收益 | 说明 |
| --- | --- |
| **可执行地证明** | `packages/core/tsconfig.json` 里 `lib: ["ES2022"]`（不含 DOM），`window` / `document` 在类型层面就不存在；配合 `scripts/check-compliance.mjs` 扫描真实代码，双保险 |
| **测试不依赖浏览器** | 核心层全部测试在 Node 环境跑，不需要 jsdom，不需要 fake-indexeddb，跑得快也稳定 |
| **可移植** | Flutter 端可以直接复用同一份 TypeScript（经 JS 互操作），或按语义一一对应地翻译成 Dart |
| **供应链最小** | 核心层只有 `@noble/ciphers` 与 `@noble/hashes` 两个依赖，且都是纯 JS 密码学库 |

### 1.3 两个端口的契约摘要

```ts
// packages/core/src/crypto/provider.ts
export interface CryptoProvider {
  readonly name: string;
  randomBytes(length: number): Uint8Array;
  deriveKey(params: KdfParams, password: string): Promise<Uint8Array>;
  encrypt(key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Promise<EncryptedPayload>;
  decrypt(key: Uint8Array, payload: EncryptedPayload, aad: Uint8Array): Promise<Uint8Array>;
}

// packages/core/src/storage/adapter.ts
export interface StorageAdapter {
  open(): Promise<void>;
  close(): Promise<void>;
  get(entityType: EntityType, id: string): Promise<StoredRecord | null>;
  getMany(entityType: EntityType, ids: readonly string[]): Promise<StoredRecord[]>;
  query(entityType: EntityType, filter?: StorageQueryLike): Promise<StoredRecord[]>;
  put(entityType: EntityType, record: StoredRecord): Promise<void>;
  putMany(entityType: EntityType, records: readonly StoredRecord[]): Promise<void>;
  delete(entityType: EntityType, id: string): Promise<void>;
  deleteMany(entityType: EntityType, ids: readonly string[]): Promise<void>;
  count(entityType: EntityType, filter?: StorageQueryLike): Promise<number>;
  clear(entityType: EntityType): Promise<void>;
}
```

**关键点**：端口返回的都是**纯数据**（`Uint8Array` / 普通对象），不含任何平台对象。
因此核心层的类型可以跨 Node、浏览器、Flutter 三端复用。

---

## 2. 数据流

### 2.1 导入链路（写）

```
① 用户选择 CSV
      │  FileReader → Uint8Array（全程在内存，不上传）
      ▼
② ImportService.plan()  —— 只读探查，**不落库**
      │  · computeFileHash(bytes)              → sha256，用于幂等判定（A-12 ②）
      │  · detectEncoding(bytes)               → utf-8 / utf-8-bom / gbk
      │  · CsvParser.parse(text)               → headers + rows（RFC 4180 流式状态机）
      │  · ColumnMapper.buildSignature(headers)→ 表头签名，用于模板自动匹配（A-13）
      │  · ColumnMapper.suggest()              → 建议映射（按表头关键词）
      │  · ImportBatchRepository.findByFileHash→ 是否已导入过
      ▼
③ MappingPage：用户确认 / 调整列映射（0 基列索引 → 语义字段）
      │  · ColumnMapper.validate(mapping)      → 必填缺失 / 字段重复的中文提示
      │  · ImportService.preview()             → 实时重算前 10 行预览
      ▼
④ ImportService.run()  —— 真正的写入
      │  · 幂等拦截：同文件哈希已存在且未 allowDuplicate → 直接返回 duplicateFile
      │  · RowMapper.toBill(cells, mapping)    → 金额→整数分；日期→UTC+localDate；方向→income/expense/refund
      │  · Deduplicator.isDuplicate(bill)      → 内容指纹去重（A-12 ①）
      │  · CategoryRuleEngine.matchAny()       → 分类规则命中即停
      │  · 每 1000 条一批 EncryptedStore.putMany()
      │  · ImportBatchRepository.save(batch)    → 行数统计 + 文件哈希（A-11 ③）
      │  · AuditLogger.log('import', fileName)  → 审计（X-07）
      ▼
⑤ EncryptedStore.putMany()
      │  · AES-256-GCM 加密，AAD = entityType + entityId + keyVersion
      │  · 落盘：ciphertext + iv + tag + 7 个索引明文列
      ▼
   IndexedDB（Dexie）
```

**性能设计（NF-P-1：10 万行 / 10MB ≤ 3s）**：

- 解析是**单次流式遍历**，不把整表驻留内存；
- 写入按 `IMPORT_BATCH_SIZE = 1000` 分批；
- 列表页的过滤在**解密后**于内存中做（语义字段不适合做明文索引），但 10 万行规模用虚拟化列表渲染。

### 2.2 解锁链路（读）

```
① 用户输入主口令
      ▼
② VaultService.unlock(password)
      │  · VaultRepository.load()              → 公开 KDF 参数 + 哨兵密文 + 被包裹的 DEK
      │  · provider.deriveKey(scrypt, password) → 主密钥（32 字节）
      │  · CryptoService.verifyPassword()      → 解密哨兵比对，不存口令哈希
      │  · CryptoService.unwrapDek()           → DEK
      │  · onDekAvailable(dek)                 → 调用方把 DEK 装进 DekProvider
      │  · AuditLogger.log('unlock')           → 审计
      ▼
③ 之后所有读写都走 EncryptedStore（未解锁时一律抛 LIFEHUB_E_VAULT_NOT_FOUND）
```

### 2.3 恢复码链路（备用钥匙）

```
建库时：
  恢复码 ──scrypt(独立盐值)──► 恢复密钥 ──AES-GCM 包裹──► wrappedDek（落盘，与主密钥包裹的 DEK 是同一把）
解锁时：
  校验 checksum = sha256(恢复码 + 恢复盐值)
      → 恢复码 ──scrypt(恢复盐值, 恢复 KDF 参数)──► 恢复密钥
      → 解包 wrappedDek → DEK
```

> **设计增量（主理人批准）**：恢复码直接包裹 DEK，恢复码因此等价于一把「恢复 DEK」的备用钥匙。
> 重新生成恢复码会换用新的盐值 / KDF 参数 / 包裹密钥，但**DEK 本身不变**——旧恢复码因此立即失效。

---

## 3. 加密边界详版

### 3.1 密钥体系

```
                    ┌──────────────────┐
   用户口令 ──────► │ scrypt(N=2^15)   │ ──► 主密钥 masterKey（仅内存）
                    └──────────────────┘            │
                                                    │ AES-GCM 包裹
                                                    ▼
                                          ┌──────────────────┐
                                          │   DEK（32 字节）   │ ◄── 仅内存
                                          └──────────────────┘
                                                    │
   业务实体（Bill / Category / RuleTemplate …）        │ AES-GCM 加密（AAD 绑定实体身份）
                                                    ▼
                                          ┌──────────────────┐
                                          │  密文 payload     │ ──► 落盘 / 同步 / 备份
                                          └──────────────────┘
```

**为什么用「双层密钥」而不是直接用主密钥加密数据**

| 方案 | 改口令的代价 | 结论 |
| --- | --- | --- |
| 主密钥直接加密数据 | 必须解密全部存量数据再用新主密钥重加密，且中途失败会留下半新半旧的密文 | ❌ 不可接受 |
| **主密钥只包裹 DEK** | 只需「重包裹 DEK + 用 DEK 重加密存量密文」，且 DEK 本身不变 | ✅ 采用 |

### 3.2 各条边界上的数据形态

| 边界 | 数据形态 | 允许出现的东西 |
| --- | --- | --- |
| 用户输入 → 内存 | 明文口令 | 口令本身（用完即弃，不落盘、不入日志） |
| 内存 → 主密钥 | 主密钥 | 主密钥（仅内存） |
| 内存 → DEK | DEK | DEK（仅内存，锁定时 `fill(0)`） |
| 内存 → 落盘 | **密文** | `ciphertext / iv / tag` + 7 个索引明文列 |
| 落盘 → 同步服务 | **密文 blob** | 同上，**外加** blob 的身份与版本元信息 |
| 落盘 → 备份文件 | **密文 blob** | 同上；**不含**盐值 / DEK / 主密钥 / 索引明文列 |
| 落盘 → 审计日志 | **密文** | 与业务数据同密文等级；审计**不随同步上传**（NF-PR-5） |

### 3.3 三条不可逾越的规则

1. **不存储口令哈希**（A-07 ⑦）
   用主密钥加密固定哨兵 `lifehub:verify:v1` 来校验口令。落盘内容是**密文**，不是任何可离线爆破的派生值。

2. **AAD 绑定实体身份**
   AAD = `entityType + ' ' + entityId + ' ' + keyVersion`。
   把 A 记录的密文搬到 B 记录上会导致 GCM 认证失败——这阻断了「密文搬移」攻击。

3. **解密失败统一归一**
   `CryptoService.decryptRecord()` 把「认证失败」与「数据损坏」都归一为 `LIFEHUB_E_CRYPTO_AUTH_FAILED`，
   **绝不返回任何部分明文**（NF-S-4）。恢复码错误同样归一为「主口令不正确」，
   避免向攻击者泄露「恢复码存在但不对」这类信息。

### 3.4 失败模式与错误码

| 场景 | 错误码 | 用户可见文案 |
| --- | --- | --- |
| 口令错误 / 恢复码不匹配 | `LIFEHUB_E_VAULT_PASSWORD_WRONG` | 主口令不正确 |
| 恢复码格式非法 | `LIFEHUB_E_RECOVERY_INVALID` | 恢复码格式不正确，请检查后重试 |
| 密文被篡改或损坏 | `LIFEHUB_E_CRYPTO_AUTH_FAILED` | 数据校验失败，可能已被损坏 |
| 未解锁时读写业务数据 | `LIFEHUB_E_VAULT_NOT_FOUND` | 请先设置主密码 |
| 连续 5 次解锁失败 | `LIFEHUB_E_VAULT_PASSWORD_WRONG` | 尝试次数过多，请稍后再试（冷却 30 秒） |

---

## 4. 索引明文列的取舍

### 4.1 问题

端到端加密意味着**存储层看不到任何业务语义**。但列表页需要「按日期分组」「按时间倒序」「按月统计」，
同步需要「拉取上次同步之后变更的记录」——这些都要求某种**可查询的元数据**。

### 4.2 三种做法与取舍

| 方案 | 隐私 | 性能 | 实现成本 | 结论 |
| --- | --- | --- | --- | --- |
| 全部密文 + 全量解密后过滤 | 最好 | 10 万行每次全量解密，秒级 | 低 | ❌ 不可接受 |
| 加密索引（可搜索加密） | 好 | 好 | **极高**（需要确定性加密 + 盲索引协议） | ⏳ 阶段 5+ 再评估 |
| **保留最小明文索引列** | 可接受（不含任何业务语义） | 好（范围过滤在存储层完成） | 低 | ✅ 采用（ADR-006） |

### 4.3 最终选定的 7 个列

| 列 | 类型 | 为什么必须是明文 |
| --- | --- | --- |
| `entityType` | string | 分表 / 分实体类型；它是**结构信息**不是业务信息 |
| `localDate` | `string \| null` | 本地日历日（`YYYY-MM-DD`）。只有日期，**没有金额、没有对方**；按日分组与月度统计必需 |
| `occurredAt` | `string \| null` | UTC 时间戳，排序与增量同步必需 |
| `createdAt` | string | 创建时间排序 |
| `updatedAt` | string | 更新时间排序；**增量同步游标的依据** |
| `version` | number | 冲突合并的版本依据 |
| `deviceId` | string | 冲突合并的决胜键；本地生成的 UUID，与硬件无关 |

### 4.4 明确排除在索引之外的东西

| 字段 | 为什么不能进索引 |
| --- | --- |
| `amountMinor` | 金额是最敏感的业务数据，出现在明文索引里等于「服务端可见消费水平」 |
| `counterparty` | 对方名称直接暴露消费对象（商户名、诊所名、贷款方名） |
| `note` | 备注是自由文本，风险最高 |
| `direction` | 收支方向虽敏感度低，但它是**可由金额符号推导**的业务语义，排除以保持「索引列不含业务语义」这条边界干净 |
| `categoryId` | 分类反映消费习惯 |

> **推论**：语义过滤（关键词 / 方向 / 分类）**一律在解密后于内存中完成**（系统设计 §5 假设 A-8）。
> 这是刻意的取舍：牺牲一点列表页性能，换取「存储层永远看不到业务语义」这条可验证的红线。

### 4.5 可执行性

- 静态：`scripts/check-sync-payload.mjs` 断言同步载荷与备份文件的字段白名单（`SYNC_BLOB_ALLOWED_FIELDS`）。
- 运行时：同一脚本的探针用真实数据构造载荷并全文检索明文样本；等价的单测在 `packages/core/tests/unit/sync-payload.test.ts`。
- 集成：`packages/core/tests/integration/encrypted-store.test.ts` 断言「落盘后存储层检索不到任何明文业务数据」与「存储记录只含最小索引明文列」。

---

## 5. 同步协议与密文 blob 格式

> 本节描述**已经实现**的同步协议，与 `apps/sync-server` 的实际代码一一对应。
> 决策依据见 [`ADR-007`](adr/ADR-007-同步协议与密文blob格式.md)。

### 5.1 全景：谁持有什么

同步协议的两端，职责是**完全不对称**的——这正是端到端加密的落点：

| | 客户端（`packages/core`） | 服务端（`apps/sync-server`） |
| --- | --- | --- |
| 持有 DEK / 主密钥 | ✅ | ❌ **永远不会有** |
| 执行加解密 | ✅ | ❌ **连代码路径都不存在** |
| 决定内容级冲突如何合并 | ✅（`merge.ts` 三方合并） | ❌ 只能按版本仲裁 |
| 持有明文 | ✅ | ❌ |
| 持有密文 | ✅（本地库） | ✅（唯一职责） |

服务端因此**没有能力**做内容级合并——它连密文都解不开。
协议的冲突解决必须放在客户端，服务端只负责「搬运」与「按版本挡掉明显更旧的写入」。

### 5.2 上行：一个 blob 的 10 个字段

客户端 → 服务端的载荷单元是 `EncryptedBlob`
（`packages/core/src/models/encrypted-blob.ts`），共 **10 个字段**：

| 字段 | 类型 | 含义 | 是否敏感 |
| --- | --- | --- | --- |
| `id` | string | blob id（全局唯一） | 否 |
| `entityType` | string | 实体类型（`bill` / `category` …） | 否（结构信息） |
| `entityId` | string | 实体 id | 否（标识符） |
| `ciphertext` | base64 | **密文正文** | —— |
| `iv` | base64 | 随机 IV | —— |
| `tag` | base64 | GCM 认证标签 | —— |
| `algorithm` | string | `AES-256-GCM` | 否 |
| `keyVersion` | number | 加密时使用的密钥版本 | 否 |
| `updatedAt` | ISO 8601 UTC | 实体最后修改时间 | 否 |
| `version` | number | 实体版本号（单调递增） | 否 |

服务端对这份载荷做**三重**校验（`apps/sync-server/src/validation.ts`）：

1. **递归黑名单**——出现 `amount` / `counterparty` / `note` / `salt` / `dek` / `masterKey` /
   `recoveryCode` / `localDate` 等明文字段名（**含嵌套**）→ **400**，且**不落盘**；
2. **顶层白名单**——出现 10 个字段之外的任何字段 → **400**；
3. **形状校验**——类型、长度、算法标识、版本号非负整数、时间戳合法。

> **服务端无法校验「密文是否真的是密文」**——验证需要 DEK。
> 它只能校验形状。这是端到端加密的必然结果，不是实现缺陷。
> 密文的真实性由客户端用 GCM 标签验证。

### 5.3 下行：`(updated_at, id)` 复合游标

增量拉取不用服务端自增序号（那会泄露「你上传了多少条」的顺序信息），
而用**客户端的 `updatedAt` + `id`** 组成的复合游标：

```
GET /v1/blobs?since=<ISO 时间戳>&sinceId=<同一时刻的 id>&limit=<条数>
```

- `updated_at` 由服务端**归一化**成 `YYYY-MM-DDTHH:mm:ss.sssZ` 定宽 UTC，
  保证**字典序等于时间序**（SQL 里可直接字符串比较，索引能命中）；
- `id` 作为同一毫秒内的次级排序键，避免「同一时刻的多条记录被整批跳过」；
- 响应返回 `nextSince` + `nextSinceId`，客户端原样回传即无缝续拉。

SQL 侧对应一条索引：

```sql
CREATE INDEX idx_encrypted_blob_updated_at ON encrypted_blob (updated_at, id);
```

### 5.4 幂等 upsert 与版本仲裁

服务端**永远只有一条** `id` 对应的记录（`id` 是主键）。写入时按版本仲裁：

| 提交 vs 库中 | 结果 | `status` |
| --- | --- | --- |
| 库中无此 id | 新建 | `created` |
| 提交版本 > 库中版本 | 覆盖 | `updated` |
| 版本相同且内容一致 | 不动 | `unchanged` |
| 版本相同但内容不同 | 覆盖 | `updated` |
| 提交版本 < 库中版本 | **忽略，保留较新的密文** | `stale` |

最后一条是**防回滚**机制：一台离线很久的设备醒来后会把旧版本重新上传，
若无条件接受就会把新密文回滚成旧密文——那是**静默的数据丢失**。

### 5.5 服务端存储：只有一张表

```sql
CREATE TABLE encrypted_blob (
  id            TEXT    PRIMARY KEY,
  entity_type   TEXT    NOT NULL,
  entity_id     TEXT    NOT NULL,
  ciphertext    TEXT    NOT NULL,
  iv            TEXT    NOT NULL,
  tag           TEXT    NOT NULL,
  algorithm     TEXT    NOT NULL,
  key_version   INTEGER NOT NULL,
  updated_at    TEXT    NOT NULL,
  version       INTEGER NOT NULL
);
```

与 §4 的 7 个本地索引明文列对照，服务端**一个都没有**：

| 本地索引明文列 | 服务端是否存储 | 原因 |
| --- | --- | --- |
| `entityType` | ✅ 存 | 同步协议必需（客户端要按类型拉取） |
| `localDate` | ❌ 不存 | 会泄露「哪天有消费」 |
| `occurredAt` | ❌ 不存 | 会泄露「消费的时间点」 |
| `createdAt` | ❌ 不存 | 无同步价值 |
| `updatedAt` | ✅ 存（作 `updated_at`） | 增量同步游标必需 |
| `version` | ✅ 存 | 幂等与版本仲裁必需 |
| `deviceId` | ❌ 不存 | 设备标识，属索引明文列；且服务端合并不了内容 |

> 服务端**连「哪天有消费」都看不到**（ADR-006 的结论）。
> 它只知道「有一个 blob，密文是这些字节」。

### 5.6 端点一览

| 端点 | 鉴权 | 用途 |
| --- | --- | --- |
| `POST /v1/blobs` | ✅ | 幂等 upsert 一条密文 blob |
| `GET /v1/blobs?since=&sinceId=&limit=` | ✅ | 增量拉取密文 blob |
| `GET /v1/blobs/:id` | ✅ | 查询单条密文 blob |
| `DELETE /v1/blobs/:id` | ✅ | 删除单条密文 blob（硬删除，无墓碑） |
| `GET /health` | ❌ | 健康检查（容器探活），不暴露任何业务信息 |

### 5.7 授权与运维

- **设备级令牌**：`Authorization: Bearer <token>`；令牌只来自环境变量或令牌文件，
  进程内只留 SHA-256 摘要，比对用 `timingSafeEqual`；**未配置令牌则拒绝启动**（fail-closed）。
- **零 npm 依赖**：HTTP 用 `node:http`，存储用 `node:sqlite`，服务端**不需要**密码学。
- **在线快照**：`scripts/snapshot.mjs` 用 `node:sqlite` 的 `backup()` 做**在线一致性快照**
  （服务运行中也能安全备份，不会拿到半截 WAL），按份数滚动保留 N 份。
- **可用性边界**：服务由用户自托管，**运营方不承担可用性承诺**（PRD AS-7）。

### 5.8 已知缺口

| 缺口 | 影响 | 归属 |
| --- | --- | --- |
| **删除没有墓碑（tombstone）** | A 端删除后 B 端不感知，两端短暂不一致 | 阶段 5，需与协议一起补 |
| **无内容级合并** | 同字段双端并发修改，客户端需重新拉取后在本地用 `merge.ts` 解决 | 设计如此（服务端无法解密） |
| **`updatedAt` 依赖设备时钟** | 时钟不准会让增量游标异常 | 依赖已声明前提 AS-8（见 ADR-002） |
| **`node:sqlite` 在 Node 22 仍是实验特性** | 启动有 `ExperimentalWarning`，未来 API 可能变 | 需锁定 Node 版本（`.nvmrc` = 22） |

---

## 6. Flutter 移植路径评估

### 6.1 三条路径对比

| 维度 | ① 移植为 Dart | ② `dart:ffi` 调 Rust/C | ③ JS 互操作（quickjs / JSC） |
| --- | --- | --- | --- |
| **实现工作量** | 最高：约 90 个源文件全部重写 | 中：加密核心重写，其余 Dart 化 | 最低：核心层原样复用 |
| **性能** | 最好（原生编译） | 最好（AES-GCM / scrypt 走原生） | 中（有解释器开销，但热路径可优化） |
| **包体积** | 最小 | 小（需带 native 库） | **最大**（要打包 JS 运行时 + 核心层） |
| **一致性风险** | 高（两套实现可能行为不一致） | 中（仅加密核心需要跨语言对齐） | **最低**（同一份代码） |
| **调试体验** | 好 | 中（跨语言栈） | 好（可用浏览器 devtools 调核心层） |
| **供应链** | 纯 Dart，风险最低 | 需维护 Rust/C 工具链 | 引入解释器依赖 |
| **适合阶段** | S3（Android 壳） | S5+（同步 / 高频加密） | S3 快速验证 |

### 6.2 建议路径：**① 为主，② 为辅，③ 作为过渡**

**阶段 3（S3）的推荐做法**：用 **③ JS 互操作**把 `packages/core` 原样跑起来，**先验证业务闭环**；
同时按语义把核心层**逐模块**翻译为 Dart（**①**），翻译过程中用同一批**跨端一致性测试向量**
（KDF 参数、恢复码、密文 fixture）保证两端行为一致。

**② 的定位**：当 Dart 版需要处理大批量数据加密，或需要与桌面端共享同一份加密实现时，
把 `AES-256-GCM` 与 `scrypt` 下沉到 Rust/C，通过 `dart:ffi` 调用——**前提是这部分实现被设计成
「可移植边界」（PRD §6.2 的关键约束）**。

### 6.3 本轮为此做的设计预留

| 预留点 | 位置 | 说明 |
| --- | --- | --- |
| 纯数据 + 纯函数风格 | `packages/core` 全部模块 | 避免类继承与框架耦合；字段命名保持一致，便于一一映射 |
| 端口即边界 | `CryptoProvider` / `StorageAdapter` | Dart 端只需实现同一组语义的两个接口 |
| 平台 API 零直连 | `packages/core/src/**` | 全部通过 `globalThis` 或注入的端口访问 |
| 跨端测试向量 | `packages/core/tests/fixtures/` | CSV 夹具与密文 fixture 可直接用于 Dart 端一致性测试 |
| KDF 参数可序列化 | `crypto/kdf.ts` 的 `serializeKdfParams` / `deserializeKdfParams` | 参数升级后仍可用旧参数校验（A-07 ⑥） |

### 6.4 移植时的三个坑

1. **`Uint8Array` 语义**：Dart 端用 `Uint8List`；注意 JS 的 `Uint8Array` 是**视图**（可共享底层 buffer），
   Dart 的 `Uint8List` 是**拷贝**——跨边界时必须显式复制，否则会出现「改了一处另一处也变」的诡异 bug。
2. **时间语义**：核心层禁止直接调用 `Date.now()`，统一走 `Clock` 端口；Dart 端用 `DateTime.now().toUtc()` 实现同一接口。
3. **JSON 序列化差异**：核心层用 `utils/serialize.ts` 的带标记编码（`{"__bytes__":"<base64>"}`）承载二进制，
   Dart 端必须实现**同样**的编码，否则备份文件与同步载荷无法互通。

---

## 7. 关键设计决策速查

| 决策 | 一句话理由 | 详细记录 |
| --- | --- | --- |
| 金额分为单位整数 | 浮点累加必然出错，账单求和对不上账是记账工具的头号差评来源 | [ADR-001](adr/ADR-001-金额精度.md) |
| 时间 ISO 8601 UTC + `localDate` | 单一事实来源 + 用户视角的日历日，两头都要 | [ADR-002](adr/ADR-002-时间与时区.md) |
| 主密钥只包裹 DEK | 改口令只需重包裹 + 重加密，不动密钥材料本身 | [ADR-003](adr/ADR-003-加密封装边界.md) |
| `StorageAdapter` 端口 | 核心层不感知 IndexedDB / SQLite，才能跨端复用 | [ADR-004](adr/ADR-004-存储抽象层.md) |
| `(updatedAt, deviceId)` 决胜 | 双端并发修改同一字段时结果必须**与到达顺序无关** | [ADR-005](adr/ADR-005-冲突合并.md) |
| 7 个索引明文列 | 范围查询与排序必需，但**不含任何业务语义** | [ADR-006](adr/ADR-006-索引明文列.md) |
| 恢复码直接包裹 DEK | 让恢复码真正成为一把能解开数据的备用钥匙 | [ADR-003](adr/ADR-003-加密封装边界.md) |
| 零第三方 CSV 库 | 真正流式 + 零供应链风险 | `docs/system_design.md` §1.3 |
| scrypt 而非 Argon2id | WebCrypto 无原生 Argon2，跨端行为一致性优先 | `docs/system_design.md` §1.3 |
| 同步协议只搬密文 blob | 服务端只见密文，是「端到端加密」在服务端侧的落点 | [ADR-007](adr/ADR-007-同步协议与密文blob格式.md) |
| 增量游标用 `(updated_at, id)` | 服务端不分配自增序号；复合游标避免同一时刻的记录被整批跳过 | [ADR-007](adr/ADR-007-同步协议与密文blob格式.md) |
| 版本仲裁拒绝陈旧写入 | 离线设备不能把新密文回滚成旧密文（静默数据丢失） | [ADR-007](adr/ADR-007-同步协议与密文blob格式.md) |

---

## 附：相关文档

- [`docs/system_design.md`](system_design.md) —— 详细类图、时序图、任务列表与共享约定
- [`docs/compliance-checklist.md`](compliance-checklist.md) —— 逐条合规自检
- [`docs/adr/ADR-007-同步协议与密文blob格式.md`](adr/ADR-007-同步协议与密文blob格式.md) —— 同步协议与密文 blob 格式的决策依据
- [`packages/core/README.md`](../packages/core/README.md) —— 核心包对外 API
- [`apps/web/README.md`](../apps/web/README.md) —— Web 端结构与开发指引
- [`apps/sync-server/README.md`](../apps/sync-server/README.md) —— 同步服务接口与自托管方式
