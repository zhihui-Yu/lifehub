# @lifehub/web

> LifeHub 的表现层：Vite + React 18 + MUI v6 + Tailwind CSS + Zustand。
>
> 这一层只负责**界面与编排**；加密、金额精度、CSV 解析、存储策略全部来自 `@lifehub/core`。

---

## 1. 它负责什么 / 不负责什么

| ✅ 负责 | ❌ 不负责 |
| --- | --- |
| 6 个页面的渲染与交互 | 加密算法、口令派生（→ core） |
| 表单状态、列表筛选、导入向导的状态流转 | 金额解析与格式化（→ core） |
| 平台适配：IndexedDB / WebCrypto / 时钟 / 设备标签 | 业务规则（去重、方向推断、分类匹配 → core） |
| 把 core 的错误码翻译成用户能看懂的中文提示 | 存储引擎选型与索引策略（→ core） |
| 虚拟化长列表、响应式布局、无障碍语义 | 同步协议与网络传输 |

---

## 2. 快速开始

```bash
npm install                        # 仓库根目录执行一次
npm run dev --workspace @lifehub/web # http://localhost:5173
npm run build --workspace @lifehub/web
npm run test --workspace @lifehub/web # jsdom 组件测试
```

> WebCrypto（`crypto.subtle`）**只在 HTTPS 或 localhost 下可用**。用 `http://localhost:5173` 访问，
> 不要用局域网 IP 直连（否则会提示「本地数据读写失败」或加密不可用）。

---

## 3. 目录结构

```
apps/web/src/
├── pages/                6 个页面
│   ├── ImportPage.tsx        导入页：拖拽 / 选择文件 → 探查
│   ├── MappingPage.tsx       列头映射页：拖拽 + 下拉映射、实时预览、开始导入
│   ├── BillsPage.tsx         账单列表页：按 localDate 分组、组合筛选、虚拟化
│   ├── SecurityPage.tsx      安全页：保险库状态、恢复码、盐值备份、审计日志
│   ├── SettingsPage.tsx      设置页：时区、币种、危险操作
│   └── NotFoundPage.tsx      404
├── components/
│   ├── bills/              账单组件：过滤栏、分组列表、虚拟列表、行
│   ├── import/             导入组件：拖拽区、最近导入、步骤指示
│   ├── mapping/            映射组件：映射看板、方向规则、分类规则、预览表
│   ├── security/           安全组件：保险库状态卡、恢复码面板、盐值备份、审计表、设口令弹窗
│   ├── common/             通用组件：金额文本、确认弹窗、空状态、错误汇总、加载遮罩
│   └── layout/             布局：应用外壳、侧边导航、顶栏
├── hooks/                 业务编排
│   ├── useVault.ts         建库 / 解锁 / 恢复码解锁 / 锁定，会话状态
│   ├── useBillList.ts      加载解密账单 → 按 localDate 分组 → 过滤
│   ├── useCategories.ts    分类列表
│   ├── useAuditLog.ts      审计日志列表
│   ├── useImportFlow.ts    plan → 映射调整 → run 四步编排
│   └── useDebouncedValue.ts 200ms 防抖（搜索框）
├── store/                 Zustand 状态
│   ├── bill-store.ts       账单工作集 + 过滤条件
│   ├── import-store.ts     导入流程（idle → planning → mapping → running → done/error）
│   ├── settings-store.ts   时区、币种等设置
│   └── vault-store.ts      会话状态 + 内存态 DEK 供给器
├── platform/              ★ 平台适配层（唯一知道「平台是什么」的地方）
│   ├── index.ts                装配全部适配器与仓储
│   ├── indexeddb-storage-adapter.ts  Dexie 实现 StorageAdapter
│   ├── web-crypto-provider.ts  WebCrypto 实现 CryptoProvider
│   ├── clock.ts                Clock 端口实现
│   ├── device-label.ts         设备标签（'本机 · Chrome'）
│   └── db.ts                   Dexie 数据库定义
├── components/../utils/   下载、文件读取、格式化工具
├── types/                 Web 层专用类型
├── __tests__/             组件与 store 测试（jsdom）
├── router.tsx             6 条路由
├── App.tsx / main.tsx     应用入口
└── styles/index.css       Tailwind 指令 + CSS 变量（主题色）
```

