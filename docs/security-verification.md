# LifeHub 安全红线验证报告

> 文档版本：v1.0 ｜ 日期：2026-10-30 ｜ 作者：寇豆码（Kou）· 工程师（轨道C）
> 状态：已交付。范围＝把系统设计 §8.8 的 **R1–R10** 与 PRD 的 **X-01 / X-03 / X-07 / X-10 / A-07**
> 从「口头声明」变成「**可执行、可复核的证明**」。
>
> 本文档只描述**验证方式**与**结论**，不重复需求正文。
> 需求正文见 `docs/PRD.md` §4.2，设计约束见 `docs/system_design.md` §8.2 / §8.5 / §8.6 / §8.8。

---

## 0. 一句话结论

| 维度 | 结论 |
| --- | --- |
| 新增测试文件 | **6 个**（`packages/core/tests/security/**` 5 个 + `packages/core/tests/compliance/**` 1 个） |
| 新增用例 | **136 个**（security 104 + compliance 32） |
| 全仓用例 | **317 → 453**（core 包，33 个测试文件，**全部通过**） |
| R1–R10 结论 | **R1–R9 全部通过**；**R10 部分通过**（结构性缺失 0 条；`@returns`/`@throws` 存在 **5 条已登记缺口**，已上报主理人裁决） |
| 发现的安全缺陷 | **0 个真实安全漏洞**；发现 **5 处 JSDoc 规范缺口**（非安全漏洞，其中 1 处是**误导性注释**）；发现 **1 处 flaky 测试缺陷**（`tests/qa/qa-error-contract.test.ts`，约 3% 概率，已上报） |
| 全部断言强度 | 未做任何降级；每条静态扫描都配了「**扫描器自检**」，确保「0 违规」不是规则写错造成的假阴性 |

### 真实执行输出（2026-10-30）

```
$ cd packages/core && npx vitest run tests/security/ tests/compliance/
 Test Files  6 passed (6)
      Tests  136 passed (136)
   Duration  70.05s
```

```
$ cd packages/core && npx vitest run            # 全仓
 Test Files  33 passed (33)
      Tests  453 passed (453)
   Duration  2m 21s
```

```
$ npm run check:compliance
[合规检查] 通过：已扫描 145 个源码文件、4 份 package.json 与 424 个锁文件依赖包名，
未发现采集调用、统计 SDK、银行域名、核心层 DOM 依赖或禁用文案。

$ npm run check:no-network
[X-01 ①] 通过：已扫描 17 个加密 / 服务层文件，未发现任何网络出口。

$ npm run check:sync-payload
[X-01 ④] 通过：同步载荷 / 备份的静态断言全部通过；运行时探针跳过（缺少 vite-node，
等价单测仍在 npm run test 中执行）。
```

**类型检查**：本轨道 6 个测试文件的类型错误数 = **0**。

**覆盖率**（`vitest run --coverage`，全量 453 用例）：

| 目录 | 基线（317 用例） | 含本轨道（453 用例） | 变化 |
| --- | --- | --- | --- |
| **All files（Stmts）** | 77.78% | **78.60%** | **+0.82pt** |
| `src/services` | 85.81% | **90.54%** | **+4.73pt** |
| `src/storage` | 62.98% | **63.63%** | **+0.65pt** |
| `src/crypto` | 72.85% | 72.85% | — |
| `src/money` | 90.27% | 90.27% | — |
| `src/time` | 86.20% | 86.20% | — |
| `src/csv` | 88.23% | 88.23% | — |
| `src/repositories` | 54.83% | 54.83% | — |

> 覆盖率阈值的失败项在基线与含本轨道两次运行中**完全相同（各 19 条 `ERROR:`）**，
> 即 `src/money/**`、`src/time/**`、`src/crypto/**`、`src/csv/**` 的 100% 阈值
> **在基线就已不达标**，与本轨道无关。本轨道**未降低**任何覆盖率指标，
> 且把 `src/services` 提升了 4.73 个百分点。

---

## 1. 交付物清单

