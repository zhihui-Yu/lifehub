/**
 * 金额文本的符号归一与正负号判定。
 *
 * 架构位置：core 包「金额」模块的底层工具，被 `money/amount.ts`（金额解析）
 * 与 `csv/direction.ts`（收支方向推断）**共用**。
 *
 * 为什么要单独抽一个共享模块：金额的「负号口径」在两处被使用——
 * ① `parseAmountToMinor()` 决定返回值是否为负；
 * ② `DirectionResolver.resolveBySign()` 决定「负号 = 支出」。
 * 两处若各写一套，`￥-35.00` 这类「货币符号在负号之前」的写法就会
 * **一处能认、一处不能认**，出现「金额解析成功但方向判不出」的诡异不一致。
 * 统一到本模块后，两处口径永远一致。
 *
 * 处理顺序（顺序本身就是需求，见系统设计 §7 T02 交付内容 2）：
 * `半角归一 → 剥离货币符号/千分位/空白 → 识别负号 → 校验数字`
 */

/**
 * 常见货币符号与全角字符表。
 *
 * 取值依据：账单导出常见写法包含 '¥'、'￥'、'$'、'RMB'、'CNY' 等，
 * 以及全角数字（１２３）与全角小数点（．）。
 */
const CURRENCY_SYMBOL_PATTERN = /[¥￥$€£]|RMB|CNY|人民币|元|圆/g;

/** 全角数字与全角标点到半角的映射表。 */
const FULL_WIDTH_MAP: Readonly<Record<string, string>> = {
  '０': '0',
  '１': '1',
  '２': '2',
  '３': '3',
  '４': '4',
  '⑤': '5',
  '６': '6',
  '７': '7',
  '８': '8',
  '９': '9',
  '．': '.',
  '，': ',',
  '－': '-',
  '−': '-',
  '（': '(',
  '）': ')',
  '＋': '+',
  '　': ' ',
};

/** 归一化后的金额文本。 */
export interface NormalizedAmountText {
  /** 剥离符号后的数值文本，只含数字与小数点；无法解析时为空串。 */
  digits: string;
  /** 是否为负数（括号负数或前导负号）。 */
  negative: boolean;
  /** 数值文本是否合法（非空、且只由数字与小数点组成）。 */
  valid: boolean;
}

/**
 * 把全角字符转换为半角字符。
 *
 * @param input 原始字符串
 * @returns 仅含半角字符的字符串
 */
function toHalfWidth(input: string): string {
  let out = '';
  for (const ch of input) {
    out += FULL_WIDTH_MAP[ch] ?? ch;
  }
  return out;
}

/**
 * 归一化金额文本并判定其正负号。
 *
 * 说明：处理顺序为「半角归一 → 剥离货币符号与千分位 → 识别负号 → 校验数字」。
 * **必须先剥离货币符号再识别负号**——`￥-35.00 元` 这类写法里负号在货币符号之后，
 * 若先识别负号就看不到 `-`，会被误判为「无法解析为数字」。
 *
 * 支持的负数写法：前导负号（`-35.00`）、括号包裹（`(35.00)`）、
 * 以及二者与货币符号的任意组合（`￥-35.00 元`、`¥(35.00)`）。
 *
 * @param raw 原始金额文本
 * @returns 归一化结果（数值文本 + 负号标记 + 合法性标记）
 */
export function normalizeAmountText(raw: string): NormalizedAmountText {
  if (typeof raw !== 'string') {
    return { digits: '', negative: false, valid: false };
  }
  let text = toHalfWidth(raw).trim();
  if (text === '') {
    return { digits: '', negative: false, valid: false };
  }

  // ① 先剥离货币符号、千分位与空白（顺序理由见函数注释）。
  text = text.replace(CURRENCY_SYMBOL_PATTERN, '').replace(/[\s,]/g, '');

  // ② 再识别负号：括号包裹与前导负号是两种常见写法。
  let negative = false;
  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }

  const valid = text !== '' && text !== '.' && /^\d*(\.\d*)?$/.test(text);
  return { digits: text, negative, valid };
}

/**
 * 判定金额文本的正负号。
 *
 * 说明：与 `parseAmountToMinor()` 共用同一套归一化口径，
 * 因此「能解析出负号」与「能判定为负」永远一致（PRD A-06 ①）。
 *
 * @param raw 原始金额文本
 * @returns 带负号返回 true，明确为正返回 false，无法判断返回 null
 */
export function detectAmountSign(raw: string): boolean | null {
  const normalized = normalizeAmountText(raw);
  if (!normalized.valid) {
    return null;
  }
  return normalized.negative;
}
