import {
  CollectionType,
  EditorialCheckReport,
  PublicationItem,
  StoryPlot,
} from './types.js';
import { detectBannedOpenings, detectRomanticCliches } from './contentUtils.js';

export const TELEGRAM_API_MAX_CHARS = 4096;
export const TELEGRAM_SAFE_CHAR_LIMIT = 3800;
export const TELEGRAM_CAPTION_MAX_CHARS = 1024;
export const DZEN_HEADLINE_MAX_CHARS = 140;

export const MIN_TOPIC_HASHTAGS = 3;
export const MAX_TOPIC_HASHTAGS = 5;

const OVERLY_GENERIC_TAGS = new Set([
  '#история',
  '#истории',
  '#жизнь',
  '#люди',
  '#пост',
  '#текст',
  '#дзен',
  '#мысли',
  '#ситуация',
  '#новости',
  '#интересное',
  '#топ',
  '#ии',
]);

export const AI_CLICHE_PATTERNS: RegExp[] = [
  /важно\s+отметить/i,
  /стоит\s+(отметить|понимать|учитывать|помнить)/i,
  /в\s+современном\s+мире/i,
  /в\s+современных\s+реалиях/i,
  /не\s+секрет,?\s+что/i,
  /подводя\s+итог/i,
  /в\s+заключение\s+(хочется|стоит|важно)/i,
  /на\s+самом\s+деле,?\s+(всё|дело)/i,
  /это\s+не\s+просто\s+.{1,40},\s+это\s+/i,
  /играет\s+ключевую\s+роль/i,
  /глубокий\s+анализ/i,
];

export function detectAiCliches(text: string): string[] {
  const source = text || '';
  const found: string[] = [];
  for (const pattern of AI_CLICHE_PATTERNS) {
    const match = source.match(pattern);
    if (match?.[0]) {
      found.push(match[0].trim());
    }
  }
  return found;
}

export function normalizeHashtag(raw: string): string {
  const cleaned = (raw || '')
    .trim()
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-zа-яё0-9_]/gi, '');
  if (!cleaned) return '';
  return `#${cleaned}`;
}

