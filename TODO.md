# LifeHub 执行清单（TODO）

> **本文件是断点续做的唯一入口。** 会话中断后，先读本文件，就知道从哪继续。
> **维护人：产品经理（许清楚）**。工程师与 QA 完成后**报告给 PM**，由 PM 负责删除对应条目。
> **最后更新：2026-10-30 17:45**（轨道C QA 独立验证完成，PM 合并新发现并重排 Bug 编号）

---

## 维护规则（PM 必读）

| 情形 | 处理 |
| --- | --- |
| 任务**已完成且已测过**（工程师交付 + QA 验证通过） | **删除该条目** |
| 过程中**发现源码 Bug** | **插入一条新的 Bug 条目**（标注发现人、轨道、文件行号），指派给工程师修复 |
| 产生**新的待办**（技术债、文档缺口、上线风险） | **插入一条新的待办条目** |
| 任务**部分完成** | **保留条目**，在「进展」列写清楚已完成到哪一步、下一步是什么 |
| 条目被阻塞 | 保留条目，在「进展」列写明**阻塞原因与解除条件** |

**条目 ID 规则**：`T-<轨道>-<序号>`（任务）、`B-<序号>`（Bug）、`N-<序号>`（待办）。Bug 与待办**统一编号**，便于追溯。

**「进展」列的写法**：每条都要写**具体事实**（文件路径、用例数、报错原文），不要写"进行中"这种空话。这是断点续做的依据。

**删除条目的前置条件**：必须同时满足 ① 工程师明确报告交付完成 ② QA 给出独立验证通过结论。**工程师单方面说"做完了"不构成删除依据。**

### 编号变更记录（2026-10-30 17:45）

轨道C QA 独立验证后新增 4 条 Bug，需占用 B-4 ~ B-7。PM 原先在 17:10 写入的 3 条 Bug 与之冲突，**已重排**：

| 现编号 | 原编号 | 内容 | 状态 |
| --- | --- | --- | --- |
| B-8 | B-4 | lint 4 errors 残留 | **已由工程师修完，PM 17:45 复测 `npm run lint` → 0 errors ✅**，待 QA 复验后删除 |
| B-9 | B-5 | `bills-filter.test.tsx` flaky | 轨道B 处理中 |
| B-10 | B-6 | `qa-sync-server.test.ts` R5 注释语义倒挂 | 轨道C 处理中 |

### 条目速查索引（按 ID 查；正文按优先级排列，阻断项在前）

| ID | 一句话 | 级别 | 指派 / 状态 |
| --- | --- | --- | --- |
| B-4 | 锁定态解锁失败审计被静默丢弃 + 冷却可刷新绕过 | **高·安全** | `software-engineer-2` 开发中 |
| B-3 | typecheck 失败：core 连带编译 sync-server 源码 → TS5097 | **阻断** | 轨道D 处理中 |
| B-8 | lint 4 errors 残留 | **阻断** | **已修完，待 QA 复验** |
| N-6 | `coverage-gate.test.ts` 导入路径写错 → 35 条类型错误 | 待办 | 轨道A |
| B-5 | R3 脚本漏报 `globalThis.fetch` / `window.fetch` | 中·门禁 | `qa-track-a-engineer` 开发中 |
| B-9 | `bills-filter.test.tsx` 偶发失败（flaky） | 中 | 轨道B 处理中 |
| B-1 | `vitest.workspace.ts` 在 vitest 5 已失效 | 中 | 轨道D 处理中 |
| B-2 | C-77 依据与实际交付物不一致 | 中 | 轨道D 处理中 |
| B-6 | 性能基准在 Windows 上时红时绿 | 低·稳定性 | `qa-track-a-engineer` 开发中 |
| B-7 | `security-verification.md` 编号与引用错误 | 低·文档 | `qa-track-c-engineer` 开发中（①② 已消失，③ 与事实不符）|
| B-10 | `qa-sync-server.test.ts` 第 5 行 R5 语义倒挂 | 低·文档 | 轨道C 处理中 |
| N-1 | 生产依赖需定期复查 | 待办 | 周期性动作 |
| N-2 | SQLite 快照恢复策略未定 | 待办 | 轨道D |
| N-3 | Flutter 壳与主体类型未定 | 待办 | 阶段 3 / 主理人 |
| N-4 | `.gitignore` 未忽略覆盖率生成物 | 待办 | 下一轮提交前 |
| N-5 | `ci.yml` 注释与实际编排口径不一致 | 待办 | 轨道A |

---

## 当前状态速览

