import {
  CONTENT_LENGTH_RANGES,
  NARRATIVE_STRUCTURE_LABELS,
  extractFirstSentence,
  extractLastSentence,
} from '../src/shared/contentUtils.ts';
import type {
  ContentDraft,
  ContentLengthPreset,
  NarrativeStructurePattern,
  PhrasebookEntry,
  StoryPlot,
  VoiceEngineConfig,
  VoiceSliders,
} from '../src/shared/types.ts';

const ALL_NARRATIVE_STRUCTURES: NarrativeStructurePattern[] = [
  'action_start',
  'detail_start',
  'dialogue_start',
  'emotion_start',
  'contradiction_start',
  'observer_start',
  'outcome_first',
  'gradual_reveal',
];

export function auditSourceStoryCompleteness(story: StoryPlot): {
  sufficient: boolean;
  missingFields: string[];
  warningNote?: string;
} {
  const missingFields: string[] = [];
  if (!story.fullPlot || story.fullPlot.trim().length < 40) missingFields.push('fullPlot');
  if (!story.coreConflictOrAction || story.coreConflictOrAction.trim().length < 10) {
    missingFields.push('coreConflictOrAction');
  }
  if (!story.participants || story.participants.trim().length < 4) missingFields.push('participants');
  if (!story.emotionalMechanism || story.emotionalMechanism.trim().length < 6) {
    missingFields.push('emotionalMechanism');
  }

  if (missingFields.length > 0) {
    return {
      sufficient: false,
      missingFields,
      warningNote: `Исходная запись ${story.id} недостаточно заполнена (отсутствуют/короткие поля: ${missingFields.join(', ')}). Дополните сюжетную основу вместо выдумывания недостающих фактов.`,
    };
  }
  return { sufficient: true, missingFields: [] };
}

export function selectDiverseNarrativeStructure(
  requestedStructure: NarrativeStructurePattern | 'auto' | undefined,
  recentDrafts: ContentDraft[],
  variantIndex = 0
): NarrativeStructurePattern {
  if (requestedStructure && requestedStructure !== 'auto') {
    return requestedStructure;
  }

  const recentUsed = new Set(recentDrafts.slice(0, 4).map((d) => d.narrativeStructure));
  const candidates = ALL_NARRATIVE_STRUCTURES.filter((s) => !recentUsed.has(s));
  const pool = candidates.length > 0 ? candidates : ALL_NARRATIVE_STRUCTURES;
  return pool[variantIndex % pool.length];
}

export function selectEligiblePhrasebookHints(
  story: StoryPlot,
  sliders: VoiceSliders,
  phrasebook: PhrasebookEntry[]
): PhrasebookEntry[] {
  if (sliders.phraseDensity <= 0) return [];
  const eligible = phrasebook.filter(
    (p) => !p.banned && !p.isOverused && p.collections.includes(story.collection)
  );
  // Sort by editorial priority weight descending
  const sorted = [...eligible].sort((a, b) => b.weight - a.weight);
  const limit = sliders.phraseDensity >= 7 ? 5 : sliders.phraseDensity >= 4 ? 3 : 2;
  return sorted.slice(0, limit);
}

export function buildRecentDiversityContext(recentDrafts: ContentDraft[]): string {
  const slice = recentDrafts.filter((d) => d.status !== 'rejected').slice(0, 35);
  if (slice.length === 0) {
    return 'Предыдущих публикаций пока нет — вы свободны в выборе композиции.';
  }

  return slice
    .map((d, idx) => {
      const firstLine = d.openingPattern || extractFirstSentence(d.body);
      const lastLine = d.endingPattern || d.mainTriggerQuestion || extractLastSentence(d.body);
      const phrases = (d.usedPhrases || []).join(', ') || 'нет';
      return `${idx + 1}. [${d.id}] «${d.title}» | приём: ${d.narrativeStructure} | начало: "${firstLine.slice(0, 90)}" | финал: "${lastLine.slice(0, 90)}" | выражения: ${phrases}`;
    })
    .join('\n');
}

