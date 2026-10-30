#!/usr/bin/env node
/**
 * X-01 ①：加密 / 密钥模块零网络出口静态断言。
 *
 * 扫描范围：packages/core/src/crypto/** 与 packages/core/src/services/**
 * 命中以下任一网络 API 即判定失败：
 *   fetch（含 globalThis.fetch / window.fetch / self.fetch / 裸 fetch）/
 *   XMLHttpRequest / WebSocket / sendBeacon / EventSource / importScripts / navigator.sendBeacon
 *
 * 说明：
 * - 脚本自身位于 scripts/ 目录，不在扫描范围内，避免自匹配；
 * - 扫描前先剥离注释（复制自 `check-compliance.mjs` 的 `stripComments`，二者实现一致），
 *   避免中文 JSDoc 里出现的 "fetch" 造成假阳性（B-5）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCAN_ROOTS = ['packages/core/src/crypto', 'packages/core/src/services'];
const FILE_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs'];

/** 禁止出现的网络出口标识。 */
const FORBIDDEN_PATTERNS = [
  {
    name: 'fetch',
    // `\b` 词边界同时覆盖裸 `fetch(` 与 `globalThis.fetch(` / `window.fetch(` /
    // `self.fetch(` 等成员访问形态，且不会误伤 `myfetch`（无词边界）。
    regex: /\bfetch\s*\(/g,
  },
  { name: 'XMLHttpRequest', regex: /\bXMLHttpRequest\b/g },
  { name: 'WebSocket', regex: /\bWebSocket\b/g },
  { name: 'sendBeacon', regex: /\bsendBeacon\b/g },
  { name: 'EventSource', regex: /\bEventSource\b/g },
  { name: 'importScripts', regex: /\bimportScripts\b/g },
  { name: 'navigator.sendBeacon', regex: /navigator\s*\.\s*sendBeacon/g },
];

/**
 * 剥离源码注释，保留字符串与模板字符串内容。
 *
 * 说明：逐字符状态机，正确处理行注释、块注释、单引号 / 双引号字符串与模板字符串，
 * 避免把字符串里的 `//`（例如 URL）误判成注释起点。实现与 `check-compliance.mjs`
 * 的 `stripComments` 一致，因该文件含顶层 `main()` 副作用、不便 import，故此处内联。
 *
 * @param {string} source 源码文本
 * @returns {string} 去掉注释后的文本（字符串内容原样保留）
 */
function stripComments(source) {
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
 * 递归收集目录下的全部源码文件路径。
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
 * 自检：给定的阳性样本必须全部命中禁止模式，证明正则没有空转、能真正拦住
 * `globalThis.fetch` / `window.fetch` / `self.fetch` 等绕过形态（B-5）。
 *
 * @returns {boolean} 自检是否通过
 */
function selfTest() {
  const positiveSamples = [
    'globalThis.fetch("https://example.com")',
    'window.fetch("https://example.com")',
    'self.fetch("https://example.com")',
    'fetch("https://example.com")',
    'new WebSocket("wss://example.com")',
    'navigator.sendBeacon("https://example.com")',
  ];
  const negativeSamples = [
    // 注释里的 "fetch" 不应被误判（剥离注释后应消失）。
    '// 用 fetch 拉取数据\nconst x = 1;',
    '/* 这里提到 fetch 的 JSDoc */\nconst y = 2;',
    // 词边界内的标识符不应被误判。
    'const myfetch = () => {};',
  ];
  for (const sample of positiveSamples) {
    const stripped = stripComments(sample);
    const hit = FORBIDDEN_PATTERNS.some(({ regex }) => {
      regex.lastIndex = 0;
      return regex.test(stripped);
    });
    if (!hit) {
      console.error(`[自检失败] 阳性样本未被命中：${sample}`);
      return false;
    }
  }
  for (const sample of negativeSamples) {
    const stripped = stripComments(sample);
    const hit = FORBIDDEN_PATTERNS.some(({ regex }) => {
      regex.lastIndex = 0;
      return regex.test(stripped);
    });
    if (hit) {
      console.error(`[自检失败] 阴性样本被误判：${sample}`);
      return false;
    }
  }
  return true;
}

/**
 * 执行静态断言，命中即打印并以非零码退出。
 * @returns {void}
 */
function main() {
  if (!selfTest()) {
    process.exit(1);
  }

  const violations = [];
  let scanned = 0;
  for (const root of SCAN_ROOTS) {
    for (const file of collectFiles(join(REPO_ROOT, root))) {
      scanned += 1;
      const content = stripComments(readFileSync(file, 'utf8'));
      for (const { name, regex } of FORBIDDEN_PATTERNS) {
        regex.lastIndex = 0;
        const matches = content.match(regex);
        if (matches && matches.length > 0) {
          violations.push({ file: relative(REPO_ROOT, file).split(sep).join('/'), name, count: matches.length });
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error('[X-01 ①] 加密 / 密钥模块出现网络出口，违反红线：');
    for (const v of violations) {
      console.error(`  - ${v.file} 命中 ${v.name} × ${v.count}`);
    }
    process.exit(1);
  }
  console.log(`[X-01 ①] 通过：已扫描 ${scanned} 个加密 / 服务层文件，未发现任何网络出口。`);
}

main();