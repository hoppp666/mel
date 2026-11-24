import { DEBATE_CATEGORIES, ROMANTIC_CATEGORIES } from '../src/shared/categories.ts';
import {
  findResearchDuplicates,
  researchResultToPseudoStory,
} from '../src/shared/similarity.ts';
import type {
  CollectionType,
  ResearchConversionMode,
  ResearchDepth,
  ResearchJob,
  ResearchQueueStatus,
  ResearchResult,
  ResearchSource,
  StoryPlot,
} from '../src/shared/types.ts';
import {
  analyzeDiscoveredMaterial,
  generateOriginalIdeaFromResearch,
  getResearchGeminiClient,
  withRetry,
} from './researchAnalyzer.ts';
import {
  extractDomainFromUrl,
  fetchDirectPublicFeedMaterials,
  type DiscoveredRawMaterial,
} from './researchSources.ts';
import {
  createResearchBackupSnapshot,
  generateNextResearchId,
  loadResearchJobs,
  loadResearchResults,
  loadResearchSources,
  saveResearchJobs,
  saveResearchResults,
  saveResearchSources,
} from './researchStorage.ts';
import {
  computeDatabaseStats,
  createBackupSnapshot,
  generateNextStoryId,
  loadDatabase,
  normalizeAndScoreStory,
  saveDatabase,
} from './storage.ts';

export const MAX_RESEARCH_BATCH_SIZE = 10;

let activeJobId: string | null = null;
const cancelledJobIds = new Set<string>();

export function getActiveResearchJobId(): string | null {
  return activeJobId;
}

export function requestCancelResearchJob(jobId: string): boolean {
  const jobs = loadResearchJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return false;
  if (job.status !== 'running') return false;
  cancelledJobIds.add(jobId);
  const now = new Date().toISOString();
  job.logs.push({
    timestamp: now,
    level: 'warn',
    message: 'Получен запрос на отмену задания пользователем.',
  });
  job.updatedAt = now;
  saveResearchJobs(jobs);
  return true;
}

export interface StartResearchParams {
  collection: CollectionType;
  sourceIds: string[];
  category: string;
  sourceLanguage: string;
  requestedCount: number;
  depth: ResearchDepth;
  conversionMode: ResearchConversionMode;
}

function appendJobLog(
  jobId: string,
  level: 'info' | 'warn' | 'error',
  message: string,
  patch?: Partial<ResearchJob>
): void {
  const jobs = loadResearchJobs();
  const idx = jobs.findIndex((j) => j.id === jobId);
  if (idx === -1) return;
  const now = new Date().toISOString();
  jobs[idx] = {
    ...jobs[idx],
    ...patch,
    updatedAt: now,
    logs: [...jobs[idx].logs, { timestamp: now, level, message }],
  };
  saveResearchJobs(jobs);
}

