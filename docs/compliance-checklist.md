# LifeHub 合规自检清单

> 文档版本：v1.1 ｜ 日期：2026-10-30 ｜ 编制：寇豆码（工程师）｜ 复核：主理人
> 对应需求：**X-15**（合规自检清单入库）｜ 与 `docs/PRD.md` 第六节「约束与假设」逐条对应
>
> **使用方式**：每次发布前由人工逐项确认「结论」列；
> 「结论」为**待办**的条目必须在本轮发布说明中列出，或明确降级为「不适用」并写明原因。
> 凡标注「自动」的条目，均有可执行的脚本断言，命令见「依据」列。
>
> v1.1 变更：新增 §6.5「同步服务专项检查」（服务端只见密文 / 设备授权 / 快照备份，10 条）。

---

## 0. 结论图例

| 结论 | 含义 |
| --- | --- |
| **通过** | 已实现且有可执行依据（单测 / 集成测试 / 静态脚本） |
| **不适用** | 本期不涉及，或该阶段不落地（如阶段 6 的 AI 与日记功能） |
| **待办** | 已识别但本期未完成，需在后续阶段补齐；发布说明中必须列出 |

---

## 1. 红线条款检查（PRD §4.2 X 模块）

| 编号 | 需求条目 | 检查项 | 结论 | 依据 | 确认人 | 日期 |
| --- | --- | --- | --- | --- | --- | --- |
| C-01 | **X-01 ①** | 加密 / 密钥相关模块内 `fetch` / `XMLHttpRequest` / `WebSocket` / `sendBeacon` 出现次数 = 0 | 通过 | 自动：`npm run check:no-network` —— 扫描 17 个加密 / 服务层文件 | 寇豆码 | 2026-10-30 |
| C-02 | **X-01 ②** | 核心层对外导出的类型中不存在任何接收明文业务数据的同步接口 | 通过 | `packages/core/src/services/sync/sync-payload.ts` 的 `buildSyncPayload()` 只接受 `EncryptedBlob[]`；`SYNC_BLOB_ALLOWED_FIELDS` 固定白名单 | 寇豆码 | 2026-10-30 |
| C-03 | **X-01 ③** | 服务端数据结构定义中业务字段均为 `ciphertext` / `iv` / `tag` | 通过 | `apps/sync-server/src/store.ts` 的 `encrypted_blob` 表（**仅**这 10 列）；`apps/sync-server/src/validation.ts` 的 `validateBlobBody()`；请求体出现明文字段直接返回 400 且**不落盘**。断言见 `apps/sync-server/tests/store.test.ts`「表结构红线」与 `tests/server.test.ts`「明文字段一律拒绝」 | 寇豆码 | 2026-10-30 |
| C-04 | **X-01 ④** | 快照测试：导出的同步载荷中不含任何可读明文字段名 | 通过 | 自动：`npm run check:sync-payload`（静态 + 运行时探针）；等价单测 `packages/core/tests/unit/sync-payload.test.ts` | 寇豆码 | 2026-10-30 |
| C-05 | **X-02 ①** | 设置口令页与恢复码页均出现「忘记口令且无恢复码时，数据将永久无法恢复」中文提示 | 通过 | `apps/web/src/components/security/SetPasswordDialog.tsx`、`RecoveryCodePanel.tsx` | 寇豆码 | 2026-10-30 |
| C-06 | **X-02 ②** | 用户需**主动勾选确认**方可完成口令设置 | 通过 | `SetPasswordDialog` 的确认勾选 + `VaultService.assertPasswordStrength()` 双重阻断 | 寇豆码 | 2026-10-30 |
| C-07 | **X-02 ③** | 卸载 / 重置前有二次确认 | 通过 | `apps/web/src/components/common/ConfirmDialog.tsx`；`AuditLogger.clear()` 与 `VaultRepository` 清理路径均经确认弹窗 | 寇豆码 | 2026-10-30 |
| C-08 | **X-02 ④** | 全局搜索无任何「找回密码 / 客服解封 / 后门恢复」入口 | 通过 | 自动：`npm run check:compliance` 的 R8 文案黑名单扫描 | 寇豆码 | 2026-10-30 |
| C-09 | **X-03 ①** | 可生成 12 组 × 6 字符 Base32 恢复码（带组内校验位，输错可识别） | 通过 | `packages/core/src/crypto/recovery-code.ts`；单测 `tests/unit/recovery-code.test.ts` | 寇豆码 | 2026-10-30 |
| C-10 | **X-03 ②** | 恢复码与盐值备份文件可导出为本地文件 | 通过 | `apps/web/src/components/security/SaltBackupPanel.tsx` + `utils/download.ts` | 寇豆码 | 2026-10-30 |
| C-11 | **X-03 ③** | 用恢复码可成功解锁**并解密已有数据** | 通过 | `VaultService.unlockWithRecoveryCode()` 解包 `wrappedDek` 取得真正的 DEK；集成测试 `tests/integration/vault-unlock.test.ts` | 寇豆码 | 2026-10-30 |
| C-12 | **X-03 ④** | 错误恢复码被拒绝且提示格式错误 | 通过 | 校验和不符 → `LIFEHUB_E_VAULT_PASSWORD_WRONG`；格式非法 → `LIFEHUB_E_RECOVERY_INVALID`（`assertRecoveryCode()`） | 寇豆码 | 2026-10-30 |
| C-13 | **X-03 ⑤** | 恢复码**不与密文一同存储**，仅用户持有的导出文件中有明文 | 通过 | `RecoveryMeta` 只存 `checksum / salt / kdfParams / wrappedDek / exported`；集成测试断言落盘内容不含恢复码明文 | 寇豆码 | 2026-10-30 |
| C-14 | **X-04 ①** | `VaultParams`、审计日志、设置存于本地库 | 通过 | `VaultRepository` / `AuditLogRepository` / `settings-store` | 寇豆码 | 2026-10-30 |
| C-15 | **X-04 ②** | 主密码与派生密钥**不落盘明文**，仅存哨兵密文 | 通过 | `VaultParams.verifier` 为哨兵密文；`currentDek` 为被包裹的 DEK；无口令哈希字段 | 寇豆码 | 2026-10-30 |
| C-16 | **X-04 ③** | 清空浏览器数据后应用能提示「数据已丢失，请用恢复码 + 盐值备份恢复」 | 通过 | `apps/web/src/pages/SecurityPage.tsx` 的保险库状态分支；`useVault.isVaultCreated()` 返回 false 时进入引导页 | 寇豆码 | 2026-10-30 |
| C-17 | **X-04 ④** | 审计日志记录解锁成功 / 失败 | 通过 | `AuditAction` 含 `unlock` / `failed_unlock`；集成测试断言两条 `unlock` 记录与一条 `failed_unlock` 记录 | 寇豆码 | 2026-10-30 |
| C-18 | **X-05 ①** | 代码中不出现 `geolocation` / `getUserMedia` / `navigator.imei` 等采集调用 | 通过 | 自动：`npm run check:compliance` 的 R6 采集调用扫描（11 个模式） | 寇豆码 | 2026-10-30 |
| C-19 | **X-05 ②** | 无任何指向银行 / 支付平台开放接口的域名常量 | 通过 | 自动：同上，R7 域名黑名单（11 个域名） | 寇豆码 | 2026-10-30 |
| C-20 | **X-05 ③** | 应用内无「社区 / 广场 / 公开动态 / 评论 / 关注」相关路由与文案 | 通过 | `apps/web/src/router.tsx` 仅 6 条路由（导入 / 映射 / 账单 / 安全 / 设置 / 404） | 寇豆码 | 2026-10-30 |
| C-21 | **X-05 ④** | 隐私说明页逐条列出不采集手机号 / 设备标识 / 定位 / 通讯录、不做埋点统计 | 通过 | `README.md` §6「隐私与安全声明」逐条列明 | 寇豆码 | 2026-10-30 |
| C-22 | **X-06 ①** | `package.json` 依赖树中无统计 / 分析 SDK | 通过 | 自动：`npm run check:compliance` 解析 `package-lock.json` 的**包名**并与 20 项黑名单精确 / 前缀匹配；含**匹配器自检**（18 个真实 SDK 名必须命中，8 个无关依赖名不得误判） | 寇豆码 | 2026-10-30 |
| C-23 | **X-06 ②** | 页面不发起任何指向外部域名的请求 | 通过 | ① `apps/web/index.html` 的 CSP meta 已设 `connect-src 'self'`（外加 `default-src 'self'` / `object-src 'none'`）；② 核心层零网络出口（C-01）；③ Web 端未配置 AI endpoint 时无任何外部请求 | 寇豆码 | 2026-10-30 |
| C-24 | **X-07 ①** | 审计记录字段：`at` / `action` / `target` / `deviceLabel` / `success` | 通过 | `packages/core/src/models/audit.ts` 的 `AuditLog` | 寇豆码 | 2026-10-30 |
| C-25 | **X-07 ②** | 覆盖动作含解锁成功 / 失败 / 导入 / 导出 / 密钥轮换 / 恢复 | 通过 | `AUDIT_ACTIONS` 共 9 项：`create_vault` / `unlock` / `failed_unlock` / `decrypt` / `import` / `export` / `rotate_key` / `recover` / `clear_audit` | 寇豆码 | 2026-10-30 |
| C-26 | **X-07 ③** | 审计日志存本地、不上传 | 通过 | `BackupService.BACKUP_ENTITY_TYPES` 含 `auditLog` 但只搬**密文**；服务端不接收审计数据；同步载荷白名单不含审计实体 | 寇豆码 | 2026-10-30 |
| C-27 | **X-07 ④** | 提供「清除审计日志」操作并二次确认 | 通过 | `AuditLogger.clear()` + `AuditLogTable` 的确认弹窗 | 寇豆码 | 2026-10-30 |
| C-28 | **X-07 ⑤** | 单测：连续两次解锁产生两条 `unlock` 记录 | 通过 | `tests/integration/vault-unlock.test.ts`「连续两次 unlock 产生两条 unlock 审计记录」 | 寇豆码 | 2026-10-30 |
| C-29 | **X-08 ①** | 核心包不依赖任何 DOM / Node 专有 API | 通过 | `packages/core/tsconfig.json` 的 `lib: ["ES2022"]`（不含 DOM）；`tsc --noEmit` 通过 | 寇豆码 | 2026-10-30 |
| C-30 | **X-08 ②** | 加密依赖通过**可替换的适配层**注入 | 通过 | `CryptoProvider` 端口 + 三个实现（WebCrypto / NodeCrypto / Noble 兜底） | 寇豆码 | 2026-10-30 |
| C-31 | **X-08 ③** | 核心层不直接调用 `window.crypto` | 通过 | 自动：R1 扫描（**剥离注释后**只匹配真实代码）；核心层统一走 `globalThis` | 寇豆码 | 2026-10-30 |
| C-32 | **X-09 ①** | 核心层只依赖 `StorageAdapter` 接口 | 通过 | `packages/core/src/storage/adapter.ts`；实现位于 `apps/web/platform` 与 `packages/core/src/storage/memory-adapter.ts` | 寇豆码 | 2026-10-30 |
| C-33 | **X-09 ②** | Web 端提供基于 IndexedDB 的实现 | 通过 | `apps/web/src/platform/indexeddb-storage-adapter.ts`（Dexie） | 寇豆码 | 2026-10-30 |
| C-34 | **X-09 ③** | 接口覆盖：按实体 CRUD、按 `id` 查询、按 `localDate` 范围查询、按 `entityType` 批量读 | 通过 | `StorageAdapter` 的 11 个方法 + `StorageQueryLike`（`where` / `localDateFrom` / `localDateTo` / `orderBy` / `limit` / `offset`） | 寇豆码 | 2026-10-30 |
| C-35 | **X-09 ④** | 存储层对敏感字段统一走「加密后写入」，不存在绕过加密的写入口 | 通过 | `EncryptedStore` 是唯一业务写通道；`PlainStore` 只允许 `vaultParams` / `recoveryMeta` / `appSettings` 三类白名单 | 寇豆码 | 2026-10-30 |
| C-36 | **X-10 ①** | `VaultParams` 支持多版本共存（`keyVersion`） | 通过 | `VaultParams.keyVersion` / `currentDek` / `previousDek`；`WrappedDek.keyVersion` / `wrappedByKeyVersion` | 寇豆码 | 2026-10-30 |
| C-37 | **X-10 ②③** | 轮换为可中断可续跑的批任务；完成后旧密钥材料销毁 | **待办** | 本轮只落接口与数据结构（`KeyRotationService` / `KeyRotationPlan`）；完整实现在阶段 5（S5） | 主理人 | 2026-10-30 |
| C-38 | **X-10 ④** | 本轮仅要求接口与数据结构存在并被类型检查覆盖 | 通过 | `npm run typecheck` 通过；`rotateMasterKey()` 返回 `KeyRotationPlan` | 寇豆码 | 2026-10-30 |
| C-39 | **X-11 ①** | 所有可同步实体含 `version` / `updatedAt` / `deviceId` | 通过 | `BaseEntity` 定义；`Bill` / `Category` / `RuleTemplate` / `ImportBatch` 全部继承 | 寇豆码 | 2026-10-30 |
| C-40 | **X-11 ②** | 核心层提供 `mergeRecord(local, remote)` 纯函数，字段级合并不整体丢弃 | 通过 | `packages/core/src/services/sync/merge.ts` 的三方合并（`base` 为共同祖先） | 寇豆码 | 2026-10-30 |
| C-41 | **X-11 ③** | 单测：双端改不同字段 → 两字段均保留；改同一字段 → 取较新者且**结果确定（不依赖执行顺序）** | 通过 | `tests/unit/merge-record.test.ts`：不同字段保留、同一字段决胜、**顺序无关用例断言 `winnerDeviceId` 相等** | 寇豆码 | 2026-10-30 |
| C-42 | **X-12 ①** | 架构约定：AI 请求由**客户端**直连用户填写的 endpoint | 通过 | `docs/system_design.md` §8.8 R7 与 `docs/architecture.md` §2；核心层不提供任何「代发 AI 请求」的服务端接口 | 寇豆码 | 2026-10-30 |
| C-43 | **X-12 ②③④** | 核心层无代发接口；AI 配置项存本地并标为敏感；纳入代码评审检查项 | **不适用** | 本轮无 AI 功能（阶段 6 / S6 落地） | 主理人 | 2026-10-30 |
| C-44 | **X-15 ①** | 仓库内保留可勾选的合规自检清单，每项标注通过 / 不适用与依据 | 通过 | 本文档 | 寇豆码 | 2026-10-30 |
| C-45 | **X-15 ②** | 每次发布前由人工逐项确认 | 通过 | 见本文档 §6「发布前人工确认项」 | 主理人 | 2026-10-30 |

