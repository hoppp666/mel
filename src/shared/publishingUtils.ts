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
]);

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

  if (normalized.length < 3 || normalized.length > 5) {
    issues.push(`Требуется от 3 до 5 хештегов (сейчас: ${normalized.length}).`);
  }

  const rawLower = tags.map((t) => normalizeHashtag(t)).filter(Boolean);
  if (rawLower.length !== normalized.length) {
    issues.push('Обнаружены повторяющиеся или некорректные хештеги.');
  }

  const genericCount = normalized.filter((t) => OVERLY_GENERIC_TAGS.has(t)).length;
  if (normalized.length > 0 && genericCount === normalized.length) {
    issues.push('Все хештеги слишком общие — добавьте тематические теги по сути сюжета.');
  }

  // Check if any tag is completely empty or single char
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
  // Dzen cross-posting takes the first sentence (up to 140 chars) as article title.
  // Ensure terminal punctuation so Dzen does not swallow paragraph 1 into the headline.
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
  const normTags = normalizeHashtagsList(pub.hashtags);

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

  // 1. Headline check (Dzen 140-char first sentence rule)
  const headlineOk = !length.headlineExceeds140 && pub.title.trim().length >= 8;
  if (!headlineOk) {
    notes.push(
      `Первое предложение (заголовок для Дзена) составляет ${length.firstSentenceLength} симв. (нужно 8–140 симв.).`
    );
  }

  // 2. Spelling / typography checks (double spaces, mixed latin/cyrillic inside word, markdown artifacts)
  const rawAll = `${pub.title}\n${pub.body}\n${pub.closingQuestion || ''}`;
  const hasDoubleSpaces = / {2,}/.test(pub.body);
  const hasMixedScriptWord = /[а-яё][a-z]|[a-z][а-яё]/i.test(rawAll);
  const hasRawMarkdown = /(\*\*|__|```|\[.+\]\(http)/.test(rawAll);
  const spellingOk = !hasMixedScriptWord && !hasRawMarkdown;
  if (hasDoubleSpaces) notes.push('Найдены двойные пробелы в тексте.');
  if (hasMixedScriptWord) notes.push('Обнаружена возможная опечатка со смешением латиницы и кириллицы в одном слове.');
  if (hasRawMarkdown) notes.push('Уберите Markdown-разметку (** / __ / ссылки): при синхронизации из Telegram в Дзен форматирование теряется.');

  // 3. Repetition check (repeated sentences or consecutive identical words)
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

  // 4. Logic / structure check
  const paragraphs = pub.body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const logicOk = paragraphs.length >= 2 && pub.body.trim().length >= 200;
  if (!logicOk) {
    notes.push('Разбейте текст минимум на 2 содержательных абзаца (от 200 символов).');
  }

  // 5. MELO_LOVE style check
  const banned = detectBannedOpenings(pub.body);
  const cliches = pub.collection === 'romantic' ? detectRomanticCliches(rawAll) : [];
  const meloStyleOk = banned.length === 0 && cliches.length === 0;
  if (banned.length > 0) notes.push(`Шаблонное начало: "${banned[0]}"`);
  if (cliches.length > 0) notes.push(`Романтическое клише: "${cliches[0]}"`);

  // 6. Hashtags check
  const hashtagsOk = tagCheck.valid;
  if (!hashtagsOk) {
    notes.push(...tagCheck.issues);
  }

  if (length.exceedsSafeLimit) {
    notes.push(
      `Длина ${length.totalChars} симв. превышает безопасный лимит Telegram (${TELEGRAM_SAFE_CHAR_LIMIT} симв.): автоотправка будет заблокирована.`
    );
  }

  if (sourceStory && !pub.body.trim()) {
    notes.push(`Отсутствует текст по сюжету ${sourceStory.id}.`);
  }

  return {
    spellingOk,
    noRepetitionOk,
    logicOk,
    meloStyleOk,
    headlineOk,
    hashtagsOk,
    notes,
  };
}

export function formatPublicationTxt(pub: PublicationItem): string {
  const formatted = formatPublicationForTelegram(pub);
  const meta = [
    `ID: ${pub.publicationId}`,
    `Story ID: ${pub.sourceStoryId}`,
    pub.researchId ? `Research ID: ${pub.researchId}` : null,
    pub.sourceUrl ? `Source URL: ${pub.sourceUrl}` : null,
    `Символов с пробелами: ${pub.totalChars}`,
    pub.teaser ? `Анонс: ${pub.teaser}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return `${formatted}\n\n---\n${meta}\n`;
}

export function formatPublicationJson(pub: PublicationItem, sourceStory?: StoryPlot | null): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      publication: pub,
      telegramFormattedText: formatPublicationForTelegram(pub),
      sourceStory: sourceStory || null,
    },
    null,
    2
  );
}
