import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Database,
  Download,
  History,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Sliders,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import {
  CollectionType,
  ContentDraft,
  ContentDraftStatus,
  ContentExportMode,
  ContentLengthPreset,
  ContentMetrics,
  NarrativeStartStyle,
  PhrasebookEntry,
  RewriteMode,
  StoryPlot,
  VoiceConfig,
  VoicePreset,
  VoiceProfileSettings,
} from '../shared/types.js';
import {
  CONTENT_LENGTH_PRESETS,
  NARRATIVE_START_STYLES,
} from '../shared/contentUtils.js';
import {
  cancelContentGeneration,
  createContentBackup,
  createContentDraft,
  createPhrasebookEntry,
  createVoicePreset,
  deleteContentDraft,
  deletePhrasebookEntry,
  deleteVoicePreset,
  exportContentJson,
  fetchContentState,
  fetchIntegrationStatus,
  generateContent,
  importContentJson,
  restoreContentVersion,
  rewriteContentDraft,
  updateContentDraft,
  updateContentDraftStatus,
  updatePhrasebookEntry,
  updateVoiceConfig,
} from '../services/api.js';

type GeneratorTab =
  | 'generate'
  | 'drafts'
  | 'ready'
  | 'history'
  | 'voice'
  | 'phrasebook'
  | 'quality_settings';

interface StoryGeneratorSectionProps {
  onDatabaseChanged: () => Promise<void>;
}

const REWRITE_OPTIONS: Array<{ mode: RewriteMode; label: string }> = [
  { mode: 'more_lively', label: 'Сделать живее' },
  { mode: 'more_conversational', label: 'Разговорнее' },
  { mode: 'sharpen_hook', label: 'Усилить зачин' },
  { mode: 'softer_romantic', label: 'Теплее и мягче' },
  { mode: 'sharper_debate', label: 'Острее конфликт' },
  { mode: 'shorten', label: 'Сократить' },
  { mode: 'expand', label: 'Развернуть детали' },
  { mode: 'change_opening', label: 'Сменить начало' },
  { mode: 'change_ending', label: 'Сменить финал' },
  { mode: 'remove_ai_feel', label: 'Убрать ИИ-гладкость' },
];

const VOICE_SLIDER_LABELS: Array<{ key: keyof VoiceProfileSettings; label: string }> = [
  { key: 'irony', label: 'Ирония' },
  { key: 'conversational', label: 'Разговорность' },
  { key: 'emotionality', label: 'Эмоциональность' },
  { key: 'provocativeness', label: 'Острота / провокация' },
  { key: 'phraseDensity', label: 'Плотность живых фраз' },
  { key: 'sentenceLength', label: 'Длина фраз и ритм' },
  { key: 'dramaLevel', label: 'Степень драматизации' },
];

const DRAFT_STATUS_TEXT: Record<ContentDraftStatus, string> = {
  generating: 'Генерируется',
  draft: 'Черновик',
  needs_revision: 'Нужна редактура',
  ready_for_review: 'Готов к проверке',
  approved: 'Утверждён',
  rejected: 'Отклонён',
  archived: 'В архиве',
};

