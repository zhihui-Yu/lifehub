/**
 * AI 分析层发送前本地脱敏管线（模块 E：X-14）。
 *
 * 架构位置：apps/web 的「AI 分析模块」隐私脱敏层。
 *
 * 核心安全红线（X-14）：
 * 1. **金额分桶（Bucketize）**：将精确 `amountMinor`（整数分）映射为粗粒度区间描述
 *    （`0–50 元`、`50–100 元`、`100–500 元`、`500–1000 元`、`1000 元以上`），
 *    严禁在脱敏载荷或 Prompt 中出现精确分值（如 `7340`）或精确元值（如 `73.40`）；
 * 2. **交易对手泛化（Generalize）**：按首次出现顺序将真实 `counterparty` 映射为匿名代号
 *    （`商户 A`、`商户 B`、`商户 C`……），并彻底剥离原始 `note` / `sourceFileName` 等敏感备注；
 * 3. **时间粒度粗化（Coarsen）**：将具体日历日 `YYYY-MM-DD` 粗化为月份粒度 `YYYY-MM`，
 *    不暴露具体交易日期与精确时刻。
 */
import type { Bill } from '@lifehub/core';
import type { DecryptedDiaryEntry } from '@/modules/diary/diary-service';

/**
 * 单条树洞日记脱敏后的安全记录（已抹除手机号、邮箱、身份证号、银行卡号及精确日期）。
 */
export interface RedactedDiaryRecord {
  /** 粗化后的月份标识 'YYYY-MM'。 */
  yearMonth: string;
  /** 心情标签（如 '平静'）。 */
  moodLabel: string;
  /** 标签数组。 */
  tags: string[];
  /** 本地正则脱敏后的摘要文本。 */
  sanitizedExcerpt: string;
}

/**
 * 用户手动勾选参与 AI 分析的树洞脱敏摘要（模块 D：D-03）。
 */
export interface RedactedDiarySummary {
  /** 勾选参与分析的树洞条数。 */
  selectedCount: number;
  /** 脱敏后文本总字符长度（供发送前向用户展示）。 */
  sanitizedCharLength: number;
  /** 心情频次统计。 */
  moodDistribution: Record<string, number>;
  /** 脱敏后的树洞条目列表。 */
  items: RedactedDiaryRecord[];
}

/** 脱敏金额分桶标签。 */
export type AmountBucketLabel =
  | '0–50 元'
  | '50–100 元'
  | '100–500 元'
  | '500–1000 元'
  | '1000 元以上';

/**
 * 单笔账单脱敏后的安全记录（不含任何原始商户名、备注、精确金额或具体日）。
 */
export interface RedactedBillRecord {
  /** 粗化后的月份标识 'YYYY-MM'。 */
  yearMonth: string;
  /** 收支方向。 */
  direction: Bill['direction'];
  /** 分类名称（如「餐饮美食」「交通出行」）。 */
  categoryName: string;
  /** 金额区间分桶描述（如 '50–100 元'）。 */
  amountBucket: AmountBucketLabel;
  /** 泛化后的匿名交易对手代号（如 '商户 A'）。 */
  merchantAlias: string;
}

/**
 * 账单集合脱敏后的聚合摘要结果（供 Prompt 构造与发送前预览使用）。
 */
export interface RedactedBillSummary {
  /** 参与脱敏的账单总笔数。 */
  totalCount: number;
  /** 支出账单笔数。 */
  expenseCount: number;
  /** 收入账单笔数。 */
  incomeCount: number;
  /** 涵盖的月份列表（升序 'YYYY-MM'）。 */
  months: string[];
  /** 各金额分桶的账单笔数分布。 */
  bucketDistribution: Record<AmountBucketLabel, number>;
  /** 各分类的账单笔数分布。 */
  categoryDistribution: Record<string, number>;
  /** 泛化后的独立匿名商户总数。 */
  merchantAliasCount: number;
  /** 脱敏后的单笔样本列表（已抹除敏感字段）。 */
  items: RedactedBillRecord[];
}

