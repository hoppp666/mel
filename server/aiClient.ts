import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

export const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';
export const DEFAULT_GEMINI_FREE_FALLBACKS = ['gemini-3.1-flash-lite'] as const;
export const DEFAULT_AI_MODEL = DEFAULT_GEMINI_MODEL;

export const DEFAULT_GIGACHAT_OAUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
export const DEFAULT_GIGACHAT_API_URL = 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions';
export const DEFAULT_GIGACHAT_SCOPE = 'GIGACHAT_API_PERS';
export const DEFAULT_GIGACHAT_MODELS = ['GigaChat-2-Pro', 'GigaChat-2', 'GigaChat'] as const;

export const DEFAULT_ZAI_ENDPOINT = 'https://api.z.ai/api/paas/v4/chat/completions';
export const DEFAULT_ZAI_MODELS = ['glm-4.7-flash', 'glm-4.5-flash'] as const;

export const DEFAULT_OPENAI_COMPAT_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

const PLACEHOLDER_TOKENS = new Set([
  '',
  'MY_GEMINI_API_KEY',
  'MY_GIGACHAT_AUTH_KEY',
  'MY_GIGACHAT_CLIENT_ID',
  'MY_GIGACHAT_CLIENT_SECRET',
  'MY_ZAI_API_KEY',
  'MY_GROQ_API_KEY',
  'MY_AI_API_KEY',
  'MY_GITHUB_TOKEN',
  'MY_GITHUB_MODELS_TOKEN',
  'MY_OPENAI_API_KEY',
]);

function cleanEnvValue(raw: string | undefined): string {
  const val = raw?.trim() || '';
  return PLACEHOLDER_TOKENS.has(val) ? '' : val;
}

export function resolveGeminiApiKey(): string {
  return cleanEnvValue(process.env.GEMINI_API_KEY);
}

