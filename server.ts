import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { generateStoryBatch } from './server/geminiBatch.ts';
import { buildProjectZipBuffer } from './server/zipBuilder.ts';
import {
  computeDatabaseStats,
  createBackupSnapshot,
  generateNextBatchNumber,
  generateNextStoryId,
  listBackupSnapshots,
  loadDatabase,
  normalizeAndScoreStory,
  saveDatabase,
} from './server/storage.ts';
import {
  buildSemanticFingerprint,
  calculateOverallQuality,
  calculateResearchQuality,
  findSimilarStories,
  researchResultsToCsv,
  storiesToCsv,
} from './src/shared/similarity.ts';
import {
  approveResearchResultToDatabase,
  checkDuplicateForResearchResult,
  generateIdeaForResearchResult,
  getActiveResearchJobId,
  reanalyzeResearchResult,
  rejectResearchResult,
  requestCancelResearchJob,
  startResearchJobAsync,
} from './server/researchEngine.ts';
import { extractDomainFromUrl, probeSourceAvailability } from './server/researchSources.ts';
import {
  computeResearchStatistics,
  createResearchBackupSnapshot,
  listResearchBackupSnapshots,
  loadResearchJobs,
  loadResearchResults,
  loadResearchSources,
  recoverInterruptedResearchJobs,
  saveResearchResults,
  saveResearchSources,
} from './server/researchStorage.ts';
import { registerContentRoutes } from './server/contentRoutes.ts';
import {
  loadPhrasebook,
  loadVoiceConfig,
  recoverInterruptedContentDrafts,
} from './server/contentStorage.ts';
import type {
  BatchRecord,
  CollectionType,
  ResearchResult,
  ResearchSource,
  StoryPlot,
} from './src/shared/types.ts';

const PORT = Number(process.env.PORT || 3000);
const STAGING_FILE = path.resolve(process.cwd(), 'data', 'pending_batch.json');

interface StagedBatchState {
  batchNumber: number;
  collection: CollectionType;
  targetCategory: string;
  researchMode: 'original' | 'external_search';
  usedSearchGrounding: boolean;
  groundingUrls: Array<{ uri: string; title: string }>;
  createdAt: string;
  candidates: StoryPlot[];
}

function loadStagedBatch(): StagedBatchState | null {
  try {
    if (!fs.existsSync(STAGING_FILE)) return null;
    const raw = fs.readFileSync(STAGING_FILE, 'utf-8');
    return JSON.parse(raw) as StagedBatchState;
  } catch {
    return null;
  }
}