| 轨道 | 主题 | 工程师 | QA | 状态 |
| --- | --- | --- | --- | --- |
| A | CI 流水线与质量门禁 | `qa-track-a-engineer` | `qa-track-a-tester` | 开发中收尾（`ci.yml` / `compliance.yml` / `docs/ci.md` 已落盘；**B-5 / B-6 开发中**） |
| B | Web 端测试与交互补强 | `qa-track-b-engineer` | `qa-track-b-tester` | 开发中（测试文件 19 → **26**；**B-9 flaky 处理中**） |
| C | 安全红线与合规深度验证 | `qa-track-c-engineer` | `qa-track-c-tester` | **QA 独立验证已完成**；工程师处理 5 处 JSDoc + 删旧测试文件 + **B-10 / B-7** |
| D | 同步服务可运行化与文档收口 | `qa-track-d-engineer` | `qa-track-d-tester` | 开发中（**正在用新 API 重写 `apps/sync-server/tests/` 9 条用例**；**B-1 / B-2 / B-3 轨道D 处理中**） |

**基线**：git commit `5b03ac9` —— 336 用例全绿（core 317 / web 19）、typecheck 0 错误、vitest 5.0.5、依赖漏洞 0。

**PM 核对时实测（2026-10-30 17:45 复测）**：
- core **445 用例 / 33 文件全绿**（39s）｜ web **131 通过 + 2 跳过 / 15 文件**（101s）｜ sync-server **83 用例 / 4 文件全绿**（2s）
- `npm run lint` → **0 errors / 14 warnings ✅**（B-8 已由工程师修完，待 QA 复验）
- `npm run typecheck` → ❌ **39 errors**（B-3 的 4 条 TS5097 + 新增 `packages/core/tests/unit/coverage-gate.test.ts` 的 35 条导入错误）
- `npm audit --omit=dev` → ✅ 0 漏洞 ｜ 三个合规脚本 → ✅ 全通过
- CI 覆盖率自检命令退出码 = **1**（阈值抬 100% 正确拦截，门禁生效 ✅）

> ⚠️ **仓库处于多轨道并行写入状态**，文件持续变动，PM 核对期间 `docs/ci.md`、`docs/security-verification.md`、`ADR-007`、`docker-compose.yml`、`scripts/snapshot.*` 均已落盘，且 `docs/security-verification.md` 被重写过一次（§3.2/§4.1 小节已不存在，改为 §0~§6 结构）。**任何条目的行号与小节号都可能随改动漂移 —— 修复前请先重跑对应命令取当前实际位置。**

---

## 进行中的任务

### T-A-1 CI 流水线与质量门禁
- **交付物**：`.github/workflows/ci.yml`（lint/typecheck/test/coverage/compliance/bench/audit 共 7 个 job）、`.github/workflows/compliance.yml`、`docs/ci.md`（22.6KB）
- **验收**：YAML 无语法错误；覆盖率阈值不达标时 `vitest run --coverage` **失败退出**；CI 里不得出现 `--no-coverage` / `continue-on-error: true` 覆盖测试 job / 阈值被调低
- **进展**：`ci.yml` / `compliance.yml` / `docs/ci.md` **已落盘**；CI 覆盖率自检命令实测退出码 = **1**（门禁生效 ✅）。`npm run lint` 已恢复 **0 errors**（B-8 待 QA 复验）。**新增开发中：轨道A 正在修 B-5（R3 脚本漏报）与 B-6（性能基准抖动）**。`npm run typecheck` 仍红（B-3）
- **下一步**：B-5 / B-6 / B-3 修完后 QA 复验三个 job 全绿

### T-B-1 Web 端测试补齐（目标 60+ 用例 / 覆盖率 ≥70%）
- **交付物**：`apps/web/src/__tests__/` 下测试文件、`apps/web/src/test-utils/`
- **覆盖**：PRD A-08 / A-09 / A-10 / A-11 / A-12 + UI-01~UI-04
- **进展**：测试文件由基线 **4 个增至 26 个**；PM 实测 **15 个文件 131 通过 + 2 跳过**。⚠️ **存在偶发失败（B-9），QA 结论尚未到达，按规则本条暂不删除**
- **下一步**：B-9 修完并**连跑 3 次全量全绿**后 QA 出结论

### T-B-2 轨道B 源码 Bug 修复（来源文件列）
- **发现人**：轨道B 工程师｜**文件**：`apps/web/src/pages/BillsPage.tsx:42-46`
- **现象**：`sourceFileNames` 是永远返回空对象的桩（含 `void runtime;` 压制告警），账单列表「来源文件」列永远为空，违反 PRD A-08 / A-11 ③
- **修法**：用 core 已有的 `ImportBatchRepository` 取 `ImportBatch.fileName` 建 `id → fileName` 映射；查不到批次时优雅降级为「—」，不得整页白屏
- **进展**：**未修复** —— PM 于 17:00 / 17:20 两次复核，`BillsPage.tsx:42` 仍是 `const sourceFileNames = useMemo(() => { const map = {}; void runtime; return map; }, [runtime]);` 桩代码原样存在
- **下一步**：工程师完成修复 → QA 独立验证「来源文件」列有值 + 查不到批次时降级为「—」