export function resolveGeminiModelList(): string[] {
  const customPrimary = cleanEnvValue(process.env.GEMINI_MODEL);
  const customFallbacks = (process.env.GEMINI_FALLBACK_MODELS || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  const list = [
    customPrimary || DEFAULT_GEMINI_MODEL,
    ...customFallbacks,
    DEFAULT_GEMINI_MODEL,
    ...DEFAULT_GEMINI_FREE_FALLBACKS,
  ];
  return Array.from(new Set(list));
}

export function resolveGigaChatCredentials(): {
  authKey: string;
  scope: string;
  oauthUrl: string;
  apiUrl: string;
  models: string[];
} {
  let authKey =
    cleanEnvValue(process.env.GIGACHAT_AUTH_KEY) ||
    cleanEnvValue(process.env.GIGACHAT_CREDENTIALS) ||
    cleanEnvValue(process.env.GIGACHAT_API_KEY);

  if (authKey.toLowerCase().startsWith('basic ')) {
    authKey = authKey.slice(6).trim();
  }

  if (!authKey) {
    const clientId = cleanEnvValue(process.env.GIGACHAT_CLIENT_ID);
    const clientSecret = cleanEnvValue(process.env.GIGACHAT_CLIENT_SECRET);
    if (clientId && clientSecret) {
      authKey = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
    }
  }

  const scope = cleanEnvValue(process.env.GIGACHAT_SCOPE) || DEFAULT_GIGACHAT_SCOPE;
  const oauthUrl = cleanEnvValue(process.env.GIGACHAT_OAUTH_URL) || DEFAULT_GIGACHAT_OAUTH_URL;
  const apiUrl = cleanEnvValue(process.env.GIGACHAT_API_ENDPOINT) || DEFAULT_GIGACHAT_API_URL;
  const customModel = cleanEnvValue(process.env.GIGACHAT_MODEL);

  const models = Array.from(
    new Set([
      ...(customModel ? [customModel] : []),
      ...DEFAULT_GIGACHAT_MODELS,
    ])
  );

  return { authKey, scope, oauthUrl, apiUrl, models };
}

export function resolveZaiCredentials(): {
  apiKey: string;
  endpoint: string;
  models: string[];
} {
  const apiKey =
    cleanEnvValue(process.env.ZAI_API_KEY) ||
    cleanEnvValue(process.env.ZHIPU_API_KEY);
  const endpoint =
    cleanEnvValue(process.env.ZAI_API_ENDPOINT) ||
    cleanEnvValue(process.env.ZAI_ENDPOINT) ||
    DEFAULT_ZAI_ENDPOINT;
  const customModel = cleanEnvValue(process.env.ZAI_MODEL);
  const models = Array.from(
    new Set([
      ...(customModel ? [customModel] : []),
      ...DEFAULT_ZAI_MODELS,
    ])
  );
  return { apiKey, endpoint, models };
}

export function resolveOpenAiCompatBackup(): {
  apiKey: string;
  endpoint: string;
  model: string;
} {
  const apiKey =
    cleanEnvValue(process.env.AI_API_KEY) ||
    cleanEnvValue(process.env.GROQ_API_KEY) ||
    cleanEnvValue(process.env.OPENAI_API_KEY);
  const endpoint =
    cleanEnvValue(process.env.AI_ENDPOINT) ||
    cleanEnvValue(process.env.GROQ_API_ENDPOINT) ||
    DEFAULT_OPENAI_COMPAT_ENDPOINT;
  const model =
    cleanEnvValue(process.env.AI_MODEL) ||
    cleanEnvValue(process.env.GROQ_MODEL) ||
    'openai/gpt-oss-120b';

  return { apiKey, endpoint, model };
}

export function isGeminiPrimaryConfigured(): boolean {
  return Boolean(resolveGeminiApiKey());
}

export function isGigaChatConfigured(): boolean {
  return Boolean(resolveGigaChatCredentials().authKey);
}

export function isZaiConfigured(): boolean {
  return Boolean(resolveZaiCredentials().apiKey);
}

export function resolveAiApiToken(): string {
  const gemini = resolveGeminiApiKey();
  if (gemini) return gemini;
  const giga = resolveGigaChatCredentials();
  if (giga.authKey) return giga.authKey;
  const zai = resolveZaiCredentials();
  if (zai.apiKey) return zai.apiKey;
  return resolveOpenAiCompatBackup().apiKey;
}

export function resolveAiModel(): string {
  if (isGeminiPrimaryConfigured()) {
    return resolveGeminiModelList()[0] || DEFAULT_GEMINI_MODEL;
  }
  if (isGigaChatConfigured()) {
    return resolveGigaChatCredentials().models[0] || DEFAULT_GIGACHAT_MODELS[0];
  }
  if (isZaiConfigured()) {
    return resolveZaiCredentials().models[0] || DEFAULT_ZAI_MODELS[0];
  }
  return cleanEnvValue(process.env.GEMINI_MODEL) || DEFAULT_GEMINI_MODEL;
}

export const AI_MODEL = resolveAiModel();

export function isAiConfigured(): boolean {
  return Boolean(
    isGeminiPrimaryConfigured() ||
      isGigaChatConfigured() ||
      isZaiConfigured() ||
      resolveOpenAiCompatBackup().apiKey
  );
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
    msg.includes('402') ||
    msg.includes('403') ||
    msg.includes('unauthorized') ||
    msg.includes('forbidden') ||
    msg.includes('permission_denied') ||
    msg.includes('api_key_invalid') ||
    msg.includes('api_key_missing')
  );
}

function isRetryableProviderError(err: unknown): boolean {
  if (err instanceof AiApiError && err.code === 'ABORTED') return false;
  const msg = extractErrorText(err).toLowerCase();
  return (
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('504') ||
    msg.includes('500') ||
    msg.includes('429') ||
    msg.includes('unavailable') ||
    msg.includes('overloaded') ||
    msg.includes('resource_exhausted') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('deadline_exceeded') ||
    msg.includes('timeout') ||
    msg.includes('таймаут') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('fetch failed') ||
    msg.includes('empty_response') ||
    msg.includes('invalid_json') ||
    msg.includes('невалидный json') ||
    msg.includes('404') ||
    msg.includes('not_found')
  );
}

