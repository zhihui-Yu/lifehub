/**
 * AI 分析与生活复盘页面（DeepSeek 网页版 chat.deepseek.com 极简风格 · 模块 E：E-01 ~ E-05 / X-12 ~ X-14）。
 *
 * 架构位置：apps/web 的「页面组件」层，路由 `/ai`。
 *
 * 核心设计：
 * 1. **强制全量默认脱敏（X-14）**：所有选定时间段内的账单、生活课表、习惯打卡与树洞随笔均由系统强制自动脱敏，严禁关闭脱敏；
 * 2. **数据时间段选择（最长半年）**：支持选择 `近 7 天`、`近 1 个月`、`近 3 个月`、`近半年（最长）`；
 * 3. **1:1 还原 DeepSeek 网页版交互体验**：
 *    - 固定视口高度一屏聊天布局，发送消息与收到回复时**自动平滑滚动到底部**，无需手动下拉；
 *    - 系统自动构建的脱敏数据 Prompt 在对话流中以**可折叠胶囊卡片**呈现，既透明可见又不遮挡正文；
 *    - AI 回复采用结构化 **Markdown 富文本渲染**（支持二级标题、表格、引用高亮块、列表、加粗与 R1 深度思考过程折叠）；
 *    - 底部采用 DeepSeek 标志性的大圆角一体式输入舱（内置深度思考 R1 切换、模块切换、时间段选择与快捷键发送）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddCommentOutlined from '@mui/icons-material/AddCommentOutlined';
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import PsychologyOutlined from '@mui/icons-material/PsychologyOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import SendOutlined from '@mui/icons-material/SendOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import ShieldOutlined from '@mui/icons-material/ShieldOutlined';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import { addDays, type Bill } from '@lifehub/core';
import { useBillStore } from '@/store';
import { useVault } from '@/hooks/useVault';
import { getTodayLocalDate } from '@/modules/shared/date-utils';
import { ScheduleService } from '@/modules/schedule/schedule-service';
import { HabitService } from '@/modules/habits/habit-service';
import { DiaryService, type DecryptedDiaryEntry } from '@/modules/diary/diary-service';
import { redactBillsForAi, redactDiaryEntriesForAi } from '@/modules/ai/redaction';
import {
  AI_TIME_RANGE_OPTIONS,
  AI_TOPIC_META,
  buildLifeReviewPrompt,
  type AiAnalysisTopic,
  type AiChatMessage,
  type AiChatSession,
  type AiHabitSummaryInput,
  type AiPromptContext,
  type AiScheduleSummaryInput,
  type AiTimeRangePreset,
} from '@/modules/ai/prompt-builder';
import {
  AiStorageService,
  type AIAnalysisRequestRecord,
  type AiProviderType,
} from '@/modules/ai/ai-storage';
import {
  executeAiChatMessage,
  executeLocalSmartAnalysis,
  executeRemoteAiAnalysis,
} from '@/modules/ai/ai-client';
import { AiMarkdownRenderer } from '@/modules/ai/AiMarkdownRenderer';

/** 本地存储历史会话列表的键名（仅保存脱敏后的会话记录）。 */
const AI_CHAT_SESSIONS_STORAGE_KEY = 'lifehub:ai:chat-sessions:v1';

function loadSavedSessions(): AiChatSession[] {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(AI_CHAT_SESSIONS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          return parsed as AiChatSession[];
        }
      }
    }
  } catch {
    // 忽略解析异常
  }
  return [];
}

function saveSessionsToLocal(sessions: AiChatSession[]): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(
        AI_CHAT_SESSIONS_STORAGE_KEY,
        JSON.stringify(sessions.slice(0, 30)),
      );
    }
  } catch {
    // 忽略存储异常
  }
}

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `session-${crypto.randomUUID()}`;
  }
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 会话流中展示的「系统自动构建脱敏 Prompt」可折叠胶囊组件（默认折叠为一行，点击可展开查看完整发送内容）。
 */
function SystemPromptContextCard({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const firstLine = content.split('\n')[0] || '系统已自动构建并注入当前模块的脱敏数据 Prompt';

  return (
    <Box
      sx={{
        alignSelf: 'stretch',
        my: 0.5,
      }}
    >
      <Paper
        variant="outlined"
        sx={{
          borderRadius: 2.5,
          backgroundColor: 'var(--lifehub-bg)',
          borderColor: 'var(--lifehub-border)',
          overflow: 'hidden',
        }}
      >
        <Box
          onClick={() => setExpanded((prev) => !prev)}
          sx={{
            px: 1.75,
            py: 0.9,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            userSelect: 'none',
            '&:hover': {
              backgroundColor: 'rgba(99, 102, 241, 0.04)',
            },
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
            <ShieldOutlined sx={{ fontSize: 16, color: 'success.main', flexShrink: 0 }} />
            <Typography
              variant="caption"
              noWrap
              sx={{ fontWeight: 600, color: 'var(--lifehub-text-muted)' }}
            >
              {firstLine}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
            <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 600, fontSize: 11.5 }}>
              {expanded ? '收起脱敏 Prompt' : '查看发送给 AI 的脱敏 Prompt'}
            </Typography>
            {expanded ? (
              <ExpandLess sx={{ fontSize: 16, color: 'primary.main' }} />
            ) : (
              <ExpandMore sx={{ fontSize: 16, color: 'primary.main' }} />
            )}
          </Stack>
        </Box>
        <Collapse in={expanded}>
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 1.75,
              borderTop: '1px solid var(--lifehub-border)',
              fontSize: 12,
              lineHeight: 1.6,
              maxHeight: 260,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: 'var(--lifehub-text-muted)',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            }}
          >
            {content}
          </Box>
        </Collapse>
      </Paper>
    </Box>
  );
}

/**
 * 渲染 DeepSeek 网页风格极简 AI 分析与多轮对话页面。
 */
