/**
 * AI 分析与生活复盘页面（极简一屏响应式布局 · 模块 E：E-01 ~ E-05 / X-12 ~ X-14）。
 *
 * 架构位置：apps/web 的「页面组件」层，路由 `/ai`。
 *
 * 核心设计：
 * 1. **强制全量默认脱敏（X-14）**：选定时间段内的账单、课表、微习惯与树洞随笔均在本地自动脱敏；
 * 2. **桌面与移动端极简一屏体验**：
 *    - 移动端合并为单行 46px 顶栏（侧滑历史抽屉 + 主题/时间聚合菜单 + 新建/设置图标）与紧凑输入舱；
 *    - 桌面端左侧精简会话栏 + 右侧无干扰阅读流，配置与审计收纳至独立弹窗；
 * 3. **适配 DeepSeek V4 模型体系**：原生支持 `deepseek-flash` 与 `deepseek-v4-pro` 及 `thinking` 深度思考开关。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Popover,
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
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded';
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import KeyboardArrowDownRounded from '@mui/icons-material/KeyboardArrowDownRounded';
import PsychologyOutlined from '@mui/icons-material/PsychologyOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import ShieldOutlined from '@mui/icons-material/ShieldOutlined';
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
  DEFAULT_DEEPSEEK_MODEL,
  DEEPSEEK_OFFICIAL_MODELS,
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
 * 会话流中展示的轻量上下文折叠条（默认单行低调呈现，点击可查看完整 Prompt）。
 */
