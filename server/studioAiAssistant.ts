import { PublicationItem } from '../src/shared/types.js';
import { normalizeHashtagsList, TELEGRAM_SAFE_CHAR_LIMIT } from '../src/shared/publishingUtils.js';
import { cleanEditorialFormatting } from '../src/shared/contentUtils.js';
import { callChatCompletionJson, formatAiError } from './aiClient.js';

const BLOG_EDITOR_SYSTEM = `Ты — живой автор и редактор популярных блогов на русском языке (MELO_LOVE для Telegram и Яндекс.Дзена).
Правила:
- Текст звучит так, будто его написал живой человек на эмоциях, а не нейросеть: рваный ритм, парцелляция, тире (—), скобки для побочных мыслей, разговорные частицы («ну», «в общем», «короче», «вроде как», «причём») без перебора.
- ЖЁСТКИЙ СТОП-ЛИСТ: запрещены вводные штампы («Давайте смотреть правде в глаза», «И вот тут начинается самое интересное», «Тут ведь какая штука», «Пища для ума», «В итоге мы имеем», «Не секрет, что», «Важно понимать», «Стоит отметить»), психологические клише («личные границы», «токсичный», «абьюз», «эмоциональный импульс», «нарушение табу», «эгоизм в красивой обёртке», «выйти из зоны комфорта», «проработать травму», «красные флаги») и искусственные метафоры («зона боевых действий», «жизнь превратилась в пытку/тюрьму», «акт доброты»).
- Заголовки БЕЗ двоеточий (:) и конструкций «А или Б: почему произошло В».
- Никаких списков с буллитами, жирного текста (** / __), Markdown и эмодзи. Короткие абзацы по 2–4 строки.
- Отвечай строго валидным JSON-объектом.`;

export async function generateAlternativeHeadlines(
  pub: PublicationItem
): Promise<string[]> {
  try {
    const prompt = `Придумай 4 цепляющих, разговорных заголовка на русском языке для поста в Telegram и Дзен (раздел: ${
      pub.collection === 'debate' ? 'Споры и мнения' : 'Тёплые живые истории'
    }).
Ограничения:
- Каждый заголовок от 25 до 115 символов (чтобы безопасно уложиться в лимит 140 символов первого предложения для Яндекс.Дзена).
- КАТЕГОРИЧЕСКИ БЕЗ двоеточий (:) и конструкций вида «А или Б: почему произошло В».
- Ориентир живого заголовка: «Жена притащила щенка в нашу однушку, а у меня аллергия».
- Без жёлтого крика («ШОК!»), без психологического новояза («границы», «токсичный», «абьюз») и без эмодзи.
- Текущий заголовок: ${pub.title}
- Текст: ${pub.body.slice(0, 1200)}

Верни JSON: {"headlines": ["...", "...", "...", "..."]}`;

    const parsed = await callChatCompletionJson<{ headlines?: string[] }>({
      systemInstruction: BLOG_EDITOR_SYSTEM,
      userPrompt: prompt,
      temperature: 0.8,
      maxTokens: 800,
      timeoutMs: 45_000,
    });

    return (parsed.headlines || [])
      .map((h) => cleanEditorialFormatting(String(h)).trim())
      .filter((h) => h.length >= 8 && h.length <= 135 && !h.includes(':'))
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
    const prompt = `Адаптируй публикацию для Telegram и Яндекс.Дзена так, чтобы она читалась максимально естественно и по-человечески (как живой блог, без нейросетевого лоска).
Правила:
1. Никакого SEO-спама и канцелярита.
2. Заголовок до 125 символов — цепляющий, разговорный, БЕЗ двоеточий (:) и конструкций «А или Б: почему В».
3. Общий текст с пробелами должен укладываться в 3500 символов (чтобы с хештегами быть строго <= ${TELEGRAM_SAFE_CHAR_LIMIT}).
4. Сохраняй повествование от первого лица («Я...»), если оно уже от первого лица. Разговорный синтаксис с тире (—), скобками и короткими абзацами по 2–4 строки для чтения с телефона.
5. Никаких списков с буллитами, жирного выделения (** / __), Markdown и эмодзи.
6. Предложи 3–5 точных тематических хештегов (формат #слово_по_теме).

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
      systemInstruction: BLOG_EDITOR_SYSTEM,
      userPrompt: prompt,
      temperature: 0.55,
      maxTokens: 2800,
      timeoutMs: 45_000,
    });

    return {
      adaptedTitle: cleanEditorialFormatting(String(parsed.adaptedTitle || pub.title)).trim(),
      adaptedTeaser: cleanEditorialFormatting(String(parsed.adaptedTeaser || pub.teaser)).trim(),
      adaptedBody: cleanEditorialFormatting(String(parsed.adaptedBody || pub.body)).trim(),
      seoKeywords: Array.isArray(parsed.seoKeywords) ? parsed.seoKeywords.slice(0, 6) : [],
      suggestedHashtags: normalizeHashtagsList(
        Array.isArray(parsed.suggestedHashtags) ? parsed.suggestedHashtags : []
      ).slice(0, 5),
      diffSummary: String(parsed.diffSummary || 'Текст адаптирован под живую речь и короткие абзацы для чтения с телефона.').trim(),
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
Сохрани все бытовые мелочи, нерв истории, лицо рассказчика («Я...», если есть), рваный ритм, тире (—) и скобки. Пиши короткими абзацами по 2–4 строки, БЕЗ буллитов, жирного шрифта, эмодзи и слов из стоп-листа.

Заголовок: ${pub.title}
Текст (${pub.body.length} симв.):
${pub.body}
Вопрос: ${pub.closingQuestion}

Верни JSON: {"shortenedBody": "...", "explanation": "..."}`;

    const parsed = await callChatCompletionJson<{
      shortenedBody?: string;
      explanation?: string;
    }>({
      systemInstruction: BLOG_EDITOR_SYSTEM,
      userPrompt: prompt,
      temperature: 0.45,
      maxTokens: 2400,
      timeoutMs: 45_000,
    });

    return {
      shortenedBody: cleanEditorialFormatting(String(parsed.shortenedBody || pub.body)).trim(),
      explanation: String(parsed.explanation || 'Текст сжат с сохранением живых бытовых деталей и ритма.').trim(),
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
      systemInstruction: BLOG_EDITOR_SYSTEM,
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
