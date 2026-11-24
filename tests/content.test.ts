import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildContentExportObject,
  calculateContentQualityScore,
  getContentQualityTier,
  runDeterministicDraftChecks,
} from '../src/shared/contentUtils.ts';
import {
  createDefaultVoiceConfig,
  createInitialPhrasebook,
  generateNextContentId,
} from '../server/contentStorage.ts';
import {
  auditSourceStoryCompleteness,
  selectDiverseNarrativeStructure,
  selectEligiblePhrasebookHints,
} from '../server/voiceEngine.ts';
import type { ContentDraft, ContentQualityChecks, StoryPlot } from '../src/shared/types.ts';

function makeCleanChecks(): ContentQualityChecks {
  return {
    hasMeaninglessRepetition: false,
    soundsLikeAiTemplate: false,
    artificialColloquialism: false,
    phraseOveruse: false,
    contradictsSource: false,
    lostImportantDetail: false,
    artificialEnding: false,
    unsubstantiatedClaims: false,
    verbatimCopy: false,
  };
}

function makeSampleStory(overrides: Partial<StoryPlot> = {}): StoryPlot {
  return {
    id: 'ML-D-0001',
    collection: 'debate',
    category: 'Деньги и отношения',
    subcategory: 'Общий бюджет',
    title: 'Тайный счёт на отпуск вместо ремонта кухни',
    shortDescription: 'Муж копил премию отдельно, пока жена откладывала всё на плитку.',
    fullPlot:
      'Олег и Марина год откладывали деньги на замену старой кухни, но перед вызовом замерщика выяснилось, что муж переводил часть своей премии на отдельный вклад для поездки к морю в ноябре, ничего не сказав жене.',
    participants: 'Олег (муж, 33) и Марина (жена, 31)',
    setting: 'Кухня в двушке и вечерний разговор с блокнотом расходов',
    coreConflictOrAction: 'Разные негласные приоритеты в распоряжении личной премией внутри общего плана',
    sideAPosition: 'Марина считает это нарушением договорённости и тихим обманом',
    sideBPosition: 'Олег уверен, что премии сверх оклада — личная зона, а отдых им важнее плитки',
    emotionalMechanism: 'Усталость от быта против потребности в предсказуемости',
    hiddenExpectation: 'Марина ждала равной отдачи в общий проект, Олег ждал, что сюрприз обрадует',
    unexpectedNuance: 'На отдельном счёте лежит почти столько же, сколько не хватает на фасад кухни',
    possibleTwist: 'Марина сама полгода назад купила дорогой абонемент в студию из общей карты',
    mainTriggerQuestion: 'Личная премия в браке — личное дело каждого или общие планы важнее?',
    additionalQuestions: ['Как заранее договариваться о бонусах?'],
    keywords: ['бюджет', 'премия', 'ремонт', 'отпуск'],
    ideaSource: 'Оригинал',
    sourceUrl: 'https://example.com/reddit-budget-thread',
    originType: 'external',
    researchId: 'RES-D-0001',
    createdAt: new Date().toISOString(),
    verificationStatus: 'approved',
    usageStatus: 'unused',
    semanticFingerprint: 'D:деньги::премия|ремонт|отпуск',
    mainTheme: 'Общий бюджет и личные премии',
    plotMechanic: 'Скрытая финансовая цель',
    uniqueDetails: 'Блокнот расходов на холодильнике',
    batchNumber: 1,
    quality: {
      overall: 89,
      originality: 88,
      realism: 90,
      emotionalExpressiveness: 88,
      interest: 89,
      discussionPotential: 90,
      specificity: 88,
      plotVariability: 87,
      editorialNote: '',
    },
    ...overrides,
  };
}

test('calculateContentQualityScore applies exact 100-point rubric and enforces penalties', () => {
  assert.equal(getContentQualityTier(93), 'Отличная публикация');
  assert.equal(getContentQualityTier(85), 'Хорошая публикация');
  assert.equal(getContentQualityTier(78), 'Требует редактуры');
  assert.equal(getContentQualityTier(70), 'Не рекомендуется к сохранению');

  const maxScore = calculateContentQualityScore(
    {
      hookStrength: 15,
      languageNaturalness: 15,
      emotionalImpact: 15,
      plotDepth: 15,
      narrativeUniqueness: 15,
      voiceRecognition: 10,
      endingQuality: 10,
      sourceFidelity: 5,
    },
    makeCleanChecks()
  );
  assert.equal(maxScore.overall, 100);
  assert.equal(maxScore.tierLabel, 'Отличная публикация');

  const penalized = calculateContentQualityScore(
    {
      hookStrength: 15,
      languageNaturalness: 15,
      emotionalImpact: 15,
      plotDepth: 15,
      narrativeUniqueness: 15,
      voiceRecognition: 10,
      endingQuality: 10,
      sourceFidelity: 5,
    },
    {
      ...makeCleanChecks(),
      soundsLikeAiTemplate: true,
      verbatimCopy: true,
      phraseOveruse: true,
      contradictsSource: true,
    }
  );
  assert.ok(penalized.languageNaturalness <= 10);
  assert.ok(penalized.sourceFidelity <= 1);
  assert.ok(penalized.voiceRecognition <= 5);
  assert.ok(penalized.overall < 80);
});

