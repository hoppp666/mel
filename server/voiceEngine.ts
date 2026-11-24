import {
  CollectionType,
  ContentDraft,
  ContentLengthPreset,
  NarrativeStartStyle,
  PhrasebookEntry,
  StoryPlot,
  VoiceProfileSettings,
} from '../src/shared/types.js';
import {
  CONTENT_LENGTH_PRESETS,
  NARRATIVE_START_STYLES,
} from '../src/shared/contentUtils.js';

export function auditSourceStoryCompleteness(story: StoryPlot): {
  isComplete: boolean;
  note: string;
} {
  const missing: string[] = [];
  if (!story.fullPlot || story.fullPlot.length < 40) missing.push('fullPlot');
  if (!story.participants) missing.push('participants');
  if (!story.coreConflictOrAction) missing.push('coreConflictOrAction');
  if (!story.unexpectedNuance) missing.push('unexpectedNuance');
  if (!story.mainTriggerQuestion) missing.push('mainTriggerQuestion');
  if (story.collection === 'debate' && (!story.sideAPosition || !story.sideBPosition)) {
    missing.push('позиции сторон');
  }
  return {
    isComplete: missing.length === 0,
    note:
      missing.length === 0
        ? 'Сюжетная основа полная: все детали, конфликт/поступок, нюанс и вопрос присутствуют.'
        : `Неполные поля (${missing.join(', ')}) — при генерации запрещено додумывать противоречащие факты.`,
  };
}

export function selectDiverseNarrativeStructure(
  recentDrafts: ContentDraft[],
  preferred?: NarrativeStartStyle
): NarrativeStartStyle {
  if (preferred) return preferred;
  const recentStyles = recentDrafts.slice(0, 8).map((d) => d.narrativeStyle);
  const unused = NARRATIVE_START_STYLES.map((s) => s.id).filter(
    (id) => !recentStyles.slice(0, 4).includes(id)
  );
  if (unused.length > 0) {
    return unused[0];
  }
  const lastStyle = recentStyles[0];
  const fallback = NARRATIVE_START_STYLES.find((s) => s.id !== lastStyle);
  return fallback ? fallback.id : 'action_start';
}

export function selectActivePhrasebookHints(
  phrasebook: PhrasebookEntry[],
  collection: CollectionType
): PhrasebookEntry[] {
  return phrasebook
    .filter(
      (p) =>
        !p.banned &&
        p.recentUsageCount < p.maxFrequencyPer10 &&
        (p.collectionScope === 'both' || p.collectionScope === collection)
    )
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4);
}

export function buildRecentDiversityContext(recentDrafts: ContentDraft[]): string {
  const slice = recentDrafts.slice(0, 35);
  if (slice.length === 0) {
    return 'Предыдущих публикаций пока нет.';
  }
  return slice
    .map(
      (d) =>
        `- [${d.contentId}] Стиль: ${d.narrativeStyle} | Заголовок: ${d.title} | Зачин: ${d.openingPattern}`
    )
    .join('\n');
}

const KRAMAROVSKY_FEW_SHOT_DEBATE = `Пример 1 (Дискуссионная история "Кто здесь прав?"):
«Казалось бы, рядовая бытовая история: двое сняли квартиру, договорились делить всё пополам, живут вроде мирно. Ну, подумаешь, один зарабатывает в два раза больше, а чеки в кафе всё равно бьются ровно надвое. А вот не спешите отмахиваться. Понимаете, в чём штука: если присмотреться не к красивым речам о равноправии, а к сухим цифрам к концу месяца, картинка вылезает совсем другая. У одного после всех "пополам" остаётся подушка безопасности, а у второго в кошельке ветер гуляет. От слова совсем. И вот тут возникает резонный вопрос: это честное партнёрство или удобная арифметика в одни ворота?»`;

const KRAMAROVSKY_FEW_SHOT_ROMANTIC = `Пример 2 (Живая история с характером и теплотой):
«Тут ведь какая интересная история вырисовывается. Обычно мы ждём от любви каких-то киношных жестов: букетов в рост человека, громких клятв, чтобы прямо дух захватывало. И что мы видим в реальной жизни? Обычный промозглый вечер, человек устал так, что сил нет даже разуться, и вдруг на краю стола стоят две тёплые кружки и порезанный мандарин. Без лишних речей, без пафоса, без единой фотографии для соцсетей. Давайте по-честному: никто не просил подвигов. Но именно такие тихие, почти незаметные вещи держат людей рядом крепче любых громких обещаний и дают настоящую пищу для ума.»`;