export const StoryGeneratorSection: React.FC<StoryGeneratorSectionProps> = ({
  onDatabaseChanged,
}) => {
  const [tab, setTab] = useState<GeneratorTab>('generate');
  const [metrics, setMetrics] = useState<ContentMetrics | null>(null);
  const [availableStories, setAvailableStories] = useState<StoryPlot[]>([]);
  const [drafts, setDrafts] = useState<ContentDraft[]>([]);
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfig | null>(null);
  const [systemPresets, setSystemPresets] = useState<VoicePreset[]>([]);
  const [phrasebook, setPhrasebook] = useState<PhrasebookEntry[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [geminiConfigured, setGeminiConfigured] = useState<boolean>(true);

  // Generation controls
  const [storyColFilter, setStoryColFilter] = useState<'all' | CollectionType>('all');
  const [selectedStoryId, setSelectedStoryId] = useState('');
  const [lengthPreset, setLengthPreset] = useState<ContentLengthPreset>('standard');
  const [narrativeStyle, setNarrativeStyle] = useState<'auto' | NarrativeStartStyle>('auto');
  const [variantsCount, setVariantsCount] = useState(1);
  const [voicePresetId, setVoicePresetId] = useState('');
  const [genBusy, setGenBusy] = useState(false);

  // Manual draft composer toggle
  const [manualMode, setManualMode] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualBody, setManualBody] = useState('');
  const [manualQuestion, setManualQuestion] = useState('');

  // Draft editor state
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editSubtitle, setEditSubtitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editQuestion, setEditQuestion] = useState('');
  const [rewriteMode, setRewriteMode] = useState<RewriteMode>('more_lively');
  const [draftBusy, setDraftBusy] = useState(false);

  // Voice preset creation
  const [newPresetName, setNewPresetName] = useState('');
  const [newPresetDesc, setNewPresetDesc] = useState('');

  // Phrasebook creation
  const [newPhrase, setNewPhrase] = useState('');
  const [newPhraseNote, setNewPhraseNote] = useState('');
  const [newPhraseScope, setNewPhraseScope] = useState<CollectionType | 'both'>('both');
  const [newPhraseTag, setNewPhraseTag] = useState('наблюдение');
  const [newPhraseWeight, setNewPhraseWeight] = useState(7);
  const [newPhraseMaxFreq, setNewPhraseMaxFreq] = useState(2);

  // Export/Import
  const [exportMode, setExportMode] = useState<ContentExportMode>('with_source');
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const loadState = async () => {
    try {
      const [data, envStatus] = await Promise.all([
        fetchContentState(),
        fetchIntegrationStatus().catch(() => null),
      ]);
      if (envStatus) setGeminiConfigured(envStatus.hasGeminiConfigured);
      setMetrics(data.metrics);
      setAvailableStories(data.availableStories);
      setDrafts(data.drafts);
      setVoiceConfig(data.voiceConfig);
      setSystemPresets(data.systemPresets);
      setPhrasebook(data.phrasebook);
      setIsGenerating(data.isGenerating);
      if (!selectedStoryId && data.availableStories.length > 0) {
        setSelectedStoryId(data.availableStories[0].id);
      }
      if (!voicePresetId && data.voiceConfig) {
        setVoicePresetId(data.voiceConfig.activePresetId);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка загрузки Story Generator');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredAvailable = useMemo(
    () =>
      availableStories.filter((s) =>
        storyColFilter === 'all' ? true : s.collection === storyColFilter
      ),
    [availableStories, storyColFilter]
  );

  const selectedStory = useMemo(
    () => availableStories.find((s) => s.id === selectedStoryId) || filteredAvailable[0] || null,
    [availableStories, filteredAvailable, selectedStoryId]
  );

  const workDrafts = useMemo(
    () => drafts.filter((d) => d.status !== 'approved' && d.status !== 'archived'),
    [drafts]
  );

  const readyDrafts = useMemo(
    () => drafts.filter((d) => d.status === 'approved' || d.status === 'archived'),
    [drafts]
  );

  const activeDraft = useMemo(
    () => drafts.find((d) => d.contentId === selectedDraftId) || workDrafts[0] || drafts[0] || null,
    [drafts, workDrafts, selectedDraftId]
  );

  useEffect(() => {
    if (activeDraft) {
      setEditTitle(activeDraft.title);
      setEditSubtitle(activeDraft.subtitle);
      setEditBody(activeDraft.body);
      setEditQuestion(activeDraft.triggerQuestion);
    }
  }, [activeDraft?.contentId, activeDraft?.updatedAt]);

  const allPresets = useMemo(
    () => [...systemPresets, ...(voiceConfig?.customPresets || [])],
    [systemPresets, voiceConfig]
  );

  const handleGenerate = async () => {
    if (!selectedStory) return;
    setGenBusy(true);
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const res = await generateContent({
        sourceStoryId: selectedStory.id,
        lengthPreset,
        narrativeStyle: narrativeStyle === 'auto' ? undefined : narrativeStyle,
        variantsCount,
        voicePresetId: voicePresetId || undefined,
      });
      await loadState();
      await onDatabaseChanged();
      if (res.created[0]) {
        setSelectedDraftId(res.created[0].contentId);
      }
      setNoticeMsg(`Сгенерировано вариантов: ${res.created.length}`);
      setTab('drafts');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Не удалось сгенерировать публикацию');
    } finally {
      setGenBusy(false);
    }
  };

  const handleManualCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStory || !manualBody.trim()) return;
    setGenBusy(true);
    setErrorMsg(null);
    try {
      const res = await createContentDraft({
        sourceStoryId: selectedStory.id,
        title: manualTitle.trim() || selectedStory.title,
        body: manualBody.trim(),
        triggerQuestion: manualQuestion.trim() || selectedStory.mainTriggerQuestion,
      });
      setManualTitle('');
      setManualBody('');
      setManualQuestion('');
      setManualMode(false);
      await loadState();
      await onDatabaseChanged();
      setSelectedDraftId(res.draft.contentId);
      setTab('drafts');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка создания черновика');
    } finally {
      setGenBusy(false);
    }
  };

  const handleSaveDraftEdits = async () => {
    if (!activeDraft) return;
    setDraftBusy(true);
    setErrorMsg(null);
    try {
      await updateContentDraft(activeDraft.contentId, {
        title: editTitle,
        subtitle: editSubtitle,
        body: editBody,
        triggerQuestion: editQuestion,
        revisionReason: 'Ручная редактура текста',
      });
      await loadState();
      setNoticeMsg('Черновик сохранён и пересчитан по критериям качества');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка сохранения черновика');
    } finally {
      setDraftBusy(false);
    }
  };

  const handleRewrite = async () => {
    if (!activeDraft) return;
    setDraftBusy(true);
    setErrorMsg(null);
    try {
      await rewriteContentDraft(activeDraft.contentId, rewriteMode);
      await loadState();
      setNoticeMsg('Переписывание выполнено; предыдущая версия сохранена в истории');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка переписывания');
    } finally {
      setDraftBusy(false);
    }
  };

  const handleStatusChange = async (draftId: string, status: ContentDraftStatus) => {
    setDraftBusy(true);
    setErrorMsg(null);
    try {
      await updateContentDraftStatus(draftId, status);
      await loadState();
      await onDatabaseChanged();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Не удалось изменить статус');
    } finally {
      setDraftBusy(false);
    }
  };

  const handleExport = async (ids?: string[]) => {
    setErrorMsg(null);
    try {
      const blob = await exportContentJson(exportMode, ids);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `melo_love_content_${exportMode}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка экспорта');
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    try {
      const parsed = JSON.parse(await file.text());
      const items = Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed) ? parsed : null;
      if (!items) throw new Error('Ожидается JSON с массивом items');
      const res = await importContentJson(items);
      await loadState();
      await onDatabaseChanged();
      setNoticeMsg(`Импортировано публикаций: ${res.imported}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка импорта JSON');
    } finally {
      e.target.value = '';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-zinc-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Загружаем Story Generator & Voice Engine...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-stone-200 pb-4">
        <h2 className="text-xl font-semibold text-zinc-900">
          Story Generator · MELO_LOVE Voice Engine
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          Превращение утверждённых и свободных сюжетных основ в живые редакционные публикации с
          контролем стиля, разнообразия зачинов и антиштамп-оценкой.
        </p>
      </div>

      {!geminiConfigured && (
        <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-zinc-700">
          <span className="font-medium text-zinc-900">AI-генерация (Gemini / GigaChat API) пока не подключена (опционально):</span>{' '}
          автогенерация и AI-переписывание временно недоступны, но создание черновиков вручную,
          словарь выражений, настройки голоса и экспорт работают в обычном режиме. Ключ{' '}
          <code>GEMINI_API_KEY</code> или резерв GigaChat API (<code>GIGACHAT_AUTH_KEY</code>)
          можно подключить позже в серверных секретах.
        </div>
      )}

      {/* 7 Top KPI Metrics */}
      {metrics && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <div className="rounded-lg border border-stone-200 bg-white p-3.5">
            <div className="text-[11px] text-zinc-500">Доступные сюжеты</div>
            <div className="mt-1 font-mono text-xl font-semibold text-zinc-900 tabular-nums">
              {metrics.availableStoriesCount}
            </div>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-3.5">
            <div className="text-[11px] text-zinc-500">Всего черновиков</div>
            <div className="mt-1 font-mono text-xl font-semibold text-zinc-900 tabular-nums">
              {metrics.totalDrafts}
            </div>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-3.5">
            <div className="text-[11px] text-zinc-500">Готовы к проверке</div>
            <div className="mt-1 font-mono text-xl font-semibold text-zinc-900 tabular-nums">
              {metrics.readyForReviewCount}
            </div>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-3.5">
            <div className="text-[11px] text-zinc-500">Требуют редактуры</div>
            <div className="mt-1 font-mono text-xl font-semibold text-amber-800 tabular-nums">
              {metrics.needsRevisionCount}
            </div>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-3.5">
            <div className="text-[11px] text-zinc-500">Утверждённые</div>
            <div className="mt-1 font-mono text-xl font-semibold text-teal-800 tabular-nums">
              {metrics.approvedCount}
            </div>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-3.5">
            <div className="text-[11px] text-zinc-500">Средний балл</div>
            <div className="mt-1 font-mono text-xl font-semibold text-zinc-900 tabular-nums">
              {metrics.averageQualityScore}
            </div>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-3.5">
            <div className="text-[11px] text-zinc-500">Фразы (акт. / перегр.)</div>
            <div className="mt-1 font-mono text-xl font-semibold text-zinc-900 tabular-nums">
              {metrics.activePhrasesCount} / {metrics.overusedPhrasesCount}
            </div>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {errorMsg}
        </div>
      )}
      {noticeMsg && (
        <div className="rounded-md border border-teal-200 bg-teal-50 px-4 py-2.5 text-xs text-teal-900">
          {noticeMsg}
        </div>
      )}

      {/* 7 Sub-tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-stone-200 pb-3">
        {(
          [
            ['generate', 'Генерация'],
            ['drafts', `Черновики (${workDrafts.length})`],
            ['ready', `Готовые публикации (${readyDrafts.length})`],
            ['history', 'История версий'],
            ['voice', 'MELO_LOVE VOICE ENGINE'],
            ['phrasebook', `Словарь выражений (${phrasebook.length})`],
            ['quality_settings', 'Настройки качества'],
          ] as Array<[GeneratorTab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap cursor-pointer ${
              tab === id
                ? 'bg-zinc-900 text-white'
                : 'border border-stone-200 bg-white text-zinc-700 hover:bg-stone-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* TAB 1: GENERATION */}
      {tab === 'generate' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left: Story picker */}
          <div className="rounded-lg border border-stone-200 bg-white lg:col-span-6 flex flex-col">
            <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                1. Свободные утверждённые сюжеты ({filteredAvailable.length})
              </span>
              <select
                value={storyColFilter}
                onChange={(e) => setStoryColFilter(e.target.value as 'all' | CollectionType)}
                className="rounded border border-stone-200 bg-white px-2 py-1 text-xs"
              >
                <option value="all">Все разделы</option>
                <option value="debate">Споры</option>
                <option value="romantic">Романтика</option>
              </select>
            </div>
            <div className="max-h-[460px] divide-y divide-stone-200 overflow-y-auto">
              {filteredAvailable.length === 0 ? (
                <div className="px-4 py-10 text-center text-xs text-zinc-500">
                  Нет сюжетов со статусами `approved` + `unused`. Подтвердите сюжеты в разделе базы.
                </div>
              ) : (
                filteredAvailable.map((s) => {
                  const isSelected = selectedStory?.id === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedStoryId(s.id)}
                      className={`w-full px-4 py-3 text-left transition-colors cursor-pointer ${
                        isSelected ? 'bg-rose-50/60' : 'hover:bg-stone-50'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs text-zinc-500">
                        <span className="font-mono font-semibold text-zinc-800">{s.id}</span>
                        <span>
                          {s.collection === 'debate' ? 'Споры' : 'Романтика'} · {s.category}
                        </span>
                      </div>
                      <div className="mt-0.5 text-sm font-semibold text-zinc-900">{s.title}</div>
                      <div className="mt-0.5 text-xs text-zinc-600 line-clamp-2">
                        {s.shortDescription}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: Parameters */}
          <div className="rounded-lg border border-stone-200 bg-white p-5 space-y-5 lg:col-span-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                2. Параметры публикации и голоса
              </span>
              <button
                type="button"
                onClick={() => setManualMode((v) => !v)}
                className="text-xs font-medium text-rose-800 hover:text-rose-900 cursor-pointer"
              >
                {manualMode ? 'Переключить на ИИ-генерацию' : 'Написать текст вручную'}
              </button>
            </div>

            {selectedStory && (
              <div className="rounded border border-stone-200 bg-stone-50 p-3 text-xs space-y-1">
                <div className="font-mono font-semibold text-zinc-800">
                  Выбран: {selectedStory.id} · {selectedStory.title}
                </div>
                <div className="text-zinc-600">{selectedStory.coreConflictOrAction}</div>
              </div>
            )}

            {manualMode ? (
              <form onSubmit={handleManualCreate} className="space-y-3">
                <label className="block text-xs font-medium text-zinc-700">
                  Заголовок
                  <input
                    type="text"
                    value={manualTitle}
                    onChange={(e) => setManualTitle(e.target.value)}
                    placeholder={selectedStory?.title || ''}
                    className="mt-1 w-full rounded border border-stone-200 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-xs font-medium text-zinc-700">
                  Текст публикации
                  <textarea
                    rows={7}
                    value={manualBody}
                    onChange={(e) => setManualBody(e.target.value)}
                    placeholder="Напишите живой текст на основе выбранной сюжетной основы..."
                    className="mt-1 w-full rounded border border-stone-200 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-xs font-medium text-zinc-700">
                  Вопрос к читателям в финале
                  <input
                    type="text"
                    value={manualQuestion}
                    onChange={(e) => setManualQuestion(e.target.value)}
                    placeholder={selectedStory?.mainTriggerQuestion || ''}
                    className="mt-1 w-full rounded border border-stone-200 px-3 py-2 text-sm"
                  />
                </label>
                <button
                  type="submit"
                  disabled={genBusy || !selectedStory || !manualBody.trim()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  Создать черновик вручную
                </button>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="block text-xs font-medium text-zinc-700">
                    Объём текста
                    <select
                      value={lengthPreset}
                      onChange={(e) => setLengthPreset(e.target.value as ContentLengthPreset)}
                      className="mt-1 w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
                    >
                      {Object.entries(CONTENT_LENGTH_PRESETS).map(([key, info]) => (
                        <option key={key} value={key}>
                          {info.label} ({info.minWords}–{info.maxWords} слов)
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-xs font-medium text-zinc-700">
                    Количество вариантов (1–3)
                    <select
                      value={variantsCount}
                      onChange={(e) => setVariantsCount(Number(e.target.value))}
                      className="mt-1 w-full rounded-md border border-stone-200 bg-white px-3 py-2 font-mono text-sm"
                    >
                      <option value={1}>1 вариант</option>
                      <option value={2}>2 разных зачина</option>
                      <option value={3}>3 разных зачина</option>
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="block text-xs font-medium text-zinc-700">
                    Стиль зачина
                    <select
                      value={narrativeStyle}
                      onChange={(e) =>
                        setNarrativeStyle(e.target.value as 'auto' | NarrativeStartStyle)
                      }
                      className="mt-1 w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
                    >
                      <option value="auto">Автоподбор (анти-повтор за 35 постов)</option>
                      {NARRATIVE_START_STYLES.map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-xs font-medium text-zinc-700">
                    Профиль MELO_LOVE Voice
                    <select
                      value={voicePresetId}
                      onChange={(e) => setVoicePresetId(e.target.value)}
                      className="mt-1 w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
                    >
                      {allPresets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    disabled={genBusy || !selectedStory}
                    onClick={handleGenerate}
                    className="inline-flex items-center gap-1.5 rounded-md bg-rose-800 px-4 py-2 text-sm font-medium text-white hover:bg-rose-900 disabled:opacity-50 cursor-pointer"
                  >
                    {genBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    {genBusy ? 'Генерируем публикацию...' : 'Сгенерировать в голосе MELO_LOVE'}
                  </button>

                  {(genBusy || isGenerating) && (
                    <button
                      type="button"
                      onClick={() => cancelContentGeneration().then(loadState)}
                      className="inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-medium text-rose-800 hover:bg-rose-50 cursor-pointer"
                    >
                      <Square className="h-3.5 w-3.5" />
                      Прервать
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: DRAFTS WORKBENCH */}
      {tab === 'drafts' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="rounded-lg border border-stone-200 bg-white lg:col-span-4 divide-y divide-stone-200 max-h-[680px] overflow-y-auto">
            {workDrafts.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs text-zinc-500">
                Черновиков пока нет. Сгенерируйте текст на первой вкладке.
              </div>
            ) : (
              workDrafts.map((d) => (
                <button
                  key={d.contentId}
                  type="button"
                  onClick={() => setSelectedDraftId(d.contentId)}
                  className={`w-full px-4 py-3 text-left cursor-pointer ${
                    activeDraft?.contentId === d.contentId ? 'bg-rose-50/60' : 'hover:bg-stone-50'
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500">
                    <span>
                      {d.contentId} · {d.sourceStoryId}
                    </span>
                    <span className="tabular-nums font-semibold text-zinc-900">
                      {d.quality.overall}/100
                    </span>
                  </div>
                  <div className="mt-0.5 text-sm font-semibold text-zinc-900 line-clamp-1">
                    {d.title}
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    {DRAFT_STATUS_TEXT[d.status]} · {d.wordCount} слов
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="rounded-lg border border-stone-200 bg-white p-5 space-y-4 lg:col-span-8">
            {!activeDraft ? (
              <div className="py-12 text-center text-xs text-zinc-500">
                Выберите черновик слева для редактуры и переписывания.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 pb-3">
                  <div className="text-xs text-zinc-500">
                    <span className="font-mono font-semibold text-zinc-800">
                      {activeDraft.contentId}
                    </span>{' '}
                    · сюжет {activeDraft.sourceStoryId} ·{' '}
                    <span className="font-mono tabular-nums">
                      Балл: {activeDraft.quality.overall}/100
                    </span>{' '}
                    · {DRAFT_STATUS_TEXT[activeDraft.status]}
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await deleteContentDraft(activeDraft.contentId);
                      setSelectedDraftId(null);
                      await loadState();
                      await onDatabaseChanged();
                    }}
                    className="inline-flex items-center gap-1 rounded border border-stone-200 px-2.5 py-1 text-xs text-rose-800 hover:bg-rose-50 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Удалить
                  </button>
                </div>

                {/* Quality penalties */}
                {activeDraft.quality.penalties.details.length > 0 && (
                  <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                    Замечания контроля качества: {activeDraft.quality.penalties.details.join(' · ')}
                  </div>
                )}

                <label className="block text-xs font-medium text-zinc-700">
                  Заголовок
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="mt-1 w-full rounded border border-stone-200 px-3 py-2 text-sm font-semibold text-zinc-900"
                  />
                </label>

                <label className="block text-xs font-medium text-zinc-700">
                  Подзаголовок / лид
                  <input
                    type="text"
                    value={editSubtitle}
                    onChange={(e) => setEditSubtitle(e.target.value)}
                    className="mt-1 w-full rounded border border-stone-200 px-3 py-1.5 text-xs text-zinc-800"
                  />
                </label>

                <label className="block text-xs font-medium text-zinc-700">
                  Текст публикации
                  <textarea
                    rows={10}
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    className="mt-1 w-full rounded border border-stone-200 px-3 py-2 text-sm leading-relaxed text-zinc-900"
                  />
                </label>

                <label className="block text-xs font-medium text-zinc-700">
                  Финальный вопрос к обсуждению
                  <input
                    type="text"
                    value={editQuestion}
                    onChange={(e) => setEditQuestion(e.target.value)}
                    className="mt-1 w-full rounded border border-stone-200 px-3 py-1.5 text-sm text-zinc-900"
                  />
                </label>

                {/* Rewrite + Save + Status */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={rewriteMode}
                      onChange={(e) => setRewriteMode(e.target.value as RewriteMode)}
                      className="rounded border border-stone-200 bg-white px-2.5 py-1.5 text-xs"
                    >
                      {REWRITE_OPTIONS.map((o) => (
                        <option key={o.mode} value={o.mode}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={draftBusy}
                      onClick={handleRewrite}
                      className="inline-flex items-center gap-1 rounded border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-stone-50 cursor-pointer"
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      Переписать
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={draftBusy}
                      onClick={handleSaveDraftEdits}
                      className="inline-flex items-center gap-1 rounded border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-stone-50 cursor-pointer"
                    >
                      <Save className="h-3.5 w-3.5" />
                      Сохранить
                    </button>
                    <button
                      type="button"
                      disabled={draftBusy}
                      onClick={() => handleStatusChange(activeDraft.contentId, 'ready_for_review')}
                      className="rounded border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-stone-50 cursor-pointer"
                    >
                      На финальную проверку
                    </button>
                    <button
                      type="button"
                      disabled={draftBusy}
                      onClick={() => handleStatusChange(activeDraft.contentId, 'approved')}
                      className="inline-flex items-center gap-1 rounded bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 cursor-pointer"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Утвердить к выходу
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: READY PUBLICATIONS */}
      {tab === 'ready' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white p-4">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium text-zinc-700">Формат экспорта JSON:</span>
              <select
                value={exportMode}
                onChange={(e) => setExportMode(e.target.value as ContentExportMode)}
                className="rounded border border-stone-200 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="with_source">Текст + исходный паспорт сюжета</option>
                <option value="draft_only">Только готовый текст публикации</option>
                <option value="story_only">Только исходные сюжеты</option>
              </select>
            </div>
            <button
              type="button"
              onClick={() => handleExport(readyDrafts.map((d) => d.contentId))}
              className="inline-flex items-center gap-1.5 rounded bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              Экспортировать утверждённые ({readyDrafts.length})
            </button>
          </div>

          {readyDrafts.length === 0 ? (
            <div className="rounded-lg border border-stone-200 bg-white px-6 py-12 text-center text-sm text-zinc-500">
              Утверждённых публикаций пока нет.
            </div>
          ) : (
            <div className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
              {readyDrafts.map((d) => (
                <div key={d.contentId} className="p-5 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                    <span className="font-mono">
                      {d.contentId} · сюжет {d.sourceStoryId} · {d.wordCount} слов · балл{' '}
                      {d.quality.overall}/100
                    </span>
                    <button
                      type="button"
                      onClick={() => handleStatusChange(d.contentId, 'draft')}
                      className="text-xs font-medium text-zinc-700 hover:text-zinc-900 cursor-pointer"
                    >
                      Вернуть в черновики
                    </button>
                  </div>
                  <h4 className="text-base font-semibold text-zinc-900">{d.title}</h4>
                  <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-700">
                    {d.body}
                  </p>
                  <div className="text-xs font-medium text-zinc-600">
                    Вопрос к аудитории: «{d.triggerQuestion}»
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: VERSION HISTORY */}
      {tab === 'history' && (
        <div className="space-y-4">
          {drafts.filter((d) => d.revisionHistory.length > 0).length === 0 ? (
            <div className="rounded-lg border border-stone-200 bg-white px-6 py-12 text-center space-y-2">
              <History className="mx-auto h-6 w-6 text-zinc-400" />
              <div className="text-sm font-medium text-zinc-800">История правок пока пуста</div>
              <p className="text-xs text-zinc-500">
                Снимки версий создаются автоматически при ручном сохранении или ИИ-переписывании.
              </p>
            </div>
          ) : (
            drafts
              .filter((d) => d.revisionHistory.length > 0)
              .map((d) => (
                <div key={d.contentId} className="rounded-lg border border-stone-200 bg-white p-5 space-y-3">
                  <div className="text-sm font-semibold text-zinc-900">
                    <span className="font-mono text-zinc-500 mr-2">{d.contentId}</span>
                    {d.title}
                  </div>
                  <div className="divide-y divide-stone-200 rounded border border-stone-200">
                    {d.revisionHistory.map((rev) => (
                      <div
                        key={`${d.contentId}-v${rev.version}`}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="font-mono font-semibold text-zinc-800">
                            v{rev.version} · {rev.qualityScore}/100
                          </span>
                          <span className="mx-2 text-zinc-300">·</span>
                          <span className="text-zinc-600">{rev.reason}</span>
                          <p className="mt-0.5 text-zinc-500 line-clamp-1">{rev.body}</p>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            await restoreContentVersion(d.contentId, rev.version);
                            await loadState();
                            setTab('drafts');
                          }}
                          className="inline-flex items-center gap-1 rounded border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-800 hover:bg-stone-50 cursor-pointer"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Откатить
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))
          )}
        </div>
      )}

      {/* TAB 5: VOICE ENGINE */}
      {tab === 'voice' && voiceConfig && (
        <div className="space-y-6">
          <div className="rounded-lg border border-stone-200 bg-white p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
              <Sliders className="h-4 w-4" />
              Системные и пользовательские профили голоса
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {allPresets.map((preset) => {
                const isActive = voiceConfig.activePresetId === preset.id;
                return (
                  <div
                    key={preset.id}
                    className={`rounded-md border p-3.5 space-y-2 ${
                      isActive ? 'border-zinc-900 bg-stone-50' : 'border-stone-200 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-zinc-900">{preset.name}</span>
                      {!preset.isSystem && (
                        <button
                          type="button"
                          onClick={() =>
                            deleteVoicePreset(preset.id).then((r) => setVoiceConfig(r.voiceConfig))
                          }
                          className="text-zinc-400 hover:text-rose-700 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-zinc-600">{preset.description}</p>
                    <button
                      type="button"
                      onClick={() =>
                        updateVoiceConfig({
                          activePresetId: preset.id,
                          debate: preset.debate,
                          romantic: preset.romantic,
                        }).then((r) => setVoiceConfig(r.voiceConfig))
                      }
                      className={`rounded px-2.5 py-1 text-xs font-medium cursor-pointer ${
                        isActive
                          ? 'bg-zinc-900 text-white'
                          : 'border border-stone-300 bg-white text-zinc-700 hover:bg-stone-50'
                      }`}
                    >
                      {isActive ? 'Активен' : 'Применить'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {(['debate', 'romantic'] as CollectionType[]).map((mode) => (
              <div key={mode} className="rounded-lg border border-stone-200 bg-white p-5 space-y-4">
                <h3 className="text-sm font-semibold text-zinc-900">
                  {mode === 'debate'
                    ? 'Тональность · Режим A (Споры и дискуссии)'
                    : 'Тональность · Режим B (Тёплая романтика)'}
                </h3>
                <div className="space-y-3">
                  {VOICE_SLIDER_LABELS.map(({ key, label }) => {
                    const value = voiceConfig[mode][key];
                    return (
                      <label key={`${mode}-${key}`} className="block text-xs text-zinc-700">
                        <div className="flex justify-between">
                          <span>{label}</span>
                          <span className="font-mono font-semibold tabular-nums">{value}/100</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={value}
                          onChange={(e) => {
                            const nextVal = Number(e.target.value);
                            setVoiceConfig((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    [mode]: { ...prev[mode], [key]: nextVal },
                                  }
                                : prev
                            );
                          }}
                          className="mt-1 w-full accent-zinc-900"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-stone-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                placeholder="Название нового пресета"
                className="rounded border border-stone-200 px-3 py-1.5 text-xs"
              />
              <input
                type="text"
                value={newPresetDesc}
                onChange={(e) => setNewPresetDesc(e.target.value)}
                placeholder="Короткое описание"
                className="rounded border border-stone-200 px-3 py-1.5 text-xs"
              />
              <button
                type="button"
                onClick={async () => {
                  if (!newPresetName.trim()) return;
                  const res = await createVoicePreset({
                    name: newPresetName.trim(),
                    description: newPresetDesc.trim(),
                    debate: voiceConfig.debate,
                    romantic: voiceConfig.romantic,
                  });
                  setVoiceConfig(res.voiceConfig);
                  setNewPresetName('');
                  setNewPresetDesc('');
                }}
                className="rounded border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-stone-50 cursor-pointer"
              >
                Сохранить как свой пресет
              </button>
            </div>

            <button
              type="button"
              onClick={async () => {
                const res = await updateVoiceConfig({
                  debate: voiceConfig.debate,
                  romantic: voiceConfig.romantic,
                });
                setVoiceConfig(res.voiceConfig);
                setNoticeMsg('Настройки MELO_LOVE Voice Engine сохранены');
              }}
              className="rounded-md bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 cursor-pointer"
            >
              Сохранить настройки голоса
            </button>
          </div>
        </div>
      )}

      {/* TAB 6: PHRASEBOOK */}
      {tab === 'phrasebook' && (
        <div className="space-y-5">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newPhrase.trim()) return;
              const res = await createPhrasebookEntry({
                phrase: newPhrase.trim(),
                meaningNote: newPhraseNote.trim(),
                collectionScope: newPhraseScope,
                toneTag: newPhraseTag,
                weight: newPhraseWeight,
                maxFrequencyPer10: newPhraseMaxFreq,
              });
              setPhrasebook(res.phrasebook);
              setNewPhrase('');
              setNewPhraseNote('');
              await loadState();
            }}
            className="rounded-lg border border-stone-200 bg-white p-4 grid grid-cols-1 gap-3 md:grid-cols-12 items-end"
          >
            <label className="block text-xs font-medium text-zinc-700 md:col-span-4">
              Авторская фраза или оборот
              <input
                type="text"
                value={newPhrase}
                onChange={(e) => setNewPhrase(e.target.value)}
                placeholder="И вот тут мелочь перестаёт быть мелочью"
                className="mt-1 w-full rounded border border-stone-200 px-2.5 py-1.5 text-xs"
              />
            </label>
            <label className="block text-xs font-medium text-zinc-700 md:col-span-3">
              Смысл / когда уместна
              <input
                type="text"
                value={newPhraseNote}
                onChange={(e) => setNewPhraseNote(e.target.value)}
                placeholder="Кульминация скрытого правила"
                className="mt-1 w-full rounded border border-stone-200 px-2.5 py-1.5 text-xs"
              />
            </label>
            <label className="block text-xs font-medium text-zinc-700 md:col-span-2">
              Раздел
              <select
                value={newPhraseScope}
                onChange={(e) => setNewPhraseScope(e.target.value as CollectionType | 'both')}
                className="mt-1 w-full rounded border border-stone-200 bg-white px-2 py-1.5 text-xs"
              >
                <option value="both">Оба</option>
                <option value="debate">Споры</option>
                <option value="romantic">Романтика</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-zinc-700 md:col-span-1">
              Лимит/10
              <input
                type="number"
                min={1}
                max={10}
                value={newPhraseMaxFreq}
                onChange={(e) => setNewPhraseMaxFreq(Number(e.target.value) || 2)}
                className="mt-1 w-full rounded border border-stone-200 px-2 py-1.5 font-mono text-xs"
              />
            </label>
            <div className="md:col-span-2">
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center gap-1 rounded bg-zinc-900 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-800 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                Добавить фразу
              </button>
            </div>
          </form>

          <div className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
            {phrasebook.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-xs"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2 text-zinc-500">
                    <span className="font-mono">{entry.id}</span>
                    <span>·</span>
                    <span>{entry.toneTag}</span>
                    <span>·</span>
                    <span className="font-mono tabular-nums">
                      За 10 постов: {entry.recentUsageCount}/{entry.maxFrequencyPer10} · Всего:{' '}
                      {entry.totalUsageCount}
                    </span>
                    {entry.banned && (
                      <>
                        <span>·</span>
                        <span className="font-semibold text-rose-700">Заблокирована</span>
                      </>
                    )}
                  </div>
                  <div className="text-sm font-medium text-zinc-900">«{entry.phrase}»</div>
                  <div className="text-zinc-600">{entry.meaningNote}</div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      updatePhrasebookEntry(entry.id, { banned: !entry.banned }).then((r) =>
                        setPhrasebook(r.phrasebook)
                      )
                    }
                    className="rounded border border-stone-200 px-2.5 py-1 text-xs text-zinc-700 hover:bg-stone-50 cursor-pointer"
                  >
                    {entry.banned ? 'Разблокировать' : 'Заблокировать'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      deletePhrasebookEntry(entry.id).then((r) => setPhrasebook(r.phrasebook))
                    }
                    className="rounded border border-stone-200 p-1.5 text-zinc-400 hover:text-rose-700 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 7: QUALITY SETTINGS & BACKUP */}
      {tab === 'quality_settings' && voiceConfig && (
        <div className="space-y-6 max-w-2xl">
          <div className="rounded-lg border border-stone-200 bg-white p-5 space-y-4">
            <h3 className="text-sm font-semibold text-zinc-900">
              Порог допуска публикаций к утверждению
            </h3>
            <label className="block text-xs font-medium text-zinc-700">
              Минимальный балл качества (60–98)
              <input
                type="number"
                min={60}
                max={98}
                value={voiceConfig.minPublishQualityScore}
                onChange={(e) =>
                  setVoiceConfig({
                    ...voiceConfig,
                    minPublishQualityScore: Math.max(
                      60,
                      Math.min(98, Number(e.target.value) || 85)
                    ),
                  })
                }
                className="mt-1 w-32 rounded border border-stone-200 px-3 py-2 font-mono text-sm tabular-nums"
              />
            </label>
            <p className="text-xs text-zinc-500">
              Если текст при генерации набирает меньше порога, сервер автоматически выполняет один
              проход доработки (`autoRefined: true`), а при критическом штампе или дословном копировании
              понижает итоговый балл ниже 85.
            </p>
            <button
              type="button"
              onClick={async () => {
                const res = await updateVoiceConfig({
                  minPublishQualityScore: voiceConfig.minPublishQualityScore,
                });
                setVoiceConfig(res.voiceConfig);
                setNoticeMsg('Порог допуска сохранён');
              }}
              className="rounded-md bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 cursor-pointer"
            >
              Сохранить порог
            </button>
          </div>

          <div className="rounded-lg border border-stone-200 bg-white p-5 space-y-3">
            <h3 className="text-sm font-semibold text-zinc-900">
              Экспорт / импорт публикаций и снимок модуля
            </h3>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => handleExport()}
                className="inline-flex items-center gap-1.5 rounded border border-stone-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800 hover:bg-stone-50 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                Выгрузить все черновики (JSON)
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleImportFile}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded border border-stone-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800 hover:bg-stone-50 cursor-pointer"
              >
                <Upload className="h-3.5 w-3.5" />
                Импортировать публикации (JSON)
              </button>
              <button
                type="button"
                onClick={() =>
                  createContentBackup().then(() =>
                    setNoticeMsg('Создана резервная копия данных Story Generator')
                  )
                }
                className="inline-flex items-center gap-1.5 rounded border border-stone-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800 hover:bg-stone-50 cursor-pointer"
              >
                <Database className="h-3.5 w-3.5" />
                Снимок модуля
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
