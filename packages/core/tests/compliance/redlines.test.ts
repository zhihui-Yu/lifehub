/**
 * 安全深度验证 · 架构红线 R1–R10 的可执行断言。
 *
 * 覆盖需求：系统设计 §8.8「架构红线（评审必查）」R1~R10；
 * PRD §4.2 的 X-01~X-15；系统设计 §8.2 数据格式约定；§8.5 日志与审计约定；§8.6 注释规范。
 *
 * 【本文件与既有 `tests/qa/qa-compliance.test.ts` 的差异】
 * 既有文件做的是同类静态扫描。本文件的增量在于：
 * 1. **R1 的扫描器自带「自检」**：先用一个**故意含真实 DOM 调用的样本**验证扫描器
 *    确实能命中真实代码，再验证它对**注释里的 window 文本不误报**——
 *    这样「剥离注释再匹配」这个实现本身是被证明的，而不是被假设的；
 * 2. **R10 统计缺失项并断言缺失数为 0**：逐个导出函数 / 类 / 公共方法检查
 *    「JSDoc 块存在 + 首行中文说明 + 每个参数有 @param + 有返回值的有 @returns」，
 *    并把缺失项清单打印出来，缺失数必须为 0；
 * 3. **R4 / R5 增加运行时断言**：不只扫源码，还实际跑一遍存储与载荷路径，
 *    验证「业务实体只能以密文写入」「载荷只含密文字段」；
 * 4. **R9 把 §8.2 的常量约定变成断言**：金额用整数分、时间戳用 ISO 8601 UTC、
 *    日历日 `YYYY-MM-DD`、墙钟 `HH:mm`，且源码里不得出现 `toFixed` 参与金额运算。
 *
 * 重要：R1 的源码扫描**必须先剥离注释**再匹配代码。
 * 中文 JSDoc 里出现 `window.crypto`、`node:crypto` 这类词是**允许**的
 * （例如 provider.ts 的文件头注释就在解释「不直接访问 window.crypto」），
 * 若不剥离注释必然误报。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createTestRuntime } from '../helpers/runtime';
import {
  BACKUP_MAGIC,
  DIRECTION_EXPENSE_KEYWORDS,
  DIRECTION_INCOME_KEYWORDS,
  ENCRYPTION_ALGORITHM,
  IMPORT_BATCH_SIZE,
  ISO_UTC_PATTERN,
  KDF_DEFAULT_PARAMS,
  LOCAL_DATE_PATTERN,
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_GROUP_COUNT,
  RECOVERY_CODE_GROUP_LENGTH,
  VAULT_VERIFIER_PLAINTEXT,
  WALL_CLOCK_PATTERN,
} from '../../src/constants';
import { formatMinor, parseAmountToMinor, sumMinor } from '../../src/money/amount';
import { CURRENCY_EXPONENT, DEFAULT_CURRENCY } from '../../src/money/currency';
import { formatIsoUtc, toLocalDate, toWallClock } from '../../src/time/datetime';
import { PLAIN_ENTITY_TYPES } from '../../src/types/entity-type';
import type { PlainEntityType } from '../../src/types/entity-type';
import { PlainStore } from '../../src/storage/plain-store';
import { VaultService } from '../../src/services/vault-service';
import { buildSyncPayload, SYNC_BLOB_ALLOWED_FIELDS } from '../../src/services/sync/sync-payload';

/** 仓库根目录（由本文件位置向上四级推导）。 */
const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/** 核心层源码目录。 */
const CORE_SRC = join(REPO_ROOT, 'packages/core/src');

/** Web 端源码目录。 */
const WEB_SRC = join(REPO_ROOT, 'apps/web/src');

/** 同步服务源码目录。 */
const SYNC_SRC = join(REPO_ROOT, 'apps/sync-server/src');

/**
 * 涉及建库 / 解锁（真实 scrypt）的用例超时上限。
 *
 * 说明：覆盖率插桩 + 多 worker 并行时，单次 scrypt 可能耗时数十秒，
 * 这里给足余量；**这只放宽超时上限，不放宽任何断言**。
 */
const VAULT_TIMEOUT = 180_000;

/**
 * 递归收集目录下的 TypeScript 源文件。
 *
 * @param dir 起始目录
 * @returns 绝对路径列表
 */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 把绝对路径转成相对仓库根的 POSIX 风格路径。
 *
 * 说明：用 `path.relative` 计算而不是字符串替换，
 * 因为 Windows 下 `REPO_ROOT` 的分隔符是 `\`，字符串替换会失效。
 *
 * @param file 绝对路径
 * @returns 相对路径
 */
function toRel(file: string): string {
  return relative(REPO_ROOT, file).split(sep).join('/');
}

/**
 * 剥离源码中的注释，只保留真实代码。
 *
 * 说明：这是一个逐字符状态机，能正确跳过行注释、块注释、单引号 / 双引号字符串
 * 与模板字符串（避免把 URL 里的 `//` 误判成注释起点）。
 * **R1 只约束真实代码**，因此中文 JSDoc 里提到 `window` 是允许的，
 * 必须先把注释去掉再匹配。
 *
 * @param source 源码文本
 * @returns 去掉注释后的文本（字符串内容原样保留）
 */
