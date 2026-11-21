import {
  AI_MODEL,
  AiApiError,
  extractErrorText,
  formatAiError,
  isAiConfigured,
  isQuotaOrAuthError,
  resolveAiApiToken,
  withTimeout,
} from './aiClient.js';

// Primary: Google Gemini API (@google/genai) with automatic fallback to Sber GigaChat API
export const GEMINI_MODEL = AI_MODEL;
export const GeminiApiError = AiApiError;
export const isGeminiConfigured = isAiConfigured;
export const formatGeminiError = formatAiError;
export { extractErrorText, isQuotaOrAuthError, withTimeout };

export function getGeminiClient(): { model: string; tokenConfigured: boolean } {
  const token = resolveAiApiToken();
  if (!token) {
    throw new AiApiError(
      'AI-ключи пока не настроены: задайте GEMINI_API_KEY и/или резервный GigaChat (GIGACHAT_AUTH_KEY).',
      400,
      'API_KEY_MISSING'
    );
  }
  return { model: AI_MODEL, tokenConfigured: true };
}