---

## 2. 架构红线检查（系统设计 §8.8 R1–R10）

| 编号 | 需求条目 | 检查项 | 结论 | 依据 | 确认人 | 日期 |
| --- | --- | --- | --- | --- | --- | --- |
| C-46 | **R1** | `packages/core` 零 DOM（无 `window` / `document` / `localStorage` / `indexedDB` / `navigator`） | 通过 | 自动：`npm run check:compliance`（剥离注释后匹配真实代码）+ `lib: ["ES2022"]` 类型级约束 | 寇豆码 | 2026-10-30 |
| C-47 | **R2** | `packages/core` 依赖不含 React / MUI / Dexie / 统计 SDK | 通过 | 自动：同上，R2 依赖白名单；`packages/core/package.json` 仅 2 个依赖（`@noble/ciphers`、`@noble/hashes`） | 寇豆码 | 2026-10-30 |
| C-48 | **R3** | 加密 / 密钥模块零网络出口 | 通过 | 自动：`npm run check:no-network` | 寇豆码 | 2026-10-30 |
| C-49 | **R4** | 存储层无明文业务写入口 | 通过 | `EncryptedStore` 唯一写通道 + `PlainStore` 白名单 + 代码评审 | 寇豆码 | 2026-10-30 |
| C-50 | **R5** | 同步载荷与备份只含密文 | 通过 | 自动：`npm run check:sync-payload`（静态 + 运行时） | 寇豆码 | 2026-10-30 |
| C-51 | **R6** | 无采集调用（定位 / 设备号 / 通讯录 / 电池） | 通过 | 自动：`npm run check:compliance` 的 R6 扫描 | 寇豆码 | 2026-10-30 |
| C-52 | **R7** | 无指向外部域名的请求（除用户自填 AI endpoint） | 通过 | ① `apps/web/index.html` 的 CSP：`connect-src 'self'`、`default-src 'self'`、`object-src 'none'`、`frame-ancestors 'none'`；② 自动：源码域名黑名单扫描；③ 核心层零网络出口 | 寇豆码 | 2026-10-30 |
| C-53 | **R8** | 无「找回密码 / 客服解封 / 后门恢复」入口 | 通过 | 自动：`npm run check:compliance` 的 R8 文案扫描（5 个短语） | 寇豆码 | 2026-10-30 |
| C-54 | **R9** | 金额、日期、时间格式与系统设计 §8.2 一致 | 通过 | `tests/unit/amount.test.ts`（14 例）、`tests/unit/datetime.test.ts`（19 例）、`tests/unit/models-validation.test.ts`（20 例） | 寇豆码 | 2026-10-30 |
| C-55 | **R10** | 每个导出函数有完整 JSDoc（首行说明 + `@param` + `@returns` + `@throws`） | 通过 | 代码评审抽查全部 124 个源码文件；注释规范见系统设计 §8.6 | 寇豆码 | 2026-10-30 |

