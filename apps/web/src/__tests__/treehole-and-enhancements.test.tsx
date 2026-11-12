/**
 * 树洞服务、树洞时间轴页面、AI 树洞脱敏、课表同步未来 X 个月与文件存储目录单元测试。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createFakeDatabase } from '@/__tests__/helpers/fake-dexie';
import type { LifeHubDatabase } from '@/platform/db';
import { DiaryService, type StoredEncryptedDiaryRecord } from '@/modules/diary/diary-service';
import { redactDiaryEntriesForAi, sanitizeFreeTextForAi, redactBillsForAi } from '@/modules/ai/redaction';
import {
  buildLifeReviewPrompt,
  generateLocalChatReply,
  generateLocalSmartSummary,
} from '@/modules/ai/prompt-builder';
import { getStorageDirectory, setStorageDirectory } from '@/utils/download';
import { addMonthsToLocalDate } from '@/modules/shared/date-utils';
import { TreeHolePage } from '@/pages/TreeHolePage';
import { AiStorageService } from '@/modules/ai/ai-storage';
import { executeAiChatMessage, executeRemoteAiAnalysis } from '@/modules/ai/ai-client';

let sharedFakeDb = createFakeDatabase() as LifeHubDatabase;

vi.mock('@/platform/db', () => ({
  createDatabase: () => sharedFakeDb,
  LifeHubDatabase: class {},
}));

describe('DiaryService (模块 D：树洞全字段 AES-GCM 加密与同步备份)', () => {
  beforeEach(() => {
    sharedFakeDb = createFakeDatabase() as LifeHubDatabase;
  });

  it('创建树洞记录时在 IndexedDB 中仅存储密文，不泄露明文标题或正文（D-01 / X-04）', async () => {
    const db = createFakeDatabase() as LifeHubDatabase;
    const service = new DiaryService(db);

    const created = await service.createEntry({
      title: '深夜复盘秘密',
      body: '今天完成了项目架构升级，手机号 13812345678 留作记录。',
      mood: '💪 充实',
      tags: ['成长', '技术'],
      isPinned: true,
    });

    expect(created.title).toBe('深夜复盘秘密');
    expect(created.mood).toBe('💪 充实');
    expect(created.tags).toEqual(['成长', '技术']);
    expect(created.isPinned).toBe(true);

    // 直接检查底层表存储，确保无明文
    const rawStored = await db.table<StoredEncryptedDiaryRecord, string>('diaryEntries').get(created.id);
    expect(rawStored).toBeDefined();
    const rawJson = JSON.stringify(rawStored);
    expect(rawJson).not.toContain('深夜复盘秘密');
    expect(rawJson).not.toContain('今天完成了项目架构升级');
    expect(rawStored?.ciphertext).toBeTruthy();
    expect(rawStored?.iv).toBeTruthy();

    // 解密列表查询与关键词筛选
    const all = await service.listEntries();
    expect(all).toHaveLength(1);
    expect(all[0]?.body).toContain('今天完成了项目架构升级');

    const matched = await service.listEntries({ keyword: '架构升级', mood: '💪 充实' });
    expect(matched).toHaveLength(1);

    const unmatched = await service.listEntries({ keyword: '不存在的词' });
    expect(unmatched).toHaveLength(0);

    // 导出与跨设备恢复往返
    const exported = await service.exportAllDecrypted();
    expect(exported).toHaveLength(1);

    const db2 = createFakeDatabase() as LifeHubDatabase;
    const service2 = new DiaryService(db2);
    const count = await service2.importAllFromBackup(exported);
    expect(count).toBe(1);

    const restoredList = await service2.listEntries();
    expect(restoredList[0]?.title).toBe('深夜复盘秘密');
  });
});

describe('AI 树洞脱敏与复盘集成 (D-03)', () => {
  it('sanitizeFreeTextForAi 与 redactDiaryEntriesForAi 自动抹除手机号、邮箱、证件号与精确金额', () => {
    const clean = sanitizeFreeTextForAi(
      '联系手机 13987654321，邮箱 test@example.com，花了 ¥128.50 元，卡号 6222021234567890123',
    );
    expect(clean).not.toContain('13987654321');
    expect(clean).not.toContain('test@example.com');
    expect(clean).not.toContain('128.50');
    expect(clean).not.toContain('6222021234567890123');
    expect(clean).toContain('[手机号已脱敏]');
    expect(clean).toContain('[邮箱已脱敏]');

    const summary = redactDiaryEntriesForAi([
      {
        id: 'd1',
        localDate: '2026-11-12',
        occurredAt: '2026-11-12T10:00:00.000Z',
        title: '今日感想',
        body: '给 13987654321 转了 88.80 元',
        mood: '🌿 平静',
        tags: ['日常'],
        isPinned: false,
        createdAt: '2026-11-12T10:00:00.000Z',
        updatedAt: '2026-11-12T10:00:00.000Z',
      },
    ]);

    expect(summary.selectedCount).toBe(1);
    expect(summary.sanitizedCharLength).toBeGreaterThan(0);
    expect(summary.items[0]?.yearMonth).toBe('2026-11');
    expect(summary.items[0]?.sanitizedExcerpt).not.toContain('13987654321');

    const prompt = buildLifeReviewPrompt({
      redactedBills: redactBillsForAi([]),
      diaryStats: summary,
    });
    expect(prompt.userPrompt).toContain('已自动强制脱敏 1 条');

    const localReport = generateLocalSmartSummary({
      redactedBills: redactBillsForAi([]),
      diaryStats: summary,
    });
    expect(localReport).toContain('【人物观察与树洞情绪/生活状态复盘】');
  });

  it('支持财务、生活、习惯、人物四大专项分析维度与多轮互动对话（executeAiChatMessage）', async () => {
    const db = createFakeDatabase() as LifeHubDatabase;
    const storage = new AiStorageService(db);
    const diarySummary = redactDiaryEntriesForAi([
      {
        id: 'd2',
        localDate: '2026-11-12',
        occurredAt: '2026-11-12T10:00:00.000Z',
        title: '人物观察',
        body: '今天和同事讨论方案非常顺畅，心情平静',
        mood: '🌿 平静',
        tags: ['人物', '职场'],
        isPinned: false,
        createdAt: '2026-11-12T10:00:00.000Z',
        updatedAt: '2026-11-12T10:00:00.000Z',
      },
    ]);

    const localPersonaReply = generateLocalChatReply(
      {
        redactedBills: redactBillsForAi([]),
        diaryStats: diarySummary,
        topic: 'persona',
      },
      '帮我分析一下最近的人物关系和情绪状态',
    );
    expect(localPersonaReply).toContain('人物与树洞深度分析');

    const chatRes = await executeAiChatMessage(
      {
        redactedBills: redactBillsForAi([]),
        diaryStats: diarySummary,
        topic: 'finance',
      },
      [{ role: 'user', content: '我该如何控制消费预算？' }],
      { storage },
    );
    expect(chatRes.replyText).toContain('财务分析建议');
    expect(chatRes.auditRecord.module).toBe('chat-finance');
  });
});

describe('文件存储目录与课表未来 X 个月工具函数', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('getStorageDirectory 与 setStorageDirectory 支持规范化路径并持久化（含 Windows 盘符绝对路径）', () => {
    expect(getStorageDirectory()).toBe('LifeHub');
    const saved = setStorageDirectory('  /MyLifeHub\\Backups/  ');
    expect(saved).toBe('MyLifeHub/Backups');
    expect(getStorageDirectory()).toBe('MyLifeHub/Backups');

    const winPath = setStorageDirectory('D:\\MyBackup\\LifeHubData\\');
    expect(winPath).toBe('D:/MyBackup/LifeHubData');
    expect(getStorageDirectory()).toBe('D:/MyBackup/LifeHubData');
  });

  it('addMonthsToLocalDate 正确计算未来 X 个月后的日期并处理月末边界', () => {
    expect(addMonthsToLocalDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsToLocalDate('2026-03-15', 3)).toBe('2026-06-15');
    expect(addMonthsToLocalDate('2026-11-12', 6)).toBe('2027-05-12');
  });
});

describe('TreeHolePage 页面交互测试', () => {
  beforeEach(() => {
    sharedFakeDb = createFakeDatabase() as LifeHubDatabase;
  });

  it('支持发布树洞随笔、切换心情并在时间轴展示', async () => {
    render(<TreeHolePage />);
    expect(screen.getByTestId('treehole-page')).toBeInTheDocument();

    const bodyInput = screen.getByTestId('treehole-body-input');
    fireEvent.change(bodyInput, { target: { value: '这是一条测试树洞随笔内容' } });

    const submitBtn = screen.getByTestId('treehole-submit-button');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('这是一条测试树洞随笔内容')).toBeInTheDocument();
    });
  });
});

describe('DeepSeek API Key 配置与远程调用支持', () => {
  beforeEach(() => {
    sharedFakeDb = createFakeDatabase() as LifeHubDatabase;
  });

  it('选择 deepseek 时默认填充 https://api.deepseek.com 与 deepseek-chat，并携带加密保存的 Bearer Key 调用 /chat/completions', async () => {
    const db = createFakeDatabase() as LifeHubDatabase;
    const storage = new AiStorageService(db);

    const saved = await storage.saveConfig({
      provider: 'deepseek',
      baseUrl: '',
      model: '',
      apiKey: 'sk-deepseek-test-123456',
    });

    expect(saved.provider).toBe('deepseek');
    expect(saved.baseUrl).toBe('https://api.deepseek.com');
    expect(saved.model).toBe('deepseek-chat');
    expect(saved.hasApiKey).toBe(true);
    expect(saved.encryptedApiKeyCiphertext).not.toContain('sk-deepseek-test-123456');

    let capturedUrl = '';
    let capturedAuth = '';
    const fakeFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      const headers = init?.headers as Record<string, string>;
      capturedAuth = headers['Authorization'] ?? '';
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'DeepSeek 复盘建议结果' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        }),
        { status: 200 },
      );
    };

    const prompt = buildLifeReviewPrompt({
      redactedBills: redactBillsForAi([]),
    });

    const result = await executeRemoteAiAnalysis(prompt, {
      storage,
      fetchFn: fakeFetch,
    });

    expect(capturedUrl).toBe('https://api.deepseek.com/chat/completions');
    expect(capturedAuth).toBe('Bearer sk-deepseek-test-123456');
    expect(result.replyText).toBe('DeepSeek 复盘建议结果');
    expect(result.auditRecord.provider).toBe('deepseek');
    expect(result.auditRecord.model).toBe('deepseek-chat');
    expect(result.auditRecord.tokensUsed).toBe(150);
  });

  it('buildSignedCloudHttpRequest 使用 WebCrypto HMAC-SHA1 生成合法的阿里云 OSS 与腾讯云 COS 预签名 URL', async () => {
    const { buildSignedCloudHttpRequest } = await import('@/lib/cloud-storage');
    const ossSigned = await buildSignedCloudHttpRequest(
      {
        provider: 'aliyun-oss',
        endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
        bucket: 'lifehub-demo-1250000000',
        accessKey: 'LTAI_TEST_KEY',
        secretKey: 'SECRET_TEST_KEY',
        encryptUpload: true,
      },
      'PUT',
    );
    expect(ossSigned.url).toContain('https://lifehub-demo-1250000000.oss-cn-hangzhou.aliyuncs.com/lifehub-backup.json.enc');
    expect(ossSigned.url).toContain('OSSAccessKeyId=LTAI_TEST_KEY');
    expect(ossSigned.url).toContain('Signature=');

    const cosSigned = await buildSignedCloudHttpRequest(
      {
        provider: 'tencent-cos',
        endpoint: 'https://cos.ap-shanghai.myqcloud.com',
        bucket: 'lifehub-demo-1250000000',
        accessKey: 'AKID_TEST_KEY',
        secretKey: 'SECRET_TEST_KEY',
        encryptUpload: true,
      },
      'PUT',
    );
    expect(cosSigned.url).toContain('https://lifehub-demo-1250000000.cos.ap-shanghai.myqcloud.com/lifehub-backup.json.enc');
    expect(cosSigned.url).toContain('q-sign-algorithm=sha1');
    expect(cosSigned.url).toContain('q-signature=');
  });
});

