export const DEFAULT_GITHUB_MODELS_ENDPOINT = 'https://models.github.ai/inference/chat/completions';
export const DEFAULT_AI_MODEL = 'openai/gpt-4o';

const PLACEHOLDER_TOKENS = new Set([
  '',
  'MY_GITHUB_TOKEN',
  'MY_GITHUB_MODELS_TOKEN',
  'MY_OPENAI_API_KEY',
  'MY_GEMINI_API_KEY',
]);

export function resolveAiApiToken(): string {
  const candidates = [
    process.env.GITHUB_MODELS_TOKEN,
    process.env.GH_MODELS_TOKEN,
    process.env.GITHUB_TOKEN,
    process.env.OPENAI_API_KEY,
  ];
  for (const raw of candidates) {
    const val = raw?.trim() || '';
    if (val && !PLACEHOLDER_TOKENS.has(val)) {
      return val;
    }
  }
  return '';
}

export function resolveAiEndpoint(): string {
  return process.env.GITHUB_MODELS_ENDPOINT?.trim() || DEFAULT_GITHUB_MODELS_ENDPOINT;
}

export function resolveAiModel(endpoint = resolveAiEndpoint()): string {
  const raw =
    process.env.AI_MODEL?.trim() ||
    process.env.GITHUB_MODELS_MODEL?.trim() ||
    DEFAULT_AI_MODEL;

  // Azure inference endpoint expects "gpt-4o", while models.github.ai expects "openai/gpt-4o"
  if (endpoint.includes('models.inference.ai.azure.com') && raw.startsWith('openai/')) {
    return raw.slice('openai/'.length);
  }
  if (endpoint.includes('models.github.ai') && !raw.includes('/')) {
    return `openai/${raw}`;
  }
  return raw;
}

export const AI_MODEL = resolveAiModel();

export function isAiConfigured(): boolean {
  return Boolean(resolveAiApiToken());
}

export class AiApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 500, code = 'AI_ERROR') {
    super(message);
    this.name = 'AiApiError';
    this.status = status;
    this.code = code;
  }
}

export function extractErrorText(err: unknown): string {
  if (!err) return 'Неизвестная ошибка';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function isQuotaOrAuthError(err: unknown): boolean {
  const msg = extractErrorText(err).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('unauthorized') ||
    msg.includes('forbidden') ||
    msg.includes('permission_denied') ||
    msg.includes('api_key_missing')
  );
}

export function formatAiError(err: unknown): AiApiError {
  if (err instanceof AiApiError) return err;
  const raw = extractErrorText(err);
  const lower = raw.toLowerCase();

  if (lower.includes('api_key_missing') || lower.includes('токен github models')) {
    return new AiApiError(raw, 400, 'API_KEY_MISSING');
  }
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests') || lower.includes('quota')) {
    return new AiApiError(
      'Превышен лимит запросов GitHub Models / GPT-4o (429). Повторите запрос чуть позже или используйте PAT с повышенным лимитом.',
      429,
      'RESOURCE_EXHAUSTED'
    );
  }
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('forbidden') || lower.includes('models: read')) {
    return new AiApiError(
      'Доступ к GitHub Models отклонён (401/403). Проверьте GITHUB_TOKEN с правом permissions: models: read или GITHUB_MODELS_TOKEN в Secrets.',
      403,
      'PERMISSION_DENIED'
    );
  }
  if (lower.includes('503') || lower.includes('unavailable') || lower.includes('overloaded') || lower.includes('502')) {
    return new AiApiError(
      'Модель GPT-4o в GitHub Models временно недоступна (502/503). Повторите запрос чуть позже.',
      503,
      'UNAVAILABLE'
    );
  }
  if (lower.includes('504') || lower.includes('deadline_exceeded') || lower.includes('таймаут') || lower.includes('timeout') || lower.includes('aborted')) {
    return new AiApiError(
      'Превышен таймаут ответа GitHub Models (GPT-4o). Повторите запрос.',
      504,
      'DEADLINE_EXCEEDED'
    );
  }
  if (lower.includes('404') || lower.includes('not_found') || lower.includes('unknown_model')) {
    return new AiApiError(
      `Модель ${resolveAiModel()} не найдена в GitHub Models (404). Проверьте AI_MODEL и GITHUB_MODELS_ENDPOINT.`,
      404,
      'NOT_FOUND'
    );
  }
  return new AiApiError(`Ошибка GitHub Models (GPT-4o): ${raw.slice(0, 280)}`, 502, 'AI_ERROR');
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<T> {
  if (signal?.aborted) {
    throw new AiApiError('Операция отменена пользователем.', 499, 'ABORTED');
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      reject(new AiApiError('Операция отменена пользователем.', 499, 'ABORTED'));
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(new AiApiError(`Таймаут запроса (${Math.round(timeoutMs / 1000)}с)`, 504, 'DEADLINE_EXCEEDED'));
    }, timeoutMs);

    promise
      .then((res) => {
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve(res);
      })
      .catch((err) => {
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        reject(err);
      });
  });
}

function stripJsonCodeFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

export async function callChatCompletionJson<T>(params: {
  systemInstruction?: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  expectArray?: boolean;
}): Promise<T> {
  const token = resolveAiApiToken();
  if (!token) {
    throw new AiApiError(
      'GitHub Models пока не подключён (не задан GITHUB_MODELS_TOKEN или GITHUB_TOKEN с правом models: read). Остальные функции приложения работают в обычном режиме.',
      400,
      'API_KEY_MISSING'
    );
  }

  const endpoint = resolveAiEndpoint();
  const model = resolveAiModel(endpoint);
  const timeoutMs = params.timeoutMs ?? 60_000;

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (params.systemInstruction) {
    messages.push({ role: 'system', content: params.systemInstruction });
  }
  messages.push({ role: 'user', content: params.userPrompt });

  const internalController = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => internalController.abort();
  if (params.signal) {
    if (params.signal.aborted) {
      throw new AiApiError('Операция отменена пользователем.', 499, 'ABORTED');
    }
    params.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    internalController.abort();
  }, timeoutMs);

  try {
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: params.temperature ?? 0.72,
      max_tokens: params.maxTokens ?? 4096,
    };
    if (!params.expectArray) {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: internalController.signal,
    });

    const rawText = await res.text();
    if (!res.ok) {
      let detail = rawText.slice(0, 320);
      try {
        const parsedErr = JSON.parse(rawText) as { error?: { message?: string; code?: string }; message?: string };
        detail = parsedErr.error?.message || parsedErr.message || detail;
      } catch {
        // Keep raw snippet
      }
      throw formatAiError(new Error(`HTTP ${res.status}: ${detail}`));
    }

    const json = JSON.parse(rawText) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new AiApiError('Модель GPT-4o вернула пустой ответ.', 502, 'EMPTY_RESPONSE');
    }

    const cleaned = stripJsonCodeFences(content);
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      const startObj = cleaned.indexOf('{');
      const endObj = cleaned.lastIndexOf('}');
      const startArr = cleaned.indexOf('[');
      const endArr = cleaned.lastIndexOf(']');
      if (params.expectArray && startArr !== -1 && endArr > startArr) {
        return JSON.parse(cleaned.slice(startArr, endArr + 1)) as T;
      }
      if (startObj !== -1 && endObj > startObj) {
        return JSON.parse(cleaned.slice(startObj, endObj + 1)) as T;
      }
      throw new AiApiError('Модель GPT-4o вернула невалидный JSON.', 502, 'INVALID_JSON');
    }
  } catch (err) {
    if (timedOut) {
      throw new AiApiError(
        `Таймаут запроса к GPT-4o (${Math.round(timeoutMs / 1000)}с)`,
        504,
        'DEADLINE_EXCEEDED'
      );
    }
    if (params.signal?.aborted) {
      throw new AiApiError('Операция отменена пользователем.', 499, 'ABORTED');
    }
    throw formatAiError(err);
  } finally {
    clearTimeout(timer);
    if (params.signal) {
      params.signal.removeEventListener('abort', onExternalAbort);
    }
  }
}
