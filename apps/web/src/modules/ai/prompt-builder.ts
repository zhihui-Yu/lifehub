/**
 * AI 分析层本地聚合、版本化 Prompt 构造器与零网络离线智能总结引擎（模块 E：E-02 / X-14）。
 *
 * 架构位置：apps/web 的「AI 分析模块」Prompt 构造与本地推理层。
 *
 * 职责：
 * 1. 将脱敏后的账单摘要（模块 A）、课表完成率（模块 B）、微习惯打卡与连续天数（模块 C）聚合为结构化上下文；
 * 2. 生成版本化（`lifehub-life-review-v1`）的 System Prompt 与 User Prompt，供用户发送前完整预览；
 * 3. 提供无需任何网络或外部 API Key 的本地智能总结引擎 `generateLocalSmartSummary`。
 */
import type { RedactedBillSummary } from './redaction';

/** 版本化 Prompt 模板唯一标识（E-02）。 */
export const PROMPT_TEMPLATE_ID = 'lifehub-life-review-v1';

/**
 * 课表模块聚合指标摘要。
 */
export interface AiScheduleSummaryInput {
  /** 本周应完成时段数。 */
  weekExpected: number;
  /** 本周已完成时段数。 */
  weekCompleted: number;
  /** 本周完成率（0..100）。 */
  weekRate: number;
  /** 本月应完成时段数。 */
  monthExpected: number;
  /** 本月已完成时段数。 */
  monthCompleted: number;
  /** 本月完成率（0..100）。 */
  monthRate: number;
}

/**
 * 习惯模块与跨模块完成事件聚合摘要。
 */
export interface AiHabitSummaryInput {
  /** 当前活跃习惯数。 */
  activeHabitCount: number;
  /** 周期内习惯打卡次数。 */
  habitCompletedCount: number;
  /** 周期内课表完成次数。 */
  scheduleCompletedCount: number;
  /** 课表 + 习惯合并总完成事件数。 */
  combinedCompletedCount: number;
  /** 当前最高连续打卡天数。 */
  maxCurrentStreak: number;
  /** 历史最长连续打卡天数。 */
  maxLongestStreak: number;
}

/**
 * 构造 AI 分析 Prompt 所需的完整脱敏上下文。
 */
export interface AiPromptContext {
  /** 脱敏后的账单聚合摘要。 */
  redactedBills: RedactedBillSummary;
  /** 可选的课表完成率摘要。 */
  scheduleStats?: AiScheduleSummaryInput;
  /** 可选的习惯打卡与合并事件摘要。 */
  habitStats?: AiHabitSummaryInput;
}

/**
 * 构造完成的 AI Prompt 结构。
 */
export interface BuiltAiPrompt {
  /** 模板版本 ID。 */
  promptTemplateId: string;
  /** 系统角色提示词。 */
  systemPrompt: string;
  /** 用户数据提示词（仅含脱敏分桶与统计聚合）。 */
  userPrompt: string;
  /** 供 UI 发送前展示的完整预览文本。 */
  fullPreviewText: string;
  /** 关联的脱敏账单摘要。 */
  redactedBills: RedactedBillSummary;
}

/**
 * 组装版本化的生活复盘 AI Prompt（纯函数，E-02 / X-14）。
 *
 * 说明：
 * - 严格只读取 `RedactedBillSummary` 中的月份粗化、金额区间分桶与匿名商户代号；
 * - 样本明细最多取前 20 条脱敏记录，避免超长上下文，且保证绝无原始商户名或精确金额。
 *
 * @param context 脱敏聚合上下文
 * @returns 构造好的 `BuiltAiPrompt`
 * @throws 无
 */