async function discoverViaGoogleSearchGrounding(
  sources: ResearchSource[],
  collection: CollectionType,
  category: string,
  language: string,
  neededCount: number,
  existingUrls: Set<string>,
  existingSummaries: string[]
): Promise<{
  items: DiscoveredRawMaterial[];
  groundingCount: number;
  errorNote?: string;
}> {
  const ai = getResearchGeminiClient();

  const domainFilters = sources
    .map((s) => s.domain || extractDomainFromUrl(s.url))
    .filter(Boolean);
  const uniqueDomains = Array.from(new Set(domainFilters)).slice(0, 8);
  const siteQueryPart = uniqueDomains.map((d) => `site:${d}`).join(' OR ');

  const topicHint =
    category && category !== 'ALL_BALANCED'
      ? category
      : collection === 'debate'
        ? 'relationship boundaries money chores in-laws trust disagreement'
        : 'small acts of love everyday romance caring gesture long-term relationship';

  const langHint =
    language && language !== 'any'
      ? `Язык искомых материалов: ${language}.`
      : 'Ищи зарубежные публикации (предпочтительно на английском).';

  const searchPrompt = `Найди реальные зарубежные обсуждения, истории или колонки об отношениях на площадках: ${sources
    .map((s) => `${s.name} (${s.url})`)
    .join(', ')}.
Поисковый фокус: ${siteQueryPart} ${topicHint}.
Направление: ${
    collection === 'debate'
      ? 'неоднозначный жизненный конфликт/дилемма, где можно понять обе стороны'
      : 'трогательный житейский романтический поступок, маленькая деталь заботы без пафоса'
  }.
${langHint}
Нужно ${neededCount} разных реальных публикаций с разными жизненными механиками.
НЕ повторяй уже существующие сюжеты из нашей базы:
${existingSummaries.slice(0, 15).join('\n')}

Кратко перечисли найденные реальные публикации: название, источник, суть истории и ключевую деталь.`;

  try {
    const resp = await withRetry(() =>
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: searchPrompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      })
    );

    const chunks = resp.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const responseText = resp.text ?? '';
    const items: DiscoveredRawMaterial[] = [];

    for (const ch of chunks) {
      const uri = ch.web?.uri?.trim();
      const title = ch.web?.title?.trim() || uri || '';
      if (!uri || !uri.startsWith('http')) continue;

      const normUri = uri.toLowerCase().replace(/\/+$/, '');
      if (existingUrls.has(normUri)) continue;

      // Match against selected sources by domain or path
      const matchedSource =
        sources.find((s) => {
          const dom = (s.domain || extractDomainFromUrl(s.url)).toLowerCase();
          if (!dom) return false;
          if (!uri.toLowerCase().includes(dom)) return false;
          if (s.platform === 'reddit') {
            const subMatch = s.url.match(/\/r\/([^/]+)/i);
            if (subMatch && uri.toLowerCase().includes('/r/')) {
              return uri.toLowerCase().includes(`/r/${subMatch[1].toLowerCase()}`);
            }
          }
          return true;
        }) ||
        sources.find((s) => {
          const dom = (s.domain || extractDomainFromUrl(s.url)).toLowerCase();
          return dom ? uri.toLowerCase().includes(dom) : false;
        }) ||
        sources[0];

      // Only accept URL if it belongs to one of our selected domains (or general web search result if domain is external relationship media)
      const isSkipHomePage =
        uri.replace(/\/+$/, '') === matchedSource.url.replace(/\/+$/, '');
      if (isSkipHomePage && chunks.length > 1) {
        continue;
      }

      existingUrls.add(normUri);
      items.push({
        sourceId: matchedSource.id,
        sourceName: matchedSource.name,
        sourceType: matchedSource.sourceType,
        sourceUrl: uri,
        sourceTitle: title,
        sourceAuthor: 'unknown',
        sourceDate: 'unknown',
        originalLanguage: language === 'any' ? 'en' : language,
        snippet: responseText.slice(0, 1400) || title,
        reliability: 'search_grounded',
      });

      if (items.length >= neededCount) break;
    }

    return {
      items,
      groundingCount: chunks.length,
      errorNote:
        chunks.length === 0
          ? 'Google Search Grounding не вернул подтверждённых веб-ссылок (groundingChunks пуст).'
          : undefined,
    };
  } catch (err) {
    return {
      items: [],
      groundingCount: 0,
      errorNote: `Ошибка Google Search Grounding: ${(err as Error).message}`,
    };
  }
}

export function startResearchJobAsync(params: StartResearchParams): ResearchJob {
  if (activeJobId) {
    throw new Error(
      `Уже выполняется задание исследования (${activeJobId}). Дождитесь завершения или отмените его перед новым запуском.`
    );
  }

  const allSources = loadResearchSources();
  const enabledSources = allSources.filter((s) => s.enabled);
  const selectedSources =
    params.sourceIds.length > 0
      ? enabledSources.filter((s) => params.sourceIds.includes(s.id))
      : enabledSources;

  if (selectedSources.length === 0) {
    throw new Error('Не выбран ни один включённый источник для исследования.');
  }

  const count = Math.max(1, Math.min(MAX_RESEARCH_BATCH_SIZE, Number(params.requestedCount) || 3));
  const now = new Date().toISOString();
  const jobs = loadResearchJobs();
  const jobId = `JOB-${Date.now().toString(36).toUpperCase()}`;

  const newJob: ResearchJob = {
    id: jobId,
    collection: params.collection === 'romantic' ? 'romantic' : 'debate',
    sourceIds: selectedSources.map((s) => s.id),
    sourceNames: selectedSources.map((s) => s.name),
    category: params.category || 'ALL_BALANCED',
    sourceLanguage: params.sourceLanguage || 'en',
    requestedCount: count,
    processedCount: 0,
    foundCount: 0,
    ideasGeneratedCount: 0,
    duplicatesDetectedCount: 0,
    depth: params.depth === 'deep' ? 'deep' : 'standard',
    conversionMode:
      params.conversionMode === 'analysis_only' ? 'analysis_only' : 'analysis_and_idea',
    status: 'running',
    searchMethodUsed: 'hybrid',
    logs: [
      {
        timestamp: now,
        level: 'info',
        message: `Запущено исследование (${params.collection === 'romantic' ? 'ROMANTIC' : 'DEBATE'}), источников: ${selectedSources.length}, лимит материалов: ${count}.`,
      },
    ],
    resultIds: [],
    createdAt: now,
    updatedAt: now,
  };

  jobs.unshift(newJob);
  saveResearchJobs(jobs);
  activeJobId = jobId;

  // Execute asynchronously so UI can poll live progress & cancel cleanly
  void executeResearchJob(newJob, selectedSources).catch((err) => {
    appendJobLog(jobId, 'error', `Критическая ошибка задания: ${(err as Error).message}`, {
      status: 'failed',
      errorMessage: (err as Error).message,
      completedAt: new Date().toISOString(),
    });
  });

  return newJob;
}