---

## 3. PRD §6.2 技术栈决策与「写死的关键约束」

| 编号 | 需求条目 | 检查项 | 结论 | 依据 | 确认人 | 日期 |
| --- | --- | --- | --- | --- | --- | --- |
| C-56 | **§6.2 约束 ①** | 核心逻辑层必须放在独立 TS 包中，禁止引用 `window` / `document` / `localStorage` / 任何 React 概念 | 通过 | `packages/core` 独立包；R1 自动断言 | 寇豆码 | 2026-10-30 |
| C-57 | **§6.2 约束 ②** | 依赖注入 `CryptoProvider` 与 `StorageAdapter` 两个接口 | 通过 | 两个端口见 `packages/core/src/crypto/provider.ts` 与 `storage/adapter.ts` | 寇豆码 | 2026-10-30 |
| C-58 | **§6.2 约束 ③** | 目录结构为 `packages/core` + `apps/web` + 预留 `apps/app` | 通过（部分） | `packages/core` 与 `apps/web` 已交付；`apps/app`（Flutter 壳）阶段 3 落地，当前**待办** | 主理人 | 2026-10-30 |
| C-59 | **§6.2 约束 ④** | 未来 Flutter 三条移植路径（① 移植 Dart / ② `dart:ffi` / ③ JS 互操作）已评估 | 通过 | `docs/architecture.md` §5「Flutter 移植路径评估」（含三路径对比表、建议与三个坑） | 寇豆码 | 2026-10-30 |
| C-60 | **§6.2 约束 ⑤** | 加密核心的可移植边界：AES-GCM + scrypt 走平台原生实现，TS 仅作兜底 | 通过 | `WebCryptoProvider`（浏览器原生）/ `NodeCryptoProvider`（`node:crypto`）/ `NobleCryptoProvider`（兜底）三层实现 | 寇豆码 | 2026-10-30 |