export function normalizeHashtagsList(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const norm = normalizeHashtag(t);
    if (norm && norm.length >= 3 && !seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

export function validateHashtags(
  tags: string[],
  bodyText = ''
): { valid: boolean; normalized: string[]; issues: string[] } {
  const normalized = normalizeHashtagsList(tags);
  const issues: string[] = [];

  if (normalized.length < MIN_TOPIC_HASHTAGS || normalized.length > MAX_TOPIC_HASHTAGS) {
    issues.push(
      `Требуется от ${MIN_TOPIC_HASHTAGS} до ${MAX_TOPIC_HASHTAGS} хештегов (сейчас: ${normalized.length}).`
    );
  }

  const rawLower = tags.map((t) => normalizeHashtag(t)).filter(Boolean);
  if (rawLower.length !== normalized.length) {
    issues.push('Обнаружены повторяющиеся или некорректные хештеги.');
  }

  const genericCount = normalized.filter((t) => OVERLY_GENERIC_TAGS.has(t)).length;
  if (normalized.length > 0 && genericCount === normalized.length) {
    issues.push('Все хештеги слишком общие — добавьте тематические теги по сути сюжета.');
  }

  if (bodyText && normalized.some((t) => t.length > 36)) {
    issues.push('Слишком длинный хештег (> 35 символов).');
  }

  return {
    valid: issues.length === 0,
    normalized,
    issues,
  };
}

export function formatPublicationTitleForDzen(title: string): string {
  const clean = (title || '').trim().replace(/\s+/g, ' ');
  if (!clean) return '';
  if (/[.!?…]$/.test(clean)) return clean;
  return `${clean}.`;
}

export function formatPublicationForTelegram(pub: {
  title: string;
  body: string;
  closingQuestion?: string;
  hashtags: string[];
}): string {
  const headerLine = formatPublicationTitleForDzen(pub.title);
  const cleanBody = (pub.body || '').trim();
  const cleanQuestion = (pub.closingQuestion || '').trim();
  const normTags = normalizeHashtagsList(pub.hashtags).slice(0, MAX_TOPIC_HASHTAGS);

  const blocks: string[] = [];
  if (headerLine) blocks.push(headerLine);
  if (cleanBody) blocks.push(cleanBody);
  if (cleanQuestion && !cleanBody.includes(cleanQuestion)) {
    blocks.push(cleanQuestion);
  }
  if (normTags.length > 0) {
    blocks.push(normTags.join(' '));
  }

  return blocks.join('\n\n').trim();
}

export function extractFirstSentence(text: string): string {
  const trimmed = (text || '').trim();
  if (!trimmed) return '';
  const match = trimmed.match(/^[^\n.!?…]+(?:[.!?…]+|$)/);
  return (match ? match[0] : trimmed.split('\n')[0] || '').trim();
}

export function measurePublicationLength(pub: {
  title: string;
  body: string;
  closingQuestion?: string;
  hashtags: string[];
  safeLimit?: number;
}): {
  formattedText: string;
  totalChars: number;
  remainingChars: number;
  exceedsSafeLimit: boolean;
  exceedsApiLimit: boolean;
  exceedsCaptionLimit: boolean;
  firstSentence: string;
  firstSentenceLength: number;
  headlineExceeds140: boolean;
} {
  const safeLimit = pub.safeLimit || TELEGRAM_SAFE_CHAR_LIMIT;
  const formattedText = formatPublicationForTelegram(pub);
  const totalChars = formattedText.length;
  const remainingChars = safeLimit - totalChars;
  const firstSentence = extractFirstSentence(formattedText);
  const firstSentenceLength = firstSentence.length;

  return {
    formattedText,
    totalChars,
    remainingChars,
    exceedsSafeLimit: totalChars > safeLimit,
    exceedsApiLimit: totalChars > TELEGRAM_API_MAX_CHARS,
    exceedsCaptionLimit: totalChars > TELEGRAM_CAPTION_MAX_CHARS,
    firstSentence,
    firstSentenceLength,
    headlineExceeds140: firstSentenceLength === 0 || firstSentenceLength > DZEN_HEADLINE_MAX_CHARS,
  };
}

export function runEditorialDiagnostics(
  pub: {
    collection: CollectionType;
    title: string;
    body: string;
    closingQuestion?: string;
    hashtags: string[];
  },
  sourceStory?: StoryPlot
): EditorialCheckReport {
  const notes: string[] = [];
  const length = measurePublicationLength(pub);
  const tagCheck = validateHashtags(pub.hashtags, pub.body);

  const headlineOk = !length.headlineExceeds140 && pub.title.trim().length >= 8;
  if (!headlineOk) {
    notes.push(
      `Первое предложение (заголовок для Дзена) составляет ${length.firstSentenceLength} симв. (нужно 8–140 симв.).`
    );
  }

  const rawAll = `${pub.title}\n${pub.body}\n${pub.closingQuestion || ''}`;
  const hasDoubleSpaces = / {2,}/.test(pub.body);
  const hasMixedScriptWord = /[а-яё][a-z]|[a-z][а-яё]/i.test(rawAll);
  const hasRawMarkdown = /(\*\*|__|```|\[.+]\(http)/.test(rawAll);
  const aiCliches = detectAiCliches(rawAll);
  const spellingOk = !hasMixedScriptWord && !hasRawMarkdown && aiCliches.length === 0;

  if (hasDoubleSpaces) notes.push('Найдены двойные пробелы в тексте.');
  if (hasMixedScriptWord) {
    notes.push('Обнаружена возможная опечатка со смешением латиницы и кириллицы в одном слове.');
  }
  if (hasRawMarkdown) {
    notes.push(
      'Уберите Markdown-разметку (** / __ / ссылки): при синхронизации из Telegram в Дзен форматирование теряется.'
    );
  }
  if (aiCliches.length > 0) {
    notes.push(`Обнаружены ИИ-штампы/канцелярит: ${aiCliches.join(', ')}. Замените на живую речь.`);
  }

  const sentences = pub.body
    .split(/[.!?…\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 16);
  const uniqueSentences = new Set(sentences);
  const hasConsecutiveDupWord = /\b([а-яёa-z]{3,})\s+\1\b/i.test(rawAll);
  const noRepetitionOk = uniqueSentences.size === sentences.length && !hasConsecutiveDupWord;
  if (!noRepetitionOk) {
    notes.push('Обнаружены повторяющиеся предложения или подряд идущие одинаковые слова.');
  }

  const paragraphs = pub.body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const logicOk = paragraphs.length >= 2 && pub.body.trim().length >= 200;
  if (!logicOk) {
    notes.push('Разбейте текст минимум на 2 содержательных абзаца (от 200 символов).');
  }

  const banned = detectBannedOpenings(pub.body);
  const cliches = pub.collection === 'romantic' ? detectRomanticCliches(pub.body) : [];
  const styleOk = banned.length === 0 && cliches.length === 0;
  if (banned.length > 0) {
    notes.push('Начало текста похоже на заезженный шаблон — начните с живой сцены или детали.');
  }
  if (cliches.length > 0) {
    notes.push(`Найдены штампы («${cliches.join(', ')}») — замените на конкретную бытовую деталь.`);
  }

  let sourceMatchOk = true;
  if (sourceStory?.coreConflictOrAction) {
    const coreWords = sourceStory.coreConflictOrAction
      .toLowerCase()
      .split(/[^а-яёa-z0-9]+/i)
      .filter((w) => w.length >= 5);
    if (coreWords.length > 0) {
      const bodyLower = pub.body.toLowerCase();
      const hits = coreWords.filter((w) => bodyLower.includes(w)).length;
      sourceMatchOk = hits > 0 || pub.body.length >= 260;
    }
  }

  const passedCount = [
    headlineOk,
    spellingOk,
    noRepetitionOk,
    logicOk,
    styleOk,
    tagCheck.valid,
    sourceMatchOk,
  ].filter(Boolean).length;
   const overallScore = Math.round((passedCount / 7) * 100);

  return {
    overallScore,
    headlineOk,
    spellingOk,
    noRepetitionOk,
    logicOk,
    styleOk,
    hashtagsOk: tagCheck.valid,
    sourceMatchOk,
    notes: [...notes, ...tagCheck.issues],
  };
}

export function formatPublicationTxt(pub: PublicationItem): string {
  const telegramText = formatPublicationForTelegram(pub);
  const metaLines = [
    `ID: ${pub.publicationId}`,
    `Коллекция: ${pub.collection} | Категория: ${pub.category}${pub.subcategory ? ` / ${pub.subcategory}` : ''}`,
    `Статус: ${pub.status}`,
    `Длина поста: ${telegramText.length} симв.`,
    pub.sourceUrl ? `Источник: ${pub.sourceUrl}` : '',
    '='.repeat(50),
    '',
  ].filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''));

  return `${metaLines.join('\n')}${telegramText}\n`;
}

export function formatPublicationJson(
  pub: PublicationItem,
  sourceStory?: StoryPlot | null
): string {
  const payload = {
    exportedAt: new Date().toISOString(),
    publication: {
      ...pub,
      formattedTelegramText: formatPublicationForTelegram(pub),
    },
    sourceStory: sourceStory || null,
  };

  return JSON.stringify(payload, null, 2);
}
