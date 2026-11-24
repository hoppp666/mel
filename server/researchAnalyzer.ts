import { GoogleGenAI, Type } from '@google/genai';
import {
  DEBATE_CATEGORIES,
  PLOT_MECHANICS,
  ROMANTIC_CATEGORIES,
} from '../src/shared/categories.ts';
import { calculateResearchQuality } from '../src/shared/similarity.ts';
import type {
  CollectionType,
  ResearchDepth,
  ResearchIdeaDraft,
  ResearchQualityBreakdown,
  ResearchResult,
} from '../src/shared/types.ts';
import { createRotatedGeminiClient, rotateToNextApiKey } from './geminiKeyRotator.ts';
import type { DiscoveredRawMaterial } from './researchSources.ts';

export function getResearchGeminiClient(): GoogleGenAI {
  return createRotatedGeminiClient({ timeout: 22000 });
}

export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        fn(),
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Таймаут запроса к Gemini API (25с)')), 25000);
        }),
      ]);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (/RESOURCE_EXHAUSTED|429|quota|503|UNAVAILABLE|high demand/i.test(msg)) {
        const rotated = rotateToNextApiKey();
        if (rotated) {
          continue;
        }
      }
      if (
        /API_KEY_INVALID|PERMISSION_DENIED|NOT_FOUND|Не задан GEMINI_API_KEY/i.test(
          msg
        )
      ) {
        throw err;
      }
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 800 * Math.pow(2, attempt)));
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastErr;
}

function clampScore(val: unknown, fallback = 75): number {
  const n = Number(val);
  if (Number.isNaN(n)) return fallback;
  return Math.max(40, Math.min(98, Math.round(n)));
}

