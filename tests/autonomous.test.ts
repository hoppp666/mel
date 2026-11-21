import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  buildMaterialContentFingerprint,
  checkMaterialDuplicate,
  isAutonomousCycleRunning,
  normalizeMaterialTitle,
  runAutonomousProductionCycle,
  runAutonomousPublishingCycle,
  runAutonomousResearchCycle,
  runFullAutonomousCycle,
} from '../server/autonomousScheduler.js';
import {
  AUTONOMOUS_STATE_PATH,
  loadAutonomousState,
  loadProcessedRegistry,
  PROCESSED_REGISTRY_PATH,
  recoverAutonomousState,
  saveAutonomousState,
  saveProcessedRegistry,
} from '../server/autonomousStorage.js';
import { DB_PATH, loadDatabase, saveDatabase } from '../server/storage.js';
import {
  loadResearchJobs,
  loadResearchResults,
  RESEARCH_JOBS_PATH,
  RESEARCH_RESULTS_PATH,
  RESEARCH_SOURCES_PATH,
} from '../server/researchStorage.js';
import {
  CONTENT_DRAFTS_PATH,
  loadContentDrafts,
} from '../server/contentStorage.js';
import {
  loadPublications,
  PUBLICATIONS_PATH,
  PUBLISHING_LOGS_PATH,
  PUBLISHING_SETTINGS_PATH,
  savePublications,
  savePublishingSettings,
  loadPublishingSettings,
} from '../server/publishingStorage.js';
import { ContentDraft, PublicationItem, ResearchResult } from '../src/shared/types.js';
import { measurePublicationLength, TELEGRAM_SAFE_CHAR_LIMIT } from '../src/shared/publishingUtils.js';

const ALL_DATA_PATHS = [
  DB_PATH,
  RESEARCH_RESULTS_PATH,
  RESEARCH_JOBS_PATH,
  RESEARCH_SOURCES_PATH,
  CONTENT_DRAFTS_PATH,
  PUBLICATIONS_PATH,
  PUBLISHING_SETTINGS_PATH,
  PUBLISHING_LOGS_PATH,
  PROCESSED_REGISTRY_PATH,
  AUTONOMOUS_STATE_PATH,
];

function snapshotAll(): Map<string, string | null> {
  const snap = new Map<string, string | null>();
  for (const p of ALL_DATA_PATHS) {
    snap.set(p, fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
  }
  return snap;
}

function restoreAll(snap: Map<string, string | null>): void {
  for (const [p, content] of snap.entries()) {
    if (content === null) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } else {
      fs.writeFileSync(p, content, 'utf8');
    }
  }
}

function makeCleanEnvironment() {
  if (fs.existsSync(PROCESSED_REGISTRY_PATH)) fs.unlinkSync(PROCESSED_REGISTRY_PATH);
  if (fs.existsSync(AUTONOMOUS_STATE_PATH)) fs.unlinkSync(AUTONOMOUS_STATE_PATH);
  fs.writeFileSync(RESEARCH_RESULTS_PATH, '[]', 'utf8');
  fs.writeFileSync(RESEARCH_JOBS_PATH, '[]', 'utf8');
  fs.writeFileSync(CONTENT_DRAFTS_PATH, '[]', 'utf8');
  fs.writeFileSync(PUBLICATIONS_PATH, '[]', 'utf8');

  const db = loadDatabase();
  db.stories = db.stories.filter((s) => s.originType === 'original');
  saveDatabase(db);

  const state = loadAutonomousState();
  state.config.researchBatchSize = 2;
  state.config.productionBatchSize = 2;
  state.config.researchEnabled = true;
  state.config.autoPublishEnabled = false;
  state.config.stopRequested = false;
  saveAutonomousState(state);
}

