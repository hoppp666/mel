import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import {
  CollectionType,
  ResearchSource,
  StoryPlot,
  UsageStatus,
  VerificationStatus,
} from './src/shared/types.js';
import {
  buildSemanticFingerprint,
  calculateQualityScore,
  findSimilarStories,
  researchResultsToCsv,
  storiesToCsv,
} from './src/shared/similarity.js';
import {
  buildSnapshotResponse,
  createBackupSnapshot,
  loadDatabase,
  loadPendingBatch,
  nextBatchNumber,
  nextStoryId,
  normalizeAndScoreStory,
  restoreBackup,
  saveDatabase,
  savePendingBatch,
} from './server/storage.js';
import { generateStoryBatch } from './server/geminiBatch.js';
import { buildProjectZipBuffer } from './server/zipBuilder.js';
import {
  computeResearchStatistics,
  createResearchBackup,
  loadResearchJobs,
  loadResearchResults,
  loadResearchSources,
  recoverInterruptedResearchJobs,
  saveResearchResults,
  saveResearchSources,
} from './server/researchStorage.js';
import { checkResearchSourceAvailability } from './server/researchSources.js';
import {
  approveResearchResultToDatabase,
  cancelResearchJob,
  checkDuplicateForResult,
  reanalyzeResearchResult,
  startResearchJob,
} from './server/researchEngine.js';
import { recoverInterruptedDrafts } from './server/contentStorage.js';
import { createContentRouter } from './server/contentRoutes.js';
import {
  getTelegramIntegrationStatus,
  recoverInterruptedPublications,
} from './server/publishingStorage.js';
import { createPublishingRouter } from './server/publishingRoutes.js';
import { formatGeminiError } from './server/geminiClient.js';
import { recoverAutonomousState } from './server/autonomousStorage.js';
import { createAutonomousRouter } from './server/autonomousRoutes.js';

const PORT = Number(process.env.PORT || 3000);