---

## 4. PRD §6.3 核心假设的合规确认

| 编号 | 需求条目 | 检查项 | 结论 | 依据 | 确认人 | 日期 |
| --- | --- | --- | --- | --- | --- | --- |
| C-61 | **AS-1** | 数据来源仅为用户自行导出的 CSV / Excel / txt 文件 | 通过 | `ImportService` 只接受文件字节流；无任何网络抓取入口 | 寇豆码 | 2026-10-30 |
| C-62 | **AS-2** | 单用户单设备（1–3 设备），无多人协作与共享密钥 | 通过 | 无邀请 / 共享 / 权限模型；`deviceId` 仅为本地 UUID | 寇豆码 | 2026-10-30 |
| C-63 | **AS-3** | 数据量级：账单 ≤ 50 万行 / 习惯打卡 ≤ 20 年 | 通过（当前） | 列表页虚拟化（`BillVirtualList`）；导入分批 1000 条；解析单次流式 | 寇豆码 | 2026-10-30 |
| C-64 | **AS-4** | 用户接受「忘记密码 = 数据永久丢失」（恢复码兜底） | 通过 | 恢复码机制（X-03）；README §6.8 明示；无后门入口（R8） | 寇豆码 | 2026-10-30 |
| C-65 | **AS-5** | 个人主体下 AI 金融分析与公开 UGC 不上线 | 通过 | 本期无 AI / 无 UGC 模块；路由仅 6 条 | 寇豆码 | 2026-10-30 |
| C-66 | **AS-6** | 本期不需要汇率与多币种 | 通过 | `currency` 字段已预留；`CURRENCY_EXPONENT` 表支持多币种精度；仅 CNY 启用 | 寇豆码 | 2026-10-30 |
| C-67 | **AS-7** | 同步服务由用户自托管，运营方不承担可用性承诺 | 通过 | `apps/sync-server` 为自托管骨架；README 明确「不承诺长期可用性」 | 寇豆码 | 2026-10-30 |
| C-68 | **AS-8** | 用户设备时钟基本准确 | 通过 | 时间统一经 `Clock` 端口；解析优先显式格式；Excel 序列号等无时区格式按 UTC 解释并可由 `sourceTimeZone` 修正 | 寇豆码 | 2026-10-30 |

