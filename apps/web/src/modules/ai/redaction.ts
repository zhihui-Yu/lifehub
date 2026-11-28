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
 * 用户范围内的树洞脱敏全量摘要（模块 D：D-03）。
 */
export interface RedactedDiarySummary {
  /** 参与分析的树洞总条数。 */
  selectedCount: number;
  /** 脱敏后文本总字符长度（供发送前向用户展示）。 */
  sanitizedCharLength: number;
  /** 心情频次统计（100% 覆盖全部树洞条目）。 */
  moodDistribution: Record<string, number>;
  /** 高频话题标签统计（100% 覆盖全部树洞条目）。 */
  tagDistribution: Record<string, number>;
  /** 按月树洞记录篇数分布。 */
  monthlyCountDistribution: Record<string, number>;
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

/** 单个月份的全量收支聚合摘要（X-14 粗化区间，不含单笔精确金额）。 */
export interface RedactedMonthlyBillStat {
  /** 月份标识 'YYYY-MM'。 */
  yearMonth: string;
  /** 当月支出笔数。 */
  expenseCount: number;
  /** 当月支出粗化区间（如 '3000–3500 元'）。 */
  expenseRange: string;
  /** 当月收入笔数。 */
  incomeCount: number;
  /** 当月收入粗化区间。 */
  incomeRange: string;
  /** 当月收支结余状态描述（如 '正向结余（储蓄率约 35%）' 或 '支出大于收入'）。 */
  balanceStatus: string;
  /** 当月支出占比最高的前 3 个分类概览。 */
  topExpenseCategories: string[];
}

/** 单个分类的全量聚合摘要（按实际金额权重排序，而非仅看笔数）。 */
export interface RedactedCategoryStat {
  /** 分类名称。 */
  categoryName: string;
  /** 收支方向。 */
  direction: 'expense' | 'income';
  /** 交易笔数。 */
  count: number;
  /** 占同方向总金额的百分比（0..100 整数）。 */
  amountSharePercent: number;
  /** 该分类累计金额粗化区间（如 '1500–2000 元'）。 */
  amountRange: string;
  /** 该分类内最高频的金额分桶。 */
  dominantBucket: AmountBucketLabel;
}

/** 高频或高金额占比匿名商户聚合画像。 */
export interface RedactedMerchantStat {
  /** 匿名商户代号（如 '商户 A'）。 */
  merchantAlias: string;
  /** 主要分类名称。 */
  primaryCategory: string;
  /** 累计支出笔数。 */
  expenseCount: number;
  /** 占总支出的百分比（0..100 整数）。 */
  expenseSharePercent: number;
  /** 累计支出粗化区间。 */
  expenseRange: string;
}

/**
 * 账单集合脱敏后的全量聚合摘要结果（100% 账单纳入统计，零截断失真，同时严守 X-14 隐私红线）。
 */
export interface RedactedBillSummary {
  /** 参与脱敏的账单总笔数。 */
  totalCount: number;
  /** 支出账单笔数。 */
  expenseCount: number;
  /** 收入账单笔数。 */
  incomeCount: number;
  /** 不计收支/转账等中性流水笔数。 */
  neutralCount: number;
  /** 总支出粗化金额区间（如 '3000–3500 元'）。 */
  totalExpenseRange: string;
  /** 总收入粗化金额区间。 */
  totalIncomeRange: string;
  /** 周期整体结余与储蓄率概览。 */
  overallBalanceSummary: string;
  /** 涵盖的月份列表（升序 'YYYY-MM'）。 */
  months: string[];
  /** 全量分桶分布（兼容旧字段）。 */
  bucketDistribution: Record<AmountBucketLabel, number>;
  /** 仅支出账单的金额分桶笔数分布。 */
  expenseBucketDistribution: Record<AmountBucketLabel, number>;
  /** 仅收入账单的金额分桶笔数分布。 */
  incomeBucketDistribution: Record<AmountBucketLabel, number>;
  /** 各分类的账单笔数分布（兼容旧字段）。 */
  categoryDistribution: Record<string, number>;
  /** 按实际支出金额权重降序排列的全量支出分类结构。 */
  expenseCategoryStats: RedactedCategoryStat[];
  /** 按实际收入金额权重降序排列的全量收入分类结构。 */
  incomeCategoryStats: RedactedCategoryStat[];
  /** 按月收支趋势全表（覆盖周期内每一个月）。 */
  monthlyStats: RedactedMonthlyBillStat[];
  /** 高支出占比 / 高频匿名商户 Top 15 画像。 */
  topMerchants: RedactedMerchantStat[];
  /** 泛化后的独立匿名商户总数。 */
  merchantAliasCount: number;
  /** 分层抽样的代表性脱敏样本列表（优先保留中大额异常与跨月均衡样本，不含敏感字段）。 */
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
 * 将累计整数分（`totalMinor`）粗化为阶梯区间描述（X-14）：
 * 仅输出 50/100/500/0.5万 整数倍区间，绝不暴露任何单笔或汇总精确分值/元值，同时保留真实消费体量级供 AI 准确研判。
 */
export function coarsenAggregateMinorToRange(totalMinor: number): string {
  const absMinor = Math.abs(Math.trunc(totalMinor));
  if (absMinor === 0) {
    return '0 元';
  }
  const yuan = absMinor / 100;
  if (yuan < 50) {
    return '0–50 元';
  }
  if (yuan < 100) {
    return '50–100 元';
  }
  if (yuan < 1000) {
    const low = Math.floor(yuan / 100) * 100;
    return `${low}–${low + 100} 元`;
  }
  if (yuan < 10000) {
    const low = Math.floor(yuan / 500) * 500;
    return `${low}–${low + 500} 元`;
  }
  const halfWanSteps = Math.floor(yuan / 5000);
  const formatWan = (steps: number): string => {
    const val = steps * 0.5;
    return Number.isInteger(val) ? String(val) : val.toFixed(1);
  };
  return `${formatWan(halfWanSteps)}–${formatWan(halfWanSteps + 1)} 万元`;
}

function createEmptyBucketDist(): Record<AmountBucketLabel, number> {
  return {
    '0–50 元': 0,
    '50–100 元': 0,
    '100–500 元': 0,
    '500–1000 元': 0,
    '1000 元以上': 0,
  };
}

function summarizeBalanceStatus(incomeMinor: number, expenseMinor: number): string {
  if (incomeMinor <= 0 && expenseMinor <= 0) {
    return '无收支流水';
  }
  if (incomeMinor <= 0 && expenseMinor > 0) {
    return '仅记录支出（未导入收入流水）';
  }
  if (expenseMinor <= 0 && incomeMinor > 0) {
    return '仅记录收入（正向净流入）';
  }
  const netMinor = incomeMinor - expenseMinor;
  if (netMinor >= 0) {
    const savingRate = Math.round((netMinor / incomeMinor) * 100);
    return `正向结余（约 ${coarsenAggregateMinorToRange(netMinor)}，储蓄率约 ${savingRate}%）`;
  }
  const deficitRate = Math.round((Math.abs(netMinor) / incomeMinor) * 100);
  return `支出超出收入（逆差约 ${coarsenAggregateMinorToRange(Math.abs(netMinor))}，超支约 ${deficitRate}%）`;
}

/**
 * 对账单列表执行发送前全量脱敏与多维结构化聚合（X-14）。
 *
 * 说明：
 * - 100% 遍历全部账单计算按月收支趋势、分类金额占比、商户集中度与收支独立分桶，彻底解决「只截取 20 条样本导致 AI 盲人摸象」的问题；
 * - 彻底丢弃 `id`、`amountMinor`、`counterparty`、`note`、`localDate`、`occurredAt`、`sourceFileName`；
 * - 序列化后的返回值绝不包含任何原始商户名、原始备注、具体日期或精确金额。
 *
 * @param bills 原始账单列表
 * @param categoryMap 可选的分类 ID 到分类名称映射
 * @returns 脱敏后的账单全量聚合摘要 `RedactedBillSummary`
 * @throws 无
 */
export function redactBillsForAi(
  bills: readonly Bill[],
  categoryMap?: ReadonlyMap<string, string> | Record<string, string>,
): RedactedBillSummary {
  const bucketDistribution = createEmptyBucketDist();
  const expenseBucketDistribution = createEmptyBucketDist();
  const incomeBucketDistribution = createEmptyBucketDist();
  const categoryDistribution: Record<string, number> = {};
  const monthSet = new Set<string>();
  const counterpartyToAlias = new Map<string, string>();

  let expenseCount = 0;
  let incomeCount = 0;
  let neutralCount = 0;
  let totalExpenseMinor = 0;
  let totalIncomeMinor = 0;

  interface CatAcc {
    count: number;
    minorSum: number;
    buckets: Record<AmountBucketLabel, number>;
  }
  const expenseCatMap = new Map<string, CatAcc>();
  const incomeCatMap = new Map<string, CatAcc>();

  interface MonthAcc {
    expenseCount: number;
    expenseMinor: number;
    incomeCount: number;
    incomeMinor: number;
    expenseByCat: Map<string, number>;
  }
  const monthAccMap = new Map<string, MonthAcc>();

  interface MerchantAcc {
    alias: string;
    expenseCount: number;
    expenseMinor: number;
    catMinor: Map<string, number>;
  }
  const merchantAccMap = new Map<string, MerchantAcc>();

  const highValueRecords: RedactedBillRecord[] = [];
  const regularRecordsByMonth = new Map<string, RedactedBillRecord[]>();

  for (const bill of bills) {
    const yearMonth = coarsenToYearMonth(bill.localDate);
    monthSet.add(yearMonth);

    const absMinor = Math.abs(Math.trunc(bill.amountMinor));
    const amountBucket = bucketAmountMinor(absMinor);
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

    let mAcc = monthAccMap.get(yearMonth);
    if (!mAcc) {
      mAcc = {
        expenseCount: 0,
        expenseMinor: 0,
        incomeCount: 0,
        incomeMinor: 0,
        expenseByCat: new Map(),
      };
      monthAccMap.set(yearMonth, mAcc);
    }

    if (bill.direction === 'expense') {
      expenseCount += 1;
      totalExpenseMinor += absMinor;
      expenseBucketDistribution[amountBucket] += 1;
      mAcc.expenseCount += 1;
      mAcc.expenseMinor += absMinor;
      mAcc.expenseByCat.set(categoryName, (mAcc.expenseByCat.get(categoryName) ?? 0) + absMinor);

      let cAcc = expenseCatMap.get(categoryName);
      if (!cAcc) {
        cAcc = { count: 0, minorSum: 0, buckets: createEmptyBucketDist() };
        expenseCatMap.set(categoryName, cAcc);
      }
      cAcc.count += 1;
      cAcc.minorSum += absMinor;
      cAcc.buckets[amountBucket] += 1;

      if (merchantAlias !== '匿名商户') {
        let mer = merchantAccMap.get(merchantAlias);
        if (!mer) {
          mer = { alias: merchantAlias, expenseCount: 0, expenseMinor: 0, catMinor: new Map() };
          merchantAccMap.set(merchantAlias, mer);
        }
        mer.expenseCount += 1;
        mer.expenseMinor += absMinor;
        mer.catMinor.set(categoryName, (mer.catMinor.get(categoryName) ?? 0) + absMinor);
      }
    } else if (bill.direction === 'income') {
      incomeCount += 1;
      totalIncomeMinor += absMinor;
      incomeBucketDistribution[amountBucket] += 1;
      mAcc.incomeCount += 1;
      mAcc.incomeMinor += absMinor;

      let cAcc = incomeCatMap.get(categoryName);
      if (!cAcc) {
        cAcc = { count: 0, minorSum: 0, buckets: createEmptyBucketDist() };
        incomeCatMap.set(categoryName, cAcc);
      }
      cAcc.count += 1;
      cAcc.minorSum += absMinor;
      cAcc.buckets[amountBucket] += 1;
    } else {
      neutralCount += 1;
    }

    const rec: RedactedBillRecord = {
      yearMonth,
      direction: bill.direction,
      categoryName,
      amountBucket,
      merchantAlias,
    };
    if (
      bill.direction === 'expense' &&
      (amountBucket === '500–1000 元' || amountBucket === '1000 元以上') &&
      highValueRecords.length < 24
    ) {
      highValueRecords.push(rec);
    } else {
      const mList = regularRecordsByMonth.get(yearMonth);
      if (!mList) {
        regularRecordsByMonth.set(yearMonth, [rec]);
      } else if (mList.length < 15) {
        mList.push(rec);
      }
    }
  }

  const buildCatStats = (
    sourceMap: ReadonlyMap<string, CatAcc>,
    direction: 'expense' | 'income',
    dirTotalMinor: number,
  ): RedactedCategoryStat[] =>
    Array.from(sourceMap.entries())
      .sort((a, b) => b[1].minorSum - a[1].minorSum || b[1].count - a[1].count)
      .map(([categoryName, acc]) => {
        const topB = (Object.entries(acc.buckets) as Array<[AmountBucketLabel, number]>).sort(
          (x, y) => y[1] - x[1],
        )[0];
        return {
          categoryName,
          direction,
          count: acc.count,
          amountSharePercent:
            dirTotalMinor > 0 ? Math.max(1, Math.round((acc.minorSum / dirTotalMinor) * 100)) : 0,
          amountRange: coarsenAggregateMinorToRange(acc.minorSum),
          dominantBucket: topB?.[0] ?? '0–50 元',
        };
      });

  const sortedMonths = Array.from(monthSet).sort((a, b) => a.localeCompare(b));
  const monthlyStats: RedactedMonthlyBillStat[] = sortedMonths.map((ym) => {
    const m = monthAccMap.get(ym) ?? {
      expenseCount: 0,
      expenseMinor: 0,
      incomeCount: 0,
      incomeMinor: 0,
      expenseByCat: new Map<string, number>(),
    };
    const topCats = Array.from(m.expenseByCat.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([cat, catMinor]) => {
        const pct = m.expenseMinor > 0 ? Math.round((catMinor / m.expenseMinor) * 100) : 0;
        return `${cat}(${pct}%)`;
      });
    return {
      yearMonth: ym,
      expenseCount: m.expenseCount,
      expenseRange: coarsenAggregateMinorToRange(m.expenseMinor),
      incomeCount: m.incomeCount,
      incomeRange: coarsenAggregateMinorToRange(m.incomeMinor),
      balanceStatus: summarizeBalanceStatus(m.incomeMinor, m.expenseMinor),
      topExpenseCategories: topCats,
    };
  });

  const topMerchants: RedactedMerchantStat[] = Array.from(merchantAccMap.values())
    .sort((a, b) => b.expenseMinor - a.expenseMinor || b.expenseCount - a.expenseCount)
    .slice(0, 15)
    .map((mer) => {
      const topCat =
        Array.from(mer.catMinor.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '未分类';
      return {
        merchantAlias: mer.alias,
        primaryCategory: topCat,
        expenseCount: mer.expenseCount,
        expenseSharePercent:
          totalExpenseMinor > 0
            ? Math.max(1, Math.round((mer.expenseMinor / totalExpenseMinor) * 100))
            : 0,
        expenseRange: coarsenAggregateMinorToRange(mer.expenseMinor),
      };
    });

  // 分层均衡抽样代表性样本（中大额重点样本 + 跨月轮询日常样本，最多 36 条）
  const sampledItems: RedactedBillRecord[] = [...highValueRecords];
  let round = 0;
  while (sampledItems.length < 36 && sortedMonths.length > 0) {
    let addedInRound = false;
    for (const ym of sortedMonths) {
      const mList = regularRecordsByMonth.get(ym);
      const item = mList ? mList[round] : undefined;
      if (item) {
        sampledItems.push(item);
        addedInRound = true;
        if (sampledItems.length >= 36) break;
      }
    }
    if (!addedInRound) break;
    round += 1;
  }

  return {
    totalCount: bills.length,
    expenseCount,
    incomeCount,
    neutralCount,
    totalExpenseRange: coarsenAggregateMinorToRange(totalExpenseMinor),
    totalIncomeRange: coarsenAggregateMinorToRange(totalIncomeMinor),
    overallBalanceSummary: summarizeBalanceStatus(totalIncomeMinor, totalExpenseMinor),
    months: sortedMonths,
    bucketDistribution,
    expenseBucketDistribution,
    incomeBucketDistribution,
    categoryDistribution,
    expenseCategoryStats: buildCatStats(expenseCatMap, 'expense', totalExpenseMinor),
    incomeCategoryStats: buildCatStats(incomeCatMap, 'income', totalIncomeMinor),
    monthlyStats,
    topMerchants,
    merchantAliasCount: counterpartyToAlias.size,
    items: sampledItems,
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
  const tagDistribution: Record<string, number> = {};
  const monthlyCountDistribution: Record<string, number> = {};
  const allItems: RedactedDiaryRecord[] = [];
  let sanitizedCharLength = 0;

  // 按日期升序整理，方便 AI 观察时间脉络与情绪演变
  const sortedEntries = [...entries].sort((a, b) => a.localDate.localeCompare(b.localDate));

  for (const entry of sortedEntries) {
    const yearMonth = coarsenToYearMonth(entry.localDate);
    monthlyCountDistribution[yearMonth] = (monthlyCountDistribution[yearMonth] ?? 0) + 1;

    const moodLabel = entry.mood ? (MOOD_TEXT_MAP[entry.mood] ?? entry.mood) : '日常';
    moodDistribution[moodLabel] = (moodDistribution[moodLabel] ?? 0) + 1;

    for (const rawTag of entry.tags) {
      const cleanTag = sanitizeFreeTextForAi(rawTag).slice(0, 24);
      if (cleanTag) {
        tagDistribution[cleanTag] = (tagDistribution[cleanTag] ?? 0) + 1;
      }
    }

    const combinedText = [entry.title, entry.body].filter(Boolean).join('：');
    const sanitized = sanitizeFreeTextForAi(combinedText).slice(0, 320);
    sanitizedCharLength += sanitized.length;

    allItems.push({
      yearMonth,
      moodLabel,
      tags: entry.tags.slice(0, 8).map((t) => sanitizeFreeTextForAi(t)),
      sanitizedExcerpt: sanitized,
    });
  }

  // 若树洞超过 40 条，采用全周期等距抽样保留 40 条代表性摘录（而情绪、标签与按月分布 100% 保留全量）
  let sampledItems = allItems;
  if (allItems.length > 40) {
    sampledItems = [];
    const step = allItems.length / 40;
    for (let k = 0; k < 40; k += 1) {
      const idx = Math.min(allItems.length - 1, Math.floor(k * step));
      const picked = allItems[idx];
      if (picked) {
        sampledItems.push(picked);
      }
    }
  }

  return {
    selectedCount: entries.length,
    sanitizedCharLength,
    moodDistribution,
    tagDistribution,
    monthlyCountDistribution,
    items: sampledItems,
  };
}
