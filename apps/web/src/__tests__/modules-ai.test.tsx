/**
 * AI 分析层模块（Module E：E-01 ~ E-05 / X-12 ~ X-14）单元测试与页面组件测试。
 *
 * 重点验证：
 * - X-14：金额分桶、交易对手泛化（商户 A/B）、日期粗化到月（YYYY-MM），输出与 Prompt 绝不含原始商户名、原始备注与精确金额数字；
 * - E-01 / X-12：API Key 使用 WebCrypto AES-GCM 加密存入 IndexedDB `aiSettings` 表，数据库记录不含明文密钥且可正确解密还原；
 * - E-04 / X-13：`AIAnalysisRequestRecord` 只存 `payloadDigest`（64 位 hex）与性能指标，严禁存明文 Prompt 或回复；
 * - E-02 / E-03 / E-05：AiAnalysisPage 脱敏预览展示、零网络本地智能总结与远程 Mock 调用。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bill } from '@lifehub/core';
import { createFakeDatabase } from '@/__tests__/helpers/fake-dexie';
import { redactBillsForAi } from '@/modules/ai/redaction';
import { buildLifeReviewPrompt } from '@/modules/ai/prompt-builder';
import {
  AiStorageService,
  assertMetricsOnlyRequestRecord,
} from '@/modules/ai/ai-storage';
import {
  executeLocalSmartAnalysis,
  executeRemoteAiAnalysis,
} from '@/modules/ai/ai-client';
import { AiAnalysisPage } from '@/pages/AiAnalysisPage';
import { useBillStore } from '@/store';
import type { LifeHubDatabase } from '@/platform/db';

const fakeDbHolder = vi.hoisted(() => ({
  db: null as unknown,
}));

vi.mock('@/platform/db', () => ({
  createDatabase: () => fakeDbHolder.db,
  LifeHubDatabase: class {},
}));

vi.mock('@/hooks/useVault', () => ({
  useVault: () => ({
    status: 'locked',
    runtime: null,
  }),
}));

/** 构造测试用真实感账单。 */
function makeSampleBills(): Bill[] {
  return [
    {
      id: 'bill-sensitive-1',
      amountMinor: 7340, // 73.40 元 -> 应分桶为 '50–100 元'
      currency: 'CNY',
      direction: 'expense',
      categoryId: 'cat-food',
      counterparty: '星巴克咖啡',
      note: '和客户王五在陆家嘴谈机密并购项目',
      occurredAt: '2026-10-27T08:14:57.000Z',
      localDate: '2026-10-27',
      sourceTimeZone: 'Asia/Shanghai',
      sourceFileId: 'file-1',
      sourceRowIndex: 0,
      createdAt: '2026-10-27T08:14:57.000Z',
      updatedAt: '2026-10-27T08:14:57.000Z',
      version: 1,
      deviceId: 'dev-1',
    },
    {
      id: 'bill-sensitive-2',
      amountMinor: 26850, // 268.50 元 -> 应分桶为 '100–500 元'
      currency: 'CNY',
      direction: 'expense',
      categoryId: 'cat-transport',
      counterparty: '滴滴出行科技有限公司',
      note: '虹桥机场专车报销单号9527',
      occurredAt: '2026-10-28T10:00:00.000Z',
      localDate: '2026-10-28',
      sourceTimeZone: 'Asia/Shanghai',
      sourceFileId: 'file-2',
      sourceRowIndex: 1,
      createdAt: '2026-10-28T10:00:00.000Z',
      updatedAt: '2026-10-28T10:00:00.000Z',
      version: 1,
      deviceId: 'dev-1',
    },
  ];
}

beforeEach(() => {
  fakeDbHolder.db = createFakeDatabase();
  localStorage.clear();
  useBillStore.getState().setBills([]);
});

describe('Module E —— X-14 脱敏管线与 Prompt 构造器安全断言', () => {
  it('脱敏输出与最终 Prompt 绝不包含真实商户名、原始备注、具体日期或精确金额数字', () => {
    const bills = makeSampleBills();
    const categoryMap = new Map<string, string>([
      ['cat-food', '餐饮美食'],
      ['cat-transport', '交通出行'],
    ]);

    const redacted = redactBillsForAi(bills, categoryMap);
    const builtPrompt = buildLifeReviewPrompt({
      redactedBills: redacted,
      scheduleStats: {
        weekExpected: 10,
        weekCompleted: 8,
        weekRate: 80,
        monthExpected: 40,
        monthCompleted: 32,
        monthRate: 80,
      },
      habitStats: {
        activeHabitCount: 3,
        habitCompletedCount: 15,
        scheduleCompletedCount: 8,
        combinedCompletedCount: 23,
        maxCurrentStreak: 5,
        maxLongestStreak: 12,
      },
    });

    const serializedRedacted = JSON.stringify(redacted);
    const fullPrompt = builtPrompt.fullPreviewText;

    // 1) 严禁出现真实商户名、敏感备注、精确金额（73.40 / 7340 / 268.50 / 26850）与具体日期（2026-10-27）
    for (const forbidden of [
      '星巴克咖啡',
      '滴滴出行',
      '王五',
      '陆家嘴',
      '9527',
      '73.40',
      '7340',
      '268.50',
      '26850',
      '2026-10-27',
      '2026-10-28',
      '微信支付账单_私密.csv',
    ]) {
      expect(serializedRedacted).not.toContain(forbidden);
      expect(fullPrompt).not.toContain(forbidden);
    }

    // 2) 必须包含泛化代号、分桶区间与粗化月份
    expect(serializedRedacted).toContain('商户 A');
    expect(serializedRedacted).toContain('商户 B');
    expect(serializedRedacted).toContain('50–100 元');
    expect(serializedRedacted).toContain('100–500 元');
    expect(serializedRedacted).toContain('2026-10');

    expect(fullPrompt).toContain('商户 A');
    expect(fullPrompt).toContain('商户 B');
    expect(fullPrompt).toContain('50–100 元');
    expect(fullPrompt).toContain('100–500 元');
    expect(fullPrompt).toContain('2026-10');
  });
});