---

## 4. 平台适配层：本包与 core 的唯一接缝

`platform/index.ts` 是**唯一**把 core 的端口与浏览器实现缝合起来的地方：

```ts
export interface PlatformRuntime {
  clock: Clock;
  cryptoProvider: CryptoProvider;
  cryptoService: CryptoService;
  storageAdapter: StorageAdapter;      // Dexie
  plainStore: PlainStore;
  encryptedStore: EncryptedStore;
  vaultRepository: VaultRepository;
  billRepository: BillRepository;
  categoryRepository: CategoryRepository;
  ruleTemplateRepository: RuleTemplateRepository;
  importBatchRepository: ImportBatchRepository;
  auditLogRepository: AuditLogRepository;
  auditLogger: AuditLogger;
  dekProvider: SessionDekProvider;     // 密钥只驻留内存
  deviceLabel: string;
  database: LifeHubDatabase;
}
```

三个工厂函数：

| 函数 | 作用 |
| --- | --- |
| `createPlatformRuntime(dekProvider, database?)` | 装配全部适配器与仓储 |
| `createImportService(runtime, deviceId)` | 构造导入服务 |
| `createVaultService(runtime)` | 构造保险库服务 |

### 密钥交接：为什么有 `onDekAvailable`

审计日志是**用 DEK 加密**的，而建库 / 解锁这两条审计发生在「DEK 装进供给器」之前。
若不先把 DEK 交给供给器，审计会写失败或写错密钥。因此 `createVaultService` 传入：

```ts
onDekAvailable: (dek, keyVersion) => runtime.dekProvider.setDek(dek, keyVersion),
currentDek: () => (runtime.dekProvider.isUnlocked() ? runtime.dekProvider.getDek('bill') : null),
```

- `onDekAvailable`：解锁 / 建库成功后立刻安装 DEK；
- `currentDek`：重新生成恢复码时复用**同一把** DEK（DEK 不变，只换包裹它的恢复密钥）。

---

## 5. 状态管理约定

| store | 状态 | 谁写 |
| --- | --- | --- |
| `useVaultStore` | 会话状态（`uninitialized` / `needs-setup` / `locked` / `unlocked`）、密钥版本、失败计数 | `useVault` |
| `useBillStore` | 解密后的账单工作集 + 过滤条件 | `useBillList` / `BillFilterBar` |
| `useImportStore` | 导入流程四段式状态机 | `useImportFlow` |
| `useSettingsStore` | 用户时区、币种等 | 设置页 |

**约定**：

1. **store 不持有密钥**。`useVaultStore` 只记「是否解锁」与版本号，
   DEK 由 `InMemoryDekProvider` 单独持有（`apps/web/src/store/vault-store.ts`），避免状态快照泄漏密钥。
2. **store 不做业务计算**。分组、过滤、去重都在 `hooks/` 或 core 里完成，store 只是持有结果。
3. **锁定期密钥立即擦除**：`lock()` 调用 `dekProvider.clear()`，内部 `fill(0)` 后置空（NF-S-2）。

---

## 6. 导入向导的四个阶段

```
ImportPage                        MappingPage
   │ 选文件 → useImportFlow.plan()      │ 调整映射 → updateMapping() → 实时预览
   ▼                                   ▼
planning ──── setPlan() ────► mapping ──── run() ────► done / error
```

| 阶段 | store 字段 | 关键 UI |
| --- | --- | --- |
| `idle` | — | 拖拽区 / 最近导入 |
| `planning` | `fileName` / `bytes` | 加载遮罩「正在解析文件…」 |
| `mapping` | `plan` / `mapping` / `preview` | 映射看板、方向规则、分类规则、前 10 行预览 |
| `running` | — | 加载遮罩「正在导入…」 |
| `done` | `summary` | Snackbar「成功导入 N 条，跳过 M 条」+ 跳转账单列表 |
| `error` | `error` | 中文错误提示 + `ErrorSummary` 错误明细表 |