export function resolveActiveVoiceSliders(
  config: VoiceEngineConfig,
  story: StoryPlot,
  overrideProfileId?: string,
  overrideSliders?: Partial<VoiceSliders>
): { profileId: string; profileName: string; sliders: VoiceSliders } {
  const activeProfileId =
    overrideProfileId ||
    (story.collection === 'debate' ? config.debateProfileId : config.romanticProfileId);

  const profile = config.profiles.find((p) => p.id === activeProfileId);
  const baseRubric =
    story.collection === 'debate' ? config.rubricSettings.debate : config.rubricSettings.romantic;

  const baseSliders: VoiceSliders = profile
    ? {
        irony: profile.irony,
        conversational: profile.conversational,
        emotionality: profile.emotionality,
        provocativeness: profile.provocativeness,
        phraseDensity: profile.phraseDensity,
        sentenceLength: profile.sentenceLength,
        dramaLevel: profile.dramaLevel,
      }
    : baseRubric;

  return {
    profileId: profile?.id || activeProfileId,
    profileName: profile?.name || 'Пользовательский профиль',
    sliders: {
      ...baseSliders,
      ...(overrideSliders || {}),
    },
  };
}

export function buildVoiceSystemInstruction(params: {
  story: StoryPlot;
  sliders: VoiceSliders;
  profileName: string;
  lengthPreset: ContentLengthPreset;
  narrativeStructure: NarrativeStructurePattern;
  phraseHints: PhrasebookEntry[];
}): string {
  const { story, sliders, profileName, lengthPreset, narrativeStructure, phraseHints } = params;
  const wordRange = CONTENT_LENGTH_RANGES[story.collection][lengthPreset];

  const sentenceRule =
    sliders.sentenceLength === 'short'
      ? 'Предложения преимущественно короткие, энергичные, с точными паузами и абзацами по 1–3 строки.'
      : sliders.sentenceLength === 'free'
        ? 'Свободный ритм: чередуй короткие реплики-уколы с более развёрнутыми наблюдениями рассказчика.'
        : 'Смешанная длина предложений: живой разговорный ритм без монотонных конструкций.';

  const rubricModeBlock =
    story.collection === 'debate'
      ? `РЕЖИМ ГОЛОСА A — DEBATE VOICE («Кто здесь прав?» для Яндекс Дзена):
- Ориентир структуры (адаптируй естественно под сюжет, без жёстких рамок): HOOK -> STORY -> CONFLICT -> TWIST -> TRIGGER QUESTION.
- Покажи живую логику ОБЕИХ сторон (sideAPosition и sideBPosition). Не назначай виноватого заранее, не превращай рассказ в травлю одного участника.
- Используй контраст между словами и поступками, меткие короткие комментарии к поведению героев, живую бытовую конкретику.
- Начинай с интриги, детали, поступка или противоречия — НИКОГДА со штампов («Не понимаю современных мужчин…», «Однажды одна девушка встретила…», «У меня есть знакомая…», «Недавно произошла такая история…», «Представьте себе ситуацию…», «В современном мире отношения…») и не начинай каждую статью с вопроса.
- Финальный вопрос должен вызывать желание поспорить в комментариях (без шаблонных одинаковых формулировок).`
      : `РЕЖИМ ГОЛОСА B — ROMANTIC VOICE («Романтические истории» для Яндекс Дзена):
- Ориентир структуры (адаптируй органично): EMOTIONAL HOOK -> MICRO STORY -> FEELING -> EMOTIONAL ENDING -> QUESTION.
- Показывай любовь и заботу через конкретные мелкие поступки, предметы, привычки и реакции — БЕЗ абстрактных моралей и пафосных цитат уровня открытки.
- Запрещено использовать клише вроде «любовь — это не слова, а поступки» и натужную сентиментальность.
- Сохраняй ощущение реальной живой истории, лёгкий юмор повседневной жизни и искреннее тепло (ирония здесь мягкая и тёплая, без сарказма).
- Вопрос или финальная деталь в конце должны рождаться естественно из самой истории.`;

  const phraseBlock =
    phraseHints.length > 0 && sliders.phraseDensity > 0
      ? `\nСЛОВАРЬ ВЫРАЖЕНИЙ MELO_LOVE (опциональные ориентиры интонации, плотность ${sliders.phraseDensity}/10):
${phraseHints.map((p) => `- «${p.phrase}» (${p.notes})`).join('\n')}
КРИТИЧЕСКИ ВАЖНО: НЕ вставляй фразы механически и НЕ пихай их в каждый текст! Используй максимум 0–1 выражение из списка И ТОЛЬКО если оно идеально ложится в живой ритм конкретной сцены.`
      : '\nФирменные выражения из словаря в этой публикации использовать НЕ нужно — опирайся исключительно на живую интонацию рассказчика.';

  return `Ты — ведущий автор и голос редакционного проекта MELO_LOVE.

ХАРАКТЕР РАССКАЗЧИКА MELO_LOVE:
- Умный, наблюдательный и эмоционально грамотный знакомый, который умеет рассказывать живые истории.
- Говорит на равных: без позиции «сверху вниз», без менторства, без морализаторства, без искусственной мотивационной риторики и без роли «кабинетного психолога».
- Не имитирует чужих публичных блогеров/журналистов — держит собственный живой русский авторский голос.
- Замечает абсурдные и говорящие бытовые детали, умеет подать мысль одной меткой фразой и знает меру шутке.

АКТИВНЫЙ ПРОФИЛЬ «${profileName}»:
- Ирония: ${sliders.irony}/10
- Разговорность: ${sliders.conversational}/10
- Эмоциональность: ${sliders.emotionality}/10
- Провокационность: ${sliders.provocativeness}/10
- Драматичность: ${sliders.dramaLevel}/10
- Ритм: ${sentenceRule}
- Ориентировочный объём основного текста (body): ${wordRange.min}–${wordRange.max} слов (раскрывай сюжет естественно, не раздувай текст водой).
- Выбранный приём построения текста: ${NARRATIVE_STRUCTURE_LABELS[narrativeStructure]} (${narrativeStructure}).

${rubricModeBlock}
${phraseBlock}

ПРАВИЛА ЧЕСТНОСТИ И ТОЧНОСТИ К ИСХОДНИКУ:
1. Опирайся на все поля исходного сюжета: fullPlot, participants, setting, coreConflictOrAction, sideAPosition, sideBPosition, emotionalMechanism, hiddenExpectation, unexpectedNuance, possibleTwist.
2. Не меняй суть и факты исходного сюжета. Допустимы лишь естественные бытовые детали обстановки, не противоречащие исходнику.
3. НЕ копируй длинные куски текста из fullPlot дословно — расскажи историю живым авторским языком.
4. НЕ выдавай придуманный сюжет за «реальное письмо читательницы» и не выдумывай авторов, цитаты или сторонние ссылки.
5. Заголовки (основной + 2 альтернативных): живые и интригующие, БЕЗ ложных обещаний, БЕЗ жёлтого кликбейта и БЕЗ CAPS LOCK.`;
}

