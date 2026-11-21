import crypto from 'crypto';
import {
  AutonomousMonitoringSnapshot,
  AutonomousSchedulerConfig,
  CollectionType,
  GitHubWorkflowRunSummary,
  ProcessedMaterialEntry,
  PublicationItem,
  ResearchBatchRecord,
  ResearchResult,
  SchedulerRunLog,
} from '../src/shared/types.js';
import {
  buildSemanticFingerprint,
  calculateQualityScore,
  findResearchDuplicates,
  findSimilarStories,
  normalizeSourceUrl,
} from '../src/shared/similarity.js';
import {
  measurePublicationLength,
  normalizeHashtagsList,
  TELEGRAM_SAFE_CHAR_LIMIT,
  validateHashtags,
} from '../src/shared/publishingUtils.js';
import { loadDatabase, saveDatabase } from './storage.js';
import {
  loadResearchJobs,
  loadResearchResults,
  loadResearchSources,
  nextResearchId,
  recoverInterruptedResearchJobs,
  saveResearchJobs,
  saveResearchResults,
  saveResearchSources,
} from './researchStorage.js';
import {
  checkResearchSourceAvailability,
  DiscoveredPublicArticle,
  fetchPublicArticlesFromSource,
} from './researchSources.js';
import {
  analyzeAndTransformResearchItem,
  searchForeignLeadsWithGrounding,
} from './researchAnalyzer.js';
import { approveResearchResultToDatabase } from './researchEngine.js';
import { loadContentDrafts, recoverInterruptedDrafts } from './contentStorage.js';
import { generatePublicationsFromStory } from './contentGenerator.js';
import { shortenForTelegramLimit, suggestHashtagsForPublication } from './studioAiAssistant.js';
import {
  appendPublishingLog,
  enrichPublicationMetrics,
  loadPublications,
  loadPublishingSettings,
  nextPublicationId,
  recoverInterruptedPublications,
  savePublications,
} from './publishingStorage.js';
import {
  dispatchPublicationToTelegram,
  validateBeforeTelegramSend,
} from './telegramPublisher.js';
import {
  formatGeminiError,
  isGeminiConfigured,
  isQuotaOrAuthError,
} from './geminiClient.js';
import {
  computeRegistryStats,
  getTodayUtcDate,
  loadAutonomousState,
  loadProcessedRegistry,
  nextRegistryId,
  recoverAutonomousState,
  saveAutonomousState,
  saveProcessedRegistry,
} from './autonomousStorage.js';

let cycleLock = false;

export function isAutonomousCycleRunning(): boolean {
  return cycleLock;
}

export function normalizeMaterialTitle(title: string): string {
  return (title || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildMaterialContentFingerprint(
  title: string,
  excerpt: string,
  url: string
): string {
  const semantic = buildSemanticFingerprint({ title, shortDescription: excerpt });
  const digest = crypto
    .createHash('sha1')
    .update(`${normalizeMaterialTitle(title)}|${normalizeSourceUrl(url)}|${semantic}`)
    .digest('hex')
    .slice(0, 16);
  return `${semantic.slice(0, 48)}:${digest}`;
}

export function checkMaterialDuplicate(candidate: {
  url: string;
  title: string;
  excerpt: string;
  collection: CollectionType;
}): { isDuplicate: boolean; reason?: string; matchedId?: string } {
  const registry = loadProcessedRegistry();
  const results = loadResearchResults();
  const db = loadDatabase();

  const normUrl = normalizeSourceUrl(candidate.url);
  const normTitle = normalizeMaterialTitle(candidate.title);
  const fp = buildMaterialContentFingerprint(candidate.title, candidate.excerpt, candidate.url);

  for (const entry of registry) {
    if (candidate.url && entry.url === candidate.url) {
      return { isDuplicate: true, reason: `Совпадение URL в реестре (${entry.id})`, matchedId: entry.id };
    }
    if (normUrl && entry.normalizedUrl === normUrl) {
      return { isDuplicate: true, reason: `Совпадение нормализованного URL (${entry.id})`, matchedId: entry.id };
    }
    if (normTitle && normTitle.length >= 14 && entry.normalizedTitle === normTitle) {
      return { isDuplicate: true, reason: `Совпадение заголовка в реестре (${entry.id})`, matchedId: entry.id };
    }
    if (fp && entry.contentFingerprint === fp) {
      return { isDuplicate: true, reason: `Совпадение fingerprint (${entry.id})`, matchedId: entry.id };
    }
  }

  for (const r of results) {
    if (normUrl && normalizeSourceUrl(r.sourceUrl) === normUrl) {
      return { isDuplicate: true, reason: `URL уже в архиве исследований (${r.researchId})`, matchedId: r.researchId };
    }
    if (normTitle && normTitle.length >= 14 && normalizeMaterialTitle(r.sourceTitle) === normTitle) {
      return { isDuplicate: true, reason: `Заголовок уже в архиве исследований (${r.researchId})`, matchedId: r.researchId };
    }
  }

  for (const s of db.stories) {
    if (normUrl && s.sourceUrl && normalizeSourceUrl(s.sourceUrl) === normUrl) {
      return { isDuplicate: true, reason: `URL уже в STORY DATABASE (${s.id})`, matchedId: s.id };
    }
    if (normTitle && normTitle.length >= 14 && normalizeMaterialTitle(s.title) === normTitle) {
      return { isDuplicate: true, reason: `Заголовок уже в STORY DATABASE (${s.id})`, matchedId: s.id };
    }
  }

  const pseudoResearch: ResearchResult = {
    researchId: 'CANDIDATE-CHECK',
    jobId: 'AUTO',
    sourceId: 'AUTO',
    sourceName: 'Auto',
    sourceUrl: candidate.url,
    sourceTitle: candidate.title,
    sourceAuthor: 'unknown',
    sourceDate: 'unknown',
    researchDate: new Date().toISOString(),
    sourceType: 'media',
    collection: candidate.collection,
    originalLanguage: 'en',
    sourceExcerpt: candidate.excerpt,
    sourceSummary: candidate.excerpt,
    mainSituation: candidate.title,
    participants: '',
    relationshipType: '',
    mainConflict: candidate.excerpt,
    positionsOfParticipants: '',
    emotionalMechanism: '',
    hiddenExpectation: '',
    unexpectedDetail: '',
    possibleTwist: '',
    readerReactionPotential: '',
    storyMechanic: '',
    keywords: [],
    researchNotes: '',
    sourceReliability: 'verified_direct',
    analysisStatus: 'pending',
    originalityAssessment: '',
    queueStatus: 'research_pending',
    generatedPlot: null,
    quality: null,
    similarityMatches: [],
    duplicateFlag: false,
  };

  const semanticMatches = findResearchDuplicates(
    pseudoResearch,
    db.stories,
    results,
    db.settings.similarityThreshold
  );
  if (semanticMatches.length > 0) {
    return {
      isDuplicate: true,
      reason: `Семантическое сходство ${semanticMatches[0].score}% с ${semanticMatches[0].storyId}`,
      matchedId: semanticMatches[0].storyId,
    };
  }

  const directMatches = findSimilarStories(
    { title: candidate.title, shortDescription: candidate.excerpt, fullPlot: candidate.excerpt },
    db.stories,
    db.settings.similarityThreshold
  );
  if (directMatches.length > 0) {
    return {
      isDuplicate: true,
      reason: `Сходство ${directMatches[0].score}% с ${directMatches[0].storyId}`,
      matchedId: directMatches[0].storyId,
    };
  }

  return { isDuplicate: false };
}

async function withGeminiRetry<T>(
  fn: () => Promise<T>,
  options?: { maxRetries?: number; retryDelayMs?: number }
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 2;
  const baseDelay = options?.retryDelayMs ?? 1200;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const formatted = formatGeminiError(err);
      if (formatted.code === 'API_KEY_MISSING' || formatted.code === 'PERMISSION_DENIED') {
        throw formatted;
      }
      const isRetryable =
        formatted.status === 429 ||
        formatted.status === 503 ||
        formatted.status === 504;
      if (!isRetryable || attempt === maxRetries) {
        throw formatted;
      }
      await new Promise((r) => setTimeout(r, baseDelay * (attempt + 1)));
    }
  }
  throw formatGeminiError(lastErr);
}