test('runDeterministicDraftChecks flags banned openings, romantic clichés, phrase overuse, repetition, and verbatim copy', () => {
  const story = makeSampleStory();
  const phrasebook = createInitialPhrasebook();
  phrasebook[0].banned = true; // 'И вот тут начинается самое интересное.'
  phrasebook[1].isOverused = true; // 'А теперь внимание.'

  const badDebateCheck = runDeterministicDraftChecks({
    title: 'Тестовый заголовок',
    body:
      'Не понимаю современных мужчин и их привычки прятать деньги. ' +
      'И вот тут начинается самое интересное. А теперь внимание. ' +
      'Олег и Марина год откладывали деньги на замену старой кухни, но перед вызовом замерщика выяснилось, что муж переводил часть своей премии на отдельный вклад для поездки к морю в ноябре, ничего не сказав жене.',
    mainTriggerQuestion: story.mainTriggerQuestion,
    collection: 'debate',
    sourceStory: story,
    recentDrafts: [],
    phrasebook,
  });

  assert.equal(badDebateCheck.hasBannedOpening, true);
  assert.ok(badDebateCheck.bannedPhrasesUsed.length >= 1);
  assert.ok(badDebateCheck.overusedPhrases.length >= 1);
  assert.ok(badDebateCheck.verbatimOverlapRatio >= 0.8);
  assert.ok(badDebateCheck.warnings.length >= 3);

  const romanticStory = makeSampleStory({
    id: 'ML-R-0001',
    collection: 'romantic',
    category: 'Тихая забота',
  });
  const romanticCheck = runDeterministicDraftChecks({
    title: 'Термос у выхода',
    body: 'Вечер прошёл спокойно, потому что любовь — это не слова, а поступки.',
    mainTriggerQuestion: 'Замечаете ли вы такие тихие жесты?',
    collection: 'romantic',
    sourceStory: romanticStory,
    recentDrafts: [],
    phrasebook: createInitialPhrasebook(),
  });
  assert.equal(romanticCheck.hasRomanticCliche, true);

  const prevDraft: ContentDraft = {
    id: 'ML-P-D-000001',
    sourceStoryId: 'ML-D-0002',
    collection: 'debate',
    category: 'Деньги и отношения',
    subcategory: 'Общий бюджет',
    title: 'Другой заголовок',
    alternativeTitles: [],
    excerpt: '',
    body: 'На кухне пахло свежей краской, а чек лежал прямо под магнитом на холодильнике.',
    mainTriggerQuestion: 'Кто должен оплачивать неожиданный счёт в такой ситуации?',
    voiceProfile: 'melo_love_standard',
    voiceSettings: createDefaultVoiceConfig().rubricSettings.debate,
    narrativeStructure: 'detail_start',
    contentLength: 14,
    lengthPreset: 'short',
    qualityScore: 88,
    qualityBreakdown: {
      hookStrength: 13,
      languageNaturalness: 13,
      emotionalImpact: 13,
      plotDepth: 13,
      narrativeUniqueness: 13,
      voiceRecognition: 9,
      endingQuality: 9,
      sourceFidelity: 5,
      overall: 88,
      tierLabel: 'Хорошая публикация',
      checks: makeCleanChecks(),
      warnings: [],
      editorialNotes: '',
    },
    editorialNotes: '',
    generationModel: 'gemini-4-hydrogen',
    generationPromptVersion: 'v3',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'ready_for_review',
    revisionHistory: [],
    sourceUrl: '',
    sourceOriginType: 'original',
    keywords: [],
    usedPhrases: [],
    openingPattern: 'На кухне пахло свежей краской, а чек лежал прямо под магнитом на холодильнике.',
    endingPattern: 'Кто должен оплачивать неожиданный счёт в такой ситуации?',
    semanticFingerprint: '',
    variantIndex: 0,
  };

  const repeatCheck = runDeterministicDraftChecks({
    title: 'Повторяющееся начало',
    body: 'На кухне пахло свежей краской, а чек лежал прямо под магнитом на холодильнике. Дальше спор пошёл по кругу.',
    mainTriggerQuestion: 'Кто прав?',
    collection: 'debate',
    sourceStory: story,
    recentDrafts: [prevDraft],
    phrasebook: createInitialPhrasebook(),
  });
  assert.equal(repeatCheck.repeatedOpeningId, 'ML-P-D-000001');
});

