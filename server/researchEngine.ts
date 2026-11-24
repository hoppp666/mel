import {
  CollectionType,
  ResearchJob,
  ResearchResult,
  StoryPlot,
} from '../src/shared/types.js';
import {
  buildSemanticFingerprint,
  calculateQualityScore,
  findResearchDuplicates,
  normalizeSourceUrl,
} from '../src/shared/similarity.js';
import {
  createBackupSnapshot,
  loadDatabase,
  nextStoryId,
  normalizeAndScoreStory,
  saveDatabase,
} from './storage.js';
import {
  loadResearchJobs,
  loadResearchResults,
  loadResearchSources,
  nextResearchId,
  saveResearchJobs,
  saveResearchResults,
  saveResearchSources,
} from './researchStorage.js';
import {
  checkResearchSourceAvailability,
  fetchPublicArticlesFromSource,
} from './researchSources.js';
import {
  analyzeAndTransformResearchItem,
  searchForeignLeadsWithGrounding,
} from './researchAnalyzer.js';
import {
  formatGeminiError,
  isGeminiConfigured,
  isQuotaOrAuthError,
} from './geminiClient.js';

const activeControllers = new Map<string, AbortController>();

export function isAnyResearchJobRunning(): boolean {
  const jobs = loadResearchJobs();
  return jobs.some((j) => j.status === 'running' || j.status === 'queued');
}

export function startResearchJob(params: {
  collection: CollectionType;
  sourceIds: string[];
  categoryFocus: string;
  sourceLanguage: string;
  requestedCount: number;
  analysisDepth: 'standard' | 'deep';
  transformMode: 'analyze_only' | 'analyze_and_generate';
}): ResearchJob {
  if (isAnyResearchJobRunning()) {
    const err = new Error('Уже выполняется активное задание исследования. Дождитесь завершения или отмените его.');
    (err as { status?: number }).status = 409;
    throw err;
  }

  const clampedCount = Math.max(1, Math.min(10, Math.round(params.requestedCount || 3)));
  const jobId = `JOB-${Date.now().toString(36).toUpperCase()}`;

  const job: ResearchJob = {
    id: jobId,
    collection: params.collection,
    sourceIds: params.sourceIds,
    categoryFocus: params.categoryFocus || 'balanced',
    sourceLanguage: params.sourceLanguage || 'en',
    requestedCount: clampedCount,
    analysisDepth: params.analysisDepth || 'standard',
    transformMode: params.transformMode || 'analyze_and_generate',
    status: 'running',
    methodUsed: 'hybrid',
    processedCount: 0,
    foundCount: 0,
    failedCount: 0,
    startedAt: new Date().toISOString(),
    logs: [`[${new Date().toISOString()}] Запуск задания ${jobId} (${clampedCount} материалов)`],
  };

  const jobs = loadResearchJobs();
  jobs.unshift(job);
  saveResearchJobs(jobs);

  const controller = new AbortController();
  activeControllers.set(jobId, controller);

  void executeResearchJob(jobId, controller.signal).finally(() => {
    activeControllers.delete(jobId);
  });

  return job;
}

export function cancelResearchJob(jobId: string): ResearchJob {
  const controller = activeControllers.get(jobId);
  if (controller) {
    controller.abort();
  }
  const jobs = loadResearchJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (!job) {
    const err = new Error('Задание не найдено');
    (err as { status?: number }).status = 404;
    throw err;
  }
  if (job.status === 'running' || job.status === 'queued') {
    job.status = 'cancelled';
    job.finishedAt = new Date().toISOString();
    job.logs.push(`[${new Date().toISOString()}] Отменено пользователем.`);
    saveResearchJobs(jobs);
  }
  return job;
}

function updateJob(jobId: string, updater: (job: ResearchJob) => void): void {
  const jobs = loadResearchJobs();
  const target = jobs.find((j) => j.id === jobId);
  if (!target) return;
  updater(target);
  saveResearchJobs(jobs);
}

