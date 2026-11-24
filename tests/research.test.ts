import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateResearchQuality,
  findResearchDuplicates,
  getResearchQualityTier,
  researchResultsToCsv,
} from '../src/shared/similarity.ts';
import {
  createInitialResearchSources,
} from '../server/researchStorage.ts';
import { extractDomainFromUrl } from '../server/researchSources.ts';
import type { ResearchResult, StoryPlot } from '../src/shared/types.ts';

test('Quality scoring returns accurate 0-100 scores and exact tier labels', () => {
  assert.equal(getResearchQualityTier(94), 'Отличная идея');
  assert.equal(getResearchQualityTier(87), 'Хорошая идея');
  assert.equal(getResearchQualityTier(78), 'Требует проверки');
  assert.equal(getResearchQualityTier(72), 'Рекомендуется доработка или отклонение');

  const debateScore = calculateResearchQuality(
    {
      originality: 90,
      realism: 90,
      specificity: 90,
      emotionalExpressiveness: 90,
      readerInterest: 90,
      diversity: 90,
      discussionPotential: 90,
      mechanicQuality: 90,
      ambiguity: 90,
      bothSidesArgumentation: 90,
      debatePotential: 90,
    },
    'debate'
  );
  assert.equal(debateScore.overall, 90);
  assert.equal(debateScore.tierLabel, 'Отличная идея');

  const romanticScore = calculateResearchQuality(
    {
      originality: 80,
      realism: 80,
      specificity: 80,
      emotionalExpressiveness: 80,
      readerInterest: 80,
      diversity: 80,
      discussionPotential: 80,
      mechanicQuality: 80,
      warmth: 86,
      naturalness: 86,
      emotionalDetailPower: 86,
      relatability: 86,
      nonSaccharine: 86,
    },
    'romantic'
  );
  assert.equal(romanticScore.overall, 82);
  assert.equal(romanticScore.tierLabel, 'Требует проверки');
});

test('Initial foreign sources catalog contains Reddit + Media and starts unchecked', () => {
  const sources = createInitialResearchSources();
  assert.ok(sources.length >= 13);

  const urls = sources.map((s) => s.url);
  assert.ok(urls.some((u) => u.includes('AmItheAsshole')));
  assert.ok(urls.some((u) => u.includes('relationship_advice')));
  assert.ok(urls.some((u) => u.includes('BestofRedditorUpdates')));
  assert.ok(urls.some((u) => u.includes('nytimes.com/column/modern-love')));
  assert.ok(urls.some((u) => u.includes('thecut.com')));
  assert.ok(urls.some((u) => u.includes('psychologytoday.com')));

  for (const s of sources) {
    assert.equal(s.availabilityStatus, 'unchecked');
    assert.equal(s.lastCheckedAt, null);
    assert.ok(extractDomainFromUrl(s.url).length > 3);
  }
});