### T-C-1 安全红线深度验证
- **交付物**：`packages/core/tests/security/`（crypto / sync-payload / recovery-code / audit-log / key-rotation 共 5 个文件）、`packages/core/tests/compliance/redlines.test.ts`、`docs/security-verification.md`
- **关键点**：A-07 篡改必失败、AAD 绑定、**Web/Node Provider 交叉一致**、同步载荷零明文、恢复码明文不落库、R1–R10 逐条可执行断言
- **进展**：**QA 独立验证已完成**（轨道C QA 严过关），并据此报出 B-4（高危安全）/ B-5 / B-6 / B-7 四条新条目。PM 复核确认交付物齐备：core **445 用例全绿**，`redlines.test.ts` 32 例覆盖 R1–R10，`docs/security-verification.md` 已重写为 §0~§6 结构（§3.2/§4.1 已不存在）
- **下一步**：轨道C 工程师处理 **5 处 JSDoc 缺口**（见 B-7 引用：`web-crypto-provider.ts:82`、`node-crypto-provider.ts:46`、`noble-fallback-provider.ts:35` 缺 `@returns`；`amount.ts:86` 缺 `@throws`；`vault-repository.ts:97` 的 `markRecoveryExported()` JSDoc 错写「`@returns 无异常`」但实际会抛 `LIFEHUB_E_ENTITY_NOT_FOUND`，**属误导性注释，优先级最高**）+ 删旧测试文件 + 修 B-7 / B-10

### T-D-1 同步服务可运行化
- **交付物**：`apps/sync-server/src/{server,store,auth,config,validation}.ts`、SQLite（Node 22 内置 `node:sqlite`）、`apps/sync-server/tests/`、`Dockerfile`、根 `docker-compose.yml`、`scripts/snapshot.{sh,mjs}`
- **硬红线**：服务端只存密文；明文字段黑名单命中直接 400 且不落盘；`dependencies` 保持为空
- **进展**：src 5 模块 + `vitest.config.ts` + `.env.example` + 5 个测试文件 + Dockerfile + 根 `docker-compose.yml` + `scripts/snapshot.{sh,mjs}` **全部已落盘**。PM 实测 **83 用例全绿**。**轨道D 正在用新 API 重写 `apps/sync-server/tests/` 的 9 条用例**（`server.test.ts` / `store.test.ts` / `validation.test.ts` 三个文件 17:17 已被改写），并修 **B-1**（`vitest.workspace.ts` 未收录 sync-server）
- **下一步**：B-1 / B-2 / B-3 修完 → QA 复验

### T-D-2 文档收口
- **交付物**：根 `README.md`（7 章节 + npm scripts）、`docs/architecture.md`、`docs/compliance-checklist.md`、`docs/adr/ADR-007-*.md`、`docs/roadmap.md` 末尾回填
- **进展**：README（7 章节 ✅）、`architecture.md`、`compliance-checklist.md`、`ADR-007-同步协议与密文blob格式.md`、`docs/ci.md`、`docs/security-verification.md` **均已落盘**；`docs/roadmap.md:432` 已有「8. 实际实现状态回填」小节
- **未完成部分**：见 **B-2**（C-77 依据）与 **B-3**（回填小节未写明 M5 的 Fastify→node:sqlite 偏离，`roadmap.md:306` 与 `system_design.md:209` 仍写 Fastify + Postgres）

---

## Bug 条目（新增往这里插）

### B-4【高危·安全】锁定态下的解锁失败审计被静默丢弃 + 暴力破解冷却可被刷新绕过
- **发现人**：轨道C QA（严过关）｜**级别**：**高（安全）**｜**指派**：`software-engineer-2`
- **文件与行号**：
  - `packages/core/src/services/audit-logger.ts:59-63` —— 审计写入失败时 `catch {}` **静默吞掉**（PM 已复核：`try { await this.repository.save(entry); } catch { /* 审计写入失败不抛出 */ }`）
  - `packages/core/src/storage/encrypted-store.ts:289-293` —— `assertUnlocked()` 在未解锁时抛 `LIFEHUB_E_VAULT_NOT_FOUND`（PM 已复核）
  - `packages/core/src/services/vault-service.ts:101`（`private failedAttempts = 0;`）与 `:103`（`private cooldownUntil = 0;`）—— **实例字段（内存态）**
