#!/usr/bin/env node
/**
 * X-01 ①：加密 / 密钥模块零网络出口静态断言。
 *
 * 扫描范围：packages/core/src/crypto/** 与 packages/core/src/services/**
 * 命中以下任一网络 API 即判定失败：
 *   fetch / XMLHttpRequest / WebSocket / sendBeacon / EventSource / importScripts / navigator.sendBeacon
 *
 * 说明：脚本自身位于 scripts/ 目录，不在扫描范围内，避免自匹配。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCAN_ROOTS = ['packages/core/src/crypto', 'packages/core/src/services'];
const FILE_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs'];

/** 禁止出现的网络出口标识。 */
const FORBIDDEN_PATTERNS = [
  { name: 'fetch', regex: /(?<![.\w])fetch\s*\(/g },
  { name: 'XMLHttpRequest', regex: /\bXMLHttpRequest\b/g },
  { name: 'WebSocket', regex: /\bWebSocket\b/g },
  { name: 'sendBeacon', regex: /\bsendBeacon\b/g },
  { name: 'EventSource', regex: /\bEventSource\b/g },
  { name: 'importScripts', regex: /\bimportScripts\b/g },
  { name: 'navigator.sendBeacon', regex: /navigator\s*\.\s*sendBeacon/g },
];

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
 * 执行静态断言，命中即打印并以非零码退出。
 * @returns {void}
 */
function main() {
  const violations = [];
  let scanned = 0;
  for (const root of SCAN_ROOTS) {
    for (const file of collectFiles(join(REPO_ROOT, root))) {
      scanned += 1;
      const content = readFileSync(file, 'utf8');
      for (const { name, regex } of FORBIDDEN_PATTERNS) {
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