export function AiAnalysisPage() {
  const { runtime, status } = useVault();
  const storeBills = useBillStore((state) => state.bills);

  const aiStorage = useMemo(() => new AiStorageService(), []);
  const scheduleService = useMemo(() => new ScheduleService(), []);
  const habitService = useMemo(() => new HabitService(), []);
  const diaryService = useMemo(() => new DiaryService(), []);
  const today = useMemo(() => getTodayLocalDate(), []);

  const [loadedBills, setLoadedBills] = useState<Bill[]>([]);
  const [categoryMap, setCategoryMap] = useState<Map<string, string>>(new Map());
  const [scheduleSummary, setScheduleSummary] = useState<AiScheduleSummaryInput | undefined>(
    undefined,
  );
  const [habitSummary, setHabitSummary] = useState<AiHabitSummaryInput | undefined>(undefined);
  const [diaryEntries, setDiaryEntries] = useState<DecryptedDiaryEntry[]>([]);

  // 配置表单状态（默认指向 DeepSeek 官方接口）
  const [provider, setProvider] = useState<AiProviderType>('deepseek');
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com');
  const [model, setModel] = useState('deepseek-chat');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [hasEncryptedKey, setHasEncryptedKey] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // 分析模块 & 时间段（最长半年 180 天）
  const [selectedTopic, setSelectedTopic] = useState<AiAnalysisTopic>('comprehensive');
  const [timeRange, setTimeRange] = useState<AiTimeRangePreset>('1m');

  // DeepSeek 风格多会话管理状态
  const [sessions, setSessions] = useState<AiChatSession[]>(() => loadSavedSessions());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    const initial = loadSavedSessions();
    return initial[0]?.id ?? null;
  });
  const [chatInput, setChatInput] = useState('');
  const [analysisOutput, setAnalysisOutput] = useState<string>('');
  const [analyzing, setAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [auditHistory, setAuditHistory] = useState<AIAnalysisRequestRecord[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showPromptDrawer, setShowPromptDrawer] = useState(false);

  // 自动滚动到底部的引用
  const chatScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const chatBottomAnchorRef = useRef<HTMLDivElement | null>(null);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );

  const currentMessages = useMemo(
    () => activeSession?.messages ?? [],
    [activeSession],
  );

  // 自动将消息流滚动到最底部（无需用户手动下拉）
  const scrollToBottom = useCallback((smooth = true) => {
    const container = chatScrollContainerRef.current;
    if (container && typeof container.scrollTo === 'function') {
      try {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: smooth ? 'smooth' : 'auto',
        });
        return;
      } catch {
        container.scrollTop = container.scrollHeight;
        return;
      }
    }
    if (chatBottomAnchorRef.current && typeof chatBottomAnchorRef.current.scrollIntoView === 'function') {
      try {
        chatBottomAnchorRef.current.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' });
      } catch {
        // 忽略 JSDOM 单测环境无 scrollIntoView 实现
      }
    }
  }, []);

  useEffect(() => {
    if (currentMessages.length > 0 || analyzing) {
      const timer = setTimeout(() => scrollToBottom(true), 40);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [currentMessages.length, analyzing, activeSessionId, scrollToBottom]);

  // 根据选定的时间段（最长半年 180 天）计算闭区间 [fromDate, toDate]
  const dateWindow = useMemo(() => {
    const opt = AI_TIME_RANGE_OPTIONS.find((o) => o.value === timeRange) ?? AI_TIME_RANGE_OPTIONS[1]!;
    const safeDays = Math.min(180, Math.max(1, opt.days));
    const fromDate = addDays(today, -(safeDays - 1));
    return { fromDate, toDate: today, label: opt.label };
  }, [timeRange, today]);

  const effectiveBills = useMemo(() => {
    const raw = storeBills.length > 0 ? storeBills : loadedBills;
    return raw.filter(
      (b) => b.localDate >= dateWindow.fromDate && b.localDate <= dateWindow.toDate,
    );
  }, [dateWindow.fromDate, dateWindow.toDate, loadedBills, storeBills]);

  // 强制默认脱敏选定时间段内的全部树洞记录（不可关闭脱敏）
  const rangedDiaries = useMemo(
    () =>
      diaryEntries.filter(
        (d) => d.localDate >= dateWindow.fromDate && d.localDate <= dateWindow.toDate,
      ),
    [dateWindow.fromDate, dateWindow.toDate, diaryEntries],
  );

  const diaryStats = useMemo(
    () => redactDiaryEntriesForAi(rangedDiaries),
    [rangedDiaries],
  );

  const loadInitialData = useCallback(async () => {
    try {
      const [configRec, audits, schedStats, habitsWithStats, periodStats, loadedDiaries] =
        await Promise.all([
          aiStorage.getConfigRecord(),
          aiStorage.listRequestAudits(),
          scheduleService.getWeekAndMonthStats(today),
          habitService.listHabitsWithStats(today),
          habitService.getPeriodStats(today, 'month'),
          diaryService.listEntries().catch(() => [] as DecryptedDiaryEntry[]),
        ]);

      setProvider(configRec.provider);
      setBaseUrl(configRec.baseUrl);
      setModel(configRec.model);
      setHasEncryptedKey(configRec.hasApiKey);
      setAuditHistory(audits);
      setDiaryEntries(loadedDiaries);

      setScheduleSummary({
        weekExpected: schedStats.week.expectedCount,
        weekCompleted: schedStats.week.completedCount,
        weekRate: schedStats.week.completionRate,
        monthExpected: schedStats.month.expectedCount,
        monthCompleted: schedStats.month.completedCount,
        monthRate: schedStats.month.completionRate,
      });

      const maxCurrentStreak = habitsWithStats.reduce(
        (m, h) => Math.max(m, h.streak.currentStreak),
        0,
      );
      const maxLongestStreak = habitsWithStats.reduce(
        (m, h) => Math.max(m, h.streak.longestStreak),
        0,
      );

      setHabitSummary({
        activeHabitCount: habitsWithStats.length,
        habitCompletedCount: periodStats.habitCompletedCount,
        scheduleCompletedCount: periodStats.scheduleCompletedCount,
        combinedCompletedCount: periodStats.combinedCompletedCount,
        maxCurrentStreak,
        maxLongestStreak,
      });

      if (runtime && status === 'unlocked') {
        const [repoBills, repoCategories] = await Promise.all([
          runtime.billRepository.list(),
          runtime.categoryRepository.list(),
        ]);
        setLoadedBills(repoBills);
        const map = new Map<string, string>();
        for (const cat of repoCategories) {
          map.set(cat.id, cat.name);
        }
        setCategoryMap(map);
      }
    } catch {
      // 忽略初始化非致命异常
    }
  }, [aiStorage, diaryService, habitService, runtime, scheduleService, status, today]);

  useEffect(() => {
    void loadInitialData();
  }, [loadInitialData]);

  const promptContext: AiPromptContext = useMemo(() => {
    const rawAll = storeBills.length > 0 ? storeBills : loadedBills;
    const billsToRedact = effectiveBills.length > 0 ? effectiveBills : rawAll;
    const redactedBills = redactBillsForAi(billsToRedact, categoryMap);
    return {
      redactedBills,
      scheduleStats: scheduleSummary,
      habitStats: habitSummary,
      diaryStats,
      topic: selectedTopic,
      fromDate: dateWindow.fromDate,
      toDate: dateWindow.toDate,
    };
  }, [
    categoryMap,
    dateWindow.fromDate,
    dateWindow.toDate,
    diaryStats,
    effectiveBills,
    habitSummary,
    loadedBills,
    scheduleSummary,
    selectedTopic,
    storeBills,
  ]);

  const builtPrompt = useMemo(
    () => buildLifeReviewPrompt(promptContext),
    [promptContext],
  );

  const upsertSession = useCallback(
    (
      updater: (current: AiChatSession) => AiChatSession,
      customTitle?: string,
    ): AiChatSession => {
      const nowIso = new Date().toISOString();
      let target = sessions.find((s) => s.id === activeSessionId);
      if (!target) {
        target = {
          id: createSessionId(),
          title:
            customTitle ||
            `${AI_TOPIC_META[selectedTopic].label} (${dateWindow.label})`,
          topic: selectedTopic,
          timeRange,
          fromDate: dateWindow.fromDate,
          toDate: dateWindow.toDate,
          createdAt: nowIso,
          updatedAt: nowIso,
          messages: [],
        };
      }
      const updated = updater({ ...target, updatedAt: nowIso });
      const nextSessions = [
        updated,
        ...sessions.filter((s) => s.id !== updated.id),
      ];
      setSessions(nextSessions);
      setActiveSessionId(updated.id);
      saveSessionsToLocal(nextSessions);
      return updated;
    },
    [activeSessionId, dateWindow.fromDate, dateWindow.label, dateWindow.toDate, selectedTopic, sessions, timeRange],
  );

  const handleNewSession = () => {
    const nowIso = new Date().toISOString();
    const newSession: AiChatSession = {
      id: createSessionId(),
      title: `${AI_TOPIC_META[selectedTopic].label} · ${dateWindow.label}`,
      topic: selectedTopic,
      timeRange,
      fromDate: dateWindow.fromDate,
      toDate: dateWindow.toDate,
      createdAt: nowIso,
      updatedAt: nowIso,
      messages: [],
    };
    const next = [newSession, ...sessions];
    setSessions(next);
    setActiveSessionId(newSession.id);
    setAnalysisOutput('');
    saveSessionsToLocal(next);
  };

  const handleSelectSession = (session: AiChatSession) => {
    setActiveSessionId(session.id);
    setSelectedTopic(session.topic);
    setTimeRange(session.timeRange);
    const lastAssistant = [...session.messages]
      .reverse()
      .find((m) => m.role === 'assistant');
    setAnalysisOutput(lastAssistant?.content ?? '');
  };

  const handleDeleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = sessions.filter((s) => s.id !== id);
    setSessions(next);
    saveSessionsToLocal(next);
    if (activeSessionId === id) {
      setActiveSessionId(next[0]?.id ?? null);
      setAnalysisOutput('');
    }
  };

  const syncFormConfigIfNeeded = useCallback(async () => {
    const trimmedKey = apiKeyInput.trim();
    const existing = await aiStorage.getConfigRecord();
    if (
      trimmedKey.length > 0 ||
      existing.provider !== provider ||
      existing.baseUrl !== baseUrl.trim() ||
      existing.model !== model.trim()
    ) {
      const updated = await aiStorage.saveConfig({
        provider,
        baseUrl,
        model,
        ...(trimmedKey.length > 0 ? { apiKey: trimmedKey } : {}),
      });
      setProvider(updated.provider);
      setBaseUrl(updated.baseUrl);
      setModel(updated.model);
      setHasEncryptedKey(updated.hasApiKey);
      if (trimmedKey.length > 0) {
        setApiKeyInput('');
      }
    }
  }, [aiStorage, apiKeyInput, baseUrl, model, provider]);

  const handleSaveConfig = async () => {
    try {
      setErrorMsg(null);
      const updated = await aiStorage.saveConfig({
        provider,
        baseUrl,
        model,
        ...(apiKeyInput.trim().length > 0 ? { apiKey: apiKeyInput.trim() } : {}),
      });
      setProvider(updated.provider);
      setBaseUrl(updated.baseUrl);
      setModel(updated.model);
      setHasEncryptedKey(updated.hasApiKey);
      setApiKeyInput('');
      setSaveSuccessMsg('AI 接口与密钥配置已通过 WebCrypto AES-GCM 加密保存至本地');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '保存配置失败');
    }
  };

  /**
   * 构建系统自动生成的首条脱敏上下文消息（在会话流中折叠展示系统发给 AI 的脱敏 Prompt）。
   */
  const buildSystemContextUserBubble = (actionLabel: string): AiChatMessage => ({
    role: 'user',
    isSystemPromptContext: true,
    timestamp: new Date().toISOString(),
    content: [
      `已注入系统脱敏数据 Prompt · ${AI_TOPIC_META[selectedTopic].label} | ${dateWindow.label}（${dateWindow.fromDate} ~ ${dateWindow.toDate} · ${actionLabel}）`,
      '',
      builtPrompt.userPrompt,
    ].join('\n'),
  });

  const handleLocalSummary = async () => {
    try {
      setAnalyzing(true);
      setErrorMsg(null);
      const sysUserBubble = buildSystemContextUserBubble('本地智能复盘');
      const result = await executeLocalSmartAnalysis(promptContext, { storage: aiStorage });
      setAnalysisOutput(result.replyText);
      upsertSession((cur) => ({
        ...cur,
        topic: selectedTopic,
        timeRange,
        messages: [
          ...cur.messages,
          sysUserBubble,
          {
            role: 'assistant',
            content: result.replyText,
            timestamp: new Date().toISOString(),
          },
        ],
      }));
      const audits = await aiStorage.listRequestAudits();
      setAuditHistory(audits);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '生成本地智能总结失败');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleRemoteAnalyze = async () => {
    try {
      setAnalyzing(true);
      setErrorMsg(null);
      await syncFormConfigIfNeeded();
      const sysUserBubble = buildSystemContextUserBubble('发送脱敏 Prompt 至 AI 模型');
      const result = await executeRemoteAiAnalysis(builtPrompt, { storage: aiStorage });
      setAnalysisOutput(result.replyText);
      upsertSession((cur) => ({
        ...cur,
        topic: selectedTopic,
        timeRange,
        messages: [
          ...cur.messages,
          sysUserBubble,
          {
            role: 'assistant',
            content: result.replyText,
            timestamp: new Date().toISOString(),
          },
        ],
      }));
      const audits = await aiStorage.listRequestAudits();
      setAuditHistory(audits);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '远程 AI 分析请求失败';
      setErrorMsg(msg);
      const audits = await aiStorage.listRequestAudits();
      setAuditHistory(audits);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSendChat = async (overrideQuestion?: string) => {
    const question = (overrideQuestion ?? chatInput).trim();
    if (!question || analyzing) return;
    if (!overrideQuestion) {
      setChatInput('');
    }

    const prefixMessages: AiChatMessage[] =
      currentMessages.length === 0
        ? [buildSystemContextUserBubble('自动注入脱敏上下文')]
        : [];

    const userMsg: AiChatMessage = {
      role: 'user',
      content: question,
      timestamp: new Date().toISOString(),
    };
    const nextHistory: AiChatMessage[] = [...currentMessages, ...prefixMessages, userMsg];

    upsertSession(
      (cur) => ({
        ...cur,
        title:
          cur.messages.length === 0
            ? `${AI_TOPIC_META[selectedTopic].icon} ${question.slice(0, 18)}`
            : cur.title,
        topic: selectedTopic,
        timeRange,
        messages: nextHistory,
      }),
      `${AI_TOPIC_META[selectedTopic].icon} ${question.slice(0, 18)}`,
    );

    try {
      setAnalyzing(true);
      setErrorMsg(null);
      await syncFormConfigIfNeeded();
      const result = await executeAiChatMessage(promptContext, nextHistory, {
        storage: aiStorage,
      });
      setAnalysisOutput(result.replyText);
      upsertSession((cur) => ({
        ...cur,
        messages: [
          ...nextHistory,
          {
            role: 'assistant',
            content: result.replyText,
            timestamp: new Date().toISOString(),
          },
        ],
      }));
      const audits = await aiStorage.listRequestAudits();
      setAuditHistory(audits);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '发送对话请求失败';
      setErrorMsg(msg);
      upsertSession((cur) => ({
        ...cur,
        messages: [
          ...nextHistory,
          {
            role: 'assistant',
            content: `> ⚠️ **请求未调通**：${msg}\n\n请点击左下角「⚙️ 模型与 DeepSeek Key 设置」检查 API Key 或网络状态。`,
            timestamp: new Date().toISOString(),
          },
        ],
      }));
      const audits = await aiStorage.listRequestAudits();
      setAuditHistory(audits);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleCopyMessage = (text: string, idx: number) => {
    try {
      void navigator.clipboard?.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    } catch {
      // 忽略剪贴板权限异常
    }
  };

  const isReasonerModel = model === 'deepseek-reasoner';

  return (
    <Box data-testid="ai-page" sx={{ width: '100%' }}>
      {errorMsg && (
        <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setErrorMsg(null)}>
          {errorMsg}
        </Alert>
      )}

      {saveSuccessMsg && (
        <Alert severity="success" sx={{ mb: 1.5 }} onClose={() => setSaveSuccessMsg(null)}>
          {saveSuccessMsg}
        </Alert>
      )}

      {/* 1:1 DeepSeek 网页风格固定视口高度聊天主容器（内部独立滚动，绝不撑长整个网页） */}
      <Paper
        variant="outlined"
        data-testid="ai-quick-summary-card"
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          height: { xs: 'calc(100vh - 135px)', md: 'calc(100vh - 108px)' },
          minHeight: 540,
          maxHeight: 920,
          borderRadius: 3.5,
          overflow: 'hidden',
          backgroundColor: 'var(--lifehub-surface)',
          borderColor: 'var(--lifehub-border)',
          mb: 2,
          boxShadow: '0 4px 24px rgba(15, 23, 42, 0.04)',
        }}
      >
        {/* 左侧：DeepSeek 风格会话历史侧边栏 */}
        <Box
          data-testid="ai-sessions-sidebar"
          sx={{
            width: { xs: '100%', md: 240 },
            flexShrink: 0,
            borderRight: { xs: 'none', md: '1px solid var(--lifehub-border)' },
            borderBottom: { xs: '1px solid var(--lifehub-border)', md: 'none' },
            p: 1.75,
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'var(--lifehub-bg)',
          }}
        >
          <Button
            variant="contained"
            fullWidth
            startIcon={<AddCommentOutlined />}
            onClick={handleNewSession}
            data-testid="ai-new-session-button"
            sx={{
              mb: 1.75,
              borderRadius: 2.5,
              py: 0.95,
              fontWeight: 700,
              textTransform: 'none',
              boxShadow: 'none',
            }}
          >
            开启新对话
          </Button>

          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.75, px: 0.5 }}>
            <HistoryOutlined sx={{ fontSize: 15, color: 'var(--lifehub-text-muted)' }} />
            <Typography variant="caption" sx={{ fontWeight: 700, color: 'var(--lifehub-text-muted)' }}>
              历史对话 ({sessions.length})
            </Typography>
          </Stack>

          <Stack
            spacing={0.5}
            sx={{
              flex: 1,
              maxHeight: { xs: 110, md: 'none' },
              overflowY: 'auto',
              pr: 0.25,
            }}
            data-testid="ai-session-list"
          >
            {sessions.length === 0 ? (
              <Typography
                variant="caption"
                sx={{ color: 'var(--lifehub-text-muted)', py: 3, px: 1, textAlign: 'center', lineHeight: 1.6 }}
              >
                暂无历史会话
                <br />
                选择模块并提问即可开启分析
              </Typography>
            ) : (
              sessions.map((sess) => {
                const isSelected = sess.id === activeSessionId;
                return (
                  <Box
                    key={sess.id}
                    onClick={() => handleSelectSession(sess)}
                    data-testid={`ai-session-item-${sess.id}`}
                    sx={{
                      px: 1.25,
                      py: 0.9,
                      borderRadius: 2,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      backgroundColor: isSelected ? 'var(--lifehub-surface)' : 'transparent',
                      border: isSelected
                        ? '1px solid var(--lifehub-border)'
                        : '1px solid transparent',
                      transition: 'all 0.15s ease',
                      '&:hover': {
                        backgroundColor: 'var(--lifehub-surface)',
                      },
                    }}
                  >
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography
                        variant="body2"
                        noWrap
                        sx={{ fontWeight: isSelected ? 700 : 500, fontSize: 13 }}
                      >
                        {sess.title}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{ color: 'var(--lifehub-text-muted)', fontSize: 11 }}
                      >
                        {sess.fromDate.slice(5)} ~ {sess.toDate.slice(5)}
                      </Typography>
                    </Box>
                    <IconButton
                      size="small"
                      onClick={(e) => handleDeleteSession(sess.id, e)}
                      aria-label="删除会话"
                      sx={{ opacity: 0.65, '&:hover': { opacity: 1 } }}
                    >
                      <DeleteOutline sx={{ fontSize: 15 }} />
                    </IconButton>
                  </Box>
                );
              })
            )}
          </Stack>

          <Divider sx={{ my: 1.25 }} />

          <Stack spacing={0.5}>
            <Button
              size="small"
              variant="text"
              startIcon={<VisibilityOutlined fontSize="small" />}
              onClick={() => setShowPromptDrawer((prev) => !prev)}
              data-testid="ai-toggle-prompt-preview-button"
              sx={{ justifyContent: 'flex-start', fontSize: 12, color: 'var(--lifehub-text-muted)' }}
            >
              {showPromptDrawer ? '隐藏底层脱敏 Prompt' : '查看底层脱敏 Prompt'}
            </Button>
            <Button
              size="small"
              variant="text"
              startIcon={<SettingsOutlined fontSize="small" />}
              onClick={() => setAdvancedOpen((prev) => !prev)}
              data-testid="ai-toggle-advanced-button"
              sx={{ justifyContent: 'flex-start', fontSize: 12, fontWeight: 600 }}
            >
              {advancedOpen ? '收起 API Key 设置' : '模型与 DeepSeek Key 设置'}
            </Button>
          </Stack>
        </Box>

        {/* 右侧：DeepSeek 网页风格主对话区 */}
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            height: '100%',
            overflow: 'hidden',
          }}
        >
          {/* 顶部极简状态栏：分析模块切换 + 数据时间段选择（最长半年） + 强制脱敏标识 */}
          <Stack
            direction={{ xs: 'column', lg: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', lg: 'center' }}
            spacing={1}
            sx={{
              px: { xs: 2, sm: 3 },
              py: 1.25,
              borderBottom: '1px solid var(--lifehub-border)',
              flexShrink: 0,
              backgroundColor: 'var(--lifehub-surface)',
            }}
          >
            {/* 模块选择胶囊 */}
            <Stack
              direction="row"
              spacing={0.75}
              flexWrap="wrap"
              useFlexGap
              data-testid="ai-topic-selector"
            >
              {(Object.keys(AI_TOPIC_META) as AiAnalysisTopic[]).map((topicKey) => {
                const meta = AI_TOPIC_META[topicKey];
                const active = selectedTopic === topicKey;
                return (
                  <Chip
                    key={topicKey}
                    label={`${meta.icon} ${meta.label}`}
                    color={active ? 'primary' : 'default'}
                    variant={active ? 'filled' : 'outlined'}
                    size="small"
                    onClick={() => setSelectedTopic(topicKey)}
                    data-testid={`ai-topic-chip-${topicKey}`}
                    sx={{ cursor: 'pointer', fontWeight: active ? 700 : 500, borderRadius: 2 }}
                  />
                );
              })}
            </Stack>

            {/* 数据时间段选择（最长半年） + 强制脱敏锁定徽章 */}
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel id="ai-time-range-label">数据时间段（最长半年）</InputLabel>
                <Select
                  labelId="ai-time-range-label"
                  label="数据时间段（最长半年）"
                  value={timeRange}
                  onChange={(e) => setTimeRange(e.target.value as AiTimeRangePreset)}
                  data-testid="ai-time-range-select"
                  sx={{ borderRadius: 2, fontSize: 13 }}
                >
                  {AI_TIME_RANGE_OPTIONS.map((opt) => (
                    <MenuItem key={opt.value} value={opt.value} sx={{ fontSize: 13 }}>
                      {opt.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Chip
                icon={<LockOutlined sx={{ fontSize: 13 }} />}
                size="small"
                color="success"
                variant="outlined"
                data-testid="ai-mandatory-redaction-chip"
                label="强制全量脱敏"
                sx={{ fontWeight: 600, fontSize: 11.5 }}
              />
            </Stack>
          </Stack>

          {/* 中间：独立滚动消息流（发送或收到消息自动平滑滚到底部） */}
          <Box
            ref={chatScrollContainerRef}
            data-testid="ai-chat-history"
            sx={{
              flex: 1,
              overflowY: 'auto',
              px: { xs: 2, sm: 3.5 },
              py: 2.5,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Box
              sx={{
                width: '100%',
                maxWidth: 820,
                mx: 'auto',
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              {currentMessages.length === 0 ? (
                /* DeepSeek 网页风居中欢迎引导页 */
                <Box
                  sx={{
                    my: 'auto',
                    textAlign: 'center',
                    maxWidth: 600,
                    mx: 'auto',
                    py: 3,
                  }}
                >
                  <Box
                    sx={{
                      width: 52,
                      height: 52,
                      borderRadius: '16px',
                      backgroundColor: 'rgba(99, 102, 241, 0.1)',
                      color: 'primary.main',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 26,
                      mb: 1.5,
                    }}
                  >
                    {AI_TOPIC_META[selectedTopic].icon}
                  </Box>
                  <Typography variant="h6" sx={{ fontWeight: 800, mb: 0.75 }}>
                    我是 LifeHub · DeepSeek 智能复盘顾问
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ color: 'var(--lifehub-text-muted)', mb: 2.5, lineHeight: 1.7 }}
                  >
                    当前模块：<strong>{AI_TOPIC_META[selectedTopic].label}</strong> · 数据范围：
                    <strong>{dateWindow.label}</strong>（{dateWindow.fromDate} ~ {dateWindow.toDate}）
                    <br />
                    系统已自动将该时间段内的账单、课表、习惯与树洞数据<strong>本地强制脱敏</strong>，可直接发起深度分析或自由提问。
                  </Typography>

                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1.25}
                    justifyContent="center"
                    sx={{ mb: 3 }}
                  >
                    <Button
                      variant="contained"
                      color="primary"
                      disabled={analyzing}
                      onClick={() => void handleRemoteAnalyze()}
                      data-testid="ai-remote-analyze-button"
                      sx={{ borderRadius: 2.5, px: 3, py: 1, fontWeight: 700, textTransform: 'none' }}
                    >
                      🚀 发送脱敏数据给 DeepSeek 深度分析
                    </Button>
                    <Button
                      variant="outlined"
                      color="secondary"
                      disabled={analyzing}
                      onClick={() => void handleLocalSummary()}
                      data-testid="ai-local-summary-button"
                      sx={{ borderRadius: 2.5, px: 2.5, py: 1, fontWeight: 600, textTransform: 'none' }}
                    >
                      ⚡ 生成本地秒级总结（免联网）
                    </Button>
                  </Stack>

                  {/* 预设快捷追问胶囊 */}
                  <Stack spacing={1} alignItems="center">
                    <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
                      猜你想问（点击直接发送）：
                    </Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" justifyContent="center" useFlexGap>
                      {AI_TOPIC_META[selectedTopic].starterQuestions.map((q, idx) => (
                        <Chip
                          key={idx}
                          label={`💬 ${q}`}
                          variant="outlined"
                          onClick={() => void handleSendChat(q)}
                          data-testid={`ai-starter-question-${idx}`}
                          sx={{
                            cursor: 'pointer',
                            borderRadius: 2,
                            py: 0.5,
                            '&:hover': { borderColor: 'primary.main' },
                          }}
                        />
                      ))}
                    </Stack>
                  </Stack>
                </Box>
              ) : (
                currentMessages.map((msg, idx) => {
                  if (msg.isSystemPromptContext) {
                    return <SystemPromptContextCard key={idx} content={msg.content} />;
                  }

                  if (msg.role === 'user') {
                    return (
                      <Box
                        key={idx}
                        sx={{
                          alignSelf: 'flex-end',
                          maxWidth: { xs: '88%', sm: '75%' },
                          px: 2.25,
                          py: 1.25,
                          borderRadius: '20px 20px 4px 20px',
                          backgroundColor: 'primary.main',
                          color: '#fff',
                          fontSize: 14,
                          lineHeight: 1.65,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          boxShadow: '0 2px 8px rgba(99, 102, 241, 0.18)',
                        }}
                      >
                        {msg.content}
                      </Box>
                    );
                  }

                  // AI 顾问回复：采用 DeepSeek 网页端左侧头像 + 右侧 Markdown 富文本排版 + 底部复制/重试工具栏
                  return (
                    <Stack
                      key={idx}
                      direction="row"
                      spacing={1.5}
                      alignItems="flex-start"
                      sx={{ width: '100%', py: 0.5 }}
                    >
                      <Box
                        sx={{
                          width: 32,
                          height: 32,
                          borderRadius: '10px',
                          backgroundColor: 'rgba(99, 102, 241, 0.12)',
                          color: 'primary.main',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          mt: 0.25,
                        }}
                      >
                        <AutoAwesomeOutlined sx={{ fontSize: 18 }} />
                      </Box>

                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                          <Typography variant="caption" sx={{ fontWeight: 700, color: 'var(--lifehub-text)' }}>
                            DeepSeek / LifeHub AI 顾问
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)', fontSize: 11 }}>
                            {AI_TOPIC_META[selectedTopic].label}
                          </Typography>
                        </Stack>

                        <Paper
                          variant="outlined"
                          sx={{
                            p: { xs: 1.75, sm: 2.25 },
                            borderRadius: 3,
                            backgroundColor: 'var(--lifehub-bg)',
                            borderColor: 'var(--lifehub-border)',
                          }}
                        >
                          <AiMarkdownRenderer content={msg.content} />

                          <Stack
                            direction="row"
                            spacing={1}
                            alignItems="center"
                            sx={{
                              mt: 1.5,
                              pt: 1,
                              borderTop: '1px dashed var(--lifehub-border)',
                            }}
                          >
                            <Tooltip title={copiedIdx === idx ? '已复制' : '复制 Markdown 内容'}>
                              <Button
                                size="small"
                                variant="text"
                                startIcon={<ContentCopyOutlined sx={{ fontSize: 14 }} />}
                                onClick={() => handleCopyMessage(msg.content, idx)}
                                sx={{ fontSize: 11.5, py: 0.2, px: 0.75, color: 'var(--lifehub-text-muted)' }}
                              >
                                {copiedIdx === idx ? '已复制' : '复制'}
                              </Button>
                            </Tooltip>

                            {idx === currentMessages.length - 1 && (
                              <Button
                                size="small"
                                variant="text"
                                startIcon={<RefreshOutlined sx={{ fontSize: 14 }} />}
                                disabled={analyzing}
                                onClick={() => void handleRemoteAnalyze()}
                                sx={{ fontSize: 11.5, py: 0.2, px: 0.75, color: 'var(--lifehub-text-muted)' }}
                              >
                                重新深度分析
                              </Button>
                            )}
                          </Stack>
                        </Paper>
                      </Box>
                    </Stack>
                  );
                })
              )}

              {/* 实时思考中动画气泡（发送后立即呈现在最底部并自动滚入视野） */}
              {analyzing && (
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 1 }}>
                  <Box
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: '10px',
                      backgroundColor: 'rgba(99, 102, 241, 0.12)',
                      color: 'primary.main',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <CircularProgress size={16} thickness={5} />
                  </Box>
                  <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)', fontWeight: 500 }}>
                    DeepSeek 正在基于您的脱敏数据进行结构化分析，请稍候…
                  </Typography>
                </Stack>
              )}

              {/* 保留 data-testid="ai-analysis-output" 兼容回归校验 */}
              {analysisOutput && (
                <Box
                  data-testid="ai-analysis-output"
                  sx={{ display: 'none', whiteSpace: 'pre-wrap' }}
                >
                  {analysisOutput}
                </Box>
              )}

              <Box ref={chatBottomAnchorRef} sx={{ height: 4 }} />
            </Box>
          </Box>

          {/* 底部：1:1 DeepSeek 网页风大圆角悬浮输入舱（Composer） */}
          <Box
            data-testid="ai-chat-panel"
            sx={{
              px: { xs: 1.5, sm: 3 },
              pb: 2,
              pt: 1,
              backgroundColor: 'var(--lifehub-surface)',
              flexShrink: 0,
            }}
          >
            <Paper
              variant="outlined"
              sx={{
                maxWidth: 820,
                mx: 'auto',
                p: 1.25,
                borderRadius: 3.5,
                backgroundColor: 'var(--lifehub-bg)',
                borderColor: 'var(--lifehub-border)',
                transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
                '&:focus-within': {
                  borderColor: 'primary.main',
                  boxShadow: '0 0 0 3px rgba(99, 102, 241, 0.12)',
                },
              }}
            >
              <TextField
                size="small"
                fullWidth
                multiline
                minRows={1}
                maxRows={4}
                variant="standard"
                placeholder={`给 DeepSeek 发送消息（当前：${AI_TOPIC_META[selectedTopic].label} · ${dateWindow.label}脱敏数据，Enter 发送 / Shift+Enter 换行）…`}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSendChat();
                  }
                }}
                InputProps={{
                  disableUnderline: true,
                  sx: { px: 1, py: 0.5, fontSize: 14, lineHeight: 1.6 },
                }}
                inputProps={{ 'data-testid': 'ai-chat-input' }}
              />

              {/* 输入框底栏：模仿 DeepSeek 网页版的「深度思考 (R1)」开关胶囊 + 快捷复盘 + 发送按钮 */}
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                spacing={1}
                sx={{ mt: 1, pt: 0.75, px: 0.5 }}
              >
                <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Chip
                    icon={<PsychologyOutlined sx={{ fontSize: 15 }} />}
                    size="small"
                    label="深度思考 (R1)"
                    color={isReasonerModel ? 'primary' : 'default'}
                    variant={isReasonerModel ? 'filled' : 'outlined'}
                    onClick={() => {
                      const nextModel = isReasonerModel ? 'deepseek-chat' : 'deepseek-reasoner';
                      setProvider('deepseek');
                      setBaseUrl('https://api.deepseek.com');
                      setModel(nextModel);
                    }}
                    sx={{
                      cursor: 'pointer',
                      borderRadius: 2,
                      fontWeight: isReasonerModel ? 700 : 500,
                      fontSize: 12,
                    }}
                  />

                  <Button
                    size="small"
                    variant="text"
                    disabled={analyzing}
                    onClick={() => void handleRemoteAnalyze()}
                    sx={{ fontSize: 12, textTransform: 'none', py: 0.25 }}
                  >
                    🚀 一键生成本模块复盘
                  </Button>

                  <Button
                    size="small"
                    variant="text"
                    color="secondary"
                    disabled={analyzing}
                    onClick={() => void handleLocalSummary()}
                    sx={{ fontSize: 12, textTransform: 'none', py: 0.25 }}
                  >
                    本地总结
                  </Button>
                </Stack>

                <Button
                  variant="contained"
                  disabled={analyzing || chatInput.trim().length === 0}
                  onClick={() => void handleSendChat()}
                  endIcon={<SendOutlined sx={{ fontSize: 15 }} />}
                  data-testid="ai-chat-send-button"
                  sx={{
                    whiteSpace: 'nowrap',
                    px: 2.25,
                    py: 0.65,
                    borderRadius: 2.5,
                    fontWeight: 700,
                    textTransform: 'none',
                    boxShadow: 'none',
                  }}
                >
                  {analyzing ? '思考中' : '发送'}
                </Button>
              </Stack>
            </Paper>
          </Box>
        </Box>
      </Paper>

      {/* 系统自动构造的脱敏 Prompt 预览区（默认折叠，同时保留 data-testid="ai-redacted-preview"） */}
      <Paper
        variant="outlined"
        data-testid="ai-redacted-preview"
        sx={{
          display: showPromptDrawer ? 'block' : 'none',
          p: { xs: 2, sm: 2.5 },
          mb: 2.5,
          borderRadius: 3,
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          spacing={1}
          sx={{ mb: 1.5 }}
        >
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              发送前强制脱敏摘要与系统构建 Prompt 预览（X-14 隐私保护）
            </Typography>
            <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
              精确金额已强制替换为分桶区间，真实商户名已替换为匿名代号（商户 A / B），树洞文本已自动抹除手机号、邮箱、证件号与金额数字
            </Typography>
          </Box>
          <Chip size="small" variant="outlined" label={`模板: ${builtPrompt.promptTemplateId}`} />
        </Stack>

        <Box
          component="pre"
          data-testid="ai-prompt-preview-box"
          sx={{
            p: 1.5,
            borderRadius: 1.5,
            backgroundColor: 'var(--lifehub-bg)',
            border: '1px solid var(--lifehub-border)',
            fontSize: 12,
            maxHeight: 240,
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            m: 0,
          }}
        >
          {builtPrompt.fullPreviewText}
        </Box>
      </Paper>

      {/* 模型与 DeepSeek / OpenAI API Key 配置抽屉（默认折叠） */}
      <Box sx={{ display: advancedOpen ? 'block' : 'none' }} data-testid="ai-advanced-section">
        <Paper
          variant="outlined"
          data-testid="ai-config-card"
          sx={{ p: { xs: 2, sm: 2.5 }, mb: 2.5, borderRadius: 3 }}
        >
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', sm: 'center' }}
            spacing={1}
            sx={{ mb: 2 }}
          >
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              模型端点与 API Key 配置（支持 DeepSeek 官方接口 · 本地 AES-GCM 加密）
            </Typography>
            <Chip
              size="small"
              color={hasEncryptedKey ? 'success' : 'default'}
              label={
                hasEncryptedKey
                  ? '🔒 密钥已本地 AES-GCM 加密存储 · 不进入同步包'
                  : '未配置远程密钥（默认使用零网络本地顾问）'
              }
              data-testid="ai-key-status-chip"
            />
          </Stack>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel id="ai-provider-label">接口类型</InputLabel>
              <Select
                labelId="ai-provider-label"
                label="接口类型"
                value={provider}
                onChange={(e) => {
                  const next = e.target.value as AiProviderType;
                  setProvider(next);
                  if (next === 'deepseek') {
                    setBaseUrl('https://api.deepseek.com');
                    setModel('deepseek-chat');
                  } else if (next === 'ollama') {
                    setBaseUrl('http://localhost:11434');
                    setModel('qwen2.5:7b');
                  } else if (next === 'openai-compatible') {
                    setBaseUrl('https://api.openai.com/v1');
                    setModel('gpt-4o-mini');
                  }
                }}
                data-testid="ai-provider-select"
              >
                <MenuItem value="deepseek">DeepSeek 官方接口 (deepseek-chat / reasoner)</MenuItem>
                <MenuItem value="openai-compatible">OpenAI 兼容接口</MenuItem>
                <MenuItem value="ollama">Ollama 本地模型</MenuItem>
              </Select>
            </FormControl>

            <TextField
              label="Base URL"
              size="small"
              fullWidth
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              inputProps={{ 'data-testid': 'ai-baseurl-input' }}
            />

            <TextField
              label="模型名称 (Model)"
              size="small"
              fullWidth
              value={model}
              onChange={(e) => setModel(e.target.value)}
              inputProps={{ 'data-testid': 'ai-model-input' }}
            />

            <TextField
              label={hasEncryptedKey ? '更新 API Key（留空保持已加密密钥）' : 'API Key（如 sk-...）'}
              type="password"
              size="small"
              fullWidth
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              inputProps={{ 'data-testid': 'ai-apikey-input' }}
            />
          </Stack>

          {provider === 'deepseek' && (
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ mb: 1.5 }}
              data-testid="ai-deepseek-model-presets"
            >
              <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
                DeepSeek 快捷模型：
              </Typography>
              <Chip
                size="small"
                label="deepseek-chat (V3)"
                color={model === 'deepseek-chat' ? 'primary' : 'default'}
                variant={model === 'deepseek-chat' ? 'filled' : 'outlined'}
                onClick={() => setModel('deepseek-chat')}
                sx={{ cursor: 'pointer' }}
              />
              <Chip
                size="small"
                label="deepseek-reasoner (R1)"
                color={model === 'deepseek-reasoner' ? 'primary' : 'default'}
                variant={model === 'deepseek-reasoner' ? 'filled' : 'outlined'}
                onClick={() => setModel('deepseek-reasoner')}
                sx={{ cursor: 'pointer' }}
              />
            </Stack>
          )}

          <Button
            variant="contained"
            size="small"
            onClick={() => void handleSaveConfig()}
            data-testid="ai-save-config-button"
          >
            加密保存配置
          </Button>
        </Paper>

        {/* E-04 / X-13：请求审计指标历史表 */}
        <Paper
          variant="outlined"
          data-testid="ai-request-history"
          sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: 3 }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
            AI 请求审计指标记录（X-13：仅存 SHA-256 摘要与性能指标）
          </Typography>
          <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)', display: 'block', mb: 1.5 }}>
            共 {auditHistory.length} 条请求指标记录
          </Typography>

          {auditHistory.length > 0 && (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>时间</TableCell>
                    <TableCell>提供方 / 模型</TableCell>
                    <TableCell>Payload SHA-256 摘要</TableCell>
                    <TableCell>耗时</TableCell>
                    <TableCell>Token 用量</TableCell>
                    <TableCell>状态</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {auditHistory.map((item) => (
                    <TableRow key={item.id} data-testid={`ai-audit-row-${item.id}`}>
                      <TableCell>{item.at.slice(0, 19).replace('T', ' ')}</TableCell>
                      <TableCell>
                        {item.provider} / {item.model}
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                        {item.payloadDigest.slice(0, 16)}…
                      </TableCell>
                      <TableCell>{item.latencyMs} ms</TableCell>
                      <TableCell>{item.tokensUsed}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          color={item.status === 'success' ? 'success' : 'error'}
                          label={item.status === 'success' ? '成功' : item.errorCode || '失败'}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </Paper>
      </Box>
    </Box>
  );
}