- **现象**：解锁失败时保险库仍锁定、DEK 未安装 → 加密审计写不进去 → 异常被吞 → **失败尝试零记录**；且失败计数在**刷新页面后归零** → 攻击者可无限次爆破主密码/恢复码，30 秒冷却形同虚设
- **违反**：PRD **X-07**（审计谁在何时解密过，含解锁失败）；PRD **NF-S-8**（恢复流程速率限制，防本地暴力枚举）+ 系统设计 §8.3 第 6 条（`system_design.md:2649`：「连续 5 次口令错误后强制冷却 30 秒」）。**PM 订正**：主理人原报「违反 PRD X-02（5 次失败冷却 30 秒）」——PRD `X-02` 实为「忘记密码即数据永久丢失必须显式告知」（`docs/PRD.md:158`），**与冷却无关**；冷却条款的真实出处是 PRD **NF-S-8**（`docs/PRD.md:565`）与系统设计 §8.3-6（`docs/system_design.md:2649`）。代码侧常量已就位：`packages/core/src/constants.ts:152` `UNLOCK_COOLDOWN_THRESHOLD = 5`、`:155` `UNLOCK_COOLDOWN_MS = 30_000`
- **根因**：审计存储加密依赖 DEK，但失败审计恰恰发生在「没有 DEK」的时刻 —— 这是加密审计与失败审计之间的**结构性冲突**
- **修法**：① 冷却状态持久化到 `vaultParams`（明文白名单内，不新增明文实体类型）；② `AuditLogger` 写失败时交给 `onWriteFailure` 回调，`VaultService` 把条目暂存到 `vaultParams.pendingAuditEntries`（**只含 at/action/target/deviceLabel/success，严禁任何业务数据**），成功解锁后刷入加密审计并清空；③ `TestDekProvider.isUnlocked()` 改为可切换锁定态 —— PM 已复核 `packages/core/tests/helpers/runtime.ts:95-97` 的 `isUnlocked(): boolean { return true; }` **恒为 true**，这正是该缺陷长期未被发现的原因
- **进展**：已派单，开发中。PM 17:45 复核：`audit-logger.ts:59-63` / `encrypted-store.ts:289-293` / `vault-service.ts:101,103` **均未改动**（`git status` 无这三个文件的修改记录）

### B-5【中·门禁】R3 零网络出口脚本漏报 `globalThis.fetch` / `window.fetch`
- **发现人**：轨道C QA｜**级别**：中（门禁）｜**指派**：`qa-track-a-engineer`
- **文件**：`scripts/check-no-network-in-crypto.mjs:21` —— `{ name: 'fetch', regex: /(?<![.\w])fetch\s*\(/g }`
- **事实**：正则的负向前瞻 `(?<![.\w])` 把 `.` **排除在外** → PM 已实测复现：`globalThis.fetch(` / `window.fetch(` / `self.fetch(` **三项全部查不出来**（命中 = false），只有裸 `fetch(` 能命中（命中 = true）。而这正是 X-01① 要防的绕过方式
- **附带问题**：该脚本**不剥离注释** → 中文 JSDoc 里出现的 "fetch" 会假阳性。PM 已复核 `scripts/check-compliance.mjs:211` 已有 `export function stripComments(source)`（逐字符状态机，能正确跳过字符串与模板字符串），`check-compliance.mjs:362` 已在用；而 `check-no-network-in-crypto.mjs` 中 `stripComments` **0 命中**
- **修法**：改为覆盖所有调用形态（裸 `fetch` / `globalThis.fetch` / `window.fetch` / `self.fetch`）→ 复用 `check-compliance.mjs` 里已有的 `stripComments()` → 加与真实正则咬合的自检（用 `globalThis.fetch(` 这类样本做阳性用例，确保脚本能真正拦住）
- **进展**：已派单，开发中。PM 17:45 复核：`scripts/check-no-network-in-crypto.mjs` **未改动**（`git status` 无修改记录）

### B-6【低·稳定性】性能基准在 Windows 上时红时绿
- **发现人**：轨道C QA｜**级别**：低（稳定性）｜**指派**：`qa-track-a-engineer`
- **文件**：`packages/core/tests/performance/csv-benchmark.test.ts:34`（`expect(elapsed).toBeLessThan(1000)`，1 万行）与 `:45`（`expect(elapsed).toBeLessThan(3000)`，10 万行）—— PM 已复核两处阈值原文
- **事实**：阈值贴边，Windows 负载波动即判红。CI 的 `bench` job 依赖该测试
- **修法**：改为抗抖动形式（PRD 线的 1.5 倍 + 一个绝对上限），**不得把 3000 直接改成 30000**（那是放开门禁而非抗抖动）
- **进展**：已派单，开发中。PM 17:45 复核：`csv-benchmark.test.ts` **未改动**