function chooseNextCollection(
  config: AutonomousSchedulerConfig,
  lastCollection?: CollectionType
): CollectionType {
  if (config.collectionsRotation === 'debate') return 'debate';
  if (config.collectionsRotation === 'romantic') return 'romantic';
  return lastCollection === 'debate' ? 'romantic' : 'debate';
}

function nextBatchId(batches: ResearchBatchRecord[]): string {
  let maxNum = 0;
  for (const b of batches) {
    if (b.batchId.startsWith('RBATCH-')) {
      const n = parseInt(b.batchId.slice(7), 10);
      if (!Number.isNaN(n) && n > maxNum) maxNum = n;
    }
  }
  return `RBATCH-${String(maxNum + 1).padStart(4, '0')}`;
}

export interface ResearchCycleDeps {
  fetchLeadsFn?: (params: {
    collection: CollectionType;
    limit: number;
  }) => Promise<DiscoveredPublicArticle[]>;
  analyzeFn?: typeof analyzeAndTransformResearchItem;
  retryDelayMs?: number;
}

export async function runAutonomousResearchCycle(options?: {
  mode?: 'github_actions' | 'manual' | 'server';
  collectionOverride?: CollectionType;
  ignoreStopFlag?: boolean;
  deps?: ResearchCycleDeps;
}): Promise<SchedulerRunLog> {
  const startedAt = new Date().toISOString();
  const mode = options?.mode || 'manual';
  const state = loadAutonomousState();

  if (state.config.stopRequested && !options?.ignoreStopFlag) {
    return {
      runId: `RUN-${Date.now().toString(36).toUpperCase()}`,
      kind: 'research',
      mode,
      startedAt,
      finishedAt: startedAt,
      ok: true,
      discovered: 0,
      uniqueAdded: 0,
      duplicates: 0,
      analyzed: 0,
      pendingAnalysis: computeRegistryStats().pendingAnalysisCount,
      storiesApproved: 0,
      publicationsCreated: 0,
      publishedToTelegram: 0,
      summary: 'Исследование остановлено флагом безопасной остановки (stopRequested=true).',
    };
  }

  if (!state.config.researchEnabled && mode !== 'manual') {
    return {
      runId: `RUN-${Date.now().toString(36).toUpperCase()}`,
      kind: 'research',
      mode,
      startedAt,
      finishedAt: startedAt,
      ok: true,
      discovered: 0,
      uniqueAdded: 0,
      duplicates: 0,
      analyzed: 0,
      pendingAnalysis: computeRegistryStats().pendingAnalysisCount,
      storiesApproved: 0,
      publicationsCreated: 0,
      publishedToTelegram: 0,
      summary: 'Автоматический планировщик исследований выключен в настройках.',
    };
  }

  let discovered = 0;
  let uniqueAdded = 0;
  let duplicates = 0;
  let analyzed = 0;
  let storiesApproved = 0;
  let errorMsg: string | undefined;

  recoverInterruptedResearchJobs();

  let batch = state.batches.find(
    (b) => b.batchId === state.activeBatchId && b.status === 'in_progress'
  ) || state.batches.find((b) => b.status === 'in_progress');

  const collection =
    options?.collectionOverride ||
    batch?.collection ||
    chooseNextCollection(state.config, state.lastCollectionUsed);

  if (!batch) {
    batch = {
      batchId: nextBatchId(state.batches),
      collection,
      status: 'in_progress',
      targetCount: Math.max(1, Math.min(10, state.config.researchBatchSize || 4)),
      processedUrls: [],
      discoveredCount: 0,
      newUniqueCount: 0,
      duplicateCount: 0,
      analyzedCount: 0,
      pendingAnalysisCount: 0,
      failedCount: 0,
      startedAt,
    };
    state.batches.unshift(batch);
    state.activeBatchId = batch.batchId;
    saveAutonomousState(state);
  }

  const analyzeImpl = options?.deps?.analyzeFn || analyzeAndTransformResearchItem;
  const geminiReady = Boolean(options?.deps?.analyzeFn) || isGeminiConfigured();
  let skipAiThisRun = !geminiReady;

  if (!skipAiThisRun) {
    const existingResults = loadResearchResults();
    const pendingItems = existingResults.filter(
      (r) =>
        r.queueStatus === 'research_pending' &&
        (r.analysisStatus === 'pending' || r.analysisStatus === 'failed')
    );

    const retryLimit = Math.min(pendingItems.length, Math.max(1, batch.targetCount - batch.analyzedCount));
    for (let i = 0; i < retryLimit; i++) {
      const target = pendingItems[i];
      if (skipAiThisRun) break;
      try {
        const res = await withGeminiRetry(
          () =>
            analyzeImpl({
              item: target,
              depth: 'standard',
              generateIdea: true,
            }),
          { retryDelayMs: options?.deps?.retryDelayMs }
        );

        const all = loadResearchResults();
        const idx = all.findIndex((x) => x.researchId === target.researchId);
        if (idx !== -1) {
          const updated: ResearchResult = {
            ...all[idx],
            ...res.analysis,
            generatedPlot: res.generatedPlot ?? all[idx].generatedPlot,
            quality: res.quality,
            analysisStatus: 'completed',
            queueStatus: res.generatedPlot ? 'awaiting_review' : 'analysis_completed',
          };
          const db = loadDatabase();
          const dupMatches = findResearchDuplicates(
            updated,
            db.stories,
            all,
            db.settings.similarityThreshold
          );
          updated.similarityMatches = dupMatches;
          updated.duplicateFlag = dupMatches.length > 0;
          all[idx] = updated;
          saveResearchResults(all);
          analyzed += 1;
          batch.analyzedCount += 1;

          if (updated.generatedPlot && !updated.duplicateFlag && res.quality.overall >= 75) {
            const approved = approveResearchResultToDatabase(updated.researchId, false);
            const freshDb = loadDatabase();
            const st = freshDb.stories.find((s) => s.id === approved.story.id);
            if (st) {
              st.verificationStatus = 'approved';
              saveDatabase(freshDb);
            }
            storiesApproved += 1;
            const reg = loadProcessedRegistry();
            const rEntry = reg.find((e) => e.researchId === updated.researchId);
            if (rEntry) {
              rEntry.status = 'approved';
              rEntry.storyId = approved.story.id;
              rEntry.updatedAt = new Date().toISOString();
              saveProcessedRegistry(reg);
            }
          }
        }
      } catch (err) {
        const formatted = formatGeminiError(err);
        errorMsg = formatted.message;
        const all = loadResearchResults();
        const idx = all.findIndex((x) => x.researchId === target.researchId);
        if (idx !== -1) {
          all[idx].analysisStatus = formatted.code === 'API_KEY_MISSING' ? 'pending' : 'failed';
          all[idx].queueStatus = 'research_pending';
          all[idx].researchNotes = `Ожидает анализа: ${formatted.message}`;
          saveResearchResults(all);
        }
        if (isQuotaOrAuthError(err) || formatted.code === 'API_KEY_MISSING') {
          skipAiThisRun = true;
        }
      }
    }
  }

  const remainingSlots = Math.max(0, batch.targetCount - batch.newUniqueCount);
  let leads: DiscoveredPublicArticle[] = [];

  if (remainingSlots > 0) {
    if (options?.deps?.fetchLeadsFn) {
      leads = await options.deps.fetchLeadsFn({ collection: batch.collection, limit: remainingSlots * 2 });
    } else {
      let sources = loadResearchSources();
      const enabled = sources.filter(
        (s) => s.enabled && (s.defaultCollection === 'both' || s.defaultCollection === batch!.collection)
      );
      for (let i = 0; i < enabled.length; i++) {
        if (enabled[i].status === 'unchecked') {
          const checked = await checkResearchSourceAvailability(enabled[i]);
          enabled[i] = checked;
          sources = sources.map((s) => (s.id === checked.id ? checked : s));
          saveResearchSources(sources);
        }
      }
      for (const src of enabled.filter((s) => s.status === 'available')) {
        try {
          const items = await fetchPublicArticlesFromSource(src, remainingSlots * 2);
          leads.push(...items);
        } catch {
          // Ignore single source fetch failure
        }
      }
      if (leads.length < remainingSlots && isGeminiConfigured()) {
        try {
          const gLeads = await searchForeignLeadsWithGrounding({
            collection: batch.collection,
            sources: enabled,
            categoryFocus: 'balanced',
            limit: remainingSlots - leads.length,
          });
          for (const g of gLeads) {
            leads.push({
              url: g.url,
              title: g.title,
              author: '',
              publishedAt: '',
              excerpt: g.excerpt,
              sourceId: g.sourceId,
              sourceName: g.sourceName,
            });
          }
        } catch (err) {
          errorMsg = formatGeminiError(err).message;
        }
      }
    }
  }

  const seenThisRun = new Set<string>();
  const jobRecords = loadResearchJobs();
  const jobId = `JOB-AUTO-${Date.now().toString(36).toUpperCase()}`;
  const autoJob = {
    id: jobId,
    collection: batch.collection,
    sourceIds: Array.from(new Set(leads.map((l) => l.sourceId))),
    categoryFocus: 'balanced',
    sourceLanguage: 'en',
    requestedCount: batch.targetCount,
    analysisDepth: 'standard' as const,
    transformMode: 'analyze_and_generate' as const,
    status: 'running' as const,
    methodUsed: 'direct_public_feed' as const,
    processedCount: 0,
    foundCount: 0,
    failedCount: 0,
    startedAt,
    logs: [`[${startedAt}] Автозапуск ${mode} (${batch.batchId}, ${batch.collection})`],
  };
  jobRecords.unshift(autoJob);
  saveResearchJobs(jobRecords.slice(0, 60));

  for (const lead of leads) {
    if (batch.newUniqueCount >= batch.targetCount) break;
    const normUrl = normalizeSourceUrl(lead.url);
    if (!normUrl || seenThisRun.has(normUrl) || batch.processedUrls.includes(normUrl)) {
      continue;
    }
    seenThisRun.add(normUrl);
    discovered += 1;
    batch.discoveredCount += 1;
    batch.processedUrls.push(normUrl);

    const dup = checkMaterialDuplicate({
      url: lead.url,
      title: lead.title,
      excerpt: lead.excerpt,
      collection: batch.collection,
    });

    const now = new Date().toISOString();
    const registry = loadProcessedRegistry();

    if (dup.isDuplicate) {
      duplicates += 1;
      batch.duplicateCount += 1;
      registry.unshift({
        id: nextRegistryId(registry),
        url: lead.url,
        normalizedUrl: normUrl,
        sourceId: lead.sourceId,
        sourceName: lead.sourceName,
        title: lead.title,
        normalizedTitle: normalizeMaterialTitle(lead.title),
        collection: batch.collection,
        publishedAt: lead.publishedAt || undefined,
        discoveredAt: now,
        contentFingerprint: buildMaterialContentFingerprint(lead.title, lead.excerpt, lead.url),
        status: 'duplicate',
        batchId: batch.batchId,
        error: dup.reason,
        updatedAt: now,
      });
      saveProcessedRegistry(registry);
      continue;
    }

    uniqueAdded += 1;
    batch.newUniqueCount += 1;
    const allResults = loadResearchResults();
    const researchId = nextResearchId(allResults, batch.collection);

    const baseResult: ResearchResult = {
      researchId,
      jobId,
      sourceId: lead.sourceId,
      sourceName: lead.sourceName,
      sourceUrl: lead.url,
      sourceTitle: lead.title,
      sourceAuthor: lead.author || 'unknown',
      sourceDate: lead.publishedAt || 'unknown',
      researchDate: now,
      sourceType: 'media',
      collection: batch.collection,
      originalLanguage: 'en',
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
      sourceReliability: 'verified_direct',
      analysisStatus: 'pending',
      originalityAssessment: '',
      queueStatus: 'research_pending',
      generatedPlot: null,
      quality: null,
      similarityMatches: [],
      duplicateFlag: false,
    };

    const regEntry: ProcessedMaterialEntry = {
      id: nextRegistryId(registry),
      url: lead.url,
      normalizedUrl: normUrl,
      sourceId: lead.sourceId,
      sourceName: lead.sourceName,
      title: lead.title,
      normalizedTitle: normalizeMaterialTitle(lead.title),
      collection: batch.collection,
      publishedAt: lead.publishedAt || undefined,
      discoveredAt: now,
      contentFingerprint: buildMaterialContentFingerprint(lead.title, lead.excerpt, lead.url),
      status: 'discovered',
      batchId: batch.batchId,
      researchId,
      updatedAt: now,
    };

    allResults.unshift(baseResult);
    saveResearchResults(allResults);
    registry.unshift(regEntry);
    saveProcessedRegistry(registry);

    if (!skipAiThisRun) {
      try {
        const res = await withGeminiRetry(
          () =>
            analyzeImpl({
              item: baseResult,
              depth: 'standard',
              generateIdea: true,
            }),
          { retryDelayMs: options?.deps?.retryDelayMs }
        );

        const freshResults = loadResearchResults();
        const rIdx = freshResults.findIndex((r) => r.researchId === researchId);
        if (rIdx !== -1) {
          Object.assign(freshResults[rIdx], res.analysis);
          freshResults[rIdx].generatedPlot = res.generatedPlot;
          freshResults[rIdx].quality = res.quality;
          freshResults[rIdx].analysisStatus = 'completed';
          freshResults[rIdx].queueStatus = res.generatedPlot
            ? 'awaiting_review'
            : 'analysis_completed';

          const db = loadDatabase();
          const postMatches = findResearchDuplicates(
            freshResults[rIdx],
            db.stories,
            freshResults,
            db.settings.similarityThreshold
          );
          freshResults[rIdx].similarityMatches = postMatches;
          freshResults[rIdx].duplicateFlag = postMatches.length > 0;
          saveResearchResults(freshResults);
          analyzed += 1;
          batch.analyzedCount += 1;

          if (
            freshResults[rIdx].generatedPlot &&
            !freshResults[rIdx].duplicateFlag &&
            res.quality.overall >= 75
          ) {
            const approved = approveResearchResultToDatabase(researchId, false);
            const freshDb = loadDatabase();
            const st = freshDb.stories.find((s) => s.id === approved.story.id);
            if (st) {
              st.verificationStatus = 'approved';
              saveDatabase(freshDb);
            }
            storiesApproved += 1;
            const freshReg = loadProcessedRegistry();
            const regTarget = freshReg.find((e) => e.id === regEntry.id);
            if (regTarget) {
              regTarget.status = 'approved';
              regTarget.storyId = approved.story.id;
              regTarget.updatedAt = new Date().toISOString();
              saveProcessedRegistry(freshReg);
            }
          } else if (freshResults[rIdx].duplicateFlag) {
            const freshReg = loadProcessedRegistry();
            const regTarget = freshReg.find((e) => e.id === regEntry.id);
            if (regTarget) {
              regTarget.status = 'duplicate';
              regTarget.error = 'Обнаружен смысловой дубль после анализа';
              regTarget.updatedAt = new Date().toISOString();
              saveProcessedRegistry(freshReg);
            }
          }
        }
      } catch (err) {
        const formatted = formatGeminiError(err);
        errorMsg = formatted.message;
        batch.failedCount += 1;
        const freshResults = loadResearchResults();
        const rIdx = freshResults.findIndex((r) => r.researchId === researchId);
        if (rIdx !== -1) {
          freshResults[rIdx].analysisStatus = formatted.code === 'API_KEY_MISSING' ? 'pending' : 'failed';
          freshResults[rIdx].queueStatus = 'research_pending';
          freshResults[rIdx].researchNotes = `Ожидает анализа: ${formatted.message}`;
          saveResearchResults(freshResults);
        }
        if (isQuotaOrAuthError(err) || formatted.code === 'API_KEY_MISSING') {
          skipAiThisRun = true;
        }
      }
    }
  }

  const finishedAt = new Date().toISOString();
  const jobsAfter = loadResearchJobs();
  const jIdx = jobsAfter.findIndex((j) => j.id === jobId);
  if (jIdx !== -1) {
    jobsAfter[jIdx].status = 'completed';
    jobsAfter[jIdx].foundCount = uniqueAdded;
    jobsAfter[jIdx].processedCount = discovered;
    jobsAfter[jIdx].failedCount = batch.failedCount;
    jobsAfter[jIdx].finishedAt = finishedAt;
    jobsAfter[jIdx].logs.push(
      `[${finishedAt}] Новых: ${uniqueAdded}, дубликатов: ${duplicates}, проанализировано: ${analyzed}, в базу: ${storiesApproved}.`
    );
    saveResearchJobs(jobsAfter);
  }

  const pendingStats = computeRegistryStats();
  batch.pendingAnalysisCount = pendingStats.pendingAnalysisCount;
  if (batch.newUniqueCount >= batch.targetCount || uniqueAdded === 0) {
    batch.status = 'completed';
    batch.finishedAt = finishedAt;
    state.activeBatchId = undefined;
  }
  if (errorMsg) batch.lastError = errorMsg;

  state.lastCollectionUsed = batch.collection;
  state.lastResearchRunAt = finishedAt;
  state.nextScheduledResearchAt = new Date(
    Date.now() + Math.max(1, state.config.researchIntervalHours) * 3600_000
  ).toISOString();
  state.lastResearchError = errorMsg;
  state.totalDiscoveredMaterials += discovered;
  state.totalUniqueStoriesSaved += storiesApproved;

  const summary =
    uniqueAdded === 0 && pendingStats.pendingAnalysisCount === 0
      ? `Новых материалов не обнаружено (проверено кандидатов: ${discovered}, дубликатов: ${duplicates}). Партия ${batch.batchId} закрыта без ошибок.`
      : `Партия ${batch.batchId} (${batch.collection}): найдено ${discovered}, новых ${uniqueAdded}, дубликатов ${duplicates}, проанализировано ${analyzed}, в базу сюжетов ${storiesApproved}.`;

  const runLog: SchedulerRunLog = {
    runId: `RUN-${Date.now().toString(36).toUpperCase()}`,
    kind: 'research',
    mode,
    startedAt,
    finishedAt,
    ok: !errorMsg || uniqueAdded > 0 || discovered === 0,
    discovered,
    uniqueAdded,
    duplicates,
    analyzed,
    pendingAnalysis: pendingStats.pendingAnalysisCount,
    storiesApproved,
    publicationsCreated: 0,
    publishedToTelegram: 0,
    summary,
    error: errorMsg,
  };
  state.runHistory.unshift(runLog);
  saveAutonomousState(state);

  return runLog;
}

