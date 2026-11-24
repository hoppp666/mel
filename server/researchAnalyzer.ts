import {
  CollectionType,
  ResearchGeneratedPlotDraft,
  ResearchQualityScore,
  ResearchResult,
  ResearchSource,
} from '../src/shared/types.js';
import { getCategoriesForCollection, PLOT_MECHANICS } from '../src/shared/categories.js';
import { calculateResearchQuality } from '../src/shared/similarity.js';
import { cleanEditorialFormatting } from '../src/shared/contentUtils.js';
import {
  callChatCompletionJson,
  formatAiError,
} from './aiClient.js';

export interface GroundingLead {
  url: string;
  title: string;
  excerpt: string;
  sourceId: string;
  sourceName: string;
}

export async function searchForeignLeadsWithGrounding(_params: {
  collection: CollectionType;
  sources: ResearchSource[];
  categoryFocus: string;
  limit: number;
  signal?: AbortSignal;
}): Promise<GroundingLead[]> {
  // Direct verified RSS/public feeds in researchSources.ts provide primary leads reliably without wasting AI quota.
  return [];
}

export async function analyzeAndTransformResearchItem(params: {
  item: ResearchResult;
  depth: 'standard' | 'deep';
  generateIdea: boolean;
  signal?: AbortSignal;
}): Promise<{
  analysis: Partial<ResearchResult>;
  generatedPlot: ResearchGeneratedPlotDraft | null;
  quality: ResearchQualityScore;
}> {
  const { item, depth, generateIdea, signal } = params;
  const categories = getCategoriesForCollection(item.collection);

  const systemInstruction = `Ты — живой автор и редактор популярных блогов на русском языке (MELO_LOVE).
Отвечай строго валидным JSON-объектом. Не выдумывай факты исходного материала, даты, авторов или цитаты.
Пиши живым человеческим языком (допустимы тире —, скобки и короткие фразы), БЕЗ канцелярита, БЕЗ психологического новояза («личные границы», «токсичный», «абьюз», «красные флаги», «зона комфорта») и БЕЗ эмодзи/буллитов.`;

  const prompt = `Проанализируй найденный материал строго на основе приведённых фактов.
Разделяй:
1) Фактический пересказ материала (sourceSummary, mainSituation, participants, relationshipType, mainConflict, positionsOfParticipants).
2) Аналитические выводы (emotionalMechanism, hiddenExpectation, unexpectedDetail, possibleTwist, readerReactionPotential, storyMechanic, originalityAssessment, researchNotes).
${
  generateIdea
    ? `3) Создай самостоятельную русскую сюжетную заготовку (generatedPlot) для коллекции "${
        item.collection === 'debate' ? 'Кто здесь прав?' : 'Романтические истории'
      }", адаптировав историю с Reddit/форума для русскоязычных читателей:
- Переводи смысл, а не слова; убирай западные реалии, меняй иностранные имена на обычные русские (Аня, Сергей, Оля, Дима, Марина — без экзотики), переводи мили/фунты/доллары в понятные бытовые эквиваленты.
- Сохраняй нерв и конкретные бытовые мелочи оригинала; если исходник написан от первого лица («Я...»), обязательно сохрани «Я»-подачу и запиши эту деталь в fullPlot и uniqueDetails.
- Заголовок (title): цепляющий, разговорный, БЕЗ двоеточий (:) и конструкций «А или Б: почему произошло В».
- Полностью исключи слова из стоп-листа («личные границы», «токсичный», «абьюз», «красные флаги», «важно понимать», «стоит отметить», «пища для ума», «и вот тут начинается самое интересное» и т.п.) и назидательную мораль.
Допустимые категории: ${categories.slice(0, 25).join(', ')}.
Допустимые механики: ${PLOT_MECHANICS.join(', ')}.`
    : 'Поле generatedPlot верни как null.'
}

Исходный материал:
- Источник: ${item.sourceName} (${item.sourceUrl})
- Заголовок: ${item.sourceTitle}
- Автор (если известен): ${item.sourceAuthor || 'unknown'}
- Дата (если известна): ${item.sourceDate || 'unknown'}
- Выдержка: ${item.sourceExcerpt || item.sourceSummary || item.sourceTitle}
- Глубина разбора: ${depth}

Верни JSON-объект со структурой:
{
  "sourceSummary": "...",
  "mainSituation": "...",
  "participants": "...",
  "relationshipType": "...",
  "mainConflict": "...",
  "positionsOfParticipants": "...",
  "emotionalMechanism": "...",
  "hiddenExpectation": "...",
  "unexpectedDetail": "...",
  "possibleTwist": "...",
  "readerReactionPotential": "...",
  "storyMechanic": "...",
  "keywords": ["..."],
  "researchNotes": "...",
  "originalityAssessment": "...",
  "qualityExplanation": "...",
  "qualityBreakdown": {
    "originality": 0..20,
    "realism": 0..15,
    "specificity": 0..15,
    "emotionalExpressiveness": 0..15,
    "readerInterest": 0..15,
    "diversity": 0..10,
    "discussionPotential": 0..10,
    "mechanicQuality": 0..10
  },
  "generatedPlot": ${
    generateIdea
      ? `{
    "category": "...",
    "subcategory": "...",
    "title": "...",
    "shortDescription": "...",
    "fullPlot": "...",
    "participants": "...",
    "setting": "...",
    "coreConflictOrAction": "...",
    "sideAPosition": "...",
    "sideBPosition": "...",
    "emotionalMechanism": "...",
    "hiddenExpectation": "...",
    "unexpectedNuance": "...",
    "possibleTwist": "...",
    "mainTriggerQuestion": "...",
    "additionalQuestions": ["...", "..."],
    "keywords": ["..."],
    "mainTheme": "...",
    "plotMechanic": "...",
    "uniqueDetails": "..."
  }`
      : 'null'
  }
}`;

  try {
    const parsed = await callChatCompletionJson<{
      sourceSummary?: string;
      mainSituation?: string;
      participants?: string;
      relationshipType?: string;
      mainConflict?: string;
      positionsOfParticipants?: string;
      emotionalMechanism?: string;
      hiddenExpectation?: string;
      unexpectedDetail?: string;
      possibleTwist?: string;
      readerReactionPotential?: string;
      storyMechanic?: string;
      keywords?: string[];
      researchNotes?: string;
      originalityAssessment?: string;
      qualityExplanation?: string;
      qualityBreakdown?: ResearchQualityScore['breakdown'];
      generatedPlot?: ResearchGeneratedPlotDraft | null;
    }>({
      systemInstruction,
      userPrompt: prompt,
      temperature: 0.45,
      maxTokens: 3200,
      timeoutMs: 60_000,
      signal,
    });

    const quality = calculateResearchQuality(
      item.collection,
      parsed.qualityBreakdown,
      parsed.qualityExplanation
    );

    const gp = generateIdea && parsed.generatedPlot?.title
      ? {
          ...parsed.generatedPlot,
          title: cleanEditorialFormatting(parsed.generatedPlot.title),
          shortDescription: cleanEditorialFormatting(parsed.generatedPlot.shortDescription || ''),
          fullPlot: cleanEditorialFormatting(parsed.generatedPlot.fullPlot || ''),
          mainTriggerQuestion: cleanEditorialFormatting(parsed.generatedPlot.mainTriggerQuestion || ''),
        }
      : null;

    return {
      analysis: {
        sourceSummary: parsed.sourceSummary || item.sourceExcerpt,
        mainSituation: parsed.mainSituation || item.sourceTitle,
        participants: parsed.participants || 'unknown',
        relationshipType: parsed.relationshipType || 'couple',
        mainConflict: parsed.mainConflict || '',
        positionsOfParticipants: parsed.positionsOfParticipants || '',
        emotionalMechanism: parsed.emotionalMechanism || '',
        hiddenExpectation: parsed.hiddenExpectation || '',
        unexpectedDetail: parsed.unexpectedDetail || '',
        possibleTwist: parsed.possibleTwist || '',
        readerReactionPotential: parsed.readerReactionPotential || '',
        storyMechanic: parsed.storyMechanic || 'Неожиданный конфликт ценностей',
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
        researchNotes: parsed.researchNotes || '',
        originalityAssessment: parsed.originalityAssessment || quality.tierLabel,
      },
      generatedPlot: gp,
      quality,
    };
  } catch (err) {
    throw formatAiError(err);
  }
}