/**
 * 将整数分（`amountMinor`）映射为粗粒度金额区间标签（X-14）。
 *
 * 说明：
 * - `< 5000`（50 元以下） -> `'0–50 元'`
 * - `5000 .. 9999`（50 至 100 元） -> `'50–100 元'`
 * - `10000 .. 49999`（100 至 500 元） -> `'100–500 元'`
 * - `50000 .. 99999`（500 至 1000 元） -> `'500–1000 元'`
 * - `>= 100000`（1000 元及以上） -> `'1000 元以上'`
 *
 * @param amountMinor 账单金额（整数分）
 * @returns 脱敏后的金额区间描述
 * @throws 无
 */
export function bucketAmountMinor(amountMinor: number): AmountBucketLabel {
  const absMinor = Math.abs(Math.trunc(amountMinor));
  if (absMinor < 5_000) {
    return '0–50 元';
  }
  if (absMinor < 10_000) {
    return '50–100 元';
  }
  if (absMinor < 50_000) {
    return '100–500 元';
  }
  if (absMinor < 100_000) {
    return '500–1000 元';
  }
  return '1000 元以上';
}

/**
 * 将序号（0 起）转换为字母序列代号（0 -> '商户 A', 25 -> '商户 Z', 26 -> '商户 AA'）。
 *
 * @param index 0 起始的商户序号
 * @returns 泛化后的商户代号
 * @throws 无
 */
export function buildMerchantAlias(index: number): string {
  let n = Math.max(0, Math.trunc(index));
  let letters = '';
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `商户 ${letters}`;
}

/**
 * 将本地日历日 `'YYYY-MM-DD'` 粗化为月份粒度 `'YYYY-MM'`（X-14）。
 *
 * @param localDate 原始本地日历日字符串
 * @returns 粗化后的 `'YYYY-MM'` 字符串
 * @throws 无
 */
export function coarsenToYearMonth(localDate: string): string {
  const trimmed = (localDate || '').trim();
  const match = /^(\d{4}-\d{2})/.exec(trimmed);
  if (match && match[1]) {
    return match[1];
  }
  return '未知月份';
}

/**
 * 读取分类映射表中的分类名称。
 *
 * @param categoryId 分类 ID
 * @param categoryMap 可选的分类名称映射（Map 或普通对象）
 * @returns 安全的分类名称
 */
function resolveCategoryName(
  categoryId: string | null | undefined,
  categoryMap?: ReadonlyMap<string, string> | Record<string, string>,
): string {
  if (!categoryId) {
    return '未分类';
  }
  if (!categoryMap) {
    return '已分类';
  }
  if (categoryMap instanceof Map) {
    return categoryMap.get(categoryId) ?? '未分类';
  }
  const recordMap = categoryMap as Record<string, string>;
  return recordMap[categoryId] ?? '未分类';
}

/**
 * 对账单列表执行发送前全量脱敏（X-14）。
 *
 * 说明：
 * - 遍历账单执行金额分桶、交易对手泛化与日期粗化到月；
 * - 彻底丢弃 `id`、`amountMinor`、`counterparty`、`note`、`localDate`、`occurredAt`、`sourceFileName`；
 * - 序列化后的返回值绝不包含任何原始商户名、原始备注或精确金额。
 *
 * @param bills 原始账单列表
 * @param categoryMap 可选的分类 ID 到分类名称映射
 * @returns 脱敏后的账单聚合摘要 `RedactedBillSummary`
 * @throws 无
 */