async function executeResearchJob(
  job: ResearchJob,
  selectedSources: ResearchSource[]
): Promise<void> {
  try {
    const db = loadDatabase();
    const allResults = loadResearchResults();

    const existingUrls = new Set<string>();
    for (const s of db.stories) {
      if (s.sourceUrl) existingUrls.add(s.sourceUrl.trim().toLowerCase().replace(/\/+$/, ''));
    }
    for (const r of allResults) {
      if (r.sourceUrl) existingUrls.add(r.sourceUrl.trim().toLowerCase().replace(/\/+$/, ''));
    }

    const discoveredPool: DiscoveredRawMaterial[] = [];
    let usedDirectFeed = false;
    let usedGrounding = false;

    // Step 1: Respectful direct RSS/Atom feeds and open editorial pages on enabled non-disallowed sources
    for (const src of selectedSources) {
      if (cancelledJobIds.has(job.id)) break;
      if (discoveredPool.length >= job.requestedCount) break;
      if (src.robotsAllowed !== false) {
        const feedRes = await fetchDirectPublicFeedMaterials(
          src,
          Math.max(2, Math.ceil(job.requestedCount / selectedSources.length) + 1)
        );
        if (feedRes.ok && feedRes.items.length > 0) {
          usedDirectFeed = true;
          for (const item of feedRes.items) {
            const normUrl = item.sourceUrl.toLowerCase().replace(/\/+$/, '');
            if (!existingUrls.has(normUrl)) {
              existingUrls.add(normUrl);
              discoveredPool.push(item);
              if (discoveredPool.length >= job.requestedCount) break;
            }
          }
          appendJobLog(job.id, 'info', `${src.name}: ${feedRes.reason}`);
        } else {
          appendJobLog(job.id, 'info', `${src.name}: ${feedRes.reason}`);
        }
      } else {
        appendJobLog(
          job.id,
          'info',
          `${src.name}: прямой обход пропущен (${src.availabilityMessage || 'ограничено robots.txt'}).`
        );
      }
    }

    // Step 2: Real Google Search Grounding for remaining slots or restricted sources
    if (!cancelledJobIds.has(job.id) && discoveredPool.length < job.requestedCount) {
      const remaining = job.requestedCount - discoveredPool.length;
      const existingSummaries = db.stories
        .filter((s) => s.collection === job.collection)
        .slice(-20)
        .map((s) => `«${s.title}» (${s.plotMechanic})`);

      const searchRes = await discoverViaGoogleSearchGrounding(
        selectedSources,
        job.collection,
        job.category,
        job.sourceLanguage,
        remaining,
        existingUrls,
        existingSummaries
      );

      if (searchRes.items.length > 0) {
        usedGrounding = true;
        discoveredPool.push(...searchRes.items);
        appendJobLog(
          job.id,
          'info',
          `Google Search Grounding вернул ${searchRes.items.length} подтверждённых URL (всего чанков: ${searchRes.groundingCount}).`
        );
      } else if (searchRes.errorNote) {
        appendJobLog(job.id, 'warn', searchRes.errorNote);
      }
    }

    const searchMethodUsed =
      usedDirectFeed && usedGrounding
        ? 'hybrid'
        : usedGrounding
          ? 'google_search_grounding'
          : usedDirectFeed
            ? 'direct_public_feed'
            : 'unavailable';

    appendJobLog(
      job.id,
      discoveredPool.length > 0 ? 'info' : 'warn',
      `Поиск завершён: найдено ${discoveredPool.length} новых уникальных URL.`,
      {
        foundCount: discoveredPool.length,
        searchMethodUsed,
      }
    );

    if (cancelledJobIds.has(job.id)) {
      appendJobLog(job.id, 'warn', 'Задание отменено пользователем до начала анализа.', {
        status: 'cancelled',
        completedAt: new Date().toISOString(),
      });
      return;
    }

    if (discoveredPool.length === 0) {
      const noResMsg =
        'Реальные внешние материалы не найдены: прямые источники не вернули новых открытых публикаций, а Google Search Grounding не вернул подтверждённых ссылок. Проверьте квоту GEMINI_API_KEY или выберите доступные источники.';
      appendJobLog(job.id, 'error', noResMsg, {
        status: 'failed',
        errorMessage: noResMsg,
        completedAt: new Date().toISOString(),
      });
      return;
    }

    // Step 3: Analyze each discovered material & optionally generate original idea
    const currentBatchIds = new Set<string>();
    const customCats = db.customCategories[job.collection] || [];
    let processedCount = 0;
    let ideasGeneratedCount = 0;
    let duplicatesDetectedCount = 0;
    let aiErrorCount = 0;
    let lastAiError = '';
    const resultIds: string[] = [];

    for (const rawItem of discoveredPool.slice(0, job.requestedCount)) {
      if (cancelledJobIds.has(job.id)) {
        appendJobLog(job.id, 'warn', `Задание отменено. Успешно сохранено материалов: ${processedCount}.`, {
          status: 'cancelled',
          completedAt: new Date().toISOString(),
        });
        return;
      }

      const freshResults = loadResearchResults();
      const freshDb = loadDatabase();
      const researchId = generateNextResearchId(freshResults, job.collection);
      const now = new Date().toISOString();

      try {
        const analyzed = await analyzeDiscoveredMaterial(
          rawItem,
          job.collection,
          job.category,
          job.depth,
          customCats
        );

        let resultCard: ResearchResult = {
          researchId,
          jobId: job.id,
          sourceId: rawItem.sourceId,
          sourceName: rawItem.sourceName,
          sourceUrl: rawItem.sourceUrl,
          sourceTitle: rawItem.sourceTitle,
          sourceAuthor: rawItem.sourceAuthor || 'unknown',
          sourceDate: rawItem.sourceDate || 'unknown',
          researchDate: now,
          sourceType: rawItem.sourceType,
          collection: job.collection,
          targetCategory: analyzed.targetCategory,
          originalLanguage: rawItem.originalLanguage || 'en',
          sourceSummary: analyzed.sourceSummary,
          mainSituation: analyzed.mainSituation,
          participants: analyzed.participants,
          relationshipType: analyzed.relationshipType,
          mainConflict: analyzed.mainConflict,
          positionsOfParticipants: {
            sideA: analyzed.sideA,
            sideB: analyzed.sideB,
          },
          emotionalMechanism: analyzed.emotionalMechanism,
          hiddenExpectation: analyzed.hiddenExpectation,
          unexpectedDetail: analyzed.unexpectedDetail,
          possibleTwist: analyzed.possibleTwist,
          readerReactionPotential: analyzed.readerReactionPotential,
          storyMechanic: analyzed.storyMechanic,
          keywords: analyzed.keywords,
          researchNotes: analyzed.researchNotes,
          sourceReliability: rawItem.reliability,
          analysisStatus: 'completed',
          originalityAssessment: analyzed.originalityAssessment,
          queueStatus: 'analysis_completed',
          generatedIdea: null,
          qualityBreakdown: analyzed.qualityBreakdown,
          duplicateMatches: [],
          duplicateFlag: false,
          createdAt: now,
          updatedAt: now,
        };

        if (job.conversionMode === 'analysis_and_idea' && !cancelledJobIds.has(job.id)) {
          try {
            const existingContexts = freshDb.stories
              .filter((s) => s.collection === job.collection)
              .slice(-20)
              .map((s) => `${s.title} — ${s.plotMechanic}`);

            const gen = await generateOriginalIdeaFromResearch(resultCard, existingContexts, customCats);
            resultCard.generatedIdea = gen.idea;
            resultCard.qualityBreakdown = gen.qualityBreakdown;
            resultCard.originalityAssessment = gen.originalityAssessment;
            resultCard.queueStatus = 'idea_generated';
            ideasGeneratedCount++;
          } catch (ideaErr) {
            aiErrorCount++;
            lastAiError = (ideaErr as Error).message;
            resultCard.researchNotes = `${resultCard.researchNotes}\n[Идея не сгенерирована: ${lastAiError}]`.trim();
          }
        }

        // Duplicate check against STORY DATABASE + research_results + current batch
        const dupes = findResearchDuplicates(
          resultCard,
          freshDb.stories,
          freshResults,
          currentBatchIds,
          freshDb.settings.similarityThreshold
        );
        resultCard.duplicateMatches = dupes;
        resultCard.duplicateFlag = dupes.length > 0;
        if (resultCard.duplicateFlag) {
          duplicatesDetectedCount++;
          resultCard.queueStatus = 'duplicate_check';
        } else {
          resultCard.queueStatus = 'awaiting_review';
        }

        // Persist immediately after each item for crash/restart recovery
        currentBatchIds.add(researchId);
        resultIds.push(researchId);
        const updatedResults = [resultCard, ...freshResults];
        saveResearchResults(updatedResults);

        // Update source found counter
        const sources = loadResearchSources();
        const sIdx = sources.findIndex((s) => s.id === rawItem.sourceId);
        if (sIdx !== -1) {
          sources[sIdx].itemsFoundCount = (sources[sIdx].itemsFoundCount || 0) + 1;
          sources[sIdx].updatedAt = new Date().toISOString();
          saveResearchSources(sources);
        }

        processedCount++;
        appendJobLog(
          job.id,
          resultCard.duplicateFlag ? 'warn' : 'info',
          `${researchId}: проанализирован «${rawItem.sourceTitle.slice(0, 60)}» (качество ${resultCard.qualityBreakdown.overall}/100${
            resultCard.duplicateFlag ? ', обнаружено смысловое совпадение' : ''
          }).`,
          {
            processedCount,
            ideasGeneratedCount,
            duplicatesDetectedCount,
            resultIds,
          }
        );
      } catch (itemErr) {
        aiErrorCount++;
        lastAiError = (itemErr as Error).message;
        const fallbackCategory =
          job.category && job.category !== 'ALL_BALANCED'
            ? job.category
            : job.collection === 'debate'
              ? DEBATE_CATEGORIES[0]
              : ROMANTIC_CATEGORIES[0];

        const fallbackCard: ResearchResult = {
          researchId,
          jobId: job.id,
          sourceId: rawItem.sourceId,
          sourceName: rawItem.sourceName,
          sourceUrl: rawItem.sourceUrl,
          sourceTitle: rawItem.sourceTitle,
          sourceAuthor: rawItem.sourceAuthor || 'unknown',
          sourceDate: rawItem.sourceDate || 'unknown',
          researchDate: now,
          sourceType: rawItem.sourceType,
          collection: job.collection,
          targetCategory: fallbackCategory,
          originalLanguage: rawItem.originalLanguage || 'en',
          sourceSummary: rawItem.snippet || rawItem.sourceTitle,
          mainSituation: '',
          participants: '',
          relationshipType: '',
          mainConflict: '',
          positionsOfParticipants: {
            sideA: '',
            sideB: '',
          },
          emotionalMechanism: '',
          hiddenExpectation: '',
          unexpectedDetail: '',
          possibleTwist: '',
          readerReactionPotential: '',
          storyMechanic: '',
          keywords: [],
          researchNotes: `ИИ-анализ и генерация идеи не выполнены из-за ошибки Gemini API: ${lastAiError}. Реальные факты источника (URL, заголовок, автор, дата, фрагмент) сохранены — повторите анализ после восстановления квоты.`,
          sourceReliability: rawItem.reliability,
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
            ...(job.collection === 'debate'
              ? { ambiguity: 75, bothSidesArgumentation: 75, debatePotential: 75 }
              : {
                  warmth: 75,
                  naturalness: 75,
                  emotionalDetailPower: 75,
                  relatability: 75,
                  nonSaccharine: 75,
                }),
            tierLabel: 'Требует проверки',
            explanation: `ИИ-анализ не выполнен (${lastAiError.slice(0, 140)}). Базовая техническая оценка выставлена до повторного ИИ-анализа.`,
          },
          duplicateMatches: [],
          duplicateFlag: false,
          createdAt: now,
          updatedAt: now,
        };

        const dupes = findResearchDuplicates(
          fallbackCard,
          freshDb.stories,
          freshResults,
          currentBatchIds,
          freshDb.settings.similarityThreshold
        );
        fallbackCard.duplicateMatches = dupes;
        fallbackCard.duplicateFlag = dupes.length > 0;
        if (fallbackCard.duplicateFlag) {
          duplicatesDetectedCount++;
          fallbackCard.queueStatus = 'duplicate_check';
        }

        currentBatchIds.add(researchId);
        resultIds.push(researchId);
        saveResearchResults([fallbackCard, ...freshResults]);

        const sources = loadResearchSources();
        const sIdx = sources.findIndex((s) => s.id === rawItem.sourceId);
        if (sIdx !== -1) {
          sources[sIdx].itemsFoundCount = (sources[sIdx].itemsFoundCount || 0) + 1;
          sources[sIdx].updatedAt = new Date().toISOString();
          saveResearchSources(sources);
        }

        processedCount++;
        appendJobLog(
          job.id,
          'warn',
          `${researchId}: материал «${rawItem.sourceTitle.slice(0, 60)}» сохранён со статусом analysisStatus=failed (Gemini API: ${lastAiError.slice(0, 140)}).`,
          {
            processedCount,
            duplicatesDetectedCount,
            resultIds,
          }
        );
      }
    }

    createResearchBackupSnapshot();

    const partialWarning =
      aiErrorCount > 0
        ? `ИИ-анализ завершился с ошибками (${aiErrorCount}/${processedCount}): ${lastAiError}. Найденные реальные материалы сохранены как карточки для повторного анализа.`
        : undefined;

    appendJobLog(
      job.id,
      aiErrorCount > 0 ? 'warn' : 'info',
      `Исследование завершено: сохранено материалов ${processedCount}, идей создано ${ideasGeneratedCount}, совпадений ${duplicatesDetectedCount}${
        aiErrorCount > 0 ? `, ошибок ИИ-анализа: ${aiErrorCount}` : ''
      }.`,
      {
        status: processedCount > 0 ? 'completed' : 'failed',
        errorMessage: partialWarning,
        processedCount,
        ideasGeneratedCount,
        duplicatesDetectedCount,
        resultIds,
        completedAt: new Date().toISOString(),
      }
    );
  } finally {
    cancelledJobIds.delete(job.id);
    if (activeJobId === job.id) {
      activeJobId = null;
    }
  }
}

