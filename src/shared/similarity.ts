import type {
  CollectionType,
  QualityMetrics,
  ResearchDuplicateMatch,
  ResearchQualityBreakdown,
  ResearchResult,
  SimilarityMatch,
  StoryPlot,
} from './types.ts';

const STOP_WORDS = new Set([
  'и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а', 'то', 'все', 'она',
  'так', 'его', 'но', 'да', 'ты', 'к', 'у', 'же', 'вы', 'за', 'бы', 'по', 'только', 'ее',
  'мне', 'было', 'вот', 'от', 'меня', 'еще', 'нет', 'о', 'из', 'ему', 'теперь', 'когда',
  'даже', 'ну', 'вдруг', 'ли', 'если', 'уже', 'или', 'ни', 'быть', 'был', 'него', 'до',
  'вас', 'нибудь', 'опять', 'уж', 'вам', 'ведь', 'там', 'потом', 'себя', 'ничего', 'ей',
  'может', 'они', 'тут', 'где', 'есть', 'надо', 'ней', 'для', 'мы', 'тебя', 'их', 'чем',
  'была', 'сам', 'чтоб', 'без', 'будто', 'чего', 'раз', 'тоже', 'себе', 'под', 'будет',
  'ж', 'тогда', 'кто', 'этот', 'того', 'потому', 'этого', 'какой', 'совсем', 'ним', 'здесь',
  'этом', 'один', 'почти', 'мой', 'тем', 'чтобы', 'нее', 'сейчас', 'были', 'куда', 'зачем',
  'всех', 'никогда', 'можно', 'при', 'наконец', 'два', 'об', 'другой', 'хоть', 'после',
  'над', 'больше', 'тот', 'через', 'эти', 'нас', 'про', 'всего', 'них', 'какая', 'много',
  'разве', 'три', 'эту', 'моя', 'впрочем', 'хорошо', 'свою', 'этой', 'перед', 'иногда',
  'лучше', 'чуть', 'том', 'нельзя', 'такой', 'им', 'более', 'всегда', 'конечно', 'всю',
  'между', 'это', 'однажды', 'который', 'которая', 'которые', 'свой', 'своей', 'своего',
  'очень', 'каждый', 'каждая', 'пара', 'парень', 'девушка', 'муж', 'жена', 'мужчина', 'женщина',
  'партнер', 'партнёр', 'отношения', 'отношениях', 'история', 'сюжет', 'человек', 'люди',
  'против', 'прав', 'своих', 'личные', 'личная', 'личное', 'личный', 'разделение',
  'аудитории', 'равных', 'лагеря', 'сторон', 'стороны', 'механизм', 'конфликт',
  'ситуация', 'столкновение', 'жизни', 'жизнь', 'семье', 'семья', 'семейный', 'дома', 'дом',
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'but', 'has', 'have', 'had', 'was',
  'were', 'are', 'been', 'being', 'his', 'her', 'hers', 'she', 'him', 'they', 'them', 'their',
  'you', 'your', 'yours', 'our', 'ours', 'about', 'into', 'over', 'after', 'before', 'when',
  'what', 'who', 'whom', 'which', 'where', 'why', 'how', 'not', 'more', 'most', 'also', 'only',
  'just', 'very', 'much', 'many', 'some', 'such', 'other', 'than', 'then', 'there', 'here',
  'all', 'any', 'both', 'each', 'few', 'own', 'same', 'one', 'two', 'three', 'year', 'years',
  'week', 'day', 'days', 'time', 'say', 'says', 'said', 'like', 'know', 'want', 'make', 'made',
  'get', 'got', 'can', 'could', 'would', 'should', 'will', 'may', 'might', 'via', 'out',
  'off', 'too', 'even', 'way', 'still', 'part', 'new', 'old', 'well', 'now', 'ever', 'never',
  'really', 'actually', 'someone', 'something', 'things', 'thing', 'people', 'person',
  'couple', 'couples', 'relationship', 'relationships', 'partner', 'partners', 'husband', 'wife',
  'photo', 'photos', 'illustration', 'getty', 'images', 'cut', 'article', 'story', 'columnist',
]);