| # | 文件 | 用例数 | 覆盖的需求 / 红线 |
| --- | --- | --- | --- |
| 1 | `packages/core/tests/security/crypto.test.ts` | 39 | **A-07 ①③④⑤⑥⑦**、NF-S-1/2/3/4、**R3**、R4、R5；系统设计 §5 假设 A-6 |
| 2 | `packages/core/tests/security/sync-payload.test.ts` | 14 | **X-01 ①②③④**、NF-S-1、NF-PR-6、**R4**、**R5**；ADR-003、ADR-006 |
| 3 | `packages/core/tests/security/recovery-code.test.ts` | 21 | **X-03 ①②③④⑤**、X-04 ①②、**R4**、**R5**；ADR-003 §4 |
| 4 | `packages/core/tests/security/audit-log.test.ts` | 15 | **X-07 ①②③④⑤**、PRD §3.1.4、**R4**、**R5**、R7；系统设计 §8.5 |
| 5 | `packages/core/tests/security/key-rotation.test.ts` | 15 | **X-10**、**R4**；系统设计 §1.2 难点 6、ADR-003 §1 |
| 6 | `packages/core/tests/compliance/redlines.test.ts` | 32 | **R1–R10 全部**；PRD §3.2、§4.2；系统设计 §8.2、§8.5、§8.6、§8.8 |
| | **合计** | **136** | |

> 所有测试文件均带**中文 JSDoc 文件头**，注明覆盖的需求编号与红线编号。
> 全部只读取 `packages/core/src/**` 与其它包的**源码文本**，不修改任何生产代码。

---

## 2. R1–R10 逐条结论（可复核证据表）

### R1 · `packages/core` 零 DOM —— ✅ 通过

| 项 | 内容 |
| --- | --- |
| **验证方式** | ① 源码静态扫描（**先剥离注释再匹配代码**）；② `tsconfig` 的 `lib` 断言；③ 导入路径断言；④ **扫描器自检** |
| **对应测试** | `packages/core/tests/compliance/redlines.test.ts` → `describe('R1 扫描器自检 …')` + `describe('R1 · packages/core 零 DOM')` |
| **断言内容** | 真实代码中不出现 `window` / `document` / `localStorage` / `sessionStorage` / `indexedDB` / `navigator` / `globalThis.window` / `globalThis.document` / `globalThis.localStorage` / `globalThis.navigator`；`tsconfig` 的 `lib` 只含 `"ES2022"`；除 `node-crypto-provider.ts` 外不 `import 'node:…'`；不 import `node:fs/path/os/url/child_process/http/https` |
| **关键设计** | **必须先剥离注释**：核心层的中文 JSDoc 里**合法地**出现 `window.crypto` 字样（如 `crypto/provider.ts:5` 明确写着「绝不直接访问 `window.crypto`」），不剥离必然误报 |
| **防止假阴性** | 「扫描器自检」用 4 个样本证明剥离器**双向正确**：① 注释里的 `window` 不误报；② **真实代码里的 `window.localStorage` 一定能被检出**；③ 行注释里的 `window` 不误报；④ 字符串字面量里的 `https://` 不被当成注释起点 |
| **证据** | `vitest run tests/compliance/redlines.test.ts` → R1 全部 8 个用例通过 |
| **结论** | **通过** |

### R2 · core 依赖不含 React / MUI / Dexie / 统计 SDK —— ✅ 通过

| 项 | 内容 |
| --- | --- |
| **验证方式** | ① `packages/core/package.json` 依赖白名单断言；② 锁文件**按包名精确 / 前缀匹配**扫描（避免 `es-set-tostringtag` 这类误报） |
| **对应测试** | `redlines.test.ts` → `describe('R2 · …')` |
| **断言内容** | core 的 `dependencies` **恰好**等于 `['@noble/ciphers', '@noble/hashes']`；`dependencies + devDependencies` 均不含 `react` / `react-dom` / `react-router-dom` / `@mui/material` / `@emotion/*` / `dexie` / `axios` / `papaparse` / `moment` / `dayjs` / `date-fns` / `lodash` 及 16 个统计 SDK；全仓 `package-lock.json` 无任何埋点 / 统计 / 广告包 |
| **结论** | **通过** |

### R3 · 加密 / 密钥模块零网络出口 —— ✅ 通过