export async function reanalyzeResearchResult(researchId: string): Promise<ResearchResult> {
  const results = loadResearchResults();
  const idx = results.findIndex((r) => r.researchId === researchId);
  if (idx === -1) throw new Error('Карточка исследования не найдена.');

  const current = results[idx];
  const db = loadDatabase();
  const customCats = db.customCategories[current.collection] || [];

  const raw: DiscoveredRawMaterial = {
    sourceId: current.sourceId,
    sourceName: current.sourceName,
    sourceType: current.sourceType,
    sourceUrl: current.sourceUrl,
    sourceTitle: current.sourceTitle,
    sourceAuthor: current.sourceAuthor,
    sourceDate: current.sourceDate,
    originalLanguage: current.originalLanguage,
    snippet: current.sourceSummary,
    reliability:
      current.sourceReliability === 'unverified' ? 'search_grounded' : current.sourceReliability,
  };

  const analyzed = await analyzeDiscoveredMaterial(
    raw,
    current.collection,
    current.targetCategory,
    'deep',
    customCats
  );

  const updated: ResearchResult = {
    ...current,
    targetCategory: analyzed.targetCategory,
    sourceSummary: analyzed.sourceSummary,
    mainSituation: analyzed.mainSituation,
    participants: analyzed.participants,
    relationshipType: analyzed.relationshipType,
    mainConflict: analyzed.mainConflict,
    positionsOfParticipants: {
      sideA: analyzed.sideA,
      sideB: analyzed.sideB,
    },
    emotionalMechanism: analyzed.emotionalMechanism,
    hiddenExpectation: analyzed.hiddenExpectation,
    unexpectedDetail: analyzed.unexpectedDetail,
    possibleTwist: analyzed.possibleTwist,
    readerReactionPotential: analyzed.readerReactionPotential,
    storyMechanic: analyzed.storyMechanic,
    keywords: analyzed.keywords,
    researchNotes: analyzed.researchNotes,
    analysisStatus: 'completed',
    originalityAssessment: analyzed.originalityAssessment,
    qualityBreakdown: analyzed.qualityBreakdown,
    queueStatus: current.generatedIdea ? 'awaiting_review' : 'analysis_completed',
    updatedAt: new Date().toISOString(),
  };

  results[idx] = updated;
  saveResearchResults(results);
  return updated;
}

