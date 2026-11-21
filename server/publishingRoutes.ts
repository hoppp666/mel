import { Router } from 'express';
import {
  PublicationItem,
  PublicationRevision,
  PublishingQueueStatus,
  PublishingSettings,
} from '../src/shared/types.js';
import {
  formatPublicationJson,
  formatPublicationTxt,
  normalizeHashtagsList,
} from '../src/shared/publishingUtils.js';
import { loadDatabase } from './storage.js';
import { loadContentDrafts } from './contentStorage.js';
import {
  appendPublishingLog,
  computePublishingAnalytics,
  createPublishingBackup,
  enrichPublicationMetrics,
  getTelegramIntegrationStatus,
  loadPublications,
  loadPublishingLogs,
  loadPublishingSettings,
  nextPublicationId,
  savePublications,
  savePublishingSettings,
  syncStoryPublishedStatus,
} from './publishingStorage.js';
import {
  dispatchPublicationToTelegram,
  processDueScheduledPublications,
  testTelegramConnection,
} from './telegramPublisher.js';
import {
  generateAlternativeHeadlines,
  seoAdaptForDzen,
  shortenForTelegramLimit,
  suggestHashtagsForPublication,
} from './studioAiAssistant.js';
import {
  FULL_SUPABASE_SCHEMA_SQL,
  prepareOrRunSupabaseMigration,
} from './supabaseMigration.js';
import { formatGeminiError } from './geminiClient.js';

