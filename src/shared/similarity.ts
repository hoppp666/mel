import {
  CollectionType,
  ResearchQualityScore,
  ResearchResult,
  SimilarityMatch,
  StoryPlot,
  StoryQuality,
  StoryQualityBreakdown,
} from './types.js';

const STOP_WORDS = new Set([
  // Russian stop words & generic relation nouns
  'и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а', 'то', 'все',
  'она', 'так', 'его', 'но', 'да', 'ты', 'к', 'у', 'же', 'вы', 'за', 'бы', 'по',
  'только', 'ее', 'её', 'мне', 'было', 'вот', 'от', 'меня', 'еще', 'ещё', 'нет',
  'о', 'из', 'ему', 'теперь', 'когда', 'даже', 'ну', 'вдруг', 'ли', 'если', 'уже',
  'или', 'ни', 'быть', 'был', 'него', 'до', 'вас', 'нибудь', 'опять', 'уж', 'вам',
  'ведь', 'там', 'потом', 'себя', 'ничего', 'ей', 'может', 'они', 'тут', 'где',
  'есть', 'надо', 'ней', 'для', 'мы', 'тебя', 'их', 'чем', 'была', 'сам', 'чтоб',
  'без', 'будто', 'чего', 'раз', 'тоже', 'себе', 'под', 'будет', 'ж', 'тогда',
  'кто', 'этот', 'того', 'потому', 'этого', 'какой', 'совсем', 'ним', 'здесь',
  'этом', 'один', 'почти', 'мой', 'тем', 'чтобы', 'нее', 'неё', 'сейчас', 'были',
  'куда', 'зачем', 'всех', 'никогда', 'можно', 'при', 'наконец', 'два', 'об',
  'другой', 'хоть', 'после', 'над', 'больше', 'тот', 'через', 'эти', 'нас', 'про',
  'всего', 'них', 'какая', 'много', 'разве', 'три', 'эту', 'моя', 'впрочем',
  'хорошо', 'свою', 'этой', 'перед', 'иногда', 'лучше', 'чуть', 'том', 'нельзя',
  'такой', 'им', 'более', 'всегда', 'конечно', 'всю', 'между', 'очень', 'просто',
  'история', 'сюжет', 'ситуация', 'отношения', 'отношение', 'партнер', 'партнёр',
  'человек', 'пара', 'мужчина', 'женщина', 'парень', 'девушка', 'муж', 'жена',
  // English stop words for bilingual research matching
  'the', 'and', 'for', 'that', 'with', 'this', 'from', 'have', 'was', 'were',
  'are', 'but', 'not', 'you', 'your', 'they', 'their', 'she', 'her', 'his',
  'him', 'about', 'what', 'when', 'where', 'which', 'who', 'why', 'how',
  'into', 'over', 'after', 'before', 'between', 'just', 'like', 'more',
  'some', 'could', 'would', 'should', 'been', 'being', 'than', 'then',
  'also', 'very', 'much', 'even', 'such', 'only', 'other', 'each', 'make',
  'made', 'does', 'did', 'has', 'had', 'will', 'can', 'one', 'two',
  'relationship', 'relationships', 'partner', 'partners', 'couple', 'couples',
  'story', 'stories', 'article', 'people', 'someone', 'thing', 'things',
]);

export function stemRussianWord(word: string): string {
  let w = word.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');
  if (w.length <= 3) return w;

  if (/[a-z]/.test(w)) {
    const enEndings = ['ingly', 'edly', 'ing', 'ies', 'ied', 'tion', 'ment', 'ness', 'able', 'ible', 'ed', 'ly', 'es', 's'];
    for (const end of enEndings) {
      if (w.length - end.length >= 4 && w.endsWith(end)) {
        return w.slice(0, -end.length);
      }
    }
    return w;
  }

  const ruEndings = [
    'иями', 'ями', 'ами', 'ость', 'ение', 'ание', 'ился', 'алась', 'ились',
    'ться', 'ется', 'ются', 'ится', 'ать', 'ять', 'ить', 'еть', 'ого', 'его',
    'ому', 'ему', 'ими', 'ыми', 'ая', 'яя', 'ое', 'ее', 'ие', 'ые', 'ой',
    'ей', 'ий', 'ый', 'ом', 'ем', 'ам', 'ям', 'ах', 'ях', 'ов', 'ев',
    'ия', 'ья', 'ию', 'ью', 'ии', 'а', 'я', 'о', 'е', 'и', 'ы', 'у', 'ю', 'ь',
  ];
  for (const end of ruEndings) {
    if (w.length - end.length >= 3 && w.endsWith(end)) {
      return w.slice(0, -end.length);
    }
  }
  return w;
}