// Lightweight Russian suffix stemmer for robust lexical + semantic overlap detection
export function stemRussianWord(word: string): string {
  const clean = word.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');
  if (clean.length <= 3) return clean;
  return clean.replace(
    /(иями|ями|ами|остью|ости|ение|ание|ство|ств|овать|евать|иться|ться|ого|его|ому|ему|ыми|ими|ая|яя|ое|ее|ые|ие|ый|ий|ой|ам|ям|ом|ем|ах|ях|ов|ев|ей|ии|ия|ью|ую|юю|ть|ти|ет|ут|ют|ит|ат|ят|ал|ял|ил|ла|ло|ли|ка|ку|ки|ке|ой|ом|ым|им|а|я|о|е|у|ю|ы|и)$/i,
    ''
  ) || clean.slice(0, 4);
}

export function tokenizeNormalized(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^a-zа-я0-9]+/i)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
    .map(stemRussianWord)
    .filter((w) => w.length >= 3);
}

export function buildSemanticFingerprint(plot: Partial<StoryPlot>): string {
  const parts = [
    plot.mainTheme || plot.category || '',
    plot.coreConflictOrAction || '',
    (plot.keywords || []).slice(0, 5).join(' '),
  ]
    .map((s) => s.trim())
    .filter(Boolean);

  const tokens = Array.from(new Set(tokenizeNormalized(parts.join(' ')))).slice(0, 12);
  return `${plot.collection === 'debate' ? 'D' : 'R'}:${(plot.category || 'general').toLowerCase()}::${tokens.join('|')}`;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function overlapSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  return intersection / Math.min(a.size, b.size);
}

function extractStoryFeatureSets(story: Partial<StoryPlot>) {
  const coreText = [
    story.title || '',
    story.shortDescription || '',
    story.coreConflictOrAction || '',
    story.mainTheme || '',
  ].join(' ');

  const fullText = [
    coreText,
    story.fullPlot || '',
    story.hiddenExpectation || '',
    story.unexpectedNuance || '',
  ].join(' ');

  const fpBody = (story.semanticFingerprint || '').includes('::')
    ? (story.semanticFingerprint || '').split('::').slice(1).join(' ')
    : story.semanticFingerprint || '';

  const fpTokens = new Set([
    ...tokenizeNormalized(fpBody),
    ...tokenizeNormalized((story.keywords || []).join(' ')),
    ...tokenizeNormalized(story.mainTheme || ''),
  ]);

  const coreTokens = new Set(tokenizeNormalized(coreText));
  const fullTokens = new Set(tokenizeNormalized(fullText));

  // Create semantic bigrams from core conflict + title to catch structural plot clones
  const orderedCore = tokenizeNormalized(coreText);
  const bigrams = new Set<string>();
  for (let i = 0; i < orderedCore.length - 1; i++) {
    bigrams.add(`${orderedCore[i]}_${orderedCore[i + 1]}`);
  }

  return { fpTokens, coreTokens, fullTokens, bigrams };
}

