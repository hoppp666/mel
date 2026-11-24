import {
  CollectionType,
  ContentDraft,
  ContentExportMode,
  ContentLengthPreset,
  ContentQualityPenalties,
  ContentQualityScore,
  NarrativeStartStyle,
  PhrasebookEntry,
  StoryPlot,
} from './types.js';
import { tokenizeText } from './similarity.js';

export const NARRATIVE_START_STYLES: Array<{
  id: NarrativeStartStyle;
  label: string;
  hint: string;
}> = [
  { id: 'action_start', label: 'С действия или поступка', hint: 'Сразу в конкретный момент, без долгой подводки.' },
  { id: 'detail_start', label: 'С бытовой детали', hint: 'Крошечный предмет, жест или привычка задают весь нерв.' },
  { id: 'dialogue_start', label: 'С реплики', hint: 'Живая фраза одного из участников открывает сцену.' },
  { id: 'emotion_start', label: 'С внутреннего ощущения', hint: 'Точное чувство или неловкая пауза до объяснения причин.' },
  { id: 'contradiction_start', label: 'С контраста слов и дела', hint: 'Обещание и реальность сталкиваются в первом абзаце.' },
  { id: 'observer_start', label: 'Взгляд со стороны', hint: 'Спокойный наблюдательный тон рассказчика без оценки.' },
  { id: 'outcome_first', label: 'С развязки к истокам', hint: 'Показать итог сцены и раскрутить, что к нему привело.' },
  { id: 'gradual_reveal', label: 'Постепенное раскрытие', hint: 'Неожиданный нюанс меняет картину только ближе к концу.' },
];

export const CONTENT_LENGTH_PRESETS: Record<
  ContentLengthPreset,
  { label: string; minWords: number; maxWords: number; description: string }
> = {
  short: { label: 'Короткий', minWords: 170, maxWords: 280, description: '170–280 слов · плотная сцена' },
  standard: { label: 'Стандарт', minWords: 290, maxWords: 450, description: '290–450 слов · формат Дзена' },
  expanded: { label: 'Развёрнутый', minWords: 460, maxWords: 680, description: '460–680 слов · глубокий разбор' },
  longread: { label: 'Лонгрид', minWords: 700, maxWords: 1050, description: '700–1050 слов · подробная история' },
};

export const BANNED_OPENING_PATTERNS: RegExp[] = [
  /^не\s+понимаю\s+современных\s+(мужчин|женщин|людей|парней|девушек)/i,
  /^однажды\s+(одна|один)\s+(девушка|парень|женщина|мужчина)/i,
  /^у\s+меня\s+есть\s+(знакомая|знакомый|подруга|друг)/i,
  /^в\s+современном\s+мире\s+(все|многие|люди)/i,
  /^привет,?\s+дорогие\s+(читатели|друзья|подписчики)/i,
  /^сегодня\s+хочу\s+рассказать\s+(вам\s+)?историю/i,
  /^как\s+часто\s+мы\s+задумываемся/i,
  /^все\s+мы\s+знаем,?\s+что\s+отношения/i,
  /^давайте\s+смотреть\s+правде\s+в\s+глаза/i,
];

export const ROMANTIC_CLICHE_PATTERNS: RegExp[] = [
  /любовь\s*(?:[—–-]|[:,])\s*это\s+не\s+слова,\s*а\s+поступки/i,
  /настоящая\s+любовь\s+проверяется\s+временем/i,
  /берегите\s+друг\s+друга/i,
  /цените\s+каждый\s+момент/i,
  /сердцу\s+не\s+прикажешь/i,
  /половинки\s+одного\s+целого/i,
  /бабочки\s+в\s+животе/i,
  /любовь\s+спас[её]т\s+мир/i,
];