export function tokenizeText(text: string): string[] {
  if (!text) return [];
  const raw = text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^a-zа-я0-9]+/i)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));

  return raw.map(stemRussianWord).filter((t) => t.length >= 3);
}

export function buildBigrams(tokens: string[]): Set<string> {
  const result = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i++) {
    result.add(`${tokens[i]}_${tokens[i + 1]}`);
  }
  return result;
}

export function buildSemanticFingerprint(story: Partial<StoryPlot>): string {
  const parts = [
    story.mainTheme,
    story.plotMechanic,
    story.coreConflictOrAction,
    story.hiddenExpectation,
    story.unexpectedNuance,
    story.emotionalMechanism,
    ...(story.keywords || []),
  ]
    .filter(Boolean)
    .join(' ');

  const tokens = Array.from(new Set(tokenizeText(parts)));
  return tokens.slice(0, 24).join('|');
}

function jaccardSet(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const item of a) {
    if (b.has(item)) inter++;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function overlapSet(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const item of a) {
    if (b.has(item)) inter++;
  }
  return inter / Math.min(a.size, b.size);
}

export function normalizeSourceUrl(url: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url.trim());
    return `${parsed.hostname.replace(/^www\./, '').toLowerCase()}${parsed.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch {
    return url.trim().toLowerCase().replace(/\/+$/, '');
  }
}

export function computePairSimilarity(
  candidate: Partial<StoryPlot>,
  existing: StoryPlot
): { score: number; reason: string } {
  if (candidate.sourceUrl && existing.sourceUrl) {
    const u1 = normalizeSourceUrl(candidate.sourceUrl);
    const u2 = normalizeSourceUrl(existing.sourceUrl);
    if (u1 && u2 && u1 === u2) {
      return { score: 99, reason: 'Совпадает нормализованный URL внешнего источника' };
    }
  }

  const candFp = new Set(
    (candidate.semanticFingerprint || buildSemanticFingerprint(candidate))
      .split('|')
      .filter((t) => t.length >= 3)
  );
  const existFp = new Set(
    (existing.semanticFingerprint || buildSemanticFingerprint(existing))
      .split('|')
      .filter((t) => t.length >= 3)
  );
  const fpSim = jaccardSet(candFp, existFp);

  const candCoreTokens = tokenizeText(
    `${candidate.title || ''} ${candidate.coreConflictOrAction || ''} ${candidate.mainTheme || ''}`
  );
  const existCoreTokens = tokenizeText(
    `${existing.title || ''} ${existing.coreConflictOrAction || ''} ${existing.mainTheme || ''}`
  );
  const coreJaccard = jaccardSet(new Set(candCoreTokens), new Set(existCoreTokens));
  const coreOverlap = overlapSet(new Set(candCoreTokens), new Set(existCoreTokens));
  const coreSim = coreJaccard * 0.55 + coreOverlap * 0.45;

  const candFullTokens = tokenizeText(
    `${candidate.shortDescription || ''} ${candidate.fullPlot || ''} ${candidate.hiddenExpectation || ''} ${candidate.unexpectedNuance || ''}`
  );
  const existFullTokens = tokenizeText(
    `${existing.shortDescription || ''} ${existing.fullPlot || ''} ${existing.hiddenExpectation || ''} ${existing.unexpectedNuance || ''}`
  );
  const fullSim =
    jaccardSet(new Set(candFullTokens), new Set(existFullTokens)) * 0.65 +
    overlapSet(new Set(candFullTokens), new Set(existFullTokens)) * 0.35;

  const candBigrams = buildBigrams(candCoreTokens);
  const existBigrams = buildBigrams(existCoreTokens);
  const bigramSim = jaccardSet(candBigrams, existBigrams);

  let raw = fpSim * 0.32 + coreSim * 0.34 + fullSim * 0.24 + bigramSim * 0.1;

  if (candidate.category && existing.category && candidate.category === existing.category) {
    raw += 0.04;
  }
  if (candidate.plotMechanic && existing.plotMechanic && candidate.plotMechanic === existing.plotMechanic) {
    raw += 0.03;
  }

  const score = Math.min(99, Math.round(raw * 100));

  const reasons: string[] = [];
  if (coreSim >= 0.32) reasons.push('близкое ядро конфликта/действия');
  if (fpSim >= 0.28) reasons.push('пересечение семантических маркеров темы');
  if (fullSim >= 0.3) reasons.push('схожие обстоятельства и скрытый мотив');
  if (bigramSim >= 0.15) reasons.push('совпадающие ключевые словосочетания');
  if (candidate.category === existing.category && candidate.plotMechanic === existing.plotMechanic) {
    reasons.push('совпадают категория и сюжетная механика');
  }

  return {
    score,
    reason: reasons.length > 0 ? reasons.join(', ') : 'общая тематическая близость формулировок',
  };
}

export function findSimilarStories(
  candidate: Partial<StoryPlot>,
  stories: StoryPlot[],
  thresholdPercent = 38,
  excludeId?: string
): SimilarityMatch[] {
  const matches: SimilarityMatch[] = [];
  for (const s of stories) {
    if (excludeId && s.id === excludeId) continue;
    if (s.verificationStatus === 'rejected') continue;
    const { score, reason } = computePairSimilarity(candidate, s);
    if (score >= thresholdPercent) {
      matches.push({
        storyId: s.id,
        title: s.title,
        collection: s.collection,
        score,
        reason,
      });
    }
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, 5);
}

export function calculateQualityScore(
  collection: CollectionType,
  partial?: Partial<StoryQualityBreakdown>,
  editorialNote?: string
): StoryQuality {
  const clamp = (v: number | undefined, fallback = 85) =>
    Math.max(0, Math.min(100, Math.round(typeof v === 'number' && !Number.isNaN(v) ? v : fallback)));

  const base: StoryQualityBreakdown = {
    originality: clamp(partial?.originality, 88),
    realism: clamp(partial?.realism, 91),
    emotionalDepth: clamp(partial?.emotionalDepth, 89),
    engagement: clamp(partial?.engagement, 90),
    discussionPotential: clamp(partial?.discussionPotential, collection === 'debate' ? 92 : 84),
    specificity: clamp(partial?.specificity, 90),
    variability: clamp(partial?.variability, 87),
  };

  if (collection === 'debate') {
    base.ambiguity = clamp(partial?.ambiguity, 91);
    base.bothSidesStrength = clamp(partial?.bothSidesStrength, 90);
    base.contradictionPower = clamp(partial?.contradictionPower, 89);
  } else {
    base.warmth = clamp(partial?.warmth, 92);
    base.relatability = clamp(partial?.relatability, 91);
    base.smallDetailPower = clamp(partial?.smallDetailPower, 90);
    base.naturalness = clamp(partial?.naturalness, 90);
  }

  const vals = Object.values(base).filter((n): n is number => typeof n === 'number');
  const overall = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);

  return {
    overall,
    breakdown: base,
    editorialNote:
      editorialNote ||
      (overall >= 88
        ? 'Сильная жизненная конкретика с яркой деталью и естественной мотивацией участников.'
        : overall >= 75
          ? 'Рабочая сюжетная основа; при подготовке публикации стоит усилить деталь и финал.'
          : 'Слабая конкретика или избитый конфликт — требуется переработка.'),
  };
}

export function storiesToCsv(stories: StoryPlot[]): string {
  const headers = [
    'id',
    'collection',
    'category',
    'subcategory',
    'title',
    'shortDescription',
    'fullPlot',
    'participants',
    'setting',
    'coreConflictOrAction',
    'sideAPosition',
    'sideBPosition',
    'emotionalMechanism',
    'hiddenExpectation',
    'unexpectedNuance',
    'possibleTwist',
    'mainTriggerQuestion',
    'additionalQuestions',
    'keywords',
    'ideaSource',
    'sourceUrl',
    'originType',
    'createdAt',
    'verificationStatus',
    'usageStatus',
    'semanticFingerprint',
    'mainTheme',
    'plotMechanic',
    'qualityOverall',
    'researchId',
  ];

  const escape = (val: unknown): string => {
    const str = Array.isArray(val) ? val.join(' | ') : String(val ?? '');
    return `"${str.replace(/"/g, '""')}"`;
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
      s.additionalQuestions,
      s.keywords,
      s.ideaSource,
      s.sourceUrl,
      s.originType,
      s.createdAt,
      s.verificationStatus,
      s.usageStatus,
      s.semanticFingerprint,
      s.mainTheme,
      s.plotMechanic,
      s.quality?.overall ?? 0,
      s.researchId ?? '',
    ]
      .map(escape)
      .join(',')
  );

  return '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
}