export function redactBillsForAi(
  bills: readonly Bill[],
  categoryMap?: ReadonlyMap<string, string> | Record<string, string>,
): RedactedBillSummary {
  const bucketDistribution: Record<AmountBucketLabel, number> = {
    '0–50 元': 0,
    '50–100 元': 0,
    '100–500 元': 0,
    '500–1000 元': 0,
    '1000 元以上': 0,
  };
  const categoryDistribution: Record<string, number> = {};
  const monthSet = new Set<string>();
  const counterpartyToAlias = new Map<string, string>();

  let expenseCount = 0;
  let incomeCount = 0;
  const items: RedactedBillRecord[] = [];

  for (const bill of bills) {
    const yearMonth = coarsenToYearMonth(bill.localDate);
    monthSet.add(yearMonth);

    const amountBucket = bucketAmountMinor(bill.amountMinor);
    bucketDistribution[amountBucket] += 1;

    const categoryName = resolveCategoryName(bill.categoryId, categoryMap);
    categoryDistribution[categoryName] = (categoryDistribution[categoryName] ?? 0) + 1;

    const rawMerchant = (bill.counterparty || '').trim();
    let merchantAlias = '匿名商户';
    if (rawMerchant.length > 0) {
      const existingAlias = counterpartyToAlias.get(rawMerchant);
      if (existingAlias) {
        merchantAlias = existingAlias;
      } else {
        merchantAlias = buildMerchantAlias(counterpartyToAlias.size);
        counterpartyToAlias.set(rawMerchant, merchantAlias);
      }
    }

    if (bill.direction === 'expense') {
      expenseCount += 1;
    } else if (bill.direction === 'income') {
      incomeCount += 1;
    }

    items.push({
      yearMonth,
      direction: bill.direction,
      categoryName,
      amountBucket,
      merchantAlias,
    });
  }

  return {
    totalCount: bills.length,
    expenseCount,
    incomeCount,
    months: Array.from(monthSet).sort((a, b) => a.localeCompare(b)),
    bucketDistribution,
    categoryDistribution,
    merchantAliasCount: counterpartyToAlias.size,
    items,
  };
}

const MOOD_TEXT_MAP: Record<string, string> = {
  calm: '平静',
  happy: '开心',
  focused: '专注',
  tired: '疲惫',
  anxious: '焦虑',
  grateful: '感恩',
};

/**
 * 对自由文本执行本地敏感信息脱敏（移除手机号、身份证号、银行卡号、邮箱与精确金额数字）。
 *
 * @param raw 原始文本
 * @returns 脱敏后的安全文本
 */
export function sanitizeFreeTextForAi(raw: string): string {
  return (raw || '')
    .replace(/\b1[3-9]\d{9}\b/g, '[手机号已脱敏]')
    .replace(/\b\d{15,19}\b/g, '[卡号/证件号已脱敏]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[邮箱已脱敏]')
    .replace(/¥\s*\d+(?:\.\d+)?|\d+\.\d{1,2}\s*元/g, '[具体金额已脱敏]')
    .trim();
}

/**
 * 对用户手动勾选的树洞记录执行发送前本地脱敏（模块 D：D-03）。
 *
 * @param entries 用户勾选的解密后树洞记录
 * @returns 脱敏后的树洞摘要 `RedactedDiarySummary`
 */
export function redactDiaryEntriesForAi(
  entries: readonly DecryptedDiaryEntry[],
): RedactedDiarySummary {
  const moodDistribution: Record<string, number> = {};
  const items: RedactedDiaryRecord[] = [];
  let sanitizedCharLength = 0;

  for (const entry of entries) {
    const yearMonth = coarsenToYearMonth(entry.localDate);
    const moodLabel = entry.mood ? (MOOD_TEXT_MAP[entry.mood] ?? '日常') : '日常';
    moodDistribution[moodLabel] = (moodDistribution[moodLabel] ?? 0) + 1;

    const combinedText = [entry.title, entry.body].filter(Boolean).join('：');
    const sanitized = sanitizeFreeTextForAi(combinedText).slice(0, 160);
    sanitizedCharLength += sanitized.length;

    items.push({
      yearMonth,
      moodLabel,
      tags: entry.tags.slice(0, 5),
      sanitizedExcerpt: sanitized,
    });
  }

  return {
    selectedCount: entries.length,
    sanitizedCharLength,
    moodDistribution,
    items,
  };
}
