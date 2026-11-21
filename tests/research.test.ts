import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateResearchQuality,
  findResearchDuplicates,
  findSimilarStories,
  getResearchQualityTier,
  researchResultsToCsv,
} from '../src/shared/similarity.js';
import { DEFAULT_RESEARCH_SOURCES } from '../src/shared/categories.js';
import { ResearchResult } from '../src/shared/types.js';
import { buildDebateSeeds } from '../server/seedDebate.js';
import { buildRomanticSeeds } from '../server/seedRomantic.js';

function makeResearchResult(overrides: Partial<ResearchResult>): ResearchResult {
  return {
    researchId: 'RES-D-0001',
    jobId: 'JOB-1',
    sourceId: 'SRC-THECUT-REL',
    sourceName: 'The Cut — Relationships',
    sourceUrl: 'https://www.thecut.com/article/test-split-bill.html',
    sourceTitle: 'Should couples split rent based on income?',
    sourceAuthor: 'Editorial',
    sourceDate: '2026-10-01',
    researchDate: '2026-11-10T10:00:00.000Z',
    sourceType: 'media',
    collection: 'debate',
    originalLanguage: 'en',
    sourceExcerpt: 'Excerpt about splitting shared apartment costs proportionally.',
    sourceSummary: 'Couple argues whether rent should be 50/50 or income-based.',
    mainSituation: 'Пара спорит о делении аренды пополам при разнице доходов в 4 раза.',
    participants: 'Партнёры 29 и 32 лет',
    relationshipType: 'Совместная аренда',
    mainConflict: 'Равная доля vs пропорциональный вклад в аренду.',
    positionsOfParticipants: 'Он настаивает на 50/50, она предлагает пропорцию.',
    emotionalMechanism: 'Обида из-за ощущения несправедливости при разной нагрузке.',
    hiddenExpectation: 'Ожидание партнёрской солидарности без пересчёта чеков.',
    unexpectedDetail: 'Инициатор 50/50 сам выбрал дорогую квартиру ближе к своему офису.',
    possibleTwist: 'Она соглашается на 50/50, но при переезде в жильё по её бюджету.',
    readerReactionPotential: 'Высокий спор о честности.',
    storyMechanic: 'Противоречивое ожидание',
    keywords: ['аренда', 'бюджет', 'пополам'],
    researchNotes: 'Тестовая карточка',
    sourceReliability: 'verified_direct',
    analysisStatus: 'completed',
    originalityAssessment: 'Свежий бытовой разворот.',
    queueStatus: 'awaiting_review',
    generatedPlot: null,
    quality: null,
    similarityMatches: [],
    duplicateFlag: false,
    ...overrides,
  };
}

test('calculateResearchQuality returns accurate tier labels across thresholds', () => {
  assert.equal(getResearchQualityTier(92), 'Отличная идея');
  assert.equal(getResearchQualityTier(87), 'Хорошая идея');
  assert.equal(getResearchQualityTier(79), 'Требует проверки');
  assert.equal(getResearchQualityTier(65), 'Рекомендуется доработка или отклонение');

  const qDebate = calculateResearchQuality('debate', {
    originality: 92,
    realism: 94,
    specificity: 91,
    emotionalExpressiveness: 90,
    readerInterest: 93,
    diversity: 90,
    discussionPotential: 95,
    mechanicQuality: 92,
    ambiguity: 91,
    bothSidesArgument: 90,
    debatePotential: 94,
  });
  assert.equal(qDebate.tierLabel, 'Отличная идея');
  assert.ok(qDebate.overall >= 90);
});

test('DEFAULT_RESEARCH_SOURCES contains 13 valid system sources', () => {
  assert.equal(DEFAULT_RESEARCH_SOURCES.length, 13);
  const ids = new Set(DEFAULT_RESEARCH_SOURCES.map((s) => s.id));
  assert.equal(ids.size, 13);
  assert.ok(DEFAULT_RESEARCH_SOURCES.every((s) => s.isSystem && s.url.startsWith('https://')));
});

test('findResearchDuplicates catches identical URLs & semantic duplicates while ignoring generic relation words', () => {
  const existingStories = [...buildDebateSeeds(), ...buildRomanticSeeds()];
  const candidateSameUrl = makeResearchResult({
    researchId: 'RES-D-0100',
    sourceUrl: 'http://thecut.com/article/test-split-bill.html/',
  });
  const otherQueue = [
    makeResearchResult({
      researchId: 'RES-D-0001',
      sourceUrl: 'https://www.thecut.com/article/test-split-bill.html',
    }),
  ];

  const dupMatches = findResearchDuplicates(candidateSameUrl, existingStories, otherQueue, 38);
  assert.ok(dupMatches.length >= 1);
  assert.equal(dupMatches[0].storyId, 'RES-D-0001');
  assert.equal(dupMatches[0].score, 99);

  // Generic English relationship words alone must NOT trigger false positives
  const distinctCandidate = makeResearchResult({
    researchId: 'RES-R-0200',
    collection: 'romantic',
    sourceUrl: 'https://example.org/totally-unique-winter-greenhouse-violin',
    sourceTitle: 'Relationship partners story about greenhouse violin tuning',
    mainSituation: 'Скрипичный мастер восстанавливает старую скрипку в зимней оранжерее для глухого деда.',
    mainConflict: 'Тихая реставрация семейного инструмента перед юбилеем.',
    emotionalMechanism: 'Благодарность через сохранение звуковой памяти семьи.',
    hiddenExpectation: 'Желание вернуть голос прошлому поколению.',
    unexpectedDetail: 'На обечайке обнаружилась старая дата первой встречи бабушки и дедушки.',
    keywords: ['скрипка', 'оранжерея', 'реставрация'],
  });
  const falsePositiveCheck = findResearchDuplicates(distinctCandidate, existingStories, otherQueue, 38);
  assert.equal(falsePositiveCheck.length, 0);
});

test('researchResultsToCsv includes UTF-8 BOM and properly escaped fields', () => {
  const item = makeResearchResult({
    sourceTitle: 'Title with "quotes", commas',
  });
  const csv = researchResultsToCsv([item]);
  assert.ok(csv.startsWith('\uFEFFresearchId,jobId,'));
  assert.ok(csv.includes('"Title with ""quotes"", commas"'));
});

test('50 starter seed stories have zero internal duplicates across both collections', () => {
  const allSeeds = [...buildDebateSeeds(), ...buildRomanticSeeds()];
  assert.equal(allSeeds.length, 50);

  for (const story of allSeeds) {
    const others = allSeeds.filter((s) => s.id !== story.id);
    const matches = findSimilarStories(story, others, 38, story.id);
    assert.equal(
      matches.length,
      0,
      `Seed story ${story.id} unexpectedly matched ${matches.map((m) => `${m.storyId}(${m.score}%)`).join(', ')}`
    );
  }
});