---

## 5. PRD §7 待确认问题的落地确认

| 编号 | 需求条目 | 检查项 | 结论 | 依据 | 确认人 | 日期 |
| --- | --- | --- | --- | --- | --- | --- |
| C-69 | **Q1** | 本轮用 Vite + React + TS 交付 Web 可跑 MVP，Flutter 壳推迟 | 通过 | `apps/web` 已交付；核心层零 DOM 可移植 | 主理人 | 2026-10-30 |
| C-70 | **Q2** | 按个人主体推进，金融 / AI / 公开 UGC 标记为企业主体限定 | 通过 | 本期无相关模块 | 主理人 | 2026-10-30 |
| C-71 | **Q3** | 金额分为单位整数 + `currency` 字段；v1 仅 CNY | 通过 | [ADR-001](adr/ADR-001-金额精度.md) | 寇豆码 | 2026-10-30 |
| C-72 | **Q4** | 口令派生用 scrypt | 通过 | `packages/core/src/crypto/kdf.ts`；`KDF_DEFAULT_PARAMS = { n: 32768, r: 8, p: 1 }` | 寇豆码 | 2026-10-30 |
| C-73 | **Q5** | 解锁耗时 P95 ≤ 1s（0.3–1.0s 区间） | 通过 | 集成测试中建库 / 解锁各约 0.6–0.9s（Node 环境）；浏览器实测见阶段 2 性能验收 | 寇豆码 | 2026-10-30 |
| C-74 | **Q6** | 恢复码形态：12 组 × 6 字符 Base32 + 独立盐值备份文件 | 通过 | `generateRecoveryCode()`；`SaltBackupPanel` | 寇豆码 | 2026-10-30 |
| C-75 | **Q7** | Web 端用 Dexie | 通过 | `apps/web/src/platform/indexeddb-storage-adapter.ts` | 寇豆码 | 2026-10-30 |
| C-76 | **Q8** | 退款用独立的 `direction: 'refund'`，金额为正 | 通过 | `packages/core/src/models/bill.ts` 的 `Direction` 类型 | 寇豆码 | 2026-10-30 |
| C-77 | **Q9** | 同步服务自托管（Docker Compose） | 通过 | `apps/sync-server/Dockerfile` + README 自托管说明 | 寇豆码 | 2026-10-30 |
| C-78 | **Q10** | 小程序轻量版最后做 | 通过（本期不做） | 本期无小程序代码 | 主理人 | 2026-10-30 |
| C-79 | **Q11** | 本期不做「多设备邀请 / 共享密钥」 | 通过 | 无相关实现；`deviceId` 与 `keyVersion` 已预留 | 寇豆码 | 2026-10-30 |
| C-80 | **Q12** | 日记本期仅文本 | 通过（本期无日记模块） | 模块 D 在阶段 6 | 主理人 | 2026-10-30 |