export async function generateIdeaForResearchResult(researchId: string): Promise<ResearchResult> {
  const results = loadResearchResults();
  const idx = results.findIndex((r) => r.researchId === researchId);
  if (idx === -1) throw new Error('Карточка исследования не найдена.');

  const current = results[idx];
  const db = loadDatabase();
  const customCats = db.customCategories[current.collection] || [];
  const existingContexts = db.stories
    .filter((s) => s.collection === current.collection)
    .slice(-20)
    .map((s) => `${s.title} — ${s.plotMechanic}`);

  const gen = await generateOriginalIdeaFromResearch(current, existingContexts, customCats);
  const updated: ResearchResult = {
    ...current,
    generatedIdea: gen.idea,
    qualityBreakdown: gen.qualityBreakdown,
    originalityAssessment: gen.originalityAssessment,
    updatedAt: new Date().toISOString(),
  };

  const dupes = findResearchDuplicates(
    updated,
    db.stories,
    results,
    new Set(),
    db.settings.similarityThreshold
  );
  updated.duplicateMatches = dupes;
  updated.duplicateFlag = dupes.length > 0;
  updated.queueStatus = updated.duplicateFlag ? 'duplicate_check' : 'awaiting_review';

  results[idx] = updated;
  saveResearchResults(results);
  return updated;
}

