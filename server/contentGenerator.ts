import {
  ContentDraft,
  ContentLengthPreset,
  ContentQualityScore,
  ContentRevision,
  NarrativeStartStyle,
  RewriteMode,
  StoryPlot,
} from '../src/shared/types.js';
import {
  calculateContentQuality,
  CONTENT_LENGTH_PRESETS,
  countWords,
  extractEndingPattern,
  extractOpeningPattern,
  sanitizeKramarovskyDashes,
} from '../src/shared/contentUtils.js';
import {
  callChatCompletionJson,
  formatAiError,
} from './aiClient.js';
import {
  loadContentDrafts,
  loadPhrasebook,
  loadVoiceConfig,
  nextContentId,
  saveContentDrafts,
  syncStoryUsageStatus,
} from './contentStorage.js';
import {
  auditSourceStoryCompleteness,
  buildRecentDiversityContext,
  buildVoiceSystemPrompt,
  selectActivePhrasebookHints,
  selectDiverseNarrativeStructure,
} from './voiceEngine.js';
import { loadDatabase } from './storage.js';

let activeGenerationAbort: AbortController | null = null;

export function isContentGenerationRunning(): boolean {
  return activeGenerationAbort !== null;
}

export function cancelContentGeneration(): boolean {
  if (activeGenerationAbort) {
    activeGenerationAbort.abort();
    activeGenerationAbort = null;
    return true;
  }
  return false;
}

interface AiDraftPayload {
  title: string;
  subtitle: string;
  body: string;
  triggerQuestion: string;
  aiBreakdown?: ContentQualityScore['breakdown'];
  aiPenalties?: {
    hasMeaninglessRepetition?: boolean;
    soundsLikeAiTemplate?: boolean;
    artificialColloquialism?: boolean;
    contradictsSource?: boolean;
    lostImportantDetail?: boolean;
    artificialEnding?: boolean;
    unsubstantiatedClaims?: boolean;
  };
  aiComment?: string;
}

async function callAiForDraft(params: {
  systemInstruction: string;
  userPrompt: string;
  signal: AbortSignal;
}): Promise<AiDraftPayload> {
  try {
    const jsonInstruction = `${params.userPrompt}

Верни строго валидный JSON-объект (без пояснений вне JSON) со следующими полями:
{
  "title": "строка — цепляющий заголовок без длинных тире",
  "subtitle": "строка — короткий анонс в 1 предложение",
  "body": "строка — основной текст публикации с живыми абзацами через \\n\\n, БЕЗ единого длинного тире (—) или среднего тире (–)",
  "triggerQuestion": "строка — сильный финальный вопрос к читателю",
  "aiComment": "строка — короткий самоаудит редактора",
  "aiBreakdown": {
    "hookStrength": 0..15,
    "languageNaturalness": 0..15,
    "emotionalImpact": 0..15,
    "plotDepth": 0..15,
    "narrativeUniqueness": 0..15,
    "voiceRecognition": 0..10,
    "endingQuality": 0..10,
    "sourceFidelity": 0..5
  },
  "aiPenalties": {
    "hasMeaninglessRepetition": false,
    "soundsLikeAiTemplate": false,
    "artificialColloquialism": false,
    "contradictsSource": false,
    "lostImportantDetail": false,
    "artificialEnding": false,
    "unsubstantiatedClaims": false
  }
}`;

    const parsed = await callChatCompletionJson<AiDraftPayload>({
      systemInstruction: params.systemInstruction,
      userPrompt: jsonInstruction,
      temperature: 0.78,
      maxTokens: 3200,
      timeoutMs: 60_000,
      signal: params.signal,
    });

    if (!parsed.title || !parsed.body) {
      throw new Error('Модель вернула неполную структуру публикации.');
    }

    return {
      ...parsed,
      title: sanitizeKramarovskyDashes(String(parsed.title)),
      subtitle: sanitizeKramarovskyDashes(String(parsed.subtitle || '')),
      body: sanitizeKramarovskyDashes(String(parsed.body)),
      triggerQuestion: sanitizeKramarovskyDashes(String(parsed.triggerQuestion || '')),
    };
  } catch (err) {
    throw formatAiError(err);
  }
}

