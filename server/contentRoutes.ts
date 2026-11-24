import type { Express, Request, Response } from 'express';
import {
  buildContentExportObject,
  buildContentSemanticFingerprint,
  countWords,
  extractFirstSentence,
  extractLastSentence,
} from '../src/shared/contentUtils.ts';
import type {
  CollectionType,
  ContentDraft,
  ContentDraftStatus,
  ContentLengthPreset,
  NarrativeStructurePattern,
  PhrasebookEntry,
  PhrasebookTone,
  RewriteActionType,
  VoiceEngineConfig,
  VoiceSliders,
} from '../src/shared/types.ts';
import {
  buildDraftRecordFromCandidate,
  cancelContentTask,
  generatePublicationCandidate,
  generateVariantsCandidates,
  getActiveContentTaskIds,
  rewriteDraftContent,
  runContentQualityControl,
} from './contentGenerator.ts';
import {
  computeContentStatistics,
  createContentBackupSnapshot,
  enrichDraftDerivedFields,
  generateNextContentId,
  listContentBackupSnapshots,
  loadContentDrafts,
  loadPhrasebook,
  loadVoiceConfig,
  recomputePhrasebookUsage,
  saveContentDrafts,
  savePhrasebook,
  saveVoiceConfig,
  syncSourceStoryUsageStatus,
} from './contentStorage.ts';
import { loadDatabase } from './storage.ts';

const ALLOWED_DRAFT_STATUSES: ContentDraftStatus[] = [
  'generating',
  'draft',
  'needs_revision',
  'ready_for_review',
  'approved',
  'rejected',
  'archived',
];

function formatContentRouteError(err: unknown, fallback: string): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : fallback;
  if (/Уже выполняется|максимальное количество/i.test(raw)) {
    return { status: 409, message: raw };
  }
  if (/отменена/i.test(raw)) {
    return { status: 499, message: raw };
  }
  if (/RESOURCE_EXHAUSTED|429|quota/i.test(raw)) {
    return {
      status: 429,
      message:
        'Исчерпана текущая квота Gemini API (429 RESOURCE_EXHAUSTED). Повторите попытку позже или проверьте лимиты ключа GEMINI_API_KEY. Исходный сюжет не изменён.',
    };
  }
  if (/503|UNAVAILABLE|high demand/i.test(raw)) {
    return {
      status: 503,
      message:
        'Модель Gemini временно перегружена (503 UNAVAILABLE). Повторите запрос чуть позже. Исходный сюжет не изменён.',
    };
  }
  if (/504|DEADLINE_EXCEEDED|Таймаут/i.test(raw)) {
    return {
      status: 504,
      message:
        'Превышено время ожидания ответа от Gemini API (504). Повторите попытку. Исходный сюжет не изменён.',
    };
  }
  return { status: 500, message: raw || fallback };
}