### B-7【低·文档】`docs/security-verification.md` 编号与引用错误
- **发现人**：轨道C QA｜**级别**：低（文档一致性）｜**指派**：`qa-track-c-engineer`
- **文件**：`docs/security-verification.md`
- **PM 17:45 逐条复核结论（注意：文件已被重写，原 §3.2 / §4.1 小节已不存在，现为 §0~§6 结构）**：
  - ①「§3.2 把 X-05/X-06 编号写反且重复」→ **已随文件重写消失**：当前版本 `X-05` / `X-06` 在全文 **0 命中**，§2 改为按 R1–R10 逐条展开
  - ②「§4.1 写「R1 ~ R9、R10」漏了 R10」→ **已随文件重写消失**：当前版本第 4 行写「系统设计 §8.8 的 **R1–R10**」，第 91 行小节标题为「R1–R10 逐条结论」，R10 在第 180 行有独立小节
  - ③「§4.1 称「对应 §8.8 R1–R10」，但系统设计 §8.8 实际只有 R1–R9，R10 出自 §8.6 第 10 条」→ **PM 复核不成立**：`docs/system_design.md:2770-2783` 的 §8.8 表格**确实包含 R1–R10 共 10 行**，R10 行原文为「`| R10 | 每个导出函数有完整 JSDoc | 代码评审 + ESLint 补充规则抽查 |`」；基线 commit `5b03ac9` 的 §8.8 亦含 R1–R10。且 §8.6「注释规范」只有 **1)~7)** 七条编号（第 10 条不存在），其第 1 条与第 5 条正是 R10 所要求的 JSDoc 规范来源 —— 即 **R10 恰恰出自 §8.8 表本身**，与 §8.6 是「红线条目 ↔ 规范细则」的引用关系，不是「§8.6 的第 10 条」
- **修法**：① ①② 已由重写自然解决，PM 复核确认无需再改；② ③ 请**不要**按原描述去改文档 —— 若确要修改 §4.1 对应段落，只能改「§8.6」这类**小节号引用**，不能声称 §8.8 缺 R10。**若 QA 坚持要改，请先出示 `docs/system_design.md:2770-2783` 之外的证据**
- **进展**：已派单，开发中。PM 17:45 复核：`docs/security-verification.md` 当前版本（25KB，mtime 17:20）**①② 已无对应问题，③ 与文档事实不符**，请指派方按上面「修法」一节执行

### B-8【阻断·门禁】lint 4 errors 残留 —— **工程师已修完，待 QA 复验**
- **发现人**：PM｜**级别**：阻断（CI `lint` job）｜**原编号 B-4，已重排为 B-8**
- **原剩余清单**：`apps/web/src/router.tsx:25:10` 与 `apps/web/src/test-utils/render.tsx:53:17`（react-refresh/only-export-components）、`packages/core/src/time/datetime.ts:206:36`（no-irregular-whitespace）、`packages/core/src/utils/bytes.ts:73:9`（prefer-const）。另有 `packages/core/tests/compliance/redlines.test.ts:205/206/210`（no-useless-escape）与 `:868`（no-regex-spaces）已由工程师按 `[.([]` 口径对齐 `qa-compliance.test.ts:108-118`
- **PM 17:45 复测**：`npm run lint` → **`✖ 14 problems (0 errors, 14 warnings)`，退出码 0** —— **全部 error 已清零 ✅**（只剩 14 条 warning，较 17:40 的 15 条又少 1 条）
- **进展**：工程师修复完成，PM 已复测通过。**待 QA 独立复验后删除本条**
- **附注（留档，供后续同类修改参考）**：`qa-compliance.test.ts` 原改动注释称「`[` 必须写成 `\[`，否则会被解析成正则的字符类起始符」—— PM 实测 7 个样本逐一比对，`[.(\[]` 与 `[.([]` **行为完全等价**，`gv` flag 下两者同样抛错，`gu` flag 下 `[.([]` 可正常构造。真正原因是 ESLint 的 `no-useless-escape` 认为字符类里的 `\[` 是多余转义（Annex B 下 `[` 无需转义），与「语义改变」无关

