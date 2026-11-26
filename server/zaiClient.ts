// ============================================================================
// Z.ai (GLM) — автоматический резервный AI-провайдер MELO_LOVE.
// Используется, когда все ключи Gemini вернули 429 RESOURCE_EXHAUSTED /
// 503 UNAVAILABLE или когда ключи Gemini не настроены вовсе.
// Реализован через OpenAI-совместимый REST API Z.ai (chat/completions).
// Каскад провайдеров: Gemini -> Z.ai -> GigaChat -> OpenAI-совместимый backup.
// ============================================================================

export const DEFAULT_ZAI_API_ENDPOINT = 'https://api.z.ai/api/paas/v4/chat/completions';
export const DEFAULT_ZAI_MODEL = 'glm-4.5-flash';

const ZAI_PLACEHOLDER_TOKENS = new Set([
  '',
  'MY_ZAI_API_KEY',
  'MY_ZAI_TOKEN',
  'YOUR_ZAI_API_KEY',
  'YOUR_ZAI_TOKEN',
]);

export class ZaiApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 500, code = 'ZAI_ERROR') {
    super(message);
    this.name = 'ZaiApiError';
    this.status = status;
    this.code = code;
  }
}

function cleanZaiEnvValue(raw: string | undefined): string {
  const val = raw?.trim() || '';
  return ZAI_PLACEHOLDER_TOKENS.has(val) ? '' : val;
}

export interface ZaiCredentials {
  apiKey: string;
  endpoint: string;
  model: string;
}

export function resolveZaiCredentials(): ZaiCredentials {
  const apiKey = cleanZaiEnvValue(process.env.ZAI_API_KEY);
  const endpoint = cleanZaiEnvValue(process.env.ZAI_API_ENDPOINT) || DEFAULT_ZAI_API_ENDPOINT;
  const model = cleanZaiEnvValue(process.env.ZAI_MODEL) || DEFAULT_ZAI_MODEL;
  return { apiKey, endpoint, model };
}

export function isZaiConfigured(): boolean {
  return Boolean(resolveZaiCredentials().apiKey);
}

export function extractZaiErrorText(err: unknown): string {
  if (!err) return 'Неизвестная ошибка';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export interface ZaiChatParams {
  systemInstruction?: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  expectArray?: boolean;
  responseSchemaHint?: unknown;
}

export interface ZaiHttpPostResponse {
  status: number;
  bodyText: string;
}

export type ZaiHttpPostFn = (params: {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  signal?: AbortSignal;
}) => Promise<ZaiHttpPostResponse>;

let zaiPostOverride: ZaiHttpPostFn | null = null;

export function setZaiTransportForTest(fn: ZaiHttpPostFn | null): void {
  zaiPostOverride = fn;
}

function stripZaiCodeFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function stripZaiThinkBlocks(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();
}

function parseZaiJsonPayload<T>(rawText: string, expectArray?: boolean): T {
  const cleaned = stripZaiCodeFences(stripZaiThinkBlocks(rawText));
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Модель добавила текст вокруг JSON — извлекаем самый внешний объект/массив.
    const startObj = cleaned.indexOf('{');
    const endObj = cleaned.lastIndexOf('}');
    const startArr = cleaned.indexOf('[');
    const endArr = cleaned.lastIndexOf(']');
    if (expectArray && startArr !== -1 && endArr > startArr) {
      return JSON.parse(cleaned.slice(startArr, endArr + 1)) as T;
    }
    if (startObj !== -1 && endObj > startObj) {
      return JSON.parse(cleaned.slice(startObj, endObj + 1)) as T;
    }
    throw new ZaiApiError('Модель Z.ai вернула невалидный JSON.', 502, 'INVALID_JSON');
  }
}

export function cleanZaiTextOutput(rawText: string): string {
  const cleaned = stripZaiCodeFences(stripZaiThinkBlocks(rawText));
  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    const startObj = cleaned.indexOf('{');
    const endObj = cleaned.lastIndexOf('}');
    const startArr = cleaned.indexOf('[');
    const endArr = cleaned.lastIndexOf(']');
    const candidate =
      startArr !== -1 && (startObj === -1 || startArr < startObj) && endArr > startArr
        ? cleaned.slice(startArr, endArr + 1)
        : startObj !== -1 && endObj > startObj
          ? cleaned.slice(startObj, endObj + 1)
          : '';
    if (candidate) {
      try {
        JSON.parse(candidate);
        return candidate.trim();
      } catch {
        // Возвращаем очищенный текст как есть (не JSON-ответ).
      }
    }
    return cleaned;
  }
}