export const AI_BANNED_CLICHE_PATTERNS: RegExp[] = [
  // Вводные штампы и канцелярит
  /давайте\s+смотреть\s+правде\s+в\s+глаза/i,
  /и\s+вот\s+тут\s+начинается\s+самое\s+интересное/i,
  /тут\s+ведь\s+какая\s+(?:штука|история)/i,
  /пища\s+для\s+ума/i,
  /в\s+итоге\s+мы\s+имеем/i,
  /не\s+секрет,?\s+что/i,
  /важно\s+понимать/i,
  /стоит\s+отметить/i,
  /давайте\s+по-честному/i,
  /понимаете,?\s+в\s+ч[её]м\s+штука/i,
  /в\s+современном\s+мире/i,
  /важно\s+отметить/i,
  /подводя\s+итог/i,
  /данный\s+фактор/i,
  /ключевую\s+роль\s+играет/i,
  /таким\s+образом/i,
  // Психологические клише
  /личн(?:ые|ых|ым|ыми)\s+границ(?:а|е|у|ы|ах|ами)?/i,
  /токсичн[а-яё]*/i,
  /абьюз[а-яё]*/i,
  /эмоциональн(?:ый|ого|ому|ым|ом)\s+импульс[а-яё]*/i,
  /нарушени(?:е|я|ю|ем|и)\s+табу/i,
  /эгоизм\s+в\s+красивой\s+об[её]ртке/i,
  /(?:выйти\s+из\s+)?зон[ауеы]\s+комфорта/i,
  /проработа(?:ть|л|ла|ли|ем|йте|ют)\s+травм[а-яё]*/i,
  /красн(?:ые|ый|ых|ыми)\s+флаг(?:и|ов|ами)?/i,
  // Искусственные метафоры
  /зон(?:а|у|е|ой)\s+боевых\s+действий/i,
  /жизнь\s+превратилась\s+в\s+(?:пытку|тюрьму)/i,
  /акт(?:ом|а|у|е)?\s+доброты/i,
];

export function sanitizeKramarovskyDashes(text: string): string {
  if (!text) return '';
  return text
    .replace(/\s+[—–]\s+(?=(?:это|значит|вот|то\s+есть)(?:[\s,.:;!?]|$))/gi, ': ')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/,\s*,+/g, ',')
    .replace(/:\s*,+/g, ':')
    .replace(/([.!?…])\s*,\s*/g, '$1 ');
}

export function cleanEditorialFormatting(text: string): string {
  if (!text) return '';
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function detectBannedAiCliches(text: string): string[] {
  const hits: string[] = [];
  for (const re of AI_BANNED_CLICHE_PATTERNS) {
    const m = text.match(re);
    if (m) hits.push(m[0]);
  }
  return hits;
}

export function detectFormattingViolations(params: {
  title?: string;
  body?: string;
  triggerQuestion?: string;
}): string[] {
  const issues: string[] = [];
  const title = (params.title || '').trim();
  const body = (params.body || '').trim();
  const full = `${title}\n${body}\n${params.triggerQuestion || ''}`;

  if (title && /:/.test(title)) {
    issues.push('двоеточие в заголовке (запрещено конструктами «А или Б: почему В»)');
  }
  if (/(?:^|\n)\s*(?:[-*•▪◦]|\d+[.)])\s+/.test(body)) {
    issues.push('список с буллитами или нумерацией');
  }
  if (/\*\*[^*]+\*\*|__[^_]+__/.test(full)) {
    issues.push('жирное выделение (** / __) внутри текста');
  }
  if (/\p{Extended_Pictographic}/u.test(full)) {
    issues.push('эмодзи в тексте');
  }

  return issues;
}

