/**
 * AI 分析与生活复盘页面（模块 E：E-01 ~ E-05 / X-12 ~ X-14）。
 *
 * 架构位置：apps/web 的「页面组件」层，路由 `/ai`。
 *
 * 功能覆盖：
 * - E-01 / X-12：模型与 API Key 配置卡片（`data-testid="ai-config-card"`），API Key 经 WebCrypto AES-GCM 加密后仅保存在本机 `aiSettings` 表，绝不进入同步包；
 * - E-02 / X-14：发送前脱敏摘要与版本化 Prompt 预览（`data-testid="ai-redacted-preview"`），直观验证金额分桶、交易对手泛化（商户 A/B）与日期粗化到月（YYYY-MM）；
 * - E-03 / E-05：支持零网络「生成本地智能总结」（`data-testid="ai-local-summary-button"`）与直连 OpenAI 兼容 / Ollama 模型（`data-testid="ai-remote-analyze-button"`）；
 * - E-04 / X-13：请求审计指标历史表（`data-testid="ai-request-history"`），仅持久化 SHA-256 `payloadDigest`、耗时、Token 用量与状态，绝不存储明文 Prompt 或回复。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
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
  Typography,
} from '@mui/material';
import type { Bill } from '@lifehub/core';
import { useBillStore } from '@/store';
import { useVault } from '@/hooks/useVault';
import { getTodayLocalDate } from '@/modules/shared/date-utils';
import { ScheduleService } from '@/modules/schedule/schedule-service';
import { HabitService } from '@/modules/habits/habit-service';
import { redactBillsForAi } from '@/modules/ai/redaction';
import {
  buildLifeReviewPrompt,
  type AiHabitSummaryInput,
  type AiPromptContext,
  type AiScheduleSummaryInput,
} from '@/modules/ai/prompt-builder';
import {
  AiStorageService,
  type AIAnalysisRequestRecord,
  type AiProviderType,
} from '@/modules/ai/ai-storage';
import {
  executeLocalSmartAnalysis,
  executeRemoteAiAnalysis,
} from '@/modules/ai/ai-client';

/**
 * 渲染 AI 分析与生活复盘页面。
 *
 * @returns React 节点
 * @throws 无
 */
