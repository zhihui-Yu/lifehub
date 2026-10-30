# @lifehub/core

> LifeHub 的**零 DOM 纯 TypeScript 领域层**：数据模型、金额、时间、加密、CSV、规则引擎、存储抽象与服务编排。
>
> 这个包**不含任何 React 概念、不含任何浏览器 API**，因此可以在 Node、浏览器与未来的 Flutter 端运行。

---

## 1. 它负责什么 / 不负责什么

| ✅ 负责 | ❌ 不负责 |
| --- | --- |
| 领域模型与运行时校验（`validateXxx()`） | UI 渲染与交互 |
| 金额精度（分为单位整数，零浮点） | 具体存储引擎（IndexedDB / SQLite / 文件） |
| 时间规范化（ISO 8601 UTC + `localDate`） | 具体密码学实现（浏览器 / Node / 原生） |
| AES-GCM 加解密、DEK 包裹、scrypt 派生 | 口令强度的 UI 表达 |
| CSV 流式解析、编码探测、列头映射、方向推断 | 导入向导的页面流程 |
| 内容指纹去重、分类规则、文件哈希 | 同步协议的传输实现 |
| 存储抽象（`StorageAdapter` / `CryptoProvider` 端口） | 网络通信 |
| 保险库、导入、备份、审计、冲突合并的编排 | 日志输出到外部通道 |

---

## 2. 安装与构建

本包是 **private workspace 包**，不单独发布；随仓库一起使用。

```bash
npm install                    # 在仓库根目录执行
npm run typecheck:core         # 只做核心层的类型检查
npm run test --workspace @lifehub/core   # 运行核心层测试（Node 环境，不用 jsdom）
npm run bench --workspace @lifehub/core  # CSV 解析性能基准
```

**依赖只有两个**，都是纯 JS 密码学库：

| 依赖 | 用途 |
| --- | --- |
| `@noble/ciphers` | AES-GCM 的纯 JS 兜底实现 |
| `@noble/hashes` | scrypt / sha256 的纯 JS 实现 |

浏览器与 Node 走各自的原生实现，noble 仅在原生不可用时兜底。

---

## 3. 目录结构

```
packages/core/src/
├── models/       领域模型 + 运行时校验
│   ├── bill.ts             账单
│   ├── category.ts         分类
│   ├── rule-template.ts    规则模板（列映射 / 方向规则 / 分类规则）
│   ├── import-batch.ts     导入批次
│   ├── vault.ts            VaultParams / WrappedDek / RecoveryBundle / RecoveryMeta
│   ├── audit.ts            审计日志
│   ├── encrypted-blob.ts   同步 blob
│   ├── app-settings.ts     应用设置
│   └── common.ts           共享值对象（EncryptedPayload / StoredRecord / StorageQuery）
├── money/        金额：parseAmountToMinor / formatMinor / sumMinor / 币种精度表
│                 （amount-sign.ts：normalizeAmountText / detectAmountSign，
│                   解析与方向推断共用的「负号口径」）
├── time/         时间：parseFlexibleDate / toLocalDate / excelSerialToDate / 时区解析
├── crypto/       加密：CryptoService / DEK 包裹 / KDF / 恢复码 / CryptoProvider 端口
│   └── providers/  WebCryptoProvider / NodeCryptoProvider / NobleCryptoProvider
├── csv/          CSV：CsvParser（流式状态机）/ 编码探测 / ColumnMapper / DirectionResolver / RowMapper
├── rules/        规则：Deduplicator（内容指纹）/ CategoryRuleEngine / computeFileHash
├── storage/      存储：StorageAdapter 端口 / EncryptedStore / PlainStore / MemoryStorageAdapter
├── repositories/ 仓储：账单 / 分类 / 模板 / 批次 / 审计 / 保险库
├── services/     服务：VaultService / ImportService / BackupService / AuditLogger /
│                 KeyRotationService / sync（mergeRecord / sync-payload）
├── types/        跨实体类型与注入端口（BaseEntity / Clock / DekProvider / MergeableEntity）
├── utils/        工具：字节 / 哈希 / UUIDv7 / 序列化（带标记的 Uint8Array 编码）/ 守卫
├── errors.ts     统一错误类型与错误码表
└── constants.ts  领域常量（含取值依据）
```

---

## 4. 对外 API 概览

**所有上层代码只允许从 `@lifehub/core` 的 barrel 导入**，不要越过 barrel 引用深层路径。

### 4.1 领域模型