function parseModelJson<T>(rawText: string | undefined): T {
  const cleaned = (rawText ?? '{}')
    .replace(/^```json\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  return JSON.parse(cleaned) as T;
}

export interface AnalyzedCardPayload {
  sourceSummary: string;
  mainSituation: string;
  participants: string;
  relationshipType: string;
  mainConflict: string;
  sideA: string;
  sideB: string;
  emotionalMechanism: string;
  hiddenExpectation: string;
  unexpectedDetail: string;
  possibleTwist: string;
  readerReactionPotential: string;
  storyMechanic: string;
  targetCategory: string;
  keywords: string[];
  researchNotes: string;
  originalityAssessment: number;
  qualityBreakdown: ResearchQualityBreakdown;
}

export async function analyzeDiscoveredMaterial(
  material: DiscoveredRawMaterial,
  collection: CollectionType,
  preferredCategory: string,
  depth: ResearchDepth,
  customCategories: string[] = []
): Promise<AnalyzedCardPayload> {
  const ai = getResearchGeminiClient();
  const baseCats = collection === 'debate' ? DEBATE_CATEGORIES : ROMANTIC_CATEGORIES;
  const allCats = Array.from(new Set([...baseCats, ...customCategories]));

  const directionPrompt =
    collection === 'debate'
      ? `НАПРАВЛЕНИЕ: DEBATE RESEARCH («Кто здесь прав?»).
Фокус анализа: почему эта ситуация вызывает спор и делит читателей на два лагеря? Какие аргументы есть у каждой стороны? В чём скрытое противоречие границ, денег, обязательств или ожиданий?`
      : `НАПРАВЛЕНИЕ: ROMANTIC RESEARCH («Романтические истории»).
Фокус анализа: какая житейская мелочь, жест заботы, неловкость или память о важном делает эту историю тёплой и узнаваемой без приторности и штампов про букеты?`;

  const systemInstruction = `Ты — старший редактор-аналитик зарубежного контента проекта MELO_LOVE.
Твоя задача — глубоко разобрать найденный зарубежный материал и отделить ФАКТЫ из источника от АНАЛИТИЧЕСКИХ ВЫВОДОВ.

СТРОГИЕ ПРАВИЛА:
1. В поле sourceSummary перескажи ТОЛЬКО фактическое содержание переданного материала, без выдуманных деталей, цитат, имён или дат.
2. В аналитических полях раскрой психологию, мотивацию сторон, скрытое ожидание, неожиданную деталь и то, ПОЧЕМУ история цепляет читателя.
3. Не используй термин «вирусность» или «прогноз вирусности» в оценке и пояснениях.
4. Выбирай категорию строго из списка: ${allCats.join('; ')}.
5. Выбирай механику из списка (или точную формулировку): ${PLOT_MECHANICS.join('; ')}.
6. Ставь честные оценки 0–100 (обычно 68–92), а не 99 по умолчанию.`;

  const prompt = `${directionPrompt}
Глубина анализа: ${depth === 'deep' ? 'Углублённый разбор мотивации и скрытых смыслов' : 'Стандартный структурный разбор'}.
Предпочитаемая категория (если подходит, иначе выбери более точную из справочника): ${
    preferredCategory === 'ALL_BALANCED' ? 'Выбери наиболее точную из списка' : preferredCategory
  }.

ДАННЫЕ НАЙДЕННОГО МАТЕРИАЛА:
- Источник: ${material.sourceName} (${material.sourceType})
- Проверенный URL: ${material.sourceUrl}
- Заголовок: ${material.sourceTitle}
- Автор: ${material.sourceAuthor}
- Дата публикации: ${material.sourceDate}
- Язык: ${material.originalLanguage}
- Фрагмент/описание: ${material.snippet}

Проанализируй материал на русском языке и оцени потенциал для переосмысления в самостоятельный сюжет.`;

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      sourceSummary: { type: Type.STRING },
      mainSituation: { type: Type.STRING },
      participants: { type: Type.STRING },
      relationshipType: { type: Type.STRING },
      mainConflict: { type: Type.STRING },
      sideA: { type: Type.STRING },
      sideB: { type: Type.STRING },
      emotionalMechanism: { type: Type.STRING },
      hiddenExpectation: { type: Type.STRING },
      unexpectedDetail: { type: Type.STRING },
      possibleTwist: { type: Type.STRING },
      readerReactionPotential: { type: Type.STRING },
      storyMechanic: { type: Type.STRING },
      targetCategory: { type: Type.STRING },
      keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
      researchNotes: { type: Type.STRING },
      originalityAssessment: { type: Type.INTEGER },
      quality: {
        type: Type.OBJECT,
        properties: {
          originality: { type: Type.INTEGER },
          realism: { type: Type.INTEGER },
          specificity: { type: Type.INTEGER },
          emotionalExpressiveness: { type: Type.INTEGER },
          readerInterest: { type: Type.INTEGER },
          diversity: { type: Type.INTEGER },
          discussionPotential: { type: Type.INTEGER },
          mechanicQuality: { type: Type.INTEGER },
          ambiguity: { type: Type.INTEGER },
          bothSidesArgumentation: { type: Type.INTEGER },
          debatePotential: { type: Type.INTEGER },
          warmth: { type: Type.INTEGER },
          naturalness: { type: Type.INTEGER },
          emotionalDetailPower: { type: Type.INTEGER },
          relatability: { type: Type.INTEGER },
          nonSaccharine: { type: Type.INTEGER },
          explanation: { type: Type.STRING },
        },
        required: [
          'originality',
          'realism',
          'specificity',
          'emotionalExpressiveness',
          'readerInterest',
          'diversity',
          'discussionPotential',
          'mechanicQuality',
          'explanation',
        ],
      },
    },
    required: [
      'sourceSummary',
      'mainSituation',
      'participants',
      'relationshipType',
      'mainConflict',
      'sideA',
      'sideB',
      'emotionalMechanism',
      'hiddenExpectation',
      'unexpectedDetail',
      'possibleTwist',
      'readerReactionPotential',
      'storyMechanic',
      'targetCategory',
      'keywords',
      'researchNotes',
      'originalityAssessment',
      'quality',
    ],
  };

  const resp = await withRetry(() =>
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema,
      },
    })
  );

  const parsed = parseModelJson<Record<string, unknown>>(resp.text);
  const qRaw = (parsed.quality as Record<string, unknown>) || {};

  const breakdownBase: Omit<ResearchQualityBreakdown, 'overall' | 'tierLabel'> = {
    originality: clampScore(qRaw.originality, 76),
    realism: clampScore(qRaw.realism, 78),
    specificity: clampScore(qRaw.specificity, 76),
    emotionalExpressiveness: clampScore(qRaw.emotionalExpressiveness, 76),
    readerInterest: clampScore(qRaw.readerInterest, 78),
    diversity: clampScore(qRaw.diversity, 76),
    discussionPotential: clampScore(qRaw.discussionPotential, 78),
    mechanicQuality: clampScore(qRaw.mechanicQuality, 76),
    ...(collection === 'debate'
      ? {
          ambiguity: clampScore(qRaw.ambiguity, 77),
          bothSidesArgumentation: clampScore(qRaw.bothSidesArgumentation, 76),
          debatePotential: clampScore(qRaw.debatePotential, 78),
        }
      : {
          warmth: clampScore(qRaw.warmth, 78),
          naturalness: clampScore(qRaw.naturalness, 78),
          emotionalDetailPower: clampScore(qRaw.emotionalDetailPower, 77),
          relatability: clampScore(qRaw.relatability, 78),
          nonSaccharine: clampScore(qRaw.nonSaccharine, 78),
        }),
    explanation: String(qRaw.explanation || 'Автоматическая редакторская оценка исследовательской карточки.'),
  };

  const { overall, tierLabel } = calculateResearchQuality(breakdownBase, collection);

  return {
    sourceSummary: String(parsed.sourceSummary || material.snippet || material.sourceTitle),
    mainSituation: String(parsed.mainSituation || ''),
    participants: String(parsed.participants || ''),
    relationshipType: String(parsed.relationshipType || ''),
    mainConflict: String(parsed.mainConflict || ''),
    sideA: String(parsed.sideA || ''),
    sideB: String(parsed.sideB || ''),
    emotionalMechanism: String(parsed.emotionalMechanism || ''),
    hiddenExpectation: String(parsed.hiddenExpectation || ''),
    unexpectedDetail: String(parsed.unexpectedDetail || ''),
    possibleTwist: String(parsed.possibleTwist || ''),
    readerReactionPotential: String(parsed.readerReactionPotential || ''),
    storyMechanic: String(parsed.storyMechanic || PLOT_MECHANICS[0]),
    targetCategory: String(parsed.targetCategory || allCats[0]),
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String).slice(0, 8) : [],
    researchNotes: String(parsed.researchNotes || ''),
    originalityAssessment: clampScore(parsed.originalityAssessment, 78),
    qualityBreakdown: {
      ...breakdownBase,
      overall,
      tierLabel,
    },
  };
}

export async function generateOriginalIdeaFromResearch(
  card: ResearchResult,
  existingContexts: string[],
  customCategories: string[] = []
): Promise<{
  idea: ResearchIdeaDraft;
  qualityBreakdown: ResearchQualityBreakdown;
  originalityAssessment: number;
}> {
  const ai = getResearchGeminiClient();
  const baseCats = card.collection === 'debate' ? DEBATE_CATEGORIES : ROMANTIC_CATEGORIES;
  const allCats = Array.from(new Set([...baseCats, ...customCategories]));

  const systemInstruction = `Ты — сценарист жизненных историй и психолог отношений проекта MELO_LOVE.
Твоя задача — на основе аналитической карточки зарубежного материала создать НОВУЮ, САМОСТОЯТЕЛЬНУЮ сюжетную основу на русском языке.

КАК ПЕРЕОСМЫСЛЯТЬ (КРИТИЧЕСКИ ВАЖНО):
- ЗАПРЕЩЕНО делать дословный перевод или примитивную замену «Джон/Нью-Йорк → Иван/Казань».
- Переосмысли структуру конфликта, бытовые обстоятельства, мотивацию сторон, последовательность событий, неожиданную предметную деталь и развязку так, чтобы история ощущалась как живая, органичная российская или универсальная жизненная ситуация.
- Сохрани при этом ту сильную эмоциональную или моральную механику, которая сделала исходную находку интересной.
- Для DEBATE («Кто здесь прав?»): у обеих сторон должна быть понятная жизненная логика без карикатурных злодеев.
- Для ROMANTIC («Романтические истории»): фокус на тихой детали, поступке, неуклюжей нежности или заботе, без приторных шаблонов.
- Не используй слово «вирусность» в оценке.`;

  const avoidanceNote =
    existingContexts.length > 0
      ? `\nУЖЕ СУЩЕСТВУЮЩИЕ ПОХОЖИЕ СЮЖЕТЫ В БАЗЕ (ИЗБЕГАЙ ПОВТОРЕНИЯ МЕХАНИКИ):\n${existingContexts.slice(0, 20).join('\n')}`
      : '';

  const prompt = `АНАЛИТИЧЕСКАЯ КАРТОЧКА #${card.researchId} (${card.collection === 'debate' ? 'Кто здесь прав?' : 'Романтическая история'}):
- Исходный материал: ${card.sourceName} — «${card.sourceTitle}» (${card.sourceUrl})
- Суть ситуации: ${card.mainSituation}
- Конфликт / событие: ${card.mainConflict}
- Позиция стороны A: ${card.positionsOfParticipants.sideA}
- Позиция стороны B: ${card.positionsOfParticipants.sideB}
- Эмоциональный механизм: ${card.emotionalMechanism}
- Скрытое ожидание: ${card.hiddenExpectation}
- Неожиданная деталь: ${card.unexpectedDetail}
- Возможный поворот: ${card.possibleTwist}
- Механика: ${card.storyMechanic}
- Целевая категория: ${card.targetCategory}
${avoidanceNote}

Создай переосмысленную оригинальную сюжетную заготовку (26 полей StoryPlot) и пересчитай баллы качества.`;

  const responseSchema = {
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
      researchNotes: { type: Type.STRING },
      originalityAssessment: { type: Type.INTEGER },
      quality: {
        type: Type.OBJECT,
        properties: {
          originality: { type: Type.INTEGER },
          realism: { type: Type.INTEGER },
          specificity: { type: Type.INTEGER },
          emotionalExpressiveness: { type: Type.INTEGER },
          readerInterest: { type: Type.INTEGER },
          diversity: { type: Type.INTEGER },
          discussionPotential: { type: Type.INTEGER },
          mechanicQuality: { type: Type.INTEGER },
          ambiguity: { type: Type.INTEGER },
          bothSidesArgumentation: { type: Type.INTEGER },
          debatePotential: { type: Type.INTEGER },
          warmth: { type: Type.INTEGER },
          naturalness: { type: Type.INTEGER },
          emotionalDetailPower: { type: Type.INTEGER },
          relatability: { type: Type.INTEGER },
          nonSaccharine: { type: Type.INTEGER },
          explanation: { type: Type.STRING },
        },
        required: [
          'originality',
          'realism',
          'specificity',
          'emotionalExpressiveness',
          'readerInterest',
          'diversity',
          'discussionPotential',
          'mechanicQuality',
          'explanation',
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
      'researchNotes',
      'originalityAssessment',
      'quality',
    ],
  };

  const resp = await withRetry(() =>
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema,
      },
    })
  );

  const parsed = parseModelJson<Record<string, unknown>>(resp.text);
  const qRaw = (parsed.quality as Record<string, unknown>) || {};

  const breakdownBase: Omit<ResearchQualityBreakdown, 'overall' | 'tierLabel'> = {
    originality: clampScore(qRaw.originality, 82),
    realism: clampScore(qRaw.realism, 82),
    specificity: clampScore(qRaw.specificity, 80),
    emotionalExpressiveness: clampScore(qRaw.emotionalExpressiveness, 80),
    readerInterest: clampScore(qRaw.readerInterest, 81),
    diversity: clampScore(qRaw.diversity, 80),
    discussionPotential: clampScore(qRaw.discussionPotential, 80),
    mechanicQuality: clampScore(qRaw.mechanicQuality, 81),
    ...(card.collection === 'debate'
      ? {
          ambiguity: clampScore(qRaw.ambiguity, 82),
          bothSidesArgumentation: clampScore(qRaw.bothSidesArgumentation, 81),
          debatePotential: clampScore(qRaw.debatePotential, 82),
        }
      : {
          warmth: clampScore(qRaw.warmth, 82),
          naturalness: clampScore(qRaw.naturalness, 82),
          emotionalDetailPower: clampScore(qRaw.emotionalDetailPower, 81),
          relatability: clampScore(qRaw.relatability, 82),
          nonSaccharine: clampScore(qRaw.nonSaccharine, 82),
        }),
    explanation: String(qRaw.explanation || 'Переосмысленная сюжетная заготовка на основе зарубежного анализа.'),
  };

  const { overall, tierLabel } = calculateResearchQuality(breakdownBase, card.collection);
  const resolvedCat = allCats.includes(String(parsed.category))
    ? String(parsed.category)
    : card.targetCategory || allCats[0];

  const idea: ResearchIdeaDraft = {
    collection: card.collection,
    category: resolvedCat,
    subcategory: String(parsed.subcategory || card.relationshipType || 'Переосмысление'),
    title: String(parsed.title || `Сюжет по исследованию ${card.researchId}`),
    shortDescription: String(parsed.shortDescription || ''),
    fullPlot: String(parsed.fullPlot || ''),
    participants: String(parsed.participants || card.participants),
    setting: String(parsed.setting || ''),
    coreConflictOrAction: String(parsed.coreConflictOrAction || card.mainConflict),
    sideAPosition: String(parsed.sideAPosition || card.positionsOfParticipants.sideA),
    sideBPosition: String(parsed.sideBPosition || card.positionsOfParticipants.sideB),
    emotionalMechanism: String(parsed.emotionalMechanism || card.emotionalMechanism),
    hiddenExpectation: String(parsed.hiddenExpectation || card.hiddenExpectation),
    unexpectedNuance: String(parsed.unexpectedNuance || card.unexpectedDetail),
    possibleTwist: String(parsed.possibleTwist || card.possibleTwist),
    mainTriggerQuestion: String(parsed.mainTriggerQuestion || ''),
    additionalQuestions: Array.isArray(parsed.additionalQuestions)
      ? parsed.additionalQuestions.map(String).slice(0, 5)
      : [],
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String).slice(0, 8) : card.keywords,
    mainTheme: String(parsed.mainTheme || resolvedCat),
    plotMechanic: String(parsed.plotMechanic || card.storyMechanic),
    uniqueDetails: String(parsed.uniqueDetails || card.unexpectedDetail),
    originType: 'external',
    sourceUrl: card.sourceUrl,
    ideaSource: `${card.sourceName} (${card.researchId})`,
    researchNotes: String(parsed.researchNotes || card.researchNotes),
  };

  return {
    idea,
    originalityAssessment: clampScore(parsed.originalityAssessment, 82),
    qualityBreakdown: {
      ...breakdownBase,
      overall,
      tierLabel,
    },
  };
}
