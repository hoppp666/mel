import { ThinkingLevel, Type } from '@google/genai';
import { PublicationItem } from '../src/shared/types.js';
import {
  MAX_TOPIC_HASHTAGS,
  MIN_TOPIC_HASHTAGS,
  normalizeHashtagsList,
  TELEGRAM_SAFE_CHAR_LIMIT,
} from '../src/shared/publishingUtils.js';
import {
  formatGeminiError,
  GEMINI_MODEL,
  runWithGeminiZaiFallback,
  withTimeout,
} from './geminiClient.js';

const ANTI_AI_RULES = `
Правила естественного языка (анти-ИИ):
- Никакого канцелярита и шаблонов нейросети: не используй «важно отметить», «стоит понимать», «в современном мире», «не секрет, что», «подводя итог», «в заключение», «играет ключевую роль», «на самом деле».
- Адаптируй детали под аудиторию в РФ: живой разговорный язык, естественные формулировки без «переводной» кальки.
- Не используй Markdown (** / __ / ссылки) — только чистый текст и короткие живые абзацы.`;

export async function generateAlternativeHeadlines(
  pub: PublicationItem
): Promise<string[]> {
  try {
    const prompt = `Придумай 4 сильных, живых варианта заголовка на русском языке для публикации MELO_LOVE (раздел: ${
      pub.collection === 'debate' ? 'Споры и мнения' : 'Тёплая жизненная романтика'
    }).
Ограничения:
- Каждый заголовок от 25 до 115 символов (чтобы безопасно уложиться в лимит 140 символов первого предложения для Яндекс Дзена).
- Без кликбейтного жёлтого крика («ШОК!», «Вы не поверите!») и без банальных штампов.
- Текущий заголовок: ${pub.title}
- Текст: ${pub.body.slice(0, 1200)}`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        headlines: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
      },
      required: ['headlines'],
    };

    const res = await runWithGeminiZaiFallback(
      (ai) =>
        withTimeout(
          ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: prompt,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              responseMimeType: 'application/json',
              responseSchema,
            },
          }),
          25000
        ),
      {
        userPrompt: prompt,
        responseSchemaHint: responseSchema,
        timeoutMs: 25000,
      }
    );

    const parsed = JSON.parse((res.text ?? '{}').trim()) as { headlines?: string[] };
    return (parsed.headlines || [])
      .map((h) => String(h).trim())
      .filter((h) => h.length >= 8 && h.length <= 135)
      .slice(0, 5);
  } catch (err) {
    throw formatGeminiError(err);
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
    const prompt = `Сделай деликатную редакторскую и читательскую адаптацию публикации для Яндекс Дзена и Telegram-кросспостинга с упором на аудиторию в РФ.
Правила:
1. Никакого искусственного спама ключевыми словами (не порти живой авторский стиль MELO_LOVE).
2. Заголовок должен быть до 125 символов и звучать естественно как первое предложение текста.
3. Общий текст с пробелами должен укладываться в 3500 символов (чтобы с хештегами быть строго <= ${TELEGRAM_SAFE_CHAR_LIMIT}).
4. Подбери от ${MIN_TOPIC_HASHTAGS} до ${MAX_TOPIC_HASHTAGS} точных тематических хештегов по сути сюжета (формат #слово_по_теме, кириллица или латиница без пробелов).
${ANTI_AI_RULES}

Текущий заголовок: ${pub.title}
Текущий анонс: ${pub.teaser}
Текущий текст:
${pub.body}
Финальный вопрос: ${pub.closingQuestion}`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        adaptedTitle: { type: Type.STRING },
        adaptedTeaser: { type: Type.STRING },
        adaptedBody: { type: Type.STRING },
        seoKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
        suggestedHashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
        diffSummary: { type: Type.STRING },
      },
      required: [
        'adaptedTitle',
        'adaptedTeaser',
        'adaptedBody',
        'seoKeywords',
        'suggestedHashtags',
        'diffSummary',
      ],
    };

    const res = await runWithGeminiZaiFallback(
      (ai) =>
        withTimeout(
          ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: prompt,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              responseMimeType: 'application/json',
              responseSchema,
            },
          }),
          30000
        ),
      {
        userPrompt: prompt,
        responseSchemaHint: responseSchema,
        timeoutMs: 30000,
      }
    );

    const parsed = JSON.parse((res.text ?? '{}').trim());
    return {
      adaptedTitle: String(parsed.adaptedTitle || pub.title).trim(),
      adaptedTeaser: String(parsed.adaptedTeaser || pub.teaser).trim(),
      adaptedBody: String(parsed.adaptedBody || pub.body).trim(),
      seoKeywords: Array.isArray(parsed.seoKeywords) ? parsed.seoKeywords.slice(0, 8) : [],
      suggestedHashtags: normalizeHashtagsList(
        Array.isArray(parsed.suggestedHashtags) ? parsed.suggestedHashtags : []
      ).slice(0, MAX_TOPIC_HASHTAGS),
      diffSummary: String(
        parsed.diffSummary || 'Уточнены формулировки, убраны штампы и добавлены тематические теги.'
      ).trim(),
    };
  } catch (err) {
    throw formatGeminiError(err);
  }
}