async function executeResearchJob(jobId: string, signal: AbortSignal): Promise<void> {
  const initialJobs = loadResearchJobs();
  const job = initialJobs.find((j) => j.id === jobId);
  if (!job) return;

  try {
    let sources = loadResearchSources();
    const selectedSources = sources.filter(
      (s) => s.enabled && (job.sourceIds.length === 0 || job.sourceIds.includes(s.id))
    );

    if (selectedSources.length === 0) {
      updateJob(jobId, (j) => {
        j.status = 'failed';
        j.finishedAt = new Date().toISOString();
        j.error = 'Не выбраны активные источники для исследования.';
      });
      return;
    }

    // Check unchecked sources before fetching
    for (let i = 0; i < selectedSources.length; i++) {
      if (signal.aborted) return;
      if (selectedSources[i].status === 'unchecked') {
        const checked = await checkResearchSourceAvailability(selectedSources[i]);
        selectedSources[i] = checked;
        sources = sources.map((s) => (s.id === checked.id ? checked : s));
        saveResearchSources(sources);
      }
    }

    const existingResults = loadResearchResults();
    const existingUrls = new Set(existingResults.map((r) => normalizeSourceUrl(r.sourceUrl)).filter(Boolean));
    const leads: Array<{
      url: string;
      title: string;
      author: string;
      publishedAt: string;
      excerpt: string;
      sourceId: string;
      sourceName: string;
      sourceType: ResearchResult['sourceType'];
      reliability: ResearchResult['sourceReliability'];
    }> = [];

    // Step 1: Direct public feeds for available sources
    const availableSources = selectedSources.filter((s) => s.status === 'available');
    for (const src of availableSources) {
      if (signal.aborted || leads.length >= job.requestedCount) break;
      try {
        const articles = await fetchPublicArticlesFromSource(src, job.requestedCount - leads.length);
        for (const a of articles) {
          const norm = normalizeSourceUrl(a.url);
          if (!norm || existingUrls.has(norm)) continue;
          existingUrls.add(norm);
          leads.push({
            url: a.url,
            title: a.title,
            author: a.author,
            publishedAt: a.publishedAt,
            excerpt: a.excerpt,
            sourceId: src.id,
            sourceName: src.name,
            sourceType: src.sourceType,
            reliability: 'verified_direct',
          });
          if (leads.length >= job.requestedCount) break;
        }
      } catch {
        // Ignore individual feed read error and continue
      }
    }

    // Step 2: Google Search Grounding for remaining slots or restricted sources
    if (leads.length < job.requestedCount && !signal.aborted) {
      try {
        const groundingLeads = await searchForeignLeadsWithGrounding({
          collection: job.collection,
          sources: selectedSources,
          categoryFocus: job.categoryFocus,
          limit: job.requestedCount - leads.length,
          signal,
        });
        for (const g of groundingLeads) {
          const norm = normalizeSourceUrl(g.url);
          if (!norm || existingUrls.has(norm)) continue;
          existingUrls.add(norm);
          const srcObj = selectedSources.find((s) => s.id === g.sourceId) || selectedSources[0];
          leads.push({
            url: g.url,
            title: g.title,
            author: '',
            publishedAt: '',
            excerpt: g.excerpt,
            sourceId: srcObj.id,
            sourceName: srcObj.name,
            sourceType: srcObj.sourceType,
            reliability: 'verified_grounding',
          });
        }
      } catch (err) {
        const formatted = formatGeminiError(err);
        updateJob(jobId, (j) => {
          j.logs.push(`[${new Date().toISOString()}] Grounding предупреждение: ${formatted.message}`);
          if (leads.length === 0) {
            j.error = formatted.message;
          }
        });
      }
    }

    const methodUsed: ResearchJob['methodUsed'] =
      leads.some((l) => l.reliability === 'verified_direct') &&
      leads.some((l) => l.reliability === 'verified_grounding')
        ? 'hybrid'
        : leads.some((l) => l.reliability === 'verified_grounding')
          ? 'google_search_grounding'
          : 'direct_public_feed';

    updateJob(jobId, (j) => {
      j.methodUsed = methodUsed;
      j.foundCount = leads.length;
      j.logs.push(`[${new Date().toISOString()}] Найдено реальных публикаций: ${leads.length}`);
    });

    if (leads.length === 0) {
      updateJob(jobId, (j) => {
        j.status = j.error ? 'failed' : 'completed';
        j.finishedAt = new Date().toISOString();
      });
      return;
    }

    const db = loadDatabase();
    const aiConfigured = isGeminiConfigured();
    let skipRemainingAi = !aiConfigured;

    for (const lead of leads) {
      if (signal.aborted) return;

      const allResults = loadResearchResults();
      const researchId = nextResearchId(allResults, job.collection);

      const baseRecord: ResearchResult = {
        researchId,
        jobId,
        sourceId: lead.sourceId,
        sourceName: lead.sourceName,
        sourceUrl: lead.url,
        sourceTitle: lead.title,
        sourceAuthor: lead.author || 'unknown',
        sourceDate: lead.publishedAt || 'unknown',
        researchDate: new Date().toISOString(),
        sourceType: lead.sourceType,
        collection: job.collection,
        originalLanguage: job.sourceLanguage || 'en',
        sourceExcerpt: lead.excerpt,
        sourceSummary: lead.excerpt,
        mainSituation: lead.title,
        participants: 'unknown',
        relationshipType: 'unknown',
        mainConflict: '',
        positionsOfParticipants: '',
        emotionalMechanism: '',
        hiddenExpectation: '',
        unexpectedDetail: '',
        possibleTwist: '',
        readerReactionPotential: '',
        storyMechanic: '',
        keywords: [],
        researchNotes: '',
        sourceReliability: lead.reliability,
        analysisStatus: 'pending',
        originalityAssessment: '',
        queueStatus: 'research_pending',
        generatedPlot: null,
        quality: null,
        similarityMatches: [],
        duplicateFlag: false,
      };

      if (!skipRemainingAi) {
        try {
          const analyzed = await analyzeAndTransformResearchItem({
            item: baseRecord,
            depth: job.analysisDepth,
            generateIdea: job.transformMode === 'analyze_and_generate',
            signal,
          });
          Object.assign(baseRecord, analyzed.analysis);
          baseRecord.generatedPlot = analyzed.generatedPlot;
          baseRecord.quality = analyzed.quality;
          baseRecord.analysisStatus = 'completed';
          baseRecord.queueStatus = analyzed.generatedPlot ? 'awaiting_review' : 'analysis_completed';
        } catch (err) {
          const formatted = formatGeminiError(err);
          baseRecord.analysisStatus = 'failed';
          baseRecord.queueStatus = 'research_pending';
          baseRecord.researchNotes = `Ошибка ИИ-анализа: ${formatted.message}. Карточка сохранена для повторного анализа.`;
          if (isQuotaOrAuthError(err)) {
            skipRemainingAi = true;
          }
        }
      } else {
        baseRecord.analysisStatus = aiConfigured ? 'failed' : 'pending';
        baseRecord.queueStatus = 'research_pending';
        baseRecord.researchNotes = aiConfigured
          ? 'ИИ-анализ пропущен из-за исчерпания лимита AI (Gemini, GigaChat и Z.ai); материал сохранён для повторного запуска.'
          : 'ИИ-анализ отложен (не заданы GEMINI_API_KEY, GIGACHAT_AUTH_KEY или ZAI_API_KEY); материал сохранён и готов к анализу после подключения.';
      }

      // Three-contour deduplication check
      const matches = findResearchDuplicates(
        baseRecord,
        db.stories,
        allResults,
        db.settings.similarityThreshold
      );
      baseRecord.similarityMatches = matches;
      baseRecord.duplicateFlag = matches.length > 0;

      allResults.unshift(baseRecord);
      saveResearchResults(allResults);

      // Update source foundCount
      const updatedSources = loadResearchSources().map((s) =>
        s.id === lead.sourceId ? { ...s, foundCount: (s.foundCount || 0) + 1 } : s
      );
      saveResearchSources(updatedSources);

      updateJob(jobId, (j) => {
        j.processedCount += 1;
        if (baseRecord.analysisStatus === 'failed') j.failedCount += 1;
      });
    }

    updateJob(jobId, (j) => {
      if (j.status === 'running') {
        j.status = 'completed';
        j.finishedAt = new Date().toISOString();
        j.logs.push(`[${new Date().toISOString()}] Завершено. Обработано: ${j.processedCount}, с ошибками ИИ: ${j.failedCount}.`);
      }
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    updateJob(jobId, (j) => {
      if (j.status === 'running') {
        j.status = signal.aborted ? 'cancelled' : 'failed';
        j.finishedAt = new Date().toISOString();
        j.error = formatted.message;
      }
    });
  }
}

export async function reanalyzeResearchResult(
  researchId: string,
  generateIdea: boolean
): Promise<ResearchResult> {
  const results = loadResearchResults();
  const idx = results.findIndex((r) => r.researchId === researchId);
  if (idx === -1) {
    const err = new Error('Карточка исследования не найдена');
    (err as { status?: number }).status = 404;
    throw err;
  }

  const item = results[idx];
  const analyzed = await analyzeAndTransformResearchItem({
    item,
    depth: 'deep',
    generateIdea,
  });

  const updated: ResearchResult = {
    ...item,
    ...analyzed.analysis,
    generatedPlot: analyzed.generatedPlot ?? item.generatedPlot,
    quality: analyzed.quality,
    analysisStatus: 'completed',
    queueStatus: (analyzed.generatedPlot ?? item.generatedPlot) ? 'awaiting_review' : 'analysis_completed',
  };

  const db = loadDatabase();
  const matches = findResearchDuplicates(
    updated,
    db.stories,
    results,
    db.settings.similarityThreshold
  );
  updated.similarityMatches = matches;
  updated.duplicateFlag = matches.length > 0;

  results[idx] = updated;
  saveResearchResults(results);
  return updated;
}

export function checkDuplicateForResult(researchId: string): ResearchResult {
  const results = loadResearchResults();
  const idx = results.findIndex((r) => r.researchId === researchId);
  if (idx === -1) {
    const err = new Error('Карточка исследования не найдена');
    (err as { status?: number }).status = 404;
    throw err;
  }
  const db = loadDatabase();
  const item = results[idx];
  const matches = findResearchDuplicates(item, db.stories, results, db.settings.similarityThreshold);
  item.similarityMatches = matches;
  item.duplicateFlag = matches.length > 0;
  if (item.queueStatus === 'idea_generated') {
    item.queueStatus = 'awaiting_review';
  }
  results[idx] = item;
  saveResearchResults(results);
  return item;
}

export function approveResearchResultToDatabase(
  researchId: string,
  forceApprove = false
): { result: ResearchResult; story: StoryPlot } {
  const results = loadResearchResults();
  const idx = results.findIndex((r) => r.researchId === researchId);
  if (idx === -1) {
    const err = new Error('Карточка исследования не найдена');
    (err as { status?: number }).status = 404;
    throw err;
  }

  const item = results[idx];
  if (!item.generatedPlot) {
    const err = new Error('Сначала сформируйте русскую сюжетную заготовку перед добавлением в базу.');
    (err as { status?: number }).status = 400;
    throw err;
  }

  const db = loadDatabase();
  const matches = findResearchDuplicates(item, db.stories, results, db.settings.similarityThreshold);
  item.similarityMatches = matches;
  item.duplicateFlag = matches.length > 0;

  if (item.duplicateFlag && !forceApprove) {
    saveResearchResults(results);
    const err = new Error('Обнаружены возможные смысловые дубли. Подтвердите добавление вручную.');
    (err as { status?: number; matches?: unknown }).status = 409;
    (err as { matches?: unknown }).matches = matches;
    throw err;
  }

  createBackupSnapshot(db);
  const newId = nextStoryId(db.stories, item.collection);
  const gp = item.generatedPlot;

  const newStoryRaw: Partial<StoryPlot> = {
    id: newId,
    collection: item.collection,
    category: gp.category || 'Разные взгляды на жизнь',
    subcategory: gp.subcategory || 'Зарубежное переосмысление',
    title: gp.title,
    shortDescription: gp.shortDescription,
    fullPlot: gp.fullPlot,
    participants: gp.participants,
    setting: gp.setting,
    coreConflictOrAction: gp.coreConflictOrAction,
    sideAPosition: gp.sideAPosition,
    sideBPosition: gp.sideBPosition,
    emotionalMechanism: gp.emotionalMechanism,
    hiddenExpectation: gp.hiddenExpectation,
    unexpectedNuance: gp.unexpectedNuance,
    possibleTwist: gp.possibleTwist,
    mainTriggerQuestion: gp.mainTriggerQuestion,
    additionalQuestions: gp.additionalQuestions,
    keywords: gp.keywords,
    ideaSource: `Foreign Research: ${item.sourceName}`,
    sourceUrl: item.sourceUrl,
    originType: 'external',
    createdAt: new Date().toISOString(),
    verificationStatus: 'pending',
    usageStatus: 'unused',
    mainTheme: gp.mainTheme,
    plotMechanic: gp.plotMechanic,
    uniqueDetails: gp.uniqueDetails,
    sourceAnalysisNote: item.researchNotes || item.sourceSummary,
    researchId: item.researchId,
    researchNotes: item.researchNotes,
    batchNumber: 0,
    quality: calculateQualityScore(
      item.collection,
      item.quality?.breakdown,
      item.quality?.explanation
    ),
  };

  const story = normalizeAndScoreStory(newStoryRaw, db.stories, db.settings.similarityThreshold);
  story.semanticFingerprint = buildSemanticFingerprint(story);
  db.stories.push(story);
  saveDatabase(db);

  item.queueStatus = 'approved_for_database';
  item.approvedStoryId = story.id;
  results[idx] = item;
  saveResearchResults(results);

  return { result: item, story };
}
