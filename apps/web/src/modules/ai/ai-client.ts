/**
 * AI 分析层直连客户端（OpenAI 兼容接口 & Ollama 本地模型接口，模块 E：E-03 / E-04 / E-05 / X-12 / X-13）。
 *
 * 架构位置：apps/web 的「AI 分析模块」网络适配层（位于 `apps/web/src/modules/ai/`，严禁进入 `packages/core`）。
 *
 * 职责：
 * 1. 读取 `AiStorageService` 中的配置与 AES-GCM 解密后的 API Key，在浏览器端直连用户配置的模型端点；
 * 2. 对外发请求体计算 SHA-256 十六进制摘要 `payloadDigest`；
 * 3. 无论成功或失败均向 `AiStorageService` 写入仅含指标与摘要的 `AIAnalysisRequestRecord`（严禁落盘明文 Prompt 或回复）。
 */
import { LifeHubError } from '@lifehub/core';
import {
  AiStorageService,
  computePayloadSha256Hex,
  type AIAnalysisRequestRecord,
  type AiTokenUsage,
} from './ai-storage';
import {
  buildLifeReviewPrompt,
  generateLocalChatReply,
  generateLocalSmartSummary,
  PROMPT_TEMPLATE_ID,
  type AiChatMessage,
  type AiPromptContext,
  type BuiltAiPrompt,
} from './prompt-builder';

/**
 * AI 分析执行结果（返回给当前页面会话展示，明文回复不持久化到数据库）。
 */
export interface AiAnalysisExecutionResult {
  /** 模型或本地引擎生成的复盘文本（仅保存在当前组件内存状态）。 */
  replyText: string;
  /** 已持久化到 `aiAnalysisRequests` 表的純指标审计记录。 */
  auditRecord: AIAnalysisRequestRecord;
}

/**
 * 远程 AI 调用可选参数。
 */
export interface RemoteAiClientOptions {
  /** 存储服务实例。 */
  storage?: AiStorageService;
  /** 自定义 fetch 实现（便于单测注入）。 */
  fetchFn?: typeof fetch;
  /** 请求超时毫秒数（默认 30000ms）。 */
  timeoutMs?: number;
  /** 模块标识（默认 'life-review'）。 */
  moduleName?: string;
  /** 多轮对话历史消息（可选，追加在脱敏上下文之后）。 */
  chatHistory?: readonly AiChatMessage[];
}

/**
 * 生成审计记录唯一 ID。
 *
 * @returns 字符串 ID
 */