export function countWords(text: string): number {
  if (!text) return 0;
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

export function extractOpeningPattern(text: string): string {
  const firstSentence = (text || '')
    .trim()
    .split(/[.!?…\n]+/)[0]
    ?.trim() || '';
  return firstSentence.slice(0, 110);
}

export function extractEndingPattern(text: string): string {
  const parts = (text || '')
    .trim()
    .split(/[.!?…\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return '';
  return parts[parts.length - 1].slice(0, 110);
}

export function hasVerbatimPlotCopy(
  generatedText: string,
  sourcePlot: string
): { isVerbatim: boolean; overlapRatio: number; matchedPhrase?: string } {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^a-zа-я0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const genWords = clean(generatedText).split(' ').filter(Boolean);
  const srcWords = clean(sourcePlot).split(' ').filter(Boolean);

  if (genWords.length === 0 || srcWords.length < 8) {
    return { isVerbatim: false, overlapRatio: 0 };
  }

  // Check 8-word contiguous n-gram overlap
  const srcNgrams = new Set<string>();
  for (let i = 0; i <= srcWords.length - 8; i++) {
    srcNgrams.add(srcWords.slice(i, i + 8).join(' '));
  }

  let matchedPhrase: string | undefined;
  for (let i = 0; i <= genWords.length - 8; i++) {
    const gram = genWords.slice(i, i + 8).join(' ');
    if (srcNgrams.has(gram)) {
      matchedPhrase = gram;
      break;
    }
  }

  const genTokens = new Set(tokenizeText(generatedText));
  const srcTokens = new Set(tokenizeText(sourcePlot));
  let shared = 0;
  for (const t of srcTokens) {
    if (genTokens.has(t)) shared++;
  }
  const overlapRatio = srcTokens.size > 0 ? shared / srcTokens.size : 0;

  return {
    isVerbatim: Boolean(matchedPhrase) || overlapRatio > 0.85,
    overlapRatio: Math.round(overlapRatio * 100) / 100,
    matchedPhrase,
  };
}

export function detectBannedOpenings(text: string): string[] {
  const opening = extractOpeningPattern(text);
  const hits: string[] = [];
  for (const re of BANNED_OPENING_PATTERNS) {
    if (re.test(opening)) hits.push(opening);
  }
  return hits;
}

export function detectRomanticCliches(text: string): string[] {
  const hits: string[] = [];
  for (const re of ROMANTIC_CLICHE_PATTERNS) {
    const m = text.match(re);
    if (m) hits.push(m[0]);
  }
  return hits;
}

export function detectPhraseOveruse(
  text: string,
  phrasebook: PhrasebookEntry[]
): { overused: string[]; bannedUsed: string[]; usedEntries: PhrasebookEntry[] } {
  const lower = text.toLowerCase().replace(/ё/g, 'е');
  const overused: string[] = [];
  const bannedUsed: string[] = [];
  const usedEntries: PhrasebookEntry[] = [];

  for (const entry of phrasebook) {
    const normalized = entry.phrase.toLowerCase().replace(/ё/g, 'е').trim();
    if (!normalized) continue;
    if (lower.includes(normalized)) {
      usedEntries.push(entry);
      if (entry.banned) {
        bannedUsed.push(entry.phrase);
      } else if (entry.recentUsageCount >= entry.maxFrequencyPer10) {
        overused.push(entry.phrase);
      }
    }
  }

  return { overused, bannedUsed, usedEntries };
}

export function calculateContentQuality(params: {
  collection: CollectionType;
  title: string;
  body: string;
  triggerQuestion: string;
  sourceStory: StoryPlot;
  recentDrafts: ContentDraft[];
  phrasebook: PhrasebookEntry[];
  minScore?: number;
  aiBreakdown?: Partial<ContentQualityScore['breakdown']>;
  aiPenalties?: Partial<Omit<ContentQualityPenalties, 'details'>>;
  aiComment?: string;
}): ContentQualityScore {
  const {
    collection,
    title,
    body,
    triggerQuestion,
    sourceStory,
    recentDrafts,
    phrasebook,
    minScore = 85,
    aiBreakdown,
    aiPenalties,
    aiComment,
  } = params;

  const fullText = `${title}\n${body}\n${triggerQuestion}`;
  const bannedOpenings = detectBannedOpenings(body);
  const cliches = collection === 'romantic' ? detectRomanticCliches(fullText) : [];
  const aiCliches = detectBannedAiCliches(fullText);
  const formattingIssues = detectFormattingViolations({ title, body, triggerQuestion });
  const verbatim = hasVerbatimPlotCopy(body, sourceStory.fullPlot);
  const phraseCheck = detectPhraseOveruse(fullText, phrasebook);

  const opening = extractOpeningPattern(body);
  const ending = extractEndingPattern(body);
  const openingTokens = new Set(tokenizeText(opening));
  const endingTokens = new Set(tokenizeText(ending));

  let repeatedPattern = false;
  for (const prev of recentDrafts.slice(0, 50)) {
    const prevOpen = new Set(tokenizeText(prev.openingPattern || extractOpeningPattern(prev.body)));
    const prevEnd = new Set(tokenizeText(prev.endingPattern || extractEndingPattern(prev.body)));
    const openInter = [...openingTokens].filter((t) => prevOpen.has(t)).length;
    const endInter = [...endingTokens].filter((t) => prevEnd.has(t)).length;
    if (
      (openingTokens.size >= 4 && openInter / openingTokens.size >= 0.7) ||
      (endingTokens.size >= 4 && endInter / endingTokens.size >= 0.7)
    ) {
      repeatedPattern = true;
      break;
    }
  }

  const details: string[] = [];
  if (bannedOpenings.length > 0) details.push(`Шаблонный зачин: "${bannedOpenings[0]}"`);
  if (cliches.length > 0) details.push(`Романтический штамп: "${cliches[0]}"`);
  if (aiCliches.length > 0) details.push(`Стоп-лист (клише / новояз): ${aiCliches.join(', ')}`);
  if (formattingIssues.length > 0) details.push(`Нарушение формата поста: ${formattingIssues.join(', ')}`);
  if (verbatim.isVerbatim) details.push('Высокое дословное совпадение с исходным fullPlot');
  if (phraseCheck.bannedUsed.length > 0) details.push(`Запрещённая фраза: ${phraseCheck.bannedUsed.join(', ')}`);
  if (phraseCheck.overused.length > 0) details.push(`Превышен лимит фраз за 10 постов: ${phraseCheck.overused.join(', ')}`);
  if (repeatedPattern) details.push('Похожий паттерн зачина/финала встречался в последних 50 черновиках');

  const penalties: ContentQualityPenalties = {
    hasMeaninglessRepetition: Boolean(aiPenalties?.hasMeaninglessRepetition) || repeatedPattern,
    soundsLikeAiTemplate:
      Boolean(aiPenalties?.soundsLikeAiTemplate) ||
      bannedOpenings.length > 0 ||
      cliches.length > 0 ||
      aiCliches.length > 0 ||
      formattingIssues.length > 0,
    artificialColloquialism: Boolean(aiPenalties?.artificialColloquialism),
    phraseOveruse:
      Boolean(aiPenalties?.phraseOveruse) ||
      phraseCheck.overused.length > 0 ||
      phraseCheck.bannedUsed.length > 0,
    contradictsSource: Boolean(aiPenalties?.contradictsSource),
    lostImportantDetail: Boolean(aiPenalties?.lostImportantDetail),
    artificialEnding: Boolean(aiPenalties?.artificialEnding),
    unsubstantiatedClaims: Boolean(aiPenalties?.unsubstantiatedClaims),
    verbatimCopy: Boolean(aiPenalties?.verbatimCopy) || verbatim.isVerbatim,
    details,
  };

  const clampMax = (val: number | undefined, max: number, fallback: number) =>
    Math.max(0, Math.min(max, Math.round(typeof val === 'number' && !Number.isNaN(val) ? val : fallback)));

  const breakdown = {
    hookStrength: clampMax(aiBreakdown?.hookStrength, 15, bannedOpenings.length ? 7 : 13),
    languageNaturalness: clampMax(aiBreakdown?.languageNaturalness, 15, cliches.length || aiCliches.length ? 8 : 13),
    emotionalImpact: clampMax(aiBreakdown?.emotionalImpact, 15, 13),
    plotDepth: clampMax(aiBreakdown?.plotDepth, 15, 13),
    narrativeUniqueness: clampMax(aiBreakdown?.narrativeUniqueness, 15, repeatedPattern || verbatim.isVerbatim ? 7 : 13),
    voiceRecognition: clampMax(aiBreakdown?.voiceRecognition, 10, 9),
    endingQuality: clampMax(aiBreakdown?.endingQuality, 10, 9),
    sourceFidelity: clampMax(aiBreakdown?.sourceFidelity, 5, 5),
  };

  let overall =
    breakdown.hookStrength +
    breakdown.languageNaturalness +
    breakdown.emotionalImpact +
    breakdown.plotDepth +
    breakdown.narrativeUniqueness +
    breakdown.voiceRecognition +
    breakdown.endingQuality +
    breakdown.sourceFidelity;

  // Hard deterministic caps on critical violations
  if (penalties.verbatimCopy) overall = Math.min(overall, 72);
  if (penalties.soundsLikeAiTemplate) overall = Math.min(overall, 78);
  if (penalties.contradictsSource) overall = Math.min(overall, 70);
  if (penalties.phraseOveruse) overall = Math.min(overall, 81);
  if (penalties.hasMeaninglessRepetition) overall = Math.min(overall, 80);

  return {
    overall,
    breakdown,
    penalties,
    editorialComment:
      aiComment ||
      (overall >= minScore
        ? 'Текст звучит по-человечески, держит рваный ритм, сохраняет бытовые детали и формат MELO_LOVE.'
        : 'Требуется доработка: убрать слова из стоп-листа, поправить заголовок/форматирование или точнее передать живые детали.'),
    passedThreshold: overall >= minScore,
  };
}

export function buildContentExportPayload(
  drafts: ContentDraft[],
  storiesById: Map<string, StoryPlot>,
  mode: ContentExportMode
) {
  return {
    exportedAt: new Date().toISOString(),
    exportMode: mode,
    count: drafts.length,
    items: drafts.map((d) => {
      const sourceStory = storiesById.get(d.sourceStoryId) || null;
      if (mode === 'story_only') {
        return {
          contentId: d.contentId,
          sourceStoryId: d.sourceStoryId,
          sourceStory,
        };
      }
      if (mode === 'with_source') {
        return {
          ...d,
          sourceStory,
        };
      }
      return d;
    }),
  };
}
