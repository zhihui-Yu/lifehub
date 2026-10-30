/**
 * 恢复码生成、校验与校验和。
 *
 * 架构位置：core 包「加密层」的恢复模块，服务于 X-03（恢复码 + 盐值备份）。
 *
 * 形态（PRD Q6）：12 组 × 6 字符 Base32，字符集剔除易混字符 I / O / 0 / 1；
 * 每组 5 位随机 + 1 位组内校验位，用于识别单组输入错误（NF-S-8）。
 *
 * 安全约束：恢复码**明文绝不写入本地库**，本地只存 `RecoveryMeta{checksum, exported}`
 * （系统设计 §3.1.4 注释、X-03 ⑤）。
 */
import {
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_GROUP_COUNT,
  RECOVERY_CODE_GROUP_LENGTH,
  RECOVERY_CODE_SEPARATOR,
} from '../constants';
import { LifeHubError } from '../errors';
import { utf8Encode } from '../utils/bytes';
import { sha256Hex } from '../utils/hash';
import type { CryptoProvider } from './provider';

/** 恢复码的规范展示形式，如 'ABCDEF-GHIJKL-MNOPQR-STUVWX-...'。 */
export type RecoveryCode = string;

/** 单组恢复码的解析结果。 */
export interface RecoveryGroup {
  /** 组内 5 位数据字符。 */
  data: string;
  /** 组内校验位字符。 */
  check: string;
}

/**
 * 生成一份随机恢复码。
 *
 * 说明：随机源通过参数注入，便于测试使用确定性随机源；
 * 默认使用 `crypto.getRandomValues`（通过 globalThis 访问，不依赖 DOM 的 `window`）。
 *
 * @param randomBytes 随机字节源，默认使用平台密码学随机源
 * @returns 12 组 × 6 字符的恢复码
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 随机源不可用
 */
export function generateRecoveryCode(
  randomBytes: (length: number) => Uint8Array = defaultRandomBytes,
): RecoveryCode {
  const groups: string[] = [];
  for (let groupIndex = 0; groupIndex < RECOVERY_CODE_GROUP_COUNT; groupIndex += 1) {
    // 每个数据字符取 5 bit，5 个字符 = 25 bit，需要 4 字节随机数（32 bit）后截取。
    const random = randomBytes(4);
    const data: string[] = [];
    let bitBuffer = 0;
    let bitCount = 0;
    for (let charIndex = 0; charIndex < RECOVERY_CODE_GROUP_LENGTH - 1; charIndex += 1) {
      while (bitCount < 5) {
        const byte = random[bitBuffer >> 3] ?? 0;
        bitBuffer = (bitBuffer << 8) | byte;
        bitCount += 8;
      }
      bitCount -= 5;
      const index = (bitBuffer >> bitCount) & 0x1f;
      data.push(RECOVERY_CODE_ALPHABET[index] ?? 'A');
    }
    const dataText = data.join('');
    groups.push(`${dataText}${computeGroupCheck(dataText)}`);
  }
  return groups.join(RECOVERY_CODE_SEPARATOR);
}

/**
 * 计算一组的校验位。
 *
 * 说明：使用带位置权重的模 32 求和，保证字符顺序变化也能被发现；
 * 该校验只用于识别**输入笔误**，不承担密码学强度（真正的强度由整体 checksum 承担）。
 *
 * @param data 组内数据字符（不含校验位）
 * @returns 校验位字符
 */
export function computeGroupCheck(data: string): string {
  let sum = 0;
  for (let index = 0; index < data.length; index += 1) {
    const position = data.charCodeAt(index) - 'A'.charCodeAt(0);
    sum += (position + 1) * (index + 1);
  }
  return RECOVERY_CODE_ALPHABET[sum % RECOVERY_CODE_ALPHABET.length] ?? 'A';
}

/**
 * 把用户输入的恢复码归一化为规范形式。
 *
 * 说明：忽略大小写与空白，把各种分隔符统一为 '-'，
 * 让用户直接粘贴带空格或换行的恢复码也能通过校验。
 *
 * @param raw 用户输入的恢复码
 * @returns 归一化后的恢复码
 */
