import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, GitMerge, Save, X } from 'lucide-react';
import {
  CollectionType,
  CustomCategory,
  OriginType,
  SimilarityMatch,
  StoryPlot,
  UsageStatus,
  VerificationStatus,
} from '../shared/types.js';
import { getCategoriesForCollection, PLOT_MECHANICS } from '../shared/categories.js';
import { ApiError, checkStorySimilarity } from '../services/api.js';

interface StoryModalProps {
  mode: 'view' | 'create';
  story: StoryPlot | null;
  defaultCollection: CollectionType;
  customCategories: CustomCategory[];
  onClose: () => void;
  onSaveExisting: (id: string, updates: Partial<StoryPlot>) => Promise<void>;
  onCreateStory: (payload: Partial<StoryPlot> & { forceSave?: boolean }) => Promise<void>;
  onMergeStory: (payload: {
    targetStoryId: string;
    nuanceToAppend: string;
    newTitle?: string;
  }) => Promise<void>;
}

const EMPTY_FORM = (collection: CollectionType): Partial<StoryPlot> => ({
  collection,
  category: getCategoriesForCollection(collection)[0] || '',
  subcategory: '',
  title: '',
  shortDescription: '',
  fullPlot: '',
  participants: '',
  setting: '',
  coreConflictOrAction: '',
  sideAPosition: '',
  sideBPosition: '',
  emotionalMechanism: '',
  hiddenExpectation: '',
  unexpectedNuance: '',
  possibleTwist: '',
  mainTriggerQuestion: '',
  additionalQuestions: [],
  keywords: [],
  ideaSource: 'Редактор MELO_LOVE',
  sourceUrl: '',
  originType: 'original',
  verificationStatus: 'pending',
  usageStatus: 'unused',
  mainTheme: '',
  plotMechanic: PLOT_MECHANICS[0],
  uniqueDetails: '',
  sourceAnalysisNote: '',
});