const DISTINCT_SCENARIOS = [
  {
    place: 'чердачной мастерской',
    item: 'квитанция об аренде',
    conflict: 'тайная аренда студии за общие накопления',
    twist: 'студия оборудована мольбертом для её выставки',
    theme: 'скрытый подарок',
    mechanic: 'ложное подозрение',
    keywords: ['мастерская', 'подарок', 'доверие'],
  },
  {
    place: 'нотариальной конторе',
    item: 'старый велосипед во дворе',
    conflict: 'отказ отдавать семейную реликвию дальнему родственнику',
    twist: 'в раме хранилось письмо с благодарностью деда',
    theme: 'память и принципы',
    mechanic: 'неожиданная находка',
    keywords: ['реликвия', 'семья', 'принципы'],
  },
  {
    place: 'камере хранения вокзала',
    item: 'жетон с гравировкой',
    conflict: 'спор из-за потерянного чемодана перед пересадкой',
    twist: 'в чемодане были детские альбомы соседа по купе',
    theme: 'случайная честность',
    mechanic: 'путь назад',
    keywords: ['вокзал', 'честность', 'попутчик'],
  },
  {
    place: 'теплице за городом',
    item: 'саженцы лимонного дерева',
    conflict: 'покупка заброшенного участка без обсуждения бюджета',
    twist: 'участок принадлежал бабушке с редким садом',
    theme: 'возвращение корней',
    mechanic: 'тихая решимость',
    keywords: ['сад', 'дача', 'корни'],
  },
];

function makeUniqueAnalysisResult(idx: number, item: ResearchResult) {
  const stamp = `${Date.now().toString(36)}-${idx}`;
  const isRomantic = item.collection === 'romantic';
  const sc = DISTINCT_SCENARIOS[idx % DISTINCT_SCENARIOS.length];
  return {
    analysis: {
      sourceSummary: `Уникальный разбор про ${sc.place} (${stamp}) из ${item.sourceName}.`,
      mainSituation: `Коллизия вокруг объекта «${sc.item}» в ${sc.place} (${stamp})`,
      participants: `Персонаж А-${idx} и Персонаж Б-${idx}`,
      relationshipType: 'близкие люди',
      mainConflict: `${sc.conflict} (${stamp})`,
      positionsOfParticipants: 'Оба приводят веские бытовые аргументы',
      emotionalMechanism: 'Напряжение из-за недосказанного мотива',
      hiddenExpectation: 'Желание признания личного вклада',
      unexpectedDetail: `${sc.item} (${stamp})`,
      possibleTwist: `${sc.twist} (${stamp})`,
      readerReactionPotential: 'Высокий отклик в комментариях',
      storyMechanic: sc.mechanic,
      keywords: sc.keywords,
      researchNotes: 'Готово к публикации',
      originalityAssessment: 'Оригинальная бытовая коллизия',
    },
    generatedPlot: {
      category: isRomantic ? 'Неожиданная забота в быту' : 'Разные взгляды и принципы',
      subcategory: 'Частные находки',
      title: `История #${idx}: ${sc.item} в ${sc.place} (${stamp})`,
      shortDescription: `Спор разгорелся в ${sc.place}, когда всплыла деталь: ${sc.item} (${stamp}).`,
      fullPlot: `Событие началось в ${sc.place}, где ключевую роль сыграла ${sc.item} (${stamp}). Разгорелся ${sc.conflict}, но финал перевернул всё: ${sc.twist}.`,
      participants: `Участник А-${idx}, Участник Б-${idx}`,
      setting: `Локация: ${sc.place} (${stamp})`,
      coreConflictOrAction: `${sc.conflict} (${stamp})`,
      sideAPosition: 'Всё должно решаться открыто без скрытых шагов',
      sideBPosition: 'Некоторые шаги требуют тишины до момента результата',
      emotionalMechanism: 'Проверка взаимного уважения',
      hiddenExpectation: 'Потребность быть услышанным без упрёка',
      unexpectedNuance: `Деталь: ${sc.item} (${stamp})`,
      possibleTwist: `${sc.twist} (${stamp})`,
      mainTriggerQuestion: `Как бы вы поступили в истории про ${sc.item} (${stamp})?`,
      additionalQuestions: ['Где проходит черта между правом на тайну и открытостью?'],
      keywords: [...sc.keywords, `тема_${idx}`],
      mainTheme: sc.theme,
      plotMechanic: sc.mechanic,
      uniqueDetails: `${sc.item} (${stamp})`,
    },
    quality: {
      overall: 88,
      tierLabel: 'Отличная идея' as const,
      explanation: 'Сильная бытовая деталь и живой вопрос для дискуссии.',
      breakdown: {
        originality: 89,
        realism: 88,
        specificity: 88,
        emotionalExpressiveness: 87,
        readerInterest: 89,
        diversity: 87,
        discussionPotential: 88,
        mechanicQuality: 88,
      },
    },
  };
}

