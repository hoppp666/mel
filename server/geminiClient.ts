import { GoogleGenAI } from '@google/genai';
import { callZaiChatText, extractZaiErrorText, isZaiConfigured } from './zaiClient.js';

const KEY_ENV_NAMES = [
  'GEMINI_API_KEY',
  'GEMINI_API_KEY_2',
  'GEMINI_API_KEY_3',
  'GEMINI_API_KEY_4',
  'GEMINI_API_KEY_5',
  'GEMINI_API_KEY_6',
  'GEMINI_API_KEY_7',
  'GEMINI_API_KEY_8',
  'GEMINI_API_KEY_9',
  'GEMINI_API_KEY_10',
] as const;

const clientPool = new Map<string, GoogleGenAI>();
const keyCooldownUntil = new Map<string, number>();
let roundRobinCursor = 0;
let lastSelectedKey = '';

export function getConfiguredGeminiKeys(): string[] {
  const keys = KEY_ENV_NAMES.map((envName) => process.env[envName]?.trim() || '').filter(
    (k) => Boolean(k && k !== 'MY_GEMINI_API_KEY' && !k.startsWith('YOUR_'))
  );
  return Array.from(new Set(keys));
}

export function isGeminiConfigured(): boolean {
  return getConfiguredGeminiKeys().length > 0;
}

export function markGeminiKeyCooldown(apiKey: string, cooldownMs = 65_000): void {
  if (!apiKey) return;
  keyCooldownUntil.set(apiKey, Date.now() + cooldownMs);
}

export function selectAvailableGeminiKey(excludeKeys: Set<string> = new Set()): string {
  const keys = getConfiguredGeminiKeys();
  if (keys.length === 0) {
    throw new GeminiApiError(
      'Gemini API пока не подключён (не задан ни один ключ GEMINI_API_KEY .. GEMINI_API_KEY_10), резервный Z.ai также не настроен (ZAI_API_KEY). Остальные функции приложения работают в обычном режиме.',
      400,
      'API_KEY_MISSING'
    );
  }

  const now = Date.now();
  const nonExcluded = keys.filter((k) => !excludeKeys.has(k));
  const pool = nonExcluded.length > 0 ? nonExcluded : keys;

  // Сначала ищем ключ не на паузе (cooldown) по круговому индексу
  for (let i = 0; i < pool.length; i++) {
    const idx = (roundRobinCursor + i) % pool.length;
    const candidate = pool[idx];
    const until = keyCooldownUntil.get(candidate) || 0;
    if (until <= now) {
      roundRobinCursor = (idx + 1) % pool.length;
      lastSelectedKey = candidate;
      return candidate;
    }
  }

  // Если все ключи на паузе — берём тот, у которого пауза истекает раньше всего
  let earliestKey = pool[0];
  let earliestTime = keyCooldownUntil.get(earliestKey) || 0;
  for (const k of pool) {
    const until = keyCooldownUntil.get(k) || 0;
    if (until < earliestTime) {
      earliestTime = until;
      earliestKey = k;
    }
  }

  lastSelectedKey = earliestKey;
  return earliestKey;
}

export function getGeminiClientForKey(apiKey: string): GoogleGenAI {
  let client = clientPool.get(apiKey);
  if (!client) {
    client = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    clientPool.set(apiKey, client);
  }
  return client;
}

export function getGeminiClient(): GoogleGenAI {
  const apiKey = selectAvailableGeminiKey();
  return getGeminiClientForKey(apiKey);
}

export async function runWithGeminiRotation<T>(
  operation: (ai: GoogleGenAI, apiKey: string) => Promise<T>
): Promise<T> {
  const allKeys = getConfiguredGeminiKeys();
  if (allKeys.length === 0) {
    throw new GeminiApiError(
      'Gemini API пока не подключён (не задан ни один ключ GEMINI_API_KEY .. GEMINI_API_KEY_10), резервный Z.ai также не настроен (ZAI_API_KEY).',
      400,
      'API_KEY_MISSING'
    );
  }

  const triedKeys = new Set<string>();
  const maxAttempts = Math.min(allKeys.length, 10);
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const apiKey = selectAvailableGeminiKey(triedKeys);
    triedKeys.add(apiKey);
    const ai = getGeminiClientForKey(apiKey);

    try {
      return await operation(ai, apiKey);
    } catch (err) {
      lastError = err;
      const lower = extractErrorText(err).toLowerCase();
      const isInvalidKey =
        lower.includes('api_key_invalid') ||
        lower.includes('api key not valid') ||
        lower.includes('permission_denied') ||
        lower.includes('403');
      const isRateOrQuota =
        lower.includes('429') ||
        lower.includes('resource_exhausted') ||
        lower.includes('quota') ||
        lower.includes('503') ||
        lower.includes('unavailable') ||
        lower.includes('overloaded');

      if (isInvalidKey) {
        // Невалидный ключ убираем на 1 час
        markGeminiKeyCooldown(apiKey, 60 * 60 * 1000);
        continue;
      }

      if (isRateOrQuota) {
        // Лимит или перегрузка: ставим ключ на паузу 90 сек и пробуем следующий
        markGeminiKeyCooldown(apiKey, 90_000);
        continue;
      }

      // Остальные ошибки (таймаут, неверный формат ответа и т.д.) пробрасываем сразу
      throw err;
    }
  }

  throw lastError;
}

export interface GeminiLikeTextResponse {
  text?: string;
}