export function formatAiError(err: unknown): AiApiError {
  if (err instanceof AiApiError) return err;
  const raw = extractErrorText(err);
  const lower = raw.toLowerCase();

  if (lower.includes('api_key_missing')) {
    return new AiApiError(raw, 400, 'API_KEY_MISSING');
  }
  if (
    lower.includes('429') ||
    lower.includes('402') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('payment required')
  ) {
    return new AiApiError(
      'Превышен лимит запросов AI (429 RESOURCE_EXHAUSTED). Повторите чуть позже или подключите резервный GigaChat (GIGACHAT_AUTH_KEY) / Z.ai (ZAI_API_KEY).',
      429,
      'RESOURCE_EXHAUSTED'
    );
  }
  if (
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('permission_denied') ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('credentials')
  ) {
    return new AiApiError(
      'Доступ к AI API отклонён (401/403). Проверьте GEMINI_API_KEY, GIGACHAT_AUTH_KEY или ZAI_API_KEY в Secrets.',
      403,
      'PERMISSION_DENIED'
    );
  }
  if (
    lower.includes('503') ||
    lower.includes('unavailable') ||
    lower.includes('overloaded') ||
    lower.includes('502')
  ) {
    return new AiApiError(
      'Серверы AI временно перегружены (502/503 UNAVAILABLE), резервные модели тоже не ответили. Повторите запрос чуть позже или проверьте GIGACHAT_AUTH_KEY / ZAI_API_KEY.',
      503,
      'UNAVAILABLE'
    );
  }
  if (
    lower.includes('504') ||
    lower.includes('deadline_exceeded') ||
    lower.includes('таймаут') ||
    lower.includes('timeout') ||
    lower.includes('aborted')
  ) {
    return new AiApiError(
      'Превышен таймаут ответа AI-сервера. Повторите запрос.',
      504,
      'DEADLINE_EXCEEDED'
    );
  }
  if (lower.includes('404') || lower.includes('not_found')) {
    return new AiApiError(
      'Выбранная AI-модель не найдена (404). Проверьте настройки GEMINI_MODEL, GIGACHAT_MODEL или ZAI_MODEL.',
      404,
      'NOT_FOUND'
    );
  }
  return new AiApiError(`Ошибка AI API: ${raw.slice(0, 280)}`, 502, 'AI_ERROR');
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

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new AiApiError('Операция отменена пользователем.', 499, 'ABORTED'));
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AiApiError('Операция отменена пользователем.', 499, 'ABORTED'));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
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

function parseJsonPayload<T>(rawText: string, expectArray?: boolean): T {
  const cleaned = stripJsonCodeFences(rawText);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
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
    throw new AiApiError('Модель вернула невалидный JSON.', 502, 'INVALID_JSON');
  }
}

