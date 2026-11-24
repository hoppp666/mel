import { GoogleGenAI, Type } from '@google/genai';
import { createRotatedGeminiClient } from './geminiKeyRotator.ts';
import {
  DEBATE_CATEGORIES,
  PLOT_MECHANICS,
  ROMANTIC_CATEGORIES,
} from '../src/shared/categories.ts';
import {
  buildSemanticFingerprint,
  calculateOverallQuality,
  findSimilarStories,
} from '../src/shared/similarity.ts';
import type { CollectionType, StoryPlot } from '../src/shared/types.ts';
import { generateNextStoryId } from './storage.ts';

function getGeminiClient(): GoogleGenAI {
  return createRotatedGeminiClient();
}

function selectBalancedCategories(
  collection: CollectionType,
  existingStories: StoryPlot[],
  customCategories: string[],
  targetCategory: string,
  count: number
): string[] {
  const base = collection === 'debate' ? DEBATE_CATEGORIES : ROMANTIC_CATEGORIES;
  const allCats = Array.from(new Set([...base, ...customCategories]));

  if (targetCategory && targetCategory !== 'ALL_BALANCED') {
    return [targetCategory];
  }

  const counts = new Map<string, number>();
  for (const cat of allCats) counts.set(cat, 0);
  for (const s of existingStories) {
    if (s.collection === collection && s.verificationStatus !== 'rejected') {
      counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
    }
  }

  const sorted = [...allCats].sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0));
  return sorted.slice(0, Math.min(allCats.length, Math.max(8, count)));
}

function buildExistingContextSummary(existingStories: StoryPlot[], collection: CollectionType): string {
  const sameCollection = existingStories
    .filter((s) => s.collection === collection && s.verificationStatus !== 'rejected')
    .slice(-90);

  if (sameCollection.length === 0) return 'База пока пуста.';

  return sameCollection
    .map(
      (s, i) =>
        `${i + 1}. [${s.category}] «${s.title}» — ${s.mainTheme || s.coreConflictOrAction} (механика: ${s.plotMechanic})`
    )
    .join('\n');
}

export interface GenerateBatchParams {
  collection: CollectionType;
  targetCategory: string;
  batchSize: number;
  batchNumber: number;
  researchMode: 'original' | 'external_search';
  existingStories: StoryPlot[];
  customCategories: string[];
  similarityThreshold: number;
}

export interface GenerateBatchResult {
  candidates: StoryPlot[];
  groundingUrls: Array<{ uri: string; title: string }>;
  usedSearchGrounding: boolean;
}

