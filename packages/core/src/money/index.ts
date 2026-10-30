/**
 * 币种小数位索引常量。
 *
 * 取值依据：PRD Q3 拍板「分为单位整数 + currency 字段；v1 仅 CNY」；
 * 系统设计 §8.2 要求小数位查表而非散落的 if-else，便于后续扩展多币种。
 */
export { CURRENCY_EXPONENT, DEFAULT_CURRENCY, getExponent, isCurrencyCode, minorToDecimal } from './currency';
export type { CurrencyCode } from './currency';
export { detectAmountSign, normalizeAmountText } from './amount-sign';
export type { NormalizedAmountText } from './amount-sign';
export { formatMinor, parseAmountToMinor, sumMinor } from './amount';
export type { ParseAmountOptions } from './amount';