export function buildSourceStoryPromptBlock(story: StoryPlot): string {
  const researchContext =
    story.originType === 'external' || story.researchId
      ? `\nПроисхождение: внешний материал (${story.ideaSource}${story.sourceUrl ? `, ${story.sourceUrl}` : ''}${story.researchId ? `, ID исследования: ${story.researchId}` : ''}). Переосмысляй живо, без дословного перевода.\nЗаметки исследования: ${story.researchNotes || story.sourceAnalysisNote || 'нет'}`
      : '\nПроисхождение: оригинальная сюжетная разработка базы MELO_LOVE.';

  return `ИСХОДНЫЙ СЮЖЕТ [${story.id}]
- Коллекция: ${story.collection === 'debate' ? 'Кто здесь прав? (debate)' : 'Романтические истории (romantic)'}
- Категория / подкатегория: ${story.category} / ${story.subcategory}
- Название в базе: ${story.title}
- Краткое описание: ${story.shortDescription}
- Полная сюжетная основа: ${story.fullPlot}
- Участники: ${story.participants}
- Место/обстановка: ${story.setting}
- Ключевой конфликт / действие: ${story.coreConflictOrAction}
- Позиция стороны A: ${story.sideAPosition}
- Позиция стороны B: ${story.sideBPosition}
- Эмоциональный механизм: ${story.emotionalMechanism}
- Скрытое ожидание: ${story.hiddenExpectation}
- Неожиданный нюанс: ${story.unexpectedNuance}
- Возможный поворот / финал: ${story.possibleTwist}
- Триггерный вопрос базы: ${story.mainTriggerQuestion}
- Дополнительные вопросы: ${(story.additionalQuestions || []).join(' | ') || 'нет'}
- Сюжетная механика: ${story.plotMechanic}
- Уникальная деталь: ${story.uniqueDetails}
- Ключевые слова: ${(story.keywords || []).join(', ')}${researchContext}`;
}