function makeFakeDraftGenerator(suffix: string) {
  return async (params: { sourceStoryId: string }): Promise<ContentDraft[]> => {
    const db = loadDatabase();
    const story = db.stories.find((s) => s.id === params.sourceStoryId)!;
    const now = new Date().toISOString();
    const draft: ContentDraft = {
      contentId: `CNT-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`,
      sourceStoryId: story.id,
      researchId: story.researchId,
      sourceUrl: story.sourceUrl,
      originType: story.originType,
      collection: story.collection,
      category: story.category,
      subcategory: story.subcategory,
      title: `Неожиданный чек в кармане куртки изменил планы пары (${suffix})`,
      subtitle: story.shortDescription,
      body: `В субботу утром Марина разбирала старую куртку и нашла чек из мастерской на соседней улице.\n\nНикто не предупреждал её об этих расходах, и целый день она не решалась спросить прямо, чтобы не начинать ссору на пустом месте.\n\nВечером всё открылось само: муж готовил подарок к дате, о которой она сама почти забыла в рабочих делах.`,
      triggerQuestion: 'Как вы бы отреагировали: спросили бы сразу или подождали объяснений?',
      wordCount: 58,
      lengthPreset: 'standard',
      narrativeStyle: 'action_start',
      voicePresetId: 'default',
      usedPhraseIds: [],
      usedPhrases: [],
      openingPattern: 'scene_time',
      endingPattern: 'direct_question',
      status: 'approved',
      quality: {
        overall: 88,
        breakdown: {
          hookStrength: 88,
          languageNaturalness: 89,
          emotionalImpact: 87,
          plotDepth: 88,
          narrativeUniqueness: 89,
          voiceRecognition: 88,
          endingQuality: 87,
          sourceFidelity: 88,
        },
        penalties: {
          hasMeaninglessRepetition: false,
          soundsLikeAiTemplate: false,
          artificialColloquialism: false,
          phraseOveruse: false,
          contradictsSource: false,
          lostImportantDetail: false,
          artificialEnding: false,
          unsubstantiatedClaims: false,
          verbatimCopy: false,
          details: [],
        },
        editorialComment: 'Живой тон MELO_LOVE без канцелярита.',
        passedThreshold: true,
      },
      autoRefined: false,
      completenessAuditNote: 'Сюжет полон.',
      revisionHistory: [],
      createdAt: now,
      updatedAt: now,
    };
    return [draft];
  };
}

