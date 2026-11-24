import {
  CollectionType,
  DatabaseFile,
  PendingBatch,
  StagedStoryCandidate,
  StoryPlot,
} from '../src/shared/types.js';
import { getCategoriesForCollection, PLOT_MECHANICS } from '../src/shared/categories.js';
import {
  buildSemanticFingerprint,
  calculateQualityScore,
  findSimilarStories,
} from '../src/shared/similarity.js';
import { cleanEditorialFormatting } from '../src/shared/contentUtils.js';
import {
  callChatCompletionJson,
  formatAiError,
} from './aiClient.js';

interface RawGeneratedItem {
  category?: string;
  subcategory?: string;
  title?: string;
  shortDescription?: string;
  fullPlot?: string;
  participants?: string;
  setting?: string;
  coreConflictOrAction?: string;
  sideAPosition?: string;
  sideBPosition?: string;
  emotionalMechanism?: string;
  hiddenExpectation?: string;
  unexpectedNuance?: string;
  possibleTwist?: string;
  mainTriggerQuestion?: string;
  additionalQuestions?: string[];
  keywords?: string[];
  ideaSource?: string;
  mainTheme?: string;
  plotMechanic?: string;
  uniqueDetails?: string;
  sourceAnalysisNote?: string;
  qualityBreakdown?: {
    originality?: number;
    realism?: number;
    emotionalDepth?: number;
    engagement?: number;
    discussionPotential?: number;
    specificity?: number;
    variability?: number;
    ambiguity?: number;
    bothSidesStrength?: number;
    contradictionPower?: number;
    warmth?: number;
    relatability?: number;
    smallDetailPower?: number;
    naturalness?: number;
  };
  editorialNote?: string;
}

function selectBalancedCategories(
  collection: CollectionType,
  db: DatabaseFile,
  categoryFocus: string
): string[] {
  const allCats = [
    ...getCategoriesForCollection(collection),
    ...db.customCategories.filter((c) => c.collection === collection).map((c) => c.name),
  ];
  if (categoryFocus && categoryFocus !== 'balanced') {
    return [categoryFocus];
  }

  const counts = new Map<string, number>();
  for (const c of allCats) counts.set(c, 0);
  for (const s of db.stories) {
    if (s.collection === collection && s.verificationStatus !== 'rejected') {
      counts.set(s.category, (counts.get(s.category) || 0) + 1);
    }
  }
  return [...allCats]
    .sort((a, b) => (counts.get(a) || 0) - (counts.get(b) || 0))
    .slice(0, 12);
}

function buildExistingContextSummary(stories: StoryPlot[], collection: CollectionType): string {
  const recent = stories
    .filter((s) => s.collection === collection && s.verificationStatus !== 'rejected')
    .slice(-90);
  if (recent.length === 0) return 'База пока пуста.';
  return recent
    .map((s) => `- [${s.id}] ${s.title} | Тема: ${s.mainTheme} | Механика: ${s.plotMechanic}`)
    .join('\n');
}

