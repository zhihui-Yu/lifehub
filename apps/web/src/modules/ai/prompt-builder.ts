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
import type { RedactedBillSummary, RedactedDiarySummary } from './redaction';

/** 版本化 Prompt 模板唯一标识（E-02）。 */
export const PROMPT_TEMPLATE_ID = 'lifehub-life-review-v1';

/** AI 专项分析与互动对话主题类型。 */
export type AiAnalysisTopic = 'comprehensive' | 'finance' | 'life' | 'habits' | 'persona';

/** AI 分析数据时间段预设（最长支持近半年 6 个月）。 */
export type AiTimeRangePreset = '7d' | '1m' | '3m' | '6m';

export const AI_TIME_RANGE_OPTIONS: ReadonlyArray<{
  value: AiTimeRangePreset;
  label: string;
  days: number;
}> = [
  { value: '7d', label: '近 7 天', days: 7 },
  { value: '1m', label: '近 1 个月', days: 30 },
  { value: '3m', label: '近 3 个月', days: 90 },
  { value: '6m', label: '近半年（最长）', days: 180 },
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
    label: '全维综合复盘',
    icon: '✨',
    desc: '串联财务收支、生活课表、微习惯打卡与树洞随笔的全景洞察',
    starterQuestions: [
      '帮我总结最近的生活节律与消费状态，有哪些最值得优先改进的地方？',
      '我的消费高峰和课表/心情变化有什么关联吗？',
    ],
  },
  finance: {
    label: '财务分析',
    icon: '💰',
    desc: '聚焦消费区间分桶、高频分类占比、大额支出控制与储蓄优化',
    starterQuestions: [
      '分析我的消费区间和分类结构，哪些地方可以削减非必要开支？',
      '根据我目前的收支笔数和区间分布，给我制定一个下月预算控制建议。',
    ],
  },
  life: {
    label: '生活分析',
    icon: '📅',
    desc: '聚焦生活课表时间块规划、周/月执行完成率与作息精力分配',
    starterQuestions: [
      '我的课表时间块完成率如何？怎么调整时间安排能让每天更从容？',
      '如何平衡工作/学习时段与休息缓冲时段，避免精力透支？',
    ],
  },
  habits: {
    label: '习惯分析',
    icon: '🔥',
    desc: '聚焦微习惯连续打卡天数（Streak）、断签原因排查与习惯锚定策略',
    starterQuestions: [
      '怎样提高我当前的微习惯连续打卡天数，避免中途断签？',
      '如何把我的微习惯和生活课表固定时段绑定起来形成条件反射？',
    ],
  },
  persona: {
    label: '人物与树洞分析',
    icon: '🌲',
    desc: '基于树洞随笔分析情绪波动、人际关系观察、性格特质与内心规划',
    starterQuestions: [
      '根据我勾选的树洞记录，分析我近期的核心情绪、关注的人物关系与内心需求。',
      '从树洞随笔来看，我最近有哪些潜在压力源或值得肯定的成长瞬间？',
    ],
  },
};

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
  /** 可选的已自动脱敏后的树洞摘要（D-03）。 */
  diaryStats?: RedactedDiarySummary;
  /** 可选的专项分析主题（默认 'comprehensive'）。 */
  topic?: AiAnalysisTopic;
  /** 分析数据覆盖的起始日期（YYYY-MM-DD，最长半年）。 */
  fromDate?: string;
  /** 分析数据覆盖的结束日期（YYYY-MM-DD）。 */
  toDate?: string;
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
  const { redactedBills, scheduleStats, habitStats, diaryStats, topic = 'comprehensive' } = context;

  const topicRoleMap: Record<AiAnalysisTopic, string> = {
    comprehensive:
      '请基于脱敏后的消费分桶结构、生活课表完成率、微习惯连续打卡数据与用户主动勾选的树洞心情记录，输出简明、结构化的中文复盘建议，并回答用户的追问。',
    finance:
      '你当前处于【财务分析专项】模式：请深度聚焦用户的脱敏收支分桶分布、消费分类结构、高频匿名商户特征与大额支出风险，提供可落地的预算控制与财务优化方案。',
    life:
      '你当前处于【生活课表与时间分析专项】模式：请深度聚焦用户的周/月课表时间块完成率、作息密度与精力分配，给出具体的时间块重排与执行力提升建议。',
    habits:
      '你当前处于【微习惯养成专项】模式：请深度聚焦用户的活跃微习惯数量、连续打卡天数（Streak）、历史最高纪录与课表协同情况，给出防断签与习惯锚定方案。',
    persona:
      '你当前处于【人物观察与树洞心理分析专项】模式：请深度聚焦用户主动勾选的树洞随笔、情绪标签、人际关系记录与未来规划，温和且深刻地剖析用户的情绪轨迹、关注的人物互动特征与内在需求。',
  };

  const systemPrompt = [
    '你是 LifeHub 个人生活与财务复盘及深度对话顾问。',
    '用户提供的数据已在本地经过严格隐私脱敏（金额已分桶、交易对手已泛化为匿名代号、日期已粗化到月份）。',
    topicRoleMap[topic],
    '',
    '【输出排版规范（严格遵循 Markdown 结构化格式）】',
    '1. 开头先用一段 `> 💡 **核心洞察**：...` 引用块总结最关键的 1~2 句结论；',
    '2. 使用清晰的二级标题（如 `## 📊 现状诊断`、`## 🔍 关键发现`、`## 🎯 行动建议`）组织层次；',
    '3. 涉及多维指标对比时，优先使用 Markdown 表格（`| 指标维度 | 当前状态 | 优化方向 |`）直观呈现；',
    '4. 列表项请使用 `- **核心词**：具体说明` 的格式，重点数据或结论用 `**加粗**` 标注，保持排版清爽易读。',
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

  const diarySection =
    diaryStats && diaryStats.selectedCount > 0
      ? [
          `【树洞随笔与人物/心情摘要（模块 D · 已自动强制脱敏 ${diaryStats.selectedCount} 条，脱敏文本 ${diaryStats.sanitizedCharLength} 字）】`,
          `- 心情分布：${Object.entries(diaryStats.moodDistribution)
            .map(([mood, count]) => `${mood} ${count} 条`)
            .join('、')}`,
          ...diaryStats.items
            .slice(0, 12)
            .map(
              (item, idx) =>
                `  ${idx + 1}. [${item.yearMonth} · ${item.moodLabel}] ${item.tags.length > 0 ? `(${item.tags.map((t) => `#${t}`).join(' ')}) ` : ''}${item.sanitizedExcerpt}`,
            ),
        ].join('\n')
      : '【树洞随笔与人物/心情摘要（模块 D）】\n- 所选时间段内暂无树洞条目';

  const rangeLine =
    context.fromDate && context.toDate
      ? `数据时间段: ${context.fromDate.slice(0, 7)} ~ ${context.toDate.slice(0, 7)}（系统已强制全量脱敏，最长不超过半年）`
      : '数据时间段: 默认周期（系统已强制全量脱敏）';

  const userPrompt = [
    `Prompt 模板版本: ${PROMPT_TEMPLATE_ID}`,
    `分析维度: ${AI_TOPIC_META[topic]?.label ?? '全维综合复盘'}`,
    rangeLine,
    '',
    '【脱敏账单结构摘要（模块 A · X-14 已强制脱敏）】',
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
    diarySection,
    '',
    '请基于上述系统自动构造的脱敏上下文给出深度复盘洞察与可执行行动建议。',
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
  const { redactedBills, scheduleStats, habitStats, diaryStats, topic = 'comprehensive' } = context;

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

  const topicTitle = AI_TOPIC_META[topic]?.label ?? '全维综合复盘';
  const lines: string[] = [
    `## 📊 LifeHub 本地智能复盘报告 · 【${topicTitle}】`,
    `> 💡 **隐私与模板说明**：模板版本 \`${PROMPT_TEMPLATE_ID}\` · 全量数据已在本地强制脱敏（零网络生成）`,
  ];

  if (topic === 'comprehensive' || topic === 'finance') {
    lines.push(
      '',
      '### 💰 【财务收支与脱敏分桶洞察】',
      `- **账单概览**：共分析 **${redactedBills.totalCount} 笔**脱敏流水（支出 ${redactedBills.expenseCount} 笔 / 收入 ${redactedBills.incomeCount} 笔），覆盖月份：\`${redactedBills.months.join('、') || '暂无'}\`。`,
      `- **金额分桶特征**：最高频交易区间集中在 **${topBucketText}**，主要高频分类为 **${topCategoryText}**，涉及 **${redactedBills.merchantAliasCount} 个**泛化匿名商户。`,
      redactedBills.bucketDistribution['500–1000 元'] + redactedBills.bucketDistribution['1000 元以上'] > 0
        ? `- **支出提醒**：检测到 **${redactedBills.bucketDistribution['500–1000 元'] + redactedBills.bucketDistribution['1000 元以上']} 笔**中大额区间（500 元以上）账单，建议复核大额支出的必要性。`
        : '- **支出提醒**：当前账单主要集中在中小额日常区间，整体消费结构平稳。',
    );
  }

  if (topic === 'comprehensive' || topic === 'life') {
    lines.push('', '### 📅 【生活课表时间块执行评估】');
    if (scheduleStats) {
      lines.push(
        `- **本周课表执行**：已完成 **${scheduleStats.weekCompleted} / ${scheduleStats.weekExpected}** 个时段（完成率 **${scheduleStats.weekRate}%**）。`,
        `- **本月课表执行**：已完成 **${scheduleStats.monthCompleted} / ${scheduleStats.monthExpected}** 个时段（完成率 **${scheduleStats.monthRate}%**）。`,
        scheduleStats.weekRate >= 80
          ? '- **节律建议**：课表执行率优秀，建议保持当前时间块颗粒度。'
          : '- **节律建议**：部分课表时段尚未勾选完成，建议适度精简高密度时间块或预留弹性缓冲时段。',
      );
    } else {
      lines.push('- **状态提示**：尚未配置课表时段，可前往「生活课表」添加固定学习或运动时间块。');
    }
  }

  if (topic === 'comprehensive' || topic === 'habits') {
    lines.push('', '### 🔥 【微习惯养成与跨模块行动建议】');
    if (habitStats) {
      lines.push(
        `- **习惯与课表协同**：当前维护 **${habitStats.activeHabitCount} 个**微习惯，累计完成事件 **${habitStats.combinedCompletedCount} 次**（其中习惯打卡 ${habitStats.habitCompletedCount} 次、课表完成 ${habitStats.scheduleCompletedCount} 次）。`,
        `- **连续性表现**：当前最高连续打卡 **${habitStats.maxCurrentStreak} 天**，历史最长连续纪录 **${habitStats.maxLongestStreak} 天**。`,
        habitStats.maxCurrentStreak >= 7
          ? '- **激励反馈**：已形成稳固的周度连续节律，继续保持即可冲击更高里程碑徽章！'
          : '- **激励反馈**：建议将微习惯绑定在固定课表时间块之后触发（如晨间时段后立即打卡），降低漏打概率。',
      );
    } else {
      lines.push('- **状态提示**：尚未创建微习惯，可前往「习惯打卡」开启每日微习惯追踪。');
    }
  }

  if (topic === 'comprehensive' || topic === 'persona') {
    if (diaryStats && diaryStats.selectedCount > 0) {
      const moodText = Object.entries(diaryStats.moodDistribution)
        .map(([mood, count]) => `${mood}（${count} 条）`)
        .join('、');
      lines.push(
        '',
        '### 🌲 【人物观察与树洞情绪/生活状态复盘】',
        `- **情绪样本分布**：已纳入 **${diaryStats.selectedCount} 条**脱敏树洞记录（共 ${diaryStats.sanitizedCharLength} 字），主要情绪分布为：${moodText}。`,
        '- **人物与心理洞察**：树洞随笔反映了您近期对自身节律与人际互动的细致观察。建议在情绪波动或疲惫日给自己留出独处缓冲空间，将重要的人际沟通或决策安排在「充实 / 平静」状态较好的时段。',
      );
    } else if (topic === 'persona') {
      lines.push(
        '',
        '### 🌲 【人物观察与树洞情绪/生活状态复盘】',
        '- **状态提示**：所选时间段内暂无树洞随笔记录。您可以先在「树洞」页面记录日常想法、人际观察或未来规划，系统将自动全量脱敏并纳入人物分析。',
      );
    }
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
    const topCats = Object.entries(redactedBills.categoryDistribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([c, n]) => `${c}(${n}笔)`)
      .join('、');
    const bigCount =
      redactedBills.bucketDistribution['500–1000 元'] +
      redactedBills.bucketDistribution['1000 元以上'];
    return [
      `💡 **针对您的提问「${q}」的财务分析建议：**`,
      `1. **收支结构现状**：当前共有 ${redactedBills.totalCount} 笔流水（支出 ${redactedBills.expenseCount} 笔 / 收入 ${redactedBills.incomeCount} 笔），高频消费分类依次为：${topCats || '暂无分类'}。`,
      `2. **大额支出排查**：500 元以上的中大额支出共有 **${bigCount} 笔**，小额（0–50 元）日常支出共 **${redactedBills.bucketDistribution['0–50 元']} 笔**。`,
      `3. **可执行行动**：建议先对排名前二的消费分类设定月度笔数上限；若您已配置 DeepSeek / OpenAI API Key，可点击「AI 深度对话」让大模型结合具体分桶给出更细致的定制方案。`,
    ].join('\n');
  }

  if (/课表|时间|生活|规划|作息|精力|安排|完成率/.test(q) || topic === 'life') {
    const weekRate = scheduleStats?.weekRate ?? 0;
    const monthRate = scheduleStats?.monthRate ?? 0;
    return [
      `💡 **针对您的提问「${q}」的生活与课表规划建议：**`,
      `1. **时间块执行率**：本周课表完成率为 **${weekRate}%**（${scheduleStats?.weekCompleted ?? 0}/${scheduleStats?.weekExpected ?? 0}），本月完成率为 **${monthRate}%**（${scheduleStats?.monthCompleted ?? 0}/${scheduleStats?.monthExpected ?? 0}）。`,
      `2. **节律优化**：${weekRate >= 75 ? '您目前的时间块执行非常稳定，可尝试使用「同步到未来 X 个月」固化核心作息。' : '当前存在一定比例未勾选时段，建议将高难度时间块缩短至 45~60 分钟，并在两个高强度时段之间留出 15 分钟弹性空白。'}`,
    ].join('\n');
  }

  if (/习惯|打卡|坚持|连续|断签/.test(q) || topic === 'habits') {
    return [
      `💡 **针对您的提问「${q}」的微习惯养成建议：**`,
      `1. **当前连续度**：活跃微习惯 **${habitStats?.activeHabitCount ?? 0} 个**，当前最高连续打卡 **${habitStats?.maxCurrentStreak ?? 0} 天**（历史最高 **${habitStats?.maxLongestStreak ?? 0} 天**）。`,
      `2. **防断签技巧**：采用「最小可执行动作（2 分钟原则）」降低启动阻力，并将习惯打卡紧跟在固定课表时段之后完成。`,
    ].join('\n');
  }

  if (/人物|树洞|心情|情绪|关系|朋友|同事|家人|性格|压力/.test(q) || topic === 'persona') {
    if (!diaryStats || diaryStats.selectedCount === 0) {
      return `💡 **提示**：您询问了关于「${q}」的人物/树洞分析，但当前时间段内暂无树洞随笔记录。您可以先在「树洞」页面记录想法或人际观察，系统会自动强制脱敏后纳入对话！`;
    }
    const moods = Object.entries(diaryStats.moodDistribution)
      .map(([m, c]) => `${m}(${c}条)`)
      .join('、');
    const snippets = diaryStats.items
      .slice(0, 3)
      .map((it) => `「${it.sanitizedExcerpt.slice(0, 40)}」`)
      .join('；');
    return [
      `💡 **针对您的提问「${q}」的人物与树洞深度分析：**`,
      `1. **情绪与状态基底**：在当前时间段已自动脱敏的 ${diaryStats.selectedCount} 条树洞记录中，情绪分布为 ${moods}，关键片段涵盖：${snippets}。`,
      `2. **人物关系与内心洞察**：您在记录中展现出较强的自我觉察力。对于令您产生内耗或疲惫的人际互动，建议明确心理边界、减少过度共情；对于带给您平静与振奋的人和事，建议在课表中预留固定交流或深耕时间。`,
    ].join('\n');
  }

  return generateLocalSmartSummary(context);
}