### B-9【中·稳定性】web 端 `bills-filter.test.tsx` 偶发失败（疑似用例间状态污染）
- **发现人**：PM｜**级别**：中（flaky，会导致 CI 随机红）｜**原编号 B-5，已重排为 B-9**
- **文件**：`apps/web/src/__tests__/bills-filter.test.tsx:334`（`await waitFor(() => expect(screen.getByText('没有符合筛选条件的账单')).toBeInTheDocument())`）
- **事实**：PM 第一次跑 `apps/web` 全量（15 文件）时该文件 **2 例失败**，报错为 `waitFor` 超时后渲染出空状态文案；**单独跑该文件 → 9 例全绿（2 跳过）**；**紧接着再跑全量 → 15 文件 131 例全绿**。即失败与否取决于同批次其他文件是否先跑，属典型的**用例间共享状态 / 定时器 / store 未重置**问题，而非断言本身错误
- **修法**：检查该文件与其他 web 测试是否共享 Dexie 内存库、Zustand store、`vi.useFakeTimers` 或未清理的 `setTimeout`；确保 `beforeEach` 重置 store、`afterEach` 调 `vi.useRealTimers()` 并清空 IndexedDB
- **进展**：待工程师定位并修复 → QA **连跑 3 次全量**确认稳定全绿（单次全绿不足以判定修复完成）

### B-10【低·文档】`qa-sync-server.test.ts` 文件头注释把 R5 红线语义写反了
- **发现人**：PM（比对基线 commit 与工作区 diff 时发现）｜**级别**：低（注释错误，但红线文件里的语义倒挂有误导风险）｜**原编号 B-6，已重排为 B-10**
- **文件**：`packages/core/tests/qa/qa-sync-server.test.ts:5`
- **事实**：基线 `5b03ac9` 第 5 行为 `§8.8 R5「同步载荷与备份只含密文」。`，工作区被改为 `§8.8 R5「同步载荷与备份只含明文」。` —— **语义完全相反**。R5 的权威定义在 `docs/system_design.md:2778`：`| R5 | 同步载荷与备份只含密文 | scripts/check-sync-payload.mjs + 快照测试 |`，与 `docs/roadmap.md` 一致。当前写法会把红线读成「只含明文」，**与本文件自身要验证的行为（明文必须被拒）正好相反**
- **修法**：改回「只含密文」
- **进展**：PM 17:45 复核第 5 行**仍为「只含明文」**，未修复。轨道C 处理中

### B-1 `vitest.workspace.ts` 在 vitest 5 已失效，sync-server 仍不在根级测试编排内
- **发现人**：PM（核对 TODO 与仓库现状时）｜**级别**：中（配置失效，非功能缺陷）｜**轨道D 处理中**
- **文件**：`vitest.workspace.ts:8`（`export default defineWorkspace(['packages/core', 'apps/web'])`）
- **事实**：升级到 **vitest 5.0.5 后，`vitest.workspace.ts` 已不再被读取** —— 全量 `node_modules` 搜索 `vitest.workspace` 字面量为 0 命中；vitest 5 改用根配置里的 `projects` 数组 + glob 自动发现（见 `node_modules/vitest/dist/chunks/index.1TqnEahn.js:7621`）。PM 实测根级 `npx vitest list` 能列出 `apps/sync-server/tests` 的 74 条用例（说明根级 glob 恰好兜住了），但**根级 `npx vitest run apps/web/src/__tests__/format-utils.test.ts` 失败** —— 子包 `vitest.config.ts` 的 `@` alias 与 jsdom 环境未被应用（报 `Cannot find module '@/utils/download'`）
- **影响**：① `vitest.workspace.ts` 是**死文件**，改它不会生效，原「修法」无效；② 根级单文件 vitest 调用**不能**替代子包内调用（别名/环境丢失）；③ `apps/sync-server/package.json` 已补 `test` / `coverage` script，故 `npm run test`（根，走 `--workspaces --if-present`）**能**跑到 sync-server 83 例 —— 这是当前唯一可靠的编排路径
- **修法**：**删除失效的 `vitest.workspace.ts`**，改为在根新建 `vitest.config.ts` 并用 `projects: ['packages/*', 'apps/*']` 声明各子包项目；若不想引入根配置，则明确以「各包内 `npm run test --workspace <pkg>`」为唯一测试入口并在 `docs/ci.md` 写清
- **进展**：轨道D 处理中（PM 已于 17:30 单独发消息给 `qa-track-d-engineer`，含 vitest 5 源码级证据）

