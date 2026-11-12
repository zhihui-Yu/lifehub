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
              {expanded ? '收起 Prompt' : '脱敏 Prompt'}
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
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);

  // 自动滚动到底部的引用
  const chatScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const chatBottomAnchorRef = useRef<HTMLDivElement | null>(null);
  const advancedSectionRef = useRef<HTMLDivElement | null>(null);

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

  const handleDeleteAuditRecord = async (id: string) => {
    try {
      await aiStorage.deleteRequestAudit(id);
      const audits = await aiStorage.listRequestAudits();
      setAuditHistory(audits);
    } catch {
      // 忽略删除异常
    }
  };

  const handleClearAuditHistory = async () => {
    try {
      await aiStorage.clearRequestAudits();
      setAuditHistory([]);
    } catch {
      // 忽略清空异常
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

      {/* 1:1 DeepSeek 风格固定视口高度聊天主容器（大留白、轻边框、内部独立平滑滚动） */}
      <Paper
        variant="outlined"
        data-testid="ai-quick-summary-card"
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          height: { xs: 'calc(100dvh - 122px)', md: 'calc(100vh - 104px)' },
          minHeight: { xs: 500, md: 580 },
          maxHeight: 940,
          width: '100%',
          maxWidth: '100%',
          borderRadius: { xs: 3, md: 4 },
          overflow: 'hidden',
          backgroundColor: 'var(--lifehub-surface)',
          borderColor: 'var(--lifehub-border)',
          mb: 2.5,
          boxShadow: '0 8px 32px rgba(15, 23, 42, 0.05)',
        }}
      >
        {/* 左侧：桌面端会话侧栏 / 移动端极简顶栏 */}
        <Box
          data-testid="ai-sessions-sidebar"
          sx={{
            width: { xs: '100%', md: 248 },
            flexShrink: 0,
            borderRight: { xs: 'none', md: '1px solid var(--lifehub-border)' },
            borderBottom: { xs: '1px solid var(--lifehub-border)', md: 'none' },
            px: { xs: 2, md: 2 },
            py: { xs: 1.25, md: 2.25 },
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'var(--lifehub-bg)',
          }}
        >
          {/* 顶行：新建对话 + 移动端抽屉入口 */}
          <Stack
            direction={{ xs: 'row', md: 'column' }}
            spacing={1}
            alignItems={{ xs: 'center', md: 'stretch' }}
            justifyContent="space-between"
          >
            <Button
              variant="contained"
              startIcon={<AddCommentOutlined sx={{ fontSize: 17 }} />}
              onClick={() => {
                handleNewSession();
                setMobileHistoryOpen(false);
              }}
              data-testid="ai-new-session-button"
              sx={{
                mb: { xs: 0, md: 1.75 },
                borderRadius: '999px',
                py: { xs: 0.65, md: 1 },
                px: { xs: 2, md: 2.25 },
                fontSize: { xs: 13, md: 13.5 },
                fontWeight: 700,
                textTransform: 'none',
                boxShadow: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              开启新对话
            </Button>

            {/* 移动端右侧轻巧入口：历史会话 + Key 设置 */}
            <Stack
              direction="row"
              spacing={0.75}
              alignItems="center"
              sx={{ display: { xs: 'flex', md: 'none' } }}
            >
              <Button
                size="small"
                variant={mobileHistoryOpen ? 'contained' : 'outlined'}
                color={mobileHistoryOpen ? 'primary' : 'inherit'}
                startIcon={<HistoryOutlined sx={{ fontSize: 15 }} />}
                onClick={() => setMobileHistoryOpen((prev) => !prev)}
                sx={{
                  borderRadius: '999px',
                  fontSize: 12.5,
                  py: 0.45,
                  px: 1.35,
                  textTransform: 'none',
                  borderColor: 'var(--lifehub-border)',
                  color: mobileHistoryOpen ? '#fff' : 'var(--lifehub-text)',
                }}
              >
                历史 ({sessions.length})
              </Button>
              <Button
                size="small"
                variant={advancedOpen ? 'contained' : 'outlined'}
                color={advancedOpen ? 'primary' : 'inherit'}
                startIcon={<SettingsOutlined sx={{ fontSize: 15 }} />}
                onClick={() => {
                  setAdvancedOpen((prev) => {
                    const next = !prev;
                    if (next) {
                      setTimeout(() => {
                        advancedSectionRef.current?.scrollIntoView?.({
                          behavior: 'smooth',
                          block: 'start',
                        });
                      }, 60);
                    }
                    return next;
                  });
                }}
                sx={{
                  borderRadius: '999px',
                  fontSize: 12.5,
                  py: 0.45,
                  px: 1.35,
                  textTransform: 'none',
                  borderColor: 'var(--lifehub-border)',
                  color: advancedOpen ? '#fff' : 'var(--lifehub-text)',
                }}
              >
                模型设置
              </Button>
            </Stack>
          </Stack>

          <Stack
            direction="row"
            spacing={0.75}
            alignItems="center"
            sx={{ display: { xs: 'none', md: 'flex' }, mb: 1, px: 0.5 }}
          >
            <HistoryOutlined sx={{ fontSize: 15, color: 'var(--lifehub-text-muted)' }} />
            <Typography variant="caption" sx={{ fontWeight: 700, color: 'var(--lifehub-text-muted)' }}>
              历史对话 ({sessions.length})
            </Typography>
          </Stack>

          <Stack
            spacing={0.75}
            sx={{
              display: { xs: mobileHistoryOpen ? 'flex' : 'none', md: 'flex' },
              flex: { xs: 'none', md: 1 },
              mt: { xs: 1.25, md: 0 },
              pt: { xs: 1.25, md: 0 },
              borderTop: { xs: '1px dashed var(--lifehub-border)', md: 'none' },
              maxHeight: { xs: 180, md: 'none' },
              overflowY: 'auto',
              pr: 0.25,
            }}
            data-testid="ai-session-list"
          >
            {sessions.length === 0 ? (
              <Typography
                variant="caption"
                sx={{ color: 'var(--lifehub-text-muted)', py: { xs: 1.5, md: 4 }, px: 1, textAlign: 'center', lineHeight: 1.7 }}
              >
                暂无历史会话
                <br />
                选择下方主题即可开启分析
              </Typography>
            ) : (
              sessions.map((sess) => {
                const isSelected = sess.id === activeSessionId;
                return (
                  <Box
                    key={sess.id}
                    onClick={() => {
                      handleSelectSession(sess);
                      setMobileHistoryOpen(false);
                    }}
                    data-testid={`ai-session-item-${sess.id}`}
                    sx={{
                      px: 1.5,
                      py: 1,
                      borderRadius: 2.5,
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
                        sx={{ fontWeight: isSelected ? 700 : 500, fontSize: 13.5 }}
                      >
                        {sess.title}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{ color: 'var(--lifehub-text-muted)', fontSize: 11.5 }}
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
                      <DeleteOutline sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Box>
                );
              })
            )}
          </Stack>

          <Divider sx={{ display: { xs: 'none', md: 'block' }, my: 1.5 }} />

          <Stack spacing={0.75} sx={{ display: { xs: 'none', md: 'flex' } }}>
            <Button
              size="small"
              variant="text"
              startIcon={<VisibilityOutlined fontSize="small" />}
              onClick={() => setShowPromptDrawer((prev) => !prev)}
              data-testid="ai-toggle-prompt-preview-button"
              sx={{ justifyContent: 'flex-start', fontSize: 12.5, py: 0.6, color: 'var(--lifehub-text-muted)', textTransform: 'none' }}
            >
              {showPromptDrawer ? '隐藏底层脱敏 Prompt' : '查看底层脱敏 Prompt'}
            </Button>
            <Button
              size="small"
              variant="text"
              startIcon={<SettingsOutlined fontSize="small" />}
              onClick={() => setAdvancedOpen((prev) => !prev)}
              data-testid="ai-toggle-advanced-button"
              sx={{ justifyContent: 'flex-start', fontSize: 12.5, py: 0.6, fontWeight: 600, textTransform: 'none' }}
            >
              {advancedOpen ? '收起 API Key 设置' : '模型与 DeepSeek Key 设置'}
            </Button>
          </Stack>
        </Box>

        {/* 右侧：DeepSeek 风格宽敞主对话区 */}
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            minHeight: 0,
            height: { xs: 'auto', md: '100%' },
            overflow: 'hidden',
          }}
        >
          {/* 顶部舒展控制栏：左侧分析维度胶囊（圆润间距充足） + 右侧轻量时间段选择 */}
          <Stack
            direction={{ xs: 'column', lg: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'stretch', lg: 'center' }}
            spacing={1.25}
            sx={{
              px: { xs: 2, sm: 3.5 },
              py: { xs: 1.35, sm: 1.75 },
              borderBottom: '1px solid var(--lifehub-border)',
              flexShrink: 0,
              backgroundColor: 'var(--lifehub-surface)',
            }}
          >
            {/* 模块选择胶囊（圆润大胶囊、充足间距、手机端平滑横滑） */}
            <Stack
              direction="row"
              spacing={1}
              flexWrap={{ xs: 'nowrap', md: 'wrap' }}
              useFlexGap
              data-testid="ai-topic-selector"
              sx={{
                overflowX: { xs: 'auto', md: 'visible' },
                maxWidth: '100%',
                py: 0.25,
                '&::-webkit-scrollbar': { display: 'none' },
                scrollbarWidth: 'none',
              }}
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
                    onClick={() => setSelectedTopic(topicKey)}
                    data-testid={`ai-topic-chip-${topicKey}`}
                    sx={{
                      cursor: 'pointer',
                      fontWeight: active ? 700 : 500,
                      borderRadius: '999px',
                      height: 32,
                      px: 0.5,
                      flexShrink: 0,
                      fontSize: 13,
                      borderColor: active ? 'primary.main' : 'var(--lifehub-border)',
                    }}
                  />
                );
              })}
            </Stack>

            {/* 数据时间段选择（去掉笨重的浮动 Label，改为干净清爽的圆角下拉框） + 强制脱敏徽章 */}
            <Stack
              direction="row"
              spacing={1.25}
              alignItems="center"
              justifyContent="space-between"
              sx={{ width: { xs: '100%', lg: 'auto' }, flexShrink: 0 }}
            >
              <FormControl size="small" sx={{ minWidth: 148 }}>
                <Select
                  displayEmpty
                  value={timeRange}
                  onChange={(e) => setTimeRange(e.target.value as AiTimeRangePreset)}
                  data-testid="ai-time-range-select"
                  sx={{
                    borderRadius: '999px',
                    fontSize: 13,
                    fontWeight: 600,
                    height: 32,
                    backgroundColor: 'var(--lifehub-bg)',
                    '& .MuiSelect-select': {
                      py: 0.5,
                      px: 1.75,
                    },
                  }}
                >
                  {AI_TIME_RANGE_OPTIONS.map((opt) => (
                    <MenuItem key={opt.value} value={opt.value} sx={{ fontSize: 13 }}>
                      📅 {opt.label}
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
                label="本地已脱敏"
                sx={{
                  fontWeight: 600,
                  fontSize: 12,
                  height: 30,
                  borderRadius: '999px',
                  px: 0.5,
                  flexShrink: 0,
                }}
              />
            </Stack>
          </Stack>

          {/* 中间：独立滚动消息流（宽敞呼吸感留白） */}
          <Box
            ref={chatScrollContainerRef}
            data-testid="ai-chat-history"
            sx={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              overflowX: 'hidden',
              px: { xs: 2, sm: 4 },
              py: { xs: 2.5, sm: 3.5 },
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Box
              sx={{
                width: '100%',
                maxWidth: 780,
                mx: 'auto',
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 2.75,
                minWidth: 0,
              }}
            >
              {currentMessages.length === 0 ? (
                /* DeepSeek 风格大留白欢迎页 */
                <Box
                  sx={{
                    my: 'auto',
                    textAlign: 'center',
                    maxWidth: 580,
                    width: '100%',
                    mx: 'auto',
                    py: { xs: 2, sm: 4 },
                  }}
                >
                  <Box
                    sx={{
                      width: 56,
                      height: 56,
                      borderRadius: '18px',
                      backgroundColor: 'rgba(99, 102, 241, 0.1)',
                      color: 'primary.main',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 28,
                      mb: 2,
                    }}
                  >
                    {AI_TOPIC_META[selectedTopic].icon}
                  </Box>
                  <Typography
                    variant="h6"
                    sx={{ fontWeight: 800, mb: 1, fontSize: { xs: '1.15rem', sm: '1.35rem' } }}
                  >
                    有什么可以帮您复盘？
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      color: 'var(--lifehub-text-muted)',
                      mb: 3,
                      lineHeight: 1.75,
                      fontSize: { xs: 13.5, sm: 14.5 },
                    }}
                  >
                    已就绪：<strong>{AI_TOPIC_META[selectedTopic].label}</strong> ·{' '}
                    <strong>{dateWindow.label}</strong>（{dateWindow.fromDate.slice(5)} 至{' '}
                    {dateWindow.toDate.slice(5)}）脱敏数据
                  </Typography>

                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1.5}
                    justifyContent="center"
                    sx={{ mb: 3.5 }}
                  >
                    <Button
                      variant="contained"
                      color="primary"
                      disabled={analyzing}
                      onClick={() => void handleRemoteAnalyze()}
                      data-testid="ai-remote-analyze-button"
                      sx={{
                        borderRadius: '14px',
                        px: 3,
                        py: 1.2,
                        fontWeight: 700,
                        textTransform: 'none',
                        fontSize: 14,
                        boxShadow: '0 4px 14px rgba(99, 102, 241, 0.22)',
                      }}
                    >
                      🚀 DeepSeek 深度分析报告
                    </Button>
                    <Button
                      variant="outlined"
                      color="secondary"
                      disabled={analyzing}
                      onClick={() => void handleLocalSummary()}
                      data-testid="ai-local-summary-button"
                      sx={{
                        borderRadius: '14px',
                        px: 2.75,
                        py: 1.2,
                        fontWeight: 600,
                        textTransform: 'none',
                        fontSize: 14,
                      }}
                    >
                      ⚡ 生成本地秒级总结
                    </Button>
                  </Stack>

                  {/* 预设快捷追问：从挤在一起的小胶囊升级为整齐舒展的列表卡片 */}
                  <Stack spacing={1.25} alignItems="stretch" sx={{ width: '100%', textAlign: 'left' }}>
                    <Typography
                      variant="caption"
                      sx={{ color: 'var(--lifehub-text-muted)', px: 0.5, fontWeight: 600 }}
                    >
                      猜你想问（点击直接提问）：
                    </Typography>
                    <Stack spacing={1} sx={{ width: '100%' }}>
                      {AI_TOPIC_META[selectedTopic].starterQuestions.map((q, idx) => (
                        <Box
                          key={idx}
                          onClick={() => void handleSendChat(q)}
                          data-testid={`ai-starter-question-${idx}`}
                          sx={{
                            cursor: 'pointer',
                            px: 2,
                            py: 1.35,
                            borderRadius: '14px',
                            backgroundColor: 'var(--lifehub-bg)',
                            border: '1px solid var(--lifehub-border)',
                            fontSize: 13.5,
                            lineHeight: 1.55,
                            color: 'var(--lifehub-text)',
                            transition: 'all 0.15s ease',
                            '&:hover': {
                              borderColor: 'primary.main',
                              backgroundColor: 'rgba(99, 102, 241, 0.04)',
                            },
                          }}
                        >
                          💬 {q}
                        </Box>
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
                          py: 1.35,
                          borderRadius: '20px 20px 6px 20px',
                          backgroundColor: 'primary.main',
                          color: '#fff',
                          fontSize: 14.5,
                          lineHeight: 1.65,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          boxShadow: '0 2px 10px rgba(99, 102, 241, 0.18)',
                        }}
                      >
                        {msg.content}
                      </Box>
                    );
                  }

                  // AI 顾问回复：宽敞舒适的阅读卡片
                  return (
                    <Stack
                      key={idx}
                      direction="row"
                      spacing={{ xs: 0, sm: 1.75 }}
                      alignItems="flex-start"
                      sx={{ width: '100%', py: 0.5, minWidth: 0 }}
                    >
                      <Box
                        sx={{
                          width: 34,
                          height: 34,
                          borderRadius: '12px',
                          backgroundColor: 'rgba(99, 102, 241, 0.12)',
                          color: 'primary.main',
                          display: { xs: 'none', sm: 'flex' },
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          mt: 0.25,
                        }}
                      >
                        <AutoAwesomeOutlined sx={{ fontSize: 18 }} />
                      </Box>

                      <Box sx={{ flex: 1, minWidth: 0, maxWidth: '100%' }}>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.85 }}>
                          <AutoAwesomeOutlined
                            sx={{ fontSize: 16, color: 'primary.main', display: { xs: 'inline-flex', sm: 'none' } }}
                          />
                          <Typography variant="caption" sx={{ fontWeight: 700, fontSize: 13, color: 'var(--lifehub-text)' }}>
                            DeepSeek 顾问
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)', fontSize: 12 }}>
                            · {AI_TOPIC_META[selectedTopic].label}
                          </Typography>
                        </Stack>

                        <Paper
                          variant="outlined"
                          sx={{
                            p: { xs: 2, sm: 2.75 },
                            borderRadius: '18px',
                            backgroundColor: 'var(--lifehub-bg)',
                            borderColor: 'var(--lifehub-border)',
                            overflow: 'hidden',
                          }}
                        >
                          <AiMarkdownRenderer content={msg.content} />

                          <Stack
                            direction="row"
                            spacing={1.5}
                            alignItems="center"
                            sx={{
                              mt: 1.75,
                              pt: 1.1,
                              borderTop: '1px dashed var(--lifehub-border)',
                            }}
                          >
                            <Tooltip title={copiedIdx === idx ? '已复制' : '复制 Markdown 内容'}>
                              <Button
                                size="small"
                                variant="text"
                                startIcon={<ContentCopyOutlined sx={{ fontSize: 14 }} />}
                                onClick={() => handleCopyMessage(msg.content, idx)}
                                sx={{ fontSize: 12, py: 0.3, px: 1, color: 'var(--lifehub-text-muted)', textTransform: 'none' }}
                              >
                                {copiedIdx === idx ? '已复制' : '复制内容'}
                              </Button>
                            </Tooltip>

                            {idx === currentMessages.length - 1 && (
                              <Button
                                size="small"
                                variant="text"
                                startIcon={<RefreshOutlined sx={{ fontSize: 14 }} />}
                                disabled={analyzing}
                                onClick={() => void handleRemoteAnalyze()}
                                sx={{ fontSize: 12, py: 0.3, px: 1, color: 'var(--lifehub-text-muted)', textTransform: 'none' }}
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

              {/* 实时思考中动画气泡 */}
              {analyzing && (
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 1.25 }}>
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
                  <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)', fontWeight: 500, fontSize: 13.5 }}>
                    DeepSeek 正在思考并生成结构化分析，请稍候…
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

              <Box ref={chatBottomAnchorRef} sx={{ height: 6 }} />
            </Box>
          </Box>

          {/* 底部：极简宽敞的 DeepSeek 风格输入舱（去除多余按钮，左一右一清爽呼吸感） */}
          <Box
            data-testid="ai-chat-panel"
            sx={{
              px: { xs: 2, sm: 4 },
              pb: { xs: 2, sm: 2.5 },
              pt: 1,
              backgroundColor: 'var(--lifehub-surface)',
              flexShrink: 0,
            }}
          >
            <Paper
              variant="outlined"
              sx={{
                maxWidth: 780,
                mx: 'auto',
                p: { xs: 1.5, sm: 1.75 },
                borderRadius: '20px',
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
                placeholder={`给 DeepSeek 发送消息（当前：${AI_TOPIC_META[selectedTopic].label}）…`}
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
                  sx: { px: 0.75, py: 0.5, fontSize: 14.5, lineHeight: 1.65 },
                }}
                inputProps={{ 'data-testid': 'ai-chat-input' }}
              />

              {/* 输入框底栏：仅保留左侧「深度思考 (R1)」与右侧「发送」，告别按钮拥挤 */}
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                spacing={1.5}
                sx={{ mt: 1, pt: 0.5, px: 0.5 }}
              >
                <Chip
                  icon={<PsychologyOutlined sx={{ fontSize: 16 }} />}
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
                    borderRadius: '999px',
                    height: 32,
                    px: 0.5,
                    fontWeight: isReasonerModel ? 700 : 500,
                    fontSize: 12.5,
                  }}
                />

                <Button
                  variant="contained"
                  disabled={analyzing || chatInput.trim().length === 0}
                  onClick={() => void handleSendChat()}
                  endIcon={<SendOutlined sx={{ fontSize: 15 }} />}
                  data-testid="ai-chat-send-button"
                  sx={{
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    px: 2.5,
                    py: 0.7,
                    borderRadius: '999px',
                    fontWeight: 700,
                    fontSize: 13.5,
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
      <Box
        ref={advancedSectionRef}
        sx={{ display: advancedOpen ? 'block' : 'none' }}
        data-testid="ai-advanced-section"
      >
        <Paper
          variant="outlined"
          data-testid="ai-config-card"
          sx={{ p: { xs: 1.75, sm: 2.5 }, mb: 2.5, borderRadius: 3 }}
        >
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', sm: 'center' }}
            spacing={1}
            sx={{ mb: 2 }}
          >
            <Typography variant="subtitle1" sx={{ fontWeight: 700, fontSize: { xs: '0.95rem', sm: '1rem' } }}>
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
              sx={{
                maxWidth: '100%',
                height: 'auto',
                '& .MuiChip-label': { whiteSpace: 'normal', py: 0.4 },
              }}
            />
          </Stack>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
            <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 220 } }}>
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

          <Button
            variant="contained"
            size="small"
            onClick={() => void handleSaveConfig()}
            data-testid="ai-save-config-button"
          >
            加密保存配置
          </Button>
        </Paper>

        {/* E-04 / X-13：请求审计指标历史表（支持单条删除与一键清空） */}
        <Paper
          variant="outlined"
          data-testid="ai-request-history"
          sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: 3 }}
        >
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            spacing={1}
            sx={{ mb: 1.5 }}
          >
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.25 }}>
                AI 请求审计指标记录（X-13：仅存 SHA-256 摘要与性能指标）
              </Typography>
              <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)', display: 'block' }}>
                共 {auditHistory.length} 条请求指标记录
              </Typography>
            </Box>
            {auditHistory.length > 0 && (
              <Button
                size="small"
                color="error"
                variant="outlined"
                startIcon={<DeleteOutline sx={{ fontSize: 16 }} />}
                onClick={() => void handleClearAuditHistory()}
                data-testid="ai-clear-audits-button"
                sx={{ borderRadius: 2, textTransform: 'none', flexShrink: 0 }}
              >
                清空全部记录
              </Button>
            )}
          </Stack>

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
                    <TableCell align="right">操作</TableCell>
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
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          color="error"
                          aria-label="删除审计记录"
                          onClick={() => void handleDeleteAuditRecord(item.id)}
                          data-testid={`ai-delete-audit-${item.id}`}
                        >
                          <DeleteOutline sx={{ fontSize: 16 }} />
                        </IconButton>
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