function generateAuditId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `ai-req-${crypto.randomUUID()}`;
  }
  return `ai-req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 组装远程请求的 URL 与请求体。
 *
 * @param provider 提供方类型
 * @param baseUrl 基础 URL
 * @param model 模型名称
 * @param prompt 已组装的脱敏 Prompt
 * @returns 请求目标 endpoint 与序列化 JSON 请求体
 */
function buildProviderRequestPayload(
  provider: 'deepseek' | 'openai-compatible' | 'ollama',
  baseUrl: string,
  model: string,
  prompt: BuiltAiPrompt,
  chatHistory?: readonly AiChatMessage[],
): { endpoint: string; bodyJson: string } {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, '');
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: prompt.systemPrompt },
    { role: 'user', content: prompt.userPrompt },
  ];
  if (chatHistory && chatHistory.length > 0) {
    for (const msg of chatHistory) {
      if (msg.isSystemPromptContext) {
        // 系统构建的脱敏上下文已作为首条 userPrompt 注入，跳过避免重复和连续 user 角色报错
        continue;
      }
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === msg.role) {
        lastMsg.content = `${lastMsg.content}\n\n${msg.content}`;
      } else {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
  }

  if (provider === 'ollama') {
    const endpoint = normalizedBase.endsWith('/api/chat')
      ? normalizedBase
      : `${normalizedBase}/api/chat`;
    const bodyJson = JSON.stringify({
      model,
      messages,
      stream: false,
    });
    return { endpoint, bodyJson };
  }

  const endpoint = normalizedBase.endsWith('/chat/completions')
    ? normalizedBase
    : `${normalizedBase}/chat/completions`;
  const payloadObj: Record<string, unknown> = {
    model,
    messages,
    stream: false,
  };
  if (!model.toLowerCase().includes('reasoner')) {
    payloadObj['temperature'] = 0.3;
  }
  const bodyJson = JSON.stringify(payloadObj);
  return { endpoint, bodyJson };
}

/**
 * 从 OpenAI 兼容响应或 Ollama 响应中解析回复文本与 Token 用量。
 *
 * @param rawResponse 响应 JSON 对象
 * @returns 回复文本与 Token 用量
 */
function parseProviderResponse(rawResponse: unknown): {
  replyText: string;
  tokenUsage: AiTokenUsage;
} {
  const data = (rawResponse ?? {}) as Record<string, unknown>;

  // OpenAI / DeepSeek 兼容格式：choices[0].message.content（及 deepseek-reasoner 的 reasoning_content）
  let replyText = '';
  const choices = data['choices'];
  if (Array.isArray(choices) && choices.length > 0) {
    const firstChoice = choices[0] as Record<string, unknown> | undefined;
    const message = firstChoice?.['message'] as Record<string, unknown> | undefined;
    const content = typeof message?.['content'] === 'string' ? message['content'].trim() : '';
    const reasoning =
      typeof message?.['reasoning_content'] === 'string'
        ? message['reasoning_content'].trim()
        : '';
    if (reasoning && content) {
      replyText = `💭 【深度思考过程】\n${reasoning}\n\n---\n\n${content}`;
    } else {
      replyText = content || reasoning;
    }
  }

  // Ollama 格式：message.content 或 response
  if (!replyText) {
    const ollamaMsg = data['message'] as Record<string, unknown> | undefined;
    if (typeof ollamaMsg?.['content'] === 'string') {
      replyText = ollamaMsg['content'];
    } else if (typeof data['response'] === 'string') {
      replyText = data['response'];
    }
  }

  const usage = data['usage'] as Record<string, unknown> | undefined;
  const promptTokens =
    typeof usage?.['prompt_tokens'] === 'number'
      ? usage['prompt_tokens']
      : typeof data['prompt_eval_count'] === 'number'
        ? (data['prompt_eval_count'] as number)
        : 0;
  const completionTokens =
    typeof usage?.['completion_tokens'] === 'number'
      ? usage['completion_tokens']
      : typeof data['eval_count'] === 'number'
        ? (data['eval_count'] as number)
        : 0;
  const totalTokens =
    typeof usage?.['total_tokens'] === 'number'
      ? usage['total_tokens']
      : promptTokens + completionTokens;

  return {
    replyText: replyText.trim() || '（模型未返回有效文本内容）',
    tokenUsage: {
      promptTokens,
      completionTokens,
      totalTokens,
    },
  };
}

/**
 * 发送远程 AI HTTP 请求；在 Windows 桌面端若遇到浏览器 CORS 或网络拦截，自动回退至本地宿主代理。
 */
async function sendHttpWithDesktopFallback(
  fetchImpl: typeof fetch,
  endpoint: string,
  headers: Record<string, string>,
  bodyJson: string,
): Promise<Response> {
  try {
    return await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: bodyJson,
    });
  } catch (primaryErr) {
    const isDesktop =
      typeof window !== 'undefined' &&
      (window as unknown as Record<string, unknown>)['__LIFEHUB_DESKTOP__'] === true;
    if (isDesktop && fetchImpl === globalThis.fetch) {
      const proxyResp = await fetchImpl('/__lifehub_desktop__/ai-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: endpoint,
          authHeader: headers['Authorization'] ?? '',
          bodyJson,
        }),
      });
      return proxyResp;
    }
    throw primaryErr;
  }
}

/**
 * 提取非 2xx 响应中的可读错误详情。
 */
async function extractErrorDetail(response: Response): Promise<string> {
  try {
    if (typeof response.text === 'function') {
      const text = await response.text();
      if (!text) return '';
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        const errObj = parsed['error'] as Record<string, unknown> | string | undefined;
        if (typeof errObj === 'string') return errObj;
        if (errObj && typeof errObj === 'object' && typeof errObj['message'] === 'string') {
          return errObj['message'];
        }
        if (typeof parsed['message'] === 'string') return parsed['message'];
      } catch {
        return text.slice(0, 180);
      }
    }
  } catch {
    // 忽略读取异常
  }
  return '';
}

/**
 * 调用远程 AI 模型（OpenAI 兼容或 Ollama）执行脱敏生活复盘分析，并记录纯指标审计日志（E-03 / E-04 / E-05 / X-13）。
 *
 * @param prompt 已脱敏构造的 `BuiltAiPrompt`
 * @param options 可选客户端依赖与超时配置
 * @returns 包含模型回复文本与纯指标审计记录的结果
 * @throws {LifeHubError} 当缺少必要配置、网络失败或 HTTP 状态非 2xx 时抛出异常（同时仍写入失败指标记录）
 */
export async function executeRemoteAiAnalysis(
  prompt: BuiltAiPrompt,
  options: RemoteAiClientOptions = {},
): Promise<AiAnalysisExecutionResult> {
  const storage = options.storage ?? new AiStorageService();
  const fetchImpl = options.fetchFn ?? globalThis.fetch;
  const moduleName = options.moduleName ?? 'life-review';

  let config = await storage.getConfigRecord();
  const apiKey = await storage.getDecryptedApiKey();

  if ((config.provider === 'openai-compatible' || config.provider === 'deepseek') && !apiKey) {
    throw new LifeHubError(
      'LIFEHUB_E_VALIDATION',
      'DeepSeek / OpenAI 兼容接口需要先配置并加密保存 API Key；若无需联网，可使用「本地智能总结」或切换至 Ollama 本地模型。',
    );
  }

  let { endpoint, bodyJson } = buildProviderRequestPayload(
    config.provider,
    config.baseUrl,
    config.model,
    prompt,
    options.chatHistory,
  );
  let payloadDigest = await computePayloadSha256Hex(bodyJson);
  const startedAtMs = Date.now();
  const nowIso = new Date().toISOString();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const isUntouchedLegacyOpenAiDefault =
    !options.fetchFn &&
    config.provider === 'openai-compatible' &&
    config.baseUrl === 'https://api.openai.com/v1' &&
    config.model === 'gpt-4o-mini' &&
    Boolean(apiKey);

  try {
    let response: Response;
    try {
      response = await sendHttpWithDesktopFallback(fetchImpl, endpoint, headers, bodyJson);
    } catch (firstNetErr) {
      if (isUntouchedLegacyOpenAiDefault) {
        // 用户可能直接填入了 DeepSeek Key 但未切换下拉框，自动尝试 DeepSeek 官方端点
        const dsPayload = buildProviderRequestPayload(
          'deepseek',
          'https://api.deepseek.com',
          'deepseek-chat',
          prompt,
          options.chatHistory,
        );
        response = await sendHttpWithDesktopFallback(
          fetchImpl,
          dsPayload.endpoint,
          headers,
          dsPayload.bodyJson,
        );
        if (response.ok) {
          config = await storage.saveConfig({
            provider: 'deepseek',
            baseUrl: 'https://api.deepseek.com',
            model: 'deepseek-chat',
          });
          endpoint = dsPayload.endpoint;
          bodyJson = dsPayload.bodyJson;
          payloadDigest = await computePayloadSha256Hex(bodyJson);
        }
      } else {
        throw firstNetErr;
      }
    }

    if (!response.ok && isUntouchedLegacyOpenAiDefault && (response.status === 401 || response.status === 404)) {
      const dsPayload = buildProviderRequestPayload(
        'deepseek',
        'https://api.deepseek.com',
        'deepseek-chat',
        prompt,
        options.chatHistory,
      );
      const dsResp = await sendHttpWithDesktopFallback(
        fetchImpl,
        dsPayload.endpoint,
        headers,
        dsPayload.bodyJson,
      );
      if (dsResp.ok) {
        response = dsResp;
        config = await storage.saveConfig({
          provider: 'deepseek',
          baseUrl: 'https://api.deepseek.com',
          model: 'deepseek-chat',
        });
        endpoint = dsPayload.endpoint;
        bodyJson = dsPayload.bodyJson;
        payloadDigest = await computePayloadSha256Hex(bodyJson);
      }
    }

    const latencyMs = Math.max(1, Date.now() - startedAtMs);
    if (!response.ok) {
      const errorDetail = await extractErrorDetail(response);
      const errorCode = `HTTP_${response.status}`;
      const failedRecord: AIAnalysisRequestRecord = {
        id: generateAuditId(),
        at: nowIso,
        createdAt: nowIso,
        module: moduleName,
        provider: config.provider,
        model: config.model,
        promptTemplateId: prompt.promptTemplateId,
        payloadDigest,
        status: 'error',
        success: false,
        latencyMs,
        tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        tokensUsed: 0,
        errorCode,
      };
      await storage.saveRequestAudit(failedRecord);
      throw new LifeHubError(
        'LIFEHUB_E_STORAGE',
        `AI 模型接口返回错误状态码：${response.status}${errorDetail ? `（${errorDetail}）` : ''}`,
      );
    }

    const rawJson: unknown = await response.json();
    const { replyText, tokenUsage } = parseProviderResponse(rawJson);

    const successRecord: AIAnalysisRequestRecord = {
      id: generateAuditId(),
      at: nowIso,
      createdAt: nowIso,
      module: moduleName,
      provider: config.provider,
      model: config.model,
      promptTemplateId: prompt.promptTemplateId,
      payloadDigest,
      status: 'success',
      success: true,
      latencyMs,
      tokenUsage,
      tokensUsed: tokenUsage.totalTokens,
    };
    await storage.saveRequestAudit(successRecord);

    return {
      replyText,
      auditRecord: successRecord,
    };
  } catch (err) {
    if (err instanceof LifeHubError) {
      throw err;
    }
    const latencyMs = Math.max(1, Date.now() - startedAtMs);
    const networkErrRecord: AIAnalysisRequestRecord = {
      id: generateAuditId(),
      at: nowIso,
      createdAt: nowIso,
      module: moduleName,
      provider: config.provider,
      model: config.model,
      promptTemplateId: prompt.promptTemplateId,
      payloadDigest,
      status: 'error',
      success: false,
      latencyMs,
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      tokensUsed: 0,
      errorCode: 'NETWORK_ERROR',
    };
    await storage.saveRequestAudit(networkErrRecord);
    const reason = err instanceof Error && err.message ? `：${err.message}` : '';
    throw new LifeHubError(
      'LIFEHUB_E_STORAGE',
      `连接 AI 模型端点失败（${config.baseUrl}${reason}），请检查 API 配置、网络或切换使用本地智能总结。`,
      { cause: err },
    );
  }
}

/**
 * 执行零网络本地离线智能总结，并写入一条 `provider: 'local'` 的纯指标审计记录（E-02 / E-04）。
 *
 * @param context 脱敏聚合上下文
 * @param options 可选存储服务依赖
 * @returns 包含本地复盘报告与审计记录的结果
 * @throws 无
 */
export async function executeLocalSmartAnalysis(
  context: AiPromptContext,
  options: { storage?: AiStorageService; moduleName?: string } = {},
): Promise<AiAnalysisExecutionResult> {
  const storage = options.storage ?? new AiStorageService();
  const moduleName = options.moduleName ?? 'life-review';
  const startedAtMs = Date.now();

  const builtPrompt = buildLifeReviewPrompt(context);
  const payloadDigest = await computePayloadSha256Hex(builtPrompt.userPrompt);
  const replyText = generateLocalSmartSummary(context);
  const latencyMs = Math.max(1, Date.now() - startedAtMs);
  const nowIso = new Date().toISOString();

  const auditRecord: AIAnalysisRequestRecord = {
    id: generateAuditId(),
    at: nowIso,
    createdAt: nowIso,
    module: moduleName,
    provider: 'local',
    model: 'lifehub-local-rule-engine',
    promptTemplateId: PROMPT_TEMPLATE_ID,
    payloadDigest,
    status: 'success',
    success: true,
    latencyMs,
    tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    tokensUsed: 0,
  };

  await storage.saveRequestAudit(auditRecord);
  return {
    replyText,
    auditRecord,
  };
}

/**
 * 执行一次与 AI 顾问的互动对话消息发送（若已配置远程 API Key 或 Ollama 则调用远程模型，否则自动使用本地顾问回复），并写入纯指标审计记录。
 */
export async function executeAiChatMessage(
  context: AiPromptContext,
  chatHistory: readonly AiChatMessage[],
  options: RemoteAiClientOptions = {},
): Promise<AiAnalysisExecutionResult> {
  const storage = options.storage ?? new AiStorageService();
  const config = await storage.getConfigRecord();
  const apiKey = await storage.getDecryptedApiKey();
  const builtPrompt = buildLifeReviewPrompt(context);

  const canUseRemote =
    config.provider === 'ollama' ||
    ((config.provider === 'deepseek' || config.provider === 'openai-compatible') && Boolean(apiKey));

  if (canUseRemote) {
    return executeRemoteAiAnalysis(builtPrompt, {
      ...options,
      storage,
      moduleName: `chat-${context.topic ?? 'comprehensive'}`,
      chatHistory,
    });
  }

  // 未配置远程密钥时，使用零网络本地顾问引擎直接响应对话
  const lastUserMsg =
    [...chatHistory].reverse().find((m) => m.role === 'user')?.content ?? '';
  const startedAtMs = Date.now();
  const replyText = generateLocalChatReply(context, lastUserMsg);
  const payloadDigest = await computePayloadSha256Hex(`${builtPrompt.userPrompt}\n${lastUserMsg}`);
  const latencyMs = Math.max(1, Date.now() - startedAtMs);
  const nowIso = new Date().toISOString();

  const auditRecord: AIAnalysisRequestRecord = {
    id: generateAuditId(),
    at: nowIso,
    createdAt: nowIso,
    module: `chat-${context.topic ?? 'comprehensive'}`,
    provider: 'local',
    model: 'lifehub-local-chat-advisor',
    promptTemplateId: PROMPT_TEMPLATE_ID,
    payloadDigest,
    status: 'success',
    success: true,
    latencyMs,
    tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    tokensUsed: 0,
  };
  await storage.saveRequestAudit(auditRecord);
  return {
    replyText,
    auditRecord,
  };
}
