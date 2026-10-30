#!/usr/bin/env node
/**
 * 合规静态断言总入口（X-05 / X-06 / X-15 的自动化部分）。
 *
 * 检查项：
 *  1. R1  packages/core 零 DOM（无 window / document / localStorage / indexedDB）
 *  2. R2  packages/core 依赖不含 React / MUI / Dexie / 统计 SDK
 *  3. R6  全仓无采集调用（定位 / 麦克风 / 设备序列号 / 电池等）
 *  4. R7  源码不含银行 / 支付平台开放接口域名
 *  5. X-06 全仓依赖树不含任何埋点 / 统计 / 广告 SDK
 *  6. R8  源码不含「找回密码 / 客服解封 / 后门恢复」类文案
 *
 * 关键实现说明：
 * - **扫描前先剥离注释**：R1 允许在中文 JSDoc 里提到 `window` 这类词
 *   （例如「不依赖 DOM 的 `window`」），因此必须只对**真实代码**做匹配；
 *   剥离逻辑见 `stripComments`，它是一个逐字符状态机，能正确跳过字符串与模板字符串。
 * - **依赖匹配按包名而非整份文本**：锁文件里出现过 `es-set-tostringtag` 这类
 *   与统计 SDK 毫无关系的包名，整份文本做子串匹配会产生误报；
 *   这里改为解析锁文件的 `packages` 段取**包名**，再与黑名单做精确 / 前缀比较。
 *
 * 说明：扫描范围为各包的 src/ 目录与 package.json；docs/ 与 scripts/ 不在扫描范围内（避免自匹配）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.jsx'];

/** 核心层禁止出现的 DOM / 浏览器存储标识（R1）。 */
const CORE_DOM_PATTERNS = [
  { name: 'window', regex: /(?<![.\w])window\s*[.(\[]/g },
  { name: 'document', regex: /(?<![.\w])document\s*[.(\[]/g },
  { name: 'localStorage', regex: /\blocalStorage\b/g },
  { name: 'sessionStorage', regex: /\bsessionStorage\b/g },
  { name: 'indexedDB', regex: /\bindexedDB\b/g },
  { name: 'navigator', regex: /(?<![.\w])navigator\s*[.(\[]/g },
  // 通过 globalThis 绕道访问 DOM 同样属于违规，因此一并拦截。
  { name: 'globalThis.window', regex: /globalThis\s*\.\s*window\b/g },
  { name: 'globalThis.document', regex: /globalThis\s*\.\s*document\b/g },
  { name: 'globalThis.localStorage', regex: /globalThis\s*\.\s*localStorage\b/g },
];

/** 全仓禁止出现的采集类 API（R6 / X-05）。 */
const COLLECTION_PATTERNS = [
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
  { name: 'contacts', regex: /\bContactsManager\b/g },
];

/** 禁止出现的银行 / 支付平台开放接口域名（R7）。 */
const FORBIDDEN_DOMAINS = [
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

/** 禁止出现的埋点 / 统计 / 广告 SDK（X-06）。 */
const FORBIDDEN_SDKS = [
  'sentry',
  'amplitude',
  'mixpanel',
  'google-analytics',
  'gtag',
  'ga.js',
  'umeng',
  '友盟',
  'tongji',
  'baidu',
  'hotjar',
  'clarity',
  'datadog',
  'posthog',
  'bugsnag',
  'rollbar',
  'segment',
  'fullstory',
  'logrocket',
  'apm',
];

/** 核心层禁止依赖的包（R2）。 */
const CORE_FORBIDDEN_DEPS = [
  'react',
  'react-dom',
  'react-router-dom',
  '@mui/material',
  '@emotion/react',
  'dexie',
  'axios',
  'papaparse',
  'moment',
  'dayjs',
  'date-fns',
  'lodash',
];

/** 禁止出现的「找回密码 / 客服解封 / 后门恢复」类文案（R8）。 */
const FORBIDDEN_COPY = [
  '找回密码',
  '客服解封',
  '后门恢复',
  '一键找回',
  '人工解锁',
];

/**
 * 匹配器的自检样本：这些包名**必须**被识别为统计 SDK。
 *
 * 作用：保证「按包名精确匹配」没有把规则的严格性削弱掉——
 * 一旦真的引入埋点 SDK，脚本必须立刻报错。
 */
const SDK_MUST_MATCH = [
  'sentry',
  '@sentry/browser',
  '@sentry/node',
  'amplitude',
  'mixpanel',
  'mixpanel-browser',
  'google-analytics',
  'gtag',
  '@google-analytics/gtag',
  'baidu',
  'hotjar',
  'datadog',
  'posthog',
  'bugsnag',
  'rollbar',
  'segment',
  'fullstory',
  'logrocket',
];

/**
 * 匹配器的自检样本：这些包名**不应**被误判为统计 SDK。
 *
 * 说明：`es-set-tostringtag` / `has-tostringtag` 只是名字里碰巧含有 "gtag"，
 * 与统计 SDK 毫无关系，正是过去误报的来源。
 */
const SDK_MUST_NOT_MATCH = [
  'es-set-tostringtag',
  'has-tostringtag',
  'string-width',
  'postcss',
  'autoprefixer',
  'typescript',
  'vitest',
  '@lifehub/core',
  '@lifehub/web',
];

/**
 * 判断一个依赖包名是否命中统计 SDK 黑名单。
 *
 * 匹配规则（**按包名**，不做整份文本子串匹配）：
 * 1. 包名整体等于黑名单项（忽略大小写）；
 * 2. scoped 包的「去掉 scope 后的名字」等于黑名单项（`@sentry/browser` → `sentry`）；
 * 3. 包名以「黑名单项 + `/`」开头（子路径导入）；
 * 4. 包名以「黑名单项 + `-`」开头（`mixpanel-browser` → `mixpanel`）。
 *
 * @param {string} packageName 依赖包名
 * @param {string} sdk 黑名单项
 * @returns {boolean} 命中返回 true
 */
export function matchesForbiddenSdk(packageName, sdk) {
  const name = String(packageName).toLowerCase();
  const target = String(sdk).toLowerCase();
  if (name === target) {
    return true;
  }
  // scoped 包：'@scope/name' → 'scope'；'@scope/name/sub' → 'scope'。
  const base = name.startsWith('@') ? (name.split('/')[0] ?? '').replace(/^@/, '') : name;
  if (base === target) {
    return true;
  }
  if (name.startsWith(`${target}/`)) {
    return true;
  }
  if (name.startsWith(`${target}-`)) {
    return true;
  }
  return false;
}

/**
 * 剥离源码中的注释，只保留真实代码。
 *
 * 说明：逐字符状态机，正确处理行注释、块注释、单引号 / 双引号字符串与模板字符串，
 * 避免把字符串里的 `//`（例如 URL）误判成注释起点。
 *
 * @param {string} source 源码文本
 * @returns {string} 去掉注释后的文本（字符串内容原样保留）
 */
export function stripComments(source) {
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

/**
 * 递归收集目录下的源码文件。
 * @param {string} dir 起始目录
 * @returns {string[]} 绝对路径列表
 */
function collectFiles(dir) {
  const out = [];
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage') {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full));
    } else if (FILE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 读取指定 package.json 的依赖声明。
 * @param {string} relPath 相对仓库根的路径
 * @returns {{dependencies: string[], devDependencies: string[]}}
 */
function readDeps(relPath) {
  try {
    const raw = JSON.parse(readFileSync(join(REPO_ROOT, relPath), 'utf8'));
    return {
      dependencies: Object.keys(raw.dependencies ?? {}),
      devDependencies: Object.keys(raw.devDependencies ?? {}),
    };
  } catch {
    return { dependencies: [], devDependencies: [] };
  }
}

/**
 * 解析锁文件，取出全部依赖包名。
 *
 * 说明：只取 `packages` 段里 `node_modules/` 之后的真实包名，
 * 避免把 workspace 自身的路径（'packages/core'）当成依赖。
 *
 * @returns {string[]} 包名列表
 */
function collectLockPackageNames() {
  try {
    const raw = JSON.parse(readFileSync(join(REPO_ROOT, 'package-lock.json'), 'utf8'));
    const names = new Set();
    for (const key of Object.keys(raw.packages ?? {})) {
      const marker = 'node_modules/';
      const at = key.lastIndexOf(marker);
      if (at >= 0) {
        names.add(key.slice(at + marker.length));
      }
    }
    return [...names];
  } catch {
    // 尚未生成锁文件时跳过（npm install 后会重新校验）。
    return [];
  }
}

/**
 * 执行全部合规断言。
 * @returns {void}
 */
function main() {
  const violations = [];
  const coreSrc = join(REPO_ROOT, 'packages/core/src');
  const allSrcFiles = [
    ...collectFiles(coreSrc),
    ...collectFiles(join(REPO_ROOT, 'apps/web/src')),
  ];

  // 0) 匹配器自检：保证「按包名匹配」没有削弱规则的严格性。
  for (const name of SDK_MUST_MATCH) {
    const hit = FORBIDDEN_SDKS.some((sdk) => matchesForbiddenSdk(name, sdk));
    if (!hit) {
      violations.push(`[X-06] 自检失败：统计 SDK「${name}」未被识别，请检查匹配规则`);
    }
  }
  for (const name of SDK_MUST_NOT_MATCH) {
    const hit = FORBIDDEN_SDKS.some((sdk) => matchesForbiddenSdk(name, sdk));
    if (hit) {
      violations.push(`[X-06] 自检失败：普通依赖「${name}」被误判为统计 SDK`);
    }
  }

  // 1) R1：核心层零 DOM（先剥离注释，只匹配真实代码）。
  for (const file of collectFiles(coreSrc)) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const { name, regex } of CORE_DOM_PATTERNS) {
      const hits = code.match(regex);
      if (hits && hits.length > 0) {
        violations.push(`[R1] 核心层出现 DOM 标识 ${name}：${toRel(file)}`);
      }
    }
  }

  // 2) R6 / R8：全仓采集调用与禁用文案
  for (const file of allSrcFiles) {
    const content = readFileSync(file, 'utf8');
    for (const { name, regex } of COLLECTION_PATTERNS) {
      const hits = content.match(regex);
      if (hits && hits.length > 0) {
        violations.push(`[X-05] 出现采集类调用 ${name}：${toRel(file)}`);
      }
    }
    for (const phrase of FORBIDDEN_COPY) {
      if (content.includes(phrase)) {
        violations.push(`[R8] 出现禁用文案「${phrase}」：${toRel(file)}`);
      }
    }
    for (const domain of FORBIDDEN_DOMAINS) {
      if (content.includes(domain)) {
        violations.push(`[R7] 出现银行 / 支付平台域名 ${domain}：${toRel(file)}`);
      }
    }
  }

  // 3) R2：核心层依赖白名单
  const coreDeps = readDeps('packages/core/package.json');
  for (const dep of [...coreDeps.dependencies, ...coreDeps.devDependencies]) {
    if (CORE_FORBIDDEN_DEPS.includes(dep)) {
      violations.push(`[R2] packages/core 依赖了禁止的包：${dep}`);
    }
  }

  // 4) X-06：全仓依赖树不含统计 SDK（按包名精确 / 前缀匹配）。
  const packageFiles = [
    'package.json',
    'packages/core/package.json',
    'apps/web/package.json',
    'apps/sync-server/package.json',
  ];
  for (const pkg of packageFiles) {
    const deps = readDeps(pkg);
    for (const dep of [...deps.dependencies, ...deps.devDependencies]) {
      for (const sdk of FORBIDDEN_SDKS) {
        if (matchesForbiddenSdk(dep, sdk)) {
          violations.push(`[X-06] ${pkg} 依赖了统计 / 广告 SDK：${dep}`);
        }
      }
    }
  }

  // 5) X-06：锁文件层面再查一次（覆盖传递依赖，同样按包名匹配）。
  const lockPackages = collectLockPackageNames();
  for (const name of lockPackages) {
    for (const sdk of FORBIDDEN_SDKS) {
      if (matchesForbiddenSdk(name, sdk)) {
        violations.push(`[X-06] package-lock.json 中的依赖 ${name} 命中统计 / 广告 SDK：${sdk}`);
      }
    }
  }

  if (violations.length > 0) {
    console.error('[合规检查] 未通过，命中以下问题：');
    for (const v of violations) {
      console.error(`  - ${v}`);
    }
    process.exit(1);
  }
  console.log(
    `[合规检查] 通过：已扫描 ${allSrcFiles.length} 个源码文件、${packageFiles.length} 份 package.json 与 ` +
      `${lockPackages.length} 个锁文件依赖包名，未发现采集调用、统计 SDK、银行域名、核心层 DOM 依赖或禁用文案。`,
  );
}

/**
 * 把绝对路径转成相对仓库根的 POSIX 风格路径。
 * @param {string} file 绝对路径
 * @returns {string}
 */
function toRel(file) {
  return relative(REPO_ROOT, file).split(sep).join('/');
}

main();