---

## 6. 发布前人工确认项（每次发布必做）

| 编号 | 确认项 | 操作 | 结论 | 确认人 | 日期 |
| --- | --- | --- | --- | --- | --- |
| C-81 | 四个红线脚本全绿 | `npm run check:compliance && npm run check:no-network && npm run check:sync-payload` | 通过 | 寇豆码 | 2026-10-30 |
| C-82 | 类型检查全绿 | `npm run typecheck`（core / web / sync-server） | 通过 | 寇豆码 | 2026-10-30 |
| C-83 | 全部测试全绿 | `npm run test`（core + web + **sync-server**） | 通过 | 全仓 `npm run test` 退出码 0；其中 **sync-server 83 例全绿**（4 个测试文件），core 445 例、web 196 例亦全绿 | 寇豆码 | 2026-10-30 |
| C-84 | 生产构建成功 | `npm run build` | 通过 | 寇豆码 | 2026-10-30 |
| C-85 | 依赖审计无高危漏洞 | `npm audit --omit=dev --audit-level=moderate` | 通过（生产依赖 0 漏洞） | 生产依赖审计结果 **found 0 vulnerabilities**。`npm audit`（含 dev）另报 4 条（2 moderate + 2 critical），**全部位于开发工具链**（`vitest` → `@vitest/mocker` / `tinypool` / `@vitest/coverage-v8`），不进入生产产物；修复需跨到 `vitest@5`（破坏性大版本），列为 T-05 待办 | 寇豆码 | 2026-10-30 |
| C-86 | 本清单逐条复核，「待办」项已写入发布说明 | 人工 | 通过 | 主理人 | 2026-10-30 |
| C-87 | README 隐私声明与实际行为一致 | 人工 | 通过 | 主理人 | 2026-10-30 |
| C-88 | 无新增 `TODO`（未关联负责人与需求编号） | `grep -rn "TODO" packages apps --include=*.ts --include=*.tsx` | 通过 | 寇豆码 | 2026-10-30 |

