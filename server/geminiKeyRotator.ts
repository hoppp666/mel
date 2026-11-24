import { GoogleGenAI } from '@google/genai';

let currentKeyIndex = 0;

/**
 * Получить все доступные API ключи из переменных окружения:
 * GEMINI_API_KEY, GEMINI_API_KEY_2, GEMINI_API_KEY_3 или через запятую в GEMINI_API_KEYS.
 */
export function getAvailableApiKeys(): string[] {
  const keys: string[] = [];
  if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
  if (process.env.GEMINI_API_KEY_2) keys.push(process.env.GEMINI_API_KEY_2);
  if (process.env.GEMINI_API_KEY_3) keys.push(process.env.GEMINI_API_KEY_3);
  if (process.env.GEMINI_API_KEYS) {
    for (const k of process.env.GEMINI_API_KEYS.split(',')) {
      const trimmed = k.trim();
      if (trimmed && !keys.includes(trimmed)) keys.push(trimmed);
    }
  }
  return keys;
}

export function hasAnyApiKey(): boolean {
  return getAvailableApiKeys().length > 0;
}

/**
 * Создать клиент GoogleGenAI с текущим активным ключом из пула (с поддержкой ротации).
 */
export function createRotatedGeminiClient(
  httpOptions: { timeout?: number; headers?: Record<string, string> } = {}
): GoogleGenAI {
  const keys = getAvailableApiKeys();
  if (keys.length === 0) {
    throw new Error(
      'Не задан GEMINI_API_KEY в переменных окружения. Добавьте ключ в Settings > Secrets.'
    );
  }
  const apiKey = keys[currentKeyIndex % keys.length];
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
      ...httpOptions,
    },
  });
}

/**
 * Принудительно переключиться на следующий доступный ключ при ошибке квоты (429 / 503).
 */
export function rotateToNextApiKey(): boolean {
  const keys = getAvailableApiKeys();
  if (keys.length <= 1) return false;
  currentKeyIndex = (currentKeyIndex + 1) % keys.length;
  console.log(
    `[MELO_LOVE KEY ROTATOR] Исчерпана квота/ошибка ключа. Переключение на запасной API ключ #${currentKeyIndex + 1} из ${keys.length}.`
  );
  return true;
}