test('findResearchDuplicates catches semantic clones and duplicate sourceUrl across DB & Queue', () => {
  const baseStory: StoryPlot = {
    id: 'ML-D-0001',
    collection: 'debate',
    category: 'Свекровь и тёща',
    subcategory: 'Ключи от квартиры',
    title: 'Свекровь заходит в квартиру со своим ключом и переставляет посуду',
    shortDescription: 'Мать мужа приходит без предупреждения и наводит свои порядки на кухне.',
    fullPlot: 'Свекровь открывает дверь запасным ключом, пока невестка на работе, и переставляет специи и посуду.',
    participants: 'Муж, жена, свекровь',
    setting: 'Кухня молодой пары',
    coreConflictOrAction: 'Свекровь заходит со своим ключом и переставляет посуду без спроса',
    sideAPosition: 'Жена считает это нарушением личных границ',
    sideBPosition: 'Муж уверен, что мама просто хочет помочь',
    emotionalMechanism: 'Вторжение под видом заботы',
    hiddenExpectation: 'Жена ждёт, что муж заберёт ключ',
    unexpectedNuance: 'Мать оплатила замену смесителя',
    possibleTwist: 'Свекровь считает себя хозяйкой из-за вложений в ремонт',
    mainTriggerQuestion: 'Забирать ли ключ у матери?',
    additionalQuestions: [],
    keywords: ['свекровь', 'ключ', 'квартира', 'границы'],
    ideaSource: 'Оригинал',
    sourceUrl: 'https://www.reddit.com/r/AmItheAsshole/comments/sample_existing/',
    originType: 'external',
    createdAt: new Date().toISOString(),
    verificationStatus: 'approved',
    usageStatus: 'unused',
    semanticFingerprint: 'D:свекровь::ключ|квартира|границы',
    mainTheme: 'Вторжение свекрови со своим ключом',
    plotMechanic: 'Неочевидная личная граница',
    uniqueDetails: 'Специи на верхней полке',
    batchNumber: 1,
    quality: {
      overall: 88,
      originality: 88,
      realism: 88,
      emotionalExpressiveness: 88,
      interest: 88,
      discussionPotential: 88,
      specificity: 88,
      plotVariability: 88,
      editorialNote: '',
    },
  };

  const duplicateCandidate: ResearchResult = {
    researchId: 'RES-D-0001',
    jobId: 'JOB-TEST',
    sourceId: 'reddit-aita',
    sourceName: 'Reddit r/AmItheAsshole',
    sourceUrl: 'https://www.reddit.com/r/AmItheAsshole/comments/sample_existing/',
    sourceTitle: 'MIL uses spare key to rearrange our kitchen',
    sourceAuthor: 'unknown',
    sourceDate: 'unknown',
    researchDate: new Date().toISOString(),
    sourceType: 'Reddit Community',
    collection: 'debate',
    targetCategory: 'Свекровь и тёща',
    originalLanguage: 'en',
    sourceSummary: 'Свекровь зашла в квартиру запасным ключом и переставила кастрюли.',
    mainSituation: 'Свекровь заходит со своим ключом и переставляет посуду на кухне',
    participants: 'Муж, жена, мать мужа',
    relationshipType: 'Брак',
    mainConflict: 'Нарушение границ с запасным ключом и перестановкой посуды',
    positionsOfParticipants: { sideA: 'Забрать ключ', sideB: 'Она помогает' },
    emotionalMechanism: 'Контроль под видом помощи',
    hiddenExpectation: 'Защита дома',
    unexpectedDetail: 'Запасной ключ',
    possibleTwist: 'Спор о вкладе',
    readerReactionPotential: 'Сильная дискуссия о границах',
    storyMechanic: 'Неочевидная личная граница',
    keywords: ['свекровь', 'ключ', 'посуда'],
    researchNotes: '',
    sourceReliability: 'search_grounded',
    analysisStatus: 'completed',
    originalityAssessment: 70,
    queueStatus: 'awaiting_review',
    generatedIdea: null,
    qualityBreakdown: {
      overall: 80,
      originality: 80,
      realism: 80,
      specificity: 80,
      emotionalExpressiveness: 80,
      readerInterest: 80,
      diversity: 80,
      discussionPotential: 80,
      mechanicQuality: 80,
      tierLabel: 'Требует проверки',
      explanation: 'Test',
    },
    duplicateMatches: [],
    duplicateFlag: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const matches = findResearchDuplicates(duplicateCandidate, [baseStory], [], new Set(), 38);
  assert.ok(matches.length > 0);
  assert.equal(matches[0].matchScope, 'story_database');
  assert.ok(matches[0].similarityScore >= 40);

  // Completely unrelated romantic story should NOT trigger false duplicate
  const distinctRomantic: ResearchResult = {
    ...duplicateCandidate,
    researchId: 'RES-R-0001',
    collection: 'romantic',
    sourceUrl: 'https://www.nytimes.com/column/modern-love/distinct-story',
    sourceTitle: 'Midnight tea thermos on winter train platform',
    targetCategory: 'Забота на расстоянии',
    sourceSummary: 'Муж приносит жене тёплый термос с имбирным чаем к ночному перрону.',
    mainSituation: 'Термос с чаем у ночного вагона в мороз',
    mainConflict: 'Тихая поддержка после долгой командировки',
    storyMechanic: 'Тихая привычка как язык любви',
    keywords: ['термос', 'поезд', 'чай', 'мороз'],
  };

  const unrelatedMatches = findResearchDuplicates(distinctRomantic, [baseStory], [], new Set(), 38);
  assert.equal(unrelatedMatches.length, 0);
});

test('researchResultsToCsv emits UTF-8 BOM and proper header columns', () => {
  const csv = researchResultsToCsv([]);
  assert.ok(csv.startsWith('\uFEFFresearch_id,job_id,collection,'));
});

test('Unrelated English research cards do not trigger false duplicate alerts', () => {
  const shoppingCard: ResearchResult = {
    researchId: 'RES-D-1001',
    jobId: 'JOB-1',
    sourceId: 'media-the-cut',
    sourceName: 'The Cut — Relationships',
    sourceUrl: 'https://www.thecut.com/article/online-shopping-habits-couple-arguments.html',
    sourceTitle: 'If He Knew How Much Stuff I Was Buying',
    sourceAuthor: 'Charlotte Cowles',
    sourceDate: '2026-11-19',
    researchDate: new Date().toISOString(),
    sourceType: 'Digital Magazine',
    collection: 'debate',
    targetCategory: 'Деньги и отношения',
    originalLanguage: 'en',
    sourceSummary: 'Couples argue about stealth online shopping packages delivered to work.',
    mainSituation: '',
    participants: '',
    relationshipType: '',
    mainConflict: '',
    positionsOfParticipants: { sideA: '', sideB: '' },
    emotionalMechanism: '',
    hiddenExpectation: '',
    unexpectedDetail: '',
    possibleTwist: '',
    readerReactionPotential: '',
    storyMechanic: '',
    keywords: [],
    researchNotes: '',
    sourceReliability: 'verified_url',
    analysisStatus: 'failed',
    originalityAssessment: 0,
    queueStatus: 'research_pending',
    generatedIdea: null,
    qualityBreakdown: {
      overall: 75,
      originality: 75,
      realism: 80,
      specificity: 75,
      emotionalExpressiveness: 75,
      readerInterest: 75,
      diversity: 75,
      discussionPotential: 75,
      mechanicQuality: 75,
      tierLabel: 'Требует проверки',
      explanation: 'Fallback',
    },
    duplicateMatches: [],
    duplicateFlag: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const datingCard: ResearchResult = {
    ...shoppingCard,
    researchId: 'RES-D-1002',
    sourceUrl: 'https://www.thecut.com/article/anthony-mackie-says-its-hard-to-date-as-an-older-man.html',
    sourceTitle: 'Actor Says It Is Hard to Date As an Older Man',
    sourceSummary: 'A 48-year-old actor talks about age gap expectations and dating apps.',
  };

  const matches = findResearchDuplicates(datingCard, [], [shoppingCard], new Set(), 38);
  assert.equal(matches.length, 0);
});