describe('Module E —— E-01 API Key 本地 AES-GCM 加密存储与 E-04 / X-13 纯指标审计', () => {
  it('API Key 使用 AES-GCM 密文存入 aiSettings 表，表内不含明文 Key，且能无损解密还原', async () => {
    const db = fakeDbHolder.db as LifeHubDatabase;
    const storage = new AiStorageService(db);
    const secretKey = 'sk-live-super-secret-token-889900';

    const savedRecord = await storage.saveConfig({
      provider: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: secretKey,
    });

    expect(savedRecord.hasApiKey).toBe(true);
    expect(savedRecord.encryptedApiKeyCiphertext).toBeTruthy();
    expect(savedRecord.encryptedApiKeyIv).toBeTruthy();

    // 检查底层表中存储的原始记录：绝不包含明文 secretKey
    const rawTableRows = await db.table('aiSettings').toArray();
    expect(JSON.stringify(rawTableRows)).not.toContain(secretKey);

    // 解密还原断言
    const decrypted = await storage.getDecryptedApiKey();
    expect(decrypted).toBe(secretKey);
  });

  it('AIAnalysisRequestRecord 仅保存 SHA-256 payloadDigest 与耗时/Token 指标，混入明文 Prompt 时抛出异常（X-13）', async () => {
    const db = fakeDbHolder.db as LifeHubDatabase;
    const storage = new AiStorageService(db);
    await storage.saveConfig({
      provider: 'openai-compatible',
      baseUrl: 'https://api.example-llm.local/v1',
      model: 'qwen-plus',
      apiKey: 'sk-test-123',
    });

    const redacted = redactBillsForAi(makeSampleBills());
    const builtPrompt = buildLifeReviewPrompt({ redactedBills: redacted });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '这是模型返回的复盘建议正文' } }],
        usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
      }),
    });

    const result = await executeRemoteAiAnalysis(builtPrompt, {
      storage,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.replyText).toBe('这是模型返回的复盘建议正文');
    expect(result.auditRecord.payloadDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.auditRecord.tokensUsed).toBe(200);
    expect(result.auditRecord.status).toBe('success');

    // 验证数据库中持久化的审计记录不含任何明文 Prompt 或回复文本
    const audits = await storage.listRequestAudits();
    expect(audits).toHaveLength(1);
    const serializedAudits = JSON.stringify(audits);
    expect(serializedAudits).not.toContain('这是模型返回的复盘建议正文');
    expect(serializedAudits).not.toContain(builtPrompt.userPrompt);
    expect(serializedAudits).not.toContain('sk-test-123');

    // 验证 assertMetricsOnlyRequestRecord 拦截违规明文字段
    expect(() =>
      assertMetricsOnlyRequestRecord({
        ...result.auditRecord,
        prompt: '违规塞入的明文 Prompt',
      }),
    ).toThrow(/违反 X-13 红线/);
  });

  it('executeLocalSmartAnalysis 零网络生成本地复盘总结并记录 local 审计指标', async () => {
    const db = fakeDbHolder.db as LifeHubDatabase;
    const storage = new AiStorageService(db);
    const redacted = redactBillsForAi(makeSampleBills());

    const res = await executeLocalSmartAnalysis(
      { redactedBills: redacted },
      { storage },
    );
    expect(res.replyText).toContain('LifeHub 本地智能复盘报告');
    expect(res.auditRecord.provider).toBe('local');
    expect(res.auditRecord.payloadDigest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('Module E —— AiAnalysisPage 页面交互测试', () => {
  it('展示脱敏预览（不含敏感商户与精确金额）、支持保存加密配置与触发本地智能总结', async () => {
    useBillStore.getState().setBills(makeSampleBills());

    render(<AiAnalysisPage />);

    expect(screen.getByTestId('ai-page')).toBeInTheDocument();
    expect(screen.getByTestId('ai-config-card')).toBeInTheDocument();
    expect(screen.getByTestId('ai-redacted-preview')).toBeInTheDocument();
    expect(screen.getByTestId('ai-request-history')).toBeInTheDocument();

    const previewBox = screen.getByTestId('ai-prompt-preview-box');
    expect(previewBox.textContent).toContain('商户 A');
    expect(previewBox.textContent).toContain('50–100 元');
    expect(previewBox.textContent).not.toContain('星巴克咖啡');
    expect(previewBox.textContent).not.toContain('73.40');

    // 点击生成本地智能总结（零网络）
    fireEvent.click(screen.getByTestId('ai-local-summary-button'));

    await waitFor(() => {
      expect(screen.getByTestId('ai-analysis-output')).toHaveTextContent(
        'LifeHub 本地智能复盘报告',
      );
    });

    // 模型配置中不再展示冗余的 DeepSeek 快捷模型选项
    expect(screen.queryByTestId('ai-deepseek-model-presets')).not.toBeInTheDocument();

    // 验证 AI 请求审计指标支持一键清空
    const clearBtn = await screen.findByTestId('ai-clear-audits-button');
    fireEvent.click(clearBtn);
    await waitFor(() => {
      expect(screen.queryByTestId('ai-clear-audits-button')).not.toBeInTheDocument();
    });
  });
});