function buildZaiMessages(params: ZaiChatParams): Array<{ role: 'system' | 'user'; content: string }> {
  const jsonDemand =
    'Ответ верни строго одним валидным JSON без markdown-обёрток ```json, без комментариев и без текста вне JSON.';
  const schemaHint = params.responseSchemaHint
    ? `\n\nОжидаемая схема JSON-ответа (соблюдай названия и типы полей): ${JSON.stringify(
        params.responseSchemaHint
      )}`
    : '';
  const systemParts = [params.systemInstruction?.trim(), jsonDemand].filter(Boolean);
  return [
    { role: 'system', content: systemParts.join('\n\n') },
    { role: 'user', content: `${params.userPrompt}${schemaHint}` },
  ];
}

async function defaultZaiHttpPost(params: {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<ZaiHttpPostResponse> {
  const internalController = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => internalController.abort();
  if (params.signal) {
    if (params.signal.aborted) {
      throw new ZaiApiError('Операция отменена пользователем.', 499, 'ABORTED');
    }
    params.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    internalController.abort();
  }, params.timeoutMs);

  try {
    const res = await fetch(params.url, {
      method: 'POST',
      headers: params.headers,
      body: params.body,
      signal: internalController.signal,
    });
    const bodyText = await res.text();
    return { status: res.status, bodyText };
  } catch (err) {
    if (timedOut) {
      throw new ZaiApiError(
        `Таймаут запроса к Z.ai (${Math.round(params.timeoutMs / 1000)}с)`,
        504,
        'DEADLINE_EXCEEDED'
      );
    }
    if (params.signal?.aborted) {
      throw new ZaiApiError('Операция отменена пользователем.', 499, 'ABORTED');
    }
    throw new ZaiApiError(
      `Сетевая ошибка при обращении к Z.ai: ${extractZaiErrorText(err).slice(0, 220)}`,
      502,
      'NETWORK_ERROR'
    );
  } finally {
    clearTimeout(timer);
    if (params.signal) {
      params.signal.removeEventListener('abort', onExternalAbort);
    }
  }
}

async function performZaiChatRequest(params: ZaiChatParams): Promise<string> {
  const creds = resolveZaiCredentials();
  if (!creds.apiKey) {
    throw new ZaiApiError(
      'ZAI_API_KEY не задан — резервный провайдер Z.ai не сконфигурирован.',
      400,
      'API_KEY_MISSING'
    );
  }

  const timeoutMs = params.timeoutMs ?? 60_000;
  const postFn = zaiPostOverride || defaultZaiHttpPost;

  const bodyObj: Record<string, unknown> = {
    model: creds.model,
    messages: buildZaiMessages(params),
    temperature: params.temperature ?? 0.72,
    max_tokens: params.maxTokens ?? 4096,
    stream: false,
  };
  // Для серии GLM-4.5 отключаем режим рассуждений: быстрее и детерминированнее JSON.
  if (creds.model.toLowerCase().startsWith('glm-')) {
    bodyObj.thinking = { type: 'disabled' };
  }

  const res = await postFn({
    url: creds.endpoint,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${creds.apiKey}`,
    },
    body: JSON.stringify(bodyObj),
    timeoutMs,
    signal: params.signal,
  });

  if (res.status < 200 || res.status >= 300) {
    let detail = res.bodyText.slice(0, 320);
    try {
      const parsedErr = JSON.parse(res.bodyText) as {
        error?: { message?: string };
        message?: string;
      };
      detail = parsedErr.error?.message || parsedErr.message || detail;
    } catch {
      // Оставляем исходный фрагмент ответа.
    }
    if (res.status === 429) {
      throw new ZaiApiError(
        `HTTP 429: лимит запросов Z.ai исчерпан (${detail})`,
        429,
        'RESOURCE_EXHAUSTED'
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new ZaiApiError(
        `HTTP ${res.status}: Z.ai отклонил ключ авторизации (${detail})`,
        res.status,
        'PERMISSION_DENIED'
      );
    }
    throw new ZaiApiError(`HTTP ${res.status}: Z.ai ${detail}`, res.status, 'ZAI_ERROR');
  }

  const json = JSON.parse(res.bodyText) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new ZaiApiError(`Модель ${creds.model} вернула пустой ответ.`, 502, 'EMPTY_RESPONSE');
  }
  return content;
}

export async function callZaiChatCompletionJson<T>(params: ZaiChatParams): Promise<T> {
  const content = await performZaiChatRequest(params);
  return parseZaiJsonPayload<T>(content, params.expectArray);
}

export async function callZaiChatText(params: ZaiChatParams): Promise<string> {
  const content = await performZaiChatRequest(params);
  return cleanZaiTextOutput(content);
}