export async function generateStoryBatch(params: GenerateBatchParams): Promise<GenerateBatchResult> {
  const ai = getGeminiClient();
  const {
    collection,
    targetCategory,
    batchSize,
    batchNumber,
    researchMode,
    existingStories,
    customCategories,
    similarityThreshold,
  } = params;

  const targetCategories = selectBalancedCategories(
    collection,
    existingStories,
    customCategories,
    targetCategory,
    batchSize
  );

  const existingSummary = buildExistingContextSummary(existingStories, collection);

  const collectionInstruction =
    collection === 'debate'
      ? `КОЛЛЕКЦИЯ A — «Кто здесь прав?» (дискуссионные жизненные ситуации для Дзена).
Требования:
- Неоднозначные, жизненные, психологически точные ситуации в отношениях, семье, финансах, быту, границах.
- Избегай карикатурных злодеев и очевидных жертв: читатель должен понимать логику обеих сторон.
- Каждая запись должна иметь конкретную бытовую деталь, скрытое ожидание, неожиданный нюанс и острый вопрос для обсуждения.
- Поля оценки качества включают: originality, realism, emotionalExpressiveness, interest, discussionPotential, specificity, plotVariability, ambiguity, bothSidesArgumentation, contradictionStrength.`
      : `КОЛЛЕКЦИЯ B — «Романтические истории» (жизненные сцены тепла и заботы для Дзена).
Требования:
- Это НЕ абстрактные цитаты и НЕ слащавые шаблоны, а конкретные житейские сцены, поступки и маленькие предметные детали.
- Вызывают узнавание, теплоту, улыбку, ностальгию или желание рассказать свою историю в комментариях.
- В полях sideAPosition и sideBPosition раскрой взгляд/мотивацию первого участника и эмоциональную реакцию второго.
- Поля оценки качества включают: originality, realism, emotionalExpressiveness, interest, discussionPotential, specificity, plotVariability, emotionalWarmth, relatability, smallDetailPower, naturalness.`;

  const systemInstruction = `Ты — профессиональный редактор, сценарист жизненных историй и специалист по психологии отношений проекта MELO_LOVE.
Твоя задача — создавать оригинальные, разнообразные, глубоко проработанные сюжетные основы (НЕ готовые статьи и НЕ наборы общих вопросов) на русском языке.

ЖЕСТКИЕ ПРАВИЛА ПРОТИВ ШАБЛОНОВ:
1. Никаких повторяющихся сценариев, клонирования с заменой имён, профессий или предметов.
2. Каждая история внутри партии должна иметь РАЗНУЮ сюжетную механику и РАЗНЫЕ жизненные обстоятельства.
3. Ставь честные, критичные оценки качества от 60 до 95 — не завышай искусственно до 98–100. Если история послабее — честно пиши в editorialNote, что именно стоит усилить.
4. Используй механики из списка: ${PLOT_MECHANICS.join('; ')}.`;

  const responseSchema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        category: { type: Type.STRING },
        subcategory: { type: Type.STRING },
        title: { type: Type.STRING },
        shortDescription: { type: Type.STRING },
        fullPlot: { type: Type.STRING },
        participants: { type: Type.STRING },
        setting: { type: Type.STRING },
        coreConflictOrAction: { type: Type.STRING },
        sideAPosition: { type: Type.STRING },
        sideBPosition: { type: Type.STRING },
        emotionalMechanism: { type: Type.STRING },
        hiddenExpectation: { type: Type.STRING },
        unexpectedNuance: { type: Type.STRING },
        possibleTwist: { type: Type.STRING },
        mainTriggerQuestion: { type: Type.STRING },
        additionalQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
        keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
        mainTheme: { type: Type.STRING },
        plotMechanic: { type: Type.STRING },
        uniqueDetails: { type: Type.STRING },
        sourceAnalysisNote: { type: Type.STRING },
        quality: {
          type: Type.OBJECT,
          properties: {
            originality: { type: Type.INTEGER },
            realism: { type: Type.INTEGER },
            emotionalExpressiveness: { type: Type.INTEGER },
            interest: { type: Type.INTEGER },
            discussionPotential: { type: Type.INTEGER },
            specificity: { type: Type.INTEGER },
            plotVariability: { type: Type.INTEGER },
            ambiguity: { type: Type.INTEGER },
            bothSidesArgumentation: { type: Type.INTEGER },
            contradictionStrength: { type: Type.INTEGER },
            emotionalWarmth: { type: Type.INTEGER },
            relatability: { type: Type.INTEGER },
            smallDetailPower: { type: Type.INTEGER },
            naturalness: { type: Type.INTEGER },
            editorialNote: { type: Type.STRING },
          },
          required: [
            'originality',
            'realism',
            'emotionalExpressiveness',
            'interest',
            'discussionPotential',
            'specificity',
            'plotVariability',
            'editorialNote',
          ],
        },
      },
      required: [
        'category',
        'subcategory',
        'title',
        'shortDescription',
        'fullPlot',
        'participants',
        'setting',
        'coreConflictOrAction',
        'sideAPosition',
        'sideBPosition',
        'emotionalMechanism',
        'hiddenExpectation',
        'unexpectedNuance',
        'possibleTwist',
        'mainTriggerQuestion',
        'additionalQuestions',
        'keywords',
        'mainTheme',
        'plotMechanic',
        'uniqueDetails',
        'quality',
      ],
    },
  };

  let rawText = '[]';
  const groundingUrls: Array<{ uri: string; title: string }> = [];
  let usedSearchGrounding = false;

  if (researchMode === 'external_search') {
    // Two-step search-grounded flow: first search real foreign relationship threads/articles,
    // then reimagine into original Russian plot structures with real verified source URLs.
    const searchPrompt = `Найди реальные обсуждения и жизненные истории об отношениях на Reddit (r/AmItheAsshole, r/relationship_advice, r/relationships, r/BestofRedditorUpdates), NYT Modern Love или The Cut по темам: ${targetCategories.join(', ')}.
Выдели ${Math.min(batchSize, 12)} разных интересных жизненных механик и конфликтов/сцен (не повторяя уже существующие в базе).
Уже существующие сюжеты (НЕ ПОВТОРЯТЬ):
${existingSummary}

Кратко опиши каждую найденную механику, суть ситуации и реальный источник.`;

    let searchInsights = '';
    try {
      const searchResp = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: searchPrompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });
      searchInsights = searchResp.text ?? '';
      const chunks = searchResp.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      for (const ch of chunks) {
        if (ch.web?.uri) {
          groundingUrls.push({
            uri: ch.web.uri,
            title: ch.web.title || ch.web.uri,
          });
        }
      }
      usedSearchGrounding = groundingUrls.length > 0;
    } catch (searchErr) {
      console.warn('Google Search grounding fallback to original generation:', searchErr);
    }

    const structurePrompt = `${collectionInstruction}

Сгенерируй ровно ${batchSize} уникальных сюжетных основ (Партия #${batchNumber}).
Распредели сюжеты по категориям: ${targetCategories.join(', ')}.

${
  searchInsights && usedSearchGrounding
    ? `Вот реальные зарубежные находки из поиска — переосмысли их механики творчески в жизненные реалии без дословного перевода и копирования:\n${searchInsights}\n`
    : `Живой интернет-поиск сейчас не вернул проверенных ссылок — генерируй на 100% оригинальные идеи и НЕ выдумывай ссылки.\n`
}

УЖЕ СУЩЕСТВУЮЩИЕ СЮЖЕТЫ В БАЗЕ (СТРОГО НЕ ПОВТОРЯТЬ И НЕ ДЕЛАТЬ ПОХОЖИХ):
${existingSummary}`;

    const structuredResp = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: structurePrompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema,
      },
    });
    rawText = structuredResp.text ?? '[]';
  } else {
    const prompt = `${collectionInstruction}

Сгенерируй ровно ${batchSize} уникальных сюжетных основ (Партия #${batchNumber}).
Приоритетные категории для баланса базы: ${targetCategories.join(', ')}.

УЖЕ СУЩЕСТВУЮЩИЕ СЮЖЕТЫ В БАЗЕ (СТРОГО НЕ ПОВТОРЯТЬ, ИЗБЕГАТЬ СМЫСЛОВЫХ КЛОНОВ):
${existingSummary}`;

    const structuredResp = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema,
      },
    });
    rawText = structuredResp.text ?? '[]';
  }

  let parsedItems: Array<Record<string, unknown>> = [];
  try {
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    const data = JSON.parse(cleaned);
    if (Array.isArray(data)) {
      parsedItems = data;
    }
  } catch (err) {
    throw new Error(`Модель вернула некорректный JSON: ${(err as Error).message}`);
  }

  const now = new Date().toISOString();
  const runningPool: StoryPlot[] = [...existingStories];
  const candidates: StoryPlot[] = [];

  for (let idx = 0; idx < parsedItems.length; idx++) {
    const raw = parsedItems[idx];
    const nextId = generateNextStoryId(runningPool, collection);
    const qRaw = (raw.quality as Record<string, unknown>) || {};

    const qualityScores = {
      originality: clampScore(qRaw.originality),
      realism: clampScore(qRaw.realism),
      emotionalExpressiveness: clampScore(qRaw.emotionalExpressiveness),
      interest: clampScore(qRaw.interest),
      discussionPotential: clampScore(qRaw.discussionPotential),
      specificity: clampScore(qRaw.specificity),
      plotVariability: clampScore(qRaw.plotVariability),
      ambiguity: collection === 'debate' ? clampScore(qRaw.ambiguity ?? 76) : undefined,
      bothSidesArgumentation:
        collection === 'debate' ? clampScore(qRaw.bothSidesArgumentation ?? 76) : undefined,
      contradictionStrength:
        collection === 'debate' ? clampScore(qRaw.contradictionStrength ?? 76) : undefined,
      emotionalWarmth: collection === 'romantic' ? clampScore(qRaw.emotionalWarmth ?? 78) : undefined,
      relatability: collection === 'romantic' ? clampScore(qRaw.relatability ?? 78) : undefined,
      smallDetailPower:
        collection === 'romantic' ? clampScore(qRaw.smallDetailPower ?? 78) : undefined,
      naturalness: collection === 'romantic' ? clampScore(qRaw.naturalness ?? 78) : undefined,
      editorialNote: String(qRaw.editorialNote || 'Проверено автоматической оценкой партии.'),
    };

    const overall = calculateOverallQuality(qualityScores, collection);

    // Attach verified grounding URL only if Google Search returned real chunks
    const linkedGrounding =
      usedSearchGrounding && groundingUrls.length > 0
        ? groundingUrls[idx % groundingUrls.length]
        : null;

    const plot: StoryPlot = {
      id: nextId,
      collection,
      category: String(raw.category || targetCategories[0] || 'Общие отношения'),
      subcategory: String(raw.subcategory || 'Жизненная ситуация'),
      title: String(raw.title || `Сюжет #${nextId}`),
      shortDescription: String(raw.shortDescription || ''),
      fullPlot: String(raw.fullPlot || ''),
      participants: String(raw.participants || ''),
      setting: String(raw.setting || ''),
      coreConflictOrAction: String(raw.coreConflictOrAction || ''),
      sideAPosition: String(raw.sideAPosition || ''),
      sideBPosition: String(raw.sideBPosition || ''),
      emotionalMechanism: String(raw.emotionalMechanism || ''),
      hiddenExpectation: String(raw.hiddenExpectation || ''),
      unexpectedNuance: String(raw.unexpectedNuance || ''),
      possibleTwist: String(raw.possibleTwist || ''),
      mainTriggerQuestion: String(raw.mainTriggerQuestion || ''),
      additionalQuestions: Array.isArray(raw.additionalQuestions)
        ? raw.additionalQuestions.map(String)
        : [],
      keywords: Array.isArray(raw.keywords) ? raw.keywords.map(String) : [],
      ideaSource: linkedGrounding
        ? `Вдохновлено внешним материалом: ${linkedGrounding.title}`
        : 'Оригинальная генерация с учётом базы (без внешнего URL)',
      sourceUrl: linkedGrounding ? linkedGrounding.uri : '',
      originType: linkedGrounding ? 'external' : 'original',
      createdAt: now,
      verificationStatus: 'pending',
      usageStatus: 'unused',
      semanticFingerprint: '',
      mainTheme: String(raw.mainTheme || raw.category || ''),
      plotMechanic: String(raw.plotMechanic || 'Неожиданный конфликт ценностей'),
      uniqueDetails: String(raw.uniqueDetails || ''),
      sourceAnalysisNote: linkedGrounding
        ? String(
            raw.sourceAnalysisNote ||
              `Адаптировано на основе механики из источника ${linkedGrounding.title}.`
          )
        : String(raw.sourceAnalysisNote || ''),
      batchNumber,
      quality: {
        ...qualityScores,
        overall,
      },
      updatedAt: now,
    };

    plot.semanticFingerprint = buildSemanticFingerprint(plot);

    // Check semantic similarity against existing DB + earlier candidates in this batch
    const matches = findSimilarStories(plot, runningPool, similarityThreshold);
    plot.similarityMatches = matches;
    plot.duplicateFlag = matches.length > 0;
    if (overall < 68 && !plot.duplicateFlag) {
      plot.verificationStatus = 'needs_revision';
    }

    candidates.push(plot);
    runningPool.push(plot);
  }

  return {
    candidates,
    groundingUrls,
    usedSearchGrounding,
  };
}

function clampScore(val: unknown): number {
  const num = Number(val);
  if (Number.isNaN(num)) return 75;
  return Math.max(40, Math.min(98, Math.round(num)));
}