test('Scenario 1 & 2 & 10: First run creates registry/state; repeat run deduplicates without AI calls', async () => {
  const snap = snapshotAll();
  try {
    makeCleanEnvironment();
    let analyzeCalls = 0;

    const leadA = {
      url: 'https://example.org/stories/attic-key?utm_source=rss&fbclid=123',
      title: 'The Quiet Key in the Coat Pocket',
      author: 'Claire',
      publishedAt: '2026-11-10',
      excerpt: 'She found a studio receipt in her husband winter jacket before moving.',
      sourceId: 'SRC-TEST-1',
      sourceName: 'Test Journal',
    };
    const leadB = {
      url: 'https://example.org/stories/sunday-groceries/',
      title: 'Separate Receipts on Sunday Morning',
      author: 'Mark',
      publishedAt: '2026-11-11',
      excerpt: 'Two partners split grocery bills down to cents until an emergency hit.',
      sourceId: 'SRC-TEST-1',
      sourceName: 'Test Journal',
    };

    const run1 = await runAutonomousResearchCycle({
      mode: 'manual',
      collectionOverride: 'debate',
      deps: {
        fetchLeadsFn: async () => [leadA, leadB],
        analyzeFn: async ({ item }) => {
          analyzeCalls += 1;
          return makeUniqueAnalysisResult(analyzeCalls, item);
        },
        retryDelayMs: 1,
      },
    });

    assert.equal(run1.ok, true);
    assert.equal(run1.discovered, 2);
    assert.equal(run1.uniqueAdded, 2);
    assert.equal(run1.duplicates, 0);
    assert.equal(run1.analyzed, 2);
    assert.equal(run1.storiesApproved, 2);
    assert.equal(analyzeCalls, 2);

    assert.ok(fs.existsSync(PROCESSED_REGISTRY_PATH));
    assert.ok(fs.existsSync(AUTONOMOUS_STATE_PATH));
    const reg1 = loadProcessedRegistry();
    assert.equal(reg1.filter((e) => e.status === 'approved').length, 2);

    const run2 = await runAutonomousResearchCycle({
      mode: 'manual',
      collectionOverride: 'debate',
      deps: {
        fetchLeadsFn: async () => [
          {
            ...leadA,
            url: 'https://www.example.org/stories/attic-key',
          },
          {
            ...leadB,
            url: 'https://example.org/stories/different-slug-same-title',
            title: 'Separate Receipts on Sunday Morning!',
          },
        ],
        analyzeFn: async ({ item }) => {
          analyzeCalls += 1;
          return makeUniqueAnalysisResult(analyzeCalls, item);
        },
        retryDelayMs: 1,
      },
    });

    assert.equal(run2.ok, true);
    assert.equal(run2.uniqueAdded, 0);
    assert.equal(run2.duplicates, 2);
    assert.equal(analyzeCalls, 2);

    const dupCheck = checkMaterialDuplicate({
      url: 'https://example.org/stories/attic-key?ref=newsletter',
      title: 'Completely new title',
      excerpt: 'Unrelated excerpt',
      collection: 'debate',
    });
    assert.equal(dupCheck.isDuplicate, true);
    assert.equal(
      normalizeMaterialTitle('Hello, World — Test!'),
      'hello world test'
    );
    assert.ok(
      buildMaterialContentFingerprint('Title A', 'Excerpt B', 'https://x.test/a').includes(':')
    );
  } finally {
    restoreAll(snap);
  }
});