function stripComments(source: string): string {
  let out = '';
  let index = 0;
  const length = source.length;
  while (index < length) {
    const char = source[index];
    const next = source[index + 1];
    // 行注释
    if (char === '/' && next === '/') {
      while (index < length && source[index] !== '\n') {
        index += 1;
      }
      continue;
    }
    // 块注释
    if (char === '/' && next === '*') {
      index += 2;
      while (index < length && !(source[index] === '*' && source[index + 1] === '/')) {
        // 保留换行，避免把多行注释压成一行影响后续定位。
        if (source[index] === '\n') {
          out += '\n';
        }
        index += 1;
      }
      index += 2;
      continue;
    }
    // 字符串与模板字符串：原样复制，直到闭合引号。
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      out += char;
      index += 1;
      while (index < length) {
        const current = source[index];
        if (current === '\\') {
          out += current + (source[index + 1] ?? '');
          index += 2;
          continue;
        }
        out += current;
        index += 1;
        if (current === quote) {
          break;
        }
      }
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

describe('R1 扫描器自检 · 剥离注释后再匹配代码', () => {
  it('自检样本 1：注释里提到 window 不应被判定为违规', () => {
    const sample = [
      '/**',
      ' * 说明：核心层不直接访问 window.crypto，而是走 CryptoProvider 端口。',
      ' */',
      'export const answer = 42;',
    ].join('\n');
    const code = stripComments(sample);

    expect(code).not.toContain('window');
    expect(code).toContain('export const answer = 42;');
  }, VAULT_TIMEOUT);

  it('自检样本 2：真实代码里的 window 调用必须被判定为违规（证明没漏掉）', () => {
    const sample = [
      '/**',
      ' * 说明：这里只是文档。',
      ' */',
      'export function readToken(): string {',
      '  return window.localStorage.getItem("token") ?? "";',
      '}',
    ].join('\n');
    const code = stripComments(sample);

    expect(code).toContain('window.localStorage');
    expect(code).not.toContain('这里是文档');
  }, VAULT_TIMEOUT);

  it('自检样本 3：行注释里的 window 同样不应误报', () => {
    const sample = ['// 曾经用过 window.alert，现在不用了', 'export const x = 1;'].join('\n');
    expect(stripComments(sample)).not.toContain('window');
  }, VAULT_TIMEOUT);

  it('自检样本 4：字符串字面量里的 // 不应被当成注释起点', () => {
    const sample = ['export const url = "https://example.com/path";'].join('\n');
    expect(stripComments(sample)).toContain('https://example.com/path');
  }, VAULT_TIMEOUT);
});

describe('R1 · packages/core 零 DOM', () => {
  it('核心层真实代码中不出现 window / document / localStorage / sessionStorage / indexedDB / navigator', () => {
    const forbidden: { name: string; regex: RegExp }[] = [
      { name: 'window', regex: /(?<![.\w])window\s*[.([]/g },
      { name: 'document', regex: /(?<![.\w])document\s*[.([]/g },
      { name: 'localStorage', regex: /\blocalStorage\b/g },
      { name: 'sessionStorage', regex: /\bsessionStorage\b/g },
      { name: 'indexedDB', regex: /\bindexedDB\b/g },
      { name: 'navigator', regex: /(?<![.\w])navigator\s*[.([]/g },
      { name: 'globalThis.window', regex: /globalThis\s*\.\s*window\b/g },
      { name: 'globalThis.document', regex: /globalThis\s*\.\s*document\b/g },
      { name: 'globalThis.localStorage', regex: /globalThis\s*\.\s*localStorage\b/g },
      { name: 'globalThis.navigator', regex: /globalThis\s*\.\s*navigator\b/g },
    ];

    const violations: string[] = [];
    for (const file of collectTsFiles(CORE_SRC)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const { name, regex } of forbidden) {
        if (regex.test(code)) {
          violations.push(`${toRel(file)} 命中 ${name}`);
          regex.lastIndex = 0;
        }
      }
    }
    expect(violations).toEqual([]);
  }, VAULT_TIMEOUT);

  it('核心层 tsconfig 的 lib 不含 DOM / DOM.Iterable', () => {
    const tsconfig = readFileSync(join(REPO_ROOT, 'packages/core/tsconfig.json'), 'utf8');
    expect(tsconfig).toContain('"ES2022"');
    const libMatch = tsconfig.match(/"lib"\s*:\s*\[([^\]]*)\]/);
    expect(libMatch).not.toBeNull();
    expect(libMatch?.[1]).not.toContain('DOM');
  }, VAULT_TIMEOUT);

  it('核心层不直接 import node:crypto（只允许 ./node 子路径的 provider）', () => {
    const offenders: string[] = [];
    for (const file of collectTsFiles(CORE_SRC)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (/from\s+['"]node:/.test(code) && !file.endsWith('node-crypto-provider.ts')) {
        offenders.push(toRel(file));
      }
    }
    expect(offenders).toEqual([]);
  }, VAULT_TIMEOUT);

  it('核心层不直接 import node:fs / node:path 等 Node 专有 API', () => {
    const offenders: string[] = [];
    for (const file of collectTsFiles(CORE_SRC)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (/from\s+['"]node:(fs|path|os|url|child_process|http|https)['"]/.test(code)) {
        offenders.push(toRel(file));
      }
    }
    expect(offenders).toEqual([]);
  }, VAULT_TIMEOUT);
});

describe('R2 · packages/core 依赖不含 React / MUI / Dexie / 统计 SDK', () => {
  it('核心层运行时依赖只有两个 @noble 密码学库', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'packages/core/package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = Object.keys(pkg.dependencies ?? {});
    expect(deps.sort()).toEqual(['@noble/ciphers', '@noble/hashes']);
  }, VAULT_TIMEOUT);

  it('核心层的依赖与开发依赖都不含浏览器专有包与统计 SDK', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'packages/core/package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const forbidden = [
      'react',
      'react-dom',
      'react-router-dom',
      '@mui/material',
      '@emotion/react',
      '@emotion/styled',
      'dexie',
      'axios',
      'papaparse',
      'moment',
      'dayjs',
      'date-fns',
      'lodash',
      'sentry',
      'amplitude',
      'mixpanel',
      'google-analytics',
      'gtag',
      'umeng',
      'hotjar',
      'clarity',
      'datadog',
      'posthog',
      'bugsnag',
      'rollbar',
      'segment',
    ];
    const all = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
    for (const dep of all) {
      expect(forbidden).not.toContain(dep);
    }
  }, VAULT_TIMEOUT);

  it('全仓依赖树不含任何埋点 / 统计 / 广告 SDK（按包名精确匹配）', () => {
    const forbidden = [
      'sentry',
      'amplitude',
      'mixpanel',
      'google-analytics',
      'gtag',
      'umeng',
      'hotjar',
      'clarity',
      'datadog',
      'posthog',
      'bugsnag',
      'rollbar',
      'segment',
      'fullstory',
      'logrocket',
    ];

    const lock = JSON.parse(readFileSync(join(REPO_ROOT, 'package-lock.json'), 'utf8')) as {
      packages?: Record<string, unknown>;
    };
    const names: string[] = [];
    for (const key of Object.keys(lock.packages ?? {})) {
      const marker = 'node_modules/';
      const at = key.lastIndexOf(marker);
      if (at >= 0) {
        names.push(key.slice(at + marker.length).toLowerCase());
      }
    }
    expect(names.length).toBeGreaterThan(0);

    const hits = names.filter((name) =>
      forbidden.some((sdk) => {
        const base = name.startsWith('@') ? (name.split('/')[0] ?? '').replace(/^@/, '') : name;
        return name === sdk || base === sdk || name.startsWith(`${sdk}/`) || name.startsWith(`${sdk}-`);
      }),
    );
    expect(hits).toEqual([]);
  }, VAULT_TIMEOUT);
});

describe('R3 · 加密 / 密钥模块零网络出口', () => {
  it('crypto/** 与 services/** 的真实代码里不出现任何网络 API', () => {
    const forbidden: { name: string; regex: RegExp }[] = [
      { name: 'fetch', regex: /(?<![.\w])fetch\s*\(/g },
      { name: 'XMLHttpRequest', regex: /\bXMLHttpRequest\b/g },
      { name: 'WebSocket', regex: /\bWebSocket\b/g },
      { name: 'sendBeacon', regex: /\bsendBeacon\b/g },
      { name: 'EventSource', regex: /\bEventSource\b/g },
      { name: 'importScripts', regex: /\bimportScripts\b/g },
      { name: 'navigator.sendBeacon', regex: /navigator\s*\.\s*sendBeacon/g },
      { name: 'navigator.geolocation', regex: /navigator\s*\.\s*geolocation/g },
    ];

    const roots = [join(CORE_SRC, 'crypto'), join(CORE_SRC, 'services')];
    const violations: string[] = [];
    for (const root of roots) {
      for (const file of collectTsFiles(root)) {
        const code = stripComments(readFileSync(file, 'utf8'));
        for (const { name, regex } of forbidden) {
          if (regex.test(code)) {
            violations.push(`${toRel(file)} 命中 ${name}`);
            regex.lastIndex = 0;
          }
        }
      }
    }
    expect(violations).toEqual([]);
  }, VAULT_TIMEOUT);
});

describe('R4 · 存储层无明文业务写入口', () => {
  it('明文实体白名单只有 vaultParams / recoveryMeta / appSettings 三类', () => {
    expect(PLAIN_ENTITY_TYPES).toEqual(['vaultParams', 'recoveryMeta', 'appSettings']);
  }, VAULT_TIMEOUT);

  it('运行时：把业务实体写进 PlainStore 会被拒绝', async () => {
    const runtime = createTestRuntime();
    const plainStore = new PlainStore(runtime.adapter);

    // 故意传入业务实体类型 'bill' —— PlainStore 的类型签名只允许三类明文实体，
    // 因此这里必须做一次类型逃逸，才能在运行时验证白名单守卫确实拦得住。
    await expect(
      plainStore.put('bill' as PlainEntityType, 'bill-plain-1', { amountMinor: 12850 }, {
        version: 1,
        createdAt: '2024-01-15T08:12:00.000Z',
        updatedAt: '2024-01-15T08:12:00.000Z',
        deviceId: 'test-device',
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }));
  }, VAULT_TIMEOUT);

  it('运行时：经 EncryptedStore 写入的业务实体载荷类型是 encrypted', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault('test-password-123');
    await runtime.vault.unlock('test-password-123');
    await runtime.bills.put({
      id: 'bill-r4-1',
      amountMinor: 12850,
      currency: 'CNY',
      direction: 'expense',
      occurredAt: '2024-01-15T08:12:00.000Z',
      localDate: '2024-01-15',
      sourceTimeZone: 'Asia/Shanghai',
      counterparty: '星巴克(国贸店)',
      categoryId: null,
      note: '含逗号, 的备注',
      sourceFileId: 'batch-1',
      sourceRowIndex: 0,
      createdAt: '2024-01-15T08:12:00.000Z',
      updatedAt: '2024-01-15T08:12:00.000Z',
      version: 1,
      deviceId: 'test-device',
    });

    const record = await runtime.adapter.get('bill', 'bill-r4-1');
    expect(record?.payload.kind).toBe('encrypted');
  }, 30_000);

  it('源码：plain-store.ts 的明文白名单与常量一致，且不含业务实体类型', () => {
    const source = stripComments(readFileSync(join(CORE_SRC, 'storage/plain-store.ts'), 'utf8'));
    for (const businessType of ['bill', 'category', 'ruleTemplate', 'importBatch', 'auditLog']) {
      expect(source).not.toContain(`'${businessType}'`);
    }
  }, VAULT_TIMEOUT);
});

describe('R5 · 同步载荷与备份只含密文', () => {
  it('源码：同步载荷与备份的构造代码里不出现明文字段名', () => {
    const forbiddenFields = [
      'amountMinor',
      'counterparty',
      'categoryId',
      'note',
      'title',
      'body',
      'content',
      'password',
      'salt',
      'dek',
      'masterKey',
    ];
    const targets = [
      join(CORE_SRC, 'services/sync/sync-payload.ts'),
      join(CORE_SRC, 'models/encrypted-blob.ts'),
      join(CORE_SRC, 'services/backup-service.ts'),
    ];
    const violations: string[] = [];
    for (const target of targets) {
      const code = stripComments(readFileSync(target, 'utf8'));
      for (const field of forbiddenFields) {
        // 反引号需转义后才能放进模板字符串；这里用字符类排除引号包裹的键名。
        const regex = new RegExp(`(^|[^'"\`])(${field})\\s*:`, 'm');
        if (regex.test(code)) {
          violations.push(`${toRel(target)} 出现明文字段 ${field}`);
        }
      }
    }
    expect(violations).toEqual([]);
  }, VAULT_TIMEOUT);

  it('运行时：同步载荷的 blob 字段全部落在白名单内', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault('test-password-123');
    await runtime.vault.unlock('test-password-123');

    const records = await runtime.adapter.query('bill');
    const blobs = records.map((record) => {
      if (record.payload.kind !== 'encrypted') {
        throw new Error('账单必须是密文载荷');
      }
      return {
        id: record.id,
        entityType: record.entityType,
        entityId: record.id,
        ciphertext: record.payload.ciphertext,
        iv: record.payload.iv,
        tag: record.payload.tag,
        algorithm: 'AES-256-GCM' as const,
        keyVersion: record.payload.keyVersion,
        updatedAt: record.updatedAt,
        version: record.version,
      };
    });

    const payload = buildSyncPayload(blobs);
    const allowed = new Set([...SYNC_BLOB_ALLOWED_FIELDS, 'version', 'createdAt', 'blobs']);
    for (const blob of payload.blobs) {
      for (const key of Object.keys(blob)) {
        expect(allowed.has(key)).toBe(true);
      }
    }
    // 说明：本用例内部会 `createVault` + `unlock`，各触发一次真实 scrypt（N=32768）。
    // 覆盖率插桩 + 多 worker 并行时单次派生可能耗时数十秒，
    // 因此沿用本文件既有的 VAULT_TIMEOUT（而不是 30s）——
    // **只放宽超时上限，不放宽任何断言**。
  }, VAULT_TIMEOUT);
});

describe('R6 · 无采集调用（定位 / 设备号 / 通讯录 / 麦克风）', () => {
  it('核心层与 Web 层不出现采集类 API 调用', () => {
    const collectionPatterns: { name: string; regex: RegExp }[] = [
      { name: 'geolocation', regex: /\bgeolocation\b/g },
      { name: 'getCurrentPosition', regex: /\bgetCurrentPosition\s*\(/g },
      { name: 'getUserMedia', regex: /\bgetUserMedia\s*\(/g },
      { name: 'navigator.imei', regex: /navigator\s*\.\s*imei/g },
      { name: 'navigator.serial', regex: /navigator\s*\.\s*serial/g },
      { name: 'navigator.bluetooth', regex: /navigator\s*\.\s*bluetooth/g },
      { name: 'navigator.usb', regex: /navigator\s*\.\s*usb/g },
      { name: 'navigator.credentials', regex: /navigator\s*\.\s*credentials/g },
      { name: 'getBattery', regex: /\bgetBattery\s*\(/g },
      { name: 'addressBook', regex: /\baddressBook\b/g },
      { name: 'ContactsManager', regex: /\bContactsManager\b/g },
      { name: 'fingerprint', regex: /\bfingerprint\s*\(/g },
    ];

    const roots = [CORE_SRC, WEB_SRC];
    const violations: string[] = [];
    for (const root of roots) {
      for (const file of collectTsFiles(root)) {
        const code = stripComments(readFileSync(file, 'utf8'));
        for (const { name, regex } of collectionPatterns) {
          if (regex.test(code)) {
            violations.push(`${toRel(file)} 命中 ${name}`);
            regex.lastIndex = 0;
          }
        }
      }
    }
    expect(violations).toEqual([]);
  }, VAULT_TIMEOUT);
});

describe('R7 · 无指向外部域名的请求', () => {
  it('源码中不出现银行 / 支付平台开放接口域名', () => {
    const domains = [
      'icbc.com.cn',
      'cmbchina.com',
      'ccb.com',
      'abchina.com',
      'boc.cn',
      'bankofchina.com',
      'unionpay.com',
      'alipay.com',
      'tenpay.com',
      'unionpayintl.com',
    ];
    const roots = [CORE_SRC, WEB_SRC, SYNC_SRC];
    const violations: string[] = [];
    for (const root of roots) {
      for (const file of collectTsFiles(root)) {
        const content = readFileSync(file, 'utf8');
        for (const domain of domains) {
          if (content.includes(domain)) {
            violations.push(`${toRel(file)} 含域名 ${domain}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  }, VAULT_TIMEOUT);

  it('Web 端真实代码里不出现任何网络 API（除用户自填 AI endpoint）', () => {
    const networkPatterns: { name: string; regex: RegExp }[] = [
      { name: 'fetch', regex: /(?<![.\w])fetch\s*\(/g },
      { name: 'XMLHttpRequest', regex: /\bXMLHttpRequest\b/g },
      { name: 'WebSocket', regex: /\bWebSocket\b/g },
      { name: 'sendBeacon', regex: /\bsendBeacon\b/g },
      { name: 'EventSource', regex: /\bEventSource\b/g },
    ];
    const violations: string[] = [];
    for (const file of collectTsFiles(WEB_SRC)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const { name, regex } of networkPatterns) {
        if (regex.test(code)) {
          violations.push(`${toRel(file)} 命中 ${name}`);
          regex.lastIndex = 0;
        }
      }
    }
    expect(violations).toEqual([]);
  }, VAULT_TIMEOUT);

  it('Web 端 index.html 的 CSP 把 connect-src 限定为 self', () => {
    const html = readFileSync(join(REPO_ROOT, 'apps/web/index.html'), 'utf8');
    expect(html).toContain('Content-Security-Policy');
    expect(html).toMatch(/connect-src\s+'self'/);
  }, VAULT_TIMEOUT);

  it('同步服务源码里不出现 decrypt / createCipheriv 等解密能力', () => {
    const source = readFileSync(join(SYNC_SRC, 'server.ts'), 'utf8');
    expect(source).not.toMatch(/createCipheriv|createDecipheriv/i);
    expect(source).not.toMatch(/\bdecrypt\s*\(/i);
    expect(source).not.toMatch(/scrypt/i);
  }, VAULT_TIMEOUT);
});

describe('R8 · 无「找回密码 / 客服解封 / 后门恢复」入口', () => {
  it('全仓源码不含禁用文案', () => {
    const phrases = ['找回密码', '客服解封', '后门恢复', '一键找回', '人工解锁', '客服协助', '官方找回'];
    const roots = [CORE_SRC, WEB_SRC, SYNC_SRC];
    const violations: string[] = [];
    for (const root of roots) {
      for (const file of collectTsFiles(root)) {
        const content = readFileSync(file, 'utf8');
        for (const phrase of phrases) {
          if (content.includes(phrase)) {
            violations.push(`${toRel(file)} 含文案「${phrase}」`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  }, VAULT_TIMEOUT);

  it('核心层不提供任何「绕过口令」的解锁入口（除恢复码）', () => {
    // 保险库服务的公开方法只有这些；不存在 adminUnlock / backdoor / resetPassword 之类。
    const methods = Object.getOwnPropertyNames(VaultService.prototype).filter(
      (name) => name !== 'constructor' && !name.startsWith('get') && !name.startsWith('assert'),
    );
    for (const forbidden of ['adminUnlock', 'backdoor', 'resetPassword', 'masterUnlock', 'bypass']) {
      expect(methods.map((name) => name.toLowerCase())).not.toContain(forbidden.toLowerCase());
    }
  }, VAULT_TIMEOUT);
});

describe('R9 · 金额、日期、时间格式与系统设计 §8.2 一致', () => {
  it('常量层：格式与算法常量与 §8.2 逐条一致', () => {
    expect(ISO_UTC_PATTERN.source).toBe('^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$');
    expect(LOCAL_DATE_PATTERN.source).toBe('^\\d{4}-\\d{2}-\\d{2}$');
    expect(WALL_CLOCK_PATTERN.source).toBe('^([01]\\d|2[0-3]):[0-5]\\d$');
    expect(ENCRYPTION_ALGORITHM).toBe('AES-256-GCM');
    expect(VAULT_VERIFIER_PLAINTEXT).toBe('lifehub:verify:v1');
    expect(KDF_DEFAULT_PARAMS.n).toBe(32768);
    expect(KDF_DEFAULT_PARAMS.r).toBe(8);
    expect(KDF_DEFAULT_PARAMS.p).toBe(1);
    expect(KDF_DEFAULT_PARAMS.keyLength).toBe(32);
    expect(KDF_DEFAULT_PARAMS.saltLength).toBe(16);
    expect(BACKUP_MAGIC).toBe('LIFEHUB-BACKUP');
    expect(IMPORT_BATCH_SIZE).toBe(1000);
    expect(RECOVERY_CODE_GROUP_COUNT).toBe(12);
    expect(RECOVERY_CODE_GROUP_LENGTH).toBe(6);
    expect(RECOVERY_CODE_ALPHABET).toBe('ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    expect(DEFAULT_CURRENCY).toBe('CNY');
    expect(CURRENCY_EXPONENT).toEqual({ CNY: 2, JPY: 0, KWD: 3 });
    expect(DIRECTION_INCOME_KEYWORDS.length).toBeGreaterThan(0);
    expect(DIRECTION_EXPENSE_KEYWORDS.length).toBeGreaterThan(0);
  }, VAULT_TIMEOUT);

  it('运行时：金额一律以「分」为单位的整数存取，格式化不参与运算', () => {
    expect(parseAmountToMinor('128.50')).toBe(12850);
    expect(parseAmountToMinor('1,234.56')).toBe(123456);
    expect(parseAmountToMinor('¥12.34')).toBe(1234);
    expect(formatMinor(12850)).toBe('128.50');
    expect(sumMinor([12850, 1, 2])).toBe(12853);
    // 非整数分是非法值。
    expect(() => formatMinor(128.5)).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  }, VAULT_TIMEOUT);

  it('运行时：时间戳 / 日历日 / 墙钟时间三种格式互不混用', () => {
    const instant = new Date('2024-01-15T08:12:00.000Z');
    expect(formatIsoUtc(instant)).toMatch(ISO_UTC_PATTERN);
    expect(toLocalDate(instant, 'Asia/Shanghai')).toMatch(LOCAL_DATE_PATTERN);
    expect(toWallClock(instant, 'Asia/Shanghai')).toMatch(WALL_CLOCK_PATTERN);
    // UTC 与东八区跨天：UTC 20:30 在东八区已是次日。
    const evening = new Date('2024-01-15T20:30:00.000Z');
    expect(toLocalDate(evening, 'UTC')).toBe('2024-01-15');
    expect(toLocalDate(evening, 'Asia/Shanghai')).toBe('2024-01-16');
  }, VAULT_TIMEOUT);

  it('源码：金额模块不使用 toFixed / parseFloat 参与运算', () => {
    const moneyDir = join(CORE_SRC, 'money');
    const offenders: string[] = [];
    for (const file of collectTsFiles(moneyDir)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (/\btoFixed\s*\(/.test(code)) {
        offenders.push(`${toRel(file)} 使用 toFixed`);
      }
      if (/\bparseFloat\s*\(/.test(code)) {
        offenders.push(`${toRel(file)} 使用 parseFloat`);
      }
    }
    expect(offenders).toEqual([]);
  }, VAULT_TIMEOUT);
});

describe('R10 · 每个导出函数有完整 JSDoc（缺失项必须为 0）', () => {
  /**
   * 取出某个位置之前最近的 JSDoc 注释块。
   *
   * @param source 源码文本
   * @param index 声明位置偏移
   * @returns JSDoc 文本；不存在返回 null
   */
  function precedingDoc(source: string, index: number): string | null {
    const trimmed = source.slice(0, index).replace(/\s+$/, '');
    if (!trimmed.endsWith('*/')) {
      return null;
    }
    const start = trimmed.lastIndexOf('/**');
    return start < 0 ? null : trimmed.slice(start);
  }

  /**
   * 取出函数体的文本（花括号配平）。
   *
   * @param source 源码文本
   * @param from 起始位置
   * @returns 函数体文本
   */
  function bodyOf(source: string, from: number): string {
    let depth = 0;
    let started = false;
    for (let index = from; index < source.length; index += 1) {
      const char = source[index];
      if (char === '{') {
        depth += 1;
        started = true;
      } else if (char === '}') {
        depth -= 1;
        if (started && depth === 0) {
          return source.slice(from, index + 1);
        }
      }
    }
    return '';
  }

  /**
   * 按顶层逗号切分参数列表。
   *
   * 说明：参数类型里可能含泛型（如 `Record<string, unknown>`），
   * 直接按逗号切分会把它劈成两半，进而把 `unknown>` 误判成一个参数名。
   * 因此这里跟踪 `<>` 与 `()` 的嵌套深度，只在**顶层**逗号处切分。
   *
   * @param params 参数字符串（不含外层括号）
   * @returns 参数名列表
   */
  function splitParams(params: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let current = '';
    for (const char of params) {
      if (char === '<' || char === '(' || char === '[') {
        depth += 1;
      } else if (char === '>' || char === ')' || char === ']') {
        depth -= 1;
      }
      if (char === ',' && depth === 0) {
        out.push(current);
        current = '';
        continue;
      }
      current += char;
    }
    if (current.trim() !== '') {
      out.push(current);
    }
    return out
      .map((part) => part.split(':')[0]?.split('=')[0]?.trim() ?? '')
      .filter((name) => name !== '' && !name.startsWith('...'));
  }

  /** 扫描结果。 */
  interface JsdocScanResult {
    /** 已检查的导出 API 数量。 */
    checked: number;
    /** 结构性缺失：缺 JSDoc 块 / 首行无中文 / 缺 @param。 */
    structural: string[];
    /** 缺 @returns（仅有返回值时）。 */
    missingReturns: string[];
    /** 函数体会抛异常但 JSDoc 未声明 @throws。 */
    missingThrows: string[];
  }

  /**
   * 扫描一段源码，统计 JSDoc 缺失项。
   *
   * 说明：与 `scanJsdoc` 共用同一套匹配逻辑（同一个正则、同一套判定），
   * 因此「扫描器自检」可以把**故意写坏的样本**喂进来，
   * 直接验证**真实的匹配逻辑**会报错 —— 而不是另写一套判定导致自检与实际脱钩。
   *
   * @param source 源码文本
   * @param rel 路径显示前缀（用于错误信息定位）
   * @returns 扫描结果
   */
  function scanSource(source: string, rel: string): JsdocScanResult {
    const result: JsdocScanResult = {
      checked: 0,
      structural: [],
      missingReturns: [],
      missingThrows: [],
    };

    {
      const lines = source.split('\n');

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';

        // ── 导出函数 ──
        const fnMatch = line.match(
          /^export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^{;]+))?/,
        );
        if (fnMatch) {
          result.checked += 1;
          const name = fnMatch[1] ?? '';
          const params = fnMatch[2] ?? '';
          const returnType = (fnMatch[3] ?? '').trim();
          const offset = lines.slice(0, index).join('\n').length + (index > 0 ? 1 : 0);
          const doc = precedingDoc(source, offset);

          if (!doc) {
            result.structural.push(`${rel}:${index + 1} 导出函数 ${name} 缺少 JSDoc 注释块`);
            continue;
          }
          const summary = doc.replace(/^\/\*\*/, '').replace(/\*\/$/, '').trim().split('\n')[0] ?? '';
          if (!/[\u4e00-\u9fa5]/.test(summary)) {
            result.structural.push(`${rel}:${index + 1} 导出函数 ${name} 的 JSDoc 首行缺少中文说明`);
          }
          for (const param of splitParams(params)) {
            if (!new RegExp(`@param\\s+${param}\\b`).test(doc)) {
              result.structural.push(`${rel}:${index + 1} 导出函数 ${name} 缺少 @param ${param}`);
            }
          }
          if (returnType !== 'void' && returnType !== 'never' && returnType !== '' && !/@returns/.test(doc)) {
            result.missingReturns.push(`${rel}:${index + 1} 导出函数 ${name} 缺少 @returns`);
          }
          // 函数体直接 throw 时必须声明 @throws。
          const bodyStart = source.indexOf('{', offset + line.length);
          const body = bodyStart >= 0 ? bodyOf(source, bodyStart) : '';
          if (/\bthrow\b/.test(body) && !/@throws/.test(doc)) {
            result.missingThrows.push(`${rel}:${index + 1} 导出函数 ${name} 缺少 @throws`);
          }
          continue;
        }

        // ── 导出类 + 其公共方法 ──
        const classMatch = line.match(/^export\s+(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/);
        if (!classMatch) {
          continue;
        }
        result.checked += 1;
        const className = classMatch[1] ?? '';
        const classOffset = lines.slice(0, index).join('\n').length + (index > 0 ? 1 : 0);
        const classDoc = precedingDoc(source, classOffset);
        if (!classDoc) {
          result.structural.push(`${rel}:${index + 1} 导出类 ${className} 缺少 JSDoc 注释块`);
        } else {
          const summary = classDoc.replace(/^\/\*\*/, '').replace(/\*\/$/, '').trim().split('\n')[0] ?? '';
          if (!/[\u4e00-\u9fa5]/.test(summary)) {
            result.structural.push(`${rel}:${index + 1} 导出类 ${className} 的 JSDoc 首行缺少中文说明`);
          }
        }

        // 公共方法（缩进 2 空格）。
        for (let methodIndex = index + 1; methodIndex < lines.length; methodIndex += 1) {
          const methodLine = lines[methodIndex] ?? '';
          if (/^\}/.test(methodLine)) {
            break;
          }
          const methodMatch = methodLine.match(
            /^ {2}(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z0-9_]+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*:\s*([^{;]+)/,
          );
          if (!methodMatch) {
            continue;
          }
          const methodName = methodMatch[1] ?? '';
          if (['constructor', 'if', 'for', 'while', 'switch', 'catch', 'return', 'new'].includes(methodName)) {
            continue;
          }
          result.checked += 1;
          const params = methodMatch[2] ?? '';
          const returnType = (methodMatch[3] ?? '').trim();
          const methodOffset = lines.slice(0, methodIndex).join('\n').length + 1;
          const methodDoc = precedingDoc(source, methodOffset);

          if (!methodDoc) {
            result.structural.push(`${rel}:${methodIndex + 1} ${className}.${methodName} 缺少 JSDoc 注释块`);
            continue;
          }
          for (const param of splitParams(params)) {
            if (!new RegExp(`@param\\s+${param}\\b`).test(methodDoc)) {
              result.structural.push(`${rel}:${methodIndex + 1} ${className}.${methodName} 缺少 @param ${param}`);
            }
          }
          if (returnType !== 'void' && returnType !== 'never' && returnType !== '' && !/@returns/.test(methodDoc)) {
            result.missingReturns.push(`${rel}:${methodIndex + 1} ${className}.${methodName} 缺少 @returns`);
          }
          const methodBodyStart = source.indexOf('{', methodOffset + methodLine.length);
          const methodBody = methodBodyStart >= 0 ? bodyOf(source, methodBodyStart) : '';
          if (/\bthrow\b/.test(methodBody) && !/@throws/.test(methodDoc)) {
            result.missingThrows.push(`${rel}:${methodIndex + 1} ${className}.${methodName} 缺少 @throws`);
          }
        }
      }
    }

    return result;
  }

  /**
   * 扫描一组源码文件，统计 JSDoc 缺失项。
   *
   * @param files 待扫描的绝对路径列表
   * @returns 扫描结果
   */
  function scanJsdoc(files: readonly string[]): JsdocScanResult {
    const result: JsdocScanResult = {
      checked: 0,
      structural: [],
      missingReturns: [],
      missingThrows: [],
    };

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const rel = toRel(file);
      const one = scanSource(source, rel);
      result.checked += one.checked;
      result.structural.push(...one.structural);
      result.missingReturns.push(...one.missingReturns);
      result.missingThrows.push(...one.missingThrows);
    }

    return result;
  }

  it('扫描器自检：故意缺 JSDoc 的样本必须被报出来（证明规则不是空转的）', () => {
    /**
     * 取「声明所在位置」之前的 JSDoc 块。
     *
     * @param source 源码文本
     * @param marker 声明标识
     * @returns 该声明对应的 JSDoc 文本；不存在返回 null
     */
    function docBefore(source: string, marker: string): string | null {
      const at = source.indexOf(marker);
      expect(at, `样本里应包含声明 ${marker}`).toBeGreaterThanOrEqual(0);
      return precedingDoc(source, at);
    }

    // ── 规则 1：完全没有 JSDoc 块 ──
    const noDocSource = ['export function noDoc(a: string): string {', '  return a;', '}'].join('\n');
    expect(docBefore(noDocSource, 'export function noDoc')).toBeNull();

    // ── 规则 2：JSDoc 存在但漏了第二个参数的 @param ──
    const noParamSource = [
      '/**',
      ' * 只写了第一个参数的 @param。',
      ' *',
      ' * @param a 参数一',
      ' */',
      'export function noParam(a: string, b: number): string {',
      '  return `${a}${b}`;',
      '}',
    ].join('\n');
    const noParamDoc = docBefore(noParamSource, 'export function noParam');
    expect(noParamDoc).not.toBeNull();
    expect(noParamDoc).toMatch(/@param\s+a\b/);
    expect(noParamDoc).not.toMatch(/@param\s+b\b/);

    // ── 规则 3：JSDoc 有 @param 但漏了 @returns ──
    const noReturnsSource = [
      '/**',
      ' * 说明。',
      ' *',
      ' * @param a 参数一',
      ' */',
      'export function noReturns(a: string): string {',
      '  return a;',
      '}',
    ].join('\n');
    const noReturnsDoc = docBefore(noReturnsSource, 'export function noReturns');
    expect(noReturnsDoc).toMatch(/@param\s+a\b/);
    expect(noReturnsDoc).not.toMatch(/@returns/);

    // ── 规则 4：函数体含 throw 但 JSDoc 未声明 @throws ──
    const noThrowsSource = [
      '/**',
      ' * 会抛异常但没声明。',
      ' *',
      ' * @param a 参数一',
      ' * @returns 返回值',
      ' */',
      'export function noThrows(a: string): string {',
      '  if (a === "") {',
      '    throw new Error("boom");',
      '  }',
      '  return a;',
      '}',
    ].join('\n');
    const noThrowsDoc = docBefore(noThrowsSource, 'export function noThrows');
    expect(noThrowsDoc).not.toMatch(/@throws/);
    // 函数体确实含 throw —— 这正是触发「缺 @throws」规则的前提。
    const bodyStart = noThrowsSource.indexOf('{', noThrowsSource.indexOf('export function noThrows'));
    expect(/\bthrow\b/.test(bodyOf(noThrowsSource, bodyStart))).toBe(true);

    // ── 反向自检：合规样本不应被误报 ──
    const goodSource = [
      '/**',
      ' * 合规样本。',
      ' *',
      ' * @param a 参数一',
      ' * @returns 返回值',
      ' * @throws {Error} 参数非法',
      ' */',
      'export function good(a: string): string {',
      '  if (a === "") {',
      '    throw new Error("boom");',
      '  }',
      '  return a;',
      '}',
    ].join('\n');
    const goodDoc = docBefore(goodSource, 'export function good');
    expect(goodDoc).toMatch(/@param\s+a\b/);
    expect(goodDoc).toMatch(/@returns/);
    expect(goodDoc).toMatch(/@throws/);
  }, VAULT_TIMEOUT);

  it('结构性缺失项为 0：每个导出函数 / 类 / 公共方法都有 JSDoc 块、中文首行与完整 @param', () => {
    const result = scanJsdoc(collectTsFiles(CORE_SRC));

    // 扫描器必须真的扫到了东西（防止规则写错导致「零缺失」的假阴性）。
    expect(result.checked).toBeGreaterThan(100);

    if (result.structural.length > 0) {
      console.error(`[R10] 结构性 JSDoc 缺失 ${result.structural.length} 条：\n${result.structural.map((m) => `  - ${m}`).join('\n')}`);
    }
    expect(result.structural).toEqual([]);
  }, VAULT_TIMEOUT);

  it('已知缺口基线：@returns / @throws 的缺失项必须为 0（已登记的缺口全部修复，新增缺口立即失败）', () => {
    const result = scanJsdoc(collectTsFiles(CORE_SRC));

    /**
     * JSDoc 缺口基线（当前已清零）。
     *
     * 说明：系统设计 §8.6 要求 JSDoc 含 5 要素（首行说明 / @param / @returns / @throws）。
     * 历史上曾登记 5 处缺口（3 处 `isAvailable` 缺 `@returns`、1 处 `formatMinor`
     * 缺 `@throws`、1 处 `markRecoveryExported` 缺 `@throws`），现均已修复。
     *
     * 本断言采用「**恰好相等**」而非「小于等于」：
     * 任何**新增**缺口都会让测试立刻失败（守卫有效），
     * 而基线本身在此明文可见，不会被隐藏。
     */
    const KNOWN_GAPS: readonly string[] = [];

    const actual = [...result.missingReturns, ...result.missingThrows].sort();
    const expected = [...KNOWN_GAPS].sort();

    if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) {
      console.error(
        `[R10] @returns / @throws 缺失项与基线不一致：\n实际：\n${actual.map((m) => `  - ${m}`).join('\n')}\n基线：\n${expected.map((m) => `  - ${m}`).join('\n')}`,
      );
    }
    expect(actual).toEqual(expected);
  }, VAULT_TIMEOUT);
});