export function AiAnalysisPage() {
  const { runtime, status } = useVault();
  const storeBills = useBillStore((state) => state.bills);

  const aiStorage = useMemo(() => new AiStorageService(), []);
  const scheduleService = useMemo(() => new ScheduleService(), []);
  const habitService = useMemo(() => new HabitService(), []);
  const today = useMemo(() => getTodayLocalDate(), []);

  const [loadedBills, setLoadedBills] = useState<Bill[]>([]);
  const [categoryMap, setCategoryMap] = useState<Map<string, string>>(new Map());
  const [scheduleSummary, setScheduleSummary] = useState<AiScheduleSummaryInput | undefined>(
    undefined,
  );
  const [habitSummary, setHabitSummary] = useState<AiHabitSummaryInput | undefined>(undefined);

  // 配置表单状态
  const [provider, setProvider] = useState<AiProviderType>('openai-compatible');
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [model, setModel] = useState('gpt-4o-mini');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [hasEncryptedKey, setHasEncryptedKey] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // 分析结果与审计记录
  const [analysisOutput, setAnalysisOutput] = useState<string>('');
  const [analyzing, setAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [auditHistory, setAuditHistory] = useState<AIAnalysisRequestRecord[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth >= 768,
  );

  const effectiveBills = useMemo(
    () => (storeBills.length > 0 ? storeBills : loadedBills),
    [loadedBills, storeBills],
  );

  const loadInitialData = useCallback(async () => {
    try {
      const [configRec, audits, schedStats, habitsWithStats, periodStats] = await Promise.all([
        aiStorage.getConfigRecord(),
        aiStorage.listRequestAudits(),
        scheduleService.getWeekAndMonthStats(today),
        habitService.listHabitsWithStats(today),
        habitService.getPeriodStats(today, 'month'),
      ]);

      setProvider(configRec.provider);
      setBaseUrl(configRec.baseUrl);
      setModel(configRec.model);
      setHasEncryptedKey(configRec.hasApiKey);
      setAuditHistory(audits);

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
  }, [aiStorage, habitService, runtime, scheduleService, status, today]);

  useEffect(() => {
    void loadInitialData();
  }, [loadInitialData]);

  const promptContext: AiPromptContext = useMemo(() => {
    const redactedBills = redactBillsForAi(effectiveBills, categoryMap);
    return {
      redactedBills,
      scheduleStats: scheduleSummary,
      habitStats: habitSummary,
    };
  }, [categoryMap, effectiveBills, habitSummary, scheduleSummary]);

  const builtPrompt = useMemo(
    () => buildLifeReviewPrompt(promptContext),
    [promptContext],
  );

  const handleSaveConfig = async () => {
    try {
      setErrorMsg(null);
      const updated = await aiStorage.saveConfig({
        provider,
        baseUrl,
        model,
        ...(apiKeyInput.trim().length > 0 ? { apiKey: apiKeyInput.trim() } : {}),
      });
      setHasEncryptedKey(updated.hasApiKey);
      setApiKeyInput('');
      setSaveSuccessMsg('AI 接口与密钥配置已通过 WebCrypto AES-GCM 加密保存至本地');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '保存配置失败');
    }
  };

  const handleLocalSummary = async () => {
    try {
      setAnalyzing(true);
      setErrorMsg(null);
      const result = await executeLocalSmartAnalysis(promptContext, { storage: aiStorage });
      setAnalysisOutput(result.replyText);
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
      const result = await executeRemoteAiAnalysis(builtPrompt, { storage: aiStorage });
      setAnalysisOutput(result.replyText);
      const audits = await aiStorage.listRequestAudits();
      setAuditHistory(audits);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '远程 AI 分析请求失败');
      const audits = await aiStorage.listRequestAudits();
      setAuditHistory(audits);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <Box data-testid="ai-page" sx={{ width: '100%' }}>
      {/* 页面标题 */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          AI 生活与财务复盘分析
        </Typography>
        <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)' }}>
          发送前本地自动脱敏（金额分桶 · 交易对手泛化 · 日期粗化到月）· 密钥本地 AES-GCM 加密 · 审计只存 SHA-256 摘要与指标
        </Typography>
      </Box>

      {errorMsg && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorMsg(null)}>
          {errorMsg}
        </Alert>
      )}

      {saveSuccessMsg && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSaveSuccessMsg(null)}>
          {saveSuccessMsg}
        </Alert>
      )}

      {/* ML-04：首屏零门槛一键智能生活与财务小结卡片 */}
      <Paper
        variant="outlined"
        data-testid="ai-quick-summary-card"
        sx={{ p: { xs: 2, sm: 2.5 }, mb: 2.5, borderRadius: 3 }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          spacing={1.5}
        >
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              ✨ 一键智能生活与财务小结
            </Typography>
            <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
              无需配置 API Key 即可离线生成收支、课表与习惯综合复盘；也可将脱敏摘要发送至外部 AI 模型深度分析。
            </Typography>
          </Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ width: { xs: '100%', sm: 'auto' } }}>
            <Button
              variant="contained"
              color="secondary"
              disabled={analyzing}
              onClick={() => void handleLocalSummary()}
              data-testid="ai-local-summary-button"
            >
              生成本地智能总结（零网络）
            </Button>
            <Button
              variant="contained"
              color="primary"
              disabled={analyzing}
              onClick={() => void handleRemoteAnalyze()}
              data-testid="ai-remote-analyze-button"
            >
              发送脱敏摘要至 AI 模型
            </Button>
          </Stack>
        </Stack>

        {analysisOutput && (
          <Paper
            variant="outlined"
            data-testid="ai-analysis-output"
            sx={{ p: { xs: 2, sm: 2.5 }, mt: 2, borderRadius: 2, whiteSpace: 'pre-wrap' }}
          >
            {analysisOutput}
          </Paper>
        )}

        <Box
          sx={{ mt: 1.5, display: 'flex', justifyContent: 'flex-end' }}
          data-testid="ai-advanced-toggle"
          onClick={() => setAdvancedOpen((prev) => !prev)}
        >
          <Button
            size="small"
            variant="text"
            onClick={(e) => {
              e.stopPropagation();
              setAdvancedOpen((prev) => !prev);
            }}
            data-testid="ai-toggle-advanced-button"
          >
            {advancedOpen ? '收起高级模型配置与脱敏审计 ▴' : '高级：外部大模型配置与脱敏审计 ▾'}
          </Button>
        </Box>
      </Paper>

      <Box sx={{ display: advancedOpen ? 'block' : 'none' }} data-testid="ai-advanced-section">
      {/* E-01 / X-12：模型与 API Key 加密配置卡片 */}
      <Paper
        variant="outlined"
        data-testid="ai-config-card"
        sx={{ p: { xs: 2, sm: 2.5 }, mb: 3, borderRadius: 3 }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          spacing={1}
          sx={{ mb: 2 }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            模型端点与 API Key 配置（本地 AES-GCM 加密）
          </Typography>
          <Chip
            size="small"
            color={hasEncryptedKey ? 'success' : 'default'}
            label={
              hasEncryptedKey
                ? '🔒 密钥已本地 AES-GCM 加密存储 · 不进入同步包'
                : '未配置远程密钥（可使用本地智能总结或 Ollama）'
            }
            data-testid="ai-key-status-chip"
          />
        </Stack>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel id="ai-provider-label">接口类型</InputLabel>
            <Select
              labelId="ai-provider-label"
              label="接口类型"
              value={provider}
              onChange={(e) => {
                const next = e.target.value as AiProviderType;
                setProvider(next);
                if (next === 'ollama' && baseUrl === 'https://api.openai.com/v1') {
                  setBaseUrl('http://localhost:11434');
                  setModel('qwen2.5:7b');
                } else if (next === 'openai-compatible' && baseUrl === 'http://localhost:11434') {
                  setBaseUrl('https://api.openai.com/v1');
                  setModel('gpt-4o-mini');
                }
              }}
              data-testid="ai-provider-select"
            >
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
            label={hasEncryptedKey ? '更新 API Key（留空保持已加密密钥）' : 'API Key'}
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

      {/* E-02 / X-14：发送前脱敏摘要预览区 */}
      <Paper
        variant="outlined"
        data-testid="ai-redacted-preview"
        sx={{ p: { xs: 2, sm: 2.5 }, mb: 3, borderRadius: 3 }}
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
              发送前脱敏摘要与 Prompt 预览（X-14 隐私保护）
            </Typography>
            <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
              原始精确金额已替换为分桶区间（如 50–100 元），真实商户名已替换为匿名代号（商户 A / B），具体日期已粗化为月份（YYYY-MM）
            </Typography>
          </Box>
          <Chip
            size="small"
            variant="outlined"
            label={`模板: ${builtPrompt.promptTemplateId}`}
          />
        </Stack>

        <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1.5 }}>
          {Object.entries(builtPrompt.redactedBills.bucketDistribution).map(([bucket, count]) => (
            <Chip
              key={bucket}
              size="small"
              label={`${bucket}: ${count} 笔`}
              variant="outlined"
            />
          ))}
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

      {/* E-04 / X-13：请求审计指标历史表（只存指标与 SHA-256 摘要，不存明文） */}
      <Paper
        variant="outlined"
        data-testid="ai-request-history"
        sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: 3 }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
          AI 请求审计指标记录（X-13：仅存 SHA-256 摘要与性能指标，不存储明文 Prompt 与回复）
        </Typography>
        <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)', display: 'block', mb: 1.5 }}>
          共 {auditHistory.length} 条请求指标记录
        </Typography>

        {auditHistory.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'var(--lifehub-text-muted)' }}>
            暂无分析请求记录。点击上方「生成本地智能总结」或「发送脱敏摘要至 AI 模型」即可体验。
          </Typography>
        ) : (
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