export function buildLifeReviewPrompt(context: AiPromptContext): BuiltAiPrompt {
  const { redactedBills, scheduleStats, habitStats } = context;

  const systemPrompt = [
    '你是 LifeHub 个人生活与财务复盘助手。',
    '用户提供的数据已在本地经过严格隐私脱敏（金额已分桶、交易对手已泛化为匿名代号、日期已粗化到月份）。',
    '请基于脱敏后的消费分桶结构、生活课表完成率与微习惯连续打卡数据，输出简明、结构化的中文复盘建议。',
  ].join('\n');

  const bucketLines = Object.entries(redactedBills.bucketDistribution)
    .map(([bucket, count]) => `  - ${bucket}: ${count} 笔`)
    .join('\n');

  const categoryLines =
    Object.entries(redactedBills.categoryDistribution)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => `  - ${cat}: ${count} 笔`)
      .join('\n') || '  - 暂无分类数据';

  const sampleItems = redactedBills.items.slice(0, 20);
  const sampleLines =
    sampleItems.length > 0
      ? sampleItems
          .map(
            (item, idx) =>
              `  ${idx + 1}. [${item.yearMonth}] ${item.direction === 'expense' ? '支出' : item.direction === 'income' ? '收入' : '其他'} | 分类:${item.categoryName} | 区间:${item.amountBucket} | 对手:${item.merchantAlias}`,
          )
          .join('\n')
      : '  （暂无账单样本）';

  const scheduleSection = scheduleStats
    ? [
        '【生活课表执行情况（模块 B）】',
        `- 本周完成率：${scheduleStats.weekRate}%（已完成 ${scheduleStats.weekCompleted} / 应完成 ${scheduleStats.weekExpected}）`,
        `- 本月完成率：${scheduleStats.monthRate}%（已完成 ${scheduleStats.monthCompleted} / 应完成 ${scheduleStats.monthExpected}）`,
      ].join('\n')
    : '【生活课表执行情况（模块 B）】\n- 暂无课表统计数据';

  const habitSection = habitStats
    ? [
        '【微习惯打卡与跨模块完成统计（模块 C）】',
        `- 活跃习惯数：${habitStats.activeHabitCount} 个`,
        `- 习惯打卡次数：${habitStats.habitCompletedCount} 次`,
        `- 课表完成次数：${habitStats.scheduleCompletedCount} 次`,
        `- 课表 + 习惯合并完成事件总数：${habitStats.combinedCompletedCount} 次`,
        `- 当前最高连续打卡：${habitStats.maxCurrentStreak} 天 | 历史最长连续打卡：${habitStats.maxLongestStreak} 天`,
      ].join('\n')
    : '【微习惯打卡与跨模块完成统计（模块 C）】\n- 暂无习惯打卡数据';

  const userPrompt = [
    `Prompt 模板版本: ${PROMPT_TEMPLATE_ID}`,
    '',
    '【脱敏账单结构摘要（模块 A · X-14 已脱敏）】',
    `- 覆盖月份: ${redactedBills.months.length > 0 ? redactedBills.months.join(', ') : '无'}`,
    `- 总笔数: ${redactedBills.totalCount} 笔（支出 ${redactedBills.expenseCount} 笔 / 收入 ${redactedBills.incomeCount} 笔）`,
    `- 独立匿名商户数: ${redactedBills.merchantAliasCount} 个`,
    '- 金额区间分桶分布:',
    bucketLines,
    '- 消费分类笔数分布:',
    categoryLines,
    '- 脱敏流水样本（前 20 条）:',
    sampleLines,
    '',
    scheduleSection,
    '',
    habitSection,
    '',
    '请从以下三个维度给出复盘洞察与可执行行动建议：',
    '1. 收支与消费区间结构优化；',
    '2. 课表时间块规划与完成率提升；',
    '3. 微习惯连续性与生活节律强化。',
  ].join('\n');

  const fullPreviewText = `=== System Prompt ===\n${systemPrompt}\n\n=== User Prompt (${PROMPT_TEMPLATE_ID}) ===\n${userPrompt}`;

  return {
    promptTemplateId: PROMPT_TEMPLATE_ID,
    systemPrompt,
    userPrompt,
    fullPreviewText,
    redactedBills,
  };
}

/**
 * 零网络本地智能总结引擎（纯函数，E-02）。
 *
 * 说明：无需外部 API Key 或网络连接，直接在本地根据脱敏账单、课表完成率与习惯打卡数据生成结构化复盘报告。
 *
 * @param context 脱敏聚合上下文
 * @returns 中文结构化复盘分析文本
 * @throws 无
 */