```ts
import type { Bill, Category, RuleTemplate, ImportBatch, AuditLog, EncryptedBlob } from '@lifehub/core';
import { validateBill, validateCategory, validateRuleTemplate } from '@lifehub/core';

const bill: Bill = {
  id: '019...',              // UUIDv7
  amountMinor: 3550,         // 分为单位的整数，恒为正
  currency: 'CNY',
  direction: 'expense',      // 'income' | 'expense' | 'refund'
  occurredAt: '2024-01-15T08:12:00.000Z',  // ISO 8601 UTC
  localDate: '2024-01-15',   // 用户时区下的日历日
  sourceTimeZone: 'Asia/Shanghai',
  counterparty: '星巴克',
  categoryId: null,
  note: '',
  sourceFileId: 'batch-1',
  sourceRowIndex: 0,
  createdAt: '2024-01-15T08:12:00.000Z',
  updatedAt: '2024-01-15T08:12:00.000Z',
  version: 1,
  deviceId: 'local-device',
};

validateBill(bill); // 字段非法时抛 LIFEHUB_E_VALIDATION
```

### 4.2 金额

```ts
import { parseAmountToMinor, formatMinor, sumMinor, getExponent } from '@lifehub/core';

parseAmountToMinor('1,234.56');                       // 123456
parseAmountToMinor('¥12.34');                          // 1234
parseAmountToMinor('￥-35.00 元', { allowNegative: true }); // -3500（货币符号在负号之前也认）
parseAmountToMinor('(35.00)', { allowNegative: true }); // -3500
parseAmountToMinor('12.34', { currency: 'JPY' });      // 抛 LIFEHUB_E_AMOUNT_INVALID（精度超出）
formatMinor(1234);                                    // '12.34'
formatMinor(1234, 'JPY');                             // '1234'
sumMinor([1234, 1234, 1234]);                          // 3702（全程零浮点）
getExponent('CNY');                                   // 2
```

**负号口径**：`parseAmountToMinor()` 与 `csv/direction.ts` 的方向推断共用
`normalizeAmountText()` / `detectAmountSign()`，因此「金额能解析成负数」与「方向能判定为支出」永远一致。

### 4.3 时间

```ts
import { parseFlexibleDate, toLocalDate, excelSerialToDate, formatIsoUtc } from '@lifehub/core';

const parsed = parseFlexibleDate('2024-01-15 08:30:00', { timeZone: 'Asia/Shanghai' });
parsed.localDate;   // '2024-01-15'
parsed.instant;     // Date

toLocalDate(new Date('2024-01-15T20:30:00.000Z'), 'Asia/Shanghai'); // '2024-01-16'（次日）
excelSerialToDate(45306);  // 2024-01-15T00:00:00.000Z
```

### 4.4 加密

```ts
import { CryptoService, WebCryptoProvider, createKdfParams } from '@lifehub/core';

const provider = new WebCryptoProvider();          // 或 NodeCryptoProvider / NobleCryptoProvider
const crypto = new CryptoService(provider);

const params = createKdfParams(provider.randomBytes(16));
const key = await provider.deriveKey(params, 'my-password');  // scrypt

const payload = await crypto.encryptRecord(key, 'bill', 'bill-1', 1, { hello: '世界' });
const plain = await crypto.decryptRecord<{ hello: string }>(key, 'bill', 'bill-1', 1, payload);
```

**恢复码**：

```ts
import { generateRecoveryCode, normalizeRecoveryCode, validateRecoveryCode } from '@lifehub/core';

const code = generateRecoveryCode();       // 'ABCDEF-GHIJKL-...-XYZ123'（12 组 × 6 字符）
validateRecoveryCode(code);                // true
normalizeRecoveryCode('abcdef ghijkl');    // 归一化为带 '-' 的规范形式
```

### 4.5 存储抽象

```ts
import { EncryptedStore, PlainStore, MemoryStorageAdapter } from '@lifehub/core';

// 端口由外部注入，核心层不感知具体存储
const adapter = new MemoryStorageAdapter();           // Node / 测试
const store = new EncryptedStore({ adapter, crypto, dek });

await store.put('bill', bill, { localDate: bill.localDate, occurredAt: bill.occurredAt });
const bills = await store.query<Bill>('bill', {
  where: { entityType: 'bill' },
  localDateFrom: '2024-01-01',
  localDateTo: '2024-01-31',
  orderBy: { column: 'occurredAt', direction: 'desc' },
  limit: 50,
});
```

### 4.6 服务

```ts
import { VaultService, ImportService, BackupService, AuditLogger, mergeRecord } from '@lifehub/core';

// 建库 → 返回恢复码包（一次性展示）
const setup = await vault.createVault('my-strong-password');
setup.recoveryBundle.recoveryCode;  // 12 组 × 6 字符

// 解锁
const unlocked = await vault.unlock('my-strong-password');
unlocked.dek;  // 32 字节，仅驻留内存

// 用恢复码解锁（恢复码直接包裹 DEK）
const recovered = await vault.unlockWithRecoveryCode(setup.recoveryBundle.recoveryCode);

// 导入：先 plan（只读探查），确认映射后 run
const plan = await importService.plan({ fileName: 'wechat.csv', sizeBytes: n, bytes });
const summary = await importService.run(source, { 0: 'occurredAt', 2: 'counterparty', 4: 'direction', 5: 'amount' }, { userTimeZone: 'Asia/Shanghai' });
summary.rowImported; summary.rowSkipped; summary.rowDuplicated; summary.errors;

// 备份：只搬密文
const file = await backupService.exportBackup();
await backupService.importBackup(file);

// 三方合并：与到达顺序无关
const result = mergeRecord(local, remote, base);
result.conflicts[0]?.winnerDeviceId;  // 胜方设备（顺序无关）
```