test('Scenario 3 & 4: Resumes unfinished batch + recovers interrupted states + creates sequential next batch', async () => {
  const snap = snapshotAll();
  try {
    makeCleanEnvironment();

    saveProcessedRegistry([
      {
        id: 'REG-000001',
        url: 'https://example.org/crashed-story',
        normalizedUrl: 'example.org/crashed-story',
        sourceId: 'SRC-1',
        sourceName: 'Test',
        title: 'Interrupted Generation Material',
        normalizedTitle: 'interrupted generation material',
        collection: 'romantic',
        discoveredAt: new Date().toISOString(),
        contentFingerprint: 'interrupted:12345',
        status: 'generating',
        updatedAt: new Date().toISOString(),
      },
    ]);
    recoverAutonomousState();
    const recoveredReg = loadProcessedRegistry();
    assert.equal(recoveredReg[0].status, 'failed');

    const st = loadAutonomousState();
    st.config.researchBatchSize = 3;
    saveAutonomousState(st);

    let seq = 10;
    const runPartial = await runAutonomousResearchCycle({
      mode: 'manual',
      collectionOverride: 'romantic',
      deps: {
        fetchLeadsFn: async () => [
          {
            url: 'https://example.org/rom/train-ticket-1',
            title: 'Two Seats Reserved Every Autumn',
            author: 'Elena',
            publishedAt: '2026-11-01',
            excerpt: 'Every October he buys an extra regional train ticket without explaining why.',
            sourceId: 'SRC-ROM',
            sourceName: 'Romantic Hub',
          },
        ],
        analyzeFn: async ({ item }) => makeUniqueAnalysisResult(++seq, item),
        retryDelayMs: 1,
      },
    });

    assert.equal(runPartial.uniqueAdded, 1);
    const stateMid = loadAutonomousState();
    assert.equal(stateMid.batches.length, 1);
    assert.equal(stateMid.batches[0].batchId, 'RBATCH-0001');
    assert.equal(stateMid.batches[0].status, 'in_progress');
    assert.equal(stateMid.activeBatchId, 'RBATCH-0001');

    const runResume = await runAutonomousResearchCycle({
      mode: 'manual',
      deps: {
        fetchLeadsFn: async () => [
          {
            url: 'https://example.org/rom/raincoat-2',
            title: 'The Yellow Raincoat Left at the Pier',
            author: 'Lia',
            publishedAt: '2026-11-02',
            excerpt: 'A forgotten raincoat leads to two strangers exchanging handwritten notes for months.',
            sourceId: 'SRC-ROM',
            sourceName: 'Romantic Hub',
          },
          {
            url: 'https://example.org/rom/bakery-3',
            title: 'Croissants Before the Night Shift',
            author: 'Sam',
            publishedAt: '2026-11-03',
            excerpt: 'A nurse discovers who leaves warm pastries on her windshield after midnight.',
            sourceId: 'SRC-ROM',
            sourceName: 'Romantic Hub',
          },
        ],
        analyzeFn: async ({ item }) => makeUniqueAnalysisResult(++seq, item),
        retryDelayMs: 1,
      },
    });

    assert.equal(runResume.uniqueAdded, 2);
    const stateDone = loadAutonomousState();
    assert.equal(stateDone.batches[0].batchId, 'RBATCH-0001');
    assert.equal(stateDone.batches[0].status, 'completed');
    assert.equal(stateDone.activeBatchId, undefined);

    const runNextBatch = await runAutonomousResearchCycle({
      mode: 'manual',
      deps: {
        fetchLeadsFn: async () => [
          {
            url: 'https://example.org/deb/garage-sale-4',
            title: 'Selling the Heirloom Watch Without Asking',
            author: 'Tom',
            publishedAt: '2026-11-04',
            excerpt: 'A couple argues after one sells an old family item to pay utility arrears.',
            sourceId: 'SRC-DEB',
            sourceName: 'Debate Hub',
          },
        ],
        analyzeFn: async ({ item }) => makeUniqueAnalysisResult(++seq, item),
        retryDelayMs: 1,
      },
    });

    assert.equal(runNextBatch.uniqueAdded, 1);
    const stateAfterNext = loadAutonomousState();
    assert.equal(stateAfterNext.batches.length, 2);
    assert.equal(stateAfterNext.batches[0].batchId, 'RBATCH-0002');
    assert.equal(stateAfterNext.batches[1].batchId, 'RBATCH-0001');
  } finally {
    restoreAll(snap);
  }
});

test('Scenario 5 & 6: Produces publications up to limit & handles zero new leads cleanly', async () => {
  const snap = snapshotAll();
  try {
    makeCleanEnvironment();

    const emptyRun = await runAutonomousResearchCycle({
      mode: 'manual',
      deps: {
        fetchLeadsFn: async () => [],
      },
    });
    assert.equal(emptyRun.ok, true);
    assert.equal(emptyRun.discovered, 0);
    assert.equal(emptyRun.uniqueAdded, 0);

    let seq = 50;
    const researchRun = await runAutonomousResearchCycle({
      mode: 'manual',
      collectionOverride: 'debate',
      deps: {
        fetchLeadsFn: async () => [
          {
            url: 'https://example.org/deb/vacation-split-55',
            title: 'Splitting the Villa Cost When Two Friends Arrive Late',
            author: 'Nina',
            publishedAt: '2026-11-05',
            excerpt: 'Half the group stayed four nights while two arrived only for the weekend.',
            sourceId: 'SRC-DEB',
            sourceName: 'Debate Hub',
          },
        ],
        analyzeFn: async ({ item }) => makeUniqueAnalysisResult(++seq, item),
        retryDelayMs: 1,
      },
    });
    assert.equal(researchRun.storiesApproved, 1);

    const reg = loadProcessedRegistry();
    const storyId = reg[0].storyId!;
    assert.ok(storyId);

    const pubsBefore = loadPublications().length;
    const prodRun = await runAutonomousProductionCycle({
      mode: 'manual',
      deps: {
        generateDraftsFn: makeFakeDraftGenerator('prod-test'),
      },
    });

    assert.equal(prodRun.ok, true);
    assert.ok(prodRun.publicationsCreated >= 1);
    const pubsAfter = loadPublications();
    assert.ok(pubsAfter.length > pubsBefore);
    const createdPub = pubsAfter[0];
    assert.equal(createdPub.status, 'ready');
    assert.ok(createdPub.totalChars <= TELEGRAM_SAFE_CHAR_LIMIT);
    const measured = measurePublicationLength(createdPub);
    assert.equal(measured.exceedsSafeLimit, false);
  } finally {
    restoreAll(snap);
  }
});