export function findSimilarStories(
  candidate: Partial<StoryPlot>,
  existingStories: StoryPlot[],
  thresholdPercent = 38
): SimilarityMatch[] {
  const cand = extractStoryFeatureSets(candidate);
  const matches: SimilarityMatch[] = [];

  for (const existing of existingStories) {
    if (candidate.id && existing.id === candidate.id) continue;

    const ex = extractStoryFeatureSets(existing);

    const fpSim = jaccardSimilarity(cand.fpTokens, ex.fpTokens);
    const coreJaccard = jaccardSimilarity(cand.coreTokens, ex.coreTokens);
    const coreOverlap = overlapSimilarity(cand.coreTokens, ex.coreTokens);
    const coreSim = coreJaccard * 0.6 + coreOverlap * 0.4;

    const fullJaccard = jaccardSimilarity(cand.fullTokens, ex.fullTokens);
    const fullOverlap = overlapSimilarity(cand.fullTokens, ex.fullTokens);
    const fullSim = fullJaccard * 0.65 + fullOverlap * 0.35;

    const bigramSim = jaccardSimilarity(cand.bigrams, ex.bigrams);

    const sameCollectionBonus = candidate.collection === existing.collection ? 0.02 : 0;
    const sameCategoryBonus =
      candidate.category && existing.category && candidate.category === existing.category ? 0.05 : 0;
    const sameMechanicBonus =
      candidate.plotMechanic && existing.plotMechanic && candidate.plotMechanic === existing.plotMechanic
        ? 0.04
        : 0;

    // Re-weight when candidate is a quick draft without explicit semanticFingerprint/keywords
    const hasFp = cand.fpTokens.size > 0;
    const rawScore = hasFp
      ? fpSim * 0.26 +
        coreSim * 0.36 +
        fullSim * 0.24 +
        bigramSim * 0.14 +
        sameCollectionBonus +
        sameCategoryBonus +
        sameMechanicBonus
      : coreSim * 0.50 +
        fullSim * 0.34 +
        bigramSim * 0.16 +
        sameCollectionBonus +
        sameCategoryBonus +
        sameMechanicBonus;

    // Scale to 0..100 realistically
    const similarityScore = Math.min(99, Math.round(rawScore * 145));

    if (similarityScore >= thresholdPercent) {
      const sharedTokens: string[] = [];
      for (const t of cand.coreTokens) {
        if (ex.coreTokens.has(t)) sharedTokens.push(t);
      }
      for (const t of cand.fpTokens) {
        if (ex.fpTokens.has(t) && !sharedTokens.includes(t)) sharedTokens.push(t);
      }

      const reasons: string[] = [];
      if (candidate.category === existing.category) {
        reasons.push(`совпадает категория «${existing.category}»`);
      }
      if (candidate.plotMechanic && candidate.plotMechanic === existing.plotMechanic) {
        reasons.push(`одинаковая сюжетная механика («${existing.plotMechanic}»)`);
      }
      if (coreSim >= 0.22) {
        reasons.push('близкая формулировка основного конфликта/действия');
      }
      if (fpSim >= 0.25) {
        reasons.push('пересечение семантического отпечатка и ключевых тем');
      }
      if (reasons.length === 0) {
        reasons.push('высокое лексико-тематическое пересечение сюжетной основы');
      }

      matches.push({
        matchedId: existing.id,
        matchedTitle: existing.title,
        matchedShortDescription: existing.shortDescription,
        matchedCollection: existing.collection,
        matchedCategory: existing.category,
        similarityScore,
        sharedKeywords: sharedTokens.slice(0, 6),
        reason: `Сходство ${similarityScore}%: ${reasons.join(', ')}.`,
      });
    }
  }

  return matches.sort((a, b) => b.similarityScore - a.similarityScore).slice(0, 5);
}

export function calculateOverallQuality(q: Partial<QualityMetrics>, collection: 'debate' | 'romantic'): number {
  const baseValues = [
    q.originality ?? 75,
    q.realism ?? 75,
    q.emotionalExpressiveness ?? 75,
    q.interest ?? 75,
    q.discussionPotential ?? 75,
    q.specificity ?? 75,
    q.plotVariability ?? 75,
  ];
  const specificValues =
    collection === 'debate'
      ? [
          q.ambiguity ?? 75,
          q.bothSidesArgumentation ?? 75,
          q.contradictionStrength ?? 75,
        ]
      : [
          q.emotionalWarmth ?? 75,
          q.relatability ?? 75,
          q.smallDetailPower ?? 75,
          q.naturalness ?? 75,
        ];

  const all = [...baseValues, ...specificValues];
  return Math.round(all.reduce((acc, v) => acc + v, 0) / all.length);
}