export interface ProductionCycleDeps {
  generateDraftsFn?: typeof generatePublicationsFromStory;
  suggestHashtagsFn?: typeof suggestHashtagsForPublication;
  shortenFn?: typeof shortenForTelegramLimit;
}

export async function runAutonomousProductionCycle(options?: {
  mode?: 'github_actions' | 'manual' | 'server';
  ignoreStopFlag?: boolean;
  deps?: ProductionCycleDeps;
}): Promise<SchedulerRunLog> {
  const startedAt = new Date().toISOString();
  const mode = options?.mode || 'manual';
  const state = loadAutonomousState();

  if (state.config.stopRequested && !options?.ignoreStopFlag) {
    return {
      runId: `RUN-${Date.now().toString(36).toUpperCase()}`,
      kind: 'production',
      mode,
      startedAt,
      finishedAt: startedAt,
      ok: true,
      discovered: 0,
      uniqueAdded: 0,
      duplicates: 0,
      analyzed: 0,
      pendingAnalysis: computeRegistryStats().pendingAnalysisCount,
      storiesApproved: 0,
      publicationsCreated: 0,
      publishedToTelegram: 0,
      summary: 'Производство публикаций остановлено флагом безопасной остановки.',
    };
  }

  const genFn = options?.deps?.generateDraftsFn || generatePublicationsFromStory;
  const hashtagsFn = options?.deps?.suggestHashtagsFn || suggestHashtagsForPublication;
  const shortenFn = options?.deps?.shortenFn || shortenForTelegramLimit;

  if (!options?.deps?.generateDraftsFn && !isGeminiConfigured()) {
    const finishedAt = new Date().toISOString();
    const log: SchedulerRunLog = {
      runId: `RUN-${Date.now().toString(36).toUpperCase()}`,
      kind: 'production',
      mode,
      startedAt,
      finishedAt,
      ok: true,
      discovered: 0,
      uniqueAdded: 0,
      duplicates: 0,
      analyzed: 0,
      pendingAnalysis: computeRegistryStats().pendingAnalysisCount,
      storiesApproved: 0,
      publicationsCreated: 0,
      publishedToTelegram: 0,
      summary: 'Автогенерация публикаций пропущена: не задан токен GitHub Models (GPT-4o).',
    };
    state.lastProductionRunAt = finishedAt;
    state.runHistory.unshift(log);
    saveAutonomousState(state);
    return log;
  }

  const db = loadDatabase();
  const existingDrafts = loadContentDrafts();
  const existingPubs = loadPublications();
  const draftedStoryIds = new Set(existingDrafts.map((d) => d.sourceStoryId));
  const pubStoryIds = new Set(existingPubs.map((p) => p.sourceStoryId));

  const eligible = db.stories.filter(
    (s) =>
      s.verificationStatus === 'approved' &&
      s.usageStatus === 'unused' &&
      !draftedStoryIds.has(s.id) &&
      !pubStoryIds.has(s.id)
  );

  const debateQueue = eligible.filter((s) => s.collection === 'debate');
  const romanticQueue = eligible.filter((s) => s.collection === 'romantic');
  const picked: typeof eligible = [];
  const limit = Math.max(1, Math.min(5, state.config.productionBatchSize || 2));

  while (picked.length < limit && (debateQueue.length > 0 || romanticQueue.length > 0)) {
    const preferRomantic =
      state.config.collectionsRotation === 'romantic' ||
      (state.config.collectionsRotation === 'alternate' && picked.length % 2 === 1);
    const next = preferRomantic
      ? romanticQueue.shift() || debateQueue.shift()
      : debateQueue.shift() || romanticQueue.shift();
    if (next) picked.push(next);
  }

  let publicationsCreated = 0;
  let errorMsg: string | undefined;
  const settings = loadPublishingSettings();

  for (const story of picked) {
    const nowReg = new Date().toISOString();
    const registry = loadProcessedRegistry();
    let regEntry = registry.find((e) => e.storyId === story.id);
    if (!regEntry) {
      regEntry = {
        id: nextRegistryId(registry),
        url: story.sourceUrl || `story://${story.id}`,
        normalizedUrl: normalizeSourceUrl(story.sourceUrl || `story://${story.id}`),
        sourceId: story.researchId || 'STORY_DB',
        sourceName: story.ideaSource,
        title: story.title,
        normalizedTitle: normalizeMaterialTitle(story.title),
        collection: story.collection,
        discoveredAt: story.createdAt,
        contentFingerprint: story.semanticFingerprint,
        status: 'generating',
        researchId: story.researchId,
        storyId: story.id,
        updatedAt: nowReg,
      };
      registry.unshift(regEntry);
    } else {
      regEntry.status = 'generating';
      regEntry.updatedAt = nowReg;
    }
    saveProcessedRegistry(registry);

    try {
      const generated = await withGeminiRetry(() =>
        genFn({
          sourceStoryId: story.id,
          lengthPreset: 'standard',
          variantsCount: 1,
        })
      );

      const draft = generated[0];
      if (!draft) continue;

      const regAfterGen = loadProcessedRegistry();
      const rIdx = regAfterGen.findIndex((e) => e.id === regEntry!.id);
      if (rIdx !== -1) {
        regAfterGen[rIdx].status = 'quality_check';
        regAfterGen[rIdx].contentId = draft.contentId;
        regAfterGen[rIdx].updatedAt = new Date().toISOString();
        saveProcessedRegistry(regAfterGen);
      }

      const pubs = loadPublications();
      const pubId = nextPublicationId(pubs, story.collection);
      const fallbackTags = normalizeHashtagsList([
        ...story.keywords,
        story.collection === 'debate' ? '#кто_здесь_прав' : '#романтика_рядом',
        '#отношения_melo',
      ]).slice(0, 5);

      let pubItem: PublicationItem = enrichPublicationMetrics(
        {
          publicationId: pubId,
          sourceDraftId: draft.contentId,
          sourceStoryId: story.id,
          researchId: story.researchId,
          sourceUrl: story.sourceUrl || undefined,
          collection: story.collection,
          category: story.category,
          subcategory: story.subcategory,
          title: draft.title,
          alternativeTitles: [],
          teaser: draft.subtitle || story.shortDescription,
          body: draft.body,
          closingQuestion: draft.triggerQuestion || story.mainTriggerQuestion,
          hashtags: fallbackTags.length >= 3 ? fallbackTags : ['#отношения', '#психология_пары', '#melo_love'],
          hasImageAttachment: false,
          totalChars: 0,
          remainingChars: settings.safeTelegramCharLimit,
          exceedsTelegramLimit: false,
          firstSentenceLength: 0,
          seoNotes: 'Подготовлено автономным планировщиком MELO_LOVE',
          seoKeywords: story.keywords.slice(0, 5),
          editorialChecks: {
            spellingOk: true,
            noRepetitionOk: true,
            logicOk: true,
            meloStyleOk: true,
            headlineOk: true,
            hashtagsOk: true,
            notes: [],
          },
          status: 'draft',
          idempotencyKey: `${pubId}-${story.id}`,
          revisionHistory: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        settings.safeTelegramCharLimit
      );

      if (options?.deps?.suggestHashtagsFn || isGeminiConfigured()) {
        try {
          const aiTags = await hashtagsFn(pubItem);
          const tagCheck = validateHashtags(aiTags, pubItem.body);
          if (tagCheck.normalized.length >= 3) {
            pubItem = enrichPublicationMetrics(
              { ...pubItem, hashtags: tagCheck.normalized.slice(0, 5) },
              settings.safeTelegramCharLimit
            );
          }
        } catch {
          // Keep normalized keyword fallback tags
        }
      }

      if (pubItem.exceedsTelegramLimit && (options?.deps?.shortenFn || isGeminiConfigured())) {
        try {
          const shortened = await shortenFn(pubItem);
          pubItem = enrichPublicationMetrics(
            { ...pubItem, body: shortened.shortenedBody },
            settings.safeTelegramCharLimit
          );
        } catch {
          // Keep draft status if still > 3800
        }
      }

      const length = measurePublicationLength(pubItem);
      const passedQuality =
        draft.quality.passedThreshold &&
        !length.exceedsSafeLimit &&
        pubItem.editorialChecks.headlineOk &&
        pubItem.editorialChecks.hashtagsOk;

      pubItem.status = passedQuality ? 'ready' : 'draft';
      pubs.unshift(pubItem);
      savePublications(pubs);
      appendPublishingLog({
        publicationId: pubId,
        action: 'autonomous_created',
        status: pubItem.status,
        detail: `Создана публикация по сюжету ${story.id} (${length.totalChars}/${TELEGRAM_SAFE_CHAR_LIMIT} симв., качество ${draft.quality.overall}/100).`,
      });
      publicationsCreated += 1;

      const regDone = loadProcessedRegistry();
      const rdIdx = regDone.findIndex((e) => e.id === regEntry!.id);
      if (rdIdx !== -1) {
        regDone[rdIdx].status = passedQuality ? 'ready' : 'generated';
        regDone[rdIdx].publicationId = pubId;
        regDone[rdIdx].contentId = draft.contentId;
        regDone[rdIdx].updatedAt = new Date().toISOString();
        saveProcessedRegistry(regDone);
      }
    } catch (err) {
      errorMsg = formatGeminiError(err).message;
      const regErr = loadProcessedRegistry();
      const reIdx = regErr.findIndex((e) => e.id === regEntry!.id);
      if (reIdx !== -1) {
        regErr[reIdx].status = 'failed';
        regErr[reIdx].error = errorMsg;
        regErr[reIdx].updatedAt = new Date().toISOString();
        saveProcessedRegistry(regErr);
      }
    }
  }

  const finishedAt = new Date().toISOString();
  state.lastProductionRunAt = finishedAt;
  state.lastProductionError = errorMsg;
  state.totalPublicationsCreated += publicationsCreated;

  const log: SchedulerRunLog = {
    runId: `RUN-${Date.now().toString(36).toUpperCase()}`,
    kind: 'production',
    mode,
    startedAt,
    finishedAt,
    ok: !errorMsg || publicationsCreated > 0,
    discovered: 0,
    uniqueAdded: 0,
    duplicates: 0,
    analyzed: 0,
    pendingAnalysis: computeRegistryStats().pendingAnalysisCount,
    storiesApproved: 0,
    publicationsCreated,
    publishedToTelegram: 0,
    summary:
      picked.length === 0
        ? 'Нет свободных подтверждённых сюжетов для новой генерации.'
        : `Обработано сюжетов: ${picked.length}, создано публикаций: ${publicationsCreated}.`,
    error: errorMsg,
  };
  state.runHistory.unshift(log);
  saveAutonomousState(state);

  return log;
}

export async function runAutonomousPublishingCycle(options?: {
  mode?: 'github_actions' | 'manual' | 'server';
  dryRunOverride?: boolean;
  ignoreStopFlag?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<SchedulerRunLog> {
  const startedAt = new Date().toISOString();
  const mode = options?.mode || 'manual';
  const state = loadAutonomousState();
  const settings = loadPublishingSettings();

  const today = getTodayUtcDate();
  if (state.publishedTodayDate !== today) {
    state.publishedTodayDate = today;
    state.publishedTodayCount = 0;
  }

  if (state.config.stopRequested && !options?.ignoreStopFlag) {
    return {
      runId: `RUN-${Date.now().toString(36).toUpperCase()}`,
      kind: 'publish',
      mode,
      startedAt,
      finishedAt: startedAt,
      ok: true,
      discovered: 0,
      uniqueAdded: 0,
      duplicates: 0,
      analyzed: 0,
      pendingAnalysis: computeRegistryStats().pendingAnalysisCount,
      storiesApproved: 0,
      publicationsCreated: 0,
      publishedToTelegram: 0,
      summary: 'Публикация приостановлена флагом безопасной остановки.',
    };
  }

  const envAutoSend = process.env.TELEGRAM_AUTO_SEND_ENABLED?.trim();
  const rawBotToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
  const botToken = rawBotToken === 'MY_TELEGRAM_BOT_TOKEN' ? '' : rawBotToken;
  const rawChannel =
    process.env.TELEGRAM_CHANNEL_ID?.trim() || settings.telegramChannelRef?.trim() || '';
  const channelId = rawChannel === 'MY_TELEGRAM_CHANNEL_ID' ? '' : rawChannel;
  const hasTgCreds = Boolean(botToken && channelId);
  const isLiveAllowed =
    options?.dryRunOverride === true
      ? false
      : options?.dryRunOverride === false ||
        (hasTgCreds &&
          envAutoSend !== 'false' &&
          (envAutoSend === 'true' ||
            (state.config.autoPublishEnabled &&
              settings.autoSendEnabled &&
              !settings.dryRunMode)));

  const minIntervalMs = Math.max(1, state.config.publishMinIntervalHours) * 3600_000;
  const elapsedSinceLast = state.lastSuccessfulTelegramAt
    ? Date.now() - Date.parse(state.lastSuccessfulTelegramAt)
    : Number.POSITIVE_INFINITY;

  if (isLiveAllowed && state.publishedTodayCount >= state.config.maxPublishesPerDay) {
    const finishedAt = new Date().toISOString();
    const log: SchedulerRunLog = {
      runId: `RUN-${Date.now().toString(36).toUpperCase()}`,
      kind: 'publish',
      mode,
      startedAt,
      finishedAt,
      ok: true,
      discovered: 0,
      uniqueAdded: 0,
      duplicates: 0,
      analyzed: 0,
      pendingAnalysis: computeRegistryStats().pendingAnalysisCount,
      storiesApproved: 0,
      publicationsCreated: 0,
      publishedToTelegram: 0,
      summary: `Достигнут суточный лимит публикаций (${state.publishedTodayCount}/${state.config.maxPublishesPerDay}). Отправка отложена до следующих суток.`,
    };
    state.lastPublishRunAt = finishedAt;
    state.runHistory.unshift(log);
    saveAutonomousState(state);
    return log;
  }

  if (isLiveAllowed && elapsedSinceLast < minIntervalMs) {
    const nextIso = new Date(
      Date.parse(state.lastSuccessfulTelegramAt!) + minIntervalMs
    ).toISOString();
    state.nextScheduledPublishAt = nextIso;
    state.lastPublishRunAt = new Date().toISOString();
    const log: SchedulerRunLog = {
      runId: `RUN-${Date.now().toString(36).toUpperCase()}`,
      kind: 'publish',
      mode,
      startedAt,
      finishedAt: state.lastPublishRunAt,
      ok: true,
      discovered: 0,
      uniqueAdded: 0,
      duplicates: 0,
      analyzed: 0,
      pendingAnalysis: computeRegistryStats().pendingAnalysisCount,
      storiesApproved: 0,
      publicationsCreated: 0,
      publishedToTelegram: 0,
      summary: `Интервал ${state.config.publishMinIntervalHours} ч. ещё не выдержан. Следующее окно: ${nextIso}.`,
    };
    state.runHistory.unshift(log);
    saveAutonomousState(state);
    return log;
  }

  const pubs = loadPublications();
  const nowMs = Date.now();
  const candidates = pubs
    .filter((p) => {
      if (p.telegramMessageId) return false;
      if (p.status === 'ready') return true;
      if (p.status === 'scheduled') {
        return !p.scheduledAt || Date.parse(p.scheduledAt) <= nowMs;
      }
      return false;
    })
    .filter((p) => validateBeforeTelegramSend(p).ok)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  if (candidates.length === 0) {
    const finishedAt = new Date().toISOString();
    const log: SchedulerRunLog = {
      runId: `RUN-${Date.now().toString(36).toUpperCase()}`,
      kind: 'publish',
      mode,
      startedAt,
      finishedAt,
      ok: true,
      discovered: 0,
      uniqueAdded: 0,
      duplicates: 0,
      analyzed: 0,
      pendingAnalysis: computeRegistryStats().pendingAnalysisCount,
      storiesApproved: 0,
      publicationsCreated: 0,
      publishedToTelegram: 0,
      summary: 'В очереди нет готовых публикаций (status=ready/scheduled, <=3800 симв.).',
    };
    state.lastPublishRunAt = finishedAt;
    state.runHistory.unshift(log);
    saveAutonomousState(state);
    return log;
  }

  const target = candidates[0];

  if (!isLiveAllowed && options?.dryRunOverride !== true) {
    const finishedAt = new Date().toISOString();
    const log: SchedulerRunLog = {
      runId: `RUN-${Date.now().toString(36).toUpperCase()}`,
      kind: 'publish',
      mode,
      startedAt,
      finishedAt,
      ok: true,
      discovered: 0,
      uniqueAdded: 0,
      duplicates: 0,
      analyzed: 0,
      pendingAnalysis: computeRegistryStats().pendingAnalysisCount,
      storiesApproved: 0,
      publicationsCreated: 0,
      publishedToTelegram: 0,
      summary: !hasTgCreds
        ? `Готовых публикаций в очереди: ${candidates.length}. Telegram пока не подключён (не заданы TELEGRAM_BOT_TOKEN или канал) — отправка отложена до подключения.`
        : `Готовых публикаций в очереди: ${candidates.length}. Автопубликация в Telegram выключена в настройках.`,
    };
    state.lastPublishRunAt = finishedAt;
    state.runHistory.unshift(log);
    saveAutonomousState(state);
    return log;
  }

  let publishedCount = 0;
  let errorMsg: string | undefined;

  try {
    const regBefore = loadProcessedRegistry();
    const rIdx = regBefore.findIndex((e) => e.publicationId === target.publicationId || e.storyId === target.sourceStoryId);
    if (rIdx !== -1 && isLiveAllowed) {
      regBefore[rIdx].status = 'sending';
      regBefore[rIdx].updatedAt = new Date().toISOString();
      saveProcessedRegistry(regBefore);
    }

    const res = await dispatchPublicationToTelegram(target.publicationId, {
      dryRunOverride: !isLiveAllowed,
      fetchImpl: options?.fetchImpl,
    });

    const finishedAt = new Date().toISOString();
    if (res.mode === 'live' && res.ok) {
      publishedCount = 1;
      state.publishedTodayCount += 1;
      state.totalPublishedToTelegram += 1;
      state.lastSuccessfulTelegramAt = finishedAt;
      state.nextScheduledPublishAt = new Date(Date.now() + minIntervalMs).toISOString();
      state.lastPublishError = undefined;

      const regAfter = loadProcessedRegistry();
      const raIdx = regAfter.findIndex((e) => e.publicationId === target.publicationId || e.storyId === target.sourceStoryId);
      if (raIdx !== -1) {
        regAfter[raIdx].status = 'published_to_telegram';
        regAfter[raIdx].telegramMessageId = res.messageId;
        regAfter[raIdx].error = undefined;
        regAfter[raIdx].updatedAt = finishedAt;
        saveProcessedRegistry(regAfter);
      }
    }

    state.lastPublishRunAt = finishedAt;
    const log: SchedulerRunLog = {
      runId: `RUN-${Date.now().toString(36).toUpperCase()}`,
      kind: 'publish',
      mode,
      startedAt,
      finishedAt,
      ok: true,
      discovered: 0,
      uniqueAdded: 0,
      duplicates: 0,
      analyzed: 0,
      pendingAnalysis: computeRegistryStats().pendingAnalysisCount,
      storiesApproved: 0,
      publicationsCreated: 0,
      publishedToTelegram: publishedCount,
      summary:
        res.mode === 'dry_run'
          ? `Dry-Run проверка для ${target.publicationId} пройдена (${target.totalChars}/${TELEGRAM_SAFE_CHAR_LIMIT} симв.).`
          : `Опубликовано в Telegram: ${target.publicationId} (message_id=${res.messageId}). Ожидает подтверждения Дзена.`,
    };
    state.runHistory.unshift(log);
    saveAutonomousState(state);
    return log;
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : 'Ошибка публикации в Telegram';
    const finishedAt = new Date().toISOString();
    state.lastPublishRunAt = finishedAt;
    state.lastPublishError = errorMsg;

    const regErr = loadProcessedRegistry();
    const reIdx = regErr.findIndex((e) => e.publicationId === target.publicationId || e.storyId === target.sourceStoryId);
    if (reIdx !== -1) {
      regErr[reIdx].status = 'failed';
      regErr[reIdx].error = errorMsg;
      regErr[reIdx].updatedAt = finishedAt;
      saveProcessedRegistry(regErr);
    }

    const log: SchedulerRunLog = {
      runId: `RUN-${Date.now().toString(36).toUpperCase()}`,
      kind: 'publish',
      mode,
      startedAt,
      finishedAt,
      ok: false,
      discovered: 0,
      uniqueAdded: 0,
      duplicates: 0,
      analyzed: 0,
      pendingAnalysis: computeRegistryStats().pendingAnalysisCount,
      storiesApproved: 0,
      publicationsCreated: 0,
      publishedToTelegram: 0,
      summary: `Ошибка отправки ${target.publicationId}: ${errorMsg}`,
      error: errorMsg,
    };
    state.runHistory.unshift(log);
    saveAutonomousState(state);
    return log;
  }
}

export async function runFullAutonomousCycle(options?: {
  mode?: 'github_actions' | 'manual' | 'server';
  dryRunPublish?: boolean;
  collectionOverride?: CollectionType;
  ignoreStopFlag?: boolean;
  researchDeps?: ResearchCycleDeps;
  productionDeps?: ProductionCycleDeps;
  fetchImpl?: typeof fetch;
}): Promise<{
  research: SchedulerRunLog;
  production: SchedulerRunLog;
  publish: SchedulerRunLog;
}> {
  if (cycleLock) {
    throw Object.assign(new Error('Автономный цикл уже выполняется. Дождитесь завершения.'), {
      status: 409,
    });
  }
  cycleLock = true;
  try {
    recoverInterruptedResearchJobs();
    recoverInterruptedDrafts();
    recoverInterruptedPublications();
    recoverAutonomousState();

    const research = await runAutonomousResearchCycle({
      mode: options?.mode,
      collectionOverride: options?.collectionOverride,
      ignoreStopFlag: options?.ignoreStopFlag,
      deps: options?.researchDeps,
    });
    const production = await runAutonomousProductionCycle({
      mode: options?.mode,
      ignoreStopFlag: options?.ignoreStopFlag,
      deps: options?.productionDeps,
    });
    const publish = await runAutonomousPublishingCycle({
      mode: options?.mode,
      dryRunOverride: options?.dryRunPublish,
      ignoreStopFlag: options?.ignoreStopFlag,
      fetchImpl: options?.fetchImpl,
    });
    return { research, production, publish };
  } finally {
    cycleLock = false;
  }
}

export async function fetchRealGitHubWorkflowRuns(
  repoOverride?: string
): Promise<GitHubWorkflowRunSummary> {
  const state = loadAutonomousState();
  const repo = (repoOverride || state.config.githubRepo || process.env.GITHUB_REPOSITORY || '').trim();
  if (!repo || !repo.includes('/')) {
    return {
      configured: false,
      available: false,
      runs: [],
      note: 'Репозиторий GitHub (owner/repo) не указан в настройках планировщика — статус workflow не запрашивался.',
    };
  }

  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'MELO_LOVE-Monitor/1.0',
    };
    const token = process.env.GITHUB_TOKEN?.trim();
    if (token) headers.Authorization = `Bearer ${token}`;

    const url = `https://api.github.com/repos/${repo}/actions/workflows/melo-love-research.yml/runs?per_page=5`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      return {
        configured: true,
        repo,
        available: false,
        runs: [],
        note: `GitHub API ответил HTTP ${resp.status} (для приватных репозиториев требуется серверный GITHUB_TOKEN).`,
      };
    }
    const data = (await resp.json()) as {
      workflow_runs?: Array<{
        id: number;
        name?: string;
        status?: string;
        conclusion?: string | null;
        event?: string;
        created_at?: string;
        updated_at?: string;
        html_url?: string;
      }>;
    };
    const runs = (data.workflow_runs || []).map((r) => ({
      id: r.id,
      name: r.name || 'melo-love-research.yml',
      status: r.status || 'unknown',
      conclusion: r.conclusion ?? null,
      event: r.event || 'schedule',
      createdAt: r.created_at || '',
      updatedAt: r.updated_at || '',
      htmlUrl: r.html_url || '',
    }));

    return {
      configured: true,
      repo,
      available: true,
      runs,
      note:
        runs.length > 0
          ? `Получено запусков из GitHub Actions (${repo}): ${runs.length}.`
          : `Для репозитория ${repo} ещё не зафиксировано запусков melo-love-research.yml.`,
    };
  } catch (err) {
    return {
      configured: true,
      repo,
      available: false,
      runs: [],
      note: err instanceof Error ? err.message : 'Сбой обращения к GitHub Actions API.',
    };
  }
}

export async function buildAutonomousMonitoringSnapshot(): Promise<AutonomousMonitoringSnapshot> {
  const state = loadAutonomousState();
  const regStats = computeRegistryStats();
  const githubActions = await fetchRealGitHubWorkflowRuns();
  return {
    state,
    ...regStats,
    isCycleRunning: cycleLock,
    githubActions,
  };
}
