/**
 * 恢复码单测。
 *
 * 覆盖需求：X-03、NF-S-8；系统设计 §7 T02 交付内容第 6 条。
 */
import { describe, expect, it } from 'vitest';
import {
  computeGroupCheck,
  computeRecoveryChecksum,
  generateRecoveryCode,
  normalizeRecoveryCode,
  splitRecoveryGroups,
  validateRecoveryCode,
} from '../../src/crypto/recovery-code';
import { WebCryptoProvider } from '../../src/crypto/providers/web-crypto-provider';
import { RECOVERY_CODE_ALPHABET, RECOVERY_CODE_GROUP_COUNT, RECOVERY_CODE_GROUP_LENGTH } from '../../src/constants';

const provider = new WebCryptoProvider();

describe('generateRecoveryCode', () => {
  it('生成 12 组 × 6 字符的恢复码', () => {
    const code = generateRecoveryCode();
    const groups = code.split('-');
    expect(groups).toHaveLength(RECOVERY_CODE_GROUP_COUNT);
    for (const group of groups) {
      expect(group).toHaveLength(RECOVERY_CODE_GROUP_LENGTH);
    }
  });

  it('字符集剔除易混字符 I / O / 0 / 1', () => {
    const code = generateRecoveryCode();
    for (const char of code.replace(/-/g, '')) {
      expect(RECOVERY_CODE_ALPHABET).toContain(char);
      expect('IO01').not.toContain(char);
    }
  });

  it('多次生成结果不同', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateRecoveryCode()));
    expect(codes.size).toBe(50);
  });
});

describe('validateRecoveryCode', () => {
  it('接受自己生成的恢复码', () => {
    expect(validateRecoveryCode(generateRecoveryCode())).toBe(true);
  });

  it('忽略大小写与分隔符差异', () => {
    const code = generateRecoveryCode();
    expect(validateRecoveryCode(code.toLowerCase())).toBe(true);
    expect(validateRecoveryCode(code.replace(/-/g, ' '))).toBe(true);
    expect(validateRecoveryCode(code.replace(/-/g, ''))).toBe(true);
  });

  it('拒绝组数不对的恢复码', () => {
    expect(validateRecoveryCode('ABCDEF-ABCDEF')).toBe(false);
  });

  it('拒绝校验位错误的恢复码', () => {
    const code = generateRecoveryCode();
    const groups = code.split('-');
    const first = groups[0] ?? '';
    const corrupted = `${first.slice(0, -1)}${first.slice(-1) === 'A' ? 'B' : 'A'}`;
    groups[0] = corrupted;
    expect(validateRecoveryCode(groups.join('-'))).toBe(false);
  });

  it('拒绝含非法字符的恢复码', () => {
    expect(validateRecoveryCode('IOIOIO-IOIOIO-IOIOIO-IOIOIO-IOIOIO-IOIOIO-IOIOIO-IOIOIO-IOIOIO-IOIOIO-IOIOIO-IOIOIO')).toBe(false);
  });
});

describe('normalizeRecoveryCode / splitRecoveryGroups', () => {
  it('归一化为规范形式', () => {
    const code = generateRecoveryCode();
    expect(normalizeRecoveryCode(code.toLowerCase().replace(/-/g, ' '))).toBe(code);
  });

  it('拆分为数据位与校验位', () => {
    const groups = splitRecoveryGroups(generateRecoveryCode());
    expect(groups).toHaveLength(RECOVERY_CODE_GROUP_COUNT);
    for (const group of groups) {
      expect(group.data).toHaveLength(RECOVERY_CODE_GROUP_LENGTH - 1);
      expect(computeGroupCheck(group.data)).toBe(group.check);
    }
  });
});

describe('computeRecoveryChecksum', () => {
  it('同一恢复码 + 同一盐值产出相同校验和', async () => {
    const salt = provider.randomBytes(16);
    const code = generateRecoveryCode();
    const a = await computeRecoveryChecksum(provider, code, salt);
    const b = await computeRecoveryChecksum(provider, code, salt);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('不同盐值产出不同校验和', async () => {
    const code = generateRecoveryCode();
    const a = await computeRecoveryChecksum(provider, code, provider.randomBytes(16));
    const b = await computeRecoveryChecksum(provider, code, provider.randomBytes(16));
    expect(a).not.toBe(b);
  });
});
