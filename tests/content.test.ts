import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContentExportPayload,
  calculateContentQuality,
  countWords,
  detectBannedAiCliches,
  detectBannedOpenings,
  detectRomanticCliches,
  extractEndingPattern,
  extractOpeningPattern,
  hasVerbatimPlotCopy,
  sanitizeKramarovskyDashes,
} from '../src/shared/contentUtils.js';
import { ContentDraft, PhrasebookEntry } from '../src/shared/types.js';
import { buildDebateSeeds } from '../server/seedDebate.js';

test('countWords and opening/ending pattern extractors handle Russian punctuation cleanly', () => {
  const text =
    'Ирина поставила на стол две кружки и молча подвинула чек. Весь вечер они говорили о работе.\nНикто так и не спросил, кто заплатит за такси.';
  assert.equal(countWords(text), 25);
  assert.equal(
    extractOpeningPattern(text),
    'Ирина поставила на стол две кружки и молча подвинула чек'
  );
  assert.equal(extractEndingPattern(text), 'Никто так и не спросил, кто заплатит за такси');
});

test('detectBannedOpenings and detectRomanticCliches catch AI slop templates', () => {
  const badDebate =
    'Не понимаю современных мужчин, которые делят счёт до копейки. Потом он ушёл домой.';
  assert.equal(detectBannedOpenings(badDebate).length, 1);

  const badRomantic =
    'Он заварил ей чай с мёдом. Ведь любовь — это не слова, а поступки, берегите друг друга.';
  const cliches = detectRomanticCliches(badRomantic);
  assert.ok(cliches.length >= 2);
});

test('sanitizeKramarovskyDashes removes em/en dashes while keeping Russian hyphenated words, and detectBannedAiCliches flags AI cliches', () => {
  const raw = 'Давайте по-честному — это просто отговорка – и всё-таки кто-то промолчал.';
  const cleaned = sanitizeKramarovskyDashes(raw);
  assert.equal(/[—–]/.test(cleaned), false);
  assert.ok(cleaned.includes('по-честному'));
  assert.ok(cleaned.includes('кто-то'));
  assert.ok(cleaned.includes(': это'));

  const aiSlop = 'В современном мире важно отметить — данный фактор играет роль.';
  const hits = detectBannedAiCliches(aiSlop);
  assert.ok(hits.length >= 3);
});

test('hasVerbatimPlotCopy detects 8-word contiguous verbatim copying from fullPlot', () => {
  const sourcePlot =
    'Антон предложил отмечать день рождения в недорогом бистро рядом с парком, но потом прислал список гостей из двенадцати коллег.';
  const copiedBody =
    'В тот вечер всё началось обычно. Антон предложил отмечать день рождения в недорогом бистро рядом с парком, и никто не возражал.';
  const originalBody =
    'Сначала план казался камерным: зайти после работы в небольшую закусочную у сквера и спокойно поужинать вдвоём.';

  const copiedRes = hasVerbatimPlotCopy(copiedBody, sourcePlot);
  assert.equal(copiedRes.isVerbatim, true);
  assert.ok(copiedRes.matchedPhrase);

  const cleanRes = hasVerbatimPlotCopy(originalBody, sourcePlot);
  assert.equal(cleanRes.isVerbatim, false);
});

test('calculateContentQuality enforces deterministic score caps below 85 on critical violations', () => {
  const sourceStory = buildDebateSeeds()[0];
  const overusedPhrase: PhrasebookEntry = {
    id: 'PHR-01',
    phrase: 'мелочь перестаёт быть мелочью',
    meaningNote: 'test',
    collectionScope: 'both',
    toneTag: 'ирония',
    weight: 8,
    maxFrequencyPer10: 2,
    banned: false,
    recentUsageCount: 2,
    totalUsageCount: 5,
    createdAt: new Date().toISOString(),
  };

  // 1. Overused phrase cap (<= 81)
  const resOveruse = calculateContentQuality({
    collection: 'debate',
    title: 'Кофе на двоих без предупреждения',
    body: 'В субботу утром она открыла шкафчик и поняла, что мелочь перестаёт быть мелочью, когда правила меняются в одностороннем порядке.',
    triggerQuestion: 'А как бы поступили вы?',
    sourceStory,
    recentDrafts: [],
    phrasebook: [overusedPhrase],
    minScore: 85,
  });
  assert.ok(resOveruse.overall <= 81);
  assert.equal(resOveruse.passedThreshold, false);
  assert.equal(resOveruse.penalties.phraseOveruse, true);

  // 2. Banned AI opening cap (<= 78)
  const resTemplate = calculateContentQuality({
    collection: 'debate',
    title: 'Очередной спор за ужином',
    body: 'У меня есть знакомая, которая столкнулась с похожей историей на прошлой неделе и долго не знала, что сказать в ответ.',
    triggerQuestion: 'Стоит ли терпеть?',
    sourceStory,
    recentDrafts: [],
    phrasebook: [],
    minScore: 85,
  });
  assert.ok(resTemplate.overall <= 78);
  assert.equal(resTemplate.penalties.soundsLikeAiTemplate, true);
});

test('buildContentExportPayload supports draft_only, with_source, and story_only modes', () => {
  const story = buildDebateSeeds()[0];
  const storiesById = new Map([[story.id, story]]);
  const draft: ContentDraft = {
    contentId: 'CNT-D-0001',
    sourceStoryId: story.id,
    collection: 'debate',
    category: story.category,
    subcategory: story.subcategory,
    title: 'Заголовок',
    subtitle: '',
    body: 'Живой текст публикации.',
    triggerQuestion: story.mainTriggerQuestion,
    wordCount: 3,
    lengthPreset: 'standard',
    narrativeStyle: 'action_start',
    voicePresetId: 'melo-standard',
    usedPhraseIds: [],
    usedPhrases: [],
    openingPattern: 'Живой текст публикации',
    endingPattern: 'Живой текст публикации',
    status: 'approved',
    quality: calculateContentQuality({
      collection: 'debate',
      title: 'Заголовок',
      body: 'Живой текст публикации.',
      triggerQuestion: story.mainTriggerQuestion,
      sourceStory: story,
      recentDrafts: [],
      phrasebook: [],
    }),
    autoRefined: false,
    completenessAuditNote: 'OK',
    originType: 'original',
    revisionHistory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const pDraft = buildContentExportPayload([draft], storiesById, 'draft_only');
  assert.equal('sourceStory' in pDraft.items[0], false);

  const pWith = buildContentExportPayload([draft], storiesById, 'with_source');
  assert.equal((pWith.items[0] as { sourceStory: { id: string } }).sourceStory.id, story.id);

  const pStory = buildContentExportPayload([draft], storiesById, 'story_only');
  assert.equal('body' in pStory.items[0], false);
  assert.equal((pStory.items[0] as { sourceStory: { id: string } }).sourceStory.id, story.id);
});