### B-2 合规清单 C-77 的依据仍指向不存在或不完整的证据
- **发现人**：轨道D QA 首次报出，PM 复核**确认仍未闭环**｜**级别**：中｜**轨道D 处理中**
- **文件**：`docs/compliance-checklist.md:132`（C-77 行）、`apps/sync-server/README.md`
- **事实**：C-77「同步服务自托管（Docker Compose）」的依据列写「`apps/sync-server/Dockerfile` + README 自托管说明」。PM 复核：`apps/sync-server/README.md` **确有**「3. 自托管方式」章节（3.1 本地直接运行 / 3.2 Docker / 3.3 接入客户端），但**该章节不含 NAS/VPS/内网部署指引、环境变量表、数据卷与快照挂载说明**；且 `docker-compose.yml` 实际落在**仓库根**而非 `apps/sync-server/` 下，依据文字与实际交付物位置不一致
- **修法**：二选一 —— ① 补全 `apps/sync-server/README.md` 自托管章节（NAS/VPS/内网 + 环境变量表 + 数据卷 + 快照挂载），并把 C-77 依据改为「`apps/sync-server/README.md` §3 + 根 `docker-compose.yml`」；② 或把依据改指向实际交付物。二者必须一致，且依据文字要写实际路径
- **进展**：轨道D 处理中

### B-3 `npm run typecheck` 失败：core 的 tsconfig 连带编译 sync-server 源码，报 TS5097
- **发现人**：PM（核对 TODO 与仓库现状时）｜**级别**：**阻断**（CI `typecheck` job 必然红）｜**轨道D 处理中**
- **文件**：`packages/core/tests/qa/qa-sync-server.test.ts:23-26`（import 越界）+ `packages/core/tsconfig.json`（`include` 含 `tests/**/*.ts`）+ `apps/sync-server/src/server.ts:24-27`
- **事实**：PM 实测 `npm run typecheck` **退出非 0**，报错原文：
  ```
  apps/sync-server/src/server.ts(24,34): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
  apps/sync-server/src/server.ts(25,51): error TS5097: ...
  apps/sync-server/src/server.ts(26,50): error TS5097: ...
  apps/sync-server/src/server.ts(27,71): error TS5097: ...
  ```
  根因链：`packages/core/tests/qa/qa-sync-server.test.ts` 用 `../../../../apps/sync-server/src/xxx` **跨包 import** sync-server 源码 → core 的 tsc 把 `apps/sync-server/src/**` 一并纳入类型检查 → 但 core 的 `tsconfig.json` 未开 `allowImportingTsExtensions`，而 sync-server 源码用的是 Node 22 `--experimental-strip-types` 要求的 `./auth.ts` 显式扩展名写法 → TS5097。sync-server 自己的 `tsconfig.json` **是**开了该选项的，所以单独 `npx tsc --noEmit -p apps/sync-server/tsconfig.json` 不报错，只有走 core 的 tsconfig 才炸
- **附加现状（17:45 复测）**：typecheck 错误数已由 4 条增至 **39 条** —— 除上述 4 条 TS5097 外，新增 **35 条来自 `packages/core/tests/unit/coverage-gate.test.ts`**（新增未跟踪文件），报 `error TS2305: Module '"../../src/money/amount-sign"' has no exported member 'parseAmountToMinor'` / `'formatMinor'` / `'sumMinor'`、`Module '"../../src/time/datetime"' has no exported member 'parseIsoUtc'` / `'toUtcIso'` 等 —— **从错误的模块路径导入已存在的导出**，属该新测试文件自身写错
- **修法**（择一，推荐第 1 条）：① 把 sync-server 的测试从 core 移出去 —— 在 `apps/sync-server/tests/` 下自建 QA 用例，core 只保留静态扫描类断言（`qa-compliance.test.ts` 用 `readFileSync` 读源码的方式是正确范式，无需跨包 import）；② 或在 `packages/core/tsconfig.json` 补 `"allowImportingTsExtensions": true`（治标，且削弱 core 的类型纪律）；③ `coverage-gate.test.ts` 的导入路径须改为实际导出所在模块
- **进展**：轨道D 处理中。PM 17:45 复核：4 条 TS5097 **仍在**；`coverage-gate.test.ts` 为新增未跟踪文件（`??`），属开发中产物

---

## 待办条目（新增往这里插）

### N-1 生产依赖需定期复查
- **来源**：主理人（`npm audit` 已清零，但这是时点结论）
- **内容**：每次发布前重跑 `npm audit --omit=dev --audit-level=moderate`，确认仍为 0 漏洞
- **进展**：待办。PM 17:45 实测 → `found 0 vulnerabilities` ✅（当前时点通过，仍需保留为周期性动作）