export interface GeminiZaiFallbackParams {
  systemInstruction?: string;
  userPrompt: string;
  responseSchemaHint?: unknown;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export function isGeminiZaiFallbackEligibleError(err: unknown): boolean {
  if (err instanceof GeminiApiError) {
    if (
      err.code === 'API_KEY_MISSING' ||
      err.code === 'RESOURCE_EXHAUSTED' ||
      err.code === 'UNAVAILABLE' ||
      err.code === 'PERMISSION_DENIED'
    ) {
      return true;
    }
  }
  const msg = extractErrorText(err).toLowerCase();
  return (
    isQuotaOrAuthError(err) ||
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('overloaded')
  );
}

export async function runWithGeminiZaiFallback<T extends GeminiLikeTextResponse>(
  operation: (ai: GoogleGenAI, apiKey: string) => Promise<T>,
  zaiParams: GeminiZaiFallbackParams
): Promise<T | { text: string }> {
  let geminiError: unknown;

  try {
    return await runWithGeminiRotation(operation);
  } catch (err) {
    if (err instanceof GeminiApiError && err.code === 'ABORTED') {
      throw err;
    }
    geminiError = err;
    if (!isGeminiZaiFallbackEligibleError(err) || !isZaiConfigured()) {
      throw err;
    }
  }

  // Все ключи Gemini вернули 429/503 или не настроены — автоматический откат на Z.ai (GLM).
  try {
    const text = await callZaiChatText({
      systemInstruction: zaiParams.systemInstruction,
      userPrompt: zaiParams.userPrompt,
      responseSchemaHint: zaiParams.responseSchemaHint,
      temperature: zaiParams.temperature,
      maxTokens: zaiParams.maxTokens,
      timeoutMs: zaiParams.timeoutMs,
      signal: zaiParams.signal,
    });
    console.log(
      '[MELO_LOVE] Ключи Gemini исчерпаны (429/503) или не настроены — выполнен автоматический откат на резервный провайдер Z.ai (GLM).'
    );
    return { text };
  } catch (zaiErr) {
    const geminiFormatted = formatGeminiError(geminiError);
    throw new GeminiApiError(
      `${geminiFormatted.message} Резервный провайдер Z.ai (GLM) также не ответил: ${extractZaiErrorText(
        zaiErr
      ).slice(0, 220)}`,
      geminiFormatted.status,
      geminiFormatted.code
    );
  }
}

export const GEMINI_MODEL = 'gemini-4-hydrogen';

export class GeminiApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 500, code = 'GEMINI_ERROR') {
    super(message);
    this.name = 'GeminiApiError';
    this.status = status;
    this.code = code;
  }
}

export function isQuotaOrAuthError(err: unknown): boolean {
  const msg = extractErrorText(err).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('permission_denied') ||
    msg.includes('api_key_invalid') ||
    msg.includes('api key not valid') ||
    msg.includes('403')
  );
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

export function formatGeminiError(err: unknown): GeminiApiError {
  if (err instanceof GeminiApiError) return err;
  const raw = extractErrorText(err);
  const lower = raw.toLowerCase();

  if (lower.includes('429') || lower.includes('resource_exhausted') || lower.includes('quota')) {
    if (lastSelectedKey) {
      markGeminiKeyCooldown(lastSelectedKey, 90_000);
    }
    return new GeminiApiError(
      'Превышена квота всех доступных ключей Gemini API (429 RESOURCE_EXHAUSTED). Дождитесь сброса лимита или добавьте дополнительные ключи GEMINI_API_KEY_2..10 в Secrets.',
      429,
      'RESOURCE_EXHAUSTED'
    );
  }
  if (
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('permission_denied') ||
    lower.includes('403')
  ) {
    if (lastSelectedKey) {
      markGeminiKeyCooldown(lastSelectedKey, 60 * 60 * 1000);
    }
    return new GeminiApiError(
      'Один из ключей GEMINI_API_KEY недействителен или отклонён (400/403). Проверьте настройки в Settings > Secrets.',
      403,
      'PERMISSION_DENIED'
    );
  }
  if (lower.includes('503') || lower.includes('unavailable') || lower.includes('overloaded')) {
    return new GeminiApiError(
      'Модель Gemini временно перегружена (503 UNAVAILABLE). Повторите запрос чуть позже.',
      503,
      'UNAVAILABLE'
    );
  }
  if (
    lower.includes('504') ||
    lower.includes('deadline_exceeded') ||
    lower.includes('timeout') ||
    lower.includes('aborted')
  ) {
    return new GeminiApiError(
      'Превышен таймаут ответа Gemini API (504/Timeout). Попробуйте уменьшить объём или повторить позже.',
      504,
      'DEADLINE_EXCEEDED'
    );
  }
  if (lower.includes('404') || lower.includes('not_found')) {
    return new GeminiApiError(
      `Запрошенная модель ${GEMINI_MODEL} недоступна (404 NOT_FOUND).`,
      404,
      'NOT_FOUND'
    );
  }

  return new GeminiApiError(`Ошибка Gemini API: ${raw.slice(0, 260)}`, 502, 'GEMINI_ERROR');
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<T> {
  if (signal?.aborted) {
    throw new GeminiApiError('Операция отменена пользователем.', 499, 'ABORTED');
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      reject(new GeminiApiError('Операция отменена пользователем.', 499, 'ABORTED'));
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(
        new GeminiApiError(
          `Таймаут запроса (${Math.round(timeoutMs / 1000)}с)`,
          504,
          'DEADLINE_EXCEEDED'
        )
      );
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
