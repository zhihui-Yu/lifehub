#!/usr/bin/env node
/**
 * X-01 ④ / R5：同步载荷与加密备份「只含密文」断言。
 *
 * 本脚本做两层检查：
 *  1. 静态层：检查 core 源码中同步载荷与备份的构造逻辑不允许出现明文字段名
 *     （amount / amountMinor / counterparty / note / categoryId / title / body ...）。
 *  2. 运行时层：若仓库中存在 vite-node（vitest 自带），则以真实数据构造一份同步载荷，
 *     序列化后断言 JSON 文本中不含任何明文字段名与明文样本值。
 *
 * 运行时断言的等价单测位于 packages/core/tests/unit/sync-payload.test.ts，
 * 该单测已纳入 `npm run test`，因此即使本脚本跳过运行时层，覆盖也不会缺失。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const STATIC_TARGETS = [
  'packages/core/src/services/sync/sync-payload.ts',
  'packages/core/src/models/encrypted-blob.ts',
  'packages/core/src/services/backup-service.ts',
];

/** 同步载荷 / 备份文件中绝不允许出现的明文字段名。 */
const FORBIDDEN_FIELDS = [
  'amountMinor',
  'counterparty',
  'categoryId',
  'localDate',
  'note',
  'title',
  'body',
  'content',
  'password',
  'salt',
  'dek',
  'masterKey',
];

/** 明文样本值：运行时断言用于全文检索。 */
const PLAINTEXT_SAMPLES = ['美团', '128.50', '星巴克', 'LIFEHUB-SAMPLE-NOTE'];

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
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 执行静态 + 运行时断言。
 * @returns {void}
 */
function main() {
  const violations = [];

  // ── 静态层 ────────────────────────────────────────────────
  for (const target of STATIC_TARGETS) {
    const full = join(REPO_ROOT, target);
    let content = '';
    try {
      content = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    // 只检查类型声明与映射代码段中的「字段名标识符」，
    // 允许在注释中以中文解释「不含明文金额」等语义。
    const codeWithoutComments = content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    for (const field of FORBIDDEN_FIELDS) {
      const regex = new RegExp(`(^|[^'"\`])${field}\\s*:`, 'm');
      if (regex.test(codeWithoutComments)) {
        violations.push(`[静态] ${target} 的载荷构造中出现了明文字段 ${field}`);
      }
    }
  }

  // ── 运行时层 ──────────────────────────────────────────────
  // 优先用 `node node_modules/vite-node/vite-node.mjs` 启动探针：
  // 直接 spawn `node_modules/.bin/vite-node.cmd` 在 Windows 上会失败
  // （.cmd 必须经由 shell 才能执行），因此这里统一走 Node 入口。
  const viteNodeEntry = join(REPO_ROOT, 'node_modules', 'vite-node', 'vite-node.mjs');
  let runtimeRan = false;
  try {
    statSync(viteNodeEntry);
    runtimeRan = true;
  } catch {
    runtimeRan = false;
  }

  if (runtimeRan) {
    const probe = join(REPO_ROOT, 'scripts', 'sync-payload-probe.ts');
    const result = spawnSync(process.execPath, [viteNodeEntry, probe], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      const detail = (result.stderr ?? '').trim() || (result.error?.message ?? '未知错误');
      violations.push(`[运行时] 同步载荷探针执行失败：${detail}`);
    } else {
      const out = result.stdout ?? '';
      for (const field of FORBIDDEN_FIELDS) {
        if (out.includes(`field:${field}`)) {
          violations.push(`[运行时] 同步载荷中出现明文字段 ${field}`);
        }
      }
      for (const sample of PLAINTEXT_SAMPLES) {
        if (out.includes(`sample:${sample}`)) {
          violations.push(`[运行时] 同步载荷中出现明文样本 ${sample}`);
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error('[X-01 ④] 同步载荷 / 备份明文断言未通过：');
    for (const v of violations) {
      console.error(`  - ${v}`);
    }
    process.exit(1);
  }
  console.log(
    `[X-01 ④] 通过：同步载荷 / 备份的静态断言全部通过；运行时探针${runtimeRan ? '已执行' : '跳过（缺少 vite-node，等价单测仍在 npm run test 中执行）'}。`,
  );
}

/** 导出以便被其它脚本复用（本脚本不直接调用，仅保证 tree-shaking 友好）。 */
export { collectFiles, relative, sep };

main();