### N-2 `apps/sync-server` 存储为 SQLite，进程重启需靠快照脚本恢复
- **来源**：轨道D 工程师报告
- **内容**：确认 `scripts/snapshot.sh` / `snapshot.mjs` 的调度方式与保留份数策略，写入部署文档
- **进展**：**待办**。PM 复核：两个脚本已落盘，但调度方式与保留份数策略**尚未见诸文档** —— `apps/sync-server/README.md` §3 自托管章节未含快照挂载说明（与 B-2 同源）

### N-3 Flutter 壳（阶段 3）与主体类型未定
- **来源**：主理人
- **内容**：`apps/app` 需在阶段 3 落地；主体类型（个人/个体户/企业）未定，阻塞阶段 6 的 AI 能力与小程序备案
- **进展**：待办（不在 Sprint 0 范围）。关联 PRD §7 的 Q1（技术栈决策已定：Web 先行）与 Q2（主体类型未定）

### N-4 未被 `.gitignore` 忽略的覆盖率生成物会污染工作区
- **来源**：PM（核对 `git status` 时发现）
- **事实**：`.gitignore` 只写了 `coverage/`，因此 `packages/core/coverage-ci/`、`packages/core/coverage-probe/`、`apps/web/coverage-trackb/`、根 `coverage-selftest/` **均未被忽略**，`git status` 中显示为 `??` 未跟踪目录；`git check-ignore` 对这四个路径**无匹配**。其中 `coverage-selftest/` 是 CI 覆盖率自检步骤（`ci.yml` 第 202 行 `--coverage.reportsDirectory=coverage-selftest`）在本地复现时产生的
- **内容**：`.gitignore` 补 `coverage-*/` 与 `coverage-selftest/`（或统一 `**/coverage*/`），避免误提交数百个生成文件
- **进展**：待办（不阻断功能，但应在下一轮提交前处理）

### N-5 CI 的 `test` job 注释与实际编排口径不一致
- **来源**：PM（核对 B-1 时连带发现）
- **事实**：`ci.yml` 的 `test` job 执行 `npm run test`，而根 `package.json` 的 `test` 脚本是 `npm run test --workspaces --if-present` —— **`apps/sync-server/package.json` 已补 `test` script，故该 job 实际会跑到 sync-server 83 例**；但 `ci.yml` 第 107 行的注释仍写「运行测试（core + web）」，**注释与实际行为不一致**。同时 `coverage` job 的上传产物路径只列了 `packages/core/coverage` 与 `apps/web/coverage`（`ci.yml:225-226`），**未含 sync-server 覆盖率**
- **内容**：修正 `ci.yml` 注释为「core + web + sync-server」；确认 sync-server 覆盖率是否需要纳入门禁或至少纳入产物上传
- **进展**：待办（与 B-1 一并处理更经济）

### N-6 `packages/core/tests/unit/coverage-gate.test.ts` 的导入路径写错，导致 typecheck 失败
- **来源**：PM（17:45 复测 typecheck 时发现）
- **事实**：该新增未跟踪文件从 `../../src/money/amount-sign` 导入 `parseAmountToMinor` / `formatMinor` / `sumMinor`，从 `../../src/time/datetime` 导入 `parseIsoUtc` / `toUtcIso` —— **这 5 个符号并不在所导入的模块中**，tsc 报 `TS2305: Module has no exported member`（PM 实测 35 条错误中的绝大部分来自此文件）
- **内容**：改为从符号真实所在模块导入；并在 CI 的 typecheck job 中确保新增测试文件纳入检查范围
- **进展**：待办。与 B-3 同属 typecheck 阻断项，**修 B-3 时一并处理最经济**

---

## 已完成并验证（条目已删除，仅在此留档）

- Sprint 0 核心交付：核心 TS 层 + CSV 解析器 + AES-GCM 封装 + Web 导入与列表页 —— commit `5b03ac9`，336 用例全绿
- 文档体系：`README.md`（7 章节）、`docs/PRD.md`、`docs/system_design.md`、`docs/roadmap.md`、`docs/architecture.md`、`docs/compliance-checklist.md`、`docs/adr/ADR-001…007`、`docs/ci.md`、`docs/security-verification.md`
- 合规脚本：`check:compliance` / `check:no-network` / `check:sync-payload` 三个断言脚本全部通过（PM 17:45 复测）
- 依赖治理：vitest 3.2.7 → 5.0.5，`npm audit` 从 4 漏洞（2 critical）降到 **0**
- 同步服务可运行化：`apps/sync-server` src 拆为 5 模块 + 83 用例全绿 + Dockerfile + 根 `docker-compose.yml` + `scripts/snapshot.{sh,mjs}` 落盘（**typecheck 未绿，转 B-3**）
- ESLint error 清零：`npm run lint` 从 10 errors → **0 errors**（PM 17:45 复测，**待 QA 复验后删 B-8**）