export function normalizeRecoveryCode(raw: string): RecoveryCode {
  const upper = raw.toUpperCase();
  const withoutSeparators = upper.replace(/[^A-Z0-9]/g, '');
  const groups: string[] = [];
  for (let index = 0; index < withoutSeparators.length; index += RECOVERY_CODE_GROUP_LENGTH) {
    groups.push(withoutSeparators.slice(index, index + RECOVERY_CODE_GROUP_LENGTH));
  }
  return groups.join(RECOVERY_CODE_SEPARATOR);
}

/**
 * 把恢复码拆成若干组。
 *
 * @param code 恢复码（可含任意分隔符与大小写）
 * @returns 分组列表
 */
export function splitRecoveryGroups(code: string): RecoveryGroup[] {
  const normalized = normalizeRecoveryCode(code);
  return normalized
    .split(RECOVERY_CODE_SEPARATOR)
    .filter((group) => group !== '')
    .map((group) => ({
      data: group.slice(0, RECOVERY_CODE_GROUP_LENGTH - 1),
      check: group.slice(RECOVERY_CODE_GROUP_LENGTH - 1),
    }));
}

/**
 * 校验恢复码格式与各组校验位。
 *
 * @param code 用户输入的恢复码
 * @returns 校验通过返回 true
 */
export function validateRecoveryCode(code: string): boolean {
  if (typeof code !== 'string') {
    return false;
  }
  const groups = splitRecoveryGroups(code);
  if (groups.length !== RECOVERY_CODE_GROUP_COUNT) {
    return false;
  }
  return groups.every((group) => {
    if (group.data.length !== RECOVERY_CODE_GROUP_LENGTH - 1) {
      return false;
    }
    if (!/^[A-Z2-9]+$/.test(group.data)) {
      return false;
    }
    // 只允许字符集内的字符（剔除易混字符后的 32 个符号）。
    for (const char of group.data + group.check) {
      if (!RECOVERY_CODE_ALPHABET.includes(char)) {
        return false;
      }
    }
    return computeGroupCheck(group.data) === group.check;
  });
}

/**
 * 校验恢复码，失败时抛出中文异常。
 *
 * @param code 用户输入的恢复码
 * @returns 无异常
 * @throws {LifeHubError} `LIFEHUB_E_RECOVERY_INVALID` —— 恢复码格式或校验位错误
 */
export function assertRecoveryCode(code: string): void {
  if (!validateRecoveryCode(code)) {
    throw new LifeHubError('LIFEHUB_E_RECOVERY_INVALID');
  }
}

/**
 * 计算恢复码的整体校验和。
 *
 * 说明：checksum = sha256(恢复码 + 盐值)，用于把恢复码与具体保险库绑定，
 * 防止「A 保险库的恢复码被用于 B 保险库」这类误用。
 *
 * @param provider 密码学能力端口
 * @param code 恢复码
 * @param salt 盐值字节数组
 * @returns sha256 hex 字符串
 */
export async function computeRecoveryChecksum(
  provider: CryptoProvider,
  code: string,
  salt: Uint8Array,
): Promise<string> {
  const digest = await sha256Hex(provider, concatBytes([utf8Encode(normalizeRecoveryCode(code)), salt]));
  return digest;
}

/**
 * 拼接两个字节数组（局部实现，避免循环依赖）。
 *
 * @param parts 待拼接的字节数组列表
 * @returns 拼接结果
 */
function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) {
    total += part.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * 默认随机字节源：从 globalThis 的密码学随机源取字节。
 *
 * 说明：通过 globalThis 访问而非 `window.crypto`，保持核心层零 DOM 依赖。
 *
 * @param length 字节长度
 * @returns 随机字节数组
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 当前环境没有可用的密码学随机源
 */
export function defaultRandomBytes(length: number): Uint8Array {
  const scope = globalThis as unknown as {
    crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array };
  };
  const source = scope.crypto?.getRandomValues;
  if (!source) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '当前环境没有可用的密码学随机源');
  }
  // 绑定 this：某些实现要求调用者是 crypto 对象本身。
  return source.bind(scope.crypto)(new Uint8Array(length));
}