function saveStagedBatch(staged: StagedBatchState | null): void {
  const dir = path.dirname(STAGING_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!staged) {
    if (fs.existsSync(STAGING_FILE)) fs.unlinkSync(STAGING_FILE);
    return;
  }
  fs.writeFileSync(STAGING_FILE, JSON.stringify(staged, null, 2), 'utf-8');
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // Ensure initial DB and research stores exist on startup; recover any interrupted jobs
  loadDatabase();
  loadResearchSources();
  recoverInterruptedResearchJobs();
  loadVoiceConfig();
  loadPhrasebook();
  recoverInterruptedContentDrafts();

  // API: Full state + stats
  app.get('/api/database', (_req, res) => {
    const db = loadDatabase();
    const stats = computeDatabaseStats(db);
    const backups = listBackupSnapshots();
    const stagedBatch = loadStagedBatch();
    res.json({
      ...db,
      stats,
      backups,
      stagedBatch,
    });
  });

  // API: Check semantic similarity before saving
  app.post('/api/stories/check-similarity', (req, res) => {
    const db = loadDatabase();
    const candidate = req.body as Partial<StoryPlot>;
    const threshold = Number(req.body.threshold ?? db.settings.similarityThreshold ?? 38);
    const matches = findSimilarStories(candidate, db.stories, threshold);
    res.json({
      hasDuplicates: matches.length > 0,
      matches,
    });
  });

  // API: Add a manual story plot (blocks duplicates unless forceSave === true)
  app.post('/api/stories', (req, res) => {
    const db = loadDatabase();
    const { story, forceSave } = req.body as { story: Partial<StoryPlot>; forceSave?: boolean };
    if (!story || !story.title || !story.fullPlot) {
      res.status(400).json({ error: 'Обязательно укажите название и полную сюжетную основу.' });
      return;
    }

    const normalized = normalizeAndScoreStory(
      story,
      db.stories,
      db.settings.similarityThreshold
    );

    if (normalized.duplicateFlag && !forceSave) {
      res.status(409).json({
        error: 'Обнаружены смысловые совпадения с существующими сюжетами. Запись не сохранена автоматически.',
        matches: normalized.similarityMatches,
        candidate: normalized,
      });
      return;
    }

    normalized.id = generateNextStoryId(db.stories, normalized.collection);
    db.stories.unshift(normalized);
    saveDatabase(db);

    res.status(201).json({
      story: normalized,
      stats: computeDatabaseStats(db),
    });
  });

  // API: Update existing story plot
  app.put('/api/stories/:id', (req, res) => {
    const db = loadDatabase();
    const { id } = req.params;
    const idx = db.stories.findIndex((s) => s.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Сюжет не найден.' });
      return;
    }

    const updatedInput = req.body as Partial<StoryPlot>;
    const current = db.stories[idx];
    const merged: StoryPlot = {
      ...current,
      ...updatedInput,
      id: current.id,
      quality: {
        ...current.quality,
        ...(updatedInput.quality || {}),
      },
      updatedAt: new Date().toISOString(),
    };
    merged.quality.overall = calculateOverallQuality(merged.quality, merged.collection);
    merged.semanticFingerprint = buildSemanticFingerprint(merged);
    const others = db.stories.filter((s) => s.id !== id);
    const matches = findSimilarStories(merged, others, db.settings.similarityThreshold);
    merged.similarityMatches = matches;
    merged.duplicateFlag = matches.length > 0;

    db.stories[idx] = merged;
    saveDatabase(db);

    res.json({
      story: merged,
      stats: computeDatabaseStats(db),
    });
  });

  // API: Quick status change (approve, reject, needs_revision, pending, usageStatus)
  app.patch('/api/stories/:id/status', (req, res) => {
    const db = loadDatabase();
    const { id } = req.params;
    const idx = db.stories.findIndex((s) => s.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Сюжет не найден.' });
      return;
    }
    const { verificationStatus, usageStatus, duplicateFlag } = req.body;
    if (verificationStatus) db.stories[idx].verificationStatus = verificationStatus;
    if (usageStatus) db.stories[idx].usageStatus = usageStatus;
    if (typeof duplicateFlag === 'boolean') db.stories[idx].duplicateFlag = duplicateFlag;
    db.stories[idx].updatedAt = new Date().toISOString();

    saveDatabase(db);
    res.json({
      story: db.stories[idx],
      stats: computeDatabaseStats(db),
    });
  });

  // API: Merge a staged or duplicate story into an existing record
  app.post('/api/stories/merge', (req, res) => {
    const db = loadDatabase();
    const { targetId, mergedFields, removeDuplicateId } = req.body as {
      targetId: string;
      mergedFields: Partial<StoryPlot>;
      removeDuplicateId?: string;
    };

    const idx = db.stories.findIndex((s) => s.id === targetId);
    if (idx === -1) {
      res.status(404).json({ error: 'Целевой сюжет для объединения не найден.' });
      return;
    }

    const updated: StoryPlot = {
      ...db.stories[idx],
      ...mergedFields,
      id: db.stories[idx].id,
      updatedAt: new Date().toISOString(),
    };
    updated.semanticFingerprint = buildSemanticFingerprint(updated);
    updated.quality.overall = calculateOverallQuality(updated.quality, updated.collection);
    db.stories[idx] = updated;

    if (removeDuplicateId) {
      db.stories = db.stories.filter((s) => s.id !== removeDuplicateId);
    }

    saveDatabase(db);
    res.json({
      story: updated,
      stats: computeDatabaseStats(db),
    });
  });

  // API: Delete story
  app.delete('/api/stories/:id', (req, res) => {
    const db = loadDatabase();
    const { id } = req.params;
    const before = db.stories.length;
    db.stories = db.stories.filter((s) => s.id !== id);
    if (db.stories.length === before) {
      res.status(404).json({ error: 'Сюжет не найден.' });
      return;
    }
    saveDatabase(db);
    res.json({ deletedId: id, stats: computeDatabaseStats(db) });
  });

  // API: Re-run full database deduplication scan
  app.post('/api/uniqueness/rescan', (req, res) => {
    const db = loadDatabase();
    const threshold = Number(req.body?.threshold ?? db.settings.similarityThreshold);
    for (let i = 0; i < db.stories.length; i++) {
      const others = db.stories.filter((_, idx) => idx !== i);
      const matches = findSimilarStories(db.stories[i], others, threshold);
      db.stories[i].similarityMatches = matches;
      db.stories[i].duplicateFlag = matches.length > 0;
    }
    saveDatabase(db);
    res.json({
      stories: db.stories,
      stats: computeDatabaseStats(db),
    });
  });

  // API: Generate next batch via Gemini API (stages results for editor verification)
  app.post('/api/batches/generate', async (req, res) => {
    try {
      const db = loadDatabase();
      const collection: CollectionType = req.body.collection === 'romantic' ? 'romantic' : 'debate';
      const targetCategory = String(req.body.targetCategory || 'ALL_BALANCED');
      const batchSize = Math.max(5, Math.min(50, Number(req.body.batchSize || db.settings.defaultBatchSize || 25)));
      const researchMode = req.body.researchMode === 'external_search' ? 'external_search' : 'original';

      const batchNumber = generateNextBatchNumber(db, collection);

      const result = await generateStoryBatch({
        collection,
        targetCategory,
        batchSize,
        batchNumber,
        researchMode,
        existingStories: db.stories,
        customCategories: db.customCategories[collection] || [],
        similarityThreshold: db.settings.similarityThreshold,
      });

      const staged: StagedBatchState = {
        batchNumber,
        collection,
        targetCategory: targetCategory === 'ALL_BALANCED' ? 'Сбалансированный подбор категорий' : targetCategory,
        researchMode,
        usedSearchGrounding: result.usedSearchGrounding,
        groundingUrls: result.groundingUrls,
        createdAt: new Date().toISOString(),
        candidates: result.candidates,
      };

      saveStagedBatch(staged);
      res.json({ stagedBatch: staged });
    } catch (err) {
      console.error('Batch generation failed:', err);
      const message = err instanceof Error ? err.message : 'Ошибка генерации партии сюжетов';
      res.status(500).json({ error: message });
    }
  });

  // API: Update or decide on a single candidate inside stagedBatch
  app.patch('/api/batches/staged/:candidateId', (req, res) => {
    const staged = loadStagedBatch();
    if (!staged) {
      res.status(404).json({ error: 'Активная партия на проверке не найдена.' });
      return;
    }
    const { candidateId } = req.params;
    const idx = staged.candidates.findIndex((c) => c.id === candidateId);
    if (idx === -1) {
      res.status(404).json({ error: 'Кандидат в партии не найден.' });
      return;
    }

    const db = loadDatabase();
    const updated: StoryPlot = {
      ...staged.candidates[idx],
      ...req.body,
      id: staged.candidates[idx].id,
      quality: {
        ...staged.candidates[idx].quality,
        ...(req.body.quality || {}),
      },
    };
    updated.quality.overall = calculateOverallQuality(updated.quality, updated.collection);
    updated.semanticFingerprint = buildSemanticFingerprint(updated);
    const matches = findSimilarStories(updated, db.stories, db.settings.similarityThreshold);
    updated.similarityMatches = matches;
    updated.duplicateFlag = matches.length > 0;

    staged.candidates[idx] = updated;
    saveStagedBatch(staged);
    res.json({ stagedBatch: staged });
  });

  // API: Commit staged batch decisions into persistent database
  app.post('/api/batches/commit', (req, res) => {
    const staged = loadStagedBatch();
    if (!staged) {
      res.status(404).json({ error: 'Нет партии для сохранения.' });
      return;
    }
    const db = loadDatabase();
    const { acceptedIds, rejectedIds, forceIncludeDuplicates } = req.body as {
      acceptedIds?: string[];
      rejectedIds?: string[];
      forceIncludeDuplicates?: boolean;
    };

    const acceptSet = new Set(acceptedIds || []);
    const rejectSet = new Set(rejectedIds || []);

    let acceptedCount = 0;
    let flaggedDuplicatesCount = 0;
    let rejectedCount = 0;
    const remainingCandidates: StoryPlot[] = [];

    for (const cand of staged.candidates) {
      if (rejectSet.has(cand.id) || cand.verificationStatus === 'rejected') {
        rejectedCount++;
        continue;
      }

      const isExplicitlyAccepted =
        acceptSet.has(cand.id) ||
        cand.verificationStatus === 'approved' ||
        cand.verificationStatus === 'needs_revision';

      if (!isExplicitlyAccepted) {
        remainingCandidates.push(cand);
        continue;
      }

      // Enforce strict uniqueness: do not save duplicates automatically unless explicitly forced
      const matches = findSimilarStories(cand, db.stories, db.settings.similarityThreshold);
      if (matches.length > 0 && !forceIncludeDuplicates && !acceptSet.has(cand.id)) {
        cand.similarityMatches = matches;
        cand.duplicateFlag = true;
        flaggedDuplicatesCount++;
        remainingCandidates.push(cand);
        continue;
      }

      const finalId = generateNextStoryId(db.stories, cand.collection);
      const savedPlot: StoryPlot = {
        ...cand,
        id: finalId,
        similarityMatches: matches,
        duplicateFlag: matches.length > 0,
        verificationStatus: cand.verificationStatus === 'pending' ? 'approved' : cand.verificationStatus,
        updatedAt: new Date().toISOString(),
      };
      db.stories.unshift(savedPlot);
      acceptedCount++;
    }

    const existingBatchIdx = db.batches.findIndex((b) => b.batchNumber === staged.batchNumber);
    const batchSummary: BatchRecord = {
      batchNumber: staged.batchNumber,
      collection: staged.collection,
      targetCategory: staged.targetCategory,
      requestedCount: staged.candidates.length,
      generatedCount: staged.candidates.length,
      acceptedCount:
        (existingBatchIdx >= 0 ? db.batches[existingBatchIdx].acceptedCount : 0) + acceptedCount,
      flaggedDuplicatesCount: remainingCandidates.filter((c) => c.duplicateFlag).length,
      rejectedCount:
        (existingBatchIdx >= 0 ? db.batches[existingBatchIdx].rejectedCount : 0) + rejectedCount,
      researchMode: staged.researchMode,
      createdAt: staged.createdAt,
      notes: `Партия #${staged.batchNumber}: принято в базу ${acceptedCount}, отклонено ${rejectedCount}, ожидает решения ${remainingCandidates.length}.`,
    };

    if (existingBatchIdx >= 0) {
      db.batches[existingBatchIdx] = batchSummary;
    } else {
      db.batches.unshift(batchSummary);
    }

    saveDatabase(db);
    if (acceptedCount > 0) {
      createBackupSnapshot(db);
    }

    if (remainingCandidates.length === 0) {
      saveStagedBatch(null);
      res.json({
        stagedBatch: null,
        committedCount: acceptedCount,
        rejectedCount,
        stats: computeDatabaseStats(db),
        batches: db.batches,
        stories: db.stories,
        backups: listBackupSnapshots(),
      });
    } else {
      const nextStaged = { ...staged, candidates: remainingCandidates };
      saveStagedBatch(nextStaged);
      res.json({
        stagedBatch: nextStaged,
        committedCount: acceptedCount,
        rejectedCount,
        stats: computeDatabaseStats(db),
        batches: db.batches,
        stories: db.stories,
        backups: listBackupSnapshots(),
      });
    }
  });

  app.delete('/api/batches/staged', (_req, res) => {
    saveStagedBatch(null);
    res.json({ ok: true });
  });

  // API: Add custom category
  app.post('/api/categories', (req, res) => {
    const db = loadDatabase();
    const collection: CollectionType = req.body.collection === 'romantic' ? 'romantic' : 'debate';
    const name = String(req.body.name || '').trim();
    if (!name) {
      res.status(400).json({ error: 'Введите название категории.' });
      return;
    }
    if (!db.customCategories[collection].includes(name)) {
      db.customCategories[collection].push(name);
      saveDatabase(db);
    }
    res.json({ customCategories: db.customCategories });
  });

  // API: Update settings
  app.put('/api/settings', (req, res) => {
    const db = loadDatabase();
    db.settings = {
      ...db.settings,
      ...req.body,
      storageMode: 'local_disk',
    };
    saveDatabase(db);
    res.json({
      settings: db.settings,
      stats: computeDatabaseStats(db),
    });
  });

  // API: Create backup snapshot
  app.post('/api/backup', (_req, res) => {
    const db = loadDatabase();
    const filename = createBackupSnapshot(db);
    res.json({
      filename,
      backups: listBackupSnapshots(),
    });
  });

  // API: Restore backup snapshot
  app.post('/api/backup/restore', (req, res) => {
    const filename = String(req.body.filename || '');
    const safeName = path.basename(filename);
    const target = path.resolve(process.cwd(), 'data', 'backups', safeName);
    if (!fs.existsSync(target)) {
      res.status(404).json({ error: 'Файл резервной копии не найден.' });
      return;
    }
    const raw = fs.readFileSync(target, 'utf-8');
    const restored = JSON.parse(raw);
    saveDatabase(restored);
    res.json({
      ...restored,
      stats: computeDatabaseStats(restored),
      backups: listBackupSnapshots(),
    });
  });

  // API: Import JSON stories with duplicate protection
  app.post('/api/import', (req, res) => {
    const db = loadDatabase();
    const { stories: incoming, skipDuplicates } = req.body as {
      stories: Array<Partial<StoryPlot>>;
      skipDuplicates?: boolean;
    };
    if (!Array.isArray(incoming)) {
      res.status(400).json({ error: 'Ожидается массив историй в JSON.' });
      return;
    }

    let importedCount = 0;
    let skippedDuplicatesCount = 0;

    for (const item of incoming) {
      if (!item.title || !item.fullPlot) continue;
      const normalized = normalizeAndScoreStory(item, db.stories, db.settings.similarityThreshold);
      if (normalized.duplicateFlag && skipDuplicates) {
        skippedDuplicatesCount++;
        continue;
      }
      normalized.id = generateNextStoryId(db.stories, normalized.collection);
      db.stories.unshift(normalized);
      importedCount++;
    }

    saveDatabase(db);
    createBackupSnapshot(db);

    res.json({
      importedCount,
      skippedDuplicatesCount,
      stats: computeDatabaseStats(db),
      stories: db.stories,
      backups: listBackupSnapshots(),
    });
  });

  // API: Export JSON / CSV
  app.get('/api/export/json', (req, res) => {
    const db = loadDatabase();
    const collection = req.query.collection as string | undefined;
    const onlyApproved = req.query.onlyApproved === 'true';

    let items = db.stories;
    if (collection === 'debate' || collection === 'romantic') {
      items = items.filter((s) => s.collection === collection);
    }
    if (onlyApproved) {
      items = items.filter((s) => s.verificationStatus === 'approved');
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="melo_love_stories_${new Date().toISOString().slice(0, 10)}.json"`
    );
    res.send(JSON.stringify({ exportedAt: new Date().toISOString(), count: items.length, stories: items }, null, 2));
  });

  app.get('/api/export/csv', (req, res) => {
    const db = loadDatabase();
    const collection = req.query.collection as string | undefined;
    const onlyApproved = req.query.onlyApproved === 'true';

    let items = db.stories;
    if (collection === 'debate' || collection === 'romantic') {
      items = items.filter((s) => s.collection === collection);
    }
    if (onlyApproved) {
      items = items.filter((s) => s.verificationStatus === 'approved');
    }

    const csv = storiesToCsv(items);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="melo_love_stories_${new Date().toISOString().slice(0, 10)}.csv"`
    );
    res.send(csv);
  });

  // API: Export complete Stage 1 project + database ZIP archive for GitHub
  app.get('/api/export/archive', (_req, res) => {
    try {
      // Ensure data/melo_love_db.json exists and is synced before packing
      loadDatabase();
      const zipBuffer = buildProjectZipBuffer(process.cwd());
      const dateStr = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="melo_love_stage1_github_${dateStr}.zip"`
      );
      res.setHeader('Content-Length', String(zipBuffer.length));
      res.send(zipBuffer);
    } catch (err) {
      console.error('Archive export failed:', err);
      res.status(500).json({ error: 'Не удалось собрать ZIP-архив проекта.' });
    }
  });

  /* ==========================================================================
     STAGE 2: FOREIGN RESEARCH ENGINE API
     ========================================================================== */

  app.get('/api/research/statistics', (_req, res) => {
    const sources = loadResearchSources();
    const jobs = loadResearchJobs();
    const results = loadResearchResults();
    const stats = computeResearchStatistics(sources, jobs, results);
    res.json({
      stats,
      activeJobId: getActiveResearchJobId(),
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      backups: listResearchBackupSnapshots(),
    });
  });

  app.get('/api/research/sources', (_req, res) => {
    const sources = loadResearchSources();
    res.json({ sources });
  });

  app.post('/api/research/sources', (req, res) => {
    const sources = loadResearchSources();
    const { name, url, platform, sourceType, language, directions, notes } = req.body as {
      name?: string;
      url?: string;
      platform?: 'reddit' | 'media' | 'custom';
      sourceType?: string;
      language?: string;
      directions?: CollectionType[];
      notes?: string;
    };

    const cleanName = String(name || '').trim();
    const cleanUrl = String(url || '').trim();
    if (!cleanName || !cleanUrl) {
      res.status(400).json({ error: 'Укажите название и корректный URL источника.' });
      return;
    }

    const domain = extractDomainFromUrl(cleanUrl);
    if (!domain) {
      res.status(400).json({ error: 'Некорректный формат URL (ожидается https://...).' });
      return;
    }

    const now = new Date().toISOString();
    const newSource: ResearchSource = {
      id: `custom-${Date.now().toString(36)}`,
      name: cleanName,
      url: cleanUrl,
      domain,
      platform: platform || (domain.includes('reddit.com') ? 'reddit' : 'custom'),
      sourceType: sourceType || 'Пользовательский источник',
      language: language || 'en',
      directions:
        Array.isArray(directions) && directions.length > 0 ? directions : ['debate', 'romantic'],
      enabled: true,
      isCustom: true,
      availabilityStatus: 'unchecked',
      availabilityMessage: 'Доступность ещё не проверялась',
      robotsAllowed: null,
      lastCheckedAt: null,
      itemsFoundCount: 0,
      notes: String(notes || '').trim(),
      createdAt: now,
      updatedAt: now,
    };

    sources.push(newSource);
    saveResearchSources(sources);
    res.status(201).json({ source: newSource, sources });
  });

  app.put('/api/research/sources/:id', (req, res) => {
    const sources = loadResearchSources();
    const idx = sources.findIndex((s) => s.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Источник не найден.' });
      return;
    }
    const patch = req.body as Partial<ResearchSource>;
    const updatedUrl = patch.url !== undefined ? String(patch.url).trim() : sources[idx].url;
    const domain = extractDomainFromUrl(updatedUrl) || sources[idx].domain;

    sources[idx] = {
      ...sources[idx],
      name: patch.name !== undefined ? String(patch.name).trim() : sources[idx].name,
      url: updatedUrl,
      domain,
      sourceType: patch.sourceType !== undefined ? String(patch.sourceType) : sources[idx].sourceType,
      language: patch.language !== undefined ? String(patch.language) : sources[idx].language,
      directions: Array.isArray(patch.directions) ? patch.directions : sources[idx].directions,
      enabled: typeof patch.enabled === 'boolean' ? patch.enabled : sources[idx].enabled,
      notes: patch.notes !== undefined ? String(patch.notes) : sources[idx].notes,
      updatedAt: new Date().toISOString(),
    };
    saveResearchSources(sources);
    res.json({ source: sources[idx], sources });
  });

  app.delete('/api/research/sources/:id', (req, res) => {
    const sources = loadResearchSources();
    const target = sources.find((s) => s.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Источник не найден.' });
      return;
    }
    if (!target.isCustom) {
      res.status(400).json({
        error: 'Базовые системные источники можно отключить, но нельзя удалить безвозвратно.',
      });
      return;
    }
    const next = sources.filter((s) => s.id !== req.params.id);
    saveResearchSources(next);
    res.json({ deletedId: req.params.id, sources: next });
  });

  app.post('/api/research/sources/:id/check', async (req, res) => {
    const sources = loadResearchSources();
    const idx = sources.findIndex((s) => s.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Источник не найден.' });
      return;
    }
    const checked = await probeSourceAvailability(sources[idx]);
    sources[idx] = checked;
    saveResearchSources(sources);
    res.json({ source: checked, sources });
  });

  app.post('/api/research/sources/check-all', async (_req, res) => {
    const sources = loadResearchSources();
    const updated: ResearchSource[] = [];
    for (const src of sources) {
      if (src.enabled) {
        updated.push(await probeSourceAvailability(src));
      } else {
        updated.push(src);
      }
    }
    saveResearchSources(updated);
    res.json({ sources: updated });
  });

  app.post('/api/research/search', (req, res) => {
    try {
      const {
        collection,
        sourceIds,
        category,
        sourceLanguage,
        requestedCount,
        depth,
        conversionMode,
      } = req.body as {
        collection?: CollectionType;
        sourceIds?: string[];
        category?: string;
        sourceLanguage?: string;
        requestedCount?: number;
        depth?: 'standard' | 'deep';
        conversionMode?: 'analysis_only' | 'analysis_and_idea';
      };

      const job = startResearchJobAsync({
        collection: collection === 'romantic' ? 'romantic' : 'debate',
        sourceIds: Array.isArray(sourceIds) ? sourceIds : [],
        category: String(category || 'ALL_BALANCED'),
        sourceLanguage: String(sourceLanguage || 'en'),
        requestedCount: Number(requestedCount || 3),
        depth: depth === 'deep' ? 'deep' : 'standard',
        conversionMode:
          conversionMode === 'analysis_only' ? 'analysis_only' : 'analysis_and_idea',
      });

      res.status(202).json({ job });
    } catch (err) {
      res.status(409).json({
        error: err instanceof Error ? err.message : 'Не удалось запустить исследование.',
      });
    }
  });

  app.get('/api/research/jobs', (_req, res) => {
    const jobs = loadResearchJobs();
    res.json({ jobs, activeJobId: getActiveResearchJobId() });
  });

  app.get('/api/research/jobs/:id', (req, res) => {
    const jobs = loadResearchJobs();
    const job = jobs.find((j) => j.id === req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Задание исследования не найдено.' });
      return;
    }
    res.json({ job });
  });

  app.post('/api/research/jobs/:id/cancel', (req, res) => {
    const ok = requestCancelResearchJob(req.params.id);
    if (!ok) {
      res.status(400).json({ error: 'Задание не найдено или уже завершено.' });
      return;
    }
    const jobs = loadResearchJobs();
    const job = jobs.find((j) => j.id === req.params.id);
    res.json({ ok: true, job });
  });

  app.get('/api/research/results', (req, res) => {
    let results = loadResearchResults();
    const collection = req.query.collection as string | undefined;
    const queueStatus = req.query.queueStatus as string | undefined;
    const sourceId = req.query.sourceId as string | undefined;

    if (collection === 'debate' || collection === 'romantic') {
      results = results.filter((r) => r.collection === collection);
    }
    if (queueStatus && queueStatus !== 'ALL') {
      results = results.filter((r) => r.queueStatus === queueStatus);
    }
    if (sourceId && sourceId !== 'ALL') {
      results = results.filter((r) => r.sourceId === sourceId);
    }

    res.json({ results });
  });

  app.get('/api/research/results/:id', (req, res) => {
    const results = loadResearchResults();
    const result = results.find((r) => r.researchId === req.params.id);
    if (!result) {
      res.status(404).json({ error: 'Карточка исследования не найдена.' });
      return;
    }
    res.json({ result });
  });

  app.patch('/api/research/results/:id', (req, res) => {
    const results = loadResearchResults();
    const idx = results.findIndex((r) => r.researchId === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Карточка исследования не найдена.' });
      return;
    }

    const current = results[idx];
    const patch = req.body as Partial<ResearchResult>;
    const updatedQuality = patch.qualityBreakdown
      ? {
          ...current.qualityBreakdown,
          ...patch.qualityBreakdown,
        }
      : current.qualityBreakdown;

    if (updatedQuality) {
      const recalc = calculateResearchQuality(updatedQuality, current.collection);
      updatedQuality.overall = recalc.overall;
      updatedQuality.tierLabel = recalc.tierLabel;
    }

    const updated: ResearchResult = {
      ...current,
      ...patch,
      researchId: current.researchId,
      positionsOfParticipants: {
        ...current.positionsOfParticipants,
        ...(patch.positionsOfParticipants || {}),
      },
      generatedIdea:
        patch.generatedIdea === null
          ? null
          : patch.generatedIdea
            ? {
                ...(current.generatedIdea || ({} as NonNullable<ResearchResult['generatedIdea']>)),
                ...patch.generatedIdea,
              }
            : current.generatedIdea,
      qualityBreakdown: updatedQuality,
      updatedAt: new Date().toISOString(),
    };

    results[idx] = updated;
    saveResearchResults(results);
    res.json({ result: updated });
  });

  app.post('/api/research/results/:id/analyze', async (req, res) => {
    try {
      const updated = await reanalyzeResearchResult(req.params.id);
      res.json({ result: updated });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Ошибка повторного анализа.',
      });
    }
  });

  app.post('/api/research/results/:id/generate-idea', async (req, res) => {
    try {
      const updated = await generateIdeaForResearchResult(req.params.id);
      res.json({ result: updated });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Ошибка генерации оригинальной идеи.',
      });
    }
  });

  app.post('/api/research/results/:id/check-duplicate', (req, res) => {
    try {
      const updated = checkDuplicateForResearchResult(req.params.id);
      res.json({ result: updated });
    } catch (err) {
      res.status(404).json({
        error: err instanceof Error ? err.message : 'Ошибка проверки дублей.',
      });
    }
  });

  app.post('/api/research/results/:id/approve', (req, res) => {
    try {
      const forceIgnoreDuplicates = Boolean(req.body?.forceIgnoreDuplicates);
      const outcome = approveResearchResultToDatabase(req.params.id, forceIgnoreDuplicates);
      if (outcome.duplicateBlocked) {
        res.status(409).json({
          error:
            'Обнаружены потенциальные смысловые дубли. Проверьте совпадения перед добавлением в основную базу.',
          result: outcome.result,
          matches: outcome.result.duplicateMatches,
        });
        return;
      }
      const db = loadDatabase();
      res.json({
        result: outcome.result,
        story: outcome.story,
        dbStats: computeDatabaseStats(db),
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Не удалось добавить идею в основную базу.',
      });
    }
  });

  app.post('/api/research/results/:id/reject', (req, res) => {
    try {
      const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
      const updated = rejectResearchResult(req.params.id, reason);
      res.json({ result: updated });
    } catch (err) {
      res.status(404).json({
        error: err instanceof Error ? err.message : 'Карточка не найдена.',
      });
    }
  });

  app.get('/api/research/export/json', (_req, res) => {
    const results = loadResearchResults();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="melo_love_foreign_research_${new Date().toISOString().slice(0, 10)}.json"`
    );
    res.send(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          count: results.length,
          results,
        },
        null,
        2
      )
    );
  });

  app.get('/api/research/export/csv', (_req, res) => {
    const results = loadResearchResults();
    const csv = researchResultsToCsv(results);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="melo_love_foreign_research_${new Date().toISOString().slice(0, 10)}.csv"`
    );
    res.send(csv);
  });

  app.post('/api/research/backup', (_req, res) => {
    const filename = createResearchBackupSnapshot();
    res.json({ filename, backups: listResearchBackupSnapshots() });
  });

  /* ==========================================================================
     STAGE 3: STORY GENERATOR + MELO_LOVE VOICE ENGINE API
     ========================================================================== */
  registerContentRoutes(app);

  // Vite middleware in dev, static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MELO_LOVE server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
