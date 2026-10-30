/**
 * 金额解析与格式化。
 *
 * 架构位置：core 包「值对象」模块，是 CSV 导入与账单落库之间唯一的金额入口。
 *
 * 核心红线（系统设计 §1.2 难点 2、A-02）：
 * 1. 存储一律使用「分」为单位的整数 `amountMinor`；
 * 2. 解析**全程不经过 parseFloat**，因为 0.1 + 0.2 !== 0.3 的浮点误差
 *    会让账单求和与真实账目对不上；
 * 3. `formatMinor` 的返回值只用于渲染，禁止回写存储。
 */
import { LifeHubError } from '../errors';
import { normalizeAmountText } from './amount-sign';
import { CurrencyCode, DEFAULT_CURRENCY, getExponent } from './currency';

/** 金额解析选项。 */
export interface ParseAmountOptions {
  /** 币种，决定小数位位数，默认 CNY（2 位）。 */
  currency?: CurrencyCode;
  /** 是否允许负数，默认 false（账单金额恒为正，方向由 direction 表达）。 */
  allowNegative?: boolean;
}

/**
 * 解析金额字符串为「分」单位的整数。
 *
 * 说明：全程使用字符串切分，不经过 parseFloat，避免浮点误差；
 * 支持千分位、货币符号、全角数字、括号负数等常见账单写法。
 *
 * 负号的识别口径与 `csv/direction.ts` 的方向推断**共用** `normalizeAmountText()`：
 * 剥离货币符号在先、识别负号在后，因此 `￥-35.00 元` / `¥-35.00` 这类
 * 「货币符号在负号之前」的写法也能正确识别（系统设计 §7 T02 交付内容 2）。
 *
 * @param raw 原始金额字符串，如 '1,234.56'、'¥12.34'、'￥-35.00 元'、'（35.00）'
 * @param options 解析选项；`currency` 决定小数位（默认 CNY=2）；`allowNegative` 允许负号（默认 false）
 * @returns 以分为单位的整数，如 123456
 * @throws {LifeHubError} `LIFEHUB_E_AMOUNT_INVALID` —— 字符串无法解析为合法金额
 */
export function parseAmountToMinor(raw: string, options?: ParseAmountOptions): number {
  const currency = options?.currency ?? DEFAULT_CURRENCY;
  const allowNegative = options?.allowNegative ?? false;
  const exponent = getExponent(currency);

  if (typeof raw !== 'string') {
    throw new LifeHubError('LIFEHUB_E_AMOUNT_INVALID');
  }

  // 归一化：半角化 → 剥离货币符号 / 千分位 / 空白 → 识别负号 → 校验数字。
  // 顺序由 normalizeAmountText() 统一维护，解析与方向推断共用同一口径。
  const normalized = normalizeAmountText(raw);
  if (!normalized.valid) {
    throw new LifeHubError('LIFEHUB_E_AMOUNT_INVALID');
  }
  const text = normalized.digits;

  const [intPart = '', fracPart = ''] = text.split('.');
  if (fracPart.length > exponent) {
    // 小数位超出该币种精度：属于无法无损表示的金额，直接判为非法而不是静默截断。
    throw new LifeHubError('LIFEHUB_E_AMOUNT_INVALID');
  }

  // 用字符串补零对齐小数位，再拼成「分」的十进制字符串，避免任何浮点参与。
  const paddedFrac = fracPart.padEnd(exponent, '0');
  const digits = `${intPart === '' ? '0' : intPart}${paddedFrac}`;
  const value = Number.parseInt(digits, 10);

  if (!Number.isSafeInteger(value)) {
    throw new LifeHubError('LIFEHUB_E_AMOUNT_INVALID');
  }
  // 负号只在 `allowNegative` 打开时保留；否则视为「金额不可为负」直接判非法。
  if (normalized.negative && !allowNegative) {
    throw new LifeHubError('LIFEHUB_E_AMOUNT_INVALID');
  }
  return normalized.negative ? -value : value;
}

/**
 * 把「分」单位的整数格式化为十进制字符串。
 *
 * 说明：仅用于渲染展示，**禁止把返回值写回存储**（系统设计 §8.2 约定）。
 *
 * @param amountMinor 以分为单位的整数金额
 * @param currency 币种，决定小数位，默认 CNY
 * @returns 十进制字符串，如 '1234.56'；负数带前置 '-'
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 金额不是整数分
 */
export function formatMinor(amountMinor: number, currency: CurrencyCode = DEFAULT_CURRENCY): string {
  if (!Number.isInteger(amountMinor)) {
    throw new LifeHubError('LIFEHUB_E_VALIDATION', '金额必须是整数分');
  }
  const exponent = getExponent(currency);
  const negative = amountMinor < 0;
  const digits = Math.abs(amountMinor).toString().padStart(exponent + 1, '0');
  const intPart = digits.slice(0, digits.length - exponent);
  const fracPart = exponent > 0 ? digits.slice(digits.length - exponent) : '';
  const body = exponent > 0 ? `${intPart}.${fracPart}` : intPart;
  return negative ? `-${body}` : body;
}

/**
 * 整数分求和。
 *
 * 说明：全部参与项必须是整数分，逐项累加，全程零浮点。
 *
 * @param values 待求和的整数分数组
 * @returns 求和结果（整数分）
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 存在非整数或超出安全整数范围的元素
 */
export function sumMinor(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value)) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', '金额必须是整数分');
    }
    total += value;
    if (!Number.isSafeInteger(total)) {
      throw new LifeHubError('LIFEHUB_E_VALIDATION', '金额合计超出安全整数范围');
    }
  }
  return total;
}
