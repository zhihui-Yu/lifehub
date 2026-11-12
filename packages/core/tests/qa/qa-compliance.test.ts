/**
 * QA 独立补测 · R1 零 DOM 与架构红线静态核验。
 *
 * 覆盖需求：R1 零 DOM；R2 依赖纯净；R3 加密零网络出口；R6 无采集调用；
 * R7 无外部域名；R8 无后门文案；A-01 ①②③；X-08 ①②③。
 *
 * 【本文件与既有脚本的差异】
 * `scripts/check-compliance.mjs` 已做同类扫描。本文件的价值在于：
 * 1. **在测试体系内**固化这些红线（脚本不被 CI 调用时仍有回归保护）；
 * 2. 额外验证 `globalThis` 用法在 **Node 环境真实可用**（主理人特别点名：
 *    「注意 `globalThis` 的用法是否真的等价可用」）——
 *    即核心层在纯 Node（无 jsdom、无 window）下确实能跑通加密链路；
 * 3. 额外核验 core 的 `tsconfig` 确实不含 DOM lib、依赖确实不含 React / MUI / Dexie。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WebCryptoProvider } from '../../src/crypto/providers/web-crypto-provider';
import { CryptoService } from '../../src/crypto/service';

/** 仓库根目录（由本文件位置向上三级推导）。 */
const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/** 核心层源码目录。 */
const CORE_SRC = join(REPO_ROOT, 'packages/core/src');

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
    } else if (full.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 剥离源码中的注释，只保留真实代码。
 *
 * 说明：与 `scripts/check-compliance.mjs` 的实现思路一致——
 * 注释里提到 `window` 是允许的（R1 只约束**真实代码**），
 * 因此必须先把注释去掉再匹配。
 *
 * @param source 源码文本
 * @returns 去掉注释后的文本
 */
function stripComments(source: string): string {
  let out = '';
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') {
        index += 1;
      }
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        if (source[index] === '\n') {
          out += '\n';
        }
        index += 1;
      }
      index += 2;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      out += char;
      index += 1;
      while (index < source.length) {
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

describe('R1 · 核心层零 DOM（A-01 ①② / X-08 ①）', () => {
  it('核心层真实代码中不出现 window / document / localStorage / navigator / sessionStorage / indexedDB', () => {
    const forbidden: { name: string; regex: RegExp }[] = [
      // 说明：字符类里 `(` 与 `.` 无需转义；`[` 必须写成 `\[`，
      // 否则会被解析成正则的字符类起始符，语义从「匹配一个字符」变成「开启字符类」。
      { name: 'window', regex: /(?<![.\w])window\s*[.([]/g },
      { name: 'document', regex: /(?<![.\w])document\s*[.([]/g },
      { name: 'localStorage', regex: /\blocalStorage\b/g },
      { name: 'sessionStorage', regex: /\bsessionStorage\b/g },
      { name: 'indexedDB', regex: /\bindexedDB\b/g },
      { name: 'navigator', regex: /(?<![.\w])navigator\s*[.([]/g },
      { name: 'globalThis.window', regex: /globalThis\s*\.\s*window\b/g },
      { name: 'globalThis.document', regex: /globalThis\s*\.\s*document\b/g },
      { name: 'globalThis.localStorage', regex: /globalThis\s*\.\s*localStorage\b/g },
    ];

    const violations: string[] = [];
    for (const file of collectTsFiles(CORE_SRC)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const { name, regex } of forbidden) {
        if (regex.test(code)) {
          violations.push(`${file} 命中 ${name}`);
          regex.lastIndex = 0;
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('核心层 tsconfig 的 lib 不含 DOM / DOM.Iterable（A-01 ②）', () => {
    const tsconfig = readFileSync(join(REPO_ROOT, 'packages/core/tsconfig.json'), 'utf8');
    expect(tsconfig).toContain('"ES2022"');
    // lib 里不得出现 DOM。
    const libMatch = tsconfig.match(/"lib"\s*:\s*\[([^\]]*)\]/);
    expect(libMatch).not.toBeNull();
    expect(libMatch?.[1]).not.toContain('DOM');
  });

  it('核心层 package.json 依赖不含 React / MUI / Dexie 等浏览器专有依赖（A-01 ③ / R2）', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'packages/core/package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = Object.keys(pkg.dependencies ?? {});
    for (const forbidden of ['react', 'react-dom', '@mui/material', 'dexie', 'papaparse', 'axios']) {
      expect(deps).not.toContain(forbidden);
    }
    // 只允许两个 @noble/* 密码学库。
    expect(deps.sort()).toEqual(['@noble/ciphers', '@noble/hashes']);
  });

  it('核心层不直接 import node:crypto（只允许 ./node 子路径的 provider）', () => {
    const offenders: string[] = [];
    for (const file of collectTsFiles(CORE_SRC)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (/from\s+['"]node:/.test(code) && !file.endsWith('node-crypto-provider.ts')) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('核心层不直接 import node:fs / node:path 等 Node 专有 API', () => {
    const offenders: string[] = [];
    for (const file of collectTsFiles(CORE_SRC)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (/from\s+['"]node:(fs|path|os|url|child_process|http|https)['"]/.test(code)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('R1 · globalThis 用法在纯 Node 环境真实可用', () => {
  it('当前测试环境没有 window / document（证明核心层跑在纯 Node 上）', () => {
    const scope = globalThis as unknown as { window?: unknown; document?: unknown };
    expect(scope.window).toBeUndefined();
    expect(scope.document).toBeUndefined();
  });

  it('globalThis.crypto 存在且 WebCryptoProvider 通过 globalThis 取到密码学能力', () => {
    const scope = globalThis as unknown as { crypto?: { subtle?: unknown; getRandomValues?: unknown } };
    expect(scope.crypto).toBeDefined();
    expect(scope.crypto?.subtle).toBeDefined();
    expect(scope.crypto?.getRandomValues).toBeDefined();

    const provider = new WebCryptoProvider();
    expect(provider.isAvailable).toBe(true);
    expect(provider.randomBytes(16)).toHaveLength(16);
  });

  it('globalThis.crypto 路径产出的密文可被正常解密（与 window.crypto 等价可用）', async () => {
    const provider = new WebCryptoProvider();
    const crypto = new CryptoService(provider);
    const key = provider.randomBytes(32);

    const payload = await crypto.encryptRecord(key, 'bill', 'bill-1', 1, { amountMinor: 1234 });
    await expect(crypto.decryptRecord(key, 'bill', 'bill-1', 1, payload)).resolves.toEqual({
      amountMinor: 1234,
    });
  });
});

describe('R3 · 加密与服务层零网络出口（X-01 ①）', () => {
  it('crypto/** 与 services/** 内不出现 fetch / XHR / WebSocket / sendBeacon / EventSource', () => {
    const forbidden: { name: string; regex: RegExp }[] = [
      { name: 'fetch', regex: /(?<![.\w])fetch\s*\(/g },
      { name: 'XMLHttpRequest', regex: /\bXMLHttpRequest\b/g },
      { name: 'WebSocket', regex: /\bWebSocket\b/g },
      { name: 'sendBeacon', regex: /\bsendBeacon\b/g },
      { name: 'EventSource', regex: /\bEventSource\b/g },
    ];

    const roots = [join(CORE_SRC, 'crypto'), join(CORE_SRC, 'services')];
    const violations: string[] = [];
    for (const root of roots) {
      for (const file of collectTsFiles(root)) {
        const code = stripComments(readFileSync(file, 'utf8'));
        for (const { name, regex } of forbidden) {
          if (regex.test(code)) {
            violations.push(`${file} 命中 ${name}`);
            regex.lastIndex = 0;
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('R6 / R7 / R8 · 全仓合规红线（X-05 / X-06）', () => {
  it('核心层与 Web 层不出现采集类 API 调用（定位 / 麦克风 / 设备序列号 / 电池 / 通讯录）', () => {
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
    ];

    const roots = [CORE_SRC, join(REPO_ROOT, 'apps/web/src')];
    const violations: string[] = [];
    for (const root of roots) {
      for (const file of collectTsFiles(root)) {
        const code = stripComments(readFileSync(file, 'utf8'));
        for (const { name, regex } of collectionPatterns) {
          if (regex.test(code)) {
            violations.push(`${file} 命中 ${name}`);
            regex.lastIndex = 0;
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('源码中不出现银行 / 支付平台开放接口域名（X-05 ② / R7）', () => {
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
    const roots = [CORE_SRC, join(REPO_ROOT, 'apps/web/src'), join(REPO_ROOT, 'apps/sync-server/src')];
    const violations: string[] = [];
    for (const root of roots) {
      for (const file of collectTsFiles(root)) {
        const content = readFileSync(file, 'utf8');
        for (const domain of domains) {
          if (content.includes(domain)) {
            violations.push(`${file} 含域名 ${domain}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('源码中不出现「找回密码 / 客服解封 / 后门恢复」类文案（X-02 ④ / R8）', () => {
    const phrases = ['找回密码', '客服解封', '后门恢复', '一键找回', '人工解锁'];
    const roots = [CORE_SRC, join(REPO_ROOT, 'apps/web/src'), join(REPO_ROOT, 'apps/sync-server/src')];
    const violations: string[] = [];
    for (const root of roots) {
      for (const file of collectTsFiles(root)) {
        const content = readFileSync(file, 'utf8');
        for (const phrase of phrases) {
          if (content.includes(phrase)) {
            violations.push(`${file} 含文案「${phrase}」`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('依赖树中不含任何埋点 / 统计 / 广告 SDK（X-06 ①）', () => {
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
  });

  it('Web 端页面不含未授权外部请求，且 CSP 限定 connect-src（X-06 ② / R7）', () => {
    const roots = [join(REPO_ROOT, 'apps/web/src')];
    const allowedSuffixes = [
      'src/modules/ai/ai-client.ts',
      'src/lib/cloud-storage.ts',
      'src/utils/download.ts',
    ];
    const networkPatterns: { name: string; regex: RegExp }[] = [
      { name: 'fetch', regex: /(?<![.\w])fetch\s*\(/g },
      { name: 'XMLHttpRequest', regex: /\bXMLHttpRequest\b/g },
      { name: 'WebSocket', regex: /\bWebSocket\b/g },
      { name: 'sendBeacon', regex: /\bsendBeacon\b/g },
      { name: 'EventSource', regex: /\bEventSource\b/g },
    ];
    const violations: string[] = [];
    for (const root of roots) {
      for (const file of collectTsFiles(root)) {
        const normalized = file.replace(/\\/g, '/');
        if (allowedSuffixes.some((suffix) => normalized.endsWith(suffix))) continue;
        const code = stripComments(readFileSync(file, 'utf8'));
        for (const { name, regex } of networkPatterns) {
          if (regex.test(code)) {
            violations.push(`${file} 命中 ${name}`);
            regex.lastIndex = 0;
          }
        }
      }
    }
    expect(violations).toEqual([]);

    // index.html 必须带 CSP 且 connect-src 为 'self'。
    const html = readFileSync(join(REPO_ROOT, 'apps/web/index.html'), 'utf8');
    expect(html).toContain('Content-Security-Policy');
    expect(html).toMatch(/connect-src\s+'self'/);
  });
});

describe('R5 · 同步服务只存密文（X-01 ③）', () => {
  it('同步服务源码中不出现 salt / DEK / 主口令等敏感材料字段的存储', () => {
    // 说明：服务端已重构为多文件结构（server / store / validation / auth / config），
    // 因此这里扫描**整个 src 目录**而不是单个文件，
    // 避免「密钥逻辑被挪到另一个文件就绕过检查」。
    const syncServerSrc = join(REPO_ROOT, 'apps/sync-server/src');
    const sources = collectTsFiles(syncServerSrc).map((file) => ({
      file,
      content: readFileSync(file, 'utf8'),
    }));

    for (const { file, content } of sources) {
      // 允许在**黑名单常量**里出现这些名字（用于拒绝它们），
      // 但不允许出现真正持有密钥的代码路径。
      expect(content, `${file} 不得出现 scrypt`).not.toMatch(/scrypt/i);
      expect(content, `${file} 不得出现加解密原语`).not.toMatch(/createCipheriv|createDecipheriv/i);
      expect(content, `${file} 不得出现解密调用`).not.toMatch(/decrypt\s*\(/i);
      // 服务端不得读取任何环境变量形式的密钥。
      expect(content, `${file} 不得读取密钥类环境变量`).not.toMatch(
        /process\.env\[.*(KEY|SECRET|PASSWORD|SALT)/i,
      );
    }
  });

  it('同步服务的落盘结构只含密文字段', () => {
    // 说明：`StoredBlob` 接口随重构迁到了 `store.ts`（存储层），
    // 这里同时扫 `store.ts` 与 `server.ts`：
    // 前者确保**表结构**只有密文字段，后者确保 **HTTP 层**没有偷藏明文字段。
    const storedBlobSource = readFileSync(join(REPO_ROOT, 'apps/sync-server/src/store.ts'), 'utf8');
    const serverSource = readFileSync(join(REPO_ROOT, 'apps/sync-server/src/server.ts'), 'utf8');

    // StoredBlob 接口必须只有密文与元信息字段。
    const interfaceMatch = storedBlobSource.match(/export interface StoredBlob \{([\s\S]*?)\n\}/);
    expect(interfaceMatch).not.toBeNull();
    const body = interfaceMatch?.[1] ?? '';
    for (const field of ['ciphertext', 'iv', 'tag', 'algorithm', 'keyVersion']) {
      expect(body).toContain(field);
    }
    for (const field of ['amountMinor', 'counterparty', 'note', 'salt', 'dek', 'masterKey']) {
      expect(body).not.toContain(field);
    }

    // HTTP 层不得出现任何明文业务字段名。
    for (const field of ['amountMinor', 'counterparty', 'note', 'salt', 'dek', 'masterKey']) {
      expect(serverSource, `server.ts 不得出现明文字段 ${field}`).not.toContain(field);
    }
  });
});
