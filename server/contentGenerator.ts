import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  buildContentSemanticFingerprint,
  calculateContentQualityScore,
  countWords,
  extractFirstSentence,
  extractLastSentence,
  runDeterministicDraftChecks,
} from '../src/shared/contentUtils.ts';
import type {
  ContentDraft,
  ContentLengthPreset,
  ContentQualityBreakdown,
  ContentQualityChecks,
  ContentRevisionSnapshot,
  NarrativeStructurePattern,
  PhrasebookEntry,
  RewriteActionType,
  StoryPlot,
  VoiceSliders,
} from '../src/shared/types.ts';
import { createRotatedGeminiClient, rotateToNextApiKey } from './geminiKeyRotator.ts';
import {
  generateNextContentId,
  loadContentDrafts,
  loadPhrasebook,
  loadVoiceConfig,
} from './contentStorage.ts';
import {
  auditSourceStoryCompleteness,
  buildRecentDiversityContext,
  buildSourceStoryPromptBlock,
  buildVoiceSystemInstruction,
  resolveActiveVoiceSliders,
  selectDiverseNarrativeStructure,
  selectEligiblePhrasebookHints,
} from './voiceEngine.ts';

const GENERATION_MODEL = 'gemini-4-hydrogen';
const GENERATION_PROMPT_VERSION = 'v3.0-melo-voice';

// Concurrency lock & cancellation registry so parallel/duplicate tasks never corrupt state
const activeTasks = new Map<string, { lockKey: string; controller: AbortController }>();
const activeLockKeys = new Set<string>();

export function registerTaskLock(taskId: string | undefined, lockKey: string): AbortController {
  if (activeLockKeys.has(lockKey)) {
    throw new Error(`Уже выполняется генерация или редактура для «${lockKey}». Дождитесь завершения или отмените задачу.`);
  }
  const controller = new AbortController();
  const resolvedId = taskId || `TASK-${Date.now().toString(36).toUpperCase()}`;
  activeLockKeys.add(lockKey);
  activeTasks.set(resolvedId, { lockKey, controller });
  return controller;
}

export function releaseTaskLock(taskId: string | undefined, lockKey: string): void {
  activeLockKeys.delete(lockKey);
  if (taskId) {
    activeTasks.delete(taskId);
  }
  for (const [k, v] of activeTasks.entries()) {
    if (v.lockKey === lockKey) {
      activeTasks.delete(k);
    }
  }
}

export function cancelContentTask(taskId: string): boolean {
  const entry = activeTasks.get(taskId);
  if (!entry) return false;
  entry.controller.abort(new Error('Операция отменена пользователем.'));
  return true;
}

export function getActiveContentTaskIds(): string[] {
  return Array.from(activeTasks.keys());
}

function getContentGeminiClient(): GoogleGenAI {
  return createRotatedGeminiClient({ timeout: 45000 });
}

async function runGeminiWithGuard<T>(
  fn: () => Promise<T>,
  signal?: AbortSignal,
  maxRetries = 2
): Promise<T> {
  if (signal?.aborted) {
    throw new Error('Генерация отменена пользователем.');
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        fn(),
        new Promise<T>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Таймаут ответа Gemini API (46с). Повторите попытку.')),
            46000
          );
          if (signal) {
            const onAbort = () => reject(new Error('Генерация отменена пользователем.'));
            if (signal.aborted) onAbort();
            else signal.addEventListener('abort', onAbort, { once: true });
          }
        }),
      ]);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (/RESOURCE_EXHAUSTED|429|quota|503|UNAVAILABLE|high demand/i.test(msg)) {
        const rotated = rotateToNextApiKey();
        if (rotated) {
          // Retry immediately with new rotated key
          continue;
        }
      }
      if (
        signal?.aborted ||
        /отменена|API_KEY_INVALID|PERMISSION_DENIED|NOT_FOUND|Не задан GEMINI_API_KEY/i.test(
          msg
        )
      ) {
        throw err;
      }
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 900 * Math.pow(2, attempt)));
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastErr;
}