---

## 6.5 同步服务专项检查（服务端只见密文 / 设备授权 / 快照备份）

> 本节针对 `apps/sync-server` 单独列出可执行依据。
> 决策依据见 [`ADR-007`](adr/ADR-007-同步协议与密文blob格式.md)。

| 编号 | 需求条目 | 检查项 | 结论 | 依据 | 确认人 | 日期 |
| --- | --- | --- | --- | --- | --- | --- |
| C-89 | **X-01 ④ / R5** | 服务端**只接受** `EncryptedBlob` 的 10 个字段，出现白名单之外的字段一律 400 | 通过 | `apps/sync-server/src/validation.ts` 的 `ALLOWED_BLOB_FIELDS` 与 `validateBlobBody()`；断言 `apps/sync-server/tests/validation.test.ts`「白名单之外的字段被拒绝」 | 寇豆码 | 2026-10-30 |
| C-90 | **X-01 ④ / R5** | 明文字段名（金额 / 对方 / 备注 / 盐值 / DEK / 主密钥 / 恢复码 …）**递归**命中即 400，且**绝不落盘** | 通过 | `apps/sync-server/src/validation.ts` 的 `FORBIDDEN_FIELDS` + `assertNoForbiddenField()`（递归扫描）；断言 `tests/validation.test.ts`（10 个明文字段 + 嵌套 + 数组）与 `tests/server.test.ts`「明文字段被拒绝时绝不落盘」（断言库中行数为 0） | 寇豆码 | 2026-10-30 |
| C-91 | **X-01 ③ / NF-S-1** | 服务端数据库**只有** `encrypted_blob` 一张表，且**无任何业务明文列**、**无**本地 7 个索引明文列 | 通过 | `apps/sync-server/src/store.ts` 的 `SCHEMA_SQL`；断言 `tests/store.test.ts`「表结构红线」（表名唯一 + 10 列逐一比对 + 无明文列名）；运行时核对：`sqlite_master` 仅 `encrypted_blob` + 2 个索引 | 寇豆码 | 2026-10-30 |
| C-92 | **X-12 / X-13** | 设备级令牌鉴权：未授权 / 令牌错误一律 401；令牌**只**来自环境变量，**不硬编码、不入库、不落日志** | 通过 | `apps/sync-server/src/auth.ts`（进程内只留 SHA-256 摘要 + `timingSafeEqual`）；`apps/sync-server/src/config.ts`（`loadConfig()` 未配置令牌即抛错，**失败即关闭**）；断言 `tests/server.test.ts`「设备级授权」与 `tests/config.test.ts` | 寇豆码 | 2026-10-30 |
| C-93 | **X-12** | 幂等 upsert：同一 `id` 重复提交**不产生重复记录**；更旧的版本被忽略（防回滚） | 通过 | `apps/sync-server/src/store.ts` 的 `upsert()`（`id` 为主键 + 版本仲裁，返回 `created`/`updated`/`unchanged`/`stale`）；断言 `tests/store.test.ts`「幂等 upsert」与 `tests/server.test.ts`「同一 id 重复提交不产生重复记录」 | 寇豆码 | 2026-10-30 |
| C-94 | **X-12** | 增量拉取只返回 `updatedAt` 晚于 `since` 的 blob，且用 `(updated_at, id)` 复合游标避免同刻记录被漏拉 | 通过 | `apps/sync-server/src/store.ts` 的 `listSince()` 与 `idx_encrypted_blob_updated_at` 索引；断言 `tests/store.test.ts`「增量拉取」（含 `sinceId` 续拉用例）与 `tests/server.test.ts`「GET /v1/blobs 增量拉取」 | 寇豆码 | 2026-10-30 |
| C-95 | **X-12** | 同步服务**零 npm 运行时依赖**（只用 Node 内置模块） | 通过 | `apps/sync-server/package.json` 无 `dependencies` 字段；HTTP 用 `node:http`、存储用 `node:sqlite`、摘要用 `node:crypto`；Docker 运行阶段镜像亦不含任何第三方包；实测 `docker build` 成功并可运行 | 寇豆码 | 2026-10-30 |
| C-96 | **AS-7** | 同步服务由用户自托管，**运营方不承担可用性承诺**；已配置**夜间快照备份**并保留 N 份 | 通过 | `apps/sync-server/README.md` §2「不提供长期可用性承诺（AS-7）」；`scripts/snapshot.mjs`（`node:sqlite` 在线备份 API，服务运行中可安全备份）+ `scripts/snapshot.sh`（cron 包装）；`docker-compose.yml` 的 `lifehub-sync-snapshot` 服务每晚 03:17 执行 | 寇豆码 | 2026-10-30 |
| C-97 | **X-12** | 同步服务的 Docker 镜像可构建、可运行、非 root、健康检查通过 | 通过 | `apps/sync-server/Dockerfile`（多阶段 `node:22-alpine`）；实测 `docker build` 成功 → 容器启动 → `GET /health` 200 → `docker inspect` 健康状态为 `healthy`；明文字段请求 400、未授权 401 均在容器内复验通过 | 寇豆码 | 2026-10-30 |
| C-98 | **X-12** | 服务端「能看见什么」已**如实披露**，未夸大安全承诺 | 通过 | `apps/sync-server/README.md` §2「能力边界」表格同时列出「服务端有」与「服务端没有」两栏，并显式说明服务端可见记录条数、实体类型与实体 id；`docs/adr/ADR-007-同步协议与密文blob格式.md`「后果 → 负面 / 代价」同样列明 | 寇豆码 | 2026-10-30 |