---

## 5. 在 Node 中使用

核心层的全部测试都在 Node 环境跑，**不需要 jsdom、不需要浏览器**——这本身就是「零 DOM 依赖」的可执行证明。

```ts
// 任意 .ts 脚本（用 tsx / ts-node / vite-node 运行）
import {
  AuditLogRepository, AuditLogger, CryptoService, EncryptedStore,
  MemoryStorageAdapter, PlainStore, VaultRepository, VaultService,
  WebCryptoProvider, type Clock,
} from '@lifehub/core';

class FixedClock implements Clock {
  now(): Date { return new Date('2024-01-15T08:12:00.000Z'); }
  nowIso(): string { return this.now().toISOString(); }
}

const adapter = new MemoryStorageAdapter();
const provider = new WebCryptoProvider();
const crypto = new CryptoService(provider);
const dek = provider.randomBytes(32);

const store = new EncryptedStore({
  adapter, crypto,
  dek: {
    isUnlocked: () => true,
    getDek: () => dek,
    getKeyVersion: () => 1,
  },
});

const clock = new FixedClock();
const vaultRepository = new VaultRepository(new PlainStore(adapter));
const audit = new AuditLogger({
  repository: new AuditLogRepository(store),
  clock,
  deviceLabel: '本机 · Node',
});

const vault = new VaultService({
  adapter, crypto, provider,
  repository: vaultRepository,
  audit, clock,
  // 重新生成恢复码需要复用同一把 DEK
  currentDek: () => dek,
  // 建库 / 解锁后把 DEK 装进供给器，保证审计用正确密钥加密
  onDekAvailable: (newDek) => { dek = newDek; },
});

const setup = await vault.createVault('my-strong-password');
console.log('恢复码：', setup.recoveryBundle.recoveryCode);
```

> Node 端若追求更快的 scrypt / AES-GCM，可用 `@lifehub/core/node` 子路径的 `NodeCryptoProvider`
> （走 `node:crypto` 原生实现），浏览器构建不会误引入它。

---

## 6. 在浏览器中使用

浏览器端**不要**在核心层之外直接操作 IndexedDB；正确姿势是实现端口后注入：

```ts
import { CryptoService, EncryptedStore, WebCryptoProvider } from '@lifehub/core';
import { DexieStorageAdapter } from '@/platform/indexeddb-storage-adapter';

const provider = new WebCryptoProvider();   // 走 globalThis.crypto
const crypto = new CryptoService(provider);
const adapter = new DexieStorageAdapter(db);
const store = new EncryptedStore({ adapter, crypto, dek });
```

`apps/web` 已经把这套装配好了，详见 [`apps/web/README.md`](../../apps/web/README.md)。

---

## 7. 错误处理

核心层**只抛 `LifeHubError`**，绝不 `throw new Error('中文')`：

```ts
import { LifeHubError, isLifeHubError } from '@lifehub/core';

try {
  await vault.unlock('wrong-password');
} catch (cause) {
  if (isLifeHubError(cause)) {
    cause.code;     // 'LIFEHUB_E_VAULT_PASSWORD_WRONG'
    cause.message;  // '主口令不正确'（面向用户的中文文案）
  }
}
```

完整错误码表见 `packages/core/src/errors.ts` 与 `docs/system_design.md` §3.4。

---

## 8. 扩展指引

| 想加什么 | 改哪里 | 注意 |
| --- | --- | --- |
| 新的领域实体 | `src/models/` + `src/repositories/` + `src/types/entity-type.ts` | 必须手工决定**索引明文列**（ADR-006）；必须提供 `validateXxx()` |
| 新的存储引擎 | 实现 `StorageAdapter` | 放在 `apps/*/platform`，**不要**放进 core |
| 新的密码学实现 | 实现 `CryptoProvider` | 同上；core 只认端口 |
| 新的 CSV 格式 | `src/csv/date-formats.ts` 的 `DATE_FORMATS` | 加完必须补 `tests/unit/datetime.test.ts` 的用例 |
| 新的分类规则匹配类型 | `src/models/rule-template.ts` + `src/rules/category-rule.ts` | `CategoryMatchType` 是联合类型，两处都要改 |

---

## 9. 相关文档

- [`docs/architecture.md`](../../docs/architecture.md) —— 分层、数据流、加密边界、索引列取舍
- [`docs/adr/ADR-001`~`ADR-006`](../../docs/adr/) —— 金额精度 / 时间时区 / 加密边界 / 存储抽象 / 冲突合并 / 索引列
- [`docs/compliance-checklist.md`](../../docs/compliance-checklist.md) —— 红线逐条自检
- [`docs/system_design.md`](../../docs/system_design.md) §3 —— 完整类图与方法签名