| 项 | 内容 |
| --- | --- |
| **验证方式** | ① 源码静态扫描（剥离注释后匹配）；② **运行时断言**（加密链路全程不触发 `fetch`） |
| **对应测试** | `redlines.test.ts` → `describe('R3 · …')`；`crypto.test.ts` → `describe('R3 · 加密链路全程零网络出口（运行时断言）')` |
| **断言内容** | `crypto/**` 与 `services/**` 的真实代码中不出现 `fetch(` / `XMLHttpRequest` / `WebSocket` / `sendBeacon` / `EventSource` / `importScripts` / `navigator.sendBeacon` / `navigator.geolocation`；运行时把 `globalThis.fetch` 换成会抛错的 spy，执行「加密 → 解密 → 再加密」全程后断言 **spy 从未被调用** |
| **结论** | **通过** |

### R4 · 存储层无明文业务写入口 —— ✅ 通过

| 项 | 内容 |
| --- | --- |
| **验证方式** | ① 常量白名单断言；② **运行时**验证守卫拦得住；③ **运行时**验证业务实体确实是密文载荷；④ 源码断言 |
| **对应测试** | `redlines.test.ts` → `describe('R4 · …')`；`sync-payload.test.ts` → `describe('X-01 ② / ADR-006 · …')` |
| **断言内容** | `PLAIN_ENTITY_TYPES` **恰好**等于 `['vaultParams','recoveryMeta','appSettings']`；把 `'bill'` 强转后写进 `PlainStore` 必须抛 `LIFEHUB_E_VALIDATION`；经 `EncryptedStore` 写入的账单，其落盘记录 `payload.kind === 'encrypted'`；`plain-store.ts` 的真实代码里不出现任何业务实体类型字面量；落盘记录顶层字段**恰好**是 ADR-006 规定的 9 个键（7 个索引明文列 + `payload`），且**不含** `amountMinor` / `counterparty` / `note` / `categoryId` / `direction` / `body` |
| **结论** | **通过** |

### R5 · 同步载荷与备份只含密文 —— ✅ 通过

| 项 | 内容 |
| --- | --- |
| **验证方式** | ① 源码静态扫描（明文字段名黑名单）；② **运行时**载荷字段白名单断言；③ **端到端全文检索**（见下） |
| **对应测试** | `redlines.test.ts` → `describe('R5 · …')`；`sync-payload.test.ts` → `describe('X-01 ④ / R5 · …')` |
| **断言内容** | `sync-payload.ts` / `encrypted-blob.ts` / `backup-service.ts` 的真实代码中不出现 `amountMinor` / `counterparty` / `categoryId` / `note` / `title` / `body` / `content` / `password` / `salt` / `dek` / `masterKey` 字段名；同步载荷的每个 blob 的键**全部落在** `SYNC_BLOB_ALLOWED_FIELDS` 白名单内；备份文件顶层不含 `salt` / `dek` / `masterKey` / `verifier`；构造含 `amountMinor` 的载荷会被 `assertCiphertextOnly` 拒绝 |
| **端到端检索** | 从真实运行时导出同步载荷与加密备份，把整份产物（含 `Uint8Array` 展开成 hex + latin1）做**全文检索**，明文样本 `星巴克(国贸店)` / `128.50` / `含逗号, 的备注` / `今天的日记正文：天气很好` / `机密项目 Alpha` 的**命中数必须全部为 0** |
| **防止假阴性** | 配套「对照组」用例：证明这些明文**确实存在于业务对象中**、且检索器对明文有效（用 `formatMinor` 还原出的 `128.50` 命中数为 1） |
| **结论** | **通过** |

### R6 · 无采集调用（定位 / 设备号 / 通讯录 / 麦克风） —— ✅ 通过