export function storiesToCsv(stories: StoryPlot[]): string {
  const headers = [
    'id',
    'collection',
    'category',
    'subcategory',
    'title',
    'short_description',
    'full_plot',
    'participants',
    'setting',
    'core_conflict_or_action',
    'side_a_position',
    'side_b_position',
    'emotional_mechanism',
    'hidden_expectation',
    'unexpected_nuance',
    'possible_twist',
    'main_trigger_question',
    'additional_questions',
    'keywords',
    'idea_source',
    'source_url',
    'origin_type',
    'created_at',
    'verification_status',
    'usage_status',
    'semantic_fingerprint',
    'main_theme',
    'plot_mechanic',
    'unique_details',
    'source_analysis_note',
    'batch_number',
    'quality_overall',
    'quality_note',
  ];

  const escapeCell = (val: unknown): string => {
    const str = String(val ?? '').replace(/\r?\n/g, ' ');
    if (/[",;\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = stories.map((s) =>
    [
      s.id,
      s.collection,
      s.category,
      s.subcategory,
      s.title,
      s.shortDescription,
      s.fullPlot,
      s.participants,
      s.setting,
      s.coreConflictOrAction,
      s.sideAPosition,
      s.sideBPosition,
      s.emotionalMechanism,
      s.hiddenExpectation,
      s.unexpectedNuance,
      s.possibleTwist,
      s.mainTriggerQuestion,
      s.additionalQuestions.join(' | '),
      s.keywords.join(', '),
      s.ideaSource,
      s.sourceUrl,
      s.originType,
      s.createdAt,
      s.verificationStatus,
      s.usageStatus,
      s.semanticFingerprint,
      s.mainTheme,
      s.plotMechanic,
      s.uniqueDetails,
      s.sourceAnalysisNote || '',
      s.batchNumber,
      s.quality.overall,
      s.quality.editorialNote,
    ]
      .map(escapeCell)
      .join(',')
  );

  // UTF-8 BOM for seamless Excel / Supabase CSV import
  return '\uFEFF' + [headers.join(','), ...rows].join('\n');
}

export const SUPABASE_SQL_SCHEMA = `-- MELO_LOVE Story Database — Supabase PostgreSQL Schema
create table if not exists public.melo_story_plots (
  id text primary key,
  collection text not null check (collection in ('debate', 'romantic')),
  category text not null,
  subcategory text not null,
  title text not null,
  short_description text not null,
  full_plot text not null,
  participants text not null,
  setting text not null,
  core_conflict_or_action text not null,
  side_a_position text not null,
  side_b_position text not null,
  emotional_mechanism text not null,
  hidden_expectation text not null,
  unexpected_nuance text not null,
  possible_twist text not null,
  main_trigger_question text not null,
  additional_questions jsonb not null default '[]'::jsonb,
  keywords jsonb not null default '[]'::jsonb,
  idea_source text not null,
  source_url text not null default '',
  origin_type text not null check (origin_type in ('external', 'original')),
  created_at timestamptz not null default now(),
  verification_status text not null check (verification_status in ('pending', 'approved', 'needs_revision', 'rejected')),
  usage_status text not null check (usage_status in ('unused', 'drafted', 'published', 'archived')),
  semantic_fingerprint text not null,
  main_theme text not null,
  plot_mechanic text not null,
  unique_details text not null,
  source_analysis_note text,
  batch_number integer not null default 1,
  quality_metrics jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_melo_collection_cat on public.melo_story_plots (collection, category);
create index if not exists idx_melo_verification on public.melo_story_plots (verification_status);
create index if not exists idx_melo_fingerprint on public.melo_story_plots (semantic_fingerprint);
`;

export function getResearchQualityTier(score: number): string {
  if (score >= 90) return 'Отличная идея';
  if (score >= 85) return 'Хорошая идея';
  if (score >= 75) return 'Требует проверки';
  return 'Рекомендуется доработка или отклонение';
}

export function calculateResearchQuality(
  q: Partial<ResearchQualityBreakdown>,
  collection: CollectionType
): { overall: number; tierLabel: string } {
  const baseValues = [
    q.originality ?? 75,
    q.realism ?? 75,
    q.specificity ?? 75,
    q.emotionalExpressiveness ?? 75,
    q.readerInterest ?? 75,
    q.diversity ?? 75,
    q.discussionPotential ?? 75,
    q.mechanicQuality ?? 75,
  ];
  const specificValues =
    collection === 'debate'
      ? [
          q.ambiguity ?? 75,
          q.bothSidesArgumentation ?? 75,
          q.debatePotential ?? 75,
        ]
      : [
          q.warmth ?? 76,
          q.naturalness ?? 76,
          q.emotionalDetailPower ?? 76,
          q.relatability ?? 76,
          q.nonSaccharine ?? 76,
        ];
  const all = [...baseValues, ...specificValues];
  const overall = Math.round(all.reduce((acc, v) => acc + v, 0) / all.length);
  return { overall, tierLabel: getResearchQualityTier(overall) };
}

export function researchResultToPseudoStory(result: ResearchResult): StoryPlot {
  const idea = result.generatedIdea;
  const title = idea?.title || result.sourceTitle;
  const shortDescription = idea?.shortDescription || result.sourceSummary;
  const fullPlot = idea?.fullPlot || `${result.mainSituation}\n${result.mainConflict}`;
  const coreConflictOrAction =
    idea?.coreConflictOrAction || result.mainConflict || result.mainSituation || result.sourceTitle;
  const category = idea?.category || result.targetCategory;
  const mainTheme = idea?.mainTheme || result.mainSituation || result.sourceTitle;
  const plotMechanic = idea?.plotMechanic || result.storyMechanic;
  const keywords = idea?.keywords?.length ? idea.keywords : result.keywords;

  const base: StoryPlot = {
    id: result.researchId,
    collection: result.collection,
    category,
    subcategory: idea?.subcategory || result.relationshipType || 'Зарубежное исследование',
    title,
    shortDescription,
    fullPlot,
    participants: idea?.participants || result.participants,
    setting: idea?.setting || '',
    coreConflictOrAction,
    sideAPosition: idea?.sideAPosition || result.positionsOfParticipants.sideA,
    sideBPosition: idea?.sideBPosition || result.positionsOfParticipants.sideB,
    emotionalMechanism: idea?.emotionalMechanism || result.emotionalMechanism,
    hiddenExpectation: idea?.hiddenExpectation || result.hiddenExpectation,
    unexpectedNuance: idea?.unexpectedNuance || result.unexpectedDetail,
    possibleTwist: idea?.possibleTwist || result.possibleTwist,
    mainTriggerQuestion: idea?.mainTriggerQuestion || result.readerReactionPotential,
    additionalQuestions: idea?.additionalQuestions || [],
    keywords,
    ideaSource: result.sourceName,
    sourceUrl: result.sourceUrl,
    originType: 'external',
    createdAt: result.createdAt,
    verificationStatus: 'pending',
    usageStatus: 'unused',
    semanticFingerprint: '',
    mainTheme,
    plotMechanic,
    uniqueDetails: idea?.uniqueDetails || result.unexpectedDetail,
    batchNumber: 0,
    quality: {
      overall: result.qualityBreakdown?.overall ?? 75,
      originality: result.qualityBreakdown?.originality ?? 75,
      realism: result.qualityBreakdown?.realism ?? 75,
      emotionalExpressiveness: result.qualityBreakdown?.emotionalExpressiveness ?? 75,
      interest: result.qualityBreakdown?.readerInterest ?? 75,
      discussionPotential: result.qualityBreakdown?.discussionPotential ?? 75,
      specificity: result.qualityBreakdown?.specificity ?? 75,
      plotVariability: result.qualityBreakdown?.diversity ?? 75,
      editorialNote: result.qualityBreakdown?.explanation ?? '',
    },
  };
  base.semanticFingerprint = buildSemanticFingerprint(base);
  return base;
}

export function findResearchDuplicates(
  target: ResearchResult,
  dbStories: StoryPlot[],
  allResearchResults: ResearchResult[],
  currentBatchIds: Set<string>,
  thresholdPercent = 38
): ResearchDuplicateMatch[] {
  const candidateStory = researchResultToPseudoStory(target);

  // 1. Check against main STORY DATABASE
  const dbMatches: ResearchDuplicateMatch[] = findSimilarStories(
    candidateStory,
    dbStories,
    thresholdPercent
  ).map((m) => ({
    ...m,
    matchScope: 'story_database' as const,
  }));

  // 2. Check against other research results (and items in current batch)
  const otherResearch = allResearchResults.filter(
    (r) => r.researchId !== target.researchId && r.queueStatus !== 'rejected'
  );
  const researchPseudoPool = otherResearch.map((r) => researchResultToPseudoStory(r));
  const queueMatchesRaw = findSimilarStories(candidateStory, researchPseudoPool, thresholdPercent);

  const queueMatches: ResearchDuplicateMatch[] = queueMatchesRaw.map((m) => ({
    ...m,
    matchScope: currentBatchIds.has(m.matchedId) ? 'current_batch' : 'research_queue',
  }));

  // Also check exact same verified sourceUrl across non-rejected research items or DB stories
  const normalizedUrl = target.sourceUrl.trim().toLowerCase().replace(/\/+$/, '');
  if (normalizedUrl) {
    for (const s of dbStories) {
      if (
        s.sourceUrl &&
        s.sourceUrl.trim().toLowerCase().replace(/\/+$/, '') === normalizedUrl &&
        !dbMatches.some((m) => m.matchedId === s.id)
      ) {
        dbMatches.unshift({
          matchedId: s.id,
          matchedTitle: s.title,
          matchedShortDescription: s.shortDescription,
          matchedCollection: s.collection,
          matchedCategory: s.category,
          similarityScore: 99,
          sharedKeywords: ['sourceUrl'],
          reason: 'Совпадение 99%: этот же внешний URL уже сохранён в основной базе сюжетов.',
          matchScope: 'story_database',
        });
      }
    }
    for (const r of otherResearch) {
      if (
        r.sourceUrl &&
        r.sourceUrl.trim().toLowerCase().replace(/\/+$/, '') === normalizedUrl &&
        !queueMatches.some((m) => m.matchedId === r.researchId)
      ) {
        queueMatches.unshift({
          matchedId: r.researchId,
          matchedTitle: r.generatedIdea?.title || r.sourceTitle,
          matchedShortDescription: r.sourceSummary,
          matchedCollection: r.collection,
          matchedCategory: r.targetCategory,
          similarityScore: 99,
          sharedKeywords: ['sourceUrl'],
          reason: 'Совпадение 99%: этот же внешний URL уже исследован ранее.',
          matchScope: currentBatchIds.has(r.researchId) ? 'current_batch' : 'research_queue',
        });
      }
    }
  }

  return [...dbMatches, ...queueMatches]
    .sort((a, b) => b.similarityScore - a.similarityScore)
    .slice(0, 8);
}

export function researchResultsToCsv(results: ResearchResult[]): string {
  const headers = [
    'research_id',
    'job_id',
    'collection',
    'queue_status',
    'source_name',
    'source_url',
    'source_title',
    'source_author',
    'source_date',
    'research_date',
    'source_reliability',
    'target_category',
    'story_mechanic',
    'main_situation',
    'main_conflict',
    'emotional_mechanism',
    'hidden_expectation',
    'unexpected_detail',
    'possible_twist',
    'originality_assessment',
    'quality_overall',
    'quality_tier',
    'idea_title',
    'idea_short_description',
    'idea_full_plot',
    'duplicate_flag',
    'saved_story_id',
  ];

  const escapeCell = (val: unknown): string => {
    const str = String(val ?? '').replace(/\r?\n/g, ' ');
    if (/[",;\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = results.map((r) =>
    [
      r.researchId,
      r.jobId,
      r.collection,
      r.queueStatus,
      r.sourceName,
      r.sourceUrl,
      r.sourceTitle,
      r.sourceAuthor,
      r.sourceDate,
      r.researchDate,
      r.sourceReliability,
      r.targetCategory,
      r.storyMechanic,
      r.mainSituation,
      r.mainConflict,
      r.emotionalMechanism,
      r.hiddenExpectation,
      r.unexpectedDetail,
      r.possibleTwist,
      r.originalityAssessment,
      r.qualityBreakdown?.overall ?? 0,
      r.qualityBreakdown?.tierLabel ?? '',
      r.generatedIdea?.title ?? '',
      r.generatedIdea?.shortDescription ?? '',
      r.generatedIdea?.fullPlot ?? '',
      r.duplicateFlag ? 'true' : 'false',
      r.savedStoryId ?? '',
    ]
      .map(escapeCell)
      .join(',')
  );

  return '\uFEFF' + [headers.join(','), ...rows].join('\n');
}

