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

// Backward-compatible re-exports while AI backend runs on GitHub Models (openai/gpt-4o)
export const GEMINI_MODEL = AI_MODEL;
export const GeminiApiError = AiApiError;
export const isGeminiConfigured = isAiConfigured;
export const formatGeminiError = formatAiError;
export { extractErrorText, isQuotaOrAuthError, withTimeout };

export function getGeminiClient(): { model: string; tokenConfigured: boolean } {
  const token = resolveAiApiToken();
  if (!token) {
    throw new AiApiError(
      'GitHub Models (GPT-4o) пока не подключён: задайте GITHUB_MODELS_TOKEN или GITHUB_TOKEN с правом models: read.',
      400,
      'API_KEY_MISSING'
    );
  }
  return { model: AI_MODEL, tokenConfigured: true };
}
