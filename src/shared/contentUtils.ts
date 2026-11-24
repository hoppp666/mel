import { tokenizeNormalized } from './similarity.ts';
import type {
  CollectionType,
  ContentDraft,
  ContentLengthPreset,
  ContentQualityBreakdown,
  ContentQualityChecks,
  NarrativeStructurePattern,
  PhrasebookEntry,
  StoryPlot,
} from './types.ts';

export const BANNED_OPENING_PATTERNS: RegExp[] = [
  /^не понимаю современных мужчин/i,
  /^однажды одна девушка/i,
  /^у меня есть знакомая/i,
  /^недавно произошла такая история/i,
  /^представьте себе ситуацию/i,
  /^в современном мире отношения/i,
];

export const BANNED_ROMANTIC_CLICHES: RegExp[] = [
  /любовь\s*[—-]\s*это не слова,?\s*а поступки/i,
  /настоящая любовь не требует слов/i,
  /любовь с первого взгляда навсегда/i,
  /сердцу не прикажешь/i,
];

export const NARRATIVE_STRUCTURE_LABELS: Record<NarrativeStructurePattern, string> = {
  action_start: 'Начать с конкретного поступка',
  detail_start: 'Начать с неожиданной бытовой детали',
  dialogue_start: 'Начать с короткой живой реплики',
  emotion_start: 'Начать с эмоциональной реакции',
  contradiction_start: 'Начать с острого противоречия',
  observer_start: 'Начать с ироничного/точного наблюдения рассказчика',
  outcome_first: 'Начать с итога и развернуть предысторию',
  gradual_reveal: 'Постепенное раскрытие ситуации и скрытого мотива',
};

export const CONTENT_LENGTH_RANGES: Record<
  CollectionType,
  Record<ContentLengthPreset, { min: number; max: number; label: string }>
> = {
  debate: {
    short: { min: 100, max: 180, label: 'Короткая (100–180 слов)' },
    standard: { min: 180, max: 350, label: 'Стандартная (180–350 слов)' },
    expanded: { min: 350, max: 600, label: 'Развёрнутая (350–600 слов)' },
    longread: { min: 600, max: 900, label: 'Расширенная (600–900 слов)' },
  },
  romantic: {
    short: { min: 120, max: 200, label: 'Короткая (120–200 слов)' },
    standard: { min: 200, max: 400, label: 'Стандартная (200–400 слов)' },
    expanded: { min: 400, max: 650, label: 'Развёрнутая (400–650 слов)' },
    longread: { min: 650, max: 900, label: 'Расширенная (650–900 слов)' },
  },
};