| 项 | 内容 |
| --- | --- |
| **验证方式** | 源码静态扫描（core + Web 双端，剥离注释后匹配） |
| **对应测试** | `redlines.test.ts` → `describe('R6 · …')` |
| **断言内容** | 不出现 `geolocation` / `getCurrentPosition(` / `getUserMedia(` / `navigator.imei` / `navigator.serial` / `navigator.bluetooth` / `navigator.usb` / `navigator.credentials` / `getBattery(` / `addressBook` / `ContactsManager` / `fingerprint(` |
| **备注** | Web 端 `platform/device-label.ts` 读取 `navigator.userAgent` **仅为显示浏览器名**，不构成设备标识采集；该文件已自带「不采集 IMEI / 指纹」的说明 |
| **结论** | **通过** |

### R7 · 无指向外部域名的请求 —— ✅ 通过

| 项 | 内容 |
| --- | --- |
| **验证方式** | ① 域名扫描；② Web 端网络 API 扫描；③ CSP 断言；④ 同步服务「无解密能力」断言 |
| **对应测试** | `redlines.test.ts` → `describe('R7 · …')` |
| **断言内容** | core / Web / sync-server 源码不含 `icbc.com.cn` / `cmbchina.com` / `ccb.com` / `abchina.com` / `boc.cn` / `bankofchina.com` / `unionpay.com` / `alipay.com` / `tenpay.com` / `unionpayintl.com`；Web 端真实代码不出现 `fetch(` / `XMLHttpRequest` / `WebSocket` / `sendBeacon` / `EventSource`；`apps/web/index.html` 含 `Content-Security-Policy` 且 `connect-src 'self'`；同步服务源码不出现 `createCipheriv|createDecipheriv` / `decrypt(` / `scrypt` |
| **结论** | **通过** |

### R8 · 无「找回密码 / 客服解封 / 后门恢复」入口 —— ✅ 通过

| 项 | 内容 |
| --- | --- |
| **验证方式** | ① 全仓文案扫描；② **反射式**检查保险库服务的公开方法 |
| **对应测试** | `redlines.test.ts` → `describe('R8 · …')` |
| **断言内容** | core / Web / sync-server 源码不含 `找回密码` / `客服解封` / `后门恢复` / `一键找回` / `人工解锁` / `客服协助` / `官方找回`；`VaultService.prototype` 上不存在 `adminUnlock` / `backdoor` / `resetPassword` / `masterUnlock` / `bypass` 等方法 |
| **结论** | **通过** |

### R9 · 金额、日期、时间格式与 §8.2 一致 —— ✅ 通过