function parseJsonResponse<T>(rawText: string | undefined): T {
  const cleaned = (rawText ?? '{}')
    .replace(/^```json\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  return JSON.parse(cleaned) as T;
}

interface GeneratedArticlePayload {
  title: string;
  alternativeTitles: string[];
  excerpt: string;
  body: string;
  mainTriggerQuestion: string;
  editorialNotes: string;
}

const ARTICLE_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    alternativeTitles: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    excerpt: { type: Type.STRING },
    body: { type: Type.STRING },
    mainTriggerQuestion: { type: Type.STRING },
    editorialNotes: { type: Type.STRING },
  },
  required: [
    'title',
    'alternativeTitles',
    'excerpt',
    'body',
    'mainTriggerQuestion',
    'editorialNotes',
  ],
};

const QUALITY_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    hookStrength: { type: Type.INTEGER },
    languageNaturalness: { type: Type.INTEGER },
    emotionalImpact: { type: Type.INTEGER },
    plotDepth: { type: Type.INTEGER },
    narrativeUniqueness: { type: Type.INTEGER },
    voiceRecognition: { type: Type.INTEGER },
    endingQuality: { type: Type.INTEGER },
    sourceFidelity: { type: Type.INTEGER },
    soundsLikeAiTemplate: { type: Type.BOOLEAN },
    hasMeaninglessRepetition: { type: Type.BOOLEAN },
    artificialColloquialism: { type: Type.BOOLEAN },
    contradictsSource: { type: Type.BOOLEAN },
    lostImportantDetail: { type: Type.BOOLEAN },
    artificialEnding: { type: Type.BOOLEAN },
    unsubstantiatedClaims: { type: Type.BOOLEAN },
    editorialNotes: { type: Type.STRING },
  },
  required: [
    'hookStrength',
    'languageNaturalness',
    'emotionalImpact',
    'plotDepth',
    'narrativeUniqueness',
    'voiceRecognition',
    'endingQuality',
    'sourceFidelity',
    'soundsLikeAiTemplate',
    'hasMeaninglessRepetition',
    'artificialColloquialism',
    'contradictsSource',
    'lostImportantDetail',
    'artificialEnding',
    'unsubstantiatedClaims',
    'editorialNotes',
  ],
};

export async function runContentQualityControl(params: {
  title: string;
  excerpt: string;
  body: string;
  mainTriggerQuestion: string;
  sourceStory: StoryPlot;
  recentDrafts: ContentDraft[];
  phrasebook: PhrasebookEntry[];
  excludeDraftId?: string;
  signal?: AbortSignal;
}): Promise<{
  qualityBreakdown: ContentQualityBreakdown;
  usedPhrases: string[];
  openingPattern: string;
  endingPattern: string;
}> {
  const {
    title,
    excerpt,
    body,
    mainTriggerQuestion,
    sourceStory,
    recentDrafts,
    phrasebook,
    excludeDraftId,
    signal,
  } = params;

  const det = runDeterministicDraftChecks({
    title,
    body,
    mainTriggerQuestion,
    collection: sourceStory.collection,
    sourceStory,
    recentDrafts,
    phrasebook,
    excludeDraftId,
  });

  const ai = getContentGeminiClient();
  const auditPrompt = `Ты — строгий шеф-редактор MELO_LOVE. Оцени черновик публикации по 8 критериям (НЕ завышай оценки, не ставь 95–100 автоматически, честно отмечай любую искусственность, сухость, потерю нюансов или AI-интонацию).

МАКСИМАЛЬНЫЕ БАЛЛЫ ПО КРИТЕРИЯМ:
- hookStrength (Сила начала и интерес): 0..15
- languageNaturalness (Естественность русского языка): 0..15
- emotionalImpact (Эмоциональное воздействие): 0..15
- plotDepth (Раскрытие сюжета): 0..15
- narrativeUniqueness (Уникальность повествования): 0..15
- voiceRecognition (Узнаваемость стиля MELO_LOVE): 0..10
- endingQuality (Качество финала): 0..10
- sourceFidelity (Соответствие исходному сюжету): 0..5

ИСХОДНЫЙ СЮЖЕТ:
${buildSourceStoryPromptBlock(sourceStory)}

ПРОВЕРЯЕМАЯ ПУБЛИКАЦИЯ:
Заголовок: ${title}
Анонс: ${excerpt}
Текст (${countWords(body)} слов):
${body}
Финальный вопрос: ${mainTriggerQuestion}

АВТОМАТИЧЕСКИЕ ПРЕДУПРЕЖДЕНИЯ ДИСПЕТЧЕРА:
${det.warnings.length > 0 ? det.warnings.join('\n') : 'Автоматических нарушений шаблонов не выявлено.'}`;

  const resp = await runGeminiWithGuard(
    () =>
      ai.models.generateContent({
        model: GENERATION_MODEL,
        contents: auditPrompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: QUALITY_RESPONSE_SCHEMA,
        },
      }),
    signal
  );

  const aiRaw = parseJsonResponse<Record<string, unknown>>(resp.text);

  const checks: ContentQualityChecks = {
    hasMeaninglessRepetition:
      Boolean(aiRaw.hasMeaninglessRepetition) ||
      Boolean(det.repeatedOpeningId) ||
      Boolean(det.repeatedEndingId),
    soundsLikeAiTemplate:
      Boolean(aiRaw.soundsLikeAiTemplate) || det.hasBannedOpening || det.hasRomanticCliche,
    artificialColloquialism: Boolean(aiRaw.artificialColloquialism),
    phraseOveruse:
      det.overusedPhrases.length > 0 ||
      det.bannedPhrasesUsed.length > 0 ||
      det.usedPhrases.length > 2,
    contradictsSource: Boolean(aiRaw.contradictsSource),
    lostImportantDetail: Boolean(aiRaw.lostImportantDetail),
    artificialEnding: Boolean(aiRaw.artificialEnding),
    unsubstantiatedClaims: Boolean(aiRaw.unsubstantiatedClaims),
    verbatimCopy: det.verbatimOverlapRatio >= 0.85,
  };

  const scored = calculateContentQualityScore(
    {
      hookStrength: Number(aiRaw.hookStrength),
      languageNaturalness: Number(aiRaw.languageNaturalness),
      emotionalImpact: Number(aiRaw.emotionalImpact),
      plotDepth: Number(aiRaw.plotDepth),
      narrativeUniqueness: Number(aiRaw.narrativeUniqueness),
      voiceRecognition: Number(aiRaw.voiceRecognition),
      endingQuality: Number(aiRaw.endingQuality),
      sourceFidelity: Number(aiRaw.sourceFidelity),
    },
    checks
  );

  const warnings = [...det.warnings];
  if (checks.contradictsSource) warnings.push('Есть противоречие деталям исходного сюжета.');
  if (checks.lostImportantDetail) warnings.push('Упущен важный нюанс или поворот исходного сюжета.');
  if (checks.soundsLikeAiTemplate) warnings.push('Обнаружена шаблонная AI-интонация.');
  if (checks.artificialEnding) warnings.push('Финал выглядит искусственным или надуманным.');
  if (checks.unsubstantiatedClaims) warnings.push('Обнаружены необоснованные домыслы вне логики сюжета.');

  const editorialNotes = String(
    aiRaw.editorialNotes || 'Редакторская проверка качества выполнена.'
  );

  return {
    qualityBreakdown: {
      ...scored,
      checks,
      warnings: Array.from(new Set(warnings)),
      editorialNotes,
    },
    usedPhrases: det.usedPhrases,
    openingPattern: det.openingPattern,
    endingPattern: det.endingPattern,
  };
}

export interface GeneratePublicationParams {
  story: StoryPlot;
  voiceProfileId?: string;
  voiceSlidersOverride?: Partial<VoiceSliders>;
  lengthPreset?: ContentLengthPreset;
  narrativeStructure?: NarrativeStructurePattern | 'auto';
  variantIndex?: number;
  variantAngleNote?: string;
  taskId?: string;
}

export async function generatePublicationCandidate(
  params: GeneratePublicationParams
): Promise<Omit<ContentDraft, 'id' | 'createdAt' | 'updatedAt' | 'revisionHistory'>> {
  const { story, lengthPreset = 'standard', variantIndex = 0, variantAngleNote, taskId } = params;
  const lockKey = `story:${story.id}`;
  const controller = registerTaskLock(taskId, lockKey);

  try {
    // Audit source completeness honestly (Section 3)
    const audit = auditSourceStoryCompleteness(story);

    const voiceConfig = loadVoiceConfig();
    const allDrafts = loadContentDrafts();
    const phrasebook = loadPhrasebook();

    const { profileId, profileName, sliders } = resolveActiveVoiceSliders(
      voiceConfig,
      story,
      params.voiceProfileId,
      params.voiceSlidersOverride
    );

    const chosenStructure = selectDiverseNarrativeStructure(
      params.narrativeStructure,
      allDrafts,
      variantIndex
    );

    const phraseHints = selectEligiblePhrasebookHints(story, sliders, phrasebook);
    const diversityContext = buildRecentDiversityContext(allDrafts);

    const systemInstruction = buildVoiceSystemInstruction({
      story,
      sliders,
      profileName,
      lengthPreset,
      narrativeStructure: chosenStructure,
      phraseHints,
    });

    const userPrompt = `${buildSourceStoryPromptBlock(story)}

КОНТЕКСТ ПОСЛЕДНИХ ПУБЛИКАЦИЙ (НЕ ПОВТОРЯТЬ ИХ НАЧАЛА, КОНЦОВКИ И РИТМ):
${diversityContext}
${variantAngleNote ? `\nСПЕЦИАЛЬНАЯ ЗАДАЧА ВАРИАНТА #${variantIndex + 1}: ${variantAngleNote}` : ''}
${!audit.sufficient ? `\nВНИМАНИЕ К ИСХОДНИКУ: ${audit.warningNote}` : ''}

Сгенерируй цельную публикацию в JSON:
- title: основной заголовок
- alternativeTitles: ровно 2 разных альтернативных заголовка
- excerpt: живой анонс на 1–2 предложения
- body: текст публикации (без заголовка внутри текста, без Markdown-решёток)
- mainTriggerQuestion: финальный вопрос (или мягкий эмоциональный финальный штрих для романтики)
- editorialNotes: короткое авторское примечание, какая интонация и нюанс использованы`;

    const ai = getContentGeminiClient();
    const genResp = await runGeminiWithGuard(
      () =>
        ai.models.generateContent({
          model: GENERATION_MODEL,
          contents: userPrompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: ARTICLE_RESPONSE_SCHEMA,
          },
        }),
      controller.signal
    );

    let article = parseJsonResponse<GeneratedArticlePayload>(genResp.text);

    // Stage 6-7: Run objective + AI quality check
    let qc = await runContentQualityControl({
      title: article.title,
      excerpt: article.excerpt,
      body: article.body,
      mainTriggerQuestion: article.mainTriggerQuestion,
      sourceStory: story,
      recentDrafts: allDrafts,
      phrasebook,
      signal: controller.signal,
    });

    // Stage 8: One targeted corrective pass if score < 85 (never infinite loop)
    if (qc.qualityBreakdown.overall < 85 && !controller.signal.aborted) {
      const fixPrompt = `Твоя предыдущая версия публикации набрала ${qc.qualityBreakdown.overall}/100 (требуется >= 85).
Замечания шеф-редактора:
- ${qc.qualityBreakdown.editorialNotes}
${qc.qualityBreakdown.warnings.map((w) => `- ${w}`).join('\n')}

ПРЕДЫДУЩИЙ ВАРИАНТ:
Заголовок: ${article.title}
Текст:
${article.body}
Финал: ${article.mainTriggerQuestion}

Исправь указанные недостатки, сохранив верность исходному сюжету (${story.id}) и живой голос MELO_LOVE. Верни обновлённый JSON.`;

      const fixResp = await runGeminiWithGuard(
        () =>
          ai.models.generateContent({
            model: GENERATION_MODEL,
            contents: fixPrompt,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              systemInstruction,
              responseMimeType: 'application/json',
              responseSchema: ARTICLE_RESPONSE_SCHEMA,
            },
          }),
        controller.signal
      );

      const improved = parseJsonResponse<GeneratedArticlePayload>(fixResp.text);
      const improvedQc = await runContentQualityControl({
        title: improved.title,
        excerpt: improved.excerpt,
        body: improved.body,
        mainTriggerQuestion: improved.mainTriggerQuestion,
        sourceStory: story,
        recentDrafts: allDrafts,
        phrasebook,
        signal: controller.signal,
      });

      if (improvedQc.qualityBreakdown.overall >= qc.qualityBreakdown.overall) {
        article = improved;
        qc = improvedQc;
      }
    }

    const extraNotes = [
      audit.warningNote,
      article.editorialNotes,
      qc.qualityBreakdown.editorialNotes,
    ]
      .filter(Boolean)
      .join('\n');

    const qualityScore = qc.qualityBreakdown.overall;
    const status = qualityScore >= 85 ? 'ready_for_review' : 'needs_revision';

    return {
      sourceStoryId: story.id,
      collection: story.collection,
      category: story.category,
      subcategory: story.subcategory,
      title: String(article.title || story.title).trim(),
      alternativeTitles: Array.isArray(article.alternativeTitles)
        ? article.alternativeTitles.map(String).slice(0, 2)
        : [],
      excerpt: String(article.excerpt || story.shortDescription).trim(),
      body: String(article.body || '').trim(),
      mainTriggerQuestion: String(
        article.mainTriggerQuestion || story.mainTriggerQuestion
      ).trim(),
      voiceProfile: profileId,
      voiceSettings: sliders,
      narrativeStructure: chosenStructure,
      contentLength: countWords(article.body || ''),
      lengthPreset,
      qualityScore,
      qualityBreakdown: qc.qualityBreakdown,
      editorialNotes: extraNotes,
      generationModel: GENERATION_MODEL,
      generationPromptVersion: GENERATION_PROMPT_VERSION,
      status,
      sourceUrl: story.sourceUrl || '',
      researchId: story.researchId,
      sourceOriginType: story.originType,
      keywords: story.keywords || [],
      usedPhrases: qc.usedPhrases,
      openingPattern: qc.openingPattern || extractFirstSentence(article.body || ''),
      endingPattern:
        qc.endingPattern || extractLastSentence(article.mainTriggerQuestion || article.body || ''),
      semanticFingerprint: buildContentSemanticFingerprint(
        story.collection,
        story.category,
        article.title || story.title,
        article.body || '',
        story.keywords || []
      ),
      variantIndex,
    };
  } finally {
    releaseTaskLock(taskId, lockKey);
  }
}

export async function generateVariantsCandidates(params: {
  story: StoryPlot;
  count?: number;
  voiceProfileId?: string;
  voiceSlidersOverride?: Partial<VoiceSliders>;
  lengthPreset?: ContentLengthPreset;
  taskId?: string;
}): Promise<Array<Omit<ContentDraft, 'id' | 'createdAt' | 'updatedAt' | 'revisionHistory'>>> {
  const existingForStory = loadContentDrafts().filter(
    (d) => d.sourceStoryId === params.story.id && d.status !== 'rejected'
  );
  const remainingSlots = Math.max(0, 3 - existingForStory.length);
  if (remainingSlots === 0) {
    throw new Error(
      `Для сюжета ${params.story.id} уже создано максимальное количество вариантов (3).`
    );
  }

  const targetCount = Math.max(1, Math.min(remainingSlots, Number(params.count || 3)));
  const allDrafts = loadContentDrafts();

  // Select distinctly different structures and storytelling angles for each variant
  const angleConfigs: Array<{ structure: NarrativeStructurePattern; angleNote: string }> = [
    {
      structure: selectDiverseNarrativeStructure('auto', allDrafts, 0),
      angleNote: 'Сделай акцент на поступке и скрытой бытовой механике; динамичный разговорный старт.',
    },
    {
      structure: 'contradiction_start',
      angleNote:
        'Построй рассказ вокруг контраста между словами героев и реальными последствиями; иной темп и зачин.',
    },
    {
      structure: params.story.collection === 'debate' ? 'outcome_first' : 'detail_start',
      angleNote:
        params.story.collection === 'debate'
          ? 'Начни с итога конфликта, а затем раскрути причины и неожиданную деталь в обратном порядке.'
          : 'Начни с конкретной тихой предметной детали сцены и подай историю камерно и тепло.',
    },
  ];

  const results: Array<Omit<ContentDraft, 'id' | 'createdAt' | 'updatedAt' | 'revisionHistory'>> = [];

  for (let i = 0; i < targetCount; i++) {
    const cfg = angleConfigs[i % angleConfigs.length];
    const usedOpeningNotes =
      results.length > 0
        ? `\nУЖЕ СОЗДАННЫЕ ВАРИАНТЫ ЭТОГО СЮЖЕТА (НЕ ПОВТОРЯЙ ИХ НАЧАЛА И ФОРМУЛИРОВКИ):\n${results
            .map((r, idx) => `${idx + 1}) «${r.title}» — старт: «${r.openingPattern}»`)
            .join('\n')}`
        : '';

    const candidate = await generatePublicationCandidate({
      story: params.story,
      voiceProfileId: params.voiceProfileId,
      voiceSlidersOverride: params.voiceSlidersOverride,
      lengthPreset: params.lengthPreset || 'standard',
      narrativeStructure: cfg.structure,
      variantIndex: existingForStory.length + i,
      variantAngleNote: `${cfg.angleNote}${usedOpeningNotes}`,
      taskId: params.taskId ? `${params.taskId}-v${i + 1}` : undefined,
    });
    results.push(candidate);
  }

  return results;
}

export async function rewriteDraftContent(params: {
  draft: ContentDraft;
  story: StoryPlot;
  action: RewriteActionType;
  customInstruction?: string;
  taskId?: string;
}): Promise<{
  title: string;
  alternativeTitles: string[];
  excerpt: string;
  body: string;
  mainTriggerQuestion: string;
  qualityBreakdown: ContentQualityBreakdown;
  usedPhrases: string[];
  openingPattern: string;
  endingPattern: string;
  editorialNotes: string;
  snapshotToAppend: ContentRevisionSnapshot;
}> {
  const { draft, story, action, customInstruction, taskId } = params;
  const lockKey = `draft:${draft.id}`;
  const controller = registerTaskLock(taskId, lockKey);

  const actionPrompts: Record<RewriteActionType, string> = {
    rewrite_opening:
      'Перепиши ТОЛЬКО зачин (первые 1–3 предложения) и первый абзац: сделай начало свежим, цепляющим, без штампов, сохранив остальную часть текста.',
    rewrite_ending:
      'Перепиши ТОЛЬКО финал и финальный вопрос (mainTriggerQuestion), сделав развязку живой, точной и вызывающей отклик, не ломая начало и середину текста.',
    more_ironic:
      'Перепиши текст с большей умной иронией и наблюдательностью к несоответствию слов и поступков (без грубого сарказма и оскорблений).',
    more_emotional:
      'Усиль эмоциональное проживание сцены через конкретные жесты, паузы и детали, не скатываясь в пафос и открытки.',
    less_pathos:
      'Убери лишний пафос, громкие обобщения и морализаторство — сделай тон приземлённее, живее и естественнее.',
    simpler:
      'Упрости язык: убери тяжёлые канцеляризмы, сложные причастные обороты и искусственные речевые конструкции, сохранив смысл.',
    more_natural:
      'Сделай повествование максимально похожим на живую человеческую речь интересного рассказчика, убери любую "нейросетевую" гладкость.',
    shorter:
      'Сократи текст примерно на 30–40%, оставив самую суть, острые детали и концовку без потери нюансов сюжета.',
    longer:
      'Расширь текст примерно на 30–40%, глубже раскрыв мотивацию сторон, обстановку и психологический механизм из исходного сюжета (без воды).',
    custom: customInstruction?.trim() || 'Улучши текст согласно комментарию редактора.',
  };

  try {
    const voiceConfig = loadVoiceConfig();
    const allDrafts = loadContentDrafts();
    const phrasebook = loadPhrasebook();
    const { profileName, sliders } = resolveActiveVoiceSliders(
      voiceConfig,
      story,
      draft.voiceProfile,
      draft.voiceSettings
    );

    const phraseHints = selectEligiblePhrasebookHints(story, sliders, phrasebook);
    const systemInstruction = buildVoiceSystemInstruction({
      story,
      sliders,
      profileName,
      lengthPreset: draft.lengthPreset,
      narrativeStructure: draft.narrativeStructure,
      phraseHints,
    });

    const prompt = `${buildSourceStoryPromptBlock(story)}

ТЕКУЩАЯ ВЕРСИЯ ПУБЛИКАЦИИ [${draft.id}]:
Заголовок: ${draft.title}
Альтернативные заголовки: ${(draft.alternativeTitles || []).join(' | ')}
Анонс: ${draft.excerpt}
Текст:
${draft.body}
Финальный вопрос: ${draft.mainTriggerQuestion}

ЗАДАЧА РЕДАКТУРЫ (${action}):
${actionPrompts[action]}
${customInstruction && action !== 'custom' ? `Дополнительное пожелание редактора: ${customInstruction}` : ''}

Верни обновлённую публикацию в JSON.`;

    const ai = getContentGeminiClient();
    const resp = await runGeminiWithGuard(
      () =>
        ai.models.generateContent({
          model: GENERATION_MODEL,
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: ARTICLE_RESPONSE_SCHEMA,
          },
        }),
      controller.signal
    );

    const parsed = parseJsonResponse<GeneratedArticlePayload>(resp.text);
    const qc = await runContentQualityControl({
      title: parsed.title || draft.title,
      excerpt: parsed.excerpt || draft.excerpt,
      body: parsed.body || draft.body,
      mainTriggerQuestion: parsed.mainTriggerQuestion || draft.mainTriggerQuestion,
      sourceStory: story,
      recentDrafts: allDrafts,
      phrasebook,
      excludeDraftId: draft.id,
      signal: controller.signal,
    });

    const nextVersionNumber = (draft.revisionHistory?.length || 0) + 1;
    const snapshotToAppend: ContentRevisionSnapshot = {
      versionId: `REV-${nextVersionNumber}-${Date.now().toString(36).toUpperCase()}`,
      versionNumber: nextVersionNumber,
      createdAt: new Date().toISOString(),
      actionLabel: `Перед: ${action}`,
      title: draft.title,
      alternativeTitles: draft.alternativeTitles || [],
      excerpt: draft.excerpt,
      body: draft.body,
      mainTriggerQuestion: draft.mainTriggerQuestion,
      voiceProfile: draft.voiceProfile,
      voiceSettings: draft.voiceSettings,
      narrativeStructure: draft.narrativeStructure,
      lengthPreset: draft.lengthPreset,
      qualityScore: draft.qualityScore,
      qualityBreakdown: draft.qualityBreakdown,
      editorialNotes: draft.editorialNotes,
    };

    return {
      title: String(parsed.title || draft.title).trim(),
      alternativeTitles: Array.isArray(parsed.alternativeTitles)
        ? parsed.alternativeTitles.map(String).slice(0, 2)
        : draft.alternativeTitles,
      excerpt: String(parsed.excerpt || draft.excerpt).trim(),
      body: String(parsed.body || draft.body).trim(),
      mainTriggerQuestion: String(parsed.mainTriggerQuestion || draft.mainTriggerQuestion).trim(),
      qualityBreakdown: qc.qualityBreakdown,
      usedPhrases: qc.usedPhrases,
      openingPattern: qc.openingPattern,
      endingPattern: qc.endingPattern,
      editorialNotes: `${String(parsed.editorialNotes || '').trim()}\n${qc.qualityBreakdown.editorialNotes}`.trim(),
      snapshotToAppend,
    };
  } finally {
    releaseTaskLock(taskId, lockKey);
  }
}

export function buildDraftRecordFromCandidate(
  candidate: Omit<ContentDraft, 'id' | 'createdAt' | 'updatedAt' | 'revisionHistory'>,
  existingDrafts: ContentDraft[]
): ContentDraft {
  const now = new Date().toISOString();
  const id = generateNextContentId(existingDrafts, candidate.collection);
  return {
    ...candidate,
    id,
    createdAt: now,
    updatedAt: now,
    revisionHistory: [],
  };
}