export function countWords(text: string): number {
  const cleaned = (text || '').trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

export function extractFirstSentence(text: string): string {
  const cleaned = (text || '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return '';
  const match = cleaned.match(/^.+?[.!?](?=\s|$)/);
  return (match ? match[0] : cleaned.slice(0, 140)).trim();
}

export function extractLastSentence(text: string): string {
  const cleaned = (text || '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return '';
  const parts = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
  return (parts[parts.length - 1] || cleaned.slice(-140)).trim();
}

export function detectUsedPhrasebookEntries(
  body: string,
  phrasebook: PhrasebookEntry[]
): string[] {
  const lowerBody = (body || '').toLowerCase();
  const used: string[] = [];
  for (const entry of phrasebook) {
    const norm = entry.phrase.trim().toLowerCase().replace(/[.!?]+$/, '');
    if (norm.length >= 6 && lowerBody.includes(norm)) {
      used.push(entry.phrase);
    }
  }
  return used;
}

export function buildContentSemanticFingerprint(
  collection: CollectionType,
  category: string,
  title: string,
  body: string,
  keywords: string[]
): string {
  const tokens = Array.from(
    new Set(tokenizeNormalized([title, keywords.join(' '), body.slice(0, 600)].join(' ')))
  ).slice(0, 14);
  return `P-${collection === 'debate' ? 'D' : 'R'}:${(category || 'general').toLowerCase()}::${tokens.join('|')}`;
}

export function getContentQualityTier(overall: number): string {
  if (overall >= 90) return 'Отличная публикация';
  if (overall >= 85) return 'Хорошая публикация';
  if (overall >= 75) return 'Требует редактуры';
  return 'Не рекомендуется к сохранению';
}

function clampCriterion(val: unknown, max: number, fallback: number): number {
  const n = Number(val);
  if (Number.isNaN(n)) return fallback;
  return Math.max(0, Math.min(max, Math.round(n)));
}

export function calculateContentQualityScore(
  raw: Partial<ContentQualityBreakdown>,
  checks: ContentQualityChecks
): {
  hookStrength: number;
  languageNaturalness: number;
  emotionalImpact: number;
  plotDepth: number;
  narrativeUniqueness: number;
  voiceRecognition: number;
  endingQuality: number;
  sourceFidelity: number;
  overall: number;
  tierLabel: string;
} {
  let hookStrength = clampCriterion(raw.hookStrength, 15, 12);
  let languageNaturalness = clampCriterion(raw.languageNaturalness, 15, 12);
  let emotionalImpact = clampCriterion(raw.emotionalImpact, 15, 12);
  let plotDepth = clampCriterion(raw.plotDepth, 15, 12);
  let narrativeUniqueness = clampCriterion(raw.narrativeUniqueness, 15, 12);
  let voiceRecognition = clampCriterion(raw.voiceRecognition, 10, 8);
  let endingQuality = clampCriterion(raw.endingQuality, 10, 8);
  let sourceFidelity = clampCriterion(raw.sourceFidelity, 5, 4);

  // Enforce objective penalties for structural check failures so scores stay honest
  if (checks.soundsLikeAiTemplate) {
    languageNaturalness = Math.min(languageNaturalness, 10);
    narrativeUniqueness = Math.min(narrativeUniqueness, 10);
  }
  if (checks.hasMeaninglessRepetition) {
    languageNaturalness = Math.min(languageNaturalness, 11);
    narrativeUniqueness = Math.min(narrativeUniqueness, 10);
  }
  if (checks.artificialColloquialism) {
    voiceRecognition = Math.min(voiceRecognition, 6);
  }
  if (checks.phraseOveruse) {
    voiceRecognition = Math.min(voiceRecognition, 5);
    narrativeUniqueness = Math.min(narrativeUniqueness, 11);
  }
  if (checks.contradictsSource || checks.verbatimCopy) {
    sourceFidelity = Math.min(sourceFidelity, 1);
    plotDepth = Math.min(plotDepth, 10);
  }
  if (checks.lostImportantDetail) {
    plotDepth = Math.min(plotDepth, 11);
    sourceFidelity = Math.min(sourceFidelity, 3);
  }
  if (checks.artificialEnding) {
    endingQuality = Math.min(endingQuality, 5);
  }

  const overall =
    hookStrength +
    languageNaturalness +
    emotionalImpact +
    plotDepth +
    narrativeUniqueness +
    voiceRecognition +
    endingQuality +
    sourceFidelity;

  return {
    hookStrength,
    languageNaturalness,
    emotionalImpact,
    plotDepth,
    narrativeUniqueness,
    voiceRecognition,
    endingQuality,
    sourceFidelity,
    overall,
    tierLabel: getContentQualityTier(overall),
  };
}

export function runDeterministicDraftChecks(params: {
  title: string;
  body: string;
  mainTriggerQuestion: string;
  collection: CollectionType;
  sourceStory: StoryPlot;
  recentDrafts: ContentDraft[];
  phrasebook: PhrasebookEntry[];
  excludeDraftId?: string;
}): {
  warnings: string[];
  hasBannedOpening: boolean;
  hasRomanticCliche: boolean;
  repeatedOpeningId?: string;
  repeatedEndingId?: string;
  overusedPhrases: string[];
  bannedPhrasesUsed: string[];
  verbatimOverlapRatio: number;
  usedPhrases: string[];
  openingPattern: string;
  endingPattern: string;
} {
  const {
    body,
    mainTriggerQuestion,
    collection,
    sourceStory,
    recentDrafts,
    phrasebook,
    excludeDraftId,
  } = params;

  const warnings: string[] = [];
  const openingSentence = extractFirstSentence(body);
  const endingSentence = extractLastSentence(mainTriggerQuestion || body);

  const hasBannedOpening = BANNED_OPENING_PATTERNS.some((re) => re.test(openingSentence));
  if (hasBannedOpening) {
    warnings.push(
      `Обнаружено запрещённое шаблонное вступление: «${openingSentence.slice(0, 80)}».`
    );
  }

  const hasRomanticCliche =
    collection === 'romantic' && BANNED_ROMANTIC_CLICHES.some((re) => re.test(body));
  if (hasRomanticCliche) {
    warnings.push('В романтической истории обнаружено избитое шаблонное клише о любви.');
  }

  // Check phrasebook usage, banned items & overuse
  const usedPhrases = detectUsedPhrasebookEntries(body, phrasebook);
  const bannedPhrasesUsed: string[] = [];
  const overusedPhrases: string[] = [];

  for (const phraseText of usedPhrases) {
    const entry = phrasebook.find((p) => p.phrase === phraseText);
    if (!entry) continue;
    if (entry.banned) {
      bannedPhrasesUsed.push(entry.phrase);
    }
    if (entry.isOverused) {
      overusedPhrases.push(entry.phrase);
    }
  }

  if (bannedPhrasesUsed.length > 0) {
    warnings.push(`Использованы запрещённые выражения: ${bannedPhrasesUsed.join(', ')}.`);
  }
  if (overusedPhrases.length > 0) {
    warnings.push(`Слишком часто используемые фразы словаря: ${overusedPhrases.join(', ')}.`);
  }
  if (usedPhrases.length > 2) {
    warnings.push(
      `В одном тексте использовано ${usedPhrases.length} фирменных выражений — риск механической вставки.`
    );
  }

  // Check opening / ending overlap against recent 50 drafts
  const openTokens = new Set(tokenizeNormalized(openingSentence));
  const endTokens = new Set(tokenizeNormalized(endingSentence));

  let repeatedOpeningId: string | undefined;
  let repeatedEndingId: string | undefined;

  for (const prev of recentDrafts.slice(0, 50)) {
    if (excludeDraftId && prev.id === excludeDraftId) continue;
    if (prev.status === 'rejected') continue;

    if (!repeatedOpeningId && openTokens.size >= 3) {
      const prevOpen = new Set(tokenizeNormalized(prev.openingPattern || extractFirstSentence(prev.body)));
      let inter = 0;
      for (const t of openTokens) if (prevOpen.has(t)) inter++;
      const union = openTokens.size + prevOpen.size - inter;
      if (union > 0 && inter / union >= 0.65) {
        repeatedOpeningId = prev.id;
        warnings.push(`Похожее начало с недавней публикацией ${prev.id}.`);
      }
    }

    if (!repeatedEndingId && endTokens.size >= 3) {
      const prevEnd = new Set(
        tokenizeNormalized(prev.endingPattern || prev.mainTriggerQuestion || extractLastSentence(prev.body))
      );
      let inter = 0;
      for (const t of endTokens) if (prevEnd.has(t)) inter++;
      const union = endTokens.size + prevEnd.size - inter;
      if (union > 0 && inter / union >= 0.7) {
        repeatedEndingId = prev.id;
        warnings.push(`Похожий финал/вопрос с недавней публикацией ${prev.id}.`);
      }
    }
  }

  // Check verbatim copying from source fullPlot
  const bodyTokens = tokenizeNormalized(body);
  const srcTokens = new Set(tokenizeNormalized(sourceStory.fullPlot));
  let overlapCount = 0;
  for (const t of new Set(bodyTokens)) {
    if (srcTokens.has(t)) overlapCount++;
  }
  const verbatimOverlapRatio =
    srcTokens.size > 0 && bodyTokens.length > 0
      ? Number((overlapCount / Math.max(srcTokens.size, 1)).toFixed(2))
      : 0;

  // Check exact consecutive 6-word n-gram match with fullPlot
  const normBody = body.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ');
  const srcWords = sourceStory.fullPlot
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean);
  let copiedLongSpan = false;
  if (srcWords.length >= 10) {
    for (let i = 0; i <= srcWords.length - 8; i += 2) {
      const span = srcWords.slice(i, i + 8).join(' ');
      if (span.length > 35 && normBody.includes(span)) {
        copiedLongSpan = true;
        break;
      }
    }
  }
  if (copiedLongSpan) {
    warnings.push('Обнаружен длинный дословный фрагмент, скопированный из исходной заготовки.');
  }

  return {
    warnings,
    hasBannedOpening,
    hasRomanticCliche,
    repeatedOpeningId,
    repeatedEndingId,
    overusedPhrases,
    bannedPhrasesUsed,
    verbatimOverlapRatio: copiedLongSpan ? Math.max(verbatimOverlapRatio, 0.85) : verbatimOverlapRatio,
    usedPhrases,
    openingPattern: openingSentence,
    endingPattern: endingSentence,
  };
}

export function buildContentExportObject(
  draft: ContentDraft,
  sourceStory?: StoryPlot | null,
  includeSource = true
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    contentId: draft.id,
    sourceStoryId: draft.sourceStoryId,
    collection: draft.collection,
    category: draft.category,
    subcategory: draft.subcategory,
    title: draft.title,
    alternativeTitles: draft.alternativeTitles,
    excerpt: draft.excerpt,
    body: draft.body,
    mainTriggerQuestion: draft.mainTriggerQuestion,
    voiceProfile: draft.voiceProfile,
    voiceSettings: draft.voiceSettings,
    narrativeStructure: draft.narrativeStructure,
    contentLength: draft.contentLength,
    lengthPreset: draft.lengthPreset,
    qualityScore: draft.qualityScore,
    qualityBreakdown: draft.qualityBreakdown,
    editorialNotes: draft.editorialNotes,
    status: draft.status,
    sourceUrl: draft.sourceUrl,
    researchId: draft.researchId || '',
    sourceOriginType: draft.sourceOriginType,
    keywords: draft.keywords,
    usedPhrases: draft.usedPhrases,
    openingPattern: draft.openingPattern,
    endingPattern: draft.endingPattern,
    semanticFingerprint: draft.semanticFingerprint,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };

  if (includeSource && sourceStory) {
    base.sourceStory = {
      id: sourceStory.id,
      collection: sourceStory.collection,
      category: sourceStory.category,
      subcategory: sourceStory.subcategory,
      title: sourceStory.title,
      shortDescription: sourceStory.shortDescription,
      fullPlot: sourceStory.fullPlot,
      participants: sourceStory.participants,
      setting: sourceStory.setting,
      coreConflictOrAction: sourceStory.coreConflictOrAction,
      sideAPosition: sourceStory.sideAPosition,
      sideBPosition: sourceStory.sideBPosition,
      emotionalMechanism: sourceStory.emotionalMechanism,
      hiddenExpectation: sourceStory.hiddenExpectation,
      unexpectedNuance: sourceStory.unexpectedNuance,
      possibleTwist: sourceStory.possibleTwist,
      mainTriggerQuestion: sourceStory.mainTriggerQuestion,
      additionalQuestions: sourceStory.additionalQuestions,
      keywords: sourceStory.keywords,
      ideaSource: sourceStory.ideaSource,
      sourceUrl: sourceStory.sourceUrl,
      originType: sourceStory.originType,
      verificationStatus: sourceStory.verificationStatus,
      usageStatus: sourceStory.usageStatus,
      researchId: sourceStory.researchId || '',
      researchNotes: sourceStory.researchNotes || '',
    };
  }

  return base;
}