export function createPublishingRouter(): Router {
  const router = Router();

  router.get('/state', (_req, res) => {
    const db = loadDatabase();
    const drafts = loadContentDrafts();
    const publications = loadPublications().map((p) => enrichPublicationMetrics(p));
    const settings = loadPublishingSettings();
    const status = getTelegramIntegrationStatus();
    const analytics = computePublishingAnalytics();
    const logs = loadPublishingLogs().slice(0, 60);

    const eligibleDrafts = drafts.filter(
      (d) => d.status === 'approved' || d.status === 'ready_for_review'
    );
    const eligibleStories = db.stories.filter(
      (s) => s.verificationStatus === 'approved'
    );

    res.json({
      publications,
      settings,
      integrationStatus: status,
      analytics,
      logs,
      eligibleDrafts,
      eligibleStories,
    });
  });

  router.post('/publications', (req, res) => {
    const body = req.body || {};
    const db = loadDatabase();
    const drafts = loadContentDrafts();
    const items = loadPublications();
    const settings = loadPublishingSettings();

    const sourceDraft = body.sourceDraftId
      ? drafts.find((d) => d.contentId === body.sourceDraftId)
      : undefined;

    const resolvedStoryId = body.sourceStoryId || sourceDraft?.sourceStoryId;
    const story = db.stories.find((s) => s.id === resolvedStoryId);
    if (!story) {
      return res.status(404).json({ error: 'Исходный сюжет не найден в базе (sourceStoryId).' });
    }

    const title = String(body.title ?? sourceDraft?.title ?? story.title).trim();
    const teaser = String(body.teaser ?? sourceDraft?.subtitle ?? story.shortDescription).trim();
    const textBody = String(body.body ?? sourceDraft?.body ?? story.fullPlot).trim();
    const closingQuestion = String(
      body.closingQuestion ?? sourceDraft?.triggerQuestion ?? story.mainTriggerQuestion
    ).trim();

    const rawTags = Array.isArray(body.hashtags)
      ? body.hashtags
      : (story.keywords || []).slice(0, 4);
    const hashtags = normalizeHashtagsList(rawTags).slice(0, 5);

    const now = new Date().toISOString();
    const pubId = nextPublicationId(items, story.collection);
    const newItem = enrichPublicationMetrics(
      {
        publicationId: pubId,
        sourceDraftId: sourceDraft?.contentId,
        sourceStoryId: story.id,
        researchId: sourceDraft?.researchId || story.researchId,
        sourceUrl: sourceDraft?.sourceUrl || story.sourceUrl || undefined,
        collection: story.collection,
        category: story.category,
        subcategory: story.subcategory,
        title,
        alternativeTitles: [],
        teaser,
        body: textBody,
        closingQuestion,
        hashtags,
        hasImageAttachment: Boolean(body.hasImageAttachment),
        totalChars: 0,
        remainingChars: settings.safeTelegramCharLimit,
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
        status: 'draft',
        idempotencyKey: `${pubId}-${Date.now().toString(36)}`,
        revisionHistory: [],
        createdAt: now,
        updatedAt: now,
      },
      settings.safeTelegramCharLimit
    );

    items.unshift(newItem);
    savePublications(items);
    appendPublishingLog({
      publicationId: pubId,
      action: 'created',
      status: 'draft',
      detail: `Создана публикация на основе сюжета ${story.id}${sourceDraft ? ` (черновик ${sourceDraft.contentId})` : ''}.`,
    });

    res.status(201).json({ publication: newItem, analytics: computePublishingAnalytics() });
  });

  router.put('/publications/:id', (req, res) => {
    const items = loadPublications();
    const idx = items.findIndex((p) => p.publicationId === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Публикация не найдена' });

    const current = items[idx];
    const updates = req.body || {};
    const settings = loadPublishingSettings();

    const nextTitle = updates.title !== undefined ? String(updates.title).trim() : current.title;
    const nextTeaser = updates.teaser !== undefined ? String(updates.teaser).trim() : current.teaser;
    const nextBody = updates.body !== undefined ? String(updates.body).trim() : current.body;
    const nextQuestion =
      updates.closingQuestion !== undefined
        ? String(updates.closingQuestion).trim()
        : current.closingQuestion;
    const nextHashtags =
      updates.hashtags !== undefined
        ? normalizeHashtagsList(Array.isArray(updates.hashtags) ? updates.hashtags : []).slice(0, 5)
        : current.hashtags;

    const changed =
      nextTitle !== current.title ||
      nextTeaser !== current.teaser ||
      nextBody !== current.body ||
      nextQuestion !== current.closingQuestion ||
      nextHashtags.join(' ') !== current.hashtags.join(' ');

    const snapshot: PublicationRevision | null = changed
      ? {
          version: current.revisionHistory.length + 1,
          title: current.title,
          teaser: current.teaser,
          body: current.body,
          closingQuestion: current.closingQuestion,
          hashtags: current.hashtags,
          reason: String(updates.revisionReason || 'Правка в Content Studio'),
          createdAt: current.updatedAt,
        }
      : null;

    const updated = enrichPublicationMetrics(
      {
        ...current,
        title: nextTitle,
        teaser: nextTeaser,
        body: nextBody,
        closingQuestion: nextQuestion,
        hashtags: nextHashtags,
        hasImageAttachment:
          updates.hasImageAttachment !== undefined
            ? Boolean(updates.hasImageAttachment)
            : current.hasImageAttachment,
        seoNotes: updates.seoNotes !== undefined ? String(updates.seoNotes) : current.seoNotes,
        seoKeywords:
          Array.isArray(updates.seoKeywords) ? updates.seoKeywords : current.seoKeywords,
        alternativeTitles: Array.isArray(updates.alternativeTitles)
          ? updates.alternativeTitles
          : current.alternativeTitles,
        scheduledAt:
          updates.scheduledAt !== undefined ? updates.scheduledAt : current.scheduledAt,
        manualStats: updates.manualStats !== undefined ? updates.manualStats : current.manualStats,
        revisionHistory: snapshot
          ? [snapshot, ...current.revisionHistory].slice(0, 25)
          : current.revisionHistory,
        updatedAt: new Date().toISOString(),
      },
      settings.safeTelegramCharLimit
    );

    items[idx] = updated;
    savePublications(items);
    res.json({ publication: updated, analytics: computePublishingAnalytics() });
  });

  router.patch('/publications/:id/status', (req, res) => {
    const items = loadPublications();
    const idx = items.findIndex((p) => p.publicationId === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Публикация не найдена' });

    const current = enrichPublicationMetrics(items[idx]);
    const nextStatus = req.body?.status as PublishingQueueStatus | undefined;
    if (!nextStatus) return res.status(400).json({ error: 'Не указан status' });

    // Do not allow scheduling or queuing for Telegram if exceeding 3800 chars
    if (nextStatus === 'scheduled' && current.exceedsTelegramLimit) {
      return res.status(400).json({
        error: `Нельзя поставить в автоочередь Telegram: длина ${current.totalChars} симв. превышает лимит 3800. Сократите текст или экспортируйте для ручной публикации в Дзене.`,
      });
    }

    // Never allow jumping to zen_delivery_verified without explicit confirmation source
    if (nextStatus === 'zen_delivery_verified') {
      current.zenConfirmedAt = new Date().toISOString();
      current.zenConfirmedSource = String(
        req.body?.confirmationSource || 'manual_owner_confirmation'
      );
      syncStoryPublishedStatus(current.sourceStoryId, 'zen_delivery_verified');
    }

    current.status = nextStatus;
    if (req.body?.scheduledAt !== undefined) {
      current.scheduledAt = req.body.scheduledAt;
    }
    current.updatedAt = new Date().toISOString();

    items[idx] = current;
    savePublications(items);
    appendPublishingLog({
      publicationId: current.publicationId,
      action: 'status_change',
      status: nextStatus,
      detail: `Статус изменён на ${nextStatus}.`,
    });

    res.json({ publication: current, analytics: computePublishingAnalytics() });
  });

  router.post('/publications/:id/restore-version', (req, res) => {
    const items = loadPublications();
    const idx = items.findIndex((p) => p.publicationId === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Публикация не найдена' });

    const current = items[idx];
    const vNum = Number(req.body?.version);
    const target = current.revisionHistory.find((r) => r.version === vNum);
    if (!target) return res.status(404).json({ error: 'Версия не найдена' });

    const snapshot: PublicationRevision = {
      version: current.revisionHistory.length + 1,
      title: current.title,
      teaser: current.teaser,
      body: current.body,
      closingQuestion: current.closingQuestion,
      hashtags: current.hashtags,
      reason: `Снимок перед откатом к v${vNum}`,
      createdAt: current.updatedAt,
    };

    const restored = enrichPublicationMetrics({
      ...current,
      title: target.title,
      teaser: target.teaser,
      body: target.body,
      closingQuestion: target.closingQuestion,
      hashtags: target.hashtags,
      revisionHistory: [snapshot, ...current.revisionHistory].slice(0, 25),
      updatedAt: new Date().toISOString(),
    });

    items[idx] = restored;
    savePublications(items);
    res.json({ publication: restored, analytics: computePublishingAnalytics() });
  });

  router.delete('/publications/:id', (req, res) => {
    const items = loadPublications();
    if (!items.some((p) => p.publicationId === req.params.id)) {
      return res.status(404).json({ error: 'Публикация не найдена' });
    }
    savePublications(items.filter((p) => p.publicationId !== req.params.id));
    res.json({ deleted: true, analytics: computePublishingAnalytics() });
  });

  // AI Assistants for Content Studio
  router.post('/publications/:id/ai-headlines', async (req, res) => {
    try {
      const items = loadPublications();
      const idx = items.findIndex((p) => p.publicationId === req.params.id);
      if (idx === -1) return res.status(404).json({ error: 'Публикация не найдена' });

      const headlines = await generateAlternativeHeadlines(items[idx]);
      items[idx].alternativeTitles = headlines;
      items[idx].updatedAt = new Date().toISOString();
      savePublications(items);
      res.json({ headlines, publication: items[idx] });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  router.post('/publications/:id/ai-seo', async (req, res) => {
    try {
      const items = loadPublications();
      const item = items.find((p) => p.publicationId === req.params.id);
      if (!item) return res.status(404).json({ error: 'Публикация не найдена' });
      const proposal = await seoAdaptForDzen(item);
      res.json({ proposal });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  router.post('/publications/:id/ai-shorten', async (req, res) => {
    try {
      const items = loadPublications();
      const item = items.find((p) => p.publicationId === req.params.id);
      if (!item) return res.status(404).json({ error: 'Публикация не найдена' });
      const proposal = await shortenForTelegramLimit(item);
      res.json({ proposal });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  router.post('/publications/:id/ai-hashtags', async (req, res) => {
    try {
      const items = loadPublications();
      const item = items.find((p) => p.publicationId === req.params.id);
      if (!item) return res.status(404).json({ error: 'Публикация не найдена' });
      const hashtags = await suggestHashtagsForPublication(item);
      res.json({ hashtags });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Telegram & Dzen dispatch
  router.post('/publications/:id/send-telegram', async (req, res) => {
    try {
      const dryRunOverride =
        typeof req.body?.dryRun === 'boolean' ? req.body.dryRun : undefined;
      const result = await dispatchPublicationToTelegram(req.params.id, { dryRunOverride });
      res.json({
        ...result,
        analytics: computePublishingAnalytics(),
      });
    } catch (err) {
      const status = (err as { status?: number }).status || 400;
      res.status(status).json({ error: err instanceof Error ? err.message : 'Ошибка отправки в Telegram' });
    }
  });

  router.post('/publications/:id/confirm-zen', (req, res) => {
    const items = loadPublications();
    const idx = items.findIndex((p) => p.publicationId === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Публикация не найдена' });

    const current = items[idx];
    const now = new Date().toISOString();
    const stats = req.body?.manualStats;

    const updated: PublicationItem = {
      ...current,
      status: 'zen_delivery_verified',
      zenConfirmedAt: now,
      zenConfirmedSource: String(req.body?.source || 'manual_owner_confirmation'),
      manualStats: stats
        ? {
            views: typeof stats.views === 'number' ? stats.views : current.manualStats?.views,
            reads: typeof stats.reads === 'number' ? stats.reads : current.manualStats?.reads,
            reactions:
              typeof stats.reactions === 'number'
                ? stats.reactions
                : current.manualStats?.reactions,
            updatedAt: now,
          }
        : current.manualStats,
      updatedAt: now,
    };

    items[idx] = updated;
    savePublications(items);
    syncStoryPublishedStatus(updated.sourceStoryId, 'zen_delivery_verified');

    appendPublishingLog({
      publicationId: updated.publicationId,
      action: 'zen_confirmed',
      status: 'zen_delivery_verified',
      detail: `Подтверждена публикация в Дзене (${updated.zenConfirmedSource}).`,
    });

    res.json({ publication: updated, analytics: computePublishingAnalytics() });
  });

  router.post('/queue/process-due', async (_req, res) => {
    const summary = await processDueScheduledPublications();
    res.json({ summary, analytics: computePublishingAnalytics() });
  });

  router.get('/publications/:id/export/txt', (req, res) => {
    const item = loadPublications().find((p) => p.publicationId === req.params.id);
    if (!item) return res.status(404).json({ error: 'Публикация не найдена' });
    const txt = formatPublicationTxt(enrichPublicationMetrics(item));
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${item.publicationId}.txt"`);
    res.send(txt);
  });

  router.get('/publications/:id/export/json', (req, res) => {
    const item = loadPublications().find((p) => p.publicationId === req.params.id);
    if (!item) return res.status(404).json({ error: 'Публикация не найдена' });
    const db = loadDatabase();
    const story = db.stories.find((s) => s.id === item.sourceStoryId) || null;
    const json = formatPublicationJson(enrichPublicationMetrics(item), story);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${item.publicationId}.json"`);
    res.send(json);
  });

  router.put('/settings', (req, res) => {
    const current = loadPublishingSettings();
    const body = req.body || {};
    const updated: PublishingSettings = {
      ...current,
      autoSendEnabled:
        typeof body.autoSendEnabled === 'boolean' ? body.autoSendEnabled : current.autoSendEnabled,
      dryRunMode: typeof body.dryRunMode === 'boolean' ? body.dryRunMode : current.dryRunMode,
      telegramChannelRef:
        body.telegramChannelRef !== undefined
          ? String(body.telegramChannelRef).trim()
          : current.telegramChannelRef,
      dzenChannelName:
        body.dzenChannelName !== undefined
          ? String(body.dzenChannelName).trim()
          : current.dzenChannelName,
      dzenSyncMode: body.dzenSyncMode === 'manual_forward' ? 'manual_forward' : 'automatic',
      utmSource: body.utmSource !== undefined ? String(body.utmSource).trim() : current.utmSource,
      updatedAt: new Date().toISOString(),
    };
    savePublishingSettings(updated);
    res.json({ settings: updated, integrationStatus: getTelegramIntegrationStatus() });
  });

  router.post('/test-telegram', async (_req, res) => {
    const result = await testTelegramConnection();
    res.json(result);
  });

  router.post('/backup', (_req, res) => {
    const backup = createPublishingBackup();
    res.json({ backup });
  });

  router.get('/supabase/schema', (_req, res) => {
    res.json({ sql: FULL_SUPABASE_SCHEMA_SQL });
  });

  router.post('/supabase/prepare-migration', async (req, res) => {
    const executeLiveSync = Boolean(req.body?.executeLiveSync);
    const report = await prepareOrRunSupabaseMigration({ executeLiveSync });
    res.json({ report });
  });

  return router;
}