export function generateLocalSmartSummary(context: AiPromptContext): string {
  const { redactedBills, scheduleStats, habitStats } = context;

  // 找出最高频金额分桶
  const topBucketEntry = Object.entries(redactedBills.bucketDistribution).sort(
    (a, b) => b[1] - a[1],
  )[0];
  const topBucketText =
    topBucketEntry && topBucketEntry[1] > 0
      ? `${topBucketEntry[0]}（共 ${topBucketEntry[1]} 笔）`
      : '暂无明显集中区间';

  // 找出最高频分类
  const topCategoryEntry = Object.entries(redactedBills.categoryDistribution).sort(
    (a, b) => b[1] - a[1],
  )[0];
  const topCategoryText =
    topCategoryEntry && topCategoryEntry[1] > 0
      ? `${topCategoryEntry[0]}（${topCategoryEntry[1]} 笔）`
      : '暂无分类记录';

  const lines: string[] = [
    `📊 LifeHub 本地智能复盘报告（模板：${PROMPT_TEMPLATE_ID} · 零网络本地生成）`,
    '',
    '一、【财务收支与脱敏分桶洞察】',
    `- 账单概览：共分析 ${redactedBills.totalCount} 笔脱敏流水（支出 ${redactedBills.expenseCount} 笔，收入 ${redactedBills.incomeCount} 笔），覆盖月份：${redactedBills.months.join('、') || '暂无'}。`,
    `- 金额分桶特征：最高频交易区间集中在「${topBucketText}」，主要高频分类为「${topCategoryText}」，涉及 ${redactedBills.merchantAliasCount} 个泛化匿名商户。`,
    redactedBills.bucketDistribution['500–1000 元'] + redactedBills.bucketDistribution['1000 元以上'] > 0
      ? `- 支出提醒：检测到 ${redactedBills.bucketDistribution['500–1000 元'] + redactedBills.bucketDistribution['1000 元以上']} 笔中大额区间（500 元以上）账单，建议复核大额支出的必要性。`
      : '- 支出提醒：当前账单主要集中在中小额日常区间，整体消费结构平稳。',
    '',
    '二、【生活课表时间块执行评估】',
  ];

  if (scheduleStats) {
    lines.push(
      `- 本周课表执行：已完成 ${scheduleStats.weekCompleted} / ${scheduleStats.weekExpected} 个时段（完成率 ${scheduleStats.weekRate}%）。`,
      `- 本月课表执行：已完成 ${scheduleStats.monthCompleted} / ${scheduleStats.monthExpected} 个时段（完成率 ${scheduleStats.monthRate}%）。`,
      scheduleStats.weekRate >= 80
        ? '- 节律建议：课表执行率优秀，建议保持当前时间块颗粒度。'
        : '- 节律建议：部分课表时段尚未勾选完成，建议适度精简高密度时间块或预留弹性缓冲时段。',
    );
  } else {
    lines.push('- 尚未配置课表时段，可前往「生活课表」添加固定学习或运动时间块。');
  }

  lines.push('', '三、【微习惯养成与跨模块行动建议】');
  if (habitStats) {
    lines.push(
      `- 习惯与课表协同：当前维护 ${habitStats.activeHabitCount} 个微习惯，累计完成事件 ${habitStats.combinedCompletedCount} 次（其中习惯打卡 ${habitStats.habitCompletedCount} 次、课表完成 ${habitStats.scheduleCompletedCount} 次）。`,
      `- 连续性表现：当前最高连续打卡 ${habitStats.maxCurrentStreak} 天，历史最长连续纪录 ${habitStats.maxLongestStreak} 天。`,
      habitStats.maxCurrentStreak >= 7
        ? '- 激励反馈：已形成稳固的周度连续节律，继续保持即可冲击更高里程碑徽章！'
        : '- 激励反馈：建议将微习惯绑定在固定课表时间块之后触发（如晨间时段后立即打卡），降低漏打概率。',
    );
  } else {
    lines.push('- 尚未创建微习惯，可前往「习惯打卡」开启每日微习惯追踪。');
  }

  return lines.join('\n');
}