test('Scenario 7: Gemini API 429/503 error preserves research_pending without losing leads and recovers next run', async () => {
  const snap = snapshotAll();
  try {
    makeCleanEnvironment();

    let attempts = 0;
    const failingRun = await runAutonomousResearchCycle({
      mode: 'manual',
      collectionOverride: 'debate',
      deps: {
        fetchLeadsFn: async () => [
          {
            url: 'https://example.org/deb/wedding-seating-77',
            title: 'Moving the Estranged Uncle to Table Eight',
            author: 'Paul',
            publishedAt: '2026-11-06',
            excerpt: 'A bride changed the seating chart at midnight and sparked a family standoff.',
            sourceId: 'SRC-DEB',
            sourceName: 'Debate Hub',
          },
        ],
        analyzeFn: async () => {
          attempts += 1;
          throw Object.assign(new Error('429 RESOURCE_EXHAUSTED quota exceeded'), { status: 429 });
        },
        retryDelayMs: 1,
      },
    });

    assert.equal(attempts, 3);
    assert.equal(failingRun.uniqueAdded, 1);
    assert.equal(failingRun.analyzed, 0);
    assert.ok(failingRun.pendingAnalysis >= 1);

    const resultsAfterFail = loadResearchResults();
    const savedPending = resultsAfterFail.find((r) =>
      r.sourceUrl.includes('wedding-seating-77')
    );
    assert.ok(savedPending);
    assert.equal(savedPending!.queueStatus, 'research_pending');
    assert.equal(savedPending!.analysisStatus, 'failed');

    let recoveryCalls = 0;
    const recoveryRun = await runAutonomousResearchCycle({
      mode: 'manual',
      collectionOverride: 'debate',
      deps: {
        fetchLeadsFn: async () => [],
        analyzeFn: async ({ item }) => {
          recoveryCalls += 1;
          return makeUniqueAnalysisResult(99, item);
        },
        retryDelayMs: 1,
      },
    });

    assert.equal(recoveryCalls, 1);
    assert.equal(recoveryRun.analyzed, 1);
    assert.equal(recoveryRun.storiesApproved, 1);
    const resultsRecovered = loadResearchResults();
    const updatedItem = resultsRecovered.find((r) => r.researchId === savedPending!.researchId);
    assert.equal(updatedItem?.queueStatus, 'approved_for_database');
  } finally {
    restoreAll(snap);
  }
});

test('Scenario 8: GitHub Actions workflows have schedule, workflow_dispatch, concurrency, and [skip ci]', () => {
  const researchYml = fs.readFileSync(
    path.join(process.cwd(), '.github', 'workflows', 'melo-love-research.yml'),
    'utf8'
  );
  const publishYml = fs.readFileSync(
    path.join(process.cwd(), '.github', 'workflows', 'publishing-queue.yml'),
    'utf8'
  );

  assert.ok(researchYml.includes('schedule:'));
  assert.ok(researchYml.includes("cron: '0 */6 * * *'"));
  assert.ok(researchYml.includes('workflow_dispatch:'));
  assert.ok(researchYml.includes('group: melo-love-autonomous-data'));
  assert.ok(researchYml.includes('[skip ci]'));
  assert.ok(researchYml.includes('models: read'));
  assert.ok(researchYml.includes('secrets.GITHUB_TOKEN'));
  assert.ok(researchYml.includes('openai/gpt-4o'));

  assert.ok(publishYml.includes('schedule:'));
  assert.ok(publishYml.includes("cron: '0 */3 * * *'"));
  assert.ok(publishYml.includes('group: melo-love-autonomous-data'));
  assert.ok(publishYml.includes('TELEGRAM_AUTO_SEND_ENABLED'));
});