function buildStoryFactSheet(story: StoryPlot): string {
  return `ИСХОДНАЯ СЮЖЕТНАЯ ОСНОВА (${story.id}):
- Коллекция: ${story.collection} (${story.category} / ${story.subcategory})
- Участники: ${story.participants}
- Обстановка: ${story.setting}
- Сюжет: ${story.fullPlot}
- Ключевой конфликт/поступок: ${story.coreConflictOrAction}
- Позиция стороны A: ${story.sideAPosition}
- Позиция стороны B: ${story.sideBPosition}
- Эмоциональный механизм: ${story.emotionalMechanism}
- Скрытое ожидание: ${story.hiddenExpectation}
- Неожиданный нюанс (ОБЯЗАТЕЛЬНО сохранить): ${story.unexpectedNuance}
- Возможный поворот: ${story.possibleTwist}
- Базовый вопрос: ${story.mainTriggerQuestion}
- Ключевые слова: ${story.keywords.join(', ')}`;
}

export async function generatePublicationsFromStory(params: {
  sourceStoryId: string;
  lengthPreset: ContentLengthPreset;
  narrativeStyle?: NarrativeStartStyle;
  variantsCount?: number;
  voicePresetId?: string;
}): Promise<ContentDraft[]> {
  if (activeGenerationAbort) {
    const err = new Error('Уже выполняется генерация публикации. Дождитесь завершения или отмените.');
    (err as { status?: number }).status = 409;
    throw err;
  }

  const db = loadDatabase();
  const story = db.stories.find((s) => s.id === params.sourceStoryId);
  if (!story) {
    const err = new Error('Исходный сюжет не найден в STORY DATABASE.');
    (err as { status?: number }).status = 404;
    throw err;
  }
  if (story.verificationStatus !== 'approved') {
    const err = new Error(
      `Сюжет ${story.id} имеет статус "${story.verificationStatus}". В генерацию допускаются только подтверждённые (approved) сюжеты.`
    );
    (err as { status?: number }).status = 400;
    throw err;
  }
  if (story.usageStatus !== 'unused') {
    const err = new Error(
      `Сюжет ${story.id} уже имеет статус использования "${story.usageStatus}". Для генерации выберите свободный (unused) сюжет.`
    );
    (err as { status?: number }).status = 409;
    throw err;
  }

  const controller = new AbortController();
  activeGenerationAbort = controller;

  try {
    const drafts = loadContentDrafts();
    const voiceConfig = loadVoiceConfig();
    const phrasebook = loadPhrasebook();

    const presetId = params.voicePresetId || voiceConfig.activePresetId;
    const profile =
      story.collection === 'debate' ? voiceConfig.debate : voiceConfig.romantic;
    const completeness = auditSourceStoryCompleteness(story);
    const variantsCount = Math.max(1, Math.min(3, params.variantsCount || 1));
    const variantGroupId = variantsCount > 1 ? `VAR-${Date.now().toString(36).toUpperCase()}` : undefined;

    const bannedPhrases = phrasebook
      .filter((p) => p.banned || p.recentUsageCount >= p.maxFrequencyPer10)
      .map((p) => p.phrase);

    const created: ContentDraft[] = [];
    const recentPool = [...drafts];

    for (let v = 0; v < variantsCount; v++) {
      const style = selectDiverseNarrativeStructure(
        recentPool,
        v === 0 ? params.narrativeStyle : undefined
      );
      const phraseHints = selectActivePhrasebookHints(phrasebook, story.collection);
      const systemInstruction = buildVoiceSystemPrompt({
        collection: story.collection,
        profile,
        narrativeStyle: style,
        lengthPreset: params.lengthPreset || 'standard',
        phraseHints,
        bannedPhrases,
      });

      const diversityContext = buildRecentDiversityContext(recentPool);
      const lengthMeta = CONTENT_LENGTH_PRESETS[params.lengthPreset || 'standard'];

      const userPrompt = `${buildStoryFactSheet(story)}

Последние 35 публикаций (НЕ повторяй зачины, заголовки и финальные обороты):
${diversityContext}

${
  variantsCount > 1
    ? `Это вариант #${v + 1} из ${variantsCount}. Используй принципиально другой угол подачи и зачин (${style}).`
    : ''
}
Напиши живую публикацию объёмом ${lengthMeta.minWords}–${lengthMeta.maxWords} слов, оцени её по рубрике (hookStrength 0-15, languageNaturalness 0-15, emotionalImpact 0-15, plotDepth 0-15, narrativeUniqueness 0-15, voiceRecognition 0-10, endingQuality 0-10, sourceFidelity 0-5) и верни JSON.`;

      let payload = await callAiForDraft({
        systemInstruction,
        userPrompt,
        signal: controller.signal,
      });

      let quality = calculateContentQuality({
        collection: story.collection,
        title: payload.title,
        body: payload.body,
        triggerQuestion: payload.triggerQuestion,
        sourceStory: story,
        recentDrafts: recentPool,
        phrasebook,
        minScore: voiceConfig.minPublishQualityScore,
        aiBreakdown: payload.aiBreakdown,
        aiPenalties: payload.aiPenalties,
        aiComment: payload.aiComment,
      });

      let autoRefined = false;
      if (quality.overall < voiceConfig.minPublishQualityScore && !controller.signal.aborted) {
        // Single targeted refinement pass
        const refinePrompt = `Доработай публикацию так, чтобы итоговый балл качества стал >= ${voiceConfig.minPublishQualityScore}/100.
Обнаруженные замечания: ${quality.penalties.details.join('; ') || quality.editorialComment}.
Исходный текст:
Заголовок: ${payload.title}
Текст: ${payload.body}
Вопрос: ${payload.triggerQuestion}

${buildStoryFactSheet(story)}
Убери любые клише, перефразируй зачин и сохрани все важные детали.`;

        const refinedPayload = await callAiForDraft({
          systemInstruction,
          userPrompt: refinePrompt,
          signal: controller.signal,
        });

        const refinedQuality = calculateContentQuality({
          collection: story.collection,
          title: refinedPayload.title,
          body: refinedPayload.body,
          triggerQuestion: refinedPayload.triggerQuestion,
          sourceStory: story,
          recentDrafts: recentPool,
          phrasebook,
          minScore: voiceConfig.minPublishQualityScore,
          aiBreakdown: refinedPayload.aiBreakdown,
          aiPenalties: refinedPayload.aiPenalties,
          aiComment: refinedPayload.aiComment,
        });

        if (refinedQuality.overall >= quality.overall) {
          payload = refinedPayload;
          quality = refinedQuality;
          autoRefined = true;
        }
      }

      const fullText = `${payload.title}\n${payload.body}\n${payload.triggerQuestion}`.toLowerCase();
      const matchedPhrases = phrasebook.filter((p) =>
        fullText.includes(p.phrase.toLowerCase())
      );

      const now = new Date().toISOString();
      const contentId = nextContentId([...created, ...drafts], story.collection);
      const draft: ContentDraft = {
        contentId,
        sourceStoryId: story.id,
        collection: story.collection,
        category: story.category,
        subcategory: story.subcategory,
        title: payload.title.trim(),
        subtitle: (payload.subtitle || '').trim(),
        body: payload.body.trim(),
        triggerQuestion: payload.triggerQuestion.trim(),
        wordCount: countWords(payload.body),
        lengthPreset: params.lengthPreset || 'standard',
        narrativeStyle: style,
        voicePresetId: presetId,
        usedPhraseIds: matchedPhrases.map((p) => p.id),
        usedPhrases: matchedPhrases.map((p) => p.phrase),
        openingPattern: extractOpeningPattern(payload.body),
        endingPattern: extractEndingPattern(payload.body),
        status: quality.overall >= voiceConfig.minPublishQualityScore ? 'ready_for_review' : 'needs_revision',
        quality,
        autoRefined,
        completenessAuditNote: completeness.note,
        variantGroupId,
        variantIndex: variantsCount > 1 ? v + 1 : undefined,
        researchId: story.researchId,
        sourceUrl: story.sourceUrl || undefined,
        originType: story.originType,
        revisionHistory: [],
        createdAt: now,
        updatedAt: now,
      };

      created.push(draft);
      recentPool.unshift(draft);
    }

    const updatedAll = [...created, ...drafts];
    saveContentDrafts(updatedAll);
    syncStoryUsageStatus(story.id);

    return created;
  } finally {
    activeGenerationAbort = null;
  }
}

const REWRITE_MODE_INSTRUCTIONS: Record<RewriteMode, string> = {
  more_lively: 'Сделай сцену живее: добавь ритм, конкретный жест или взгляд, убери канцелярит.',
  more_conversational: 'Перепиши более разговорным, тёплым человеческим языком без грубого сленга.',
  sharpen_hook: 'Полностью перепиши первый абзац и заголовок, чтобы зацепить с первой секунды.',
  softer_romantic: 'Смягчи подачу, убери резкость и сфокусируйся на бережной эмоциональной детали.',
  sharper_debate: 'Усиль аргументацию обеих сторон и остроту противоречия, чтобы читатели спорили в комментариях.',
  shorten: 'Сократи объём примерно на 30%, оставив только самую сильную конкретику.',
  expand: 'Расширь текст на 30% за счёт атмосферы, диалога и внутренней мотивации героев.',
  change_opening: 'Полностью смени угол входа в историю и первый абзац.',
  change_ending: 'Перепиши финал и триггерный вопрос так, чтобы оставить сильное послевкусие.',
  remove_ai_feel: 'Вычисти все ровные нейросетевые связки, штампы и подытоживания, оставь живую речь.',
};

export async function rewriteExistingDraft(
  contentId: string,
  mode: RewriteMode
): Promise<ContentDraft> {
  if (activeGenerationAbort) {
    const err = new Error('Уже выполняется генерация. Подождите или отмените текущую задачу.');
    (err as { status?: number }).status = 409;
    throw err;
  }

  const drafts = loadContentDrafts();
  const idx = drafts.findIndex((d) => d.contentId === contentId);
  if (idx === -1) {
    const err = new Error('Черновик не найден');
    (err as { status?: number }).status = 404;
    throw err;
  }

  const current = drafts[idx];
  const db = loadDatabase();
  const story = db.stories.find((s) => s.id === current.sourceStoryId);
  if (!story) {
    const err = new Error('Исходный сюжет для черновика не найден');
    (err as { status?: number }).status = 404;
    throw err;
  }

  const controller = new AbortController();
  activeGenerationAbort = controller;

  try {
    const voiceConfig = loadVoiceConfig();
    const phrasebook = loadPhrasebook();
    const profile = current.collection === 'debate' ? voiceConfig.debate : voiceConfig.romantic;
    const phraseHints = selectActivePhrasebookHints(phrasebook, current.collection);
    const bannedPhrases = phrasebook
      .filter((p) => p.banned || p.recentUsageCount >= p.maxFrequencyPer10)
      .map((p) => p.phrase);

    const systemInstruction = buildVoiceSystemPrompt({
      collection: current.collection,
      profile,
      narrativeStyle: current.narrativeStyle,
      lengthPreset: current.lengthPreset,
      phraseHints,
      bannedPhrases,
    });

    const userPrompt = `Режим переписывания: ${REWRITE_MODE_INSTRUCTIONS[mode]}

Текущий черновик (${current.contentId}):
Заголовок: ${current.title}
Подзаголовок: ${current.subtitle}
Текст: ${current.body}
Вопрос: ${current.triggerQuestion}

${buildStoryFactSheet(story)}

Сохрани верность фактам исходного сюжета и верни обновлённый JSON с оценкой качества.`;

    const payload = await callAiForDraft({
      systemInstruction,
      userPrompt,
      signal: controller.signal,
    });

    const quality = calculateContentQuality({
      collection: current.collection,
      title: payload.title,
      body: payload.body,
      triggerQuestion: payload.triggerQuestion,
      sourceStory: story,
      recentDrafts: drafts.filter((d) => d.contentId !== current.contentId),
      phrasebook,
      minScore: voiceConfig.minPublishQualityScore,
      aiBreakdown: payload.aiBreakdown,
      aiPenalties: payload.aiPenalties,
      aiComment: payload.aiComment,
    });

    const snapshot: ContentRevision = {
      version: current.revisionHistory.length + 1,
      title: current.title,
      body: current.body,
      triggerQuestion: current.triggerQuestion,
      qualityScore: current.quality.overall,
      reason: `До AI-переписывания (${mode})`,
      createdAt: current.updatedAt,
    };

    const fullText = `${payload.title}\n${payload.body}\n${payload.triggerQuestion}`.toLowerCase();
    const matchedPhrases = phrasebook.filter((p) => fullText.includes(p.phrase.toLowerCase()));

    const updated: ContentDraft = {
      ...current,
      title: payload.title.trim(),
      subtitle: (payload.subtitle || current.subtitle).trim(),
      body: payload.body.trim(),
      triggerQuestion: payload.triggerQuestion.trim(),
      wordCount: countWords(payload.body),
      openingPattern: extractOpeningPattern(payload.body),
      endingPattern: extractEndingPattern(payload.body),
      usedPhraseIds: matchedPhrases.map((p) => p.id),
      usedPhrases: matchedPhrases.map((p) => p.phrase),
      quality,
      status: quality.overall >= voiceConfig.minPublishQualityScore ? 'ready_for_review' : 'needs_revision',
      revisionHistory: [snapshot, ...current.revisionHistory].slice(0, 20),
      updatedAt: new Date().toISOString(),
    };

    drafts[idx] = updated;
    saveContentDrafts(drafts);
    return updated;
  } finally {
    activeGenerationAbort = null;
  }
}