function SystemPromptContextCard({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const firstLine = content.split('\n')[0] || '数据上下文';

  return (
    <Box sx={{ alignSelf: 'stretch', my: 0.25 }}>
      <Box
        onClick={() => setExpanded((prev) => !prev)}
        sx={{
          px: 1.25,
          py: 0.6,
          borderRadius: '8px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          userSelect: 'none',
          backgroundColor: 'var(--lifehub-bg)',
          border: '1px solid var(--lifehub-border)',
          '&:hover': {
            borderColor: 'primary.main',
          },
        }}
      >
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
          <ShieldOutlined sx={{ fontSize: 14, color: 'success.main', flexShrink: 0 }} />
          <Typography
            variant="caption"
            noWrap
            sx={{ color: 'var(--lifehub-text-muted)', fontSize: 12 }}
          >
            {firstLine}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={0.25} alignItems="center" sx={{ flexShrink: 0 }}>
          <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)', fontSize: 11.5 }}>
            {expanded ? '收起' : '查看'}
          </Typography>
          {expanded ? (
            <ExpandLess sx={{ fontSize: 15, color: 'var(--lifehub-text-muted)' }} />
          ) : (
            <ExpandMore sx={{ fontSize: 15, color: 'var(--lifehub-text-muted)' }} />
          )}
        </Stack>
      </Box>
      <Collapse in={expanded}>
        <Box
          component="pre"
          sx={{
            mt: 0.75,
            mb: 0,
            p: 1.5,
            borderRadius: 2,
            backgroundColor: 'var(--lifehub-bg)',
            border: '1px solid var(--lifehub-border)',
            fontSize: 11.5,
            lineHeight: 1.55,
            maxHeight: 220,
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
    </Box>
  );
}

/**
 * 渲染极简一屏 AI 分析与多轮对话页面。
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

  // 配置状态（默认指向 DeepSeek V4 主力模型 deepseek-flash）
  const [provider, setProvider] = useState<AiProviderType>('deepseek');
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com');
  const [model, setModel] = useState<string>(DEFAULT_DEEPSEEK_MODEL);
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [hasEncryptedKey, setHasEncryptedKey] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // 分析主题 & 时间段
  const [selectedTopic, setSelectedTopic] = useState<AiAnalysisTopic>('comprehensive');
  const [timeRange, setTimeRange] = useState<AiTimeRangePreset>('1m');

  // 会话管理与弹窗状态
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

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false);
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
  const [contextAnchorEl, setContextAnchorEl] = useState<HTMLElement | null>(null);

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

  const scrollToBottom = useCallback((smooth = true) => {
    const container = chatScrollContainerRef.current;
    if (container) {
      if (typeof container.scrollTo === 'function') {
        try {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: smooth ? 'smooth' : 'auto',
          });
          return;
        } catch {
          // 降级直接赋值 scrollTop，避免触发外层窗口滚动
        }
      }
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  // 进入 AI 页面时锁定外层 html/body 视口并归零外层残留滚动条，确保仅内部会话区可滑动
  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }
    const html = document.documentElement;
    const body = document.body;
    html.classList.add('lifehub-ai-locked');
    body.classList.add('lifehub-ai-locked');
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      try {
        window.scrollTo(0, 0);
      } catch {
        // 忽略测试环境无 scrollTo 实现
      }
    }
    const mainEl = document.querySelector('.lifehub-content');
    if (mainEl instanceof HTMLElement) {
      mainEl.scrollTop = 0;
    }
    return () => {
      html.classList.remove('lifehub-ai-locked');
      body.classList.remove('lifehub-ai-locked');
    };
  }, []);

  useEffect(() => {
    if (currentMessages.length > 0 || analyzing) {
      const timer = setTimeout(() => scrollToBottom(true), 40);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [currentMessages.length, analyzing, activeSessionId, scrollToBottom]);

  const dateWindow = useMemo(() => {
    const opt =
      AI_TIME_RANGE_OPTIONS.find((o) => o.value === timeRange) ?? {
        value: '1m' as const,
        label: '近 1 个月',
        days: 30,
      };
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
      setThinkingEnabled(Boolean(configRec.thinkingEnabled));
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
            `${AI_TOPIC_META[selectedTopic].label} · ${dateWindow.label}`,
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
    [
      activeSessionId,
      dateWindow.fromDate,
      dateWindow.label,
      dateWindow.toDate,
      selectedTopic,
      sessions,
      timeRange,
    ],
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
      existing.model !== model.trim() ||
      Boolean(existing.thinkingEnabled) !== thinkingEnabled
    ) {
      const updated = await aiStorage.saveConfig({
        provider,
        baseUrl,
        model,
        thinkingEnabled,
        ...(trimmedKey.length > 0 ? { apiKey: trimmedKey } : {}),
      });
      setProvider(updated.provider);
      setBaseUrl(updated.baseUrl);
      setModel(updated.model);
      setThinkingEnabled(Boolean(updated.thinkingEnabled));
      setHasEncryptedKey(updated.hasApiKey);
      if (trimmedKey.length > 0) {
        setApiKeyInput('');
      }
    }
  }, [aiStorage, apiKeyInput, baseUrl, model, provider, thinkingEnabled]);

  const handleSaveConfig = async () => {
    try {
      setErrorMsg(null);
      const updated = await aiStorage.saveConfig({
        provider,
        baseUrl,
        model,
        thinkingEnabled,
        ...(apiKeyInput.trim().length > 0 ? { apiKey: apiKeyInput.trim() } : {}),
      });
      setProvider(updated.provider);
      setBaseUrl(updated.baseUrl);
      setModel(updated.model);
      setThinkingEnabled(Boolean(updated.thinkingEnabled));
      setHasEncryptedKey(updated.hasApiKey);
      setApiKeyInput('');
      setSaveSuccessMsg(null);
      setSettingsOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '保存配置失败');
    }
  };

  const handleToggleThinking = async () => {
    const nextThinking = !thinkingEnabled;
    setThinkingEnabled(nextThinking);
    try {
      await aiStorage.saveConfig({
        provider,
        baseUrl,
        model,
        thinkingEnabled: nextThinking,
      });
    } catch {
      // 忽略持久化非致命异常
    }
  };

  const buildSystemContextUserBubble = (actionLabel: string): AiChatMessage => ({
    role: 'user',
    isSystemPromptContext: true,
    timestamp: new Date().toISOString(),
    content: [
      `上下文 · ${AI_TOPIC_META[selectedTopic].label} · ${dateWindow.label}（${actionLabel}）`,
      '',
      builtPrompt.userPrompt,
    ].join('\n'),
  });

  const handleLocalSummary = async () => {
    try {
      setAnalyzing(true);
      setErrorMsg(null);
      const sysUserBubble = buildSystemContextUserBubble('本地速览');
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
      setErrorMsg(err instanceof Error ? err.message : '生成本地总结失败');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleRemoteAnalyze = async () => {
    try {
      setAnalyzing(true);
      setErrorMsg(null);
      await syncFormConfigIfNeeded();
      const sysUserBubble = buildSystemContextUserBubble('AI 深度复盘');
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
        ? [buildSystemContextUserBubble('自动注入')]
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
            ? question.slice(0, 18)
            : cur.title,
        topic: selectedTopic,
        timeRange,
        messages: nextHistory,
      }),
      question.slice(0, 18),
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
            content: `> ⚠️ **请求未调通**：${msg}\n\n请点击右上角或侧栏的「⚙️ 模型设置」检查 API Key 或网络状态。`,
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

  const isRemoteReady =
    provider === 'ollama' ||
    ((provider === 'deepseek' || provider === 'openai-compatible') && hasEncryptedKey);

  const activeModelBadgeLabel = isRemoteReady ? model : '本地模式';
  const isCustomDeepSeekModel =
    provider === 'deepseek' &&
    !(DEEPSEEK_OFFICIAL_MODELS as readonly string[]).includes(model);

  const renderSessionListContent = (closeDrawerOnSelect: boolean) => (
    <Stack
      spacing={0.5}
      sx={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        pr: 0.25,
      }}
      data-testid="ai-session-list"
    >
      {sessions.length === 0 ? (
        <Typography
          variant="caption"
          sx={{
            color: 'var(--lifehub-text-muted)',
            py: 4,
            px: 1,
            textAlign: 'center',
            lineHeight: 1.7,
          }}
        >
          暂无历史对话
        </Typography>
      ) : (
        sessions.map((sess) => {
          const isSelected = sess.id === activeSessionId;
          return (
            <Box
              key={sess.id}
              onClick={() => {
                handleSelectSession(sess);
                if (closeDrawerOnSelect) {
                  setMobileHistoryOpen(false);
                }
              }}
              data-testid={`ai-session-item-${sess.id}`}
              sx={{
                px: 1.25,
                py: 0.75,
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 0.5,
                backgroundColor: isSelected ? 'var(--lifehub-surface)' : 'transparent',
                border: isSelected ? '1px solid var(--lifehub-border)' : '1px solid transparent',
                '&:hover': {
                  backgroundColor: 'var(--lifehub-surface)',
                  '& .session-delete-btn': { opacity: 0.8 },
                },
              }}
            >
              <Typography
                variant="body2"
                noWrap
                sx={{ flex: 1, minWidth: 0, fontWeight: isSelected ? 600 : 400, fontSize: 13 }}
              >
                {sess.title}
              </Typography>
              <IconButton
                className="session-delete-btn"
                size="small"
                onClick={(e) => handleDeleteSession(sess.id, e)}
                aria-label="删除会话"
                sx={{ p: 0.35, opacity: { xs: 0.65, md: isSelected ? 0.65 : 0 }, transition: 'opacity 0.15s' }}
              >
                <DeleteOutline sx={{ fontSize: 15 }} />
              </IconButton>
            </Box>
          );
        })
      )}
    </Stack>
  );

  return (
    <Box
      data-testid="ai-page"
      sx={{
        width: '100%',
        flex: 1,
        minHeight: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {errorMsg && (
        <Alert severity="error" sx={{ mb: 1, flexShrink: 0 }} onClose={() => setErrorMsg(null)}>
          {errorMsg}
        </Alert>
      )}

      {saveSuccessMsg && (
        <Alert
          severity="success"
          sx={{ mb: 1, flexShrink: 0 }}
          onClose={() => setSaveSuccessMsg(null)}
        >
          {saveSuccessMsg}
        </Alert>
      )}

      {/* 一屏聊天主容器（自适应填满视口剩余高度，外层零滚动条，仅内部会话流滚动） */}
      <Paper
        variant="outlined"
        data-testid="ai-quick-summary-card"
        sx={{
          display: 'flex',
          flexDirection: 'row',
          flex: 1,
          minHeight: 0,
          height: '100%',
          width: '100%',
          borderRadius: { xs: '10px', md: '12px' },
          overflow: 'hidden',
          backgroundColor: 'var(--lifehub-surface)',
          borderColor: 'var(--lifehub-border)',
        }}
      >
        {/* 桌面端左侧精简会话栏（顶部 48px 标题行与右侧顶栏严丝合缝对齐） */}
        <Box
          data-testid="ai-sessions-sidebar"
          sx={{
            display: { xs: 'none', md: 'flex' },
            width: 224,
            height: '100%',
            minHeight: 0,
            overflow: 'hidden',
            flexShrink: 0,
            borderRight: '1px solid var(--lifehub-border)',
            flexDirection: 'column',
            backgroundColor: 'var(--lifehub-bg)',
          }}
        >
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{
              height: 48,
              px: 1.5,
              borderBottom: '1px solid var(--lifehub-border)',
              flexShrink: 0,
            }}
          >
            <Typography
              variant="subtitle2"
              sx={{ fontWeight: 700, fontSize: 13, color: 'var(--lifehub-text)' }}
            >
              对话
            </Typography>
            <Button
              size="small"
              variant="text"
              startIcon={<AddCommentOutlined sx={{ fontSize: 15 }} />}
              onClick={handleNewSession}
              data-testid="ai-new-session-button"
              sx={{
                borderRadius: '8px',
                px: 1,
                py: 0.4,
                fontSize: 12.5,
                fontWeight: 600,
                textTransform: 'none',
                color: 'primary.main',
                '&:hover': {
                  backgroundColor: 'var(--lifehub-primary-soft)',
                },
              }}
            >
              新对话
            </Button>
          </Stack>

          <Box
            sx={{
              p: 1.25,
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {renderSessionListContent(false)}

            <Divider sx={{ my: 1 }} />

            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={0.5}>
              <Button
                size="small"
                variant="text"
                startIcon={<SettingsOutlined sx={{ fontSize: 15 }} />}
                onClick={() => setSettingsOpen(true)}
                data-testid="ai-toggle-advanced-button"
                sx={{
                  flex: 1,
                  justifyContent: 'flex-start',
                  fontSize: 12.5,
                  py: 0.55,
                  px: 1,
                  borderRadius: '8px',
                  color: 'var(--lifehub-text-muted)',
                  textTransform: 'none',
                  '&:hover': {
                    color: 'var(--lifehub-text)',
                    backgroundColor: 'var(--lifehub-surface)',
                  },
                }}
              >
                模型设置
              </Button>
              <Tooltip title="上下文与记录">
                <IconButton
                  size="small"
                  onClick={() => {
                    setDiagnosticsExpanded(true);
                    setSettingsOpen(true);
                  }}
                  data-testid="ai-toggle-prompt-preview-button"
                  aria-label="查看脱敏上下文"
                  sx={{ borderRadius: '8px', color: 'var(--lifehub-text-muted)' }}
                >
                  <ShieldOutlined sx={{ fontSize: 15 }} />
                </IconButton>
              </Tooltip>
            </Stack>
          </Box>
        </Box>

        {/* 右侧主对话区 */}
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            minHeight: 0,
            height: '100%',
          }}
        >
          {/* 统一极简顶栏（手机端与桌面端均仅占 1 行 46px） */}
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            spacing={1}
            sx={{
              height: 48,
              px: { xs: 1, sm: 2.25 },
              borderBottom: '1px solid var(--lifehub-border)',
              flexShrink: 0,
            }}
          >
            {/* 左：移动端历史抽屉图标 + 主题/时间范围聚合选择器 */}
            <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minWidth: 0 }}>
              <IconButton
                size="small"
                onClick={() => setMobileHistoryOpen(true)}
                aria-label="历史对话"
                sx={{ display: { xs: 'inline-flex', md: 'none' } }}
              >
                <Badge
                  color="primary"
                  variant="dot"
                  invisible={sessions.length === 0}
                >
                  <HistoryOutlined sx={{ fontSize: 20 }} />
                </Badge>
              </IconButton>

              <Button
                size="small"
                variant="text"
                onClick={(e) => setContextAnchorEl(e.currentTarget)}
                endIcon={<KeyboardArrowDownRounded sx={{ fontSize: 18 }} />}
                data-testid="ai-context-trigger"
                sx={{
                  borderRadius: '8px',
                  px: 1.1,
                  py: 0.45,
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: 'var(--lifehub-text)',
                  textTransform: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                {AI_TOPIC_META[selectedTopic].icon} {AI_TOPIC_META[selectedTopic].label} · {dateWindow.label}
              </Button>
            </Stack>

            {/* 右：桌面端显示当前模型标签；移动端仅保留「新对话」与「设置」两个纯图标按钮 */}
            <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flexShrink: 0 }}>
              <Chip
                size="small"
                variant="outlined"
                label={activeModelBadgeLabel}
                onClick={() => setSettingsOpen(true)}
                sx={{
                  display: { xs: 'none', sm: 'inline-flex' },
                  height: 26,
                  fontSize: 12,
                  borderRadius: '6px',
                  borderColor: 'var(--lifehub-border)',
                  color: 'var(--lifehub-text-muted)',
                  cursor: 'pointer',
                }}
              />

              <IconButton
                size="small"
                onClick={handleNewSession}
                aria-label="新建对话"
                sx={{ display: { xs: 'inline-flex', md: 'none' } }}
              >
                <AddCommentOutlined sx={{ fontSize: 19 }} />
              </IconButton>

              <IconButton
                size="small"
                onClick={() => setSettingsOpen(true)}
                aria-label="模型设置"
                sx={{ display: { xs: 'inline-flex', md: 'none' } }}
              >
                <Badge color="success" variant="dot" invisible={!hasEncryptedKey}>
                  <SettingsOutlined sx={{ fontSize: 19 }} />
                </Badge>
              </IconButton>
            </Stack>
          </Stack>

          {/* 中间消息流（唯一主纵向滚动容器） */}
          <Box
            ref={chatScrollContainerRef}
            data-testid="ai-chat-history"
            sx={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              overflowX: 'hidden',
              overscrollBehavior: 'contain',
              WebkitOverflowScrolling: 'touch',
              px: { xs: 1.75, sm: 3.5 },
              py: { xs: 2, sm: 3 },
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Box
              sx={{
                width: '100%',
                maxWidth: 740,
                mx: 'auto',
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 2.25,
                minWidth: 0,
              }}
            >
              {currentMessages.length === 0 ? (
                /* 清爽欢迎空状态 */
                <Box
                  sx={{
                    my: 'auto',
                    textAlign: 'center',
                    maxWidth: 480,
                    width: '100%',
                    mx: 'auto',
                    py: 2,
                  }}
                >
                  <Typography
                    variant="h6"
                    sx={{ fontWeight: 700, mb: 2, fontSize: { xs: '1.08rem', sm: '1.22rem' } }}
                  >
                    需要帮你复盘哪方面？
                  </Typography>

                  {/* 单行紧凑操作按钮 */}
                  <Stack
                    direction="row"
                    spacing={1}
                    justifyContent="center"
                    sx={{ mb: 2.5 }}
                  >
                    <Button
                      variant="contained"
                      size="small"
                      disabled={analyzing}
                      onClick={() => void (isRemoteReady ? handleRemoteAnalyze() : handleLocalSummary())}
                      data-testid="ai-remote-analyze-button"
                      sx={{
                        borderRadius: '8px',
                        px: 2,
                        py: 0.7,
                        fontWeight: 600,
                        textTransform: 'none',
                        fontSize: 13,
                        boxShadow: 'none',
                      }}
                    >
                      {isRemoteReady ? 'AI 深度复盘' : '一键生成复盘'}
                    </Button>
                    <Button
                      variant="outlined"
                      size="small"
                      color="inherit"
                      disabled={analyzing}
                      onClick={() => void handleLocalSummary()}
                      data-testid="ai-local-summary-button"
                      sx={{
                        borderRadius: '8px',
                        px: 1.75,
                        py: 0.7,
                        fontWeight: 500,
                        textTransform: 'none',
                        fontSize: 13,
                        borderColor: 'var(--lifehub-border)',
                        color: 'var(--lifehub-text-muted)',
                      }}
                    >
                      本地速览
                    </Button>
                  </Stack>

                  {/* 精简快捷提问 */}
                  <Stack spacing={0.75} sx={{ width: '100%', textAlign: 'left' }}>
                    {AI_TOPIC_META[selectedTopic].starterQuestions.map((q, idx) => (
                      <Box
                        key={idx}
                        onClick={() => void handleSendChat(q)}
                        data-testid={`ai-starter-question-${idx}`}
                        sx={{
                          cursor: 'pointer',
                          px: 1.5,
                          py: 0.95,
                          borderRadius: '8px',
                          backgroundColor: 'var(--lifehub-bg)',
                          border: '1px solid var(--lifehub-border)',
                          fontSize: 13,
                          lineHeight: 1.5,
                          color: 'var(--lifehub-text)',
                          transition: 'border-color 0.15s ease',
                          '&:hover': {
                            borderColor: 'primary.main',
                          },
                        }}
                      >
                        {q}
                      </Box>
                    ))}
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
                          maxWidth: { xs: '88%', sm: '76%' },
                          px: 1.75,
                          py: 1.05,
                          borderRadius: '12px 12px 4px 12px',
                          backgroundColor: 'primary.main',
                          color: '#fff',
                          fontSize: 14,
                          lineHeight: 1.6,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {msg.content}
                      </Box>
                    );
                  }

                  // AI 回复：去边框平铺阅读布局，省去多层框线与虚线分割
                  return (
                    <Stack
                      key={idx}
                      direction="row"
                      spacing={{ xs: 0, sm: 1.5 }}
                      alignItems="flex-start"
                      sx={{ width: '100%', minWidth: 0 }}
                    >
                      <Box
                        sx={{
                          width: 28,
                          height: 28,
                          borderRadius: '9px',
                          backgroundColor: 'rgba(99, 102, 241, 0.1)',
                          color: 'primary.main',
                          display: { xs: 'none', sm: 'flex' },
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          mt: 0.25,
                        }}
                      >
                        <AutoAwesomeOutlined sx={{ fontSize: 16 }} />
                      </Box>

                      <Box sx={{ flex: 1, minWidth: 0, maxWidth: '100%' }}>
                        <AiMarkdownRenderer content={msg.content} />

                        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.75, ml: -0.5 }}>
                          <Tooltip title={copiedIdx === idx ? '已复制' : '复制内容'}>
                            <IconButton
                              size="small"
                              onClick={() => handleCopyMessage(msg.content, idx)}
                              aria-label="复制内容"
                              sx={{ color: 'var(--lifehub-text-muted)', p: 0.5 }}
                            >
                              <ContentCopyOutlined sx={{ fontSize: 14 }} />
                            </IconButton>
                          </Tooltip>

                          {idx === currentMessages.length - 1 && (
                            <Tooltip title="重新生成">
                              <span>
                                <IconButton
                                  size="small"
                                  disabled={analyzing}
                                  onClick={() => void (isRemoteReady ? handleRemoteAnalyze() : handleLocalSummary())}
                                  aria-label="重新生成"
                                  sx={{ color: 'var(--lifehub-text-muted)', p: 0.5 }}
                                >
                                  <RefreshOutlined sx={{ fontSize: 15 }} />
                                </IconButton>
                              </span>
                            </Tooltip>
                          )}
                        </Stack>
                      </Box>
                    </Stack>
                  );
                })
              )}

              {analyzing && (
                <Stack direction="row" spacing={1.25} alignItems="center" sx={{ py: 0.75 }}>
                  <CircularProgress size={15} thickness={5} />
                  <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)', fontSize: 13 }}>
                    正在思考…
                  </Typography>
                </Stack>
              )}

              {/* 保留回归校验锚点 */}
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

          {/* 底部紧凑输入舱：仅保留「深度思考」开关与圆形「发送」图标 */}
          <Box
            data-testid="ai-chat-panel"
            sx={{
              px: { xs: 1.25, sm: 3.5 },
              pb: { xs: 1.25, sm: 2 },
              pt: 0.5,
              flexShrink: 0,
            }}
          >
            <Paper
              variant="outlined"
              sx={{
                maxWidth: 740,
                mx: 'auto',
                px: 1.5,
                py: 1,
                borderRadius: '12px',
                backgroundColor: 'var(--lifehub-bg)',
                borderColor: 'var(--lifehub-border)',
                transition: 'border-color 0.2s ease',
                '&:focus-within': {
                  borderColor: 'primary.main',
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
                placeholder="输入问题，回车发送…"
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
                  sx: { px: 0.25, py: 0.25, fontSize: 14, lineHeight: 1.55 },
                }}
                inputProps={{ 'data-testid': 'ai-chat-input' }}
              />

              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ mt: 0.5 }}
              >
                <Chip
                  icon={<PsychologyOutlined sx={{ fontSize: 15 }} />}
                  label="深度思考"
                  size="small"
                  color={thinkingEnabled ? 'primary' : 'default'}
                  variant={thinkingEnabled ? 'filled' : 'outlined'}
                  onClick={() => void handleToggleThinking()}
                  data-testid="ai-thinking-toggle"
                  sx={{
                    cursor: 'pointer',
                    borderRadius: '6px',
                    height: 26,
                    fontSize: 12,
                    fontWeight: thinkingEnabled ? 600 : 400,
                    borderColor: thinkingEnabled ? 'primary.main' : 'var(--lifehub-border)',
                  }}
                />

                <IconButton
                  color="primary"
                  disabled={analyzing || chatInput.trim().length === 0}
                  onClick={() => void handleSendChat()}
                  data-testid="ai-chat-send-button"
                  aria-label="发送"
                  sx={{
                    width: 30,
                    height: 30,
                    borderRadius: '8px',
                    backgroundColor:
                      analyzing || chatInput.trim().length === 0
                        ? 'action.disabledBackground'
                        : 'primary.main',
                    color: '#fff',
                    '&:hover': {
                      backgroundColor: 'primary.dark',
                    },
                    '&.Mui-disabled': {
                      color: 'action.disabled',
                    },
                  }}
                >
                  <ArrowUpwardRounded sx={{ fontSize: 18 }} />
                </IconButton>
              </Stack>
            </Paper>
          </Box>
        </Box>
      </Paper>

      {/* 主题与时间范围轻量弹出面板 */}
      <Popover
        open={Boolean(contextAnchorEl)}
        anchorEl={contextAnchorEl}
        onClose={() => setContextAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: { p: 2, borderRadius: '12px', width: 300, maxWidth: 'calc(100vw - 24px)', mt: 0.5 },
          },
        }}
      >
        <Typography variant="caption" sx={{ fontWeight: 700, color: 'var(--lifehub-text-muted)', display: 'block', mb: 1 }}>
          分析维度
        </Typography>
        <Box
          data-testid="ai-topic-selector"
          sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 2 }}
        >
          {(Object.keys(AI_TOPIC_META) as AiAnalysisTopic[]).map((topicKey) => {
            const meta = AI_TOPIC_META[topicKey];
            const active = selectedTopic === topicKey;
            return (
              <Chip
                key={topicKey}
                size="small"
                label={`${meta.icon} ${meta.label}`}
                color={active ? 'primary' : 'default'}
                variant={active ? 'filled' : 'outlined'}
                onClick={() => setSelectedTopic(topicKey)}
                data-testid={`ai-topic-chip-${topicKey}`}
                sx={{ borderRadius: '6px', fontSize: 12.5 }}
              />
            );
          })}
        </Box>

        <Typography variant="caption" sx={{ fontWeight: 700, color: 'var(--lifehub-text-muted)', display: 'block', mb: 1 }}>
          时间范围
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {AI_TIME_RANGE_OPTIONS.map((opt) => {
            const active = timeRange === opt.value;
            return (
              <Chip
                key={opt.value}
                size="small"
                label={opt.label}
                color={active ? 'primary' : 'default'}
                variant={active ? 'filled' : 'outlined'}
                onClick={() => {
                  setTimeRange(opt.value);
                  setContextAnchorEl(null);
                }}
                sx={{ borderRadius: '6px', fontSize: 12.5 }}
              />
            );
          })}
        </Box>
      </Popover>

      {/* 移动端左侧滑出历史会话抽屉 */}
      <Drawer
        anchor="left"
        open={mobileHistoryOpen}
        onClose={() => setMobileHistoryOpen(false)}
        PaperProps={{
          sx: {
            width: 260,
            p: 2,
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'var(--lifehub-bg)',
          },
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            历史对话 ({sessions.length})
          </Typography>
          <IconButton size="small" onClick={() => setMobileHistoryOpen(false)} aria-label="关闭历史抽屉">
            <CloseRounded sx={{ fontSize: 18 }} />
          </IconButton>
        </Stack>

        <Button
          variant="contained"
          size="small"
          startIcon={<AddCommentOutlined sx={{ fontSize: 16 }} />}
          onClick={() => {
            handleNewSession();
            setMobileHistoryOpen(false);
          }}
          sx={{ mb: 1.5, borderRadius: '8px', textTransform: 'none', boxShadow: 'none' }}
        >
          新对话
        </Button>

        {renderSessionListContent(true)}
      </Drawer>

      {/* 模型设置与隐私审计弹窗（keepMounted 确保不占用主页面布局高度） */}
      <Dialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        keepMounted
        fullWidth
        maxWidth="sm"
        data-testid="ai-advanced-section"
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
          <Typography variant="subtitle1" component="span" sx={{ fontWeight: 700 }}>
            模型与 API Key 设置
          </Typography>
          <IconButton size="small" onClick={() => setSettingsOpen(false)} aria-label="关闭设置">
            <CloseRounded sx={{ fontSize: 19 }} />
          </IconButton>
        </DialogTitle>

        <DialogContent dividers>
          <Box data-testid="ai-config-card">
            <Stack spacing={2}>
              <FormControl size="small" fullWidth>
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
                      setModel(DEFAULT_DEEPSEEK_MODEL);
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
                  <MenuItem value="deepseek">DeepSeek 官方接口</MenuItem>
                  <MenuItem value="openai-compatible">OpenAI 兼容接口</MenuItem>
                  <MenuItem value="ollama">Ollama 本地模型</MenuItem>
                </Select>
              </FormControl>

              {provider === 'deepseek' && !isCustomDeepSeekModel ? (
                <FormControl size="small" fullWidth>
                  <InputLabel id="ai-deepseek-model-label">模型选择</InputLabel>
                  <Select
                    labelId="ai-deepseek-model-label"
                    label="模型选择"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    inputProps={{ 'data-testid': 'ai-model-input' }}
                  >
                    <MenuItem value="deepseek-flash">
                      deepseek-flash（推荐 · 高速多模态）
                    </MenuItem>
                    <MenuItem value="deepseek-v4-pro">
                      deepseek-v4-pro（旗舰复杂推理）
                    </MenuItem>
                  </Select>
                </FormControl>
              ) : (
                <>
                  <TextField
                    label="Base URL"
                    size="small"
                    fullWidth
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    inputProps={{ 'data-testid': 'ai-baseurl-input' }}
                  />
                  <TextField
                    label="模型名称"
                    size="small"
                    fullWidth
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    inputProps={{ 'data-testid': 'ai-model-input' }}
                  />
                </>
              )}

              {provider !== 'ollama' && (
                <TextField
                  label={hasEncryptedKey ? '更新 API Key（留空保持不变）' : 'API Key（sk-...）'}
                  type="password"
                  size="small"
                  fullWidth
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  helperText={hasEncryptedKey ? '已保存密钥' : '留空时使用本地总结'}
                  FormHelperTextProps={{ 'data-testid': 'ai-key-status-chip' } as Record<string, unknown>}
                  inputProps={{ 'data-testid': 'ai-apikey-input' }}
                />
              )}
            </Stack>
          </Box>

          {/* 高级折叠项：上下文预览与记录（默认收起） */}
          <Box sx={{ mt: 2.25 }}>
            <Button
              size="small"
              variant="text"
              onClick={() => setDiagnosticsExpanded((prev) => !prev)}
              endIcon={diagnosticsExpanded ? <ExpandLess /> : <ExpandMore />}
              sx={{ px: 0.5, fontSize: 12.5, color: 'var(--lifehub-text-muted)', textTransform: 'none' }}
            >
              上下文预览与记录 ({auditHistory.length})
            </Button>

            <Collapse in={diagnosticsExpanded}>
              <Stack spacing={2} sx={{ mt: 1.25 }}>
                {provider === 'deepseek' && !isCustomDeepSeekModel && (
                  <TextField
                    label="自定义代理端点 (Base URL)"
                    size="small"
                    fullWidth
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    inputProps={{ 'data-testid': 'ai-baseurl-input' }}
                  />
                )}

                <Box data-testid="ai-redacted-preview">
                  <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.75 }}>
                    当前脱敏 Prompt 预览
                  </Typography>
                  <Box
                    component="pre"
                    data-testid="ai-prompt-preview-box"
                    sx={{
                      p: 1.25,
                      borderRadius: 1.5,
                      backgroundColor: 'var(--lifehub-bg)',
                      border: '1px solid var(--lifehub-border)',
                      fontSize: 11.5,
                      maxHeight: 160,
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      m: 0,
                    }}
                  >
                    {builtPrompt.fullPreviewText}
                  </Box>
                </Box>

                <Box data-testid="ai-request-history">
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.75 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700 }}>
                      调用记录（共 {auditHistory.length} 条）
                    </Typography>
                    {auditHistory.length > 0 && (
                      <Button
                        size="small"
                        color="error"
                        variant="text"
                        onClick={() => void handleClearAuditHistory()}
                        data-testid="ai-clear-audits-button"
                        sx={{ fontSize: 12, py: 0.2, textTransform: 'none' }}
                      >
                        清空记录
                      </Button>
                    )}
                  </Stack>

                  {auditHistory.length > 0 && (
                    <Box sx={{ overflowX: 'auto', maxHeight: 180 }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>时间</TableCell>
                            <TableCell>模型</TableCell>
                            <TableCell>耗时</TableCell>
                            <TableCell>状态</TableCell>
                            <TableCell align="right">操作</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {auditHistory.map((item) => (
                            <TableRow key={item.id} data-testid={`ai-audit-row-${item.id}`}>
                              <TableCell sx={{ fontSize: 12 }}>{item.at.slice(5, 16).replace('T', ' ')}</TableCell>
                              <TableCell sx={{ fontSize: 12 }}>{item.model}</TableCell>
                              <TableCell sx={{ fontSize: 12 }}>{item.latencyMs}ms</TableCell>
                              <TableCell sx={{ fontSize: 12 }}>
                                {item.status === 'success' ? '成功' : item.errorCode || '失败'}
                              </TableCell>
                              <TableCell align="right">
                                <IconButton
                                  size="small"
                                  onClick={() => void handleDeleteAuditRecord(item.id)}
                                  aria-label="删除审计记录"
                                  data-testid={`ai-delete-audit-${item.id}`}
                                >
                                  <DeleteOutline sx={{ fontSize: 15 }} />
                                </IconButton>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Box>
                  )}
                </Box>
              </Stack>
            </Collapse>
          </Box>
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 1.5 }}>
          <Button size="small" color="inherit" onClick={() => setSettingsOpen(false)} sx={{ textTransform: 'none' }}>
            取消
          </Button>
          <Button
            variant="contained"
            size="small"
            onClick={() => void handleSaveConfig()}
            data-testid="ai-save-config-button"
            sx={{ borderRadius: 2, px: 2.5, textTransform: 'none', boxShadow: 'none' }}
          >
            保存配置
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