test('Scenario 9: Concurrency lock rejects parallel runFullAutonomousCycle & stopRequested halts cleanly', async () => {
  const snap = snapshotAll();
  try {
    makeCleanEnvironment();

    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });

    const p1 = runFullAutonomousCycle({
      mode: 'manual',
      dryRunPublish: true,
      researchDeps: {
        fetchLeadsFn: async () => {
          await slowGate;
          return [];
        },
      },
    });

    await new Promise((r) => setTimeout(r, 10));
    assert.equal(isAutonomousCycleRunning(), true);

    await assert.rejects(
      () => runFullAutonomousCycle({ mode: 'manual', dryRunPublish: true }),
      (err: Error & { status?: number }) => err.status === 409
    );

    releaseSlow();
    await p1;
    assert.equal(isAutonomousCycleRunning(), false);

    const st = loadAutonomousState();
    st.config.stopRequested = true;
    saveAutonomousState(st);

    const stopped = await runFullAutonomousCycle({
      mode: 'github_actions',
      ignoreStopFlag: false,
      researchDeps: {
        fetchLeadsFn: async () => {
          throw new Error('Must not fetch when stopped');
        },
      },
    });
    assert.equal(stopped.research.discovered, 0);
    assert.ok(stopped.research.summary.includes('stopRequested=true'));
    assert.equal(stopped.production.publicationsCreated, 0);
    assert.equal(stopped.publish.publishedToTelegram, 0);
  } finally {
    restoreAll(snap);
  }
});