export async function generateStoryBatch(params: {
  db: DatabaseFile;
  batchNumber: number;
  collection: CollectionType;
  categoryFocus: string;
  count: number;
  searchMode: 'original' | 'web_search';
}): Promise<PendingBatch> {
  const { db, batchNumber, collection, categoryFocus, count, searchMode } = params;

  const targetCategories = selectBalancedCategories(collection, db, categoryFocus);
  const existingSummary = buildExistingContextSummary(db.stories, collection);

  const collectionGuide =
    collection === 'debate'
      ? `Коллекция A «Кто здесь прав?» — неоднозначные жизненные ситуации, где аргументы есть у обеих сторон (не создавай очевидного злодея и идеальную жертву).`
      : `Коллекция B «Романтические истории» — конкретные живые сцены, маленькие поступки заботы и узнаваемые бытовые детали (без шаблонных цитат и приторности).`;

  const promptText = `Ты — живой автор и редактор популярных блогов на русском языке (MELO_LOVE для Telegram и Дзена).
Задача: сгенерировать ровно ${count} уникальных сюжетных основ (НЕ готовых статей) на русском языке.
Пиши по-человечески: с конкретными бытовыми мелочами, обычными русскими именами (Аня, Сергей, Оля, Дима, Марина), без канцелярита и психологического новояза («личные границы», «токсичный», «абьюз», «красные флаги», «зона комфорта», «важно понимать», «стоит отметить»). Заголовки — разговорные, БЕЗ двоеточий (:) и конструктов вида «А или Б: почему В».
${collectionGuide}

Приоритетные категории для баланса базы: ${targetCategories.join(', ')}.
Допустимые сюжетные механики: ${PLOT_MECHANICS.join(', ')}.

СТРОГО НЕ ПОВТОРЯЙ уже существующие сюжеты из базы (последние записи):
${existingSummary}

${
  searchMode === 'web_search'
    ? 'Опирайся на характерные реальные дилеммы из обсуждений на Reddit (AITA, relationship_advice, relationships, love) и адаптируй их под российские бытовые реалии (без перевода в лоб, без западных имён/миль/долларов и без выдумывания фейковых URL, сохраняя нерв и повествование от первого лица «Я...», если оно естественно для сюжета).'
    : 'Генерируй живые жизненные ситуации с конкретными бытовыми деталями, возрастами участников и реальными репликами без морализаторства.'
}

Верни JSON-объект вида {"items": [...]}, где в массиве "items" ровно ${count} элементов со следующими полями у каждого элемента:
category, subcategory, title, shortDescription, fullPlot, participants, setting, coreConflictOrAction, sideAPosition, sideBPosition, emotionalMechanism, hiddenExpectation, unexpectedNuance, possibleTwist, mainTriggerQuestion, additionalQuestions (массив 2 вопросов), keywords (массив 4-5 слов), mainTheme, plotMechanic, uniqueDetails, sourceAnalysisNote, editorialNote, qualityBreakdown (originality, realism, emotionalDepth, engagement, discussionPotential, specificity, variability).`;

  try {
    const response = await callChatCompletionJson<{ items?: RawGeneratedItem[] } | RawGeneratedItem[]>({
      systemInstruction:
        'Ты — живой автор и редактор популярных блогов на русском языке (MELO_LOVE). Возвращай строго валидный JSON вида {"items": [...]}.',
      userPrompt: promptText,
      temperature: 0.78,
      maxTokens: 4096,
      timeoutMs: 65_000,
    });

    const rawItems = Array.isArray(response)
      ? response
      : Array.isArray(response?.items)
        ? response.items
        : [];

    const now = new Date().toISOString();
    const candidates: StagedStoryCandidate[] = [];
    const accumulatedPool: StoryPlot[] = [...db.stories];

    rawItems.slice(0, count).forEach((item, idx) => {
      const quality = calculateQualityScore(collection, item.qualityBreakdown, item.editorialNote);
      const baseCandidate: StagedStoryCandidate = {
        candidateId: `CAND-${batchNumber}-${idx + 1}-${Date.now().toString(36)}`,
        id: `STAGE-${batchNumber}-${idx + 1}`,
        collection,
        category: item.category || targetCategories[idx % targetCategories.length] || 'Разные взгляды на жизнь',
        subcategory: item.subcategory || 'Жизненная ситуация',
        title: cleanEditorialFormatting(item.title || `Сюжет #${idx + 1}`),
        shortDescription: cleanEditorialFormatting(item.shortDescription || ''),
        fullPlot: cleanEditorialFormatting(item.fullPlot || ''),
        participants: item.participants || 'Партнёры',
        setting: item.setting || 'Домашняя обстановка',
        coreConflictOrAction: cleanEditorialFormatting(item.coreConflictOrAction || ''),
        sideAPosition: cleanEditorialFormatting(item.sideAPosition || ''),
        sideBPosition: cleanEditorialFormatting(item.sideBPosition || ''),
        emotionalMechanism: item.emotionalMechanism || '',
        hiddenExpectation: item.hiddenExpectation || '',
        unexpectedNuance: item.unexpectedNuance || '',
        possibleTwist: item.possibleTwist || '',
        mainTriggerQuestion: cleanEditorialFormatting(item.mainTriggerQuestion || ''),
        additionalQuestions: Array.isArray(item.additionalQuestions) ? item.additionalQuestions : [],
        keywords: Array.isArray(item.keywords) ? item.keywords : [],
        ideaSource:
          searchMode === 'web_search'
            ? `Переосмысление зарубежной механики (Gemini / GigaChat / Z.ai, Партия #${batchNumber})`
            : `Оригинальная генерация MELO_LOVE (Gemini / GigaChat / Z.ai, Партия #${batchNumber})`,
        sourceUrl: '',
        originType: 'original',
        createdAt: now,
        verificationStatus: 'pending',
        usageStatus: 'unused',
        semanticFingerprint: '',
        mainTheme: item.mainTheme || item.title || '',
        plotMechanic: item.plotMechanic || 'Неожиданный конфликт ценностей',
        uniqueDetails: item.uniqueDetails || item.unexpectedNuance || '',
        sourceAnalysisNote:
          item.sourceAnalysisNote ||
          'Сгенерировано через Gemini API (с резервом свободных моделей, GigaChat и Z.ai).',
        batchNumber,
        quality,
        similarityMatches: [],
        duplicateFlag: false,
        decision: quality.overall >= db.settings.minQualityScore ? 'approved' : 'needs_revision',
      };

      baseCandidate.semanticFingerprint = buildSemanticFingerprint(baseCandidate);
      const matches = findSimilarStories(
        baseCandidate,
        accumulatedPool,
        db.settings.similarityThreshold
      );
      baseCandidate.similarityMatches = matches;
      baseCandidate.duplicateFlag = matches.length > 0;
      if (baseCandidate.duplicateFlag) {
        baseCandidate.decision = 'needs_revision';
      }

      accumulatedPool.push(baseCandidate);
      candidates.push(baseCandidate);
    });

    return {
      batchNumber,
      collection,
      categoryFocus: categoryFocus || 'balanced',
      searchMode,
      createdAt: now,
      candidates,
    };
  } catch (err) {
    throw formatAiError(err);
  }
}
