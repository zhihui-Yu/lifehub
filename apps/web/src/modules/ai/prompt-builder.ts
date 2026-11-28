/**
 * AI 分析层本地聚合、版本化 Prompt 构造器与零网络离线智能总结引擎（模块 E：E-02 / X-14）。
 *
 * 架构位置：apps/web 的「AI 分析模块」Prompt 构造与本地推理层。
 *
 * 职责：
 * 1. 将脱敏后的账单摘要（模块 A）、课表完成率（模块 B）、微习惯打卡频次与各习惯定量累计总量（模块 C）聚合为结构化上下文；
 * 2. 生成版本化（`lifehub-life-review-v1`）的 System Prompt 与 User Prompt，供用户发送前完整预览；
 * 3. 提供无需任何网络或外部 API Key 的本地智能总结引擎 `generateLocalSmartSummary`。
 */
import type { RedactedBillSummary, RedactedDiarySummary } from './redaction';

/** 版本化 Prompt 模板唯一标识（E-02）。 */
export const PROMPT_TEMPLATE_ID = 'lifehub-life-review-v1';

/** AI 专项分析与互动对话主题类型。 */
export type AiAnalysisTopic = 'comprehensive' | 'finance' | 'life' | 'habits' | 'persona';

/** AI 分析数据时间段预设（支持近 7 天至近 1 年及全量历史数据）。 */
export type AiTimeRangePreset = '7d' | '1m' | '3m' | '6m' | '1y' | 'all';

export const AI_TIME_RANGE_OPTIONS: ReadonlyArray<{
  value: AiTimeRangePreset;
  label: string;
  days: number;
}> = [
  { value: '7d', label: '近 7 天', days: 7 },
  { value: '1m', label: '近 1 个月', days: 30 },
  { value: '3m', label: '近 3 个月', days: 90 },
  { value: '6m', label: '近半年', days: 180 },
  { value: '1y', label: '近 1 年', days: 365 },
  { value: 'all', label: '全部数据', days: 3650 },
];

/** AI 多轮对话单条消息结构。 */
export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** 是否是由系统自动构造的脱敏上下文首条 Prompt 消息。 */
  isSystemPromptContext?: boolean;
  /** 发送时间戳 ISO。 */
  timestamp?: string;
}

/** DeepSeek 网页风格的历史对话会话结构。 */
export interface AiChatSession {
  id: string;
  title: string;
  topic: AiAnalysisTopic;
  timeRange: AiTimeRangePreset;
  fromDate: string;
  toDate: string;
  createdAt: string;
  updatedAt: string;
  messages: AiChatMessage[];
}

export const AI_TOPIC_META: Record<
  AiAnalysisTopic,
  { label: string; icon: string; desc: string; starterQuestions: string[] }
> = {
  comprehensive: {
    label: '综合复盘',
    icon: '✨',
    desc: '串联收支、课表、微习惯与树洞的全景洞察',
    starterQuestions: [
      '总结最近的生活节律与消费状态，最值得优先调整哪一点？',
      '我的消费高峰和课表或心情变化有关联吗？',
    ],
  },
  finance: {
    label: '财务分析',
    icon: '💰',
    desc: '聚焦消费区间、高频分类与支出控制',
    starterQuestions: [
      '分析我的消费区间和分类结构，哪些地方可以精简开支？',
      '结合目前的收支分布，给我一个下月预算控制建议。',
    ],
  },
  life: {
    label: '课表节律',
    icon: '📅',
    desc: '聚焦课表时间块完成率与作息分配',
    starterQuestions: [
      '我的课表完成率如何？怎么调整时间安排更从容？',
      '如何平衡专注时段与休息缓冲，避免精力透支？',
    ],
  },
  habits: {
    label: '习惯追踪',
    icon: '🔥',
    desc: '聚焦微习惯连续打卡、定量累计总量与防断签策略',
    starterQuestions: [
      '结合我各项习惯的打卡天数和累计总量（如饮水/运动量），有哪些优化建议？',
      '怎样稳定提高微习惯连续打卡天数，降低精力不足日的断签率？',
    ],
  },
  persona: {
    label: '树洞洞察',
    icon: '🌲',
    desc: '基于树洞随笔梳理情绪变化与内心需求',
    starterQuestions: [
      '梳理我近期的核心情绪、关注的人际关系与内心需求。',
      '从树洞记录看，最近有哪些潜在压力源或成长瞬间？',
    ],
  },
};

/** 单个课表时间块在所选周期内的执行明细。 */
export interface AiScheduleSlotDetail {
  /** 时间块标题（如「晨间英语」「力量训练」）。 */
  title: string;
  /** 时间区间 'HH:mm-HH:mm'。 */
  timeWindow: string;
  /** 所选周期内应执行次数。 */
  expectedCount: number;
  /** 所选周期内已完成次数。 */
  completedCount: number;
  /** 单项完成率（0..100）。 */
  completionRate: number;
}

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
  /** 所选分析周期内应完成总时段数。 */
  rangeExpected?: number;
  /** 所选分析周期内已完成总时段数。 */
  rangeCompleted?: number;
  /** 所选分析周期整体完成率（0..100）。 */
  rangeRate?: number;
  /** 各课表时间块在所选周期内的具体执行率排行。 */
  slotDetails?: readonly AiScheduleSlotDetail[];
}