export const SUPABASE_SQL_SCHEMA = `-- Схема для миграции базы сюжетов MELO_LOVE в Supabase (PostgreSQL)
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
  main_theme text not null default '',
  plot_mechanic text not null default '',
  unique_details text not null default '',
  source_analysis_note text not null default '',
  research_id text,
  research_notes text,
  batch_number integer not null default 1,
  quality_overall integer not null default 85,
  quality_payload jsonb not null default '{}'::jsonb,
  duplicate_flag boolean not null default false
);

create index if not exists idx_melo_collection_status
  on public.melo_story_plots (collection, verification_status, usage_status);
create index if not exists idx_melo_fingerprint
  on public.melo_story_plots (semantic_fingerprint);
`;

// ============================================================================
// ЭТАП 2: ОЦЕНКА И ТРЁХКОНТУРНАЯ ДЕДУПЛИКАЦИЯ ИССЛЕДОВАНИЙ
// ============================================================================

export function getResearchQualityTier(
  overall: number
): ResearchQualityScore['tierLabel'] {
  if (overall >= 90) return 'Отличная идея';
  if (overall >= 85) return 'Хорошая идея';
  if (overall >= 75) return 'Требует проверки';
  return 'Рекомендуется доработка или отклонение';
}

export function calculateResearchQuality(
  collection: CollectionType,
  partial?: Partial<ResearchQualityScore['breakdown']>,
  explanation?: string
): ResearchQualityScore {
  const clamp = (v: number | undefined, fallback = 84) =>
    Math.max(0, Math.min(100, Math.round(typeof v === 'number' && !Number.isNaN(v) ? v : fallback)));

  const breakdown: ResearchQualityScore['breakdown'] = {
    originality: clamp(partial?.originality, 86),
    realism: clamp(partial?.realism, 88),
    specificity: clamp(partial?.specificity, 86),
    emotionalExpressiveness: clamp(partial?.emotionalExpressiveness, 87),
    readerInterest: clamp(partial?.readerInterest, 88),
    diversity: clamp(partial?.diversity, 85),
    discussionPotential: clamp(partial?.discussionPotential, collection === 'debate' ? 89 : 80),
    mechanicQuality: clamp(partial?.mechanicQuality, 86),
  };

  if (collection === 'debate') {
    breakdown.ambiguity = clamp(partial?.ambiguity, 88);
    breakdown.bothSidesArgument = clamp(partial?.bothSidesArgument, 87);
    breakdown.debatePotential = clamp(partial?.debatePotential, 89);
  } else {
    breakdown.warmth = clamp(partial?.warmth, 89);
    breakdown.naturalness = clamp(partial?.naturalness, 88);
    breakdown.detailStrength = clamp(partial?.detailStrength, 87);
    breakdown.relatability = clamp(partial?.relatability, 88);
    breakdown.antiSaccharine = clamp(partial?.antiSaccharine, 86);
  }

  const values = Object.values(breakdown).filter((v): v is number => typeof v === 'number');
  const overall = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  const tierLabel = getResearchQualityTier(overall);

  return {
    overall,
    tierLabel,
    explanation:
      explanation ||
      `${tierLabel}: оценка отражает конкретику сцены, жизненную достоверность и чистоту сюжетной механики (не является прогнозом охватов).`,
    breakdown,
  };
}