export async function shortenForTelegramLimit(pub: PublicationItem): Promise<{
  shortenedBody: string;
  explanation: string;
}> {
  try {
    const prompt = `Бережно сократи основной текст публикации так, чтобы вся публикация целиком (с заголовком, вопросом и хештегами) гарантированно укладывалась до 3550 символов с пробелами (лимит Telegram — ${TELEGRAM_SAFE_CHAR_LIMIT}).
Сохрани все ключевые жизненные детали, мотивацию участников и живой тон MELO_LOVE. Не превращай рассказ в сухой пересказ.
${ANTI_AI_RULES}

Заголовок: ${pub.title}
Текст (${pub.body.length} симв.):
${pub.body}
Вопрос: ${pub.closingQuestion}`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        shortenedBody: { type: Type.STRING },
        explanation: { type: Type.STRING },
      },
      required: ['shortenedBody', 'explanation'],
    };

    const res = await runWithGeminiZaiFallback(
      (ai) =>
        withTimeout(
          ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: prompt,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              responseMimeType: 'application/json',
              responseSchema,
            },
          }),
          25000
        ),
      {
        userPrompt: prompt,
        responseSchemaHint: responseSchema,
        timeoutMs: 25000,
      }
    );

    const parsed = JSON.parse((res.text ?? '{}').trim());
    return {
      shortenedBody: String(parsed.shortenedBody || pub.body).trim(),
      explanation: String(parsed.explanation || 'Текст бережно сокращён под лимит Telegram.').trim(),
    };
  } catch (err) {
    throw formatGeminiError(err);
  }
}

export async function suggestHashtagsForPublication(
  pub: PublicationItem
): Promise<string[]> {
  try {
    const prompt = `Подбери от 5 до ${MAX_TOPIC_HASHTAGS} точных тематических хештегов на русском языке под конкретную тему и сюжет этой публикации (раздел: ${
      pub.collection === 'debate' ? 'Споры и мнения' : 'Романтика и отношения'
    }).
Требования:
- Только хештеги по смыслу конкретной новости/ситуации (эмоции, динамика пары, быт, деньги, личные границы, доверие, семья, свидания и т.д.).
- Без общих слов вроде #новости, #пост, #текст, #жизнь, #мысли, #ии.
- Каждый тег с #, без пробелов и дефисов (используй нижнее подчёркивание при необходимости).

Заголовок: ${pub.title}
Анонс: ${pub.teaser}
Текст: ${pub.body.slice(0, 1400)}`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        hashtags: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
      },
      required: ['hashtags'],
    };

    const res = await runWithGeminiZaiFallback(
      (ai) =>
        withTimeout(
          ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: prompt,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              responseMimeType: 'application/json',
              responseSchema,
            },
          }),
          20000
        ),
      {
        userPrompt: prompt,
        responseSchemaHint: responseSchema,
        timeoutMs: 20000,
      }
    );

    const parsed = JSON.parse((res.text ?? '{}').trim()) as { hashtags?: string[] };
    return normalizeHashtagsList(Array.isArray(parsed.hashtags) ? parsed.hashtags : []).slice(
      0,
      MAX_TOPIC_HASHTAGS
    );
  } catch (err) {
    throw formatGeminiError(err);
  }
}