/**
 * 单个习惯在分析周期内的打卡天数与定量累计总量明细（供 AI 深度分析）。
 */
export interface AiHabitItemDetail {
  /** 习惯名称（如「喝水」「跑步」）。 */
  name: string;
  /** 计量单位（如 'ml'、'km'、'次'）。 */
  unit: string;
  /** 记录模式：按次打勾或定量累加。 */
  trackingMode: 'check' | 'quantity';
  /** 每日参考目标（若配置，如 2000 ml）。 */
  dailyTarget?: number;
  /** 所选周期内完成打卡天数（每天完成算 1 次）。 */
  completedDays: number;
  /** 所选周期内累计总量（每日总量相加，如 42.5 km、35000 ml）。 */
  totalQuantity: number;
  /** 打卡日日均量（totalQuantity / completedDays）。 */
  averagePerCompletedDay: number;
  /** 当前连续打卡天数。 */
  currentStreak: number;
  /** 历史最长连续打卡天数。 */
  longestStreak: number;
}

/**
 * 习惯模块与跨模块完成事件聚合摘要。
 */
export interface AiHabitSummaryInput {
  /** 当前活跃习惯数。 */
  activeHabitCount: number;
  /** 周期内习惯打卡总次数（每天每个习惯完成计 1 次）。 */
  habitCompletedCount: number;
  /** 周期内课表完成次数。 */
  scheduleCompletedCount: number;
  /** 课表 + 习惯合并总完成事件数。 */
  combinedCompletedCount: number;
  /** 当前最高连续打卡天数。 */
  maxCurrentStreak: number;
  /** 历史最长连续打卡天数。 */
  maxLongestStreak: number;
  /** 可选：各习惯在所选周期内的打卡天数与定量累计总量明细。 */
  habitDetails?: readonly AiHabitItemDetail[];
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
  /** 可选的已自动脱敏后的树洞摘要（D-03）。 */
  diaryStats?: RedactedDiarySummary;
  /** 可选的专项分析主题（默认 'comprehensive'）。 */
  topic?: AiAnalysisTopic;
  /** 分析数据覆盖的起始日期（YYYY-MM-DD）。 */
  fromDate?: string;
  /** 分析数据覆盖的结束日期（YYYY-MM-DD）。 */
  toDate?: string;
  /** 当所选短期窗口无账单时，是否已自动回退纳入历史全量账单供参考。 */
  usedHistoricalBillsFallback?: boolean;
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
 * 格式化单个习惯的周期聚合描述行（供 Prompt 与本地智能报告共用）。
 *
 * @param detail 单个习惯统计明细
 * @returns 单行可读摘要
 */
function formatHabitDetailLine(detail: AiHabitItemDetail): string {
  if (detail.trackingMode === 'quantity' || detail.unit !== '次') {
    const targetText =
      detail.dailyTarget && detail.dailyTarget > 0
        ? `，每日目标 ${detail.dailyTarget} ${detail.unit}`
        : '';
    const avgText =
      detail.completedDays > 0
        ? ` | 打卡日均 ${detail.averagePerCompletedDay} ${detail.unit}/天${targetText}`
        : targetText
          ? ` | 尚未打卡${targetText}`
          : '';
    return `${detail.name}（定量·${detail.unit}）：打卡 ${detail.completedDays} 天 | 周期累计总量 ${detail.totalQuantity} ${detail.unit}${avgText} | 当前连续 ${detail.currentStreak} 天（最长 ${detail.longestStreak} 天）`;
  }
  return `${detail.name}（按次）：打卡 ${detail.completedDays} 天（累计 ${detail.totalQuantity} ${detail.unit}）| 当前连续 ${detail.currentStreak} 天（最长 ${detail.longestStreak} 天）`;
}

/**
 * 组装版本化的生活复盘 AI Prompt（纯函数，E-02 / X-14）。
 *
 * 说明：
 * - 严格只读取 `RedactedBillSummary` 中的月份粗化、金额区间分桶与匿名商户代号；
 * - 样本明细最多取前 20 条脱敏记录，避免超长上下文，且保证绝无原始商户名或精确金额；
 * - 习惯模块同时携带打卡天数（每天完成算 1 次）与定量累计总量（如总饮水量 ml、总跑量 km、打卡日均量）。
 *
 * @param context 脱敏聚合上下文
 * @returns 构造好的 `BuiltAiPrompt`
 * @throws 无
 */
export function buildLifeReviewPrompt(context: AiPromptContext): BuiltAiPrompt {
  const { redactedBills, scheduleStats, habitStats, diaryStats, topic = 'comprehensive' } = context;

  const topicRoleMap: Record<AiAnalysisTopic, string> = {
    comprehensive:
      '当前为【综合复盘】模式。必检关键信号（缺一不可）：① 财务总支/结余状态与 Top1 支出分类占比；② 课表整体完成率与最低效时段；③ 每个微习惯的打卡天数、累计总量与连续打卡差距；④ 树洞主导情绪与核心消耗/滋养点；⑤ 1~2 条跨模块联动发现（如情绪/作息与消费或断签的关联）。',
    finance:
      '当前为【财务分析专项】模式（仅含账单模块）。必检关键信号（缺一不可）：① 总支出/总收入区间与结余（或超支）比例；② 支出占比 Top 3 分类（占比% + 粗化区间）；③ 月度收支走势拐点或异常冲高月；④ 高占比匿名商户集中度与 500 元以上中大额支出笔数风险；⑤ 带明确分类与压降目标的预算动作。',
    life:
      '当前为【课表节律专项】模式（仅含课表模块）。必检关键信号（缺一不可）：① 周期整体及本周/本月完成率对比（判断执行力走高或滑坡）；② 完成率最高的锚点时段 vs 完成率最低的拖后腿时段（必须点名具体时间块与完成率%）；③ 作息密度失衡点与具体时段合并/缩短/移位动作。',
    habits:
      '当前为【习惯追踪专项】模式（仅含微习惯模块）。必检关键信号（缺一不可）：① 逐一覆盖全部活跃习惯（严禁漏掉任何一个习惯）的打卡天数、定量累计总量及打卡日均 vs 每日目标差距；② 当前连续打卡与历史最长的差距（锁定易断签习惯）；③ 保底不断签最小动作与定量进阶目标。',
    persona:
      '当前为【树洞洞察专项】模式（仅含树洞模块）。必检关键信号（缺一不可）：① 主导情绪分布占比与跨月情绪变化趋势；② 高频 #标签 与反复出现的压力消耗源 vs 积极滋养源；③ 核心人际边界或内在需求提炼及具体减压行动。',
  };

  const privacyScopeLine =
    topic === 'comprehensive' || topic === 'finance'
      ? '数据已在本地完成隐私脱敏（金额已粗化为区间/占比、商户已泛化为代号、日期已粗化到月）。'
      : '数据已在本地完成隐私脱敏与模块隔离（仅含当前所选专项数据）。';

  const systemPrompt = [
    '你是 LifeHub 高密度生活与财务诊断顾问。风格准则：**字数极简、干货极全、零废话、数字说话**。',
    privacyScopeLine,
    topicRoleMap[topic],
    '',
    '【输出硬性铁律（严格执行）】',
    '1. **砍废话不砍关键信息**：严禁任何开场寒暄、客套总结、免责声明及“理性消费/劳逸结合/保持好心态”等空洞套话；上方列出的【必检关键信号】必须 100% 全部体现在结果中，绝不允许因简略而漏掉关键指标或异常点。',
    '2. **表格压缩 + 单行电报体**：多维指标对比一律合并为 **1 张紧凑 Markdown 表格**，禁止用长段落重复罗列数字；列表每条严格限 **1 行（≤45 字）**，固定句式为 `- **核心点**：关键数据锚点 → 直接动作`。',
    '3. **篇幅与版式控制**：',
    '   - 完整复盘正文控制在 **220～360 字**（一屏读完），固定仅含三部分：`> 💡 **核心结论**：...`（1~2 句直击要害） → `## 📊 关键信号`（紧凑表格 + 最多 2 条异常点补充） → `## 🎯 行动清单`（2~3 条可执行单行指令）；',
    '   - 若用户提出具体问题/追问，直接针对问题作答（**100～220 字**），给核心判断 + 数据依据 + 1~3 条动作，不套用整套报告大纲。',
  ].join('\n');

  const expenseBucketLines = Object.entries(redactedBills.expenseBucketDistribution)
    .map(([bucket, count]) => `${bucket}: ${count}笔`)
    .join(' | ');
  const incomeBucketLines = Object.entries(redactedBills.incomeBucketDistribution)
    .filter(([, count]) => count > 0)
    .map(([bucket, count]) => `${bucket}: ${count}笔`)
    .join(' | ');

  const expenseCategoryLines =
    redactedBills.expenseCategoryStats.length > 0
      ? redactedBills.expenseCategoryStats
          .map(
            (c) =>
              `  - ${c.categoryName}: ${c.count} 笔 | 占总支出 ${c.amountSharePercent}% | 粗化累计 ${c.amountRange}（主力区间 ${c.dominantBucket}）`,
          )
          .join('\n')
      : Object.entries(redactedBills.categoryDistribution)
          .sort((a, b) => b[1] - a[1])
          .map(([cat, count]) => `  - ${cat}: ${count} 笔`)
          .join('\n') || '  - 暂无分类数据';

  const incomeCategoryLines =
    redactedBills.incomeCategoryStats.length > 0
      ? redactedBills.incomeCategoryStats
          .map(
            (c) =>
              `  - ${c.categoryName}: ${c.count} 笔 | 占总收入 ${c.amountSharePercent}% | 粗化累计 ${c.amountRange}`,
          )
          .join('\n')
      : '';

  const monthlyTrendLines =
    redactedBills.monthlyStats.length > 0
      ? redactedBills.monthlyStats
          .map(
            (m) =>
              `  - [${m.yearMonth}] 支出 ${m.expenseCount} 笔（${m.expenseRange}） | 收入 ${m.incomeCount} 笔（${m.incomeRange}） | ${m.balanceStatus}${m.topExpenseCategories.length > 0 ? ` | 主要支出分类: ${m.topExpenseCategories.join('、')}` : ''}`,
          )
          .join('\n')
      : '  - 暂无月度收支记录';

  const topMerchantLines =
    redactedBills.topMerchants.length > 0
      ? redactedBills.topMerchants
          .map(
            (mer) =>
              `  - ${mer.merchantAlias}（主分类:${mer.primaryCategory}）: 支出 ${mer.expenseCount} 笔 | 占总支出 ${mer.expenseSharePercent}%（${mer.expenseRange}）`,
          )
          .join('\n')
      : '  - 暂无高频匿名商户统计';

  const sampleItems = redactedBills.items.slice(0, 36);
  const sampleLines =
    sampleItems.length > 0
      ? sampleItems
          .map(
            (item, idx) =>
              `  ${idx + 1}. [${item.yearMonth}] ${item.direction === 'expense' ? '支出' : item.direction === 'income' ? '收入' : '其他'} | 分类:${item.categoryName} | 区间:${item.amountBucket} | 对手:${item.merchantAlias}`,
          )
          .join('\n')
      : '  （暂无账单样本）';

  const scheduleSlotLines =
    scheduleStats?.slotDetails && scheduleStats.slotDetails.length > 0
      ? [
          '- 各课表时间块在所选周期内的执行率明细（全量覆盖）：',
          ...scheduleStats.slotDetails.map(
            (s) =>
              `  * ${s.title}（${s.timeWindow}）：已完成 ${s.completedCount}/${s.expectedCount} 次（完成率 ${s.completionRate}%）`,
          ),
        ]
      : [];

  const scheduleSection = scheduleStats
    ? [
        '【生活课表执行情况（模块 B · 全量时段统计）】',
        ...(scheduleStats.rangeExpected !== undefined
          ? [
              `- 所选周期整体完成率：${scheduleStats.rangeRate ?? 0}%（已完成 ${scheduleStats.rangeCompleted ?? 0} / 应完成 ${scheduleStats.rangeExpected}）`,
            ]
          : []),
        `- 本周完成率：${scheduleStats.weekRate}%（已完成 ${scheduleStats.weekCompleted} / 应完成 ${scheduleStats.weekExpected}）`,
        `- 本月完成率：${scheduleStats.monthRate}%（已完成 ${scheduleStats.monthCompleted} / 应完成 ${scheduleStats.monthExpected}）`,
        ...scheduleSlotLines,
      ].join('\n')
    : '【生活课表执行情况（模块 B）】\n- 暂无课表统计数据';

  const habitDetailLines =
    habitStats?.habitDetails && habitStats.habitDetails.length > 0
      ? [
          '- 各习惯周期累计与定量表现（每天完成计 1 次打卡，同日多次记录汇总为当日总量）：',
          ...habitStats.habitDetails.map((d) => `  * ${formatHabitDetailLine(d)}`),
        ]
      : [];

  const habitSection = habitStats
    ? [
        topic === 'comprehensive'
          ? '【微习惯打卡与跨模块完成统计（模块 C · 全量习惯汇总）】'
          : '【微习惯打卡与定量表现统计（模块 C · 全量习惯汇总）】',
        `- 活跃习惯数：${habitStats.activeHabitCount} 个`,
        `- 习惯打卡完成总次数（按完成日计）：${habitStats.habitCompletedCount} 次`,
        ...(topic === 'comprehensive'
          ? [
              `- 课表完成次数：${habitStats.scheduleCompletedCount} 次`,
              `- 课表 + 习惯合并完成事件总数：${habitStats.combinedCompletedCount} 次`,
            ]
          : []),
        `- 当前最高连续打卡：${habitStats.maxCurrentStreak} 天 | 历史最长连续打卡：${habitStats.maxLongestStreak} 天`,
        ...habitDetailLines,
      ].join('\n')
    : '【微习惯打卡统计（模块 C）】\n- 暂无习惯打卡数据';

  const diaryTagLine =
    diaryStats && Object.keys(diaryStats.tagDistribution ?? {}).length > 0
      ? `- 高频关注标签：${Object.entries(diaryStats.tagDistribution)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12)
          .map(([t, c]) => `#${t}(${c}次)`)
          .join('、')}`
      : '';
  const diaryMonthLine =
    diaryStats && Object.keys(diaryStats.monthlyCountDistribution ?? {}).length > 0
      ? `- 按月记录密度：${Object.entries(diaryStats.monthlyCountDistribution)
          .map(([ym, c]) => `${ym}: ${c}篇`)
          .join(' | ')}`
      : '';

  const diarySection =
    diaryStats && diaryStats.selectedCount > 0
      ? [
          `【树洞随笔与人物/心情摘要（模块 D · 已自动强制脱敏全量 ${diaryStats.selectedCount} 条，脱敏文本 ${diaryStats.sanitizedCharLength} 字）】`,
          `- 全量心情分布：${Object.entries(diaryStats.moodDistribution)
            .map(([mood, count]) => `${mood} ${count} 条`)
            .join('、')}`,
          ...(diaryTagLine ? [diaryTagLine] : []),
          ...(diaryMonthLine ? [diaryMonthLine] : []),
          ...diaryStats.items.map(
            (item, idx) =>
              `  ${idx + 1}. [${item.yearMonth} · ${item.moodLabel}] ${item.tags.length > 0 ? `(${item.tags.map((t) => `#${t}`).join(' ')}) ` : ''}${item.sanitizedExcerpt}`,
          ),
        ].join('\n')
      : '【树洞随笔与人物/心情摘要（模块 D）】\n- 所选时间段内暂无树洞条目';

  const fallbackHint =
    (topic === 'comprehensive' || topic === 'finance') && context.usedHistoricalBillsFallback
      ? '；注：所选近期窗口内无新增账单，已自动纳入本机可用历史账单供完整复盘'
      : '';
  const scopeHintMap: Record<AiAnalysisTopic, string> = {
    comprehensive: '全模块汇总',
    finance: '仅发送财务账单模块，已隔离其他模块数据',
    life: '仅发送生活课表模块，已隔离其他模块数据',
    habits: '仅发送微习惯模块，已隔离其他模块数据',
    persona: '仅发送树洞随笔模块，已隔离其他模块数据',
  };
  const rangeLine =
    context.fromDate && context.toDate
      ? `数据时间段: ${context.fromDate.slice(0, 7)} ~ ${context.toDate.slice(0, 7)}（${scopeHintMap[topic]} · 100% 全量聚合 + X-14 本地强制脱敏${fallbackHint}）`
      : `数据时间段: 默认周期（${scopeHintMap[topic]} · 100% 全量聚合 + X-14 本地强制脱敏）`;

  const financeSection = [
    '【脱敏账单全量结构摘要（模块 A · 100% 账单已纳入聚合，非抽样截断）】',
    `- 覆盖月份: ${redactedBills.months.length > 0 ? redactedBills.months.join(', ') : '无'}`,
    `- 账单总规模: 共 ${redactedBills.totalCount} 笔（支出 ${redactedBills.expenseCount} 笔 / 收入 ${redactedBills.incomeCount} 笔${redactedBills.neutralCount > 0 ? ` / 中性流转 ${redactedBills.neutralCount} 笔` : ''}），涉及独立匿名商户 ${redactedBills.merchantAliasCount} 个`,
    `- 收支体量与结余（粗化区间）: 总支出约 ${redactedBills.totalExpenseRange} | 总收入约 ${redactedBills.totalIncomeRange} | ${redactedBills.overallBalanceSummary}`,
    `- 支出金额分桶分布: ${expenseBucketLines}`,
    ...(incomeBucketLines ? [`- 收入金额分桶分布: ${incomeBucketLines}`] : []),
    '- 按月收支趋势全表（100% 月份覆盖）:',
    monthlyTrendLines,
    '- 支出分类全量结构（按实际支出金额占比排序）:',
    expenseCategoryLines,
    ...(incomeCategoryLines ? ['- 收入分类全量结构:', incomeCategoryLines] : []),
    '- 高支出占比 / 高频匿名商户 Top 15:',
    topMerchantLines,
    `- 代表性分层样本（中大额重点与跨月均衡抽样，共 ${sampleItems.length} 条）:`,
    sampleLines,
  ].join('\n');

  // 按所选分析维度严格切分隔离上传的数据段落：专项模式仅携带对应单模块数据，绝不混发无关模块
  const activeModuleSections: string[] = [];
  if (topic === 'comprehensive') {
    activeModuleSections.push(financeSection, scheduleSection, habitSection, diarySection);
  } else if (topic === 'finance') {
    activeModuleSections.push(financeSection);
  } else if (topic === 'life') {
    activeModuleSections.push(scheduleSection);
  } else if (topic === 'habits') {
    activeModuleSections.push(habitSection);
  } else if (topic === 'persona') {
    activeModuleSections.push(diarySection);
  }

  const userPrompt = [
    `Prompt 模板版本: ${PROMPT_TEMPLATE_ID}`,
    `分析维度: ${AI_TOPIC_META[topic]?.label ?? '全维综合复盘'}`,
    rangeLine,
    '',
    activeModuleSections.join('\n\n'),
    '',
    `请按【输出硬性铁律】输出高密度诊断（覆盖全部必检关键信号，零寒暄套话，精炼控制在 220~360 字）。`,
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
 * 说明：无需外部 API Key 或网络连接，直接在本地根据脱敏账单、课表完成率与习惯打卡及定量累计数据生成结构化复盘报告。
 *
 * @param context 脱敏聚合上下文
 * @returns 中文结构化复盘分析文本
 * @throws 无
 */
export function generateLocalSmartSummary(context: AiPromptContext): string {
  const { redactedBills, scheduleStats, habitStats, diaryStats, topic = 'comprehensive' } = context;

  const topCategories = redactedBills.expenseCategoryStats
    .slice(0, 3)
    .map((c) => `${c.categoryName}(${c.amountSharePercent}% · ${c.amountRange})`)
    .join('、');
  const fallbackTopCat =
    Object.entries(redactedBills.categoryDistribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([c, n]) => `${c}(${n}笔)`)
      .join('、') || '暂无';

  const bigExpenseCount =
    redactedBills.expenseBucketDistribution['500–1000 元'] +
    redactedBills.expenseBucketDistribution['1000 元以上'];
  const topMerchant = redactedBills.topMerchants[0];

  const topicTitle = AI_TOPIC_META[topic]?.label ?? '全维综合复盘';
  const lines: string[] = [
    `## 📊 LifeHub 本地智能复盘报告 · 【${topicTitle}】`,
  ];

  // 1. 顶部一句话核心结论
  if (topic === 'finance') {
    lines.push(
      `> 💡 **核心结论**：共 **${redactedBills.totalCount} 笔**流水，总支约 **${redactedBills.totalExpenseRange}**、总收约 **${redactedBills.totalIncomeRange}**（${redactedBills.overallBalanceSummary}）。`,
    );
  } else if (topic === 'life') {
    lines.push(
      `> 💡 **核心结论**：本周课表完成率 **${scheduleStats?.weekRate ?? 0}%**，本月 **${scheduleStats?.monthRate ?? 0}%**${scheduleStats?.rangeExpected ? `，所选周期整体 **${scheduleStats.rangeRate ?? 0}%**` : ''}。`,
    );
  } else if (topic === 'habits') {
    lines.push(
      `> 💡 **核心结论**：活跃习惯 **${habitStats?.activeHabitCount ?? 0} 个**，周期打卡 **${habitStats?.habitCompletedCount ?? 0} 次**，当前最高连续 **${habitStats?.maxCurrentStreak ?? 0} 天**（历史最长 ${habitStats?.maxLongestStreak ?? 0} 天）。`,
    );
  } else if (topic === 'persona') {
    lines.push(
      `> 💡 **核心结论**：周期内记录树洞 **${diaryStats?.selectedCount ?? 0} 篇**，离线模式已完成情绪与标签全量汇总。`,
    );
  } else {
    lines.push(
      `> 💡 **核心结论**：全维纳入 **${redactedBills.totalCount} 笔**账单（${redactedBills.overallBalanceSummary}）、课表周完成率 **${scheduleStats?.weekRate ?? 0}%**、习惯最高连续 **${habitStats?.maxCurrentStreak ?? 0} 天**、树洞 **${diaryStats?.selectedCount ?? 0} 篇**。`,
    );
  }

  // 2. 紧凑关键信号表（零废话，关键数字全覆盖）
  lines.push('', '### 📊 关键信号', '| 维度 | 核心指标数据 | 关键风险 / 亮点 |', '| :--- | :--- | :--- |');

  if (topic === 'comprehensive' || topic === 'finance') {
    const monthTrend =
      redactedBills.monthlyStats.length > 1
        ? redactedBills.monthlyStats.map((m) => `${m.yearMonth}:${m.expenseRange}`).join(' → ')
        : redactedBills.months.join(', ') || '暂无';
    lines.push(
      `| 收支总览 | 支 ${redactedBills.totalExpenseRange}(${redactedBills.expenseCount}笔) / 收 ${redactedBills.totalIncomeRange}(${redactedBills.incomeCount}笔) | ${redactedBills.overallBalanceSummary} |`,
      `| Top支出分类 | ${topCategories || fallbackTopCat} | ${bigExpenseCount > 0 ? `≥500元中大额共 **${bigExpenseCount}笔**` : '无≥500元大额支出'} |`,
      `| 趋势与商户 | 月度：${monthTrend} | ${topMerchant ? `最高占比 ${topMerchant.merchantAlias}(${topMerchant.expenseSharePercent}% · ${topMerchant.expenseCount}笔)` : `匿名商户 ${redactedBills.merchantAliasCount} 个`} |`,
    );
  }

  if (topic === 'comprehensive' || topic === 'life') {
    if (scheduleStats) {
      const sortedSlots = [...(scheduleStats.slotDetails ?? [])].filter((s) => s.expectedCount > 0);
      sortedSlots.sort((a, b) => a.completionRate - b.completionRate);
      const worstSlot = sortedSlots[0];
      const bestSlot = sortedSlots[sortedSlots.length - 1];
      lines.push(
        `| 课表执行 | 周 **${scheduleStats.weekRate}%**(${scheduleStats.weekCompleted}/${scheduleStats.weekExpected}) · 月 **${scheduleStats.monthRate}%**(${scheduleStats.monthCompleted}/${scheduleStats.monthExpected}) | ${worstSlot ? `短板：${worstSlot.title}(${worstSlot.completionRate}%)` : scheduleStats.weekRate >= 80 ? '节律稳定' : '存在漏勾时段'}${bestSlot && bestSlot !== worstSlot ? `；稳固：${bestSlot.title}(${bestSlot.completionRate}%)` : ''} |`,
      );
    } else {
      lines.push('| 课表执行 | 暂无时段配置 | 可前往「生活课表」建立固定时间块 |');
    }
  }

  if (topic === 'comprehensive' || topic === 'habits') {
    if (habitStats && habitStats.habitDetails && habitStats.habitDetails.length > 0) {
      for (const d of habitStats.habitDetails) {
        const qtyStr =
          d.trackingMode === 'quantity' || d.unit !== '次'
            ? `打卡 ${d.completedDays}天 · 累计 **${d.totalQuantity}${d.unit}**（日均 ${d.averagePerCompletedDay}${d.unit}${d.dailyTarget ? `/${d.dailyTarget}${d.unit}` : ''}）`
            : `打卡 **${d.completedDays}天**（共 ${d.totalQuantity}${d.unit}）`;
        lines.push(
          `| 习惯·${d.name} | ${qtyStr} | 连续 **${d.currentStreak}天**（最长 ${d.longestStreak}天） |`,
        );
      }
    } else if (habitStats) {
      lines.push(
        `| 微习惯 | 活跃 ${habitStats.activeHabitCount} 个 · 打卡 ${habitStats.habitCompletedCount} 次 | 当前最高连续 **${habitStats.maxCurrentStreak}天** |`,
      );
    } else {
      lines.push('| 微习惯 | 暂无习惯记录 | 可前往「习惯打卡」创建微习惯 |');
    }
  }

  if (topic === 'comprehensive' || topic === 'persona') {
    if (diaryStats && diaryStats.selectedCount > 0) {
      const moodText = Object.entries(diaryStats.moodDistribution)
        .sort((a, b) => b[1] - a[1])
        .map(([mood, count]) => `${mood}(${count})`)
        .join('、');
      const topTags = Object.entries(diaryStats.tagDistribution ?? {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([t, c]) => `#${t}(${c})`)
        .join(' ');
      lines.push(
        `| 树洞状态 | 共 **${diaryStats.selectedCount}篇** · 情绪：${moodText} | ${topTags ? `高频焦点：${topTags}` : '记录节律平稳'} |`,
      );
    } else if (topic === 'persona') {
      lines.push('| 树洞状态 | 当前周期 0 篇 | 记录日常随笔后可生成情绪画像 |');
    }
  }

  // 3. 单行高杠杆行动清单（不超过 3 条）
  lines.push('', '### 🎯 关键动作');
  if (topic === 'comprehensive' || topic === 'finance') {
    const top1 = redactedBills.expenseCategoryStats[0];
    lines.push(
      top1
        ? `- **控头部分类**：\`${top1.categoryName}\` 占总支 **${top1.amountSharePercent}%**（${top1.amountRange}） → 下周期设硬上限压降 15%。`
        : `- **复核大额项**：≥500 元支出共 **${bigExpenseCount} 笔** → 剔除非刚需冲动支出。`,
    );
  }
  if (topic === 'comprehensive' || topic === 'life') {
    const lowSlot = [...(scheduleStats?.slotDetails ?? [])]
      .filter((s) => s.expectedCount > 0)
      .sort((a, b) => a.completionRate - b.completionRate)[0];
    if (lowSlot && lowSlot.completionRate < 75) {
      lines.push(
        `- **重排低效时段**：\`${lowSlot.title}\` 完成率仅 **${lowSlot.completionRate}%** → 缩短时长或移至精力高峰。`,
      );
    } else if (scheduleStats) {
      lines.push(
        `- **维持作息锚点**：周完成率 **${scheduleStats.weekRate}%** → 保持高强度块间预留 15 分钟缓冲。`,
      );
    }
  }
  if (topic === 'comprehensive' || topic === 'habits') {
    const riskHabit = [...(habitStats?.habitDetails ?? [])].sort(
      (a, b) => a.currentStreak - b.currentStreak,
    )[0];
    if (riskHabit) {
      lines.push(
        `- **防断签保底**：\`${riskHabit.name}\` 当前连续 **${riskHabit.currentStreak} 天** → 疲惫日执行最小保底量先不断签。`,
      );
    }
  }
  if (topic === 'persona' && diaryStats && diaryStats.selectedCount > 0) {
    lines.push('- **情绪降噪**：针对高频消耗话题设立明确心理边界 → 重大决定安排在平静/专注时段。');
  }

  return lines.join('\n');
}

/**
 * 针对用户在对话窗口中的自由提问，生成零网络本地顾问回复（当未配置外部大模型或用户使用本地对话时调用）。
 *
 * @param context 脱敏聚合上下文
 * @param userQuestion 用户提问内容
 * @returns 中文回复内容
 */
export function generateLocalChatReply(context: AiPromptContext, userQuestion: string): string {
  const q = userQuestion.trim();
  const { redactedBills, scheduleStats, habitStats, diaryStats, topic = 'comprehensive' } = context;

  if (/财务|消费|花销|钱|预算|账单|省钱|支出|收入/.test(q) || topic === 'finance') {
    const topCats = redactedBills.expenseCategoryStats
      .slice(0, 3)
      .map((c) => `${c.categoryName}(${c.amountSharePercent}% · ${c.amountRange})`)
      .join('、');
    const bigCount =
      redactedBills.expenseBucketDistribution['500–1000 元'] +
      redactedBills.expenseBucketDistribution['1000 元以上'];
    return [
      `> 💡 **核心判断**：总支约 **${redactedBills.totalExpenseRange}**（${redactedBills.expenseCount} 笔），${redactedBills.overallBalanceSummary}。`,
      `- **主力分类**：${topCats || '暂无分类'}；≥500 元大额支出 **${bigCount} 笔**。`,
      `- **直接动作**：优先给排名第一的分类设月度硬上限（压降 15%），单笔 ≥500 元消费冷静 24 小时后再付。`,
    ].join('\n');
  }

  if (/课表|时间|生活|规划|作息|精力|安排|完成率/.test(q) || topic === 'life') {
    const weekRate = scheduleStats?.weekRate ?? 0;
    const monthRate = scheduleStats?.monthRate ?? 0;
    const lowSlot = [...(scheduleStats?.slotDetails ?? [])]
      .filter((s) => s.expectedCount > 0)
      .sort((a, b) => a.completionRate - b.completionRate)[0];
    return [
      `> 💡 **核心判断**：课表周完成率 **${weekRate}%**（${scheduleStats?.weekCompleted ?? 0}/${scheduleStats?.weekExpected ?? 0}），月完成率 **${monthRate}%**。`,
      ...(lowSlot
        ? [`- **短板时段**：\`${lowSlot.title}（${lowSlot.timeWindow}）\` 完成率 **${lowSlot.completionRate}%**（${lowSlot.completedCount}/${lowSlot.expectedCount}）。`]
        : []),
      `- **直接动作**：${weekRate >= 75 ? '保持现有节奏，重点守护核心专注块。' : '将最低完成率时段缩短至 30~45 分钟，两块间留 15 分钟缓冲。'}`,
    ].join('\n');
  }

  if (/习惯|打卡|坚持|连续|断签|喝水|跑步|运动/.test(q) || topic === 'habits') {
    const detailText =
      habitStats?.habitDetails && habitStats.habitDetails.length > 0
        ? habitStats.habitDetails
            .map((d) =>
              d.trackingMode === 'quantity' || d.unit !== '次'
                ? `${d.name} **${d.totalQuantity}${d.unit}**（${d.completedDays}天，日均 ${d.averagePerCompletedDay}${d.unit}）`
                : `${d.name} **${d.completedDays}天**`,
            )
            .join('；')
        : '暂无细分习惯记录';
    return [
      `> 💡 **核心判断**：活跃习惯 **${habitStats?.activeHabitCount ?? 0} 个**，最高连续 **${habitStats?.maxCurrentStreak ?? 0} 天**（最长 ${habitStats?.maxLongestStreak ?? 0} 天）。`,
      `- **各项累计**：${detailText}。`,
      `- **直接动作**：疲惫日执行最低保底量（如喝 1 杯水 / 动 5 分钟）优先保住不断签。`,
    ].join('\n');
  }

  if (/人物|树洞|心情|情绪|关系|朋友|同事|家人|性格|压力/.test(q) || topic === 'persona') {
    if (!diaryStats || diaryStats.selectedCount === 0) {
      return `> 💡 **提示**：当前周期暂无树洞随笔，先在「树洞」记录想法后即可自动脱敏分析。`;
    }
    const moods = Object.entries(diaryStats.moodDistribution)
      .map(([m, c]) => `${m}(${c}篇)`)
      .join('、');
    const snippets = diaryStats.items
      .slice(0, 3)
      .map((it) => `「${it.sanitizedExcerpt.slice(0, 36)}」`)
      .join('；');
    return [
      `> 💡 **核心判断**：共 **${diaryStats.selectedCount} 篇**树洞，主导情绪为 ${moods}。`,
      `- **关键线索**：${snippets}。`,
      `- **直接动作**：对高频内耗事项设明确边界，重要沟通放到平静/专注日处理。`,
    ].join('\n');
  }

  return generateLocalSmartSummary(context);
}
