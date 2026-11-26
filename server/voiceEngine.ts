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
      ? `РЕЖИМ: Mode A — DEBATE VOICE («Кто здесь прав?»).
- Наблюдательный живой рассказчик без менторства, нравоучений и морализаторства.
- Покажи живую логику и правду ОБЕИХ сторон (без картонного злодея и святой жертвы).
- Подсвети контраст между словами и реальными поступками.
- Закончи живым вопросом к читателям без навязанного приговора.`
      : `РЕЖИМ: Mode B — ROMANTIC VOICE («Романтические истории»).
- Передай теплоту и близость через конкретные бытовые детали, жесты и паузы.
- Никаких открыточных штампов, пафоса, морали и сарказма.
- Покажи живое узнавание сцены — то, от чего читатель тихо улыбнётся или вспомнит своё.`;

  const phraseBlock =
    phraseHints.length > 0
      ? `Допустимые фирменные акценты (не более 1–2 уместных фраз, НЕ вставлять насильно): ${phraseHints
          .map((p) => `"${p.phrase}"`)
          .join('; ')}.`
      : 'Используй свежие разговорные обороты без заученных штампов.';

  const bannedBlock =
    bannedPhrases.length > 0
      ? `СТРОГО ЗАПРЕЩЕНО использовать выражения: ${bannedPhrases.map((b) => `"${b}"`).join(', ')}.`
      : '';

  return `Ты — опытный редактор и автор живых историй об отношениях для аудитории в РФ (Telegram и Яндекс Дзен).
Твоя задача — переосмыслить зарубежный сюжет и написать естественный, уникальный русский текст так, чтобы он не звучал как перевод или текст нейросети.

АДАПТАЦИЯ ПОД РФ И УНИКАЛЬНОСТЬ:
- Пиши живым разговорным русским языком, адаптируя реалии под РФ: естественные имена/обращения, бытовые детали, рубли и метрику при необходимости, без «кальки» с английских идиом.
- Варьируй длину предложений и структуру абзацев: чередуй короткие хлесткие фразы и развёрнутые наблюдения. Не делай одинаковые по ритму и длине абзацы.
- Не используй типичные ИИ-клише и канцелярит: «важно отметить», «стоит понимать», «в современном мире», «не секрет, что», «подводя итог», «в заключение», «играет ключевую роль», «на самом деле».
- Избегай симметричных списков из трёх одинаковых пунктов и шаблонного «искусственного» финала.

${modeRules}

Параметры голоса (0–100):
- Ирония: ${profile.irony} | Разговорность: ${profile.conversational} | Эмоциональность: ${profile.emotionality}
- Острота: ${profile.provocativeness} | Плотность оборотов: ${profile.phraseDensity} | Длина фраз: ${profile.sentenceLength} | Драматизм: ${profile.dramaLevel}

Приём старта и композиции: ${styleMeta?.label || narrativeStyle} (${styleMeta?.hint || ''}).
Целевой объём основного текста: ${lengthMeta.minWords}–${lengthMeta.maxWords} слов (${lengthMeta.description}).
${phraseBlock}
${bannedBlock}`.trim();
}