test('Default voice config, phrasebook seed, and ML-P-D / ML-P-R ID generator match spec', () => {
  const voice = createDefaultVoiceConfig();
  assert.equal(voice.profiles.length, 5);
  assert.equal(voice.debateProfileId, 'melo_love_standard');
  assert.equal(voice.romanticProfileId, 'more_emotional');
  assert.notEqual(voice.rubricSettings.debate.irony, voice.rubricSettings.romantic.irony);

  const pb = createInitialPhrasebook();
  assert.equal(pb.length, 10);
  assert.ok(pb.every((p) => !p.banned && !p.isOverused));

  assert.equal(generateNextContentId([], 'debate'), 'ML-P-D-000001');
  assert.equal(generateNextContentId([], 'romantic'), 'ML-P-R-000001');
  assert.equal(
    generateNextContentId(
      [{ id: 'ML-P-D-000004' } as ContentDraft, { id: 'ML-P-R-000002' } as ContentDraft],
      'debate'
    ),
    'ML-P-D-000005'
  );
  assert.equal(
    generateNextContentId(
      [{ id: 'ML-P-D-000004' } as ContentDraft, { id: 'ML-P-R-000002' } as ContentDraft],
      'romantic'
    ),
    'ML-P-R-000003'
  );
});

test('buildContentExportObject produces valid JSON bundles with and without sourceStory traceability', () => {
  const story = makeSampleStory();
  const draft: ContentDraft = {
    id: 'ML-P-D-000001',
    sourceStoryId: story.id,
    collection: 'debate',
    category: story.category,
    subcategory: story.subcategory,
    title: 'Кухня против ноября у моря',
    alternativeTitles: ['Вариант 1', 'Вариант 2'],
    excerpt: 'Личная премия или общий фасад кухни.',
    body: 'Текст публикации.',
    mainTriggerQuestion: story.mainTriggerQuestion,
    voiceProfile: 'melo_love_standard',
    voiceSettings: createDefaultVoiceConfig().rubricSettings.debate,
    narrativeStructure: 'detail_start',
    contentLength: 2,
    lengthPreset: 'standard',
    qualityScore: 89,
    qualityBreakdown: {
      hookStrength: 13,
      languageNaturalness: 13,
      emotionalImpact: 13,
      plotDepth: 14,
      narrativeUniqueness: 13,
      voiceRecognition: 9,
      endingQuality: 9,
      sourceFidelity: 5,
      overall: 89,
      tierLabel: 'Хорошая публикация',
      checks: makeCleanChecks(),
      warnings: [],
      editorialNotes: 'ОК',
    },
    editorialNotes: 'ОК',
    generationModel: 'gemini-4-hydrogen',
    generationPromptVersion: 'v3',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'ready_for_review',
    revisionHistory: [],
    sourceUrl: story.sourceUrl,
    researchId: story.researchId,
    sourceOriginType: story.originType,
    keywords: story.keywords,
    usedPhrases: [],
    openingPattern: 'Текст публикации.',
    endingPattern: story.mainTriggerQuestion,
    semanticFingerprint: 'P-D:test',
    variantIndex: 0,
  };

  const withSource = buildContentExportObject(draft, story, true);
  assert.equal(withSource.contentId, 'ML-P-D-000001');
  assert.equal(withSource.sourceStoryId, 'ML-D-0001');
  assert.equal(withSource.researchId, 'RES-D-0001');
  assert.equal(withSource.sourceUrl, story.sourceUrl);
  assert.ok(withSource.sourceStory && typeof withSource.sourceStory === 'object');
  const parsedRoundtrip = JSON.parse(JSON.stringify(withSource));
  assert.equal(parsedRoundtrip.sourceStory.id, 'ML-D-0001');

  const withoutSource = buildContentExportObject(draft, story, false);
  assert.equal(withoutSource.sourceStory, undefined);
});

test('auditSourceStoryCompleteness detects incomplete stories and voice helpers rotate structures safely', () => {
  const incomplete = makeSampleStory({
    fullPlot: 'Слишком коротко',
    participants: '',
  });
  const audit = auditSourceStoryCompleteness(incomplete);
  assert.equal(audit.sufficient, false);
  assert.ok(audit.missingFields.includes('fullPlot'));
  assert.ok(audit.missingFields.includes('participants'));

  const complete = makeSampleStory();
  assert.equal(auditSourceStoryCompleteness(complete).sufficient, true);

  const recent: ContentDraft[] = [
    { narrativeStructure: 'action_start' } as ContentDraft,
    { narrativeStructure: 'detail_start' } as ContentDraft,
  ];
  const nextStruct = selectDiverseNarrativeStructure('auto', recent, 0);
  assert.notEqual(nextStruct, 'action_start');
  assert.notEqual(nextStruct, 'detail_start');

  const pb = createInitialPhrasebook();
  pb[0].banned = true;
  pb[1].isOverused = true;
  const hints = selectEligiblePhrasebookHints(
    complete,
    createDefaultVoiceConfig().rubricSettings.debate,
    pb
  );
  assert.ok(hints.every((h) => !h.banned && !h.isOverused));
});
