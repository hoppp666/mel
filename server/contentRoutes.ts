import { Router } from 'express';
import {
  ContentDraft,
  ContentDraftStatus,
  ContentExportMode,
  ContentRevision,
  PhrasebookEntry,
  VoicePreset,
} from '../src/shared/types.js';
import {
  buildContentExportPayload,
  calculateContentQuality,
  countWords,
  extractEndingPattern,
  extractOpeningPattern,
} from '../src/shared/contentUtils.js';
import { loadDatabase } from './storage.js';
import {
  computeContentMetrics,
  createContentBackup,
  loadContentDrafts,
  loadPhrasebook,
  loadVoiceConfig,
  nextContentId,
  saveContentDrafts,
  savePhrasebook,
  saveVoiceConfig,
  syncStoryUsageStatus,
  SYSTEM_VOICE_PRESETS,
} from './contentStorage.js';
import { loadPublications, savePublications } from './publishingStorage.js';
import {
  cancelContentGeneration,
  generatePublicationsFromStory,
  isContentGenerationRunning,
  rewriteExistingDraft,
} from './contentGenerator.js';
import { formatGeminiError } from './geminiClient.js';

export function createContentRouter(): Router {
  const router = Router();

  router.get('/state', (_req, res) => {
    const db = loadDatabase();
    const availableStories = db.stories.filter(
      (s) => s.verificationStatus === 'approved' && s.usageStatus === 'unused'
    );
    res.json({
      metrics: computeContentMetrics(),
      availableStories,
      drafts: loadContentDrafts(),
      voiceConfig: loadVoiceConfig(),
      systemPresets: SYSTEM_VOICE_PRESETS,
      phrasebook: loadPhrasebook(),
      isGenerating: isContentGenerationRunning(),
    });
  });

  router.post('/generate', async (req, res) => {
    try {
      const { sourceStoryId, lengthPreset, narrativeStyle, variantsCount, voicePresetId } = req.body || {};
      if (!sourceStoryId) {
        return res.status(400).json({ error: 'Не указан sourceStoryId' });
      }
      const created = await generatePublicationsFromStory({
        sourceStoryId,
        lengthPreset: lengthPreset || 'standard',
        narrativeStyle,
        variantsCount: Number(variantsCount) || 1,
        voicePresetId,
      });
      res.status(201).json({ created, metrics: computeContentMetrics() });
    } catch (err) {
      const status = (err as { status?: number }).status || formatGeminiError(err).status;
      const message = err instanceof Error ? err.message : 'Ошибка генерации публикации';
      res.status(status).json({ error: message });
    }
  });

  router.post('/generate/cancel', (_req, res) => {
    const cancelled = cancelContentGeneration();
    res.json({ cancelled });
  });

  router.post('/drafts', (req, res) => {
    const body = req.body || {};
    const db = loadDatabase();
    const story = db.stories.find((s) => s.id === body.sourceStoryId);
    if (!story) {
      return res.status(404).json({ error: 'Исходный сюжет не найден в базе.' });
    }
    if (story.verificationStatus !== 'approved') {
      return res.status(400).json({ error: 'Нельзя создать черновик из неподтверждённого сюжета.' });
    }

    const drafts = loadContentDrafts();
    const voiceConfig = loadVoiceConfig();
    const phrasebook = loadPhrasebook();

    const title = String(body.title || story.title).trim();
    const textBody = String(body.body || '').trim();
    const triggerQuestion = String(body.triggerQuestion || story.mainTriggerQuestion).trim();
    if (!textBody) {
      return res.status(400).json({ error: 'Текст публикации не может быть пустым.' });
    }

    const quality = calculateContentQuality({
      collection: story.collection,
      title,
      body: textBody,
      triggerQuestion,
      sourceStory: story,
      recentDrafts: drafts,
      phrasebook,
      minScore: voiceConfig.minPublishQualityScore,
    });

    const requestedStatus: ContentDraftStatus = body.status || 'draft';
    if (
      (requestedStatus === 'ready_for_review' || requestedStatus === 'approved') &&
      quality.overall < voiceConfig.minPublishQualityScore
    ) {
      return res.status(400).json({
        error: `Оценка качества (${quality.overall}) ниже порога ${voiceConfig.minPublishQualityScore}.`,
      });
    }

    const now = new Date().toISOString();
    const draft: ContentDraft = {
      contentId: nextContentId(drafts, story.collection),
      sourceStoryId: story.id,
      collection: story.collection,
      category: story.category,
      subcategory: story.subcategory,
      title,
      subtitle: String(body.subtitle || '').trim(),
      body: textBody,
      triggerQuestion,
      wordCount: countWords(textBody),
      lengthPreset: body.lengthPreset || 'standard',
      narrativeStyle: body.narrativeStyle || 'action_start',
      voicePresetId: body.voicePresetId || voiceConfig.activePresetId,
      usedPhraseIds: [],
      usedPhrases: [],
      openingPattern: extractOpeningPattern(textBody),
      endingPattern: extractEndingPattern(textBody),
      status: requestedStatus,
      quality,
      autoRefined: false,
      completenessAuditNote: 'Создано вручную в редакторе MELO_LOVE',
      researchId: story.researchId,
      sourceUrl: story.sourceUrl || undefined,
      originType: story.originType,
      revisionHistory: [],
      createdAt: now,
      updatedAt: now,
    };

    drafts.unshift(draft);
    saveContentDrafts(drafts);
    syncStoryUsageStatus(story.id);
    res.status(201).json({ draft, metrics: computeContentMetrics() });
  });

  router.put('/drafts/:id', (req, res) => {
    const drafts = loadContentDrafts();
    const idx = drafts.findIndex((d) => d.contentId === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Черновик не найден' });

    const current = drafts[idx];
    const db = loadDatabase();
    const story = db.stories.find((s) => s.id === current.sourceStoryId);
    if (!story) return res.status(404).json({ error: 'Исходный сюжет не найден' });

    const voiceConfig = loadVoiceConfig();
    const phrasebook = loadPhrasebook();
    const updates = req.body || {};

    const nextTitle = updates.title !== undefined ? String(updates.title).trim() : current.title;
    const nextBody = updates.body !== undefined ? String(updates.body).trim() : current.body;
    const nextQuestion =
      updates.triggerQuestion !== undefined
        ? String(updates.triggerQuestion).trim()
        : current.triggerQuestion;

    const textChanged = nextTitle !== current.title || nextBody !== current.body || nextQuestion !== current.triggerQuestion;

    const snapshot: ContentRevision | null = textChanged
      ? {
          version: current.revisionHistory.length + 1,
          title: current.title,
          body: current.body,
          triggerQuestion: current.triggerQuestion,
          qualityScore: current.quality.overall,
          reason: String(updates.revisionReason || 'Ручная правка редактора'),
          createdAt: current.updatedAt,
        }
      : null;

    const quality = calculateContentQuality({
      collection: current.collection,
      title: nextTitle,
      body: nextBody,
      triggerQuestion: nextQuestion,
      sourceStory: story,
      recentDrafts: drafts.filter((d) => d.contentId !== current.contentId),
      phrasebook,
      minScore: voiceConfig.minPublishQualityScore,
    });

    const updated: ContentDraft = {
      ...current,
      title: nextTitle,
      subtitle: updates.subtitle !== undefined ? String(updates.subtitle).trim() : current.subtitle,
      body: nextBody,
      triggerQuestion: nextQuestion,
      wordCount: countWords(nextBody),
      openingPattern: extractOpeningPattern(nextBody),
      endingPattern: extractEndingPattern(nextBody),
      quality,
      revisionHistory: snapshot ? [snapshot, ...current.revisionHistory].slice(0, 20) : current.revisionHistory,
      updatedAt: new Date().toISOString(),
    };

    drafts[idx] = updated;
    saveContentDrafts(drafts);
    res.json({ draft: updated, metrics: computeContentMetrics() });
  });

  router.patch('/drafts/:id/status', (req, res) => {
    const drafts = loadContentDrafts();
    const idx = drafts.findIndex((d) => d.contentId === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Черновик не найден' });

    const nextStatus = req.body?.status as ContentDraftStatus | undefined;
    if (!nextStatus) return res.status(400).json({ error: 'Не указан status' });

    const voiceConfig = loadVoiceConfig();
    const current = drafts[idx];

    if (
      (nextStatus === 'ready_for_review' || nextStatus === 'approved') &&
      current.quality.overall < voiceConfig.minPublishQualityScore
    ) {
      return res.status(400).json({
        error: `Нельзя перевести в "${nextStatus}" при балле ${current.quality.overall} (требуется >= ${voiceConfig.minPublishQualityScore}).`,
      });
    }

    current.status = nextStatus;
    current.updatedAt = new Date().toISOString();
    drafts[idx] = current;
    saveContentDrafts(drafts);
    syncStoryUsageStatus(current.sourceStoryId);

    res.json({ draft: current, metrics: computeContentMetrics() });
  });

  router.post('/drafts/:id/rewrite', async (req, res) => {
    try {
      const mode = req.body?.mode;
      if (!mode) return res.status(400).json({ error: 'Не указан режим переписывания mode' });
      const updated = await rewriteExistingDraft(req.params.id, mode);
      res.json({ draft: updated, metrics: computeContentMetrics() });
    } catch (err) {
      const status = (err as { status?: number }).status || formatGeminiError(err).status;
      const message = err instanceof Error ? err.message : 'Ошибка переписывания';
      res.status(status).json({ error: message });
    }
  });

  router.post('/drafts/:id/restore-version', (req, res) => {
    const drafts = loadContentDrafts();
    const idx = drafts.findIndex((d) => d.contentId === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Черновик не найден' });

    const versionNum = Number(req.body?.version);
    const current = drafts[idx];
    const targetRev = current.revisionHistory.find((r) => r.version === versionNum);
    if (!targetRev) return res.status(404).json({ error: 'Версия не найдена в истории' });

    const db = loadDatabase();
    const story = db.stories.find((s) => s.id === current.sourceStoryId);
    if (!story) return res.status(404).json({ error: 'Исходный сюжет не найден' });

    const voiceConfig = loadVoiceConfig();
    const phrasebook = loadPhrasebook();

    const saveCurrentSnapshot: ContentRevision = {
      version: current.revisionHistory.length + 1,
      title: current.title,
      body: current.body,
      triggerQuestion: current.triggerQuestion,
      qualityScore: current.quality.overall,
      reason: `Снимок перед откатом к v${versionNum}`,
      createdAt: current.updatedAt,
    };

    const quality = calculateContentQuality({
      collection: current.collection,
      title: targetRev.title,
      body: targetRev.body,
      triggerQuestion: targetRev.triggerQuestion,
      sourceStory: story,
      recentDrafts: drafts.filter((d) => d.contentId !== current.contentId),
      phrasebook,
      minScore: voiceConfig.minPublishQualityScore,
    });

    const restored: ContentDraft = {
      ...current,
      title: targetRev.title,
      body: targetRev.body,
      triggerQuestion: targetRev.triggerQuestion,
      wordCount: countWords(targetRev.body),
      openingPattern: extractOpeningPattern(targetRev.body),
      endingPattern: extractEndingPattern(targetRev.body),
      quality,
      revisionHistory: [saveCurrentSnapshot, ...current.revisionHistory].slice(0, 20),
      updatedAt: new Date().toISOString(),
    };

    drafts[idx] = restored;
    saveContentDrafts(drafts);
    res.json({ draft: restored, metrics: computeContentMetrics() });
  });

  router.delete('/drafts/:id', (req, res) => {
    const drafts = loadContentDrafts();
    const target = drafts.find((d) => d.contentId === req.params.id);
    if (!target) return res.status(404).json({ error: 'Черновик не найден' });

    const filtered = drafts.filter((d) => d.contentId !== req.params.id);
    saveContentDrafts(filtered);

    const pubs = loadPublications();
    let pubsChanged = false;
    for (const pub of pubs) {
      if (pub.sourceDraftId === req.params.id) {
        delete pub.sourceDraftId;
        pubsChanged = true;
      }
    }
    if (pubsChanged) savePublications(pubs);

    syncStoryUsageStatus(target.sourceStoryId);
    res.json({ deleted: true, metrics: computeContentMetrics() });
  });

  router.put('/voice-config', (req, res) => {
    const current = loadVoiceConfig();
    const body = req.body || {};
    const updated = {
      ...current,
      activePresetId: body.activePresetId || current.activePresetId,
      debate: body.debate ? { ...current.debate, ...body.debate } : current.debate,
      romantic: body.romantic ? { ...current.romantic, ...body.romantic } : current.romantic,
      minPublishQualityScore:
        typeof body.minPublishQualityScore === 'number'
          ? Math.max(60, Math.min(98, Math.round(body.minPublishQualityScore)))
          : current.minPublishQualityScore,
      updatedAt: new Date().toISOString(),
    };
    saveVoiceConfig(updated);
    res.json({ voiceConfig: updated });
  });

  router.post('/voice-presets', (req, res) => {
    const { name, description, debate, romantic } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Укажите название профиля' });
    }
    const config = loadVoiceConfig();
    const preset: VoicePreset = {
      id: `custom-${Date.now().toString(36)}`,
      name: String(name).trim(),
      description: String(description || 'Пользовательский профиль MELO_LOVE').trim(),
      debate: debate || config.debate,
      romantic: romantic || config.romantic,
      isSystem: false,
    };
    config.customPresets.push(preset);
    config.activePresetId = preset.id;
    saveVoiceConfig(config);
    res.status(201).json({ voiceConfig: config, preset });
  });

  router.delete('/voice-presets/:id', (req, res) => {
    const config = loadVoiceConfig();
    config.customPresets = config.customPresets.filter((p) => p.id !== req.params.id);
    if (config.activePresetId === req.params.id) {
      config.activePresetId = SYSTEM_VOICE_PRESETS[0].id;
    }
    saveVoiceConfig(config);
    res.json({ voiceConfig: config });
  });

  router.get('/phrasebook', (_req, res) => {
    res.json({ phrasebook: loadPhrasebook() });
  });

  router.post('/phrasebook', (req, res) => {
    const { phrase, meaningNote, collectionScope, toneTag, weight, maxFrequencyPer10, banned } = req.body || {};
    if (!phrase || !String(phrase).trim()) {
      return res.status(400).json({ error: 'Фраза не может быть пустой' });
    }
    const entries = loadPhrasebook();
    const entry: PhrasebookEntry = {
      id: `PHR-${Date.now().toString(36).toUpperCase()}`,
      phrase: String(phrase).trim(),
      meaningNote: String(meaningNote || '').trim(),
      collectionScope: collectionScope || 'both',
      toneTag: String(toneTag || 'авторское').trim(),
      weight: Math.max(1, Math.min(10, Number(weight) || 7)),
      maxFrequencyPer10: Math.max(1, Math.min(10, Number(maxFrequencyPer10) || 2)),
      banned: Boolean(banned),
      recentUsageCount: 0,
      totalUsageCount: 0,
      createdAt: new Date().toISOString(),
    };
    entries.unshift(entry);
    savePhrasebook(entries);
    res.status(201).json({ entry, phrasebook: entries });
  });

  router.put('/phrasebook/:id', (req, res) => {
    const entries = loadPhrasebook();
    const idx = entries.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Выражение не найдено' });

    const body = req.body || {};
    entries[idx] = {
      ...entries[idx],
      phrase: body.phrase !== undefined ? String(body.phrase).trim() : entries[idx].phrase,
      meaningNote: body.meaningNote !== undefined ? String(body.meaningNote).trim() : entries[idx].meaningNote,
      collectionScope: body.collectionScope || entries[idx].collectionScope,
      toneTag: body.toneTag !== undefined ? String(body.toneTag).trim() : entries[idx].toneTag,
      weight: body.weight !== undefined ? Number(body.weight) : entries[idx].weight,
      maxFrequencyPer10:
        body.maxFrequencyPer10 !== undefined ? Number(body.maxFrequencyPer10) : entries[idx].maxFrequencyPer10,
      banned: body.banned !== undefined ? Boolean(body.banned) : entries[idx].banned,
    };
    savePhrasebook(entries);
    res.json({ entry: entries[idx], phrasebook: entries });
  });

  router.delete('/phrasebook/:id', (req, res) => {
    const entries = loadPhrasebook();
    const filtered = entries.filter((p) => p.id !== req.params.id);
    savePhrasebook(filtered);
    res.json({ phrasebook: filtered });
  });

  router.post('/export', (req, res) => {
    const mode = (req.body?.mode as ContentExportMode) || 'with_source';
    const ids = Array.isArray(req.body?.contentIds) ? (req.body.contentIds as string[]) : null;
    const drafts = loadContentDrafts();
    const selected = ids && ids.length > 0 ? drafts.filter((d) => ids.includes(d.contentId)) : drafts;
    const db = loadDatabase();
    const storiesMap = new Map(db.stories.map((s) => [s.id, s]));
    const payload = buildContentExportPayload(selected, storiesMap, mode);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="melo_love_content_${mode}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  });

  router.post('/import', (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : Array.isArray(req.body) ? req.body : null;
    if (!items) {
      return res.status(400).json({ error: 'Ожидается JSON с массивом items' });
    }
    const db = loadDatabase();
    const storyIds = new Set(db.stories.map((s) => s.id));
    const drafts = loadContentDrafts();
    const existingIds = new Set(drafts.map((d) => d.contentId));

    let imported = 0;
    const errors: string[] = [];

    for (const item of items) {
      if (!item || !item.sourceStoryId || !item.body || !item.title) {
        errors.push(`Пропущена некорректная запись без title/body/sourceStoryId`);
        continue;
      }
      if (!storyIds.has(item.sourceStoryId)) {
        errors.push(`Отклонено (${item.title}): sourceStoryId "${item.sourceStoryId}" не найден в базе сюжетов`);
        continue;
      }
      const cid =
        item.contentId && !existingIds.has(item.contentId)
          ? String(item.contentId)
          : nextContentId(drafts, item.collection === 'romantic' ? 'romantic' : 'debate');

      existingIds.add(cid);
      const story = db.stories.find((s) => s.id === item.sourceStoryId)!;
      const now = new Date().toISOString();

      const draft: ContentDraft = {
        contentId: cid,
        sourceStoryId: story.id,
        collection: story.collection,
        category: item.category || story.category,
        subcategory: item.subcategory || story.subcategory,
        title: String(item.title),
        subtitle: String(item.subtitle || ''),
        body: String(item.body),
        triggerQuestion: String(item.triggerQuestion || story.mainTriggerQuestion),
        wordCount: countWords(String(item.body)),
        lengthPreset: item.lengthPreset || 'standard',
        narrativeStyle: item.narrativeStyle || 'action_start',
        voicePresetId: item.voicePresetId || 'melo-standard',
        usedPhraseIds: Array.isArray(item.usedPhraseIds) ? item.usedPhraseIds : [],
        usedPhrases: Array.isArray(item.usedPhrases) ? item.usedPhrases : [],
        openingPattern: extractOpeningPattern(String(item.body)),
        endingPattern: extractEndingPattern(String(item.body)),
        status: item.status || 'draft',
        quality:
          item.quality && typeof item.quality.overall === 'number'
            ? item.quality
            : calculateContentQuality({
                collection: story.collection,
                title: String(item.title),
                body: String(item.body),
                triggerQuestion: String(item.triggerQuestion || story.mainTriggerQuestion),
                sourceStory: story,
                recentDrafts: drafts,
                phrasebook: loadPhrasebook(),
              }),
        autoRefined: Boolean(item.autoRefined),
        completenessAuditNote: item.completenessAuditNote || 'Импортировано из JSON',
        researchId: story.researchId,
        sourceUrl: story.sourceUrl || undefined,
        originType: story.originType,
        revisionHistory: Array.isArray(item.revisionHistory) ? item.revisionHistory : [],
        createdAt: item.createdAt || now,
        updatedAt: now,
      };
      drafts.unshift(draft);
      syncStoryUsageStatus(story.id);
      imported++;
    }

    if (imported === 0 && errors.length > 0) {
      return res.status(400).json({ error: errors[0], errors });
    }

    saveContentDrafts(drafts);
    res.json({ imported, errors, metrics: computeContentMetrics() });
  });

  router.post('/backup', (_req, res) => {
    const backup = createContentBackup();
    res.json({ backup });
  });

  return router;
}