export const StoryModal: React.FC<StoryModalProps> = ({
  mode,
  story,
  defaultCollection,
  customCategories,
  onClose,
  onSaveExisting,
  onCreateStory,
  onMergeStory,
}) => {
  const isCreate = mode === 'create' || !story;
  const [form, setForm] = useState<Partial<StoryPlot>>(() =>
    isCreate ? EMPTY_FORM(defaultCollection) : { ...story }
  );
  const [additionalQText, setAdditionalQText] = useState(() =>
    (isCreate ? [] : story?.additionalQuestions || []).join('\n')
  );
  const [keywordsText, setKeywordsText] = useState(() =>
    (isCreate ? [] : story?.keywords || []).join(', ')
  );
  const [saving, setSaving] = useState(false);
  const [checkingDup, setCheckingDup] = useState(false);
  const [matches, setMatches] = useState<SimilarityMatch[]>(() => story?.similarityMatches || []);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (story && mode === 'view') {
      setForm({ ...story });
      setAdditionalQText((story.additionalQuestions || []).join('\n'));
      setKeywordsText((story.keywords || []).join(', '));
      setMatches(story.similarityMatches || []);
    } else if (isCreate) {
      setForm(EMPTY_FORM(defaultCollection));
      setAdditionalQText('');
      setKeywordsText('');
      setMatches([]);
    }
    setErrorMsg(null);
  }, [story, mode, isCreate, defaultCollection]);

  const activeCollection: CollectionType =
    form.collection === 'romantic' ? 'romantic' : 'debate';
  const categories = Array.from(
    new Set([
      ...getCategoriesForCollection(activeCollection),
      ...customCategories
        .filter((c) => c.collection === activeCollection)
        .map((c) => c.name),
    ])
  );

  const buildPayload = (): Partial<StoryPlot> => ({
    ...form,
    additionalQuestions: additionalQText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    keywords: keywordsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  });

  const handleCheckDuplicates = async () => {
    setCheckingDup(true);
    setErrorMsg(null);
    try {
      const res = await checkStorySimilarity(buildPayload());
      setMatches(res.matches);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка проверки совпадений');
    } finally {
      setCheckingDup(false);
    }
  };

  const handleSubmit = async (forceSave = false) => {
    setSaving(true);
    setErrorMsg(null);
    try {
      const payload = buildPayload();
      if (isCreate) {
        await onCreateStory({ ...payload, forceSave });
      } else if (story) {
        await onSaveExisting(story.id, payload);
      }
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.matches) {
        setMatches(err.matches);
        setErrorMsg(err.message);
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Не удалось сохранить сюжет');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleMerge = async (targetStoryId: string) => {
    setSaving(true);
    setErrorMsg(null);
    try {
      await onMergeStory({
        targetStoryId,
        nuanceToAppend: form.unexpectedNuance || form.shortDescription || form.title || '',
      });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Не удалось объединить сюжеты');
    } finally {
      setSaving(false);
    }
  };

  const updateField = <K extends keyof StoryPlot>(key: K, val: StoryPlot[K]) => {
    setForm((prev) => ({ ...prev, [key]: val }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="font-mono font-semibold text-zinc-800">
                {isCreate ? 'НОВЫЙ СЮЖЕТ' : story?.id}
              </span>
              <span>·</span>
              <span>
                {activeCollection === 'debate' ? 'Споры и мнения' : 'Романтическая история'}
              </span>
              {!isCreate && story?.quality && (
                <>
                  <span>·</span>
                  <span className="font-mono tabular-nums text-zinc-800">
                    Качество: {story.quality.overall}/100
                  </span>
                </>
              )}
              {!isCreate && story?.researchId && (
                <>
                  <span>·</span>
                  <span className="font-mono text-zinc-600">{story.researchId}</span>
                </>
              )}
            </div>
            <h3 className="mt-0.5 text-lg font-semibold text-zinc-900">
              {isCreate ? 'Создание паспорта сюжетной основы' : form.title || 'Паспорт сюжета'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-stone-100 hover:text-zinc-700 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {errorMsg && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
              {errorMsg}
            </div>
          )}

          {/* Duplicate conflict panel */}
          {matches.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50/70 p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-950">
                <AlertTriangle className="h-4 w-4 text-amber-700" />
                Обнаружены смысловые совпадения ({matches.length})
              </div>
              <div className="space-y-2">
                {matches.map((m) => (
                  <div
                    key={m.storyId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-200/80 bg-white px-3 py-2 text-xs"
                  >
                    <div>
                      <span className="font-mono font-semibold text-zinc-800">{m.storyId}</span>
                      <span className="mx-2 text-zinc-300">·</span>
                      <span className="font-medium text-zinc-900">{m.title}</span>
                      <span className="ml-2 font-mono text-amber-800 tabular-nums">
                        ({m.score}%)
                      </span>
                      <p className="mt-0.5 text-zinc-500">{m.reason}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleMerge(m.storyId)}
                      disabled={saving}
                      className="inline-flex items-center gap-1 rounded border border-stone-300 bg-stone-50 px-2.5 py-1 text-xs font-medium text-zinc-800 hover:bg-stone-100 cursor-pointer"
                    >
                      <GitMerge className="h-3.5 w-3.5" />
                      Объединить нюанс с {m.storyId}
                    </button>
                  </div>
                ))}
              </div>
              {isCreate && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => handleSubmit(true)}
                    disabled={saving}
                    className="rounded border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-800 hover:bg-rose-50 cursor-pointer"
                  >
                    Всё равно сохранить как самостоятельный сюжет
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Classification & status */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <label className="block text-xs font-medium text-zinc-700">
              Раздел
              <select
                disabled={!isCreate}
                value={activeCollection}
                onChange={(e) => {
                  const nextCol = e.target.value as CollectionType;
                  setForm((prev) => ({
                    ...prev,
                    collection: nextCol,
                    category: getCategoriesForCollection(nextCol)[0] || '',
                  }));
                }}
                className="mt-1 w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-zinc-900 disabled:bg-stone-50"
              >
                <option value="debate">Споры и мнения</option>
                <option value="romantic">Романтические истории</option>
              </select>
            </label>

            <label className="block text-xs font-medium text-zinc-700">
              Категория
              <select
                value={form.category || ''}
                onChange={(e) => updateField('category', e.target.value)}
                className="mt-1 w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-zinc-900"
              >
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs font-medium text-zinc-700">
              Подтема
              <input
                type="text"
                value={form.subcategory || ''}
                onChange={(e) => updateField('subcategory', e.target.value)}
                className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm text-zinc-900"
              />
            </label>

            <label className="block text-xs font-medium text-zinc-700">
              Сюжетная механика
              <select
                value={form.plotMechanic || ''}
                onChange={(e) => updateField('plotMechanic', e.target.value)}
                className="mt-1 w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-zinc-900"
              >
                {PLOT_MECHANICS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                {form.plotMechanic && !PLOT_MECHANICS.includes(form.plotMechanic) && (
                  <option value={form.plotMechanic}>{form.plotMechanic}</option>
                )}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="block text-xs font-medium text-zinc-700 md:col-span-2">
              Рабочее название (Title)
              <input
                type="text"
                value={form.title || ''}
                onChange={(e) => updateField('title', e.target.value)}
                className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm font-medium text-zinc-900"
              />
            </label>

            <label className="block text-xs font-medium text-zinc-700">
              Главная тема (mainTheme)
              <input
                type="text"
                value={form.mainTheme || ''}
                onChange={(e) => updateField('mainTheme', e.target.value)}
                className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm text-zinc-900"
              />
            </label>
          </div>

          <label className="block text-xs font-medium text-zinc-700">
            Краткое описание (shortDescription)
            <textarea
              rows={2}
              value={form.shortDescription || ''}
              onChange={(e) => updateField('shortDescription', e.target.value)}
              className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm text-zinc-900"
            />
          </label>

          <label className="block text-xs font-medium text-zinc-700">
            Развёрнутая сюжетная основа (fullPlot)
            <textarea
              rows={5}
              value={form.fullPlot || ''}
              onChange={(e) => updateField('fullPlot', e.target.value)}
              className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm leading-relaxed text-zinc-900"
            />
          </label>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block text-xs font-medium text-zinc-700">
              Участники (participants)
              <input
                type="text"
                value={form.participants || ''}
                onChange={(e) => updateField('participants', e.target.value)}
                className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm text-zinc-900"
              />
            </label>
            <label className="block text-xs font-medium text-zinc-700">
              Обстоятельства / место (setting)
              <input
                type="text"
                value={form.setting || ''}
                onChange={(e) => updateField('setting', e.target.value)}
                className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm text-zinc-900"
              />
            </label>
          </div>

          <label className="block text-xs font-medium text-zinc-700">
            Ядро конфликта или поступка (coreConflictOrAction)
            <textarea
              rows={2}
              value={form.coreConflictOrAction || ''}
              onChange={(e) => updateField('coreConflictOrAction', e.target.value)}
              className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm text-zinc-900"
            />
          </label>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block text-xs font-medium text-zinc-700">
              {activeCollection === 'debate' ? 'Позиция стороны А' : 'Восприятие / мотив героя А'}
              <textarea
                rows={2}
                value={form.sideAPosition || ''}
                onChange={(e) => updateField('sideAPosition', e.target.value)}
                className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm text-zinc-900"
              />
            </label>
            <label className="block text-xs font-medium text-zinc-700">
              {activeCollection === 'debate' ? 'Позиция стороны Б' : 'Ответная реакция героя Б'}
              <textarea
                rows={2}
                value={form.sideBPosition || ''}
                onChange={(e) => updateField('sideBPosition', e.target.value)}
                className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm text-zinc-900"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block text-xs font-medium text-zinc-700">
              Эмоциональный механизм
              <textarea
                rows={2}
                value={form.emotionalMechanism || ''}
                onChange={(e) => updateField('emotionalMechanism', e.target.value)}
                className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm text-zinc-900"
              />
            </label>
            <label className="block text-xs font-medium text-zinc-700">
              Скрытое ожидание
              <textarea
                rows={2}
                value={form.hiddenExpectation || ''}
                onChange={(e) => updateField('hiddenExpectation', e.target.value)}
                className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm text-zinc-900"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block text-xs font-medium text-zinc-700">
              Неожиданный нюанс (unexpectedNuance)
              <textarea
                rows={2}
                value={form.unexpectedNuance || ''}
                onChange={(e) => updateField('unexpectedNuance', e.target.value)}
                className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm text-zinc-900"
              />
            </label>
            <label className="block text-xs font-medium text-zinc-700">
              Возможный поворот (possibleTwist)
              <textarea
                rows={2}
                value={form.possibleTwist || ''}
                onChange={(e) => updateField('possibleTwist', e.target.value)}
                className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm text-zinc-900"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block text-xs font-medium text-zinc-700">
              Главный вопрос к аудитории (mainTriggerQuestion)
              <input
                type="text"
                value={form.mainTriggerQuestion || ''}
                onChange={(e) => updateField('mainTriggerQuestion', e.target.value)}
                className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm text-zinc-900"
              />
            </label>
            <label className="block text-xs font-medium text-zinc-700">
              Уникальная живая деталь (uniqueDetails)
              <input
                type="text"
                value={form.uniqueDetails || ''}
                onChange={(e) => updateField('uniqueDetails', e.target.value)}
                className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm text-zinc-900"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block text-xs font-medium text-zinc-700">
              Дополнительные вопросы (по одному на строку)
              <textarea
                rows={3}
                value={additionalQText}
                onChange={(e) => setAdditionalQText(e.target.value)}
                className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm text-zinc-900"
              />
            </label>
            <label className="block text-xs font-medium text-zinc-700">
              Ключевые слова (через запятую)
              <textarea
                rows={3}
                value={keywordsText}
                onChange={(e) => setKeywordsText(e.target.value)}
                className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm text-zinc-900"
              />
            </label>
          </div>

          {/* Provenance & status */}
          <div className="grid grid-cols-1 gap-4 border-t border-stone-200 pt-4 md:grid-cols-4">
            <label className="block text-xs font-medium text-zinc-700">
              Источник идеи
              <input
                type="text"
                value={form.ideaSource || ''}
                onChange={(e) => updateField('ideaSource', e.target.value)}
                className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm text-zinc-900"
              />
            </label>
            <label className="block text-xs font-medium text-zinc-700">
              URL источника
              <input
                type="text"
                value={form.sourceUrl || ''}
                onChange={(e) => updateField('sourceUrl', e.target.value)}
                className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm text-zinc-900"
              />
            </label>
            <label className="block text-xs font-medium text-zinc-700">
              Происхождение
              <select
                value={form.originType || 'original'}
                onChange={(e) => updateField('originType', e.target.value as OriginType)}
                className="mt-1 w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-zinc-900"
              >
                <option value="original">Оригинальный сюжет</option>
                <option value="external">Внешний источник</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-zinc-700">
              Статус проверки
              <select
                value={form.verificationStatus || 'pending'}
                onChange={(e) =>
                  updateField('verificationStatus', e.target.value as VerificationStatus)
                }
                className="mt-1 w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-zinc-900"
              >
                <option value="pending">Ожидает проверки</option>
                <option value="approved">Подтверждён</option>
                <option value="needs_revision">На доработке</option>
                <option value="rejected">Отклонён</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block text-xs font-medium text-zinc-700">
              Статус использования
              <select
                value={form.usageStatus || 'unused'}
                onChange={(e) => updateField('usageStatus', e.target.value as UsageStatus)}
                className="mt-1 w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-zinc-900"
              >
                <option value="unused">Не использован</option>
                <option value="drafted">Есть черновик</option>
                <option value="published">Опубликован</option>
                <option value="archived">В архиве</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-zinc-700">
              Примечание по источнику / исследованию
              <input
                type="text"
                value={form.researchNotes || form.sourceAnalysisNote || ''}
                onChange={(e) => {
                  updateField('researchNotes', e.target.value);
                  updateField('sourceAnalysisNote', e.target.value);
                }}
                className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm text-zinc-900"
              />
            </label>
          </div>

          {!isCreate && story?.quality && (
            <div className="rounded-md border border-stone-200 bg-stone-50 p-4 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold uppercase tracking-wider text-zinc-500">
                  Оценка качества сюжета
                </span>
                <span className="font-mono font-semibold text-zinc-900 tabular-nums">
                  {story.quality.overall}/100
                </span>
              </div>
              <p className="text-xs text-zinc-600">{story.quality.editorialNote}</p>
              <div className="grid grid-cols-2 gap-2 pt-1 text-xs sm:grid-cols-5">
                {Object.entries(story.quality.breakdown).map(([k, val]) => (
                  <div key={k} className="rounded border border-stone-200 bg-white px-2.5 py-1.5">
                    <div className="truncate text-[11px] text-zinc-500">{k}</div>
                    <div className="font-mono font-semibold text-zinc-900 tabular-nums">{val}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 bg-stone-50 px-6 py-3.5">
          <button
            type="button"
            onClick={handleCheckDuplicates}
            disabled={checkingDup}
            className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-stone-100 disabled:opacity-50 cursor-pointer"
          >
            {checkingDup ? 'Проверяем совпадения...' : 'Проверить уникальность сейчас'}
          </button>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-stone-100 cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => handleSubmit(false)}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
            >
              {isCreate ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {saving ? 'Сохраняем...' : isCreate ? 'Добавить в базу' : 'Сохранить изменения'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