**必填校验**：日期与金额未映射时，`ColumnMapper.validate()` 返回
`ok: false` 与文案「请先映射『日期』和『金额』两列」，页面据此禁用「开始导入」按钮。

---

## 7. 账单列表页

- **分组**：`useBillList` 按 `localDate` 分组，组头显示日期、星期、笔数与当日收支合计。
- **过滤**：关键词（200ms 防抖，命中对方与备注）、方向、日期区间、分类，四者可组合，一键清空。
- **过滤在内存中做**：解密后的账单工作集在内存里过滤（语义字段不适合做明文索引，见 ADR-006）。
- **虚拟化**：`BillVirtualList` 用 `@tanstack/react-virtual`，DOM 节点数不随数据量线性增长。

---

## 8. 测试

```bash
npm run test --workspace @lifehub/web            # 全部
npm run coverage --workspace @lifehub/web        # 覆盖率
```

| 文件 | 覆盖内容 |
| --- | --- |
| `src/__tests__/import-store.test.ts` | 导入流程 store 的状态流转（idle → planning → mapping → done / error → reset） |
| `src/__tests__/bills-page.test.tsx` | 账单列表的分组、方向筛选、日期区间筛选、关键词搜索、一键清空 |
| `src/__tests__/mapping-page.test.tsx` | 映射页的必填校验、实时预览、映射变更触发重算、导入结果提示 |

**测试约定**：

- 环境为 **jsdom**（与 core 的 Node 环境严格分开，避免 DOM 依赖泄漏进核心层）。
- 依赖平台运行时的 hook（`useVault` / `useImportFlow`）用 `vi.mock` 打桩；
  打桩对象必须用 `vi.hoisted` 创建并保持**引用稳定**，否则 `useEffect` 依赖会每次渲染都变，
  触发无限重渲染。
- 断言用中文文案（与用户实际看到的一致），避免文案改动导致测试假失败。

---

## 9. 样式与主题

- **Tailwind CSS**：负责布局微调与间距；**MUI v6**：负责组件（`Button` / `TextField` / `Dialog` / `Table` / `Snackbar` …）。
- 主题色通过 CSS 变量注入（`styles/index.css` 的 `--lifehub-*`），组件里用 `var(--lifehub-text-muted)` 等引用，
  便于后续做深色模式。
- 所有面向用户的文案**一律中文**。

---

## 10. 常见开发问题

| 现象 | 原因与处理 |
| --- | --- |
| 页面提示「本地数据读写失败」 | 浏览器禁用了 IndexedDB（隐私模式）。换普通窗口 |
| `crypto.subtle` 不可用 | 必须用 `https` 或 `http://localhost` 访问 |
| 首次进入没有引导页 | 浏览器里已有历史保险库数据 → 会被引导到解锁页；清站点数据可重看引导 |
| 测试报「Maximum update depth exceeded」 | `vi.mock` 的工厂引用了模块作用域里后声明的 `const`（TDZ）；改用 `vi.hoisted` |
| 测试报「No test files found」 | `vitest.config.ts` 的 `include` 需覆盖 `src/**/*.test.ts(x)`，且 `setupFiles` 指向的 `src/__tests__/setup.ts` 必须存在 |
| 组件测试里虚拟列表渲染不出行 | 虚拟化依赖真实滚动容器尺寸；测试中把 `BillVirtualList` 打桩成普通列表 |

---

## 11. 相关文档

- [`packages/core/README.md`](../../packages/core/README.md) —— 核心层 API 概览
- [`docs/architecture.md`](../../docs/architecture.md) —— 分层与数据流
- [`docs/system_design.md`](../../docs/system_design.md) §7 T04 —— Web 端任务分解
- [`docs/compliance-checklist.md`](../../docs/compliance-checklist.md) —— 红线逐条自检
