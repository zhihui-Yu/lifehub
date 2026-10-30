# LifeHub 项目长期记忆

> 项目：跨端私有数据生活管理工具（代号 `lifehub`），仓库 `D:\code\myapps`
> 完整设计以仓库内文档为准：`docs/system_design.md`（接口契约唯一权威）、`docs/roadmap.md`（任务分工矩阵）、`docs/adr/`（6 个决策记录）。
> 本文件只记录**跨会话不易从代码看出的约定与坑**。

## 环境事实（2026-10-30 核验）

- Windows + Git Bash；Node **v22.22.2**、npm **10.9.7**、Docker 29.6.1 可用；npm registry 可访问
- **Flutter SDK 未安装** —— 本项目当前**不走 Flutter**（见下）
- **仓库尚未 `git init`** —— 这是已知的最大流程隐患，长任务前务必先建基线提交

## 不可轻易推翻的架构约定

- **技术栈**：TypeScript 核心层 + Vite/React/MUI/Tailwind Web + Node 同步服务。选 Vite 而非 Flutter 的理由：Flutter 未安装，且原需求文档 3.4 节本身要求「Web 优先、禁止一上来全端一起生成」。核心层 `packages/core` 保持零 DOM 零 React，未来 Flutter 侧三条复用路径（移植 Dart / dart:ffi / JS 互操作）已在 `docs/architecture.md` 评估。
- **核心层 `packages/core` 的硬红线**：`tsconfig` 用 `lib:["ES2022"]` 不含 DOM；不得出现 `window.` / `document.` / `localStorage` / `navigator.`（注释里提到它们可以）。`npm run check:compliance` 会扫描拦截。
- **加密只走注入端口** `CryptoProvider`；**存储只走** `StorageAdapter`。核心层**禁止**直接调 `window.crypto` 或具体存储 API。
- **金额**：`amountMinor` 整数分 + `currency`；解析全程字符串切分，**绝不经过 parseFloat**。`direction` 取 `income | expense | refund`（退款用独立值，不用负向标记）。
- **时间**：`occurredAt` ISO 8601 UTC + 独立 `localDate` + `sourceTimeZone`。跨天/连续天数判定**只比 `localDate` 字符串**，不做时刻差计算。
- **索引明文列（本地库唯一明文，仅 7 个）**：`entityType / localDate / occurredAt / createdAt / updatedAt / version / deviceId`。其余业务语义全在密文内；索引列**不进**同步载荷与备份。
- **恢复码**：等价于一把「恢复 DEK」——`RecoveryMeta` 存 `{salt, kdfParams, wrappedDek}`，恢复码派生密钥包裹 DEK；重新生成 = 新盐值 + 新包裹**同一个 DEK**，故旧码立即失效。**恢复码明文绝不落库**。

## 注释与文档规范（用户硬性要求）

- 所有导出函数/类/接口必须有 JSDoc 五要素：首行中文一句话说明做什么 → 说明段 → `@param` 每个参数一行含类型与语义 → `@returns` → `@throws`（无异常写「无」）。复杂算法行内注释解释「**为什么**」而非「是什么」。
- 注释一律中文，专业术语保留英文原词（AES-GCM、scrypt、IndexedDB、RFC 4180）。`TODO` 必须带优先级与需求编号。
- 根 `README.md` 必须含 7 个章节且顺序固定：快速开始 / 项目结构 / 架构说明 / 模块清单 / 脚本说明 / 隐私与安全声明 / 开发路线。
- 文档里引用的类名 / 方法名 / 文件路径**必须与实际代码一致**（评审逐条核对）。
- ADR 固定模板：状态 / 背景 / 决策 / 备选方案与不选原因 / 后果 / 关联需求。

## 验证命令（改完代码必跑）

```bash
npm run typecheck            # core + web + sync-server 三包
npm run test                 # core + web
npm run build
npm run check:compliance     # X-05/X-06/R1 合规静态断言
npm run check:no-network     # X-01① 加密层零网络出口
npm run check:sync-payload   # X-01④ 同步载荷只含密文
```

## 踩过的坑

- **合规脚本误报**：`window` 若出现在中文 JSDoc 注释里会被裸文本匹配误判 —— 扫描前必须**剥离注释**再匹配代码。统计 SDK 黑名单要按**依赖包名精确匹配**，不能对 lock 全文做子串匹配（`gtag` 会误命中 `es-set-tostringtag`）。
- **`expect(fn()).toThrow()`**：这是**先执行再断言**，函数抛出会直接让用例失败而不是被 `toThrow` 捕获。必须写 `expect(() => fn()).toThrow()`。
- **子代理轮次上限**：长任务 agent 撞上轮次上限会被 aborted，产出半成品且无法回滚（没有 git）。下次长任务：预留更充足轮次 + 先 `git init` + 阶段性提交。
