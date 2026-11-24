import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContentExportPayload,
  calculateContentQuality,
  cleanEditorialFormatting,
  countWords,
  detectBannedAiCliches,
  detectBannedOpenings,
  detectFormattingViolations,
  detectRomanticCliches,
  extractEndingPattern,
  extractOpeningPattern,
  hasVerbatimPlotCopy,
} from '../src/shared/contentUtils.js';
import { runEditorialDiagnostics } from '../src/shared/publishingUtils.js';
import { buildVoiceSystemPrompt } from '../server/voiceEngine.js';
import { ContentDraft, PhrasebookEntry } from '../src/shared/types.js';
import { buildDebateSeeds } from '../server/seedDebate.js';
import { loadVoiceConfig } from '../server/contentStorage.js';

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

test('natural Russian dashes (—) are allowed while stop-list clichés and psychological jargon are flagged', () => {
  const naturalText =
    'Вчера вернулся со смены — в коридоре стоит коробка с дырками, а внутри пищит какой-то комок (ну классика).';
  assert.equal(detectBannedAiCliches(naturalText).length, 0);
  assert.equal(cleanEditorialFormatting(naturalText).includes('—'), true);

  const stopListSample =
    'Давайте смотреть правде в глаза: тут ведь какая штука — важно понимать про личные границы, токсичный абьюз, красные флаги и выход из зоны комфорта. В итоге мы имеем пищу для ума и жизнь превратилась в пытку.';
  const hits = detectBannedAiCliches(stopListSample);
  assert.ok(hits.length >= 8);
});

test('detectFormattingViolations and runEditorialDiagnostics flag headline colons, bullet lists, bold markdown, and emojis', () => {
  const violations = detectFormattingViolations({
    title: 'Любовь или расчёт: почему он ушёл с ужина',
    body: '- первый пункт\n**жирный текст** и смайл 😊',
    triggerQuestion: 'Кто прав?',
  });
  assert.equal(violations.length, 4);

  const diag = runEditorialDiagnostics({
    collection: 'debate',
    title: 'Муж или работа: что важнее в пятницу',
    body: 'Первый абзац истории с достаточным объёмом текста для проверки длины абзацев и отсутствия списков.\n\n- второй абзац списком, да ещё с эмодзи 🔥 и **жирным** текстом про токсичный быт.',
    closingQuestion: 'Кто тут не прав?',
    hashtags: ['#семья', '#споры_в_паре', '#отношения'],
  });
  assert.equal(diag.headlineOk, false);
  assert.equal(diag.spellingOk, false);
  assert.equal(diag.meloStyleOk, false);
});

test('buildVoiceSystemPrompt includes human author rules, Russian adaptation, first-person POV, and stop-list', () => {
  const cfg = loadVoiceConfig();
  const prompt = buildVoiceSystemPrompt({
    collection: 'debate',
    profile: cfg.debate,
    narrativeStyle: 'action_start',
    lengthPreset: 'standard',
    phraseHints: [],
    bannedPhrases: [],
  });
  assert.match(prompt, /живой автор и редактор популярных блогов/i);
  assert.match(prompt, /от первого лица/i);
  assert.match(prompt, /Жена притащила щенка в нашу однушку, а у меня аллергия/);
  assert.match(prompt, /личные границы/);
  assert.match(prompt, /тире \(—\)/);
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

  // 3. Stop-list psychological jargon cap (<= 78)
  const resPsychCliche = calculateContentQuality({
    collection: 'debate',
    title: 'Жена притащила щенка в нашу однушку, а у меня аллергия',
    body: 'Он просто нарушил мои личные границы, проявил токсичный эгоизм и показал красные флаги.',
    triggerQuestion: 'Кто тут не прав?',
    sourceStory,
    recentDrafts: [],
    phrasebook: [],
    minScore: 85,
  });
  assert.ok(resPsychCliche.overall <= 78);
  assert.equal(resPsychCliche.passedThreshold, false);
  assert.equal(resPsychCliche.penalties.soundsLikeAiTemplate, true);
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
