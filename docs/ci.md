# CI 流水线与质量门禁（LifeHub）

> 文档版本：v1.0 ｜ 对应流水线：`.github/workflows/ci.yml`、`.github/workflows/compliance.yml`
> 责任角色：OPS（轨道A）｜ 关联文档：`docs/system_design.md` §7 T05 / §8.7 / §8.8、`docs/roadmap.md` §3.2 / §5

---

## 目录

1. [流水线总览](#1-流水线总览)
2. [各 Job 说明](#2-各-job-说明)
3. [本地复现](#3-本地复现)
4. [门禁不通过的排查手册](#4-门禁不通过的排查手册)
5. [覆盖率门禁的判定规则](#5-覆盖率门禁的判定规则)
6. [性能基准的判定规则](#6-性能基准的判定规则)
7. [已知限制与后续建议](#7-已知限制与后续建议)

---

## 1. 流水线总览

LifeHub 采用**两个 workflow、8 个 job** 的结构。之所以拆成两个文件，是因为两类门禁的**性质不同**：

| Workflow | 文件 | 职责 | 失败含义 |
| --- | --- | --- | --- |
| `CI` | `.github/workflows/ci.yml` | 代码正确性（lint / typecheck / test / coverage / bench / audit） | 代码有 bug，可以修完重跑 |
| `Compliance` | `.github/workflows/compliance.yml` | **红线**（R1 / R2 / R3 / R5 / R6 / R7 / R8） | 触碰隐私红线，**必须人工评审后才能合并** |

两条流水线都在 `push` 与 `pull_request` 时触发；`Compliance` 额外有每周一 03:17 UTC 的定时复跑，
用来发现「绕过 CI 直接推送到主分支」导致的红线漂移。

### 触发与并发策略

```yaml
on:
  push:
  pull_request:
  workflow_dispatch:   # 允许手动重跑
```

- `concurrency.cancel-in-progress: true`：同一个 PR 的新推送会取消旧运行，
  既避免队列堆积，也保证「最新提交的结论」才是有效的。
- `permissions: contents: read`：本流水线不写仓库内容，按最小权限原则收敛。

### Job 依赖关系

```
push / pull_request
        │
        ├──▶ lint        ┐
        ├──▶ typecheck   │
        ├──▶ test        ├─ 并行执行，互不阻塞
        ├──▶ coverage    │  （coverage 与 test 各自跑一次测试，互不依赖）
        ├──▶ bench       │
        ├──▶ audit       ┘
        └──▶ compliance（ci.yml 内）───┐
                                        ├── 两份合规结论互为交叉验证
             └──▶ compliance（compliance.yml 内，矩阵 3 条）──┘
```

> **为什么 test 与 coverage 不复用？**
> 覆盖率需要额外的 V8 插桩，耗时约为普通测试的 2～3 倍，且插桩本身会改变代码路径的性能特征。
> 复用会让「测试挂了」和「覆盖率不达标」两种完全不同的失败混在同一个 job 里，反而增加排查成本。

---

## 2. 各 Job 说明

### 2.1 `lint` —— ESLint 静态检查

| 项 | 值 |
| --- | --- |
| 命令 | `npm run lint`（等价于 `eslint .`） |
| 覆盖范围 | `packages/core`、`apps/web`、`scripts` 全量 |
| 超时 | 10 分钟 |

**门禁要点**：ESLint 配置（`eslint.config.js`）把两条规则设为 `error`，对应系统设计 §8.4 类型纪律：

- `@typescript-eslint/no-explicit-any` —— 全仓禁止 `any`
- `@typescript-eslint/no-non-null-assertion` —— 全仓禁止 `!` 非空断言

**为什么用 `npm ci` 而不是 `npm install`**：`npm ci` 严格按 `package-lock.json` 安装；
`npm install` 会「顺手」更新锁文件，导致 CI 装到与开发者本地不同的依赖树（风险 R-11 供应链风险）。

**Node 版本**：`node-version-file: '.nvmrc'` 读取仓库根的 `.nvmrc`（锁定 22），
并在安装后显式断言 `process.versions.node` 主版本为 22。
好处是本地与 CI 永远同版本，不会出现「本地绿、CI 红」的版本差异。

---

### 2.2 `typecheck` —— 三包类型检查

| 项 | 值 |
| --- | --- |
| 命令 | `npm run typecheck` |
| 覆盖范围 | `packages/core` + `apps/web` + `apps/sync-server` |
| 超时 | 15 分钟 |

**门禁要点**：`packages/core` 的 `tsconfig.json` 固定 `lib: ["ES2022"]`（不含 DOM）。
因此这里的类型检查同时承担红线 **R1「核心层零 DOM」** 的一部分拦截职责 ——
一旦 core 里出现 `window` / `document` / `localStorage`，会直接编译失败。

---

### 2.3 `test` —— 单元测试与集成测试

| 项 | 值 |
| --- | --- |
| 命令 | `npm run test` |
| 覆盖范围 | core（单测 + 集成 + 安全 + 合规 + 性能）＋ web（组件与 store） |
| 超时 | 20 分钟 |

**集成测试覆盖的关键链路**（系统设计 §7 T05 第 2 条）：

| 用例文件 | 验证的业务不变量 |
| --- | --- |
| `import-pipeline` | 文件 → 账单落库全链路 |
| `encrypted-store` | 落库密文可检索到明文 = **0**（NF-S-1） |
| `vault-unlock` | 正确口令 / 错误口令 / 恢复码三条路径 |
| `backup-roundtrip` | 导出 → 导入 → 数据一致 |
| `idempotent-import` | 重复导入不产生重复账单 |

---

### 2.4 `coverage` —— 覆盖率门禁（**核心门禁**）

| 项 | 值 |
| --- | --- |
| 命令 | `npm run coverage` |
| 阈值来源 | `packages/core/vitest.config.ts` 的 `coverage.thresholds` |
| 超时 | 25 分钟 |

**这个 job 由三步组成**，每一步都防一种失效模式：

**第 1 步 · 校验覆盖率阈值未被下调**

用一段内联 Node 脚本解析 `packages/core/vitest.config.ts`，断言：

- 全局阈值 `lines / functions / statements ≥ 80`，`branches ≥ 70`
- `src/money/**`、`src/time/**`、`src/crypto/**`、`src/csv/**` 四项指标**全部 ≥ 85**

> 阈值沿革（2026-10-30）：四目录阈值最早定为 100%，但 QA 复核发现其核心层含若干
> 「纯接口 / 纯类型」文件（如 `src/crypto/provider.ts`、`src/models/common.ts`、
> `src/models/app-settings.ts`），它们没有运行时语句、V8 一律报 0%，使目录聚合永远达不到 100%；
> 即便把这些纯类型文件排除，**四目录仍残留少量防御性分支缺口**（各 Provider 异常分支、CSV 编码非法输入分支），
> 达到 100% 需要为仅覆盖一行 / 一分支写大量易碎测试，性价比极低。
> 经评估将四目录下限统一设为 **85%**（仍远高于普通项目、足以拦截大规模回归），
> 纯类型文件已列入 `coverage.exclude` 不参与统计。全局 80% 保持不变。

**为什么需要这一步**：覆盖率阈值就是门禁本身。如果有人为了「让 CI 变绿」把阈值调到全局最低线以下，
动态覆盖率检查**根本发现不了**（因为它只会告诉你「达标了」）。
把阈值下限写死在 CI 里做交叉校验，形成双保险 —— 这条对抗的是「门禁被悄悄放松」。

**第 2 步 · 运行覆盖率并执行阈值门禁**

`vitest run --coverage` 在覆盖率低于 `thresholds` 时会设置非零退出码，
因此**这一步失败 == 门禁生效**，不需要额外写脚本判断。

**第 3 步 · 自检：确认覆盖率门禁真的会拦截**

把阈值临时抬到高于当前覆盖率的值（例如 100%）并只跑一个测试文件（保持快速），期望得到非零退出码。

**为什么需要这一步**：门禁最危险的失效方式是「阈值被写错导致永远通过」。
自检用一个**必然失败**的条件去验证门禁真的会响；如果意外返回 0，说明门禁根本没生效，必须让 CI 失败。

**第 4 步 · 上传覆盖率报告**

`if: always()` —— 即使门禁失败也上传产物。这样开发者可以直接看「哪几行没被覆盖」，
不用在本地重跑一遍就能定位补测点。

---

### 2.5 `compliance` —— 合规断言（ci.yml 内）

| 项 | 值 |
| --- | --- |
| 命令 | `npm run check:compliance`<br>`npm run check:no-network`<br>`npm run check:sync-payload` |
| 覆盖范围 | 全仓源码 + 依赖树 |
| 超时 | 10 分钟 |

三条脚本与红线的对应关系（系统设计 §8.8）：

| 脚本 | 检查的红线 | 具体内容 |
| --- | --- | --- |
| `check:compliance` | **R1** 核心层零 DOM<br>**R2** 核心层依赖纯净<br>**R6** 无采集调用<br>**R7** 无外部域名<br>**R8** 无后门文案 | 扫描 `packages/core/src` 与 `apps/web/src`；依赖树不含 React / MUI / Dexie / 统计 SDK |
| `check:no-network` | **R3** 加密 / 密钥模块零网络出口（X-01 ①） | 扫描 `crypto/**` 与 `services/**`，命中 `fetch` / `XHR` / `WebSocket` / `sendBeacon` / `EventSource` 即失败 |
| `check:sync-payload` | **R5** 同步载荷与备份只含密文（X-01 ④） | 静态层查明文字段名 + 运行时层用真实数据构造载荷后全文检索明文样本 |

> **为什么三个脚本必须串行执行且不用 `continue-on-error`**：
> 风险登记 R-18 明确指出「CI 断言脚本被注释掉或跳过，红线形同虚设」。
> 一旦给任何一个脚本加上 `continue-on-error`，就等于把红线从「阻断」降级为「提醒」。

---

### 2.6 `bench` —— 性能基准（**单独 job**）

| 项 | 值 |
| --- | --- |
| 命令 | `npm run bench` |
| 被测文件 | `packages/core/tests/performance/csv-benchmark.test.ts` |
| 超时 | 15 分钟 |

**断言内容**（需求 NF-P-1 / 风险 R-08）：

| 用例 | 断言 | 实测（本地） |
| --- | --- | --- |
| 1 万行解析 | < 1s | ~50 ms |
| **10 万行解析** | **≤ 3s** | **~320 ms** |
| 10 万行流式解析 | ≤ 3s | ~466 ms |

**为什么单独成一个 job**：

1. 基准比普通测试慢（要真的解析 10 万行），混在一起会让「测试挂了」看起来像同一个失败；
2. 基准超时通常意味着**性能退化**（解析器退化成逐行字符串拼接），与功能缺陷的修法完全不同；
3. 单独成 job 可以给更宽松的超时，不会因为机器抖动误杀整个 test job。

---

### 2.7 `audit` —— 依赖漏洞扫描

| 项 | 值 |
| --- | --- |
| 命令 | `npm audit --audit-level=high` |
| 目的 | 阻断 high / critical 级依赖漏洞（风险 R-11） |

> 注意：仓库 `.npmrc` 里的 `audit=false` **只影响 `npm install` 的安装输出**，
> 不影响这里显式调用的 `npm audit` 子命令。

---

### 2.8 `compliance.yml` 的矩阵 job —— 红线逐条独立结论

用矩阵把三条红线拆成三个独立结论，`fail-fast: false` 保证一条红线失败时另外两条仍会跑完
（修红线时最耗时的是「发现原来还有第二条也坏了」）。

| 矩阵 ID | 名称 | 脚本 |
| --- | --- | --- |
| `static` | R1/R2/R6/R7/R8 · 静态合规扫描 | `check:compliance` |
| `no-network` | R3 · 加密与密钥模块零网络出口 | `check:no-network` |
| `sync-payload` | R5 · 同步载荷与备份只含密文 | `check:sync-payload` |

**为什么要独立成一个 workflow（而不是全部塞进 ci.yml）**：

1. **粒度不同**：ci.yml 的 compliance job 是「整体通过 / 不通过」；矩阵版是三条独立结论，
   分支保护可以按红线**逐条**要求必过。
2. **触发面不同**：红线不是「代码写对了吗」，而是「代码敢不敢上线」。
   一条红线被打破时，需要在**发布前**独立复跑一次，而不必重跑整个 CI。
3. **可被单独加固**：R-18 要求「合规 job 设为 required 分支保护检查」，
   独立 workflow 更容易配置成独立的 required check。

---

## 3. 本地复现

### 3.1 环境要求

```
Node >= 22（.nvmrc 锁定 22）
npm  >= 10
```

### 3.2 一次性准备

```bash
npm ci
```

### 3.3 逐个复现 job

| job | 本地命令 | 预期 |
| --- | --- | --- |
| `lint` | `npm run lint` | 0 error |
| `typecheck` | `npm run typecheck` | 0 error |
| `test` | `npm run test` | 全部通过 |
| `coverage` | `npm run coverage` | 达到阈值，退出码 0 |
| `compliance` | `npm run check:compliance && npm run check:no-network && npm run check:sync-payload` | 三条都打印「通过」 |
| `bench` | `npm run bench` | 10 万行 ≤ 3s |
| `audit` | `npm audit --audit-level=high` | 0 vulnerability |

### 3.4 一键跑完（等价于本地全量门禁）

```bash
npm run ci
```

> **注意**：`npm run coverage`（根 `package.json` 的脚本）会**依次**跑 core → web → sync-server 三个包的覆盖率。
> npm 10 的 `--workspaces` 是**串行**执行的（不是并行），且三个包的 `reportsDirectory` 本来就不同
> （`packages/core/coverage`、`apps/web/coverage`、`apps/sync-server/coverage`），不会互相抢锁。
> 真正会触发 `The coverage report directory ... is already in use by another Vitest process` 的，
> 是**你在另一个终端同时跑同一个包的 vitest 进程**；遇到时换一个独立的报告目录即可：

```bash
# 覆盖率高覆盖率报告目录（临时排查用）
npx vitest run --coverage --coverage.reportsDirectory=coverage-debug
```

### 3.5 复现「门禁自检」

CI 里 coverage job 的第 3 步会用一个**必然失败**的阈值验证门禁真的会响。本地复现：

```bash
cd packages/core
npx vitest run --coverage \
  --coverage.reportsDirectory=coverage-selftest \
  --coverage.thresholds.lines=100 \
  --coverage.thresholds.functions=100 \
  --coverage.thresholds.statements=100 \
  --coverage.thresholds.branches=100 \
  tests/unit/amount.test.ts
echo "退出码 = $?"   # 期望非 0
```

---

## 4. 门禁不通过的排查手册

### 4.1 `lint` 失败

**现象**：`npm run lint` 报 `✖ N problems (M errors, K warnings)`

**排查步骤**：

```bash
# 只看 error（忽略 warning）
npx eslint . --quiet

# 只看某个文件
npx eslint packages/core/src/utils/bytes.ts

# 只看某条规则
npx eslint . --rule '{"@typescript-eslint/no-explicit-any": "error"}'
```

**常见错误与对应红线**：

| 错误信息 | 含义 | 修法 |
| --- | --- | --- |
| `Forbidden non-null assertion` | 用了 `!` | 改成提前 `return` / 抛 `LifeHubError`（§8.4 第 3 条） |
| `Forbidden 'any'` | 用了 `any` | 用 `unknown` + 类型守卫收窄（`utils/guards.ts`） |
| `Irregular whitespace not allowed` | 混入了全角空格等异常空白 | 替换成普通半角空格 |
| `Unnecessary escape character` | 正则里多余的转义 | 去掉多余反斜杠（注意：`[` 在字符类里**必须**转义） |
| `Fast refresh only works when a file only exports components` | React Fast Refresh 限制 | 把非组件导出拆到独立文件 |

> **注意**：字符类里的 `[` 必须写成 `\[`。写成 `[(.[]` 时 `]` 会被当作字符类的结束符，
> 语义从「匹配一个字符」变成「开启字符类」——这是**语义变化**，不是等价改写。

### 4.2 `typecheck` 失败

**排查步骤**：

```bash
# 单独查 core（最常见）
npm run typecheck:core

# 单独查 web
npm run typecheck --workspace @lifehub/web

# 单独查 sync-server
npm run typecheck --workspace @lifehub/sync-server
```

**常见原因**：

- core 里误用了 DOM API → `lib` 不含 DOM，编译期直接报错（这是 R1 的拦截机制，**不要**通过加 lib 绕过）
- 跨包导入写错了相对路径（§8.1：相对路径**不写** `.js` 后缀）

### 4.3 `test` 失败

**排查步骤**：

```bash
# 只跑某个文件
cd packages/core && npx vitest run tests/unit/amount.test.ts

# 打开界面模式逐个调试
cd packages/core && npx vitest --ui

# 放宽超时（仅用于定位是不是超时问题）
cd packages/core && npx vitest run --testTimeout=120000
```

**最常见的一类失败：KDF 相关用例超时**

`scrypt N=32768`（§8.2 `KDF_DEFAULT_PARAMS`）单次口令派生在 CI 机器上**实测约 4.3s**。
一个用例可能连续做多次派生（建保险库 + 解锁 + 轮换），累计耗时天然超过 Vitest 默认的 5s。

本仓库的处理方式（`packages/core/vitest.config.ts`）：

| 配置 | 值 | 为什么 |
| --- | --- | --- |
| `testTimeout` / `hookTimeout` | 60 000 | 只放宽**超时上限**，不放宽任何断言 —— 门禁强度不受影响 |
| `maxWorkers` | **4** | 见下方「CPU 超订」说明 |

与 `apps/web/vitest.config.ts` 的 `testTimeout` 保持同一量级。

### 4.3.1 特别说明：CPU 超订（`maxWorkers`）

这是本项目最容易踩的坑，**根因不是测试写得慢，而是测试之间互相抢 CPU**。

**现象**：同一份代码、同一个机器，两次运行结果完全不同：

| 运行方式 | 耗时 | 结果 |
| --- | --- | --- |
| 不限制 worker（本机 16 核 → 开 31 个 worker） | **351s** | **10 个用例超时失败** |
| `--maxWorkers=4` | **33s** | **全部通过** |

**原因**：`packages/core` 有 30+ 个测试文件，其中近半会反复创建保险库（每次都要跑一次
scrypt N=32768，纯 CPU 密集）。让 Vitest 按 CPU 核数开满 worker，等于让 31 个进程
同时抢 16 核 —— 每个 scrypt 都被拖慢到分钟级，最终以「测试超时」的形式失败。

**CI 会更严重**：GitHub 的 `ubuntu-latest` runner 只有 **2～4 核**，
超订比例比本地更高，因此这不是「本地才会遇到」的问题，而是**CI 必踩**。

**为什么不能靠加大超时解决**：把 `testTimeout` 调到 5 分钟只会把 351s 的等待拉长，
而且 CPU 超订会让**每个**用例都变慢，总耗时依然不可接受。
限制并发才是正解 —— 它同时把总耗时从 351s 降到 33s。

**验收基线**：`npm run test`（core 包）应在 **1 分钟内**跑完 33 个测试文件。
若显著超过，说明 `maxWorkers` 被改动了。

### 4.3.2 特别说明：性能基准不要与覆盖率同跑

`csv-benchmark.test.ts` 断言的是**墙钟时间**（10 万行 ≤ 3s）。
V8 覆盖率插桩会给每行代码加计数，**显著拉长被测代码的执行时间**，
导致同一份代码在插桩后耗时暴涨：

| 运行方式 | 10 万行解析耗时 | 结果 |
| --- | --- | --- |
| 单独跑（无插桩） | ~320ms | 通过（余量 9 倍） |
| 带覆盖率插桩 | 2087ms ～ 4849ms | **时快时慢，flaky** |

因此 **性能基准必须放在独立的 `bench` job**（无覆盖率），
不要在 `coverage` job 里跑 —— 否则基准会因为插桩开销而随机失败，
把「性能退化」和「插桩开销」两件事混在一起，无法排查。

`coverage` job 里若确实需要跑性能用例，请用 `--exclude` 排除：

```bash
cd packages/core && npx vitest run --coverage --exclude='tests/performance/**'
```


### 4.4 `coverage` 失败

**现象 A**：退出码非 0，日志里有 `ERROR: Coverage for lines (X%) does not meet global threshold (80%)`

→ core 整体覆盖率不足 80%。**修法**：在 `packages/core/tests/` 下新增测试文件补覆盖
（不要改动既有断言）。补完后重跑 `npm run coverage` 确认。

**现象 B**：日志里有 `ERROR: Coverage for lines (X%) does not meet "src/crypto/**" threshold (85%)`

→ 加密 / CSV / 时间 / 金额目录必须 ≥ 85%（全局 ≥ 80% / 70%），差一格都不行。日志会指出具体是哪个目录、哪项指标。

**现象 C**：报 `Coverage threshold not met` 但覆盖率数字看起来很高

→ 检查是不是**某个文件**没覆盖到。HTML 报告（`packages/core/coverage/index.html`）
会逐文件列出未覆盖行。`vitest --coverage` 的 text 报告里带 `Uncovered Line #s` 的一列会直接标出。

**现象 D**：报 `The coverage report directory ... is already in use by another Vitest process`

→ 有另一个 Vitest 进程在写同一个报告目录。**串行执行**即可（见 §3.4）。

### 4.5 `compliance` 失败

**排查步骤**：

```bash
# 单独跑某一条
npm run check:compliance
npm run check:no-network
npm run check:sync-payload
```

**输出格式**：`[合规检查] 未通过，命中以下问题：` 后跟每一条违规，例如：

```
  - [R1] 核心层出现 DOM 标识 window：packages/core/src/xxx.ts
  - [X-01 ①] 加密 / 密钥模块出现网络出口，违反红线：
  - x.ts 命中 fetch × 1
```

**处理原则**：

- **R1 / R3 / R6 / R7**（零 DOM / 零网络 / 无采集 / 无外域）—— 属于**真实违规**，
  必须改代码，不能加白名单绕过。
- **R2 / R8**（依赖纯净 / 无后门文案）—— 同上。
- 若确信是**误报**（例如某个词恰好出现在注释里），脚本已做「先剥离注释再匹配」的处理；
  仍有误报时，应在脚本里补充精确的排除规则并写明理由，**不要**直接删规则。

### 4.6 `bench` 失败

**排查步骤**：

```bash
npm run bench

# 单独看耗时
cd packages/core && npx vitest run --reporter=verbose tests/performance
```

**常见原因**：

| 现象 | 可能原因 |
| --- | --- |
| 10 万行耗时接近 3s | 解析器退化成逐行字符串拼接 → 检查是否有多余的 `split` / `join` |
| 流式解析比批量解析慢很多 | 流式状态机每行做了额外工作 → 检查 chunk 边界处理 |
| 机器负载高导致超时 | CI runner 被其他任务抢占 → 重跑一次确认 |

---

## 5. 覆盖率门禁的判定规则

### 5.1 阈值定义（`packages/core/vitest.config.ts`）

| 范围 | lines | functions | branches | statements |
| --- | --- | --- | --- | --- |
| **全局**（core 整体） | ≥ 80% | ≥ 80% | ≥ 70% | ≥ 80% |
| `src/money/**` | ≥ 85% | ≥ 85% | ≥ 85% | ≥ 85% |
| `src/time/**` | ≥ 85% | ≥ 85% | ≥ 85% | ≥ 85% |
| `src/crypto/**` | ≥ 85% | ≥ 85% | ≥ 85% | ≥ 85% |
| `src/csv/**` | ≥ 85% | ≥ 85% | ≥ 85% | ≥ 85% |

**为什么这四个目录要设高阈值**（需求 NF-M-4 / 系统设计 §7 T05 第 4 条）：
这四个目录承载的是**金额精度、时间与时区、加密正确性、CSV 解析**四条业务主线，
一条用例走错就是「账单金额算错」或「密文解不开」这种不可逆的用户损失。
覆盖率只能保证「代码路径被走过」，不能保证「断言正确」，所以这四个目录必须
**绝大多数分支都被测到**，不允许留大片未覆盖行。

> **阈值沿革**：四目录最早要求 100%，但 QA 复核确认核心层含若干纯接口 / 纯类型文件（无运行时语句，V8 报 0%）
> 使目录聚合永远达不到 100%；即便排除这些文件，仍残留少量防御性分支缺口。
> 经评估（2026-10-30）将下限统一设为 **85%** —— 仍远高于普通项目、足以拦截大规模回归，同时可达成。
> `coverage.exclude` 已补充这些纯类型文件。如需进一步上调，优先以「补测试」而非「降阈值」为之。

### 5.2 覆盖率计算口径

- Provider：`v8`（原生覆盖率，无需插桩，精度高）
- `include`：`src/**/*.ts`
- `exclude`：`src/index.ts`、`src/**/index.ts`（纯再导出文件，无逻辑）、`src/crypto/providers/node-crypto-provider.ts`（Node 专用实现，由 Web 端与 Node 端的一致性测试间接覆盖）、`src/crypto/provider.ts`、`src/models/common.ts`、`src/models/app-settings.ts`（纯接口 / 纯类型文件，无运行时语句，V8 一律报 0%，计入会结构性拉低目录聚合）

### 5.3 glob 阈值是怎么匹配的

Vitest 5 把 `thresholds` 里**不是** `lines`/`functions`/`branches`/`statements`/`perFile`/`autoUpdate`/`100`
的键当作 **glob 模式**处理，用 `picomatch` 对**相对项目根目录**的文件路径做匹配。
因此 `src/money/**` 匹配的是 `packages/core/src/money/` 下的所有文件。

这也解释了为什么键必须写成 `src/money/**` 而不是 `packages/core/src/money/**` ——
匹配基准是**包根**，不是仓库根。

---

## 6. 性能基准的判定规则

| 指标 | 阈值 | 需求编号 | 风险编号 |
| --- | --- | --- | --- |
| CSV 解析 10 万行 | ≤ 3s | NF-P-1 | R-08 |
| CSV 解析 1 万行 | < 1s | NF-P-1（1/10 规模） | R-08 |
| CSV 流式解析 10 万行 | ≤ 3s | NF-P-1 | R-08 |

**基准跑在 CI 上会受 runner 性能影响**。当前实测有约 9 倍余量（320ms vs 3000ms），
因此即使 runner 明显慢于开发机也能稳定通过。若将来余量被吃掉，
正确做法是**优化解析器**（把列映射预编译成索引数组，避免每行做键查找），
而不是放宽阈值。

---

## 7. 已知限制与后续建议

### 7.1 当前限制

| # | 限制 | 影响 | 建议 |
| --- | --- | --- | --- |
| 1 | **CI 无法在本地完整运行** | 提交前无法 100% 复现 CI 行为 | 用 `npm run ci` 覆盖 6/7 的本地等价物；剩余部分（action 版本、runner 环境）建议首次推送后开一个 PR 观察 |
| 2 | **覆盖率报告目录的进程锁** | 并发跑测试与覆盖率会报 `already in use` | 串行执行；或用 `--coverage.reportsDirectory=<独立目录>` |
| 3 | **`npm run coverage` 依次跑三个包** | 总耗时较长（core 约 3～5 分钟） | 可接受；若变慢可拆成多个 job |
| 4 | **web 包未设覆盖率阈值** | web 覆盖率只出报告，不阻断 | 当前 web 属表现层，红线在 core；建议等 web 稳定后补一个宽松阈值（如 60%） |
| 5 | **分支保护需在 GitHub 仓库设置** | YAML 本身无法强制「必须过 CI 才能合并」 | 仓库设置里把 `lint` / `typecheck` / `test` / `coverage` / `bench` / `audit` 与 `Compliance / red-lines (3)` 设为 required check |
| 6 | **审计 job 未纳入 `npm ci` 后的锁文件校验** | 理论上可能出现锁文件与 `package.json` 不一致 | `npm ci` 本身就会在不一致时报错，已覆盖 |

### 7.2 后续建议（按优先级）

1. **加 `format:check` job**：仓库已有 `prettier --write`，但 CI 里没有「格式检查」，
   建议加一个 `npm run format:check` 的 job，避免格式抖动污染 diff。
2. **加产物归档**：把 `apps/web` 的构建产物（`npm run build`）也作为 artifact 上传，
   便于发版前核对前端产物。
3. **覆盖率趋势留痕**：把 `lcov` 报告存成 artifact（当前已存 HTML + lcov），
   可进一步接入覆盖率趋势服务，盯住「覆盖率在慢慢下降」这种慢性问题。
4. **加 `dependabot.yml`**：让依赖版本升级由机器人提 PR，配合 `audit` job 形成闭环（R-11）。
5. **把 `check-sync-payload.mjs` 的静态扫描范围扩到服务端**：
   目前只扫客户端的 3 个文件，服务端的 `store.ts` / `validation.ts` 尚未纳入
   （等同步服务契约定稿后由对应轨道落地）。
6. **性能基准加趋势记录**：把 10 万行耗时作为指标输出，便于在性能悄悄退化时提前发现。
