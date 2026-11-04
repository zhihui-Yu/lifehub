/**
 * 导入来源渠道。
 *
 * 架构位置：core 包的领域模型层，服务于 A-25（多格式导入）与跨来源去重（A-21 / 用户需求）。
 *
 * 背景：同一笔「用微信 / 支付宝绑定银行卡付款」的交易，会**同时**出现在微信 / 支付宝导出
 * 与银行流水导出里。要判断「这是同一笔、不能重复计入」，必须先知道每条账单来自哪个渠道；
 * 因此把来源渠道作为一等概念沉淀下来，而不是散落在文件名校验里。
 */
/** 合法的导入来源渠道值。 */
export type SourceChannel = 'manual' | 'wechat' | 'alipay' | 'bank' | 'csv' | 'other';

/** 全部合法的来源渠道值。 */
export const SOURCE_CHANNELS: readonly SourceChannel[] = [
  'manual',
  'wechat',
  'alipay',
  'bank',
  'csv',
  'other',
];

/** 来源渠道的中文标签（用于 UI 展示）。 */
export const SOURCE_CHANNEL_LABELS: Readonly<Record<SourceChannel, string>> = {
  manual: '手动录入',
  wechat: '微信支付',
  alipay: '支付宝',
  bank: '银行流水',
  csv: '通用 CSV',
  other: '其它来源',
};

/**
 * 判断未知值是否为合法来源渠道。
 *
 * @param value 待判定的未知值
 * @returns 合法来源渠道返回 true
 */
export function isSourceChannel(value: unknown): value is SourceChannel {
  return typeof value === 'string' && (SOURCE_CHANNELS as readonly string[]).includes(value);
}

/**
 * 根据文件名推断来源渠道。
 *
 * 说明：微信 / 支付宝的官方导出文件名通常含「微信」「支付宝」「wechat」「alipay」；
 * 银行流水（含 PDF 与 Excel）通常含「银行」「bank」或 `TRANS_DETAIL` 之类字样。
 * 推断失败时回落到扩展名：`.pdf` / 含银行关键字 → 银行；`.csv` → 通用 CSV；
 * 其余（含 `.xlsx`）回落到 `other`，由上层按表头进一步识别。
 *
 * @param fileName 源文件名（含扩展名）
 * @returns 推断出的来源渠道
 */
export function classifySourceChannel(fileName: string): SourceChannel {
  const name = fileName.toLowerCase();
  if (name.includes('微信') || name.includes('wechat') || name.includes('weixin')) {
    return 'wechat';
  }
  if (name.includes('支付宝') || name.includes('alipay')) {
    return 'alipay';
  }
  if (name.endsWith('.pdf')) {
    return 'bank';
  }
  if (
    name.includes('银行') ||
    name.includes('bank') ||
    name.includes('cib') ||
    name.includes('trans_detail')
  ) {
    return 'bank';
  }
  if (name.endsWith('.csv')) {
    return 'csv';
  }
  return 'other';
}