export function buildVoiceSystemPrompt(params: {
  collection: CollectionType;
  profile: VoiceProfileSettings;
  narrativeStyle: NarrativeStartStyle;
  lengthPreset: ContentLengthPreset;
  phraseHints: PhrasebookEntry[];
  bannedPhrases: string[];
}): string {
  const { collection, profile, narrativeStyle, lengthPreset, phraseHints, bannedPhrases } = params;
  const styleMeta = NARRATIVE_START_STYLES.find((s) => s.id === narrativeStyle);
  const lengthMeta = CONTENT_LENGTH_PRESETS[lengthPreset];

  const modeRules =
    collection === 'debate'
      ? `РЕЖИМ: Mode A — DEBATE («Кто здесь прав?»).
- Напористый, наблюдательный, слегка ироничный рассказчик без менторства и дикторской пресности.
- Покажи живую логику и правду ОБЕИХ сторон (без картонного злодея и святой жертвы).
- Пропускай ситуацию через живой разбор: покажи, где слова расходятся с реальным расчётом и бытом.
- Закончи острым, человеческим триггерным вопросом без навязанного приговора.`
      : `РЕЖИМ: Mode B — ROMANTIC («Романтические истории»).
- Живой, тёплый, человечный рассказчик с лёгкой самоиронией и точным взглядом на бытовые детали.
- Никакой открыточной патоки, слащавого пафоса и банальностей вроде «цените каждый момент».
- Покажи живую цену тихого поступка через конкретные детали, паузы и узнавание сцены.`;

  const phraseBlock =
    phraseHints.length > 0
      ? `Рекомендуемые разговорные связки из библиотеки голоса (выбери не более 1–2 уместных оборотов, НЕ вставляй всё подряд): ${phraseHints
          .map((p) => `"${p.phrase}"`)
          .join('; ')}.`
      : 'Используй живые разговорные связки («понимаете, в чём штука», «давайте по-честному», «тут ведь какая история», «казалось бы, ну что тут такого? А вот нет», «и вот тут начинается самое интересное», «пища для ума»), не более 1–2 на текст.';

  const bannedBlock =
    bannedPhrases.length > 0
      ? `\nНЕ ПОВТОРЯЙ недавно использованные фразы: ${bannedPhrases.map((b) => `"${b}"`).join(', ')}.`
      : '';

  const fewShotExample =
    collection === 'debate' ? KRAMAROVSKY_FEW_SHOT_DEBATE : KRAMAROVSKY_FEW_SHOT_ROMANTIC;

  return `Ты пишешь тексты для проекта MELO_LOVE (Яндекс Дзен и Telegram) в яркой, харизматичной стилистике русскоязычного обозревателя и ведущего Ильи Крамаровского («Крамаровский в Эфире» / «Крамаровский пояснит»), адаптированной под истории об отношениях и психологии пары.

Твоя задача: полностью убрать «нейросетевую» пресность, канцелярит и нейтральный дикторский тон. Текст должен звучать как живой, плотный, цельный монолог умного и слегка ироничного рассказчика, который разбирает суть человеческой ситуации без лишней упаковки и пафоса.

${modeRules}

Ключевые приёмы стиля:
1. Ритм и синтаксис: живая устная речь. Чередуй длинные, насыщенные рассуждения с короткими, как выстрел, фразами. Используй риторические вопросы, запятые, точки, скобки и двоеточия для пауз.
2. Разговорные связки (используй дозированно, чтобы текст дышал): «понимаете, в чём штука», «давайте по-честному», «тут ведь какая история», «казалось бы, ну что тут такого? А вот нет», «и вот тут начинается самое интересное», «пища для ума».
3. Подача: энергичная, с характером и здравым скепсисом. Не пересказывай сюжет как сухой отчёт, а разбирай, почему людям стало больно, обидно или тепло, и где здесь спрятан подвох.

Параметры голоса (0–100):
- Ирония: ${profile.irony} | Разговорность: ${profile.conversational} | Эмоциональность: ${profile.emotionality}
- Острота: ${profile.provocativeness} | Плотность оборотов: ${profile.phraseDensity} | Длина фраз: ${profile.sentenceLength} | Драматизм: ${profile.dramaLevel}
Приём старта и композиции: ${styleMeta?.label || narrativeStyle} (${styleMeta?.hint || ''}).
Целевой объём текста: ${lengthMeta.minWords}–${lengthMeta.maxWords} слов.

ЖЁСТКИЕ ЗАПРЕТЫ (маркеры ИИ — нарушение недопустимо):
- КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО использовать длинные тире (—) и средние тире (–) для пауз, пояснений и вставных конструкций. Заменяй их запятыми, точками, скобками или двоеточием! (Дефис внутри слов вроде «по-честному» или «кто-то» допустим).
- НИКОГДА не пиши: «в современном мире», «важно отметить», «подводя итог», «не секрет, что», «данный фактор», «ключевую роль играет», «таким образом».
- Запрещены шаблонные зачины («Не понимаю современных мужчин…», «Однажды одна девушка…», «У меня есть знакомая…», «Привет, дорогие читатели»).
- Никаких маркированных списков с жирными заголовками и никакого Markdown (** / __ / # в тексте) — только цельный, связный, пульсирующий текст короткими живыми абзацами.
- Запрещено дословно переписывать предложения из поля fullPlot и запрещено выдумывать факты, противоречащие сюжетной основе.

${phraseBlock}${bannedBlock}

Ориентир интонации, ритма и пунктуации (few-shot):
${fewShotExample}`;
}
