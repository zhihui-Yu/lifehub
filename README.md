# LifeHub

> 跨端、本地优先、端到端加密的个人生活数据管理工具。
>
> 记账数据只存在你自己的设备上；即使使用同步服务，**服务端也只见密文**。

**文档版本**：v1.1 ｜ **日期**：2026-10-30 ｜ **当前阶段**：Sprint 0（Web 可跑 MVP + 可运行的同步服务）

---

## 目录

1. [快速开始](#1-快速开始)
2. [项目结构](#2-项目结构)
3. [架构说明](#3-架构说明)
4. [模块清单](#4-模块清单)
5. [脚本说明](#5-脚本说明)
6. [隐私与安全声明](#6-隐私与安全声明)
7. [开发路线](#7-开发路线)

---

## 1. 快速开始

### 1.1 环境要求

| 项 | 要求 | 说明 |
| --- | --- | --- |
| Node.js | **≥ 22.0.0** | 需要内置 `crypto.scrypt`（KDF）与 `node:test` 兼容的运行时 |
| npm | **≥ 10.0.0** | 需要 workspaces 支持（本仓库是 npm monorepo） |
| 浏览器 | Chrome / Edge / Firefox / Safari 近两年版本 | 依赖 WebCrypto（`crypto.subtle`） |

### 1.2 三条命令跑起来

```bash
npm install        # 安装全部 workspace 依赖（根目录执行一次即可）
npm run dev        # 启动 Web 端开发服务器
# 打开 http://localhost:4180
```

其它常用命令：

```bash
npm run build      # 构建 Web 产物到 apps/web/dist
npm run build:sync # 编译自托管同步服务到 apps/sync-server/dist
npm run test       # 运行全部 workspace 的测试（core + web + sync-server）
npm run typecheck  # 三个包的类型检查
```

### 1.2.1 多端编译与打包速览（Web / Android APK / iOS IPA / 微信小程序）

完整的多端编译步骤参见 [**`docs/build-and-packaging.md`（多端构建与打包指南）**](docs/build-and-packaging.md)：

| 目标平台 | 构建方式简述 | 产物位置 / 运行方式 |
| --- | --- | --- |
| **Web 生产包** | 根目录执行 `npm run build` | `apps/web/dist/`（部署至任意 HTTPS 静态服务器） |
| **同步服务 (Node / Docker)** | `npm run build:sync` 或 `docker compose up -d --build` | `apps/sync-server/dist/` 或 Docker 容器（默认端口 `8787`） |
| **Android APK** | 在 `apps/web` 中接入 Capacitor（`npx cap add android` → `npm run build && npx cap sync android` → `cd android && .\gradlew.bat assembleDebug`） | `apps/web/android/app/build/outputs/apk/debug/app-debug.apk` |
| **iOS IPA** | 在 macOS 下执行 `npx cap add ios` → `npm run build && npx cap sync ios` → `npx cap open ios` 使用 Xcode 签名归档 | Xcode 真机安装或 Archive 导出 `.ipa` |
| **手机 PWA** | 将 `apps/web/dist` 部署在 HTTPS 下，用手机 Chrome / Safari 打开并点击「添加到主屏幕」 | 独立全屏离线运行 |
| **微信小程序** | 企业主体可直接用 `<web-view>` 嵌入 HTTPS Web 端；个人/企业主体可用 Taro 构建表现层并直接复用零 DOM 的 `@lifehub/core`（实现小程序版 `StorageAdapter` 与 `CryptoProvider`） | 微信开发者工具编译预览与上传 |

### 1.3 首次进入的引导流程

1. 打开首页 → 首次进入会看到**「设置主密码」**引导页。
2. 输入主密码（≥ 8 位），**必须勾选**「我已知悉忘记密码将无法恢复」才能继续（X-02 ②）。
3. 创建成功后会展示一份 **12 组 × 6 字符的恢复码**（形如 `ABCDEF-GHIJKL-…`）。
   **请立刻导出并离线保存**——这是你找回数据的唯一途径（见 §6 隐私与安全声明）。
4. 导入账单：进入「导入」页 → 选择微信 / 支付宝 / 银行导出的 CSV → 确认列头映射 → 开始导入。
5. 账单列表按**本地日历日**分组展示，支持关键词 / 方向 / 日期区间 / 分类组合筛选。

### 1.4 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| `npm install` 报 `EBADENGINE` | Node 版本过低。执行 `node -v` 确认 ≥ 22，或用 `nvm use` 切换到 `.nvmrc` 指定的版本 |
| `npm run dev` 报 `listen EACCES` | 端口落入了 Windows 动态「排除端口段」（Hyper-V/WSL 保留，如 `5147-5246`）。改端口：`npm run dev -- --port 4180`，或用 `netsh int ipv4 show excludedportrange protocol=tcp` 自查 |
| 页面提示「本地数据读写失败」 | 浏览器禁用了 IndexedDB（例如隐私模式）。请用普通窗口打开 |
| `crypto.subtle` 不可用 | WebCrypto 只在 **HTTPS 或 localhost** 下可用。用 `http://localhost:4180` 访问，不要用局域网 IP 直连 |
| scrypt 派生很慢 | 默认 `N = 32768`（约 0.3–1 秒）。低性能设备可在设置中调低，或等 S5 的 KDF 参数升级能力 |
| 忘记主密码 | 用恢复码解锁；**两者都没有则数据永久丢失**（这是产品红线，不存在后门找回） |

---

## 2. 项目结构

```
lifehub/
├── packages/
│   ├── core/                  # 零 DOM 的纯 TypeScript 领域层（可移植到 Flutter）
│   │   ├── src/
│   │   │   ├── models/        # 领域模型：Bill / Category / RuleTemplate / ImportBatch / VaultParams / RecoveryMeta / AuditLog / EncryptedBlob
│   │   │   ├── crypto/        # 加密层：CryptoService、DEK 包裹、KDF、恢复码、CryptoProvider 端口
│   │   │   ├── csv/           # CSV 解析：流式状态机、编码探测、列头映射、方向推断
│   │   │   ├── money/         # 金额：分为单位整数解析与格式化（零浮点）
│   │   │   ├── time/          # 时间：ISO 8601 UTC + localDate + 灵活日期解析
│   │   │   ├── rules/         # 规则引擎：指纹去重、分类规则、文件哈希
│   │   │   ├── storage/       # 存储抽象：StorageAdapter 端口、EncryptedStore、PlainStore
│   │   │   ├── repositories/  # 仓储层：账单 / 分类 / 模板 / 批次 / 审计 / 保险库
│   │   │   ├── services/      # 服务层：保险库、导入、备份、审计、密钥轮换、同步合并
│   │   │   └── utils/         # 工具：字节、哈希、ID、序列化、守卫
│   │   └── tests/             # 单元测试 + 集成测试 + 夹具（全部在 Node 环境跑）
│   └── (README 见 packages/core/README.md)
├── apps/
│   ├── web/                   # Vite + React 18 + MUI v6 + Tailwind 的表现层
│   │   ├── src/
│   │   │   ├── pages/         # 6 个页面：导入 / 映射 / 账单 / 安全 / 设置 / 404
│   │   │   ├── components/    # 按域拆分的展示组件
│   │   │   ├── store/         # Zustand 状态：bill / import / settings / vault
│   │   │   ├── hooks/         # 业务编排 Hook：useVault / useBillList / useImportFlow …
│   │   │   ├── platform/      # 平台适配层：Dexie、Clock、DeviceLabel、WebCryptoProvider
│   │   │   └── __tests__/     # 组件与 store 测试（jsdom）
│   │   └── (README 见 apps/web/README.md)
│   └── sync-server/           # 自托管同步服务（只存密文，零 npm 依赖）
│       ├── src/               # server / store / validation / auth / config 五个模块
│       ├── tests/             # 端到端 + 存储层 + 校验 + 配置测试（node 环境）
│       ├── Dockerfile         # 多阶段构建；构建上下文为仓库根目录
│       └── .env.example       # 环境变量示例（含设备令牌说明）
├── docs/
│   ├── build-and-packaging.md # 多端构建与打包指南（Web / 同步服务 / Android APK / iOS IPA / 微信小程序）
│   ├── PRD.md                 # 产品需求文档（需求池与追踪索引）
│   ├── system_design.md       # 系统设计（类图、时序、任务列表、共享约定）
│   ├── architecture.md        # 架构说明（分层、数据流、加密边界、同步协议、移植路径）
│   ├── compliance-checklist.md  # 合规自检清单（逐条对应 PRD 第六节）
│   ├── roadmap.md             # 12 周路线图与任务分工矩阵
│   ├── adr/                   # 架构决策记录 ADR-001 … ADR-007
│   ├── class-diagram.mermaid  # 类图（源）
│   ├── sequence-diagram.mermaid # 时序图（源）
│   └── task-dependency-graph.mermaid # 任务依赖图（源）
├── scripts/                   # 合规静态断言脚本 + 同步服务快照脚本（CI 可直接跑）
├── docker-compose.yml         # 同步服务编排（含夜间快照 sidecar）
├── package.json               # npm workspaces 根清单
└── vitest.config.ts           # 跨包测试编排（projects 指向 core / web / sync-server）
```

### 各包职责一句话

| 包 | 职责 |
| --- | --- |
| `packages/core` | **零 DOM 依赖**的纯 TypeScript 领域层：模型、金额、时间、加密、CSV、规则、存储抽象、服务编排。不含任何 React 概念，可在 Node / 浏览器 / 未来 Flutter 中运行 |
| `apps/web` | 表现层：Vite + React 18 + MUI v6 + Tailwind，负责界面、交互与平台适配（IndexedDB / WebCrypto） |
| `apps/sync-server` | 可选的**自托管**同步后端：只接收与返回密文 blob，物理上没有解密能力 |

---

## 3. 架构说明

### 3.1 分层图

```
┌──────────────────────────────────────────────────────────────┐
│  表现层  apps/web                                              │
│  pages / components / hooks / store(Zustand)                   │
│  —— 只做界面与编排，不含加密与存储细节                          │
└───────────────┬──────────────────────────────┬────────────────┘
                │ 依赖注入                      │ 依赖注入
                ▼                              ▼
┌───────────────────────────────┐   ┌──────────────────────────────┐
│  领域层  packages/core          │   │  适配器层  apps/web/platform   │
│  models / money / time /       │   │  DexieStorageAdapter         │
│  crypto / csv / rules /        │   │  WebCryptoProvider           │
│  services / repositories       │   │  Clock / DeviceLabel         │
│  —— 零 DOM、零 React            │   │  apps/sync-server（Node http）│
└───────────────┬───────────────┘   └───────────────┬──────────────┘
                │  两个端口                            │
                ▼                                      ▼
        ┌──────────────────┐                 ┌──────────────────┐
        │ CryptoProvider   │                 │ StorageAdapter   │
        │ （密码学能力）    │                 │ （本地存储）      │
        └──────────────────┘                 └──────────────────┘
```

### 3.2 两个注入端口

核心层**不感知任何平台 API**，只依赖两个端口（PRD X-08 / X-09）：

| 端口 | 职责 | 浏览器实现 | Node 实现 | 未来 Flutter 实现 |
| --- | --- | --- | --- | --- |
| `CryptoProvider` | 随机数、AES-256-GCM 加解密、scrypt 派生 | `WebCryptoProvider`（`globalThis.crypto`） | `NodeCryptoProvider`（`node:crypto`） | `dart:ffi` → 平台原生实现 |
| `StorageAdapter` | 记录的增删改查与索引列过滤排序 | `DexieStorageAdapter`（IndexedDB） | `MemoryStorageAdapter`（测试替身） | sqflite / drift |

> 核心层在 TypeScript 配置里 `lib: ["ES2022"]`（不含 DOM），从类型层面保证「零 DOM」。

### 3.3 数据流：导入一条账单

```
CSV 文件
  │  ①  CsvParser 流式解析（RFC 4180，10 万行不整表驻留内存）
  ▼
表格（headers + rows）
  │  ②  ColumnMapper：按 0 基列索引映射语义字段（不依赖表头文字）
  ▼
列映射（occurredAt / amount / counterparty / direction / note）
  │  ③  RowMapper：金额 → 整数分；日期 → ISO 8601 UTC + localDate；方向 → income/expense/refund
  ▼
领域对象 Bill
  │  ④  Deduplicator：内容指纹去重（A-12 ①）
  ▼
待写入列表
  │  ⑤  EncryptedStore：AES-256-GCM 加密（AAD 绑定 entityType + id + keyVersion）
  ▼
IndexedDB（密文 payload + 7 个索引明文列）
```

### 3.4 加密边界

```
用户口令 ──scrypt(N=2^15,r=8,p=1)──► 主密钥 masterKey ──AES-GCM 包裹──► DEK ──AES-GCM──► 业务密文
恢复码   ──scrypt(独立盐值)──────► 恢复密钥         ──AES-GCM 包裹──► DEK（同一把）
```

- **主密钥只用于包裹 DEK**，不直接加密业务数据；改口令时只需重包裹 + 重加密存量密文。
- **不存储口令哈希**：用主密钥加密固定哨兵 `lifehub:verify:v1`，解密成功即证明口令正确（无任何可离线爆破的派生值落盘）。
- **AAD 绑定实体身份**：把 A 记录的密文搬到 B 记录上会解密失败，阻断「密文搬移」攻击。
- **DEK 与主密钥只驻留内存**，锁定时 `fill(0)` 擦除；**永不上传**。
- 恢复码路径（主理人批准的设计增量）：恢复码派生的恢复密钥**直接包裹 DEK**，因此恢复码等价于一把「恢复 DEK」的备用钥匙。

### 3.5 跨端移植路径

核心层是**纯 TS + 依赖注入**的，可移植路径见 [`docs/architecture.md`](docs/architecture.md) 第 5 节：

1. **移植为 Dart**（推荐）：语义一一对应，最干净，成本最高。
2. **`dart:ffi` 调 Rust/C 加密核心**：性能最好，需要维护两套实现。
3. **JS 互操作运行时（quickjs / JSC）**：成本最低，体积与性能代价最大。

---

## 4. 模块清单

对应 PRD §1.2 的模块编码。状态标记：✅ 已交付 ｜ ⏳ 计划中 ｜ 🚫 不做（本期）

| 模块 | 名称 | 状态 | 本轮交付物 |
| --- | --- | --- | --- |
| **A-01** | 本地优先与端到端加密 | ✅ | `EncryptedStore` / `CryptoService` / `VaultService` |
| **A-02** | 金额精度（分为单位整数） | ✅ | `money/amount.ts` + `money/currency.ts` |
| **A-03** | 多币种扩展 | ⏳ | 本期仅 CNY，`currency` 字段已预留 |
| **A-04** | CSV 导入解析 | ✅ | `csv/parser.ts`（流式状态机）+ `csv/encoding.ts` |
| **A-05** | 自定义列头映射 | ✅ | `csv/column-mapper.ts` + 映射页 UI |
| **A-06** | 收支方向推断 | ✅ | `csv/direction.ts`（显式列 > 正负号 > 关键词） |
| **A-07** | 主密码与保险库 | ✅ | `services/vault-service.ts` + `SetPasswordDialog` |
| **A-08** | 分类体系 | ✅ | `models/category.ts` + `CategoryRepository` |
| **A-09** | 账单列表与筛选 | ✅ | `BillsPage` + `useBillList` + 虚拟化长列表 |
| **A-10** | 导入向导（四步） | ✅ | `ImportPage` + `MappingPage` + `useImportFlow` |
| **A-11** | 错误明细与部分成功 | ✅ | `ImportSummary.errors` + `ErrorSummary` |
| **A-12** | 幂等导入与去重 | ✅ | `rules/dedupe.ts` + `ImportService.run()` 的文件哈希拦截 |
| **A-13** | 规则模板 | ✅ | `models/rule-template.ts` + `RuleTemplateRepository` |
| **A-20 ~ A-25** | 预算信封 / 图表 / 多账本 / 标签 / 导出 / 加密备份 | ⏳ | A-24 的加密备份已交付（`BackupService`），其余在阶段 2 |
| **B-01 ~ B-05** | 生活课表与时间块 | ⏳ | 阶段 4 |
| **C-01 ~ C-03** | 微习惯打卡 | ⏳ | 阶段 4 |
| **D-01 ~ D-03** | 树洞日记 | ⏳ | 阶段 6 |
| **E-01 ~ E-05** | AI 分析层 | ⏳ | 阶段 6（用户自带 Key） |
| **X-01** | 端到端加密与同步载荷 | ✅ | `sync/sync-payload.ts` + `check-sync-payload.mjs` |
| **X-02** | 口令强度与安全教育 | ✅ | `SetPasswordDialog` 的阻断式确认 |
| **X-03** | 恢复码与盐值备份 | ✅ | `crypto/recovery-code.ts` + `RecoveryCodePanel` |
| **X-04** | 档案与密钥本地安全存储 | ✅ | `PlainStore`（白名单实体）+ `InMemoryDekProvider` |
| **X-05** | 隐私与合规 | ✅ | `scripts/check-compliance.mjs` + `docs/compliance-checklist.md` |
| **X-06** | 无统计 SDK | ✅ | 依赖树精确匹配扫描（含匹配器自检） |
| **X-07** | 审计日志 | ✅ | `AuditLogger` + `AuditLogRepository` + `AuditLogTable` |
| **X-08** | 存储抽象层 | ✅ | `StorageAdapter` 端口 + Dexie / Memory 两个实现 |
| **X-09** | 索引明文列 | ✅ | 7 个索引列（见 §6.9） |
| **X-10** | 密钥轮换 | ⏳ | 阶段 5（本轮只落接口与参数校验） |
| **X-11** | 冲突合并基础 | ✅ | `services/sync/merge.ts`（`(updatedAt, deviceId)` 决胜） |
| **X-12** | 自托管同步服务 | ✅ | `apps/sync-server`（只搬密文；5 个端点 + SQLite 持久化 + 设备级授权 + 快照备份） |
| **X-13 ~ X-14** | 多设备授权 / 密钥分发 | ⏳ | 服务端的**设备级令牌授权**已落地（X-13 的服务端形态）；密钥分发仍在阶段 5 |
| **X-15** | 合规自检清单 | ✅ | `docs/compliance-checklist.md` |
| **X-16 ~ X-17** | 可访问性 / 国际化 | ⏳ | 阶段 2 起逐步补齐 |
| **M-01** | 微信小程序轻量版 | 🚫 | 最后做，且个人主体下必须砍掉金融 / AI / 公开 UGC 部分 |

---

## 5. 脚本说明

### 根目录脚本

| 命令 | 作用 | 适用包 |
| --- | --- | --- |
| `npm run dev` | 启动 Web 开发服务器（`http://localhost:4180`） | `apps/web` |
| `npm run build` | 类型检查 + 构建生产产物到 `apps/web/dist` | `apps/web` |
| `npm run build:sync` | 编译同步服务到 `apps/sync-server/dist` | `apps/sync-server` |
| `npm run preview` | 预览生产构建产物 | `apps/web` |
| `npm run test` | 运行全部测试（core + web + sync-server） | 全部 workspace |
| `npm run test:watch` | 监听模式运行测试 | 全部 workspace |
| `npm run coverage` | 生成覆盖率报告 | 全部 workspace |
| `npm run typecheck` | 类型检查（core → web → sync-server） | 全部 workspace |
| `npm run typecheck:core` | 只检查核心层类型 | `packages/core` |
| `npm run lint` | ESLint 全仓检查 | 全仓 |
| `npm run format` / `npm run format:check` | Prettier 格式化 / 检查 | 全仓 |
| `npm run check:compliance` | 合规静态断言（R1/R2/R6/R7/R8/X-06） | 全仓 |
| `npm run check:no-network` | 加密与服务层「零网络出口」断言（X-01 ①） | `packages/core` |
| `npm run check:sync-payload` | 同步载荷 / 备份「只含密文」断言（X-01 ④ / R5） | `packages/core` |
| `npm run bench` | CSV 解析性能基准（10 万行 ≤ 3s） | `packages/core` |
| `npm run ci` | 本地跑一遍完整质量门禁（lint → typecheck → test → coverage → 3 个 `check:*` → bench） | 全仓 |

### 分包脚本

| 包 | 命令 | 作用 |
| --- | --- | --- |
| `packages/core` | `npm run test --workspace @lifehub/core` | 运行核心层测试（Node 环境，**不使用 jsdom**） |
| `packages/core` | `npm run bench --workspace @lifehub/core` | CSV 解析基准 |
| `packages/core` | `npm run coverage --workspace @lifehub/core` | 核心层覆盖率（阈值门禁：整体 ≥ 80%，加密 / CSV / 时间 / 金额四个目录 100%） |
| `apps/web` | `npm run test --workspace @lifehub/web` | 运行组件与 store 测试（jsdom） |
| `apps/web` | `npm run build --workspace @lifehub/web` | 构建 Web 产物 |
| `apps/web` | `npm run coverage --workspace @lifehub/web` | Web 端覆盖率报告 |
| `apps/sync-server` | `npm run build --workspace @lifehub/sync-server` | 编译同步服务 |
| `apps/sync-server` | `npm run start --workspace @lifehub/sync-server` | 启动同步服务（默认 `127.0.0.1:8787`；**需先设置 `LIFEHUB_SYNC_TOKENS`**） |
| `apps/sync-server` | `npm run test --workspace @lifehub/sync-server` | 运行同步服务测试（起真实实例 + `fetch`，83 例） |
| `apps/sync-server` | `npm run coverage --workspace @lifehub/sync-server` | 同步服务覆盖率报告（当前语句覆盖 91.1% / 分支 84.2%） |
| 仓库根 | `node scripts/snapshot.mjs` | 同步服务 SQLite 在线快照（保留 N 份，见 `scripts/snapshot.sh`） |

> 三个 `check:*` 脚本是**可执行的红线断言**，建议接入 CI；它们不依赖任何第三方包。
> `npm run ci` 会把 lint / typecheck / test / coverage / 三个 `check:*` / bench 串成一条完整的质量门禁。

---

## 6. 隐私与安全声明

LifeHub 是一个**本地优先**的个人工具。下面逐条说明我们**不做什么**与**数据放在哪里**。

### 6.1 不采集任何个人身份信息

- ❌ **不采集手机号**、❌ **不采集设备号 / IMEI / 序列号**、❌ **不采集定位**、❌ **不采集通讯录**、❌ **不读取麦克风**。
- 代码层面的保证：`scripts/check-compliance.mjs` 扫描全部源码，出现
  `geolocation` / `getUserMedia` / `navigator.imei` / `navigator.serial` / `navigator.usb` /
  `navigator.credentials` / `getBattery` / `addressBook` / `ContactsManager` 即构建失败。
- 设备标识只有一个：本地生成的 UUIDv7 `deviceId`（用于冲突合并的决胜键），**与硬件无关、不出本机**。

### 6.2 无埋点、无统计、无广告 SDK

- ❌ 不引入任何统计 / 埋点 / 广告 SDK（Sentry、Amplitude、Mixpanel、Google Analytics、GA4、友盟、热神、PostHog、Datadog、Clarity、FullStory、LogRocket 等）。
- `check:compliance` 会解析 `package-lock.json` 的**包名**并与黑名单做精确 / 前缀匹配；
  同时脚本内置**匹配器自检**（必须能识别 18 个真实 SDK 名，且不得把 `es-set-tostringtag` 这类无关依赖误判）。
- ❌ 不接入任何第三方在线服务，除非你在设置里**主动填写**自己的 AI endpoint。

### 6.3 不做银行 / 支付平台直连

- ❌ 不接入任何银行或支付平台的开放接口域名（源码扫描黑名单含 `icbc.com.cn`、`cmbchina.com`、`ccb.com`、
  `abchina.com`、`boc.cn`、`unionpay.com`、`alipay.com`、`tenpay.com` 等）。
- 数据来源只有一种：**你手动导出的 CSV 文件**，由你在本地解析。

### 6.4 无公开 UGC

- ❌ 不设社区、不发布他人数据、不做公开分享。树洞日记（模块 D）**仅本地加密存储**，不产生任何公开内容。

### 6.5 数据不出本机（除你自填的 AI endpoint）

- 业务数据默认**完全留在本机**：浏览器 IndexedDB（密文 payload）。
- 唯一可能产生网络请求的场景：
  1. 你在设置中**主动填写**的 AI endpoint（阶段 6 的 AI 分析层，届时会做脱敏与本地聚合）；
  2. 你**主动开启**并填写地址的同步服务（见 6.7）。
- 未配置任何 endpoint 时，应用**不发起任何网络请求**（`check:no-network` 断言加密与服务层零网络出口）。

### 6.6 密钥永不上传

- **主口令**：只在本机用于派生主密钥，**从不离开设备**，也**不以任何形式落盘**（不存哈希、不存派生值）。
- **主密钥 / DEK**：只驻留内存，锁定时 `fill(0)` 擦除；**永不上传**。
- **盐值**：保险库盐值只存在本机；同步服务**不接收**盐值。

### 6.7 服务端只存密文

自托管同步服务（`apps/sync-server`）：

- 请求体**只接受**密文 blob 白名单字段（`EncryptedBlob` 的 10 个字段）；
  出现 `amountMinor` / `counterparty` / `note` / `localDate` / `salt` / `dek` / `masterKey` /
  `recoveryCode` 等明文字段名——**包括藏在嵌套对象里的**——**直接返回 400 且绝不落盘**。
- 服务端**没有**密钥、不会解密、不知道你的业务数据长什么样；**即使数据库整体泄露也无法还原任何业务内容**。
- 数据库**只有一张表** `encrypted_blob`，**没有任何业务明文列**，也没有本地那 7 个索引明文列——
  服务端连「哪天有消费」都看不到。
- 服务端**不采集**任何信息，**不做**银行直连，**不引入**任何第三方 SDK（**零 npm 运行时依赖**）。

**如实披露服务端「能看见」的**：记录条数、每条多长、什么时间改的、属于哪个实体类型与实体 id。
这些是同步协议必需的元信息，不含任何业务语义。完整的能力边界见
[`apps/sync-server/README.md` §2](apps/sync-server/README.md)。

**服务端的授权与可用性**：

- **设备级令牌**：`Authorization: Bearer <token>`，未授权 401。令牌只来自环境变量，
  **不硬编码、不入库、不落日志**；**未配置令牌时服务拒绝启动**（失败即关闭）。
- **不提供长期可用性承诺（AS-7）**：服务由你自托管，停机 / 损坏 / 忘记备份都由你负责。
  请务必配置**定期快照备份**（`scripts/snapshot.mjs`，见 `docker-compose.yml` 的夜间快照 sidecar），
  并把快照复制到**另一块盘**。

### 6.8 忘记口令且没有恢复码 = 数据永久丢失

> **这是产品红线，不存在后门找回、客服解封或「一键找回」入口。**

- 加密是端到端的：服务端没有密钥，开发者也没有密钥，**任何人都无法替你恢复**。
- 唯一的兜底是**恢复码**：12 组 × 6 字符的 Base32 助记码，导出后离线保存。
  恢复码用独立盐值派生的恢复密钥**直接包裹 DEK**，因此它本身就是一把能解开数据的备用钥匙。
- **请把恢复码和主密码分开保管**（例如恢复码打印后放进保险箱，主密码只记在脑子里）。
- 重新生成恢复码会**立即使旧恢复码失效**（DEK 不变，只换包裹它的恢复密钥）。

### 6.9 索引明文列的范围（ADR-006）

本地存储层为了做范围查询与排序，会保留**极小的明文索引列**。这是**唯一**的例外，完整清单共 **7 个字段**：

| # | 索引明文列 | 用途 | 是否含业务语义 |
| --- | --- | --- | --- |
| 1 | `entityType` | 区分表 / 实体类型 | 否 |
| 2 | `localDate` | 本地日历日范围查询与按日分组 | 否（只有日期，没有金额与对方） |
| 3 | `occurredAt` | UTC 时间戳排序 | 否 |
| 4 | `createdAt` | 创建时间排序 | 否 |
| 5 | `updatedAt` | 更新时间排序（增量同步游标） | 否 |
| 6 | `version` | 版本号（冲突合并） | 否 |
| 7 | `deviceId` | 设备标识（冲突合并决胜键） | 否（本地生成的 UUID） |

**除这 7 个字段外，存储层不保留任何明文**：金额、方向、交易对方、备注、分类等**全部在密文里**。
备份文件与同步载荷同样只搬运密文（`check:sync-payload` 断言）。

---

## 7. 开发路线

### 7.1 12 周阶段表（详见 [`docs/roadmap.md`](docs/roadmap.md)）

| 阶段 | 周期 | 名称 | 关键交付 |
| --- | --- | --- | --- |
| S0 | W0 | 主体 / 备案 / 合规基线 | 主体资质与合规清单就位 |
| S1 | W1-2 | 核心 TS 层 | `packages/core`：模型 / 加密 / CSV / 存储抽象 / 服务 |
| S2 | W3-4 | Web 端记账 MVP | `apps/web`：6 个页面 + 图表 + 规则引擎 |
| S3 | W5-6 | Android Flutter 壳 | 复用 `packages/core`，换表现层 |
| S4 | W7-8 | 课表 + 习惯打卡 | 模块 B / C |
| S5 | W9-10 | 自托管同步服务 | 多设备同步（只搬密文）+ 密钥轮换 |
| S6 | W11-12 | AI 分析层 + 日记加密 | 模块 D / E；小程序轻量版最后做 |

### 7.2 当前 Sprint 范围

本轮（Sprint 0）交付：**核心层 + Web 可跑 MVP + 可运行的同步服务 + 完整文档与红线断言**。

已完成的工程约束（后续每轮都要维持）：

- `packages/core` **零 DOM**（`lib: ["ES2022"]` + 源码扫描）。
- 金额**分为单位整数**，时间**ISO 8601 UTC + localDate**。
- 加密走 `CryptoProvider` 注入，存储走 `StorageAdapter` 注入。
- 每个导出函数有**五要素中文 JSDoc**；不新增任何 `TODO`。
- 三个 `check:*` 脚本**全绿**才能提交（`npm run ci` 一次跑完全部门禁）。
- 同步服务**零 npm 运行时依赖**，且**只存密文**（见 §6.7）。

### 7.3 文档索引

| 文档 | 内容 |
| --- | --- |
| [`docs/build-and-packaging.md`](docs/build-and-packaging.md) | **多端构建与打包指南**：Web 静态编译、同步服务 Docker 打包、Android APK / iOS IPA（Capacitor）、PWA 及微信小程序构建说明 |
| [`docs/PRD.md`](docs/PRD.md) | 产品需求文档：需求池、UI 稿描述、约束与假设、需求追踪索引 |
| [`docs/system_design.md`](docs/system_design.md) | 系统设计：类图、时序、数据结构、任务列表、共享约定（注释与文档规范） |
| [`docs/architecture.md`](docs/architecture.md) | 架构说明：分层图、数据流、加密边界详版、索引列取舍、**同步协议与密文 blob 格式**、Flutter 移植路径评估 |
| [`docs/roadmap.md`](docs/roadmap.md) | 12 周路线图、任务分工矩阵、里程碑与验收关卡、风险登记册 |
| [`docs/compliance-checklist.md`](docs/compliance-checklist.md) | 合规自检清单：逐条对应 PRD 第六节 + **同步服务专项检查** |
| [`docs/adr/`](docs/adr/) | 架构决策记录：ADR-001 金额精度 / 002 时间与时区 / 003 加密封装边界 / 004 存储抽象层 / 005 冲突合并 / 006 索引明文列 / **007 同步协议与密文 blob 格式** |
| [`packages/core/README.md`](packages/core/README.md) | 核心包对外 API 概览与在 Node / 浏览器中的用法 |
| [`apps/web/README.md`](apps/web/README.md) | Web 端结构、页面职责与开发指引 |
| [`apps/sync-server/README.md`](apps/sync-server/README.md) | 同步服务接口说明、**能力边界**与三种自托管场景（NAS / VPS / 内网） |
| [`docker-compose.yml`](docker-compose.yml) | 同步服务编排：数据卷 + 设备令牌 + 夜间快照 sidecar |

---

## 许可证

MIT