export function createGeminiClientInstance(apiKey = resolveGeminiApiKey()): GoogleGenAI {
  if (!apiKey) {
    throw new AiApiError(
      'GEMINI_API_KEY не задан.',
      400,
      'API_KEY_MISSING'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function callSingleGeminiModel<T>(params: {
  ai: GoogleGenAI;
  model: string;
  systemInstruction?: string;
  userPrompt: string;
  temperature?: number;
  timeoutMs: number;
  signal?: AbortSignal;
  expectArray?: boolean;
}): Promise<T> {
  const isGemini4Series = params.model.startsWith('gemini-4-');
  const config: Record<string, unknown> = {
    responseMimeType: 'application/json',
  };
  if (params.systemInstruction) {
    config.systemInstruction = params.systemInstruction;
  }
  if (isGemini4Series) {
    // Do not pass deprecated sampling parameters (temperature, topP, topK) to Gemini 4 series
    config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
  } else if (typeof params.temperature === 'number') {
    config.temperature = params.temperature;
  }

  const response = await withTimeout(
    params.ai.models.generateContent({
      model: params.model,
      contents: params.userPrompt,
      config,
    }),
    params.timeoutMs,
    params.signal
  );

  const text = response.text;
  if (!text) {
    throw new AiApiError(`Модель ${params.model} вернула пустой ответ.`, 502, 'EMPTY_RESPONSE');
  }
  return parseJsonPayload<T>(text, params.expectArray);
}

// ============================================================================
// GigaChat (Sber) HTTP helper with scoped Russian Trusted CA / TLS support
// ============================================================================

export interface HttpPostResponse {
  status: number;
  bodyText: string;
}

export type GigaChatHttpPostFn = (params: {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  signal?: AbortSignal;
}) => Promise<HttpPostResponse>;

let cachedGigaChatToken: { authKey: string; scope: string; token: string; expiresAtMs: number } | null = null;
let cachedGigaChatAgent: https.Agent | null = null;
let gigaChatPostOverride: GigaChatHttpPostFn | null = null;

export function setGigaChatTransportForTest(fn: GigaChatHttpPostFn | null): void {
  gigaChatPostOverride = fn;
  cachedGigaChatToken = null;
}

function getGigaChatHttpsAgent(): https.Agent {
  if (cachedGigaChatAgent) return cachedGigaChatAgent;
  const caPath = cleanEnvValue(process.env.GIGACHAT_CA_CERT_PATH);
  if (caPath && fs.existsSync(caPath)) {
    cachedGigaChatAgent = new https.Agent({
      ca: fs.readFileSync(caPath),
      rejectUnauthorized: true,
    });
  } else {
    // Scoped strictly to Sber GigaChat endpoints so Russian Trusted Root CA works on GitHub Actions / Cloud Run
    // without disabling TLS verification for the rest of the process.
    cachedGigaChatAgent = new https.Agent({
      rejectUnauthorized: false,
    });
  }
  return cachedGigaChatAgent;
}

async function defaultGigaChatHttpPost(params: {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<HttpPostResponse> {
  if (params.signal?.aborted) {
    throw new AiApiError('Операция отменена пользователем.', 499, 'ABORTED');
  }

  return new Promise<HttpPostResponse>((resolve, reject) => {
    const parsed = new URL(params.url);
    const req = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'POST',
        headers: {
          ...params.headers,
          'Content-Length': String(Buffer.byteLength(params.body, 'utf8')),
        },
        agent: parsed.protocol === 'https:' ? getGigaChatHttpsAgent() : undefined,
        timeout: params.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          cleanup();
          resolve({
            status: res.statusCode || 500,
            bodyText: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );

    const onAbort = () => {
      cleanup();
      req.destroy();
      reject(new AiApiError('Операция отменена пользователем.', 499, 'ABORTED'));
    };
    const cleanup = () => {
      if (params.signal) {
        params.signal.removeEventListener('abort', onAbort);
      }
    };

    if (params.signal) {
      params.signal.addEventListener('abort', onAbort, { once: true });
    }

    req.on('timeout', () => {
      cleanup();
      req.destroy();
      reject(
        new AiApiError(
          `Таймаут запроса к GigaChat (${Math.round(params.timeoutMs / 1000)}с)`,
          504,
          'DEADLINE_EXCEEDED'
        )
      );
    });

    req.on('error', (err) => {
      cleanup();
      reject(err);
    });

    req.write(params.body);
    req.end();
  });
}

async function getGigaChatAccessToken(
  creds: ReturnType<typeof resolveGigaChatCredentials>,
  timeoutMs: number,
  signal?: AbortSignal,
  forceRefresh = false
): Promise<string> {
  const now = Date.now();
  if (
    !forceRefresh &&
    cachedGigaChatToken &&
    cachedGigaChatToken.authKey === creds.authKey &&
    cachedGigaChatToken.scope === creds.scope &&
    cachedGigaChatToken.expiresAtMs - 60_000 > now
  ) {
    return cachedGigaChatToken.token;
  }

  const postFn = gigaChatPostOverride || defaultGigaChatHttpPost;
  const res = await postFn({
    url: creds.oauthUrl,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      RqUID: crypto.randomUUID(),
      Authorization: `Basic ${creds.authKey}`,
    },
    body: `scope=${encodeURIComponent(creds.scope)}`,
    timeoutMs: Math.min(timeoutMs, 25_000),
    signal,
  });

  if (res.status < 200 || res.status >= 300) {
    let detail = res.bodyText.slice(0, 260);
    try {
      const parsed = JSON.parse(res.bodyText) as { message?: string; error_description?: string };
      detail = parsed.error_description || parsed.message || detail;
    } catch {
      // keep raw snippet
    }
    throw new Error(`HTTP ${res.status}: GigaChat OAuth: ${detail}`);
  }

  const parsed = JSON.parse(res.bodyText) as {
    access_token?: string;
    expires_at?: number;
  };
  if (!parsed.access_token) {
    throw new AiApiError('GigaChat OAuth не вернул access_token.', 502, 'EMPTY_RESPONSE');
  }

  const expiresAtMs =
    typeof parsed.expires_at === 'number' && parsed.expires_at > now
      ? parsed.expires_at
      : now + 29 * 60_000;

  cachedGigaChatToken = {
    authKey: creds.authKey,
    scope: creds.scope,
    token: parsed.access_token,
    expiresAtMs,
  };
  return parsed.access_token;
}

async function callSingleGigaChatModel<T>(params: {
  creds: ReturnType<typeof resolveGigaChatCredentials>;
  model: string;
  systemInstruction?: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs: number;
  signal?: AbortSignal;
  expectArray?: boolean;
}): Promise<T> {
  const postFn = gigaChatPostOverride || defaultGigaChatHttpPost;
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (params.systemInstruction) {
    messages.push({ role: 'system', content: params.systemInstruction });
  }
  const hasJsonKeyword =
    (params.systemInstruction || '').toLowerCase().includes('json') ||
    params.userPrompt.toLowerCase().includes('json');
  const userContent =
    !params.expectArray && !hasJsonKeyword
      ? `${params.userPrompt}\n\nОтвет верни строго в формате JSON.`
      : params.userPrompt;
  messages.push({ role: 'user', content: userContent });

  for (let tokenAttempt = 0; tokenAttempt < 2; tokenAttempt++) {
    const accessToken = await getGigaChatAccessToken(
      params.creds,
      params.timeoutMs,
      params.signal,
      tokenAttempt > 0
    );

    const res = await postFn({
      url: params.creds.apiUrl,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        model: params.model,
        messages,
        temperature: params.temperature ?? 0.72,
        max_tokens: params.maxTokens ?? 4096,
        stream: false,
      }),
      timeoutMs: params.timeoutMs,
      signal: params.signal,
    });

    if (res.status === 401 && tokenAttempt === 0) {
      cachedGigaChatToken = null;
      continue;
    }

    if (res.status < 200 || res.status >= 300) {
      let detail = res.bodyText.slice(0, 300);
      try {
        const parsedErr = JSON.parse(res.bodyText) as { message?: string; error?: { message?: string } };
        detail = parsedErr.error?.message || parsedErr.message || detail;
      } catch {
        // keep snippet
      }
      throw new Error(`HTTP ${res.status}: ${detail}`);
    }

    const json = JSON.parse(res.bodyText) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new AiApiError(`Модель ${params.model} вернула пустой ответ.`, 502, 'EMPTY_RESPONSE');
    }
    return parseJsonPayload<T>(content, params.expectArray);
  }

  throw new Error('HTTP 401: GigaChat authorization failed');
}

async function callOpenAiCompatibleEndpoint<T>(params: {
  endpoint: string;
  apiKey: string;
  model: string;
  systemInstruction?: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs: number;
  signal?: AbortSignal;
  expectArray?: boolean;
}): Promise<T> {
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (params.systemInstruction) {
    messages.push({ role: 'system', content: params.systemInstruction });
  }
  const hasJsonKeyword =
    (params.systemInstruction || '').toLowerCase().includes('json') ||
    params.userPrompt.toLowerCase().includes('json');
  const userContent =
    !params.expectArray && !hasJsonKeyword
      ? `${params.userPrompt}\n\nОтвет верни строго в формате JSON.`
      : params.userPrompt;
  messages.push({ role: 'user', content: userContent });

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
  }, params.timeoutMs);

  try {
    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.72,
      max_tokens: params.maxTokens ?? 4096,
    };
    if (!params.expectArray) {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(params.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: internalController.signal,
    });

    const rawText = await res.text();
    if (!res.ok) {
      let detail = rawText.slice(0, 320);
      try {
        const parsedErr = JSON.parse(rawText) as { error?: { message?: string }; message?: string };
        detail = parsedErr.error?.message || parsedErr.message || detail;
      } catch {
        // Keep raw snippet
      }
      throw new Error(`HTTP ${res.status}: ${detail}`);
    }

    const json = JSON.parse(rawText) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new AiApiError(`Модель ${params.model} вернула пустой ответ.`, 502, 'EMPTY_RESPONSE');
    }
    return parseJsonPayload<T>(content, params.expectArray);
  } catch (err) {
    if (timedOut) {
      throw new AiApiError(
        `Таймаут запроса к ${params.model} (${Math.round(params.timeoutMs / 1000)}с)`,
        504,
        'DEADLINE_EXCEEDED'
      );
    }
    if (params.signal?.aborted) {
      throw new AiApiError('Операция отменена пользователем.', 499, 'ABORTED');
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (params.signal) {
      params.signal.removeEventListener('abort', onExternalAbort);
    }
  }
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
  const geminiKey = resolveGeminiApiKey();
  const gigaCreds = resolveGigaChatCredentials();
  const zaiCreds = resolveZaiCredentials();
  const backup = resolveOpenAiCompatBackup();

  if (!geminiKey && !gigaCreds.authKey && !zaiCreds.apiKey && !backup.apiKey) {
    throw new AiApiError(
      'AI-ключи пока не настроены (добавьте GEMINI_API_KEY, резервный GigaChat: GIGACHAT_AUTH_KEY или Z.ai: ZAI_API_KEY). Остальные разделы работают без ключей.',
      400,
      'API_KEY_MISSING'
    );
  }

  const timeoutMs = params.timeoutMs ?? 60_000;
  let lastError: unknown;

  // Tier 1: Google Gemini API (primary + free fallback model cascade with retry)
  if (geminiKey) {
    const ai = createGeminiClientInstance(geminiKey);
    const geminiModels = resolveGeminiModelList();

    for (const model of geminiModels) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await callSingleGeminiModel<T>({
            ai,
            model,
            systemInstruction: params.systemInstruction,
            userPrompt: params.userPrompt,
            temperature: params.temperature,
            timeoutMs,
            signal: params.signal,
            expectArray: params.expectArray,
          });
        } catch (err) {
          if (err instanceof AiApiError && err.code === 'ABORTED') {
            throw err;
          }
          lastError = err;
          if (!isRetryableProviderError(err)) {
            break;
          }
          if (attempt === 0) {
            await sleepWithAbort(900, params.signal);
          }
        }
      }
      if (lastError && !isRetryableProviderError(lastError)) {
        break;
      }
    }
  }

  // Tier 2: GigaChat API (Sber) fallback cascade: GigaChat-2-Pro -> GigaChat-2 -> GigaChat
  if (gigaCreds.authKey) {
    for (const model of gigaCreds.models) {
      try {
        return await callSingleGigaChatModel<T>({
          creds: gigaCreds,
          model,
          systemInstruction: params.systemInstruction,
          userPrompt: params.userPrompt,
          temperature: params.temperature,
          maxTokens: params.maxTokens,
          timeoutMs,
          signal: params.signal,
          expectArray: params.expectArray,
        });
      } catch (err) {
        if (err instanceof AiApiError && err.code === 'ABORTED') {
          throw err;
        }
        lastError = err;
      }
    }
  }

  // Tier 3: Z.ai API (Zhipu AI) additional free fallback cascade: glm-4.7-flash -> glm-4.5-flash
  if (zaiCreds.apiKey) {
    for (const model of zaiCreds.models) {
      try {
        return await callOpenAiCompatibleEndpoint<T>({
          endpoint: zaiCreds.endpoint,
          apiKey: zaiCreds.apiKey,
          model,
          systemInstruction: params.systemInstruction,
          userPrompt: params.userPrompt,
          temperature: params.temperature,
          maxTokens: params.maxTokens,
          timeoutMs,
          signal: params.signal,
          expectArray: params.expectArray,
        });
      } catch (err) {
        if (err instanceof AiApiError && err.code === 'ABORTED') {
          throw err;
        }
        lastError = err;
      }
    }
  }

  // Tier 4: Optional custom OpenAI-compatible backup if explicitly configured
  if (backup.apiKey) {
    try {
      return await callOpenAiCompatibleEndpoint<T>({
        endpoint: backup.endpoint,
        apiKey: backup.apiKey,
        model: backup.model,
        systemInstruction: params.systemInstruction,
        userPrompt: params.userPrompt,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
        timeoutMs,
        signal: params.signal,
        expectArray: params.expectArray,
      });
    } catch (err) {
      if (err instanceof AiApiError && err.code === 'ABORTED') {
        throw err;
      }
      lastError = err;
    }
  }

  throw formatAiError(lastError);
}