async function bootstrap() {
  const app = express();
  app.use(express.json({ limit: '12mb' }));

  // Initialize & recover storages on boot
  loadDatabase();
  recoverInterruptedResearchJobs();
  recoverInterruptedDrafts();
  recoverInterruptedPublications();
  recoverAutonomousState();

  // ============================================================================
  // ЭТАП 1: STORY DATABASE GENERATOR & EXPORT API
  // ============================================================================

  app.get('/api/database', (_req, res) => {
    res.json(buildSnapshotResponse());
  });

  app.get('/api/integrations/status', (_req, res) => {
    res.json(getTelegramIntegrationStatus());
  });

  app.post('/api/stories/check-similarity', (req, res) => {
    const db = loadDatabase();
    const candidate = req.body as Partial<StoryPlot>;
    const matches = findSimilarStories(
      candidate,
      db.stories,
      db.settings.similarityThreshold,
      candidate.id
    );
    res.json({ matches, duplicateFlag: matches.length > 0 });
  });

  app.post('/api/stories', (req, res) => {
    const db = loadDatabase();
    const payload = req.body as Partial<StoryPlot> & { forceSave?: boolean };
    const collection: CollectionType = payload.collection === 'romantic' ? 'romantic' : 'debate';

    if (!payload.title || !payload.fullPlot) {
      return res.status(400).json({ error: 'Заполните минимум название и полную сюжетную основу.' });
    }

    const tempStory = normalizeAndScoreStory(
      {
        ...payload,
        id: nextStoryId(db.stories, collection),
        collection,
        createdAt: new Date().toISOString(),
        verificationStatus: payload.verificationStatus || 'pending',
        usageStatus: payload.usageStatus || 'unused',
      },
      db.stories,
      db.settings.similarityThreshold
    );

    if (tempStory.duplicateFlag && !payload.forceSave) {
      return res.status(409).json({
        error: 'Обнаружены смысловые совпадения с существующими сюжетами.',
        matches: tempStory.similarityMatches,
      });
    }

    db.stories.push(tempStory);
    saveDatabase(db);
    res.status(201).json({ story: tempStory, snapshot: buildSnapshotResponse() });
  });

  app.put('/api/stories/:id', (req, res) => {
    const db = loadDatabase();
    const idx = db.stories.findIndex((s) => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Сюжет не найден' });

    const existing = db.stories[idx];
    const updates = req.body as Partial<StoryPlot>;
    const others = db.stories.filter((s) => s.id !== existing.id);

    const updated = normalizeAndScoreStory(
      {
        ...existing,
        ...updates,
        id: existing.id,
        collection: existing.collection,
        quality:
          updates.quality ||
          calculateQualityScore(existing.collection, existing.quality?.breakdown, existing.quality?.editorialNote),
      },
      others,
      db.settings.similarityThreshold
    );

    db.stories[idx] = updated;
    saveDatabase(db);
    res.json({ story: updated, snapshot: buildSnapshotResponse() });
  });

  app.patch('/api/stories/:id/status', (req, res) => {
    const db = loadDatabase();
    const story = db.stories.find((s) => s.id === req.params.id);
    if (!story) return res.status(404).json({ error: 'Сюжет не найден' });

    const { verificationStatus, usageStatus } = req.body as {
      verificationStatus?: VerificationStatus;
      usageStatus?: UsageStatus;
    };
    if (verificationStatus) story.verificationStatus = verificationStatus;
    if (usageStatus) story.usageStatus = usageStatus;
    saveDatabase(db);
    res.json({ story, snapshot: buildSnapshotResponse() });
  });

  app.post('/api/stories/merge', (req, res) => {
    const { targetStoryId, nuanceToAppend, newTitle } = req.body as {
      targetStoryId: string;
      nuanceToAppend: string;
      newTitle?: string;
    };
    const db = loadDatabase();
    const target = db.stories.find((s) => s.id === targetStoryId);
    if (!target) return res.status(404).json({ error: 'Целевой сюжет не найден' });

    if (nuanceToAppend) {
      target.unexpectedNuance = `${target.unexpectedNuance} | Доп. нюанс: ${nuanceToAppend}`.trim();
    }
    if (newTitle) {
      target.title = newTitle.trim();
    }
    target.semanticFingerprint = buildSemanticFingerprint(target);
    saveDatabase(db);
    res.json({ story: target, snapshot: buildSnapshotResponse() });
  });

  app.delete('/api/stories/:id', (req, res) => {
    const db = loadDatabase();
    const exists = db.stories.some((s) => s.id === req.params.id);
    if (!exists) return res.status(404).json({ error: 'Сюжет не найден' });
    db.stories = db.stories.filter((s) => s.id !== req.params.id);
    saveDatabase(db);
    res.json({ deleted: true, snapshot: buildSnapshotResponse() });
  });

  app.post('/api/uniqueness/rescan', (_req, res) => {
    const db = loadDatabase();
    const rescanned: StoryPlot[] = [];
    for (const s of db.stories) {
      const others = db.stories.filter((o) => o.id !== s.id);
      const matches = findSimilarStories(s, others, db.settings.similarityThreshold, s.id);
      rescanned.push({
        ...s,
        semanticFingerprint: buildSemanticFingerprint(s),
        similarityMatches: matches,
        duplicateFlag: matches.length > 0,
      });
    }
    db.stories = rescanned;
    saveDatabase(db);
    res.json({ snapshot: buildSnapshotResponse() });
  });

  app.post('/api/batches/generate', async (req, res) => {
    try {
      const existingPending = loadPendingBatch();
      if (existingPending) {
        return res.status(409).json({
          error: 'У вас уже есть незавершённая партия на приёмке. Завершите или сбросьте её.',
          pendingBatch: existingPending,
        });
      }

      const db = loadDatabase();
      const collection: CollectionType = req.body?.collection === 'romantic' ? 'romantic' : 'debate';
      const categoryFocus = String(req.body?.categoryFocus || 'balanced');
      const count = Math.max(5, Math.min(50, Number(req.body?.count) || db.settings.defaultBatchSize));
      const searchMode = req.body?.searchMode === 'web_search' ? 'web_search' : 'original';
      const batchNumber = nextBatchNumber(db, collection);

      const pendingBatch = await generateStoryBatch({
        db,
        batchNumber,
        collection,
        categoryFocus,
        count,
        searchMode,
      });
      savePendingBatch(pendingBatch);
      res.status(201).json({ pendingBatch });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.patch('/api/batches/staged/:candidateId', (req, res) => {
    const pending = loadPendingBatch();
    if (!pending) return res.status(404).json({ error: 'Активная партия не найдена' });

    const idx = pending.candidates.findIndex((c) => c.candidateId === req.params.candidateId);
    if (idx === -1) return res.status(404).json({ error: 'Кандидат не найден' });

    const current = pending.candidates[idx];
    const updates = req.body || {};
    pending.candidates[idx] = {
      ...current,
      ...updates,
      candidateId: current.candidateId,
    };
    savePendingBatch(pending);
    res.json({ pendingBatch: pending });
  });

  app.post('/api/batches/commit', (_req, res) => {
    const pending = loadPendingBatch();
    if (!pending) return res.status(404).json({ error: 'Нет партии для сохранения' });

    const db = loadDatabase();
    createBackupSnapshot(db);

    let approvedCount = 0;
    let rejectedCount = 0;

    for (const cand of pending.candidates) {
      if (cand.decision === 'rejected') {
        rejectedCount++;
        continue;
      }
      const newId = nextStoryId(db.stories, pending.collection);
      const verificationStatus: VerificationStatus =
        cand.decision === 'approved'
          ? 'approved'
          : cand.decision === 'needs_revision'
            ? 'needs_revision'
            : 'pending';
      if (verificationStatus === 'approved') approvedCount++;

      const story = normalizeAndScoreStory(
        {
          ...cand,
          id: newId,
          verificationStatus,
          usageStatus: 'unused',
          batchNumber: pending.batchNumber,
        },
        db.stories,
        db.settings.similarityThreshold
      );
      db.stories.push(story);
    }

    db.batches.push({
      batchNumber: pending.batchNumber,
      collection: pending.collection,
      categoryFocus: pending.categoryFocus,
      searchMode: pending.searchMode,
      requestedCount: pending.candidates.length,
      generatedCount: pending.candidates.length,
      approvedCount,
      rejectedCount,
      createdAt: pending.createdAt,
      committedAt: new Date().toISOString(),
    });

    saveDatabase(db);
    savePendingBatch(null);
    res.json({ snapshot: buildSnapshotResponse() });
  });

  app.delete('/api/batches/staged', (_req, res) => {
    savePendingBatch(null);
    res.json({ cleared: true, snapshot: buildSnapshotResponse() });
  });

  app.post('/api/categories', (req, res) => {
    const { collection, name, subcategories } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Название категории обязательно' });
    }
    const db = loadDatabase();
    db.customCategories.push({
      id: `CAT-${Date.now().toString(36).toUpperCase()}`,
      collection: collection === 'romantic' ? 'romantic' : 'debate',
      name: String(name).trim(),
      subcategories: Array.isArray(subcategories) ? subcategories : [],
      createdAt: new Date().toISOString(),
    });
    saveDatabase(db);
    res.status(201).json({ snapshot: buildSnapshotResponse() });
  });

  app.put('/api/settings', (req, res) => {
    const db = loadDatabase();
    db.settings = { ...db.settings, ...(req.body || {}) };
    saveDatabase(db);
    res.json({ snapshot: buildSnapshotResponse() });
  });

  app.post('/api/backup', (_req, res) => {
    const backup = createBackupSnapshot();
    res.json({ backup, snapshot: buildSnapshotResponse() });
  });

  app.post('/api/backup/restore', (req, res) => {
    try {
      const filename = String(req.body?.filename || '');
      restoreBackup(filename);
      res.json({ snapshot: buildSnapshotResponse() });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Снимок не найден' });
    }
  });

  app.post('/api/import', (req, res) => {
    const rawStories = Array.isArray(req.body?.stories)
      ? req.body.stories
      : Array.isArray(req.body)
        ? req.body
        : null;
    if (!rawStories) {
      return res.status(400).json({ error: 'Ожидается массив stories в JSON' });
    }

    const db = loadDatabase();
    createBackupSnapshot(db);
    let imported = 0;
    let skippedDuplicates = 0;

    for (const raw of rawStories) {
      const collection: CollectionType = raw.collection === 'romantic' ? 'romantic' : 'debate';
      const cand = normalizeAndScoreStory(
        {
          ...raw,
          id: raw.id && !db.stories.some((s) => s.id === raw.id) ? raw.id : nextStoryId(db.stories, collection),
          collection,
        },
        db.stories,
        db.settings.similarityThreshold
      );
      if (cand.duplicateFlag) {
        skippedDuplicates++;
        continue;
      }
      db.stories.push(cand);
      imported++;
    }

    saveDatabase(db);
    res.json({ imported, skippedDuplicates, snapshot: buildSnapshotResponse() });
  });

  app.get('/api/export/json', (req, res) => {
    const db = loadDatabase();
    const col = req.query.collection as string | undefined;
    const status = req.query.status as string | undefined;
    let filtered = db.stories;
    if (col === 'debate' || col === 'romantic') {
      filtered = filtered.filter((s) => s.collection === col);
    }
    if (status && status !== 'all') {
      filtered = filtered.filter((s) => s.verificationStatus === status);
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="melo_love_stories.json"');
    res.send(JSON.stringify({ exportedAt: new Date().toISOString(), count: filtered.length, stories: filtered }, null, 2));
  });

  app.get('/api/export/csv', (req, res) => {
    const db = loadDatabase();
    const col = req.query.collection as string | undefined;
    const status = req.query.status as string | undefined;
    let filtered = db.stories;
    if (col === 'debate' || col === 'romantic') {
      filtered = filtered.filter((s) => s.collection === col);
    }
    if (status && status !== 'all') {
      filtered = filtered.filter((s) => s.verificationStatus === status);
    }
    const csv = storiesToCsv(filtered);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="melo_love_stories.csv"');
    res.send(csv);
  });

  app.get('/api/export/archive', (_req, res) => {
    const { buffer } = buildProjectZipBuffer();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="melo_love_project.zip"');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  });

  app.get('/api/export/patch-archive', (_req, res) => {
    const patchFiles = [
      'server.ts',
      'server/storage.ts',
      'server/researchStorage.ts',
      'server/contentStorage.ts',
      'server/contentRoutes.ts',
      'server/publishingStorage.ts',
      'server/autonomousStorage.ts',
      'server/supabaseMigration.ts',
      'server/aiClient.ts',
      'server/geminiClient.ts',
      'server/geminiBatch.ts',
      'server/researchEngine.ts',
      'server/researchAnalyzer.ts',
      'server/contentGenerator.ts',
      'server/voiceEngine.ts',
      'server/studioAiAssistant.ts',
      'server/autonomousScheduler.ts',
      'server/zipBuilder.ts',
      'src/shared/types.ts',
      'src/shared/contentUtils.ts',
      'src/shared/publishingUtils.ts',
      'src/services/api.ts',
      'data/content_phrasebook.json',
      '.github/workflows/melo-love-research.yml',
      '.github/workflows/publishing-queue.yml',
      '.env.example',
      'README.md',
      'tests/autonomous.test.ts',
      'tests/content.test.ts',
      'tests/publishing.test.ts',
      'src/components/BatchModal.tsx',
      'src/components/ContentStudioSection.tsx',
      'src/components/ForeignResearchSection.tsx',
      'src/components/Sections.tsx',
      'src/components/StoryGeneratorSection.tsx',
    ];
    const { buffer } = buildProjectZipBuffer(process.cwd(), patchFiles);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="melo_love_ai_patch.zip"');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  });

  // ============================================================================
  // ЭТАП 2: FOREIGN RESEARCH ENGINE API
  // ============================================================================

  app.get('/api/research/statistics', (_req, res) => {
    res.json({ statistics: computeResearchStatistics() });
  });

  app.get('/api/research/sources', (_req, res) => {
    res.json({ sources: loadResearchSources() });
  });

  app.post('/api/research/sources', (req, res) => {
    const body = req.body || {};
    if (!body.name || !body.url) {
      return res.status(400).json({ error: 'Укажите название и URL источника' });
    }
    const sources = loadResearchSources();
    const newSrc: ResearchSource = {
      id: `SRC-${Date.now().toString(36).toUpperCase()}`,
      name: String(body.name).trim(),
      url: String(body.url).trim(),
      rssUrl: body.rssUrl ? String(body.rssUrl).trim() : undefined,
      sourceType: body.sourceType || 'media',
      defaultCollection: body.defaultCollection || 'both',
      language: body.language || 'en',
      enabled: body.enabled !== false,
      isSystem: false,
      status: 'unchecked',
      robotsAllowed: null,
      foundCount: 0,
    };
    sources.push(newSrc);
    saveResearchSources(sources);
    res.status(201).json({ source: newSrc, sources });
  });

  app.patch('/api/research/sources/:id', (req, res) => {
    const sources = loadResearchSources();
    const idx = sources.findIndex((s) => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Источник не найден' });
    sources[idx] = { ...sources[idx], ...(req.body || {}), id: sources[idx].id };
    saveResearchSources(sources);
    res.json({ source: sources[idx], sources });
  });

  app.put('/api/research/sources/:id', (req, res) => {
    const sources = loadResearchSources();
    const idx = sources.findIndex((s) => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Источник не найден' });
    sources[idx] = { ...sources[idx], ...(req.body || {}), id: sources[idx].id };
    saveResearchSources(sources);
    res.json({ source: sources[idx], sources });
  });

  app.delete('/api/research/sources/:id', (req, res) => {
    const sources = loadResearchSources();
    const target = sources.find((s) => s.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'Источник не найден' });
    if (target.isSystem) {
      return res.status(400).json({ error: 'Системный источник можно только отключить, но не удалить.' });
    }
    const filtered = sources.filter((s) => s.id !== req.params.id);
    saveResearchSources(filtered);
    res.json({ deleted: true, sources: filtered });
  });

  app.post('/api/research/sources/:id/check', async (req, res) => {
    const sources = loadResearchSources();
    const idx = sources.findIndex((s) => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Источник не найден' });
    const checked = await checkResearchSourceAvailability(sources[idx]);
    sources[idx] = checked;
    saveResearchSources(sources);
    res.json({ source: checked, sources });
  });

  app.post('/api/research/sources/check-all', async (_req, res) => {
    const sources = loadResearchSources();
    const checkedAll = await Promise.all(
      sources.map((s) => checkResearchSourceAvailability(s))
    );
    saveResearchSources(checkedAll);
    res.json({ sources: checkedAll });
  });

  app.post('/api/research/search', (req, res) => {
    try {
      const body = req.body || {};
      const job = startResearchJob({
        collection: body.collection === 'romantic' ? 'romantic' : 'debate',
        sourceIds: Array.isArray(body.sourceIds) ? body.sourceIds : [],
        categoryFocus: String(body.categoryFocus || 'balanced'),
        sourceLanguage: String(body.sourceLanguage || 'en'),
        requestedCount: Number(body.requestedCount) || 3,
        analysisDepth: body.analysisDepth === 'deep' ? 'deep' : 'standard',
        transformMode: body.transformMode === 'analyze_only' ? 'analyze_only' : 'analyze_and_generate',
      });
      res.status(202).json({ job });
    } catch (err) {
      const status = (err as { status?: number }).status || 400;
      res.status(status).json({ error: err instanceof Error ? err.message : 'Ошибка запуска поиска' });
    }
  });

  app.get('/api/research/jobs', (_req, res) => {
    res.json({ jobs: loadResearchJobs() });
  });

  app.get('/api/research/jobs/:id', (req, res) => {
    const job = loadResearchJobs().find((j) => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Задание не найдено' });
    res.json({ job });
  });

  app.post('/api/research/jobs/:id/cancel', (req, res) => {
    try {
      const job = cancelResearchJob(req.params.id);
      res.json({ job });
    } catch (err) {
      const status = (err as { status?: number }).status || 404;
      res.status(status).json({ error: err instanceof Error ? err.message : 'Ошибка отмены' });
    }
  });

  app.get('/api/research/results', (_req, res) => {
    res.json({ results: loadResearchResults() });
  });

  app.get('/api/research/results/:id', (req, res) => {
    const item = loadResearchResults().find((r) => r.researchId === req.params.id);
    if (!item) return res.status(404).json({ error: 'Карточка не найдена' });
    res.json({ result: item });
  });

  app.patch('/api/research/results/:id', (req, res) => {
    const results = loadResearchResults();
    const idx = results.findIndex((r) => r.researchId === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Карточка не найдена' });
    results[idx] = { ...results[idx], ...(req.body || {}), researchId: results[idx].researchId };
    saveResearchResults(results);
    res.json({ result: results[idx] });
  });

  app.post('/api/research/results/:id/analyze', async (req, res) => {
    try {
      const updated = await reanalyzeResearchResult(req.params.id, false);
      res.json({ result: updated });
    } catch (err) {
      const status = (err as { status?: number }).status || formatGeminiError(err).status;
      res.status(status).json({ error: err instanceof Error ? err.message : 'Ошибка анализа' });
    }
  });

  app.post('/api/research/results/:id/generate-idea', async (req, res) => {
    try {
      const updated = await reanalyzeResearchResult(req.params.id, true);
      res.json({ result: updated });
    } catch (err) {
      const status = (err as { status?: number }).status || formatGeminiError(err).status;
      res.status(status).json({ error: err instanceof Error ? err.message : 'Ошибка генерации заготовки' });
    }
  });

  app.post('/api/research/results/:id/check-duplicate', (req, res) => {
    try {
      const updated = checkDuplicateForResult(req.params.id);
      res.json({ result: updated });
    } catch (err) {
      const status = (err as { status?: number }).status || 404;
      res.status(status).json({ error: err instanceof Error ? err.message : 'Ошибка проверки дублей' });
    }
  });

  app.post('/api/research/results/:id/approve', (req, res) => {
    try {
      const forceApprove = Boolean(req.body?.forceApprove);
      const output = approveResearchResultToDatabase(req.params.id, forceApprove);
      res.json({ ...output, snapshot: buildSnapshotResponse() });
    } catch (err) {
      const status = (err as { status?: number }).status || 400;
      const matches = (err as { matches?: unknown }).matches;
      res.status(status).json({
        error: err instanceof Error ? err.message : 'Ошибка одобрения',
        matches,
      });
    }
  });

  app.post('/api/research/results/:id/reject', (req, res) => {
    const results = loadResearchResults();
    const idx = results.findIndex((r) => r.researchId === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Карточка не найдена' });
    results[idx].queueStatus = 'rejected';
    saveResearchResults(results);
    res.json({ result: results[idx] });
  });

  app.get('/api/research/export/json', (_req, res) => {
    const results = loadResearchResults();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="melo_love_research.json"');
    res.send(JSON.stringify({ exportedAt: new Date().toISOString(), count: results.length, results }, null, 2));
  });

  app.get('/api/research/export/csv', (_req, res) => {
    const csv = researchResultsToCsv(loadResearchResults());
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="melo_love_research.csv"');
    res.send(csv);
  });

  app.post('/api/research/backup', (_req, res) => {
    const backup = createResearchBackup();
    res.json({ backup });
  });

  // ============================================================================
  // ЭТАП 3: STORY GENERATOR + MELO_LOVE VOICE ENGINE API
  // ============================================================================
  app.use('/api/content', createContentRouter());

  // ============================================================================
  // ЭТАП 4: CONTENT STUDIO + PUBLISHING INFRASTRUCTURE API
  // ============================================================================
  app.use('/api/publishing', createPublishingRouter());

  // ============================================================================
  // ЭТАП 5: AUTONOMOUS RESEARCH, PRODUCTION & PUBLISHING SCHEDULER API
  // ============================================================================
  app.use('/api/autonomous', createAutonomousRouter());

  // ============================================================================
  // VITE / STATIC SERVING
  // ============================================================================
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MELO_LOVE server running at http://localhost:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start MELO_LOVE server:', err);
  process.exit(1);
});