export function researchResultToPseudoStory(item: ResearchResult): StoryPlot {
  const gp = item.generatedPlot;
  const fallbackTitle = gp?.title || item.sourceTitle || item.mainSituation || item.researchId;
  const pseudo: StoryPlot = {
    id: item.researchId,
    collection: item.collection,
    category: gp?.category || '',
    subcategory: gp?.subcategory || '',
    title: fallbackTitle,
    shortDescription: gp?.shortDescription || item.sourceSummary || item.mainSituation,
    fullPlot: gp?.fullPlot || item.sourceSummary || item.sourceExcerpt,
    participants: gp?.participants || item.participants,
    setting: gp?.setting || item.relationshipType,
    coreConflictOrAction: gp?.coreConflictOrAction || item.mainConflict || item.mainSituation,
    sideAPosition: gp?.sideAPosition || item.positionsOfParticipants,
    sideBPosition: gp?.sideBPosition || '',
    emotionalMechanism: gp?.emotionalMechanism || item.emotionalMechanism,
    hiddenExpectation: gp?.hiddenExpectation || item.hiddenExpectation,
    unexpectedNuance: gp?.unexpectedNuance || item.unexpectedDetail,
    possibleTwist: gp?.possibleTwist || item.possibleTwist,
    mainTriggerQuestion: gp?.mainTriggerQuestion || '',
    additionalQuestions: gp?.additionalQuestions || [],
    keywords: gp?.keywords?.length ? gp.keywords : item.keywords || [],
    ideaSource: item.sourceName,
    sourceUrl: item.sourceUrl,
    originType: 'external',
    createdAt: item.researchDate,
    verificationStatus: 'pending',
    usageStatus: 'unused',
    semanticFingerprint: '',
    mainTheme: gp?.mainTheme || item.mainSituation,
    plotMechanic: gp?.plotMechanic || item.storyMechanic,
    uniqueDetails: gp?.uniqueDetails || item.unexpectedDetail,
    sourceAnalysisNote: item.researchNotes,
    batchNumber: 0,
    researchId: item.researchId,
    researchNotes: item.researchNotes,
    quality: calculateQualityScore(item.collection),
    similarityMatches: [],
    duplicateFlag: false,
  };
  pseudo.semanticFingerprint = buildSemanticFingerprint(pseudo);
  return pseudo;
}

