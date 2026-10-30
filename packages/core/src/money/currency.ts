import { LifeHubError } from '../errors';

/**
 * 币种与小数位表。
 *
 * 架构位置：core 包的「值对象」模块，被 models / csv / services 共同引用。
 * 取值依据：PRD Q3「分为单位整数 + currency 字段；v1 仅 CNY」，
 * 同时预留 JPY（0 位小数）与 KWD（3 位小数），后续新增币种只改本表。
 */

/**
 * 币种小数位表：键为 ISO 4217 货币代码，值为该货币的最小单位指数。
 *
 * v1 仅 CNY=2 实际生效；JPY / KWD 为预留位（A-06 ④ 假设 AS-6「汇率与多币种本期不需要」）。
 */
export const CURRENCY_EXPONENT = {
  CNY: 2,
  JPY: 0,
  KWD: 3,
} as const;

/** 支持的币种代码联合类型。 */
export type CurrencyCode = keyof typeof CURRENCY_EXPONENT;

/** 本轮默认币种。 */
export const DEFAULT_CURRENCY: CurrencyCode = 'CNY';

/**
 * 取币种的小数位指数。
 *
 * @param currency ISO 4217 货币代码，如 'CNY'
 * @returns 小数位指数，CNY 为 2、JPY 为 0、KWD 为 3
 * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 币种代码不在支持列表中
 */
export function getExponent(currency: CurrencyCode): number {
  const exponent = CURRENCY_EXPONENT[currency];
  if (exponent === undefined) {
    // 核心层只抛 LifeHubError（系统设计 §8.3），UI 层按 code 分支处理。
    throw new LifeHubError('LIFEHUB_E_VALIDATION', `不支持的币种：${String(currency)}`);
  }
  return exponent;
}

/**
 * 类型守卫：判断未知值是否为受支持的币种代码。
 *
 * @param value 待判定的未知值
 * @returns 是受支持的币种代码时返回 true
 */
export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CURRENCY_EXPONENT, value);
}

/**
 * 把整数最小单位金额换算为该币种下的十进制数。
 *
 * 仅用于展示与图表取值，**禁止把返回值写回存储**（系统设计 §8.2）。
 *
 * @param amountMinor 以最小单位（分）计的整数金额
 * @param currency 币种代码，默认 CNY
 * @returns 十进制数值
 */
export function minorToDecimal(amountMinor: number, currency: CurrencyCode = DEFAULT_CURRENCY): number {
  return amountMinor / 10 ** getExponent(currency);
}