---

## 7. 待办项汇总（发布说明必须列出）

| 编号 | 待办 | 计划阶段 | 说明 |
| --- | --- | --- | --- |
| C-37 | **X-10 ②③**：密钥轮换的完整实现（可中断续跑、旧密钥销毁） | S5（W9-10） | 本轮只落接口与数据结构 |
| C-58 | **`apps/app`（Flutter 壳）** | S3（W5-6） | 依赖 Flutter SDK 就位 |
| C-85 | **开发工具链依赖升级**：`vitest` → `vitest@5`（修 `@vitest/mocker` / `tinypool` 的 4 条审计告警） | S2（W3-4） | 仅影响 devDependencies，**不进入生产产物**；跨大版本需回归全部测试 |
| C-99 | **同步删除墓碑（tombstone）**：A 端删除后 B 端不感知 | S5（W9-10） | 当前 `DELETE /v1/blobs/:id` 是硬删除，不产生墓碑；需与同步协议一并设计（见 `docs/roadmap.md` §8.5 前置提醒第 1 条） |
| C-100 | **同步内容级合并的客户端闭环**：服务端无法解密，字段级冲突必须由客户端用 `merge.ts` 解决 | S5（W9-10） | 协议已就位（ADR-007），但客户端侧的「拉取 → 合并 → 回传」闭环尚未实现 |

> 原先列为「待办」的 **CSP `connect-src 'self'`** 已确认落地（`apps/web/index.html` 的 CSP meta），
> 于本轮闭环，改为「通过」（见 C-23 / C-52）。

---

## 8. 文档索引

| 文档 | 用途 |
| --- | --- |
| [`docs/PRD.md`](PRD.md) | 需求池与验收标准（本文档的对照基准） |
| [`docs/system_design.md`](system_design.md) | 架构红线 R1–R10 的定义（§8.8） |
| [`docs/architecture.md`](architecture.md) | 分层、加密边界、索引列取舍、**同步协议与密文 blob 格式**、移植路径 |
| [`docs/adr/`](adr/) | ADR-001 ~ ADR-007 |
| [`ADR-007-同步协议与密文blob格式.md`](adr/ADR-007-同步协议与密文blob格式.md) | 同步协议、密文 blob 格式、幂等 upsert 与版本仲裁的决策依据 |
| [`README.md`](../README.md) | §6 隐私与安全声明（对外披露口径） |
| [`apps/sync-server/README.md`](../apps/sync-server/README.md) | 同步服务「服务端只见密文」的对外说明与**能力边界**（§2） |
| [`scripts/snapshot.mjs`](../scripts/snapshot.mjs) | 同步服务 SQLite 在线快照与保留份数清理 |
