/**
 * QA 独立补测 · 核心层错误处理约定与恢复码格式契约。
 *
 * 覆盖需求：X-03 ④；§8.3 错误处理约定第 1 / 2 条；§3.4 错误码表。
 *
 * 【本文件与工程师自写用例的差异】
 * 工程师的 `tests/unit/recovery-code.test.ts` 验证了 `validateRecoveryCode()` 这个**纯函数**，
 * `tests/integration/vault-unlock.test.ts` 验证了「错误恢复码被拒绝」。
 * 但**两者都没有验证错误码本身**，也没有覆盖系统设计 §3.3 明确写下的契约：
 * > 恢复码格式非法抛 LIFEHUB_E_RECOVERY_INVALID；恢复码不匹配抛 LIFEHUB_E_VAULT_PASSWORD_WRONG。
 *
 * 另外 §8.3 第 1 / 2 条规定「核心层只抛 LifeHubError」「严禁 throw new Error('中文')」，
 * 本文件做源码级断言把这条红线固化下来。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createTestRuntime } from '../helpers/runtime';

/** 核心层源码目录。 */
const CORE_SRC = fileURLToPath(new URL('../../src', import.meta.url));

describe('X-03 ④ · 恢复码格式非法时抛 LIFEHUB_E_RECOVERY_INVALID', () => {
  it('分组数不对的恢复码抛 LIFEHUB_E_RECOVERY_INVALID（§3.3 契约）', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault('test-password-123');

    // 12 组 × 6 字符是合法格式；这里只给 3 组，格式非法。
    await expect(runtime.vault.unlockWithRecoveryCode('ABCDEF-ABCDEF-ABCDEF')).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_RECOVERY_INVALID' }),
    );
  });

  it('含非法字符的恢复码抛 LIFEHUB_E_RECOVERY_INVALID', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault('test-password-123');

    // '0' / '1' / 'I' / 'O' 已被恢复码字符集剔除，出现即为格式非法。
    const illegal = '000000-111111-ABCDEF-ABCDEF-ABCDEF-ABCDEF-ABCDEF-ABCDEF-ABCDEF-ABCDEF-ABCDEF-ABCDEF';
    await expect(runtime.vault.unlockWithRecoveryCode(illegal)).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_RECOVERY_INVALID' }),
    );
  });

  it('组内校验位错误的恢复码抛 LIFEHUB_E_RECOVERY_INVALID（可识别单组笔误）', async () => {
    const runtime = createTestRuntime();
    const setup = await runtime.vault.createVault('test-password-123');

    // 改动第一组的校验位（最后一位），其余保持不变。
    const groups = setup.recoveryBundle.recoveryCode.split('-');
    const first = groups[0] ?? 'AAAAAA';
    groups[0] = `${first.slice(0, 5)}${first.slice(5) === 'A' ? 'B' : 'A'}`;

    await expect(runtime.vault.unlockWithRecoveryCode(groups.join('-'))).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_RECOVERY_INVALID' }),
    );
  });

  it('格式合法但内容错误的恢复码抛 LIFEHUB_E_VAULT_PASSWORD_WRONG', async () => {
    const runtime = createTestRuntime();
    const setup = await runtime.vault.createVault('test-password-123');

    // 只改一个**数据**字符并重算该组校验位 —— 格式合法，内容不匹配。
    const groups = setup.recoveryBundle.recoveryCode.split('-');
    const first = groups[0] ?? 'ABCDEF';
    const flipped = first.slice(0, 5) === 'AAAAA' ? 'B' : 'A';
    groups[0] = `${flipped}${first.slice(1, 5)}`;
    // 重新计算该组校验位，确保格式合法。
    const { computeGroupCheck } = await import('../../src/crypto/recovery-code');
    groups[0] = `${groups[0].slice(0, 5)}${computeGroupCheck(groups[0].slice(0, 5))}`;

    await expect(runtime.vault.unlockWithRecoveryCode(groups.join('-'))).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VAULT_PASSWORD_WRONG' }),
    );
  });
});

describe('§8.3 · 核心层只抛 LifeHubError', () => {
  it('核心层源码中不出现 throw new Error（§8.3 第 2 条）', () => {
    /**
     * 收集目录下的 TypeScript 源文件。
     *
     * @param dir 起始目录
     * @returns 绝对路径列表
     */
    function collect(dir: string): string[] {
      const out: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          out.push(...collect(full));
        } else if (full.endsWith('.ts')) {
          out.push(full);
        }
      }
      return out;
    }

    const violations: string[] = [];
    for (const file of collect(CORE_SRC)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        // 排除注释行与类型声明里的伪命中。
        const trimmed = line.trim();
        if (trimmed.startsWith('*') || trimmed.startsWith('//')) {
          return;
        }
        if (/throw\s+new\s+Error\s*\(/.test(line)) {
          violations.push(`${file.replace(CORE_SRC, 'packages/core/src')}:${index + 1} ${trimmed}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it('非法币种抛 LIFEHUB_E_VALIDATION 而不是原生 Error', () => {
    // 运行时用未受类型系统约束的值触发（模拟来自 JSON / 设置项的外部输入）。
    const { getExponent } = require('../../src/money/currency') as {
      getExponent: (currency: string) => number;
    };
    expect(() => getExponent('USD')).toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  });
});
