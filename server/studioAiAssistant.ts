import { PublicationItem } from '../src/shared/types.js';
import { normalizeHashtagsList, TELEGRAM_SAFE_CHAR_LIMIT } from '../src/shared/publishingUtils.js';
import { sanitizeKramarovskyDashes } from '../src/shared/contentUtils.js';
import { callChatCompletionJson, formatAiError } from './aiClient.js';

const KRAMAROVSKY_ASSISTANT_SYSTEM = `Ты — редактор проекта MELO_LOVE в яркой, живой, слегка ироничной устной стилистике Ильи Крамаровского.
Правила:
- Никакого канцелярита («в современном мире», «важно отметить», «подводя итог», «не секрет, что», «таким образом»).
- КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО использовать длинные тире (—) и средние тире (–). Используй запятые, точки, двоеточия и скобки.
- Никакого Markdown (** / __ / # в заголовках и теле).
- Отвечай строго валидным JSON-объектом.`;

export async function generateAlternativeHeadlines(
  pub: PublicationItem
): Promise<string[]> {
  try {
    const prompt = `Придумай 4 сильных, живых варианта заголовка на русском языке для публикации MELO_LOVE (раздел: ${
      pub.collection === 'debate' ? 'Споры и мнения' : 'Тёплая жизненная романтика'
    }).
Ограничения:
- Каждый заголовок от 25 до 115 символов (чтобы безопасно уложиться в лимит 140 символов первого предложения для Яндекс Дзена).
- Без кликбейтного жёлтого крика («ШОК!», «Вы не поверите!»), без банальных штампов и БЕЗ длинных тире (—/–).
- Текущий заголовок: ${pub.title}
- Текст: ${pub.body.slice(0, 1200)}

Верни JSON: {"headlines": ["...", "...", "...", "..."]}`;

    const parsed = await callChatCompletionJson<{ headlines?: string[] }>({
      systemInstruction: KRAMAROVSKY_ASSISTANT_SYSTEM,
      userPrompt: prompt,
      temperature: 0.8,
      maxTokens: 800,
      timeoutMs: 45_000,
    });

    return (parsed.headlines || [])
      .map((h) => sanitizeKramarovskyDashes(String(h)).trim())
      .filter((h) => h.length >= 8 && h.length <= 135)
      .slice(0, 5);
  } catch (err) {
    throw formatAiError(err);
  }
}

export async function seoAdaptForDzen(pub: PublicationItem): Promise<{
  adaptedTitle: string;
  adaptedTeaser: string;
  adaptedBody: string;
  seoKeywords: string[];
  suggestedHashtags: string[];
  diffSummary: string;
}> {
  try {
    const prompt = `Сделай деликатную SEO- и читательскую адаптацию публикации для Яндекс Дзена и Telegram-кросспостинга, сохраняя живой ритм и интонацию Ильи Крамаровского.
Правила:
1. Никакого искусственного спама ключевыми словами (не порти живой авторский стиль MELO_LOVE).
2. Заголовок до 125 символов, звучит естественно.
3. Общий текст с пробелами должен укладываться в 3500 символов (чтобы с хештегами быть строго <= ${TELEGRAM_SAFE_CHAR_LIMIT}).
4. Не используй Markdown (** / __ / ссылки) и длинные тире (—/–) — только чистый текст с короткими абзацами.
5. Предложи 3–5 точных тематических хештегов (формат #слово_по_теме).

Текущий заголовок: ${pub.title}
Текущий анонс: ${pub.teaser}
Текущий текст:
${pub.body}
Финальный вопрос: ${pub.closingQuestion}

Верни JSON:
{
  "adaptedTitle": "...",
  "adaptedTeaser": "...",
  "adaptedBody": "...",
  "seoKeywords": ["..."],
  "suggestedHashtags": ["#..."],
  "diffSummary": "..."
}`;

    const parsed = await callChatCompletionJson<{
      adaptedTitle?: string;
      adaptedTeaser?: string;
      adaptedBody?: string;
      seoKeywords?: string[];
      suggestedHashtags?: string[];
      diffSummary?: string;
    }>({
      systemInstruction: KRAMAROVSKY_ASSISTANT_SYSTEM,
      userPrompt: prompt,
      temperature: 0.55,
      maxTokens: 2800,
      timeoutMs: 45_000,
    });

    return {
      adaptedTitle: sanitizeKramarovskyDashes(String(parsed.adaptedTitle || pub.title)).trim(),
      adaptedTeaser: sanitizeKramarovskyDashes(String(parsed.adaptedTeaser || pub.teaser)).trim(),
      adaptedBody: sanitizeKramarovskyDashes(String(parsed.adaptedBody || pub.body)).trim(),
      seoKeywords: Array.isArray(parsed.seoKeywords) ? parsed.seoKeywords.slice(0, 6) : [],
      suggestedHashtags: normalizeHashtagsList(
        Array.isArray(parsed.suggestedHashtags) ? parsed.suggestedHashtags : []
      ).slice(0, 5),
      diffSummary: String(parsed.diffSummary || 'Уточнены формулировки и ритм абзацев для Дзена.').trim(),
    };
  } catch (err) {
    throw formatAiError(err);
  }
}

export async function shortenForTelegramLimit(pub: PublicationItem): Promise<{
  shortenedBody: string;
  explanation: string;
}> {
  try {
    const prompt = `Бережно сократи основной текст публикации так, чтобы вся публикация целиком (с заголовком, вопросом и хештегами) гарантированно укладывалась до 3550 символов с пробелами (лимит Telegram — ${TELEGRAM_SAFE_CHAR_LIMIT}).
Сохрани все ключевые жизненные детали, мотивацию участников, живой ритм и интонацию (короткие фразы, разговорность, БЕЗ длинных тире —/– и без Markdown).

Заголовок: ${pub.title}
Текст (${pub.body.length} симв.):
${pub.body}
Вопрос: ${pub.closingQuestion}

Верни JSON: {"shortenedBody": "...", "explanation": "..."}`;

    const parsed = await callChatCompletionJson<{
      shortenedBody?: string;
      explanation?: string;
    }>({
      systemInstruction: KRAMAROVSKY_ASSISTANT_SYSTEM,
      userPrompt: prompt,
      temperature: 0.45,
      maxTokens: 2400,
      timeoutMs: 45_000,
    });

    return {
      shortenedBody: sanitizeKramarovskyDashes(String(parsed.shortenedBody || pub.body)).trim(),
      explanation: String(parsed.explanation || 'Текст сжат с сохранением ключевой сцены.').trim(),
    };
  } catch (err) {
    throw formatAiError(err);
  }
}

export async function suggestHashtagsForPublication(pub: PublicationItem): Promise<string[]> {
  try {
    const prompt = `Подбери от 3 до 5 точных русских хештегов для этой публикации MELO_LOVE.
Правила:
- Начинаются с #, без пробелов (используй _ при необходимости).
- Не используй слишком общие теги вроде #жизнь, #люди, #история, #текст, #пост.
- Хештеги должны отражать конкретную тему и конфликт текста.
Заголовок: ${pub.title}
Текст: ${pub.body.slice(0, 1200)}

Верни JSON: {"hashtags": ["#...", "#...", "#..."]}`;

    const parsed = await callChatCompletionJson<{ hashtags?: string[] }>({
      systemInstruction: KRAMAROVSKY_ASSISTANT_SYSTEM,
      userPrompt: prompt,
      temperature: 0.5,
      maxTokens: 400,
      timeoutMs: 30_000,
    });

    return normalizeHashtagsList(parsed.hashtags || []).slice(0, 5);
  } catch (err) {
    throw formatAiError(err);
  }
}