export function findResearchDuplicates(
  target: ResearchResult,
  mainStories: StoryPlot[],
  otherResults: ResearchResult[],
  thresholdPercent = 38
): SimilarityMatch[] {
  const candidatePseudo = researchResultToPseudoStory(target);

  const mainMatches = findSimilarStories(candidatePseudo, mainStories, thresholdPercent);
  const otherPseudos: StoryPlot[] = otherResults
    .filter((r) => r.researchId !== target.researchId && r.queueStatus !== 'rejected')
    .map((r) => researchResultToPseudoStory(r));

  const researchMatches = findSimilarStories(
    candidatePseudo,
    otherPseudos,
    thresholdPercent,
    target.researchId
  ).map((m) => ({
    ...m,
    reason: `[Очередь исследований] ${m.reason}`,
  }));

  const combined = new Map<string, SimilarityMatch>();
  for (const m of [...mainMatches, ...researchMatches]) {
    const prev = combined.get(m.storyId);
    if (!prev || m.score > prev.score) {
      combined.set(m.storyId, m);
    }
  }

  return Array.from(combined.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

export function researchResultsToCsv(results: ResearchResult[]): string {
  const headers = [
    'researchId',
    'jobId',
    'collection',
    'sourceName',
    'sourceUrl',
    'sourceTitle',
    'sourceAuthor',
    'sourceDate',
    'researchDate',
    'analysisStatus',
    'queueStatus',
    'sourceReliability',
    'mainSituation',
    'storyMechanic',
    'generatedTitle',
    'generatedFullPlot',
    'qualityOverall',
    'qualityTier',
    'duplicateFlag',
    'approvedStoryId',
  ];

  const escape = (val: unknown): string => {
    const str = Array.isArray(val) ? val.join(' | ') : String(val ?? '');
    return `"${str.replace(/"/g, '""')}"`;
  };

  const rows = results.map((r) =>
    [
      r.researchId,
      r.jobId,
      r.collection,
      r.sourceName,
      r.sourceUrl,
      r.sourceTitle,
      r.sourceAuthor,
      r.sourceDate,
      r.researchDate,
      r.analysisStatus,
      r.queueStatus,
      r.sourceReliability,
      r.mainSituation,
      r.storyMechanic,
      r.generatedPlot?.title ?? '',
      r.generatedPlot?.fullPlot ?? '',
      r.quality?.overall ?? '',
      r.quality?.tierLabel ?? '',
      r.duplicateFlag,
      r.approvedStoryId ?? '',
    ]
      .map(escape)
      .join(',')
  );

  return '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
}