export function registerContentRoutes(app: Express): void {
  // Overview & statistics
  app.get('/api/content/statistics', (_req: Request, res: Response) => {
    const db = loadDatabase();
    const drafts = loadContentDrafts();
    const phrasebook = recomputePhrasebookUsage(drafts, loadPhrasebook());
    const stats = computeContentStatistics(db.stories, drafts, phrasebook);
    res.json({
      stats,
      activeTaskIds: getActiveContentTaskIds(),
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      backups: listContentBackupSnapshots(),
    });
  });

  // Eligible source stories (ONLY verificationStatus === 'approved' AND usageStatus === 'unused' by default)
  app.get('/api/content/available-stories', (req: Request, res: Response) => {
    const db = loadDatabase();
    const drafts = loadContentDrafts();
    const collection = req.query.collection as string | undefined;
    const category = req.query.category as string | undefined;
    const includeDrafted = req.query.includeDrafted === 'true';
    const hasResearch = req.query.hasResearch as string | undefined;
    const search = String(req.query.search || '').trim().toLowerCase();

    let stories = db.stories.filter((s) => s.verificationStatus === 'approved');
    if (!includeDrafted) {
      stories = stories.filter((s) => s.usageStatus === 'unused');
    } else {
      stories = stories.filter((s) => s.usageStatus === 'unused' || s.usageStatus === 'drafted');
    }

    if (collection === 'debate' || collection === 'romantic') {
      stories = stories.filter((s) => s.collection === collection);
    }
    if (category && category !== 'ALL') {
      stories = stories.filter((s) => s.category === category);
    }
    if (hasResearch === 'true') {
      stories = stories.filter((s) => Boolean(s.researchId) || s.originType === 'external');
    } else if (hasResearch === 'false') {
      stories = stories.filter((s) => !s.researchId && s.originType === 'original');
    }
    if (search) {
      stories = stories.filter(
        (s) =>
          s.id.toLowerCase().includes(search) ||
          s.title.toLowerCase().includes(search) ||
          s.shortDescription.toLowerCase().includes(search) ||
          s.category.toLowerCase().includes(search)
      );
    }

    const enriched = stories.map((story) => {
      const linkedDrafts = drafts.filter(
        (d) => d.sourceStoryId === story.id && d.status !== 'rejected'
      );
      return {
        ...story,
        linkedDraftsCount: linkedDrafts.length,
      };
    });

    res.json({ stories: enriched });
  });

  // Generate publication candidate (does NOT mutate STORY DATABASE usageStatus until saved as draft)
  app.post('/api/content/generate', async (req: Request, res: Response) => {
    try {
      const {
        sourceStoryId,
        voiceProfileId,
        voiceSlidersOverride,
        lengthPreset,
        narrativeStructure,
        autoSaveDraft,
        taskId,
      } = req.body as {
        sourceStoryId?: string;
        voiceProfileId?: string;
        voiceSlidersOverride?: Partial<VoiceSliders>;
        lengthPreset?: ContentLengthPreset;
        narrativeStructure?: NarrativeStructurePattern | 'auto';
        autoSaveDraft?: boolean;
        taskId?: string;
      };

      if (!sourceStoryId) {
        res.status(400).json({ error: 'Не указан ID исходного сюжета (sourceStoryId).' });
        return;
      }

      const db = loadDatabase();
      const story = db.stories.find((s) => s.id === sourceStoryId);
      if (!story) {
        res.status(404).json({ error: `Исходный сюжет ${sourceStoryId} не найден.` });
        return;
      }
      if (story.verificationStatus !== 'approved') {
        res.status(400).json({
          error: `Сюжет ${story.id} имеет статус проверки «${story.verificationStatus}». Для генерации допускаются только подтверждённые (approved) сюжеты.`,
        });
        return;
      }
      if (story.usageStatus !== 'unused') {
        res.status(409).json({
          error: `Сюжет ${story.id} уже имеет статус использования «${story.usageStatus}». Для новой генерации выбирайте неиспользованные (unused) сюжеты или создавайте вариант из черновиков.`,
        });
        return;
      }

      const existingDrafts = loadContentDrafts();
      const existingForStory = existingDrafts.filter(
        (d) => d.sourceStoryId === story.id && d.status !== 'rejected'
      );
      if (existingForStory.length >= 3) {
        res.status(409).json({
          error: `Для сюжета ${story.id} уже создано максимальное количество вариантов (3).`,
        });
        return;
      }

      const candidate = await generatePublicationCandidate({
        story,
        voiceProfileId,
        voiceSlidersOverride,
        lengthPreset: lengthPreset || 'standard',
        narrativeStructure: narrativeStructure || 'auto',
        variantIndex: existingForStory.length,
        taskId,
      });

      if (autoSaveDraft) {
        const freshDrafts = loadContentDrafts();
        const savedDraft = buildDraftRecordFromCandidate(candidate, freshDrafts);
        const nextDrafts = [savedDraft, ...freshDrafts];
        saveContentDrafts(nextDrafts);
        recomputePhrasebookUsage(nextDrafts, loadPhrasebook());
        syncSourceStoryUsageStatus(story.id, nextDrafts, 'draft_saved');
        res.status(201).json({ candidate: savedDraft, savedDraft });
        return;
      }

      res.json({ candidate });
    } catch (err) {
      const { status, message } = formatContentRouteError(err, 'Ошибка генерации публикации.');
      res.status(status).json({ error: message });
    }
  });

  // Generate up to 3 distinct variants for a story
  app.post('/api/content/generate-variants', async (req: Request, res: Response) => {
    try {
      const { sourceStoryId, count, voiceProfileId, voiceSlidersOverride, lengthPreset, taskId } =
        req.body as {
          sourceStoryId?: string;
          count?: number;
          voiceProfileId?: string;
          voiceSlidersOverride?: Partial<VoiceSliders>;
          lengthPreset?: ContentLengthPreset;
          taskId?: string;
        };

      if (!sourceStoryId) {
        res.status(400).json({ error: 'Не указан ID исходного сюжета (sourceStoryId).' });
        return;
      }

      const db = loadDatabase();
      const story = db.stories.find((s) => s.id === sourceStoryId);
      if (!story) {
        res.status(404).json({ error: `Исходный сюжет ${sourceStoryId} не найден.` });
        return;
      }
      if (story.verificationStatus !== 'approved') {
        res.status(400).json({
          error: `Сюжет ${story.id} не подтверждён (verificationStatus=${story.verificationStatus}).`,
        });
        return;
      }

      const variants = await generateVariantsCandidates({
        story,
        count: Math.max(1, Math.min(3, Number(count || 3))),
        voiceProfileId,
        voiceSlidersOverride,
        lengthPreset: lengthPreset || 'standard',
        taskId,
      });

      res.json({ variants });
    } catch (err) {
      const { status, message } = formatContentRouteError(err, 'Ошибка генерации вариантов.');
      res.status(status).json({ error: message });
    }
  });

  // Cancel active generation task
  app.post('/api/content/tasks/:taskId/cancel', (req: Request, res: Response) => {
    const ok = cancelContentTask(req.params.taskId);
    res.json({ ok });
  });

  // Full rewrite of draft or unsaved candidate
  app.post('/api/content/rewrite', async (req: Request, res: Response) => {
    try {
      const { draftId, draftSnapshot, action, customInstruction, taskId } = req.body as {
        draftId?: string;
        draftSnapshot?: Partial<ContentDraft>;
        action?: RewriteActionType;
        customInstruction?: string;
        taskId?: string;
      };

      const drafts = loadContentDrafts();
      const existing = draftId ? drafts.find((d) => d.id === draftId) : undefined;
      const workingDraft = (existing || draftSnapshot) as ContentDraft | undefined;

      if (!workingDraft || !workingDraft.sourceStoryId || !workingDraft.body) {
        res.status(400).json({ error: 'Не переданы данные черновика для переписывания.' });
        return;
      }

      const db = loadDatabase();
      const story = db.stories.find((s) => s.id === workingDraft.sourceStoryId);
      if (!story) {
        res.status(404).json({ error: `Исходный сюжет ${workingDraft.sourceStoryId} не найден.` });
        return;
      }

      const rewritten = await rewriteDraftContent({
        draft: workingDraft,
        story,
        action: action || 'more_natural',
        customInstruction,
        taskId,
      });

      const nextStatus: ContentDraftStatus =
        rewritten.qualityBreakdown.overall >= 85 ? 'ready_for_review' : 'needs_revision';

      if (existing) {
        const updated: ContentDraft = {
          ...existing,
          title: rewritten.title,
          alternativeTitles: rewritten.alternativeTitles,
          excerpt: rewritten.excerpt,
          body: rewritten.body,
          mainTriggerQuestion: rewritten.mainTriggerQuestion,
          contentLength: countWords(rewritten.body),
          qualityScore: rewritten.qualityBreakdown.overall,
          qualityBreakdown: rewritten.qualityBreakdown,
          usedPhrases: rewritten.usedPhrases,
          openingPattern: rewritten.openingPattern,
          endingPattern: rewritten.endingPattern,
          editorialNotes: rewritten.editorialNotes,
          semanticFingerprint: buildContentSemanticFingerprint(
            existing.collection,
            existing.category,
            rewritten.title,
            rewritten.body,
            existing.keywords || []
          ),
          status: nextStatus,
          revisionHistory: [...(existing.revisionHistory || []), rewritten.snapshotToAppend],
          updatedAt: new Date().toISOString(),
        };

        const idx = drafts.findIndex((d) => d.id === existing.id);
        drafts[idx] = updated;
        saveContentDrafts(drafts);
        recomputePhrasebookUsage(drafts, loadPhrasebook());
        res.json({ draft: updated, rewritten });
        return;
      }

      res.json({
        rewritten: {
          ...workingDraft,
          title: rewritten.title,
          alternativeTitles: rewritten.alternativeTitles,
          excerpt: rewritten.excerpt,
          body: rewritten.body,
          mainTriggerQuestion: rewritten.mainTriggerQuestion,
          contentLength: countWords(rewritten.body),
          qualityScore: rewritten.qualityBreakdown.overall,
          qualityBreakdown: rewritten.qualityBreakdown,
          usedPhrases: rewritten.usedPhrases,
          openingPattern: rewritten.openingPattern,
          endingPattern: rewritten.endingPattern,
          editorialNotes: rewritten.editorialNotes,
          status: nextStatus,
          revisionHistory: [
            ...(workingDraft.revisionHistory || []),
            rewritten.snapshotToAppend,
          ],
        },
      });
    } catch (err) {
      const { status, message } = formatContentRouteError(err, 'Ошибка переписывания текста.');
      res.status(status).json({ error: message });
    }
  });

  // Rewrite specific section (opening or ending)
  app.post('/api/content/rewrite-section', async (req: Request, res: Response) => {
    try {
      const { draftId, draftSnapshot, section, customInstruction, taskId } = req.body as {
        draftId?: string;
        draftSnapshot?: Partial<ContentDraft>;
        section?: 'opening' | 'ending';
        customInstruction?: string;
        taskId?: string;
      };

      const action: RewriteActionType =
        section === 'ending' ? 'rewrite_ending' : 'rewrite_opening';

      const drafts = loadContentDrafts();
      const existing = draftId ? drafts.find((d) => d.id === draftId) : undefined;
      const workingDraft = (existing || draftSnapshot) as ContentDraft | undefined;

      if (!workingDraft || !workingDraft.sourceStoryId || !workingDraft.body) {
        res.status(400).json({ error: 'Не переданы данные черновика для переписывания фрагмента.' });
        return;
      }

      const db = loadDatabase();
      const story = db.stories.find((s) => s.id === workingDraft.sourceStoryId);
      if (!story) {
        res.status(404).json({ error: `Исходный сюжет ${workingDraft.sourceStoryId} не найден.` });
        return;
      }

      const rewritten = await rewriteDraftContent({
        draft: workingDraft,
        story,
        action,
        customInstruction,
        taskId,
      });

      const nextStatus: ContentDraftStatus =
        rewritten.qualityBreakdown.overall >= 85 ? 'ready_for_review' : 'needs_revision';

      if (existing) {
        const updated: ContentDraft = {
          ...existing,
          title: rewritten.title,
          alternativeTitles: rewritten.alternativeTitles,
          excerpt: rewritten.excerpt,
          body: rewritten.body,
          mainTriggerQuestion: rewritten.mainTriggerQuestion,
          contentLength: countWords(rewritten.body),
          qualityScore: rewritten.qualityBreakdown.overall,
          qualityBreakdown: rewritten.qualityBreakdown,
          usedPhrases: rewritten.usedPhrases,
          openingPattern: rewritten.openingPattern,
          endingPattern: rewritten.endingPattern,
          editorialNotes: rewritten.editorialNotes,
          semanticFingerprint: buildContentSemanticFingerprint(
            existing.collection,
            existing.category,
            rewritten.title,
            rewritten.body,
            existing.keywords || []
          ),
          status: nextStatus,
          revisionHistory: [...(existing.revisionHistory || []), rewritten.snapshotToAppend],
          updatedAt: new Date().toISOString(),
        };
        const idx = drafts.findIndex((d) => d.id === existing.id);
        drafts[idx] = updated;
        saveContentDrafts(drafts);
        recomputePhrasebookUsage(drafts, loadPhrasebook());
        res.json({ draft: updated, rewritten });
        return;
      }

      res.json({
        rewritten: {
          ...workingDraft,
          title: rewritten.title,
          alternativeTitles: rewritten.alternativeTitles,
          excerpt: rewritten.excerpt,
          body: rewritten.body,
          mainTriggerQuestion: rewritten.mainTriggerQuestion,
          contentLength: countWords(rewritten.body),
          qualityScore: rewritten.qualityBreakdown.overall,
          qualityBreakdown: rewritten.qualityBreakdown,
          usedPhrases: rewritten.usedPhrases,
          openingPattern: rewritten.openingPattern,
          endingPattern: rewritten.endingPattern,
          editorialNotes: rewritten.editorialNotes,
          status: nextStatus,
          revisionHistory: [
            ...(workingDraft.revisionHistory || []),
            rewritten.snapshotToAppend,
          ],
        },
      });
    } catch (err) {
      const { status, message } = formatContentRouteError(err, 'Ошибка переписывания фрагмента.');
      res.status(status).json({ error: message });
    }
  });

  // Explicit quality evaluation endpoint
  app.post('/api/content/quality-check', async (req: Request, res: Response) => {
    try {
      const { draftId, sourceStoryId, title, excerpt, body, mainTriggerQuestion } = req.body as {
        draftId?: string;
        sourceStoryId?: string;
        title?: string;
        excerpt?: string;
        body?: string;
        mainTriggerQuestion?: string;
      };

      const drafts = loadContentDrafts();
      const existing = draftId ? drafts.find((d) => d.id === draftId) : undefined;
      const targetStoryId = sourceStoryId || existing?.sourceStoryId;

      if (!targetStoryId || !body) {
        res.status(400).json({ error: 'Укажите sourceStoryId и текст публикации для проверки качества.' });
        return;
      }

      const db = loadDatabase();
      const story = db.stories.find((s) => s.id === targetStoryId);
      if (!story) {
        res.status(404).json({ error: `Исходный сюжет ${targetStoryId} не найден.` });
        return;
      }

      const phrasebook = loadPhrasebook();
      const qc = await runContentQualityControl({
        title: title || existing?.title || story.title,
        excerpt: excerpt || existing?.excerpt || story.shortDescription,
        body,
        mainTriggerQuestion: mainTriggerQuestion || existing?.mainTriggerQuestion || '',
        sourceStory: story,
        recentDrafts: drafts,
        phrasebook,
        excludeDraftId: existing?.id,
      });

      if (existing) {
        const idx = drafts.findIndex((d) => d.id === existing.id);
        const updated: ContentDraft = {
          ...existing,
          title: title ?? existing.title,
          excerpt: excerpt ?? existing.excerpt,
          body,
          mainTriggerQuestion: mainTriggerQuestion ?? existing.mainTriggerQuestion,
          contentLength: countWords(body),
          qualityScore: qc.qualityBreakdown.overall,
          qualityBreakdown: qc.qualityBreakdown,
          usedPhrases: qc.usedPhrases,
          openingPattern: qc.openingPattern,
          endingPattern: qc.endingPattern,
          editorialNotes: qc.qualityBreakdown.editorialNotes,
          status:
            existing.status === 'approved'
              ? 'approved'
              : qc.qualityBreakdown.overall >= 85
                ? 'ready_for_review'
                : 'needs_revision',
          updatedAt: new Date().toISOString(),
        };
        drafts[idx] = updated;
        saveContentDrafts(drafts);
        recomputePhrasebookUsage(drafts, phrasebook);
        res.json({ qualityBreakdown: qc.qualityBreakdown, draft: updated });
        return;
      }

      res.json({
        qualityBreakdown: qc.qualityBreakdown,
        usedPhrases: qc.usedPhrases,
        openingPattern: qc.openingPattern,
        endingPattern: qc.endingPattern,
      });
    } catch (err) {
      const { status, message } = formatContentRouteError(err, 'Ошибка проверки качества.');
      res.status(status).json({ error: message });
    }
  });

  // List drafts with rich filtering
  app.get('/api/content/drafts', (req: Request, res: Response) => {
    let drafts = loadContentDrafts();
    const db = loadDatabase();
    const storyMap = new Map(db.stories.map((s) => [s.id, s]));

    const collection = req.query.collection as string | undefined;
    const category = req.query.category as string | undefined;
    const status = req.query.status as string | undefined;
    const minQuality = req.query.minQuality ? Number(req.query.minQuality) : undefined;
    const dateFrom = req.query.dateFrom as string | undefined;
    const hasResearch = req.query.hasResearch as string | undefined;
    const sourceStoryId = req.query.sourceStoryId as string | undefined;

    if (collection === 'debate' || collection === 'romantic') {
      drafts = drafts.filter((d) => d.collection === collection);
    }
    if (category && category !== 'ALL') {
      drafts = drafts.filter((d) => d.category === category);
    }
    if (status && status !== 'ALL') {
      drafts = drafts.filter((d) => d.status === status);
    }
    if (minQuality !== undefined && !Number.isNaN(minQuality)) {
      drafts = drafts.filter((d) => d.qualityScore >= minQuality);
    }
    if (dateFrom) {
      drafts = drafts.filter((d) => d.createdAt >= dateFrom);
    }
    if (hasResearch === 'true') {
      drafts = drafts.filter((d) => Boolean(d.researchId) || d.sourceOriginType === 'external');
    } else if (hasResearch === 'false') {
      drafts = drafts.filter((d) => !d.researchId && d.sourceOriginType === 'original');
    }
    if (sourceStoryId) {
      drafts = drafts.filter((d) => d.sourceStoryId === sourceStoryId);
    }

    res.json({
      drafts: drafts.map((d) => ({
        ...d,
        sourceStoryTitle: storyMap.get(d.sourceStoryId)?.title || d.sourceStoryId,
      })),
    });
  });

  // Get single draft + linked source story
  app.get('/api/content/drafts/:id', (req: Request, res: Response) => {
    const drafts = loadContentDrafts();
    const draft = drafts.find((d) => d.id === req.params.id);
    if (!draft) {
      res.status(404).json({ error: 'Публикация/черновик не найден.' });
      return;
    }
    const db = loadDatabase();
    const sourceStory = db.stories.find((s) => s.id === draft.sourceStoryId) || null;
    res.json({ draft, sourceStory });
  });

  // Save a generated or manual draft (marks sourceStory.usageStatus = 'drafted')
  app.post('/api/content/drafts', (req: Request, res: Response) => {
    const payload = req.body as Partial<ContentDraft>;
    if (!payload.sourceStoryId || !payload.title || !payload.body) {
      res.status(400).json({
        error: 'Для сохранения черновика обязательны поля sourceStoryId, title и body.',
      });
      return;
    }

    const db = loadDatabase();
    const story = db.stories.find((s) => s.id === payload.sourceStoryId);
    if (!story) {
      res.status(404).json({ error: `Исходный сюжет ${payload.sourceStoryId} не найден.` });
      return;
    }
    if (story.verificationStatus !== 'approved') {
      res.status(400).json({
        error: `Нельзя сохранить черновик: сюжет ${story.id} не подтверждён (status=${story.verificationStatus}).`,
      });
      return;
    }

    const drafts = loadContentDrafts();
    // Guard against duplicate accidental saves of the exact same body/id
    if (payload.id && drafts.some((d) => d.id === payload.id)) {
      res.status(409).json({ error: `Черновик с ID ${payload.id} уже существует.` });
      return;
    }
    const activeForStory = drafts.filter(
      (d) => d.sourceStoryId === story.id && d.status !== 'rejected'
    );
    if (activeForStory.length >= 3) {
      res.status(409).json({
        error: `Для сюжета ${story.id} уже сохранено 3 активных варианта (лимит вариантов).`,
      });
      return;
    }
    const duplicateText = activeForStory.find(
      (d) => d.body.trim() === payload.body?.trim()
    );
    if (duplicateText) {
      res.status(409).json({
        error: `Идентичный черновик уже сохранён под ID ${duplicateText.id}.`,
      });
      return;
    }

    const phrasebook = loadPhrasebook();
    const now = new Date().toISOString();
    const newId = generateNextContentId(drafts, story.collection);
    const qualityScore = Number(payload.qualityScore ?? payload.qualityBreakdown?.overall ?? 78);

    const resolvedStatus: ContentDraftStatus =
      payload.status && ALLOWED_DRAFT_STATUSES.includes(payload.status) && payload.status !== 'generating'
        ? payload.status === 'ready_for_review' && qualityScore < 85
          ? 'needs_revision'
          : payload.status
        : qualityScore >= 85
          ? 'ready_for_review'
          : 'draft';

    const voiceCfg = loadVoiceConfig();
    const defaultSliders =
      story.collection === 'debate' ? voiceCfg.rubricSettings.debate : voiceCfg.rubricSettings.romantic;

    let draft: ContentDraft = {
      id: newId,
      sourceStoryId: story.id,
      collection: story.collection,
      category: payload.category || story.category,
      subcategory: payload.subcategory || story.subcategory,
      title: String(payload.title).trim(),
      alternativeTitles: Array.isArray(payload.alternativeTitles)
        ? payload.alternativeTitles.map(String).slice(0, 2)
        : [],
      excerpt: String(payload.excerpt || story.shortDescription).trim(),
      body: String(payload.body).trim(),
      mainTriggerQuestion: String(payload.mainTriggerQuestion || story.mainTriggerQuestion).trim(),
      voiceProfile:
        payload.voiceProfile ||
        (story.collection === 'debate' ? voiceCfg.debateProfileId : voiceCfg.romanticProfileId),
      voiceSettings: payload.voiceSettings || defaultSliders,
      narrativeStructure: payload.narrativeStructure || 'observer_start',
      contentLength: countWords(payload.body),
      lengthPreset: payload.lengthPreset || 'standard',
      qualityScore,
      qualityBreakdown: payload.qualityBreakdown || {
        hookStrength: 12,
        languageNaturalness: 12,
        emotionalImpact: 12,
        plotDepth: 12,
        narrativeUniqueness: 12,
        voiceRecognition: 8,
        endingQuality: 7,
        sourceFidelity: 4,
        overall: qualityScore,
        tierLabel: qualityScore >= 85 ? 'Хорошая публикация' : 'Требует редактуры',
        checks: {
          hasMeaninglessRepetition: false,
          soundsLikeAiTemplate: false,
          artificialColloquialism: false,
          phraseOveruse: false,
          contradictsSource: false,
          lostImportantDetail: false,
          artificialEnding: false,
          unsubstantiatedClaims: false,
          verbatimCopy: false,
        },
        warnings: [],
        editorialNotes: payload.editorialNotes || 'Сохранено в редакторе.',
      },
      editorialNotes: String(payload.editorialNotes || '').trim(),
      generationModel: payload.generationModel || 'gemini-4-hydrogen',
      generationPromptVersion: payload.generationPromptVersion || 'v3.0-melo-voice',
      createdAt: now,
      updatedAt: now,
      status: resolvedStatus,
      revisionHistory: Array.isArray(payload.revisionHistory) ? payload.revisionHistory : [],
      sourceUrl: story.sourceUrl || '',
      researchId: story.researchId,
      sourceOriginType: story.originType,
      keywords: Array.isArray(payload.keywords) ? payload.keywords : story.keywords || [],
      usedPhrases: payload.usedPhrases || [],
      openingPattern: payload.openingPattern || extractFirstSentence(payload.body),
      endingPattern:
        payload.endingPattern || extractLastSentence(payload.mainTriggerQuestion || payload.body),
      semanticFingerprint: '',
      variantIndex: Number(payload.variantIndex ?? activeForStory.length),
    };

    draft = enrichDraftDerivedFields(draft, phrasebook);

    const nextDrafts = [draft, ...drafts];
    saveContentDrafts(nextDrafts);
    recomputePhrasebookUsage(nextDrafts, phrasebook);
    const updatedStory = syncSourceStoryUsageStatus(story.id, nextDrafts, 'draft_saved');
    createContentBackupSnapshot();

    res.status(201).json({ draft, sourceStory: updatedStory });
  });

  // Update draft manually (automatically pushes prior state to revisionHistory)
  app.put('/api/content/drafts/:id', (req: Request, res: Response) => {
    const drafts = loadContentDrafts();
    const idx = drafts.findIndex((d) => d.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Черновик не найден.' });
      return;
    }

    const current = drafts[idx];
    const patch = req.body as Partial<ContentDraft>;
    const phrasebook = loadPhrasebook();

    const textChanged =
      (patch.body !== undefined && patch.body !== current.body) ||
      (patch.title !== undefined && patch.title !== current.title) ||
      (patch.mainTriggerQuestion !== undefined &&
        patch.mainTriggerQuestion !== current.mainTriggerQuestion);

    const nextHistory = [...(current.revisionHistory || [])];
    if (textChanged) {
      const nextNum = nextHistory.length + 1;
      nextHistory.push({
        versionId: `REV-${nextNum}-${Date.now().toString(36).toUpperCase()}`,
        versionNumber: nextNum,
        createdAt: new Date().toISOString(),
        actionLabel: 'Ручное редактирование',
        title: current.title,
        alternativeTitles: current.alternativeTitles,
        excerpt: current.excerpt,
        body: current.body,
        mainTriggerQuestion: current.mainTriggerQuestion,
        voiceProfile: current.voiceProfile,
        voiceSettings: current.voiceSettings,
        narrativeStructure: current.narrativeStructure,
        lengthPreset: current.lengthPreset,
        qualityScore: current.qualityScore,
        qualityBreakdown: current.qualityBreakdown,
        editorialNotes: current.editorialNotes,
      });
    }

    let updated: ContentDraft = {
      ...current,
      ...patch,
      id: current.id,
      sourceStoryId: current.sourceStoryId,
      collection: current.collection,
      revisionHistory: nextHistory,
      openingPattern: extractFirstSentence(patch.body ?? current.body),
      endingPattern: extractLastSentence(
        (patch.mainTriggerQuestion ?? current.mainTriggerQuestion) || (patch.body ?? current.body)
      ),
      updatedAt: new Date().toISOString(),
    };
    updated = enrichDraftDerivedFields(updated, phrasebook);

    drafts[idx] = updated;
    saveContentDrafts(drafts);
    recomputePhrasebookUsage(drafts, phrasebook);
    res.json({ draft: updated });
  });

  // Update draft workflow status (note: never sets sourceStory.usageStatus to 'published')
  app.patch('/api/content/drafts/:id/status', (req: Request, res: Response) => {
    const drafts = loadContentDrafts();
    const idx = drafts.findIndex((d) => d.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Черновик не найден.' });
      return;
    }

    const { status, rejectionReason } = req.body as {
      status?: ContentDraftStatus;
      rejectionReason?: string;
    };
    if (!status || !ALLOWED_DRAFT_STATUSES.includes(status)) {
      res.status(400).json({ error: 'Некорректный статус публикации.' });
      return;
    }

    const current = drafts[idx];
    if (status === 'ready_for_review' && current.qualityScore < 85) {
      res.status(400).json({
        error: `Для перевода в «ready_for_review» требуется оценка качества не ниже 85 (текущая: ${current.qualityScore}/100).`,
      });
      return;
    }

    drafts[idx] = {
      ...current,
      status,
      rejectionReason: status === 'rejected' ? rejectionReason || current.rejectionReason : current.rejectionReason,
      updatedAt: new Date().toISOString(),
    };

    saveContentDrafts(drafts);
    recomputePhrasebookUsage(drafts, loadPhrasebook());

    let sourceStory = null;
    if (status === 'rejected' || status === 'archived') {
      sourceStory = syncSourceStoryUsageStatus(current.sourceStoryId, drafts, 'draft_removed');
    } else {
      sourceStory = syncSourceStoryUsageStatus(current.sourceStoryId, drafts, 'draft_saved');
    }

    res.json({ draft: drafts[idx], sourceStory });
  });

  // Delete draft (with check of remaining drafts before changing sourceStory usageStatus)
  app.delete('/api/content/drafts/:id', (req: Request, res: Response) => {
    const drafts = loadContentDrafts();
    const target = drafts.find((d) => d.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Черновик не найден.' });
      return;
    }

    createContentBackupSnapshot();
    const nextDrafts = drafts.filter((d) => d.id !== req.params.id);
    saveContentDrafts(nextDrafts);
    recomputePhrasebookUsage(nextDrafts, loadPhrasebook());
    const sourceStory = syncSourceStoryUsageStatus(target.sourceStoryId, nextDrafts, 'draft_removed');

    res.json({ deletedId: req.params.id, sourceStory });
  });

  // Revision history
  app.get('/api/content/drafts/:id/versions', (req: Request, res: Response) => {
    const drafts = loadContentDrafts();
    const draft = drafts.find((d) => d.id === req.params.id);
    if (!draft) {
      res.status(404).json({ error: 'Черновик не найден.' });
      return;
    }
    res.json({ versions: draft.revisionHistory || [], currentDraft: draft });
  });

  app.post('/api/content/drafts/:id/restore-version', (req: Request, res: Response) => {
    const drafts = loadContentDrafts();
    const idx = drafts.findIndex((d) => d.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Черновик не найден.' });
      return;
    }

    const { versionId } = req.body as { versionId?: string };
    const current = drafts[idx];
    const targetRev = (current.revisionHistory || []).find((v) => v.versionId === versionId);
    if (!targetRev) {
      res.status(404).json({ error: 'Указанная версия в истории не найдена.' });
      return;
    }

    const nextNum = (current.revisionHistory || []).length + 1;
    const backupOfCurrent = {
      versionId: `REV-${nextNum}-${Date.now().toString(36).toUpperCase()}`,
      versionNumber: nextNum,
      createdAt: new Date().toISOString(),
      actionLabel: `Перед откатом к версии #${targetRev.versionNumber}`,
      title: current.title,
      alternativeTitles: current.alternativeTitles,
      excerpt: current.excerpt,
      body: current.body,
      mainTriggerQuestion: current.mainTriggerQuestion,
      voiceProfile: current.voiceProfile,
      voiceSettings: current.voiceSettings,
      narrativeStructure: current.narrativeStructure,
      lengthPreset: current.lengthPreset,
      qualityScore: current.qualityScore,
      qualityBreakdown: current.qualityBreakdown,
      editorialNotes: current.editorialNotes,
    };

    const phrasebook = loadPhrasebook();
    let restored: ContentDraft = {
      ...current,
      title: targetRev.title,
      alternativeTitles: targetRev.alternativeTitles,
      excerpt: targetRev.excerpt,
      body: targetRev.body,
      mainTriggerQuestion: targetRev.mainTriggerQuestion,
      voiceProfile: targetRev.voiceProfile,
      voiceSettings: targetRev.voiceSettings,
      narrativeStructure: targetRev.narrativeStructure,
      lengthPreset: targetRev.lengthPreset,
      qualityScore: targetRev.qualityScore,
      qualityBreakdown: targetRev.qualityBreakdown,
      editorialNotes: targetRev.editorialNotes,
      openingPattern: extractFirstSentence(targetRev.body),
      endingPattern: extractLastSentence(targetRev.mainTriggerQuestion || targetRev.body),
      status: targetRev.qualityScore >= 85 ? 'ready_for_review' : 'needs_revision',
      revisionHistory: [...(current.revisionHistory || []), backupOfCurrent],
      updatedAt: new Date().toISOString(),
    };
    restored = enrichDraftDerivedFields(restored, phrasebook);

    drafts[idx] = restored;
    saveContentDrafts(drafts);
    recomputePhrasebookUsage(drafts, phrasebook);
    res.json({ draft: restored });
  });

  // Voice Engine configuration
  app.get('/api/content/voice', (_req: Request, res: Response) => {
    res.json({ voiceConfig: loadVoiceConfig() });
  });

  app.put('/api/content/voice', (req: Request, res: Response) => {
    const current = loadVoiceConfig();
    const patch = req.body as Partial<VoiceEngineConfig>;
    const updated: VoiceEngineConfig = {
      debateProfileId: patch.debateProfileId || current.debateProfileId,
      romanticProfileId: patch.romanticProfileId || current.romanticProfileId,
      rubricSettings: {
        debate: { ...current.rubricSettings.debate, ...(patch.rubricSettings?.debate || {}) },
        romantic: { ...current.rubricSettings.romantic, ...(patch.rubricSettings?.romantic || {}) },
      },
      profiles: Array.isArray(patch.profiles) && patch.profiles.length > 0 ? patch.profiles : current.profiles,
      updatedAt: new Date().toISOString(),
    };
    saveVoiceConfig(updated);
    res.json({ voiceConfig: updated });
  });

  // Phrasebook CRUD
  app.get('/api/content/phrasebook', (_req: Request, res: Response) => {
    const drafts = loadContentDrafts();
    const phrasebook = recomputePhrasebookUsage(drafts, loadPhrasebook());
    res.json({ phrasebook });
  });

  app.post('/api/content/phrasebook', (req: Request, res: Response) => {
    const { phrase, collections, tone, maxFrequencyPer10, weight, notes } = req.body as {
      phrase?: string;
      collections?: CollectionType[];
      tone?: PhrasebookTone;
      maxFrequencyPer10?: number;
      weight?: number;
      notes?: string;
    };

    const cleanPhrase = String(phrase || '').trim();
    if (cleanPhrase.length < 4) {
      res.status(400).json({ error: 'Введите выражение длиной минимум 4 символа.' });
      return;
    }

    const entries = loadPhrasebook();
    if (entries.some((e) => e.phrase.toLowerCase() === cleanPhrase.toLowerCase())) {
      res.status(409).json({ error: 'Такое выражение уже есть в словаре.' });
      return;
    }

    const now = new Date().toISOString();
    const newEntry: PhrasebookEntry = {
      id: `pb-custom-${Date.now().toString(36)}`,
      phrase: cleanPhrase,
      collections: Array.isArray(collections) && collections.length > 0 ? collections : ['debate', 'romantic'],
      tone: tone || 'observational',
      maxFrequencyPer10: Math.max(1, Math.min(10, Number(maxFrequencyPer10 || 2))),
      weight: Math.max(1, Math.min(10, Number(weight || 7))),
      banned: false,
      usageCount: 0,
      recentUsageCount: 0,
      isOverused: false,
      isCustom: true,
      notes: String(notes || '').trim(),
      createdAt: now,
      updatedAt: now,
    };

    const next = [newEntry, ...entries];
    savePhrasebook(next);
    const recomputed = recomputePhrasebookUsage(loadContentDrafts(), next);
    res.status(201).json({ entry: recomputed.find((e) => e.id === newEntry.id), phrasebook: recomputed });
  });

  app.put('/api/content/phrasebook/:id', (req: Request, res: Response) => {
    const entries = loadPhrasebook();
    const idx = entries.findIndex((e) => e.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Выражение не найдено в словаре.' });
      return;
    }

    const patch = req.body as Partial<PhrasebookEntry>;
    entries[idx] = {
      ...entries[idx],
      phrase: patch.phrase !== undefined ? String(patch.phrase).trim() : entries[idx].phrase,
      collections: Array.isArray(patch.collections) && patch.collections.length > 0 ? patch.collections : entries[idx].collections,
      tone: patch.tone || entries[idx].tone,
      maxFrequencyPer10:
        patch.maxFrequencyPer10 !== undefined
          ? Math.max(1, Math.min(10, Number(patch.maxFrequencyPer10)))
          : entries[idx].maxFrequencyPer10,
      weight:
        patch.weight !== undefined
          ? Math.max(1, Math.min(10, Number(patch.weight)))
          : entries[idx].weight,
      banned: typeof patch.banned === 'boolean' ? patch.banned : entries[idx].banned,
      notes: patch.notes !== undefined ? String(patch.notes) : entries[idx].notes,
      updatedAt: new Date().toISOString(),
    };

    savePhrasebook(entries);
    const recomputed = recomputePhrasebookUsage(loadContentDrafts(), entries);
    res.json({ entry: recomputed.find((e) => e.id === req.params.id), phrasebook: recomputed });
  });

  app.delete('/api/content/phrasebook/:id', (req: Request, res: Response) => {
    const entries = loadPhrasebook();
    const target = entries.find((e) => e.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Выражение не найдено.' });
      return;
    }
    const next = entries.filter((e) => e.id !== req.params.id);
    savePhrasebook(next);
    res.json({ deletedId: req.params.id, phrasebook: next });
  });

  // Export JSON (supports all, selected IDs, single draft, story only, or draft + sourceStory bundle)
  app.get('/api/content/export/json', (req: Request, res: Response) => {
    const drafts = loadContentDrafts();
    const db = loadDatabase();
    const storyMap = new Map(db.stories.map((s) => [s.id, s]));

    const mode = String(req.query.mode || 'with_source'); // 'with_source' | 'draft_only' | 'story_only'
    const idsParam = String(req.query.ids || '').trim();
    const storyIdParam = String(req.query.storyId || '').trim();
    const collection = req.query.collection as string | undefined;

    if (mode === 'story_only' && storyIdParam) {
      const story = storyMap.get(storyIdParam);
      if (!story) {
        res.status(404).json({ error: `Сюжет ${storyIdParam} не найден.` });
        return;
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="melo_story_${story.id}.json"`
      );
      res.send(JSON.stringify({ exportedAt: new Date().toISOString(), sourceStory: story }, null, 2));
      return;
    }

    let selected = drafts;
    if (idsParam) {
      const idSet = new Set(idsParam.split(',').map((s) => s.trim()).filter(Boolean));
      selected = selected.filter((d) => idSet.has(d.id));
    }
    if (collection === 'debate' || collection === 'romantic') {
      selected = selected.filter((d) => d.collection === collection);
    }

    const items = selected.map((d) =>
      buildContentExportObject(d, storyMap.get(d.sourceStoryId) || null, mode !== 'draft_only')
    );

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="melo_love_publications_${new Date().toISOString().slice(0, 10)}.json"`
    );
    res.send(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          mode,
          count: items.length,
          publications: items,
        },
        null,
        2
      )
    );
  });

  app.get('/api/content/export/:id/json', (req: Request, res: Response) => {
    const drafts = loadContentDrafts();
    const draft = drafts.find((d) => d.id === req.params.id);
    if (!draft) {
      res.status(404).json({ error: 'Публикация не найдена.' });
      return;
    }
    const db = loadDatabase();
    const story = db.stories.find((s) => s.id === draft.sourceStoryId) || null;
    const includeSource = req.query.withSource !== 'false';
    const payload = buildContentExportObject(draft, story, includeSource);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="melo_${draft.id}.json"`
    );
    res.send(JSON.stringify(payload, null, 2));
  });

  // Import drafts JSON with strict structure, ID & sourceStoryId link validation
  app.post('/api/content/import/json', (req: Request, res: Response) => {
    const body = req.body as {
      publications?: Array<Record<string, unknown>>;
      drafts?: Array<Record<string, unknown>>;
    };
    const incoming = Array.isArray(body.publications)
      ? body.publications
      : Array.isArray(body.drafts)
        ? body.drafts
        : Array.isArray(req.body)
          ? (req.body as Array<Record<string, unknown>>)
          : null;

    if (!incoming) {
      res.status(400).json({ error: 'Ожидается JSON-массив публикаций (publications или drafts).' });
      return;
    }

    const db = loadDatabase();
    const storyMap = new Map(db.stories.map((s) => [s.id, s]));
    const existing = loadContentDrafts();
    const existingIds = new Set(existing.map((d) => d.id));
    const phrasebook = loadPhrasebook();

    const errors: string[] = [];
    const imported: ContentDraft[] = [];

    createContentBackupSnapshot();

    for (let i = 0; i < incoming.length; i++) {
      const raw = incoming[i];
      const rawId = String(raw.contentId || raw.id || '').trim();
      const sourceStoryId = String(raw.sourceStoryId || '').trim();
      const title = String(raw.title || '').trim();
      const textBody = String(raw.body || '').trim();

      if (!sourceStoryId || !title || !textBody) {
        errors.push(`Элемент #${i + 1}: отсутствуют обязательные поля sourceStoryId, title или body.`);
        continue;
      }

      const linkedStory = storyMap.get(sourceStoryId);
      if (!linkedStory) {
        errors.push(`Элемент #${i + 1}: не найден связанный сюжет ${sourceStoryId} в STORY DATABASE.`);
        continue;
      }

      if (rawId && existingIds.has(rawId)) {
        errors.push(`Элемент #${i + 1}: ID ${rawId} уже существует в хранилище.`);
        continue;
      }

      const finalId =
        rawId && /^ML-P-(D|R)-\d+$/.test(rawId)
          ? rawId
          : generateNextContentId([...imported, ...existing], linkedStory.collection);
      existingIds.add(finalId);

      const now = new Date().toISOString();
      const voiceCfg = loadVoiceConfig();
      const qScore = Number(raw.qualityScore ?? 80);

      let draft: ContentDraft = {
        id: finalId,
        sourceStoryId: linkedStory.id,
        collection: linkedStory.collection,
        category: String(raw.category || linkedStory.category),
        subcategory: String(raw.subcategory || linkedStory.subcategory),
        title,
        alternativeTitles: Array.isArray(raw.alternativeTitles)
          ? raw.alternativeTitles.map(String).slice(0, 2)
          : [],
        excerpt: String(raw.excerpt || linkedStory.shortDescription),
        body: textBody,
        mainTriggerQuestion: String(raw.mainTriggerQuestion || linkedStory.mainTriggerQuestion),
        voiceProfile: String(raw.voiceProfile || 'melo_love_standard'),
        voiceSettings:
          (raw.voiceSettings as VoiceSliders) ||
          (linkedStory.collection === 'debate'
            ? voiceCfg.rubricSettings.debate
            : voiceCfg.rubricSettings.romantic),
        narrativeStructure:
          (raw.narrativeStructure as NarrativeStructurePattern) || 'observer_start',
        contentLength: countWords(textBody),
        lengthPreset: (raw.lengthPreset as ContentLengthPreset) || 'standard',
        qualityScore: qScore,
        qualityBreakdown: (raw.qualityBreakdown as ContentDraft['qualityBreakdown']) || {
          hookStrength: 12,
          languageNaturalness: 12,
          emotionalImpact: 12,
          plotDepth: 12,
          narrativeUniqueness: 12,
          voiceRecognition: 8,
          endingQuality: 8,
          sourceFidelity: 4,
          overall: qScore,
          tierLabel: qScore >= 85 ? 'Хорошая публикация' : 'Требует редактуры',
          checks: {
            hasMeaninglessRepetition: false,
            soundsLikeAiTemplate: false,
            artificialColloquialism: false,
            phraseOveruse: false,
            contradictsSource: false,
            lostImportantDetail: false,
            artificialEnding: false,
            unsubstantiatedClaims: false,
            verbatimCopy: false,
          },
          warnings: [],
          editorialNotes: 'Импортировано из JSON.',
        },
        editorialNotes: String(raw.editorialNotes || 'Импортировано из JSON.'),
        generationModel: String(raw.generationModel || 'imported'),
        generationPromptVersion: String(raw.generationPromptVersion || 'imported'),
        createdAt: String(raw.createdAt || now),
        updatedAt: now,
        status:
          ALLOWED_DRAFT_STATUSES.includes(raw.status as ContentDraftStatus) &&
          raw.status !== 'generating'
            ? (raw.status as ContentDraftStatus)
            : 'draft',
        revisionHistory: Array.isArray(raw.revisionHistory)
          ? (raw.revisionHistory as ContentDraft['revisionHistory'])
          : [],
        sourceUrl: linkedStory.sourceUrl || '',
        researchId: linkedStory.researchId,
        sourceOriginType: linkedStory.originType,
        keywords: Array.isArray(raw.keywords) ? raw.keywords.map(String) : linkedStory.keywords,
        usedPhrases: [],
        openingPattern: extractFirstSentence(textBody),
        endingPattern: extractLastSentence(
          String(raw.mainTriggerQuestion || '') || textBody
        ),
        semanticFingerprint: '',
        variantIndex: Number(raw.variantIndex ?? 0),
      };

      draft = enrichDraftDerivedFields(draft, phrasebook);
      imported.push(draft);
    }

    const mergedDrafts = [...imported, ...existing];
    if (imported.length > 0) {
      saveContentDrafts(mergedDrafts);
      recomputePhrasebookUsage(mergedDrafts, phrasebook);
      for (const d of imported) {
        if (d.status !== 'rejected' && d.status !== 'archived') {
          syncSourceStoryUsageStatus(d.sourceStoryId, mergedDrafts, 'draft_saved');
        }
      }
    }

    res.json({
      importedCount: imported.length,
      rejectedErrors: errors,
      drafts: mergedDrafts,
    });
  });

  // Manual backup for content workspace
  app.post('/api/content/backup', (_req: Request, res: Response) => {
    const filename = createContentBackupSnapshot();
    res.json({ filename, backups: listContentBackupSnapshots() });
  });
}