test('Publishing Scheduler: enforces 3h interval, max 4/day, max 1 item per run, dryRunOverride, and Telegram failure safety', async () => {
  const snap = snapshotAll();
  const prevEnv = {
    bot: process.env.TELEGRAM_BOT_TOKEN,
    chat: process.env.TELEGRAM_CHANNEL_ID,
    auto: process.env.TELEGRAM_AUTO_SEND_ENABLED,
  };

  try {
    makeCleanEnvironment();
    process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token-000';
    process.env.TELEGRAM_CHANNEL_ID = '@test_channel';
    process.env.TELEGRAM_AUTO_SEND_ENABLED = 'true';

    const settings = loadPublishingSettings();
    settings.autoSendEnabled = true;
    settings.dryRunMode = false;
    savePublishingSettings(settings);

    const st = loadAutonomousState();
    st.config.autoPublishEnabled = true;
    st.config.publishMinIntervalHours = 3;
    st.config.maxPublishesPerDay = 4;
    st.lastSuccessfulTelegramAt = undefined;
    st.publishedTodayCount = 0;
    saveAutonomousState(st);

    const now = new Date().toISOString();
    const makeReadyPub = (id: string, createdAtOffsetMs: number): PublicationItem => {
      const base: PublicationItem = {
        publicationId: id,
        sourceStoryId: 'DEB-001',
        collection: 'debate',
        category: 'Финансы',
        subcategory: 'Бюджет',
        title: `Тестовый пост ${id}`,
        alternativeTitles: [],
        teaser: 'Тизер истории.',
        body: 'Абзац первый для Telegram.\n\nАбзац второй для обсуждения.',
        closingQuestion: 'Кто прав в этой ситуации?',
        hashtags: ['#отношения', '#психология', '#melo_love'],
        hasImageAttachment: false,
        totalChars: 0,
        remainingChars: 3800,
        exceedsTelegramLimit: false,
        firstSentenceLength: 0,
        seoNotes: '',
        seoKeywords: [],
        editorialChecks: {
          spellingOk: true,
          noRepetitionOk: true,
          logicOk: true,
          meloStyleOk: true,
          headlineOk: true,
          hashtagsOk: true,
          notes: [],
        },
        status: 'ready',
        idempotencyKey: `IDEMP-${id}-${Date.now()}`,
        revisionHistory: [],
        createdAt: new Date(Date.now() + createdAtOffsetMs).toISOString(),
        updatedAt: now,
      };
      const m = measurePublicationLength(base);
      return {
        ...base,
        totalChars: m.totalChars,
        remainingChars: m.remainingChars,
        exceedsTelegramLimit: m.exceedsSafeLimit,
        firstSentenceLength: m.firstSentenceLength,
      };
    };

    savePublications([makeReadyPub('PUB-D-9901', 1000), makeReadyPub('PUB-D-9902', 2000)]);

    const dryLog = await runAutonomousPublishingCycle({
      mode: 'manual',
      dryRunOverride: true,
      fetchImpl: (async () => {
        throw new Error('fetch must not be called in dryRunOverride=true');
      }) as typeof fetch,
    });
    assert.equal(dryLog.publishedToTelegram, 0);
    assert.ok(dryLog.summary.includes('Dry-Run'));

    let sentCount = 0;
    const liveLog = await runAutonomousPublishingCycle({
      mode: 'github_actions',
      fetchImpl: (async () => {
        sentCount += 1;
        return new Response(JSON.stringify({ ok: true, result: { message_id: 7771 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch,
    });
    assert.equal(sentCount, 1);
    assert.equal(liveLog.publishedToTelegram, 1);

    const pubsAfterOne = loadPublications();
    const p1 = pubsAfterOne.find((p) => p.publicationId === 'PUB-D-9901')!;
    const p2 = pubsAfterOne.find((p) => p.publicationId === 'PUB-D-9902')!;
    assert.equal(p1.status, 'zen_delivery_unconfirmed');
    assert.equal(p1.telegramMessageId, 7771);
    assert.equal(p2.status, 'ready');

    const intervalLog = await runAutonomousPublishingCycle({
      mode: 'github_actions',
      fetchImpl: (async () => {
        throw new Error('Must not bypass 3h interval');
      }) as typeof fetch,
    });
    assert.equal(intervalLog.publishedToTelegram, 0);
    assert.ok(intervalLog.summary.includes('Интервал'));

    const stAfter = loadAutonomousState();
    stAfter.lastSuccessfulTelegramAt = new Date(Date.now() - 4 * 3600_000).toISOString();
    saveAutonomousState(stAfter);

    const failLog = await runAutonomousPublishingCycle({
      mode: 'github_actions',
      fetchImpl: (async () =>
        new Response(JSON.stringify({ ok: false, description: 'Forbidden: bot kicked' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })) as typeof fetch,
    });
    assert.equal(failLog.ok, false);
    assert.equal(failLog.publishedToTelegram, 0);
    const p2AfterFail = loadPublications().find((p) => p.publicationId === 'PUB-D-9902')!;
    assert.equal(p2AfterFail.status, 'failed');

    const stCap = loadAutonomousState();
    stCap.publishedTodayCount = 4;
    stCap.lastSuccessfulTelegramAt = new Date(Date.now() - 5 * 3600_000).toISOString();
    saveAutonomousState(stCap);

    const capLog = await runAutonomousPublishingCycle({
      mode: 'github_actions',
      fetchImpl: (async () => {
        throw new Error('Must not send above daily limit');
      }) as typeof fetch,
    });
    assert.equal(capLog.publishedToTelegram, 0);
    assert.ok(capLog.summary.includes('суточный лимит'));

    delete process.env.TELEGRAM_BOT_TOKEN;
    const currentPubs = loadPublications();
    currentPubs.push(makeReadyPub('PUB-D-9903', 3000));
    savePublications(currentPubs);
    const stReset = loadAutonomousState();
    stReset.publishedTodayCount = 0;
    stReset.lastSuccessfulTelegramAt = undefined;
    saveAutonomousState(stReset);
    const noTgLog = await runAutonomousPublishingCycle({
      mode: 'github_actions',
      fetchImpl: (async () => {
        throw new Error('Must not call Telegram API without TELEGRAM_BOT_TOKEN');
      }) as typeof fetch,
    });
    assert.equal(noTgLog.ok, true);
    assert.equal(noTgLog.publishedToTelegram, 0);
    assert.ok(noTgLog.summary.includes('Telegram пока не подключён'));
  } finally {
    restoreAll(snap);
    if (prevEnv.bot === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prevEnv.bot;
    if (prevEnv.chat === undefined) delete process.env.TELEGRAM_CHANNEL_ID;
    else process.env.TELEGRAM_CHANNEL_ID = prevEnv.chat;
    if (prevEnv.auto === undefined) delete process.env.TELEGRAM_AUTO_SEND_ENABLED;
    else process.env.TELEGRAM_AUTO_SEND_ENABLED = prevEnv.auto;
  }
});