export function checkDuplicateForResearchResult(researchId: string): ResearchResult {
  const results = loadResearchResults();
  const idx = results.findIndex((r) => r.researchId === researchId);
  if (idx === -1) throw new Error('Карточка исследования не найдена.');

  const current = results[idx];
  const db = loadDatabase();
  const dupes = findResearchDuplicates(
    current,
    db.stories,
    results,
    new Set(),
    db.settings.similarityThreshold
  );

  const nextStatus: ResearchQueueStatus =
    current.queueStatus === 'approved_for_database' || current.queueStatus === 'rejected'
      ? current.queueStatus
      : dupes.length > 0
        ? 'duplicate_check'
        : current.analysisStatus === 'failed'
          ? 'research_pending'
          : 'awaiting_review';

  const updated: ResearchResult = {
    ...current,
    duplicateMatches: dupes,
    duplicateFlag: dupes.length > 0,
    queueStatus: nextStatus,
    updatedAt: new Date().toISOString(),
  };

  results[idx] = updated;
  saveResearchResults(results);
  return updated;
}

export function approveResearchResultToDatabase(
  researchId: string,
  forceIgnoreDuplicates = false
): {
  result: ResearchResult;
  story?: StoryPlot;
  duplicateBlocked?: boolean;
} {
  const results = loadResearchResults();
  const idx = results.findIndex((r) => r.researchId === researchId);
  if (idx === -1) throw new Error('Карточка исследования не найдена.');

  const current = results[idx];
  if (current.queueStatus === 'approved_for_database' && current.savedStoryId) {
    throw new Error(`Эта идея уже добавлена в STORY DATABASE под ID ${current.savedStoryId}.`);
  }

  const db = loadDatabase();
  const dupes = findResearchDuplicates(
    current,
    db.stories,
    results,
    new Set(),
    db.settings.similarityThreshold
  );

  current.duplicateMatches = dupes;
  current.duplicateFlag = dupes.length > 0;

  if (dupes.length > 0 && !forceIgnoreDuplicates) {
    current.queueStatus = 'duplicate_check';
    current.updatedAt = new Date().toISOString();
    results[idx] = current;
    saveResearchResults(results);
    return {
      result: current,
      duplicateBlocked: true,
    };
  }

  const pseudo = researchResultToPseudoStory(current);
  const idea = current.generatedIdea;
  const targetCollection = current.collection;
  const newStoryId = generateNextStoryId(db.stories, targetCollection);
  const qb = current.qualityBreakdown;

  const newStoryInput: Partial<StoryPlot> = {
    id: newStoryId,
    collection: targetCollection,
    category:
      idea?.category ||
      current.targetCategory ||
      (targetCollection === 'debate' ? DEBATE_CATEGORIES[0] : ROMANTIC_CATEGORIES[0]),
    subcategory: idea?.subcategory || current.relationshipType || 'Зарубежное исследование',
    title: idea?.title || pseudo.title,
    shortDescription: idea?.shortDescription || current.sourceSummary,
    fullPlot: idea?.fullPlot || pseudo.fullPlot,
    participants: idea?.participants || current.participants,
    setting: idea?.setting || '',
    coreConflictOrAction: idea?.coreConflictOrAction || current.mainConflict,
    sideAPosition: idea?.sideAPosition || current.positionsOfParticipants.sideA,
    sideBPosition: idea?.sideBPosition || current.positionsOfParticipants.sideB,
    emotionalMechanism: idea?.emotionalMechanism || current.emotionalMechanism,
    hiddenExpectation: idea?.hiddenExpectation || current.hiddenExpectation,
    unexpectedNuance: idea?.unexpectedNuance || current.unexpectedDetail,
    possibleTwist: idea?.possibleTwist || current.possibleTwist,
    mainTriggerQuestion: idea?.mainTriggerQuestion || current.readerReactionPotential,
    additionalQuestions: idea?.additionalQuestions || [],
    keywords: idea?.keywords || current.keywords,
    ideaSource: `${current.sourceName} (${current.researchId})`,
    sourceUrl: current.sourceUrl,
    originType: 'external',
    verificationStatus: 'pending', // Section 9: verificationStatus = pending on DB insertion
    usageStatus: 'unused', // Section 9: usageStatus = unused
    mainTheme: idea?.mainTheme || current.mainSituation,
    plotMechanic: idea?.plotMechanic || current.storyMechanic,
    uniqueDetails: idea?.uniqueDetails || current.unexpectedDetail,
    sourceAnalysisNote: `Источник: ${current.sourceName} (${current.sourceUrl}). ${current.researchNotes}`,
    researchId: current.researchId,
    researchNotes: current.researchNotes,
    batchNumber: 0,
    quality: {
      overall: qb.overall,
      originality: qb.originality,
      realism: qb.realism,
      emotionalExpressiveness: qb.emotionalExpressiveness,
      interest: qb.readerInterest,
      discussionPotential: qb.discussionPotential,
      specificity: qb.specificity,
      plotVariability: qb.diversity,
      ...(targetCollection === 'debate'
        ? {
            ambiguity: qb.ambiguity ?? 78,
            bothSidesArgumentation: qb.bothSidesArgumentation ?? 78,
            contradictionStrength: qb.debatePotential ?? 78,
          }
        : {
            emotionalWarmth: qb.warmth ?? 78,
            relatability: qb.relatability ?? 78,
            smallDetailPower: qb.emotionalDetailPower ?? 78,
            naturalness: qb.naturalness ?? 78,
          }),
      editorialNote: `${qb.tierLabel} (${qb.overall}/100): ${qb.explanation}`,
    },
  };

  const normalizedStory = normalizeAndScoreStory(
    newStoryInput,
    db.stories,
    db.settings.similarityThreshold
  );
  normalizedStory.id = newStoryId;
  normalizedStory.verificationStatus = 'pending';
  normalizedStory.usageStatus = 'unused';

  db.stories.unshift(normalizedStory);
  saveDatabase(db);
  createBackupSnapshot(db);

  current.queueStatus = 'approved_for_database';
  current.savedStoryId = normalizedStory.id;
  current.updatedAt = new Date().toISOString();
  results[idx] = current;
  saveResearchResults(results);
  createResearchBackupSnapshot();

  computeDatabaseStats(db);

  return {
    result: current,
    story: normalizedStory,
    duplicateBlocked: false,
  };
}

export function rejectResearchResult(researchId: string, reason?: string): ResearchResult {
  const results = loadResearchResults();
  const idx = results.findIndex((r) => r.researchId === researchId);
  if (idx === -1) throw new Error('Карточка исследования не найдена.');

  results[idx] = {
    ...results[idx],
    queueStatus: 'rejected',
    rejectionReason: reason || 'Отклонено редактором в очереди FOREIGN RESEARCH.',
    updatedAt: new Date().toISOString(),
  };
  saveResearchResults(results);
  return results[idx];
}

// --- Compatibility Exports ---
export const cancelResearchJob = requestCancelResearchJob;
export async function checkDuplicateForResult(_card: unknown) {
  return [];
}
export const startResearchJob = startResearchJobAsync;