| 项 | 内容 |
| --- | --- |
| **验证方式** | ① 常量层逐条断言；② **运行时**行为断言；③ 源码断言（禁用 `toFixed` / `parseFloat` 参与金额运算） |
| **对应测试** | `redlines.test.ts` → `describe('R9 · …')` |
| **断言内容** | **常量**：`ISO_UTC_PATTERN` / `LOCAL_DATE_PATTERN` / `WALL_CLOCK_PATTERN` 的正则源码逐字符比对；`ENCRYPTION_ALGORITHM === 'AES-256-GCM'`；`VAULT_VERIFIER_PLAINTEXT === 'lifehub:verify:v1'`；`KDF_DEFAULT_PARAMS = {n:32768,r:8,p:1,keyLength:32,saltLength:16}`；`BACKUP_MAGIC === 'LIFEHUB-BACKUP'`；`IMPORT_BATCH_SIZE === 1000`；恢复码 12 组 × 6 字符 + 字符集 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`；`CURRENCY_EXPONENT = {CNY:2,JPY:0,KWD:3}`；方向关键词表非空<br>**运行时**：`parseAmountToMinor('128.50') === 12850`（含千分位与货币符号写法）；`formatMinor(12850) === '128.50'`；`sumMinor` 整数求和；非整数分抛 `LIFEHUB_E_VALIDATION`；`formatIsoUtc` 匹配 ISO 正则；`toLocalDate` / `toWallClock` 匹配各自正则；**跨天用例**：UTC `2024-01-15T20:30Z` 在 UTC 下是 `2024-01-15`、在 `Asia/Shanghai` 下是 `2024-01-16`<br>**源码**：`src/money/**` 的真实代码中不出现 `toFixed(` / `parseFloat(` |
| **结论** | **通过** |

### R10 · 每个导出函数有完整 JSDoc —— ⚠️ 部分通过（5 条已登记缺口）

| 项 | 内容 |
| --- | --- |
| **验证方式** | 源码扫描 + **扫描器自检**（正向 4 条坏样本 + 反向 1 条好样本） |
| **对应测试** | `redlines.test.ts` → `describe('R10 · …')`（3 个用例） |
| **断言内容** | **结构性缺失（严格 0）**：导出函数 / 类 / 公共方法必须有 JSDoc 块、首行必须有中文说明、每个参数必须有 `@param`。当前 **0 条**<br>**`@returns` / `@throws`（恰好等于已登记基线）**：缺失集合必须**恰好**等于已登记的 5 条，任何**新增**缺口立即失败 |
| **扫描器自检** | ① 完全无 JSDoc → 检出；② 只写了第一个参数的 `@param` → 检出漏项；③ 有 `@param` 无 `@returns` → 检出；④ 函数体含 `throw` 无 `@throws` → 检出；⑤ **合规样本不被误报** |
| **扫描规模** | 断言 `checked > 100`（实际扫描到 **86 个导出函数 + 27 个导出类 + 121 个公共方法**），确保「0 缺失」不是规则写错的假阴性 |
| **已知缺口（5 条）** | 见 §3 |
| **结论** | **部分通过** —— 结构性缺失 0 条；`@returns`/`@throws` 尚有 5 条缺口待上游修复 |

---

## 3. R10 的 5 条已知缺口（已上报主理人）

**性质**：注释规范缺口，**不影响运行时行为、不泄露任何数据**，因此不属于「真实安全 bug」，
按「不得擅自修改 `packages/core/src/**`」的约束**未擅自修复**，已 SendMessage 上报主理人裁决。

| # | 文件 | 行号 | 符号 | 问题 |
| --- | --- | --- | --- | --- |
| 1 | `packages/core/src/crypto/providers/web-crypto-provider.ts` | 82 | `get isAvailable()` | 单行 JSDoc 说明了含义，但缺 `@returns` |
| 2 | `packages/core/src/crypto/providers/node-crypto-provider.ts` | 46 | `get isAvailable()` | 同上 |
| 3 | `packages/core/src/crypto/providers/noble-fallback-provider.ts` | 35 | `get isAvailable()` | 同上 |
| 4 | `packages/core/src/money/amount.ts` | 86 | `formatMinor()` | 会抛 `LIFEHUB_E_VALIDATION`，但 JSDoc 未声明 `@throws` |
| 5 | `packages/core/src/repositories/vault-repository.ts` | 97 | `markRecoveryExported()` | 会抛 `LIFEHUB_E_ENTITY_NOT_FOUND`，而 JSDoc 却写 **`@returns 无异常`** —— **误导性注释**，优先级最高 |

> **测试的守卫强度**：基线断言用的是「**恰好相等**」而非「小于等于」。
> 因此：**新增**任何一条缺口都会让 CI 立刻变红；上游修好后，删除对应基线条目即可。
> 这 5 条在测试源码与本表中**明文可见**，不存在被隐藏的情况。

---

## 4. A-07 / X-01 / X-03 / X-07 / X-10 的关键验证点

### A-07 · 加密封装完整矩阵（`crypto.test.ts`，39 例）

| 验证点 | 断言 | 为什么重要 |
| --- | --- | --- |
| 同口令 + 同 salt 两次派生**逐字节相同** | `toHex(first) === toHex(second)` | 「可复现」是 KDF 的基本性质 |
| 不同口令 / 不同 salt → 密钥不同 | `not.toBe` | 防止实现退化成「忽略口令 / 忽略盐值」 |
| **1000 次随机 IV 无碰撞**（Web + Node 各一轮） | `new Set(...).size === 1000` | 既有测试只断言「两次 IV 不同」，**无法排除 IV 由计数器派生**；1000 次唯一才真正证伪该退化 |
| 篡改 **ciphertext** | 抛 `LIFEHUB_E_CRYPTO_AUTH_FAILED`，`resolved === undefined` | GCM 认证失败 |
| 篡改 **iv** | 同上 | 同上 |
| 篡改 **tag** | 同上 | 同上 |
| 篡改 **AAD** | Provider 层抛错且不返回明文 | AAD 参与认证 |
| **密文跨记录搬移**（换 entityId / 换 entityType / 换 keyVersion） | 全部 `LIFEHUB_E_CRYPTO_AUTH_FAILED` | 「密文搬移」攻击的唯一防线 |
| 失败时**不泄漏部分明文** | `resolved === undefined` 且异常序列化结果不含明文片段 | NF-S-4 |
| 空明文（0 字节） / 空对象 / **1 MiB 超长明文** | 正常往返，不崩溃 | 边界 |
| 密钥长度非法 | `LIFEHUB_E_VALIDATION` | 错误码契约 |
| **Web ↔ Node 交叉一致**（重点） | 生产默认参数 `N=32768` 下两端派生**逐字节相同**；Web 密文 Node 能解、Node 密文 Web 能解；业务层 `CryptoService` 同样成立；两端 SHA-256 摘要相同 | 系统设计 §5 假设 A-6，**此前未被充分验证**；Node Provider 经 `@lifehub/core/node` 子路径导入，与浏览器端引用方式一致 |
| DEK 包裹同样受 AAD 保护 | 换 keyVersion / 换主密钥 → 失败；三 Provider 互相能解包 | ADR-003 §1 |
| 口令哨兵 | 正确口令 `verifyPassword === true`；错误口令 `=== false`（不抛错） | A-07 ⑦ |
| 落盘无口令派生值 | 哨兵载荷的 hex 中检索不到口令与密钥 | X-04 ② |
| **NF-S-2 内存擦除** | `wipeBytes` 把 32 字节密钥**全部清零**；传 `null`/`undefined` 安全返回 | 密钥锁定即擦除 |
| DEK / 盐值生成 | `generateDek` 产出 32 字节且两次不同；`generateSalt` 产出 16 字节且两次不同 | — |
| `assertKeyLength` | 接受 32 字节、拒绝 16 / 33 字节 | 错误码契约 |
| **KDF 参数序列化往返** | `serialize → deserialize` 后盐值与各参数逐字段一致；**往返后派生出的密钥与原始完全相同** | A-07 ⑥ 参数升级不丢盐值 |

### X-01 · 端到端加密与密文搬移防护（`sync-payload.test.ts`，14 例）

- **全文检索命中数严格为 0**：同步载荷 / 加密备份 / 整个适配器落盘内容，对 5 个明文样本命中数全为 0；
- **检索器有效性有对照组**：证明明文确实在业务对象里，且 `formatMinor` 还原出的 `128.50` 能被检出（命中 1）—— 排除「搜不到是因为没数据」的假阴性；
- **AAD 绑定**：A 记录密文搬到 B 记录 / 搬到别的实体类型 / 搬到别的 keyVersion，三种搬移**全部**解密失败；
- **对照组**：未搬移的原记录仍能正常解密（证明失败不是因为「本来就解不开」）；
- **ADR-006**：落盘记录顶层字段恰好 9 个（7 索引明文列 + payload），不含任何业务语义字段。

### X-03 · 恢复码（`recovery-code.test.ts`，21 例）

- **恢复码明文绝不落本地库**：检索**整个适配器落盘内容**（所有实体类型 × 全部记录 × 字节展开为 hex + latin1），恢复码原文 / 去分隔符形式 / **任意单个分组**的命中数**全部为 0**；
- **`RecoveryMeta` 结构里根本没有存放明文的字段**：键集合恰好是 `checksum / createdAt / exported / id / kdfParams / salt / wrappedDek`；
- **重新生成后旧码立即失效**：旧码在「校验和」这一步就被拒（`LIFEHUB_E_VAULT_PASSWORD_WRONG`）；落盘的校验和与恢复盐值均已更换；
- **正确恢复码能真正解密已有数据**：解锁后走**正常读路径** `bills.getById()`，读出 `counterparty` / `note` / `amountMinor` 的**明文**——不是「拿到 32 字节 DEK 就算通过」；
- 恢复码解出的 DEK 与口令解出的 DEK **完全相同**（同一把数据密钥）；
- 格式约束：12 组 × 6 字符、字符集剔除 `I/O/0/1`、组数不足 / 校验位错 / 含非法字符一律判非法；
- 错误码分流：格式非法 → `LIFEHUB_E_RECOVERY_INVALID`；格式合法但内容不符 → `LIFEHUB_E_VAULT_PASSWORD_WRONG`（不泄露「恢复码存在」）；
- X-04 ②：`VaultParams` 只含公开 KDF 参数 + 哨兵密文 + 被包裹的 DEK；落盘内容检索不到主口令。

### X-07 · 审计日志（`audit-log.test.ts`，15 例）

- 连续两次 `unlock` → **两条** `unlock` 记录，`success` 均为 `true`；
- 解锁失败 → `failed_unlock`，`success === false`；
- **审计记录本身加密存储**：落盘 `payload.kind === 'encrypted'`；落盘内容里检索不到 `create_vault` / `failed_unlock` / `unlock` / 明文设备标签 `本机 · 测试`；
- 「审计记录加密」这条同样配了**反向断言**：解密后能读回完整字段（证明不是「什么都没写」）；
- 5 个必记字段齐备：`at`（ISO 8601 UTC）/ `action`（取自 PRD §3.1.4 的九类枚举）/ `target` / `deviceLabel` / `success`；
- `clear()` 后 `list()` 为空**且**存储层记录确实被删除；`clear()` 不影响业务数据；
- 审计不上传：`SYNC_BLOB_ALLOWED_FIELDS` 不含 `action` / `deviceLabel` / `at` / `success`；审计落盘内容不含业务明文；
- 审计写入失败**不阻断主流程**（存储故障时 `audit.log` 仍返回条目、不抛异常）。

### X-10 · 密钥轮换（`key-rotation.test.ts`，15 例）

> 本轮交付边界：系统设计 §1.2 难点 6 明确「只落接口 + 参数校验 + 轮换计划」，
> 完整的重包裹 + 逐条重加密 + 续跑排期在阶段 5。因此**不断言尚未实现的行为**。

- `rotateMasterKey` 参数校验：旧口令错 → `LIFEHUB_E_VAULT_PASSWORD_WRONG`；新口令太短 → `LIFEHUB_E_VALIDATION`；新旧口令相同 → `LIFEHUB_E_VALIDATION`；
- 校验失败**无副作用**：落盘的 `keyVersion` 与 `currentDek` 密文均未变；
- **`RotationPlan` 结构完整**：`jobId` / `createdAt`（ISO 8601 UTC）/ `fromKeyVersion` / `toKeyVersion` / `reason` / `estimatedRecords`；
- **keyVersion 递增语义**：`toKeyVersion === fromKeyVersion + 1`（`rotateMasterKey` 与 `KeyRotationService.planRotation` 两条路径都验）；
- 作业状态结构：`pending` / 游标为 `null` / `processedRecords === 0`；`jobId` 唯一；`listStates` 可列出；
- 未实现边界：`execute` / `resume` 抛 `LIFEHUB_E_ROTATION_IN_PROGRESS`（阶段 5 实现）；
- 轮换动作记入 `rotate_key` 审计；`VaultParams.previousDek` 初始为 `null`（阶段 5 双 DEK 字段已预留）。

---

## 4A. 附：发现的其他缺陷（非本轨道文件，已上报主理人）

### 4.1 flaky 测试 · `tests/qa/qa-error-contract.test.ts:61-77`（约 3% 概率失败）

**现象**：该用例偶发失败（实测遇到 1 次；随后连续 10 次单独重跑均通过）。

```
FAIL  tests/qa/qa-error-contract.test.ts > X-03 ④ · 恢复码格式非法时抛 LIFEHUB_E_RECOVERY_INVALID
  > 格式合法但内容错误的恢复码抛 LIFEHUB_E_VAULT_PASSWORD_WRONG
AssertionError: promise resolved "{ …(3) }" instead of rejecting
```

**根因**：用例用「把第 1 组的第 1 个字符改成 `'A'`」来构造一个「内容错误但格式合法」的恢复码：

```ts
const flipped = first.slice(0, 5) === 'AAAAA' ? 'B' : 'A';
groups[0] = `${flipped}${first.slice(1, 5)}`;
```

当原码第 1 组本就以 `A` 开头（且前 5 位不是 `AAAAA`）时，`flipped` 仍为 `'A'`，
**这次「翻转」是 no-op**，拼回去的码与原码完全相同 → 解锁自然成功 → 断言「应 reject」失败。

**概率**：字符集 32 个字符，首位为 `A` 的概率 = 1/32 ≈ **3.1%**。
我用 2000 次采样脚本实测 **no-op 比例 2.8%**，即**每约 35 次执行就会红一次**。

**建议修法**：`const flipped = first[0] === 'A' ? 'B' : 'A';`（保证一定改变），
或改用固定随机源造一个必然不同的恢复码。

> **本轨道自己的对应用例没有这个缺陷**：`tests/security/recovery-code.test.ts` 的
> 「格式合法但内容错误」用例用 `generateRecoveryCode((length) => new Uint8Array(length).fill(3))`
> 造码，与本地随机码重合的概率为 32^-60 量级，**不会 flake**。

---

## 5. 复现方式

```bash
# 只跑本轨道新增的 6 个文件
cd packages/core && npx vitest run tests/security/ tests/compliance/

# 全量
npm run test

# 类型检查
npm run typecheck

# 合规脚本（CI 门禁）
npm run check:compliance
npm run check:no-network
npm run check:sync-payload
```

---

## 6. 已知限制

1. **静态扫描的固有边界**：R1/R2/R3/R6/R7/R8 依赖正则匹配源码文本，
   能覆盖「直接调用」与「字面量出现」，但**无法**证明「运行时绝不访问 DOM」——
   core 的零 DOM 保证同时依赖 `tsconfig` 的 `lib: ["ES2022"]`（无 DOM 类型）
   与「全部测试在 Node 环境跑」这一事实。
2. **R10 的 `@throws` 覆盖不完整**：系统设计 §8.6 要求 JSDoc 含 `@throws`（无异常时写「无」），
   实际仓库中**大量纯函数未写 `@throws`**（如 `toHex` / `bytesEqual` / `isDirection`）。
   本次扫描只把「**函数体直接 `throw` 却未声明 `@throws`**」计为缺口（2 条），
   未把「纯函数缺 `@throws 无`」计入（62 条），以免淹没真正的问题。
   **这 62 条属于规范偏差，不是安全缺陷**，如需彻底对齐 §8.6，应由上游统一补齐。
3. **适配器为内存实现**：存储层的落盘断言基于 `MemoryStorageAdapter`，
   未覆盖 IndexedDB（Dexie）实现的序列化差异。字节展开检索（hex + latin1）
   已在适配器层之上做，与具体后端无关。
4. **未做跨设备端到端实测**：Web 与 Node 的**密码学实现**已交叉验证（A-07），
   但「Web 端写入 → Node 端读出」的完整业务链路未跑（需要真实浏览器环境）。
5. **备份往返依赖同一把 DEK**：备份文件按设计不含 DEK（A-24 / ADR-003），
   用**不同** DEK 导入必然 `LIFEHUB_E_CRYPTO_AUTH_FAILED`——这是设计预期，不是缺陷。
6. **覆盖率阈值在基线即不达标**：`src/money/**`、`src/time/**`、`src/crypto/**`、`src/csv/**`
   的 100% 阈值要求在基线（317 用例）就已失败（19 条 `ERROR:`），
   含本轨道（453 用例）后仍是 19 条，**本轨道未降低任何覆盖率指标**，
   且把 `src/services` 提升了 4.73 个百分点。
   该阈值与现状的差距属于既有工程债，需由上游补齐既有测试或调整阈值。
7. **并行轨道的影响**：本次交付期间，轨道A 放宽了 `packages/core/vitest.config.ts` 的
   `testTimeout`（5s → 60s），轨道D 在途重构 `apps/sync-server`（一度引入 6 个类型错误，后已收口）。
   本轨道 6 个测试文件**独立通过**、**0 类型错误**，
   且对涉及 scrypt 的用例显式声明了 `VAULT_TIMEOUT = 180_000`，
   以避免覆盖率插桩下的超时抖动——**该常量只放宽超时上限，不放宽任何断言**。
