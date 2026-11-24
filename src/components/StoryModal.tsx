import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, GitMerge, Pencil, Trash2, X } from 'lucide-react';
import { getCategoriesForCollection, PLOT_MECHANICS } from '../shared/categories.ts';
import { calculateOverallQuality } from '../shared/similarity.ts';
import type {
  CollectionType,
  OriginType,
  SimilarityMatch,
  StoryPlot,
  UsageStatus,
  VerificationStatus,
} from '../shared/types.ts';
import * as api from '../services/api.ts';

interface StoryModalProps {
  story: StoryPlot | null; // null => create mode
  initialCollection?: CollectionType;
  customCategories: { debate: string[]; romantic: string[] };
  onClose: () => void;
  onSaved: (saved: StoryPlot) => void;
  onDeleted?: (id: string) => void;
  onMerged?: () => void;
}

const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  approved: 'Проверен и принят',
  pending: 'Ожидает проверки',
  needs_revision: 'На доработке',
  rejected: 'Отклонён',
};

const USAGE_LABELS: Record<UsageStatus, string> = {
  unused: 'Не использован',
  drafted: 'В черновике',
  published: 'Опубликован',
  archived: 'В архиве',
};

function createBlankDraft(collection: CollectionType): Partial<StoryPlot> {
  return {
    collection,
    category: collection === 'debate' ? 'Деньги и отношения' : 'Маленькие проявления любви',
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
    ideaSource: 'Оригинальная редакционная разработка (без внешнего URL)',
    sourceUrl: '',
    originType: 'original',
    verificationStatus: 'pending',
    usageStatus: 'unused',
    mainTheme: '',
    plotMechanic: PLOT_MECHANICS[0],
    uniqueDetails: '',
    sourceAnalysisNote: '',
    batchNumber: 1,
    quality: {
      overall: 78,
      originality: 78,
      realism: 80,
      emotionalExpressiveness: 78,
      interest: 78,
      discussionPotential: 78,
      specificity: 78,
      plotVariability: 76,
      ambiguity: collection === 'debate' ? 78 : undefined,
      bothSidesArgumentation: collection === 'debate' ? 78 : undefined,
      contradictionStrength: collection === 'debate' ? 78 : undefined,
      emotionalWarmth: collection === 'romantic' ? 80 : undefined,
      relatability: collection === 'romantic' ? 80 : undefined,
      smallDetailPower: collection === 'romantic' ? 80 : undefined,
      naturalness: collection === 'romantic' ? 80 : undefined,
      editorialNote: 'Ручное добавление редактором',
    },
  };
}

export const StoryModal: React.FC<StoryModalProps> = ({
  story,
  initialCollection = 'debate',
  customCategories,
  onClose,
  onSaved,
  onDeleted,
  onMerged,
}) => {
  const isNew = !story;
  const [editing, setEditing] = useState<boolean>(isNew);
  const [form, setForm] = useState<Partial<StoryPlot>>(
    story ? { ...story } : createBlankDraft(initialCollection)
  );
  const [keywordsText, setKeywordsText] = useState<string>(
    (story?.keywords || []).join(', ')
  );
  const [questionsText, setQuestionsText] = useState<string>(
    (story?.additionalQuestions || []).join('\n')
  );
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [duplicateAlert, setDuplicateAlert] = useState<SimilarityMatch[] | null>(
    story?.similarityMatches && story.similarityMatches.length > 0
      ? story.similarityMatches
      : null
  );

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const collection: CollectionType = form.collection === 'romantic' ? 'romantic' : 'debate';
  const availableCategories = getCategoriesForCollection(collection, customCategories);

  const updateQualityField = (key: string, val: number | string) => {
    const nextQ = {
      ...(form.quality || {
        overall: 75,
        originality: 75,
        realism: 75,
        emotionalExpressiveness: 75,
        interest: 75,
        discussionPotential: 75,
        specificity: 75,
        plotVariability: 75,
        editorialNote: '',
      }),
      [key]: val,
    };
    nextQ.overall = calculateOverallQuality(nextQ, collection);
    setForm((prev) => ({ ...prev, quality: nextQ }));
  };

  const buildPayload = (): Partial<StoryPlot> => ({
    ...form,
    keywords: keywordsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    additionalQuestions: questionsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  });

  const handleCheckDuplicates = async () => {
    setErrorMsg(null);
    try {
      const res = await api.checkSimilarity(buildPayload());
      setDuplicateAlert(res.matches.length > 0 ? res.matches : []);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleSave = async (forceSave = false) => {
    setErrorMsg(null);
    setSaving(true);
    try {
      const payload = buildPayload();
      if (isNew) {
        const res = await api.createStory(payload, forceSave);
        onSaved(res.story);
      } else if (story) {
        const res = await api.updateStory(story.id, payload);
        onSaved(res.story);
      }
    } catch (err) {
      const typedErr = err as Error & { status?: number; matches?: SimilarityMatch[] };
      if (typedErr.status === 409 && typedErr.matches) {
        setDuplicateAlert(typedErr.matches);
        setErrorMsg(typedErr.message);
      } else {
        setErrorMsg(typedErr.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleMergeIntoMatch = async (match: SimilarityMatch) => {
    setSaving(true);
    setErrorMsg(null);
    try {
      const payload = buildPayload();
      await api.mergeStories({
        targetId: match.matchedId,
        mergedFields: {
          unexpectedNuance: payload.unexpectedNuance || undefined,
          possibleTwist: payload.possibleTwist || undefined,
          additionalQuestions: payload.additionalQuestions,
          keywords: payload.keywords,
        },
        removeDuplicateId: story?.id,
      });
      onMerged?.();
      onClose();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!story) return;
    setSaving(true);
    try {
      await api.deleteStory(story.id);
      onDeleted?.(story.id);
      onClose();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleQuickStatus = async (status: VerificationStatus) => {
    if (!story) return;
    setSaving(true);
    try {
      const res = await api.updateStoryStatus(story.id, { verificationStatus: status });
      setForm(res.story);
      onSaved(res.story);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const q = form.quality;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 md:p-6"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="font-mono font-medium text-slate-700">
                {story ? story.id : 'Новый сюжет'}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {collection === 'debate'
                  ? 'Коллекция A: Кто здесь прав?'
                  : 'Коллекция B: Романтические истории'}
              </span>
              {story && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Партия #{story.batchNumber}</span>
                  <span aria-hidden="true">·</span>
                  <span>{VERIFICATION_LABELS[story.verificationStatus]}</span>
                </>
              )}
            </div>
            <h2 className="mt-1 truncate text-lg font-semibold text-slate-900">
              {isNew ? 'Добавление новой сюжетной основы' : form.title}
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!isNew && !editing && (
              <>
                <button
                  type="button"
                  onClick={() => handleQuickStatus('approved')}
                  disabled={saving || form.verificationStatus === 'approved'}
                  className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <Check className="h-3.5 w-3.5" />
                  Принять
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Редактировать
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 whitespace-nowrap shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Удалить
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть окно"
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {errorMsg && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {errorMsg}
            </div>
          )}

          {/* Duplicate alert panel */}
          {duplicateAlert && duplicateAlert.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50/70 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
                <span>Найдены смысловые совпадения в базе ({duplicateAlert.length})</span>
              </div>
              <div className="space-y-2.5">
                {duplicateAlert.map((m) => (
                  <div
                    key={m.matchedId}
                    className="rounded border border-amber-200 bg-white p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium text-slate-900">
                        <span className="font-mono text-xs text-slate-500 mr-2">
                          {m.matchedId}
                        </span>
                        {m.matchedTitle}
                      </div>
                      <span className="font-mono text-xs font-semibold text-amber-800 tabular-nums">
                        Сходство: {m.similarityScore}%
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">{m.matchedShortDescription}</p>
                    <p className="mt-1.5 text-xs text-amber-800">{m.reason}</p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleMergeIntoMatch(m)}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <GitMerge className="h-3.5 w-3.5" />
                        Объединить нюансы с {m.matchedId}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {editing && (
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-amber-900">
                  <span>
                    Вы можете изменить сюжет выше, чтобы убрать пересечение, или сохранить принудительно как самостоятельный сюжет.
                  </span>
                  {isNew && (
                    <button
                      type="button"
                      onClick={() => handleSave(true)}
                      disabled={saving}
                      className="rounded border border-amber-400 bg-white px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-100"
                    >
                      Сохранить как отдельный сюжет
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {duplicateAlert && duplicateAlert.length === 0 && editing && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800">
              Проверка уникальности пройдена: смысловых дублей в текущей базе не обнаружено.
            </div>
          )}

          {!editing && story ? (
            /* Read-only structured view of all 26 fields */
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="lg:col-span-2 space-y-5">
                  <div>
                    <div className="text-xs font-medium text-slate-500">Краткое описание</div>
                    <p className="mt-1 text-sm leading-relaxed text-slate-800">
                      {story.shortDescription}
                    </p>
                  </div>

                  <div className="border-t border-slate-100 pt-4">
                    <div className="text-xs font-medium text-slate-500">Полная сюжетная основа</div>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-900 whitespace-pre-line">
                      {story.fullPlot}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
                    <div>
                      <div className="text-xs font-medium text-slate-500">
                        {story.collection === 'debate'
                          ? 'Позиция первой стороны'
                          : 'Перспектива инициатора сцены'}
                      </div>
                      <p className="mt-1 text-sm text-slate-800">{story.sideAPosition}</p>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">
                        {story.collection === 'debate'
                          ? 'Позиция второй стороны'
                          : 'Эмоциональная реакция партнёра'}
                      </div>
                      <p className="mt-1 text-sm text-slate-800">{story.sideBPosition}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
                    <div>
                      <div className="text-xs font-medium text-slate-500">
                        Главный конфликт или действие
                      </div>
                      <p className="mt-1 text-sm text-slate-800">{story.coreConflictOrAction}</p>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Эмоциональный механизм</div>
                      <p className="mt-1 text-sm text-slate-800">{story.emotionalMechanism}</p>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Скрытое ожидание</div>
                      <p className="mt-1 text-sm text-slate-800">{story.hiddenExpectation}</p>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">Неожиданный нюанс</div>
                      <p className="mt-1 text-sm text-slate-800">{story.unexpectedNuance}</p>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-4">
                    <div className="text-xs font-medium text-slate-500">
                      Возможный поворот / финал
                    </div>
                    <p className="mt-1 text-sm text-slate-800">{story.possibleTwist}</p>
                  </div>

                  <div className="border-t border-slate-100 pt-4 space-y-2">
                    <div className="text-xs font-medium text-slate-500">
                      Основной триггерный вопрос для публикации
                    </div>
                    <p className="text-sm font-semibold text-slate-900">
                      {story.mainTriggerQuestion}
                    </p>
                    {story.additionalQuestions.length > 0 && (
                      <div className="pt-1">
                        <div className="text-xs text-slate-500">Дополнительные вопросы:</div>
                        <ul className="mt-1 list-disc pl-5 text-sm text-slate-700 space-y-1">
                          {story.additionalQuestions.map((aq, idx) => (
                            <li key={idx}>{aq}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right column: Structured Passport + Quality Breakdown */}
                <div className="space-y-5 border-t border-slate-200 pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-900">Паспорт записи (26 полей)</h3>
                    <dl className="mt-3 space-y-2.5 text-xs">
                      <div>
                        <dt className="text-slate-500">Категория / Подкатегория</dt>
                        <dd className="mt-0.5 font-medium text-slate-900">
                          {story.category} · {story.subcategory}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Участники</dt>
                        <dd className="mt-0.5 text-slate-800">{story.participants}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Место действия</dt>
                        <dd className="mt-0.5 text-slate-800">{story.setting}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Главная тема и механика</dt>
                        <dd className="mt-0.5 text-slate-800">
                          {story.mainTheme} · {story.plotMechanic}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Уникальная деталь</dt>
                        <dd className="mt-0.5 text-slate-800">{story.uniqueDetails}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Ключевые слова</dt>
                        <dd className="mt-0.5 text-slate-700">{story.keywords.join(' · ')}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Происхождение и источник</dt>
                        <dd className="mt-0.5 text-slate-800">
                          {story.originType === 'external' ? 'Внешний источник' : 'Оригинальная идея'} —{' '}
                          {story.ideaSource}
                          {story.sourceUrl ? (
                            <div className="mt-1">
                              <a
                                href={story.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-indigo-700 underline break-all"
                              >
                                {story.sourceUrl}
                              </a>
                            </div>
                          ) : (
                            <div className="mt-0.5 text-slate-500">
                              URL отсутствует (оригинальная разработка)
                            </div>
                          )}
                          {story.researchId && (
                            <div className="mt-1 text-slate-600">
                              Карточка исследования:{' '}
                              <span className="font-mono font-medium">{story.researchId}</span>
                            </div>
                          )}
                          {story.researchNotes && (
                            <div className="mt-1 text-slate-600">{story.researchNotes}</div>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Статус использования · Дата</dt>
                        <dd className="mt-0.5 text-slate-800 tabular-nums">
                          {USAGE_LABELS[story.usageStatus]} ·{' '}
                          {new Date(story.createdAt).toLocaleDateString('ru-RU')}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Семантический отпечаток</dt>
                        <dd className="mt-0.5 font-mono text-[11px] text-slate-600 break-all">
                          {story.semanticFingerprint}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  {/* Quality Rubric */}
                  <div className="border-t border-slate-200 pt-4">
                    <div className="flex items-baseline justify-between">
                      <h3 className="text-xs font-semibold text-slate-900">Оценка качества</h3>
                      <span className="font-mono text-lg font-bold text-slate-900 tabular-nums">
                        {story.quality.overall}/100
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-slate-600">{story.quality.editorialNote}</p>
                    <div className="mt-3 space-y-1.5 text-xs">
                      <ScoreRow label="Оригинальность" value={story.quality.originality} />
                      <ScoreRow label="Жизненность" value={story.quality.realism} />
                      <ScoreRow
                        label="Эмоц. выразительность"
                        value={story.quality.emotionalExpressiveness}
                      />
                      <ScoreRow label="Интересность" value={story.quality.interest} />
                      <ScoreRow
                        label="Потенциал обсуждения"
                        value={story.quality.discussionPotential}
                      />
                      <ScoreRow label="Конкретность" value={story.quality.specificity} />
                      <ScoreRow label="Сюжетная вариативность" value={story.quality.plotVariability} />
                      {story.collection === 'debate' ? (
                        <>
                          <ScoreRow label="Неоднозначность" value={story.quality.ambiguity ?? 0} />
                          <ScoreRow
                            label="Аргументы обеих сторон"
                            value={story.quality.bothSidesArgumentation ?? 0}
                          />
                          <ScoreRow
                            label="Сила противоречия"
                            value={story.quality.contradictionStrength ?? 0}
                          />
                        </>
                      ) : (
                        <>
                          <ScoreRow
                            label="Эмоциональная теплота"
                            value={story.quality.emotionalWarmth ?? 0}
                          />
                          <ScoreRow label="Узнаваемость" value={story.quality.relatability ?? 0} />
                          <ScoreRow
                            label="Сила маленькой детали"
                            value={story.quality.smallDetailPower ?? 0}
                          />
                          <ScoreRow
                            label="Естественность поступка"
                            value={story.quality.naturalness ?? 0}
                          />
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Edit / Create Form */
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Коллекция</label>
                  <select
                    value={collection}
                    disabled={!isNew}
                    onChange={(e) => {
                      const col = e.target.value as CollectionType;
                      const cats = getCategoriesForCollection(col, customCategories);
                      setForm((prev) => ({
                        ...prev,
                        collection: col,
                        category: cats[0],
                      }));
                    }}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
                  >
                    <option value="debate">Коллекция A — «Кто здесь прав?»</option>
                    <option value="romantic">Коллекция B — «Романтические истории»</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Категория</label>
                  <select
                    value={form.category || ''}
                    onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  >
                    {availableCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Подкатегория</label>
                  <input
                    type="text"
                    value={form.subcategory || ''}
                    onChange={(e) => setForm((p) => ({ ...p, subcategory: e.target.value }))}
                    placeholder="Напр., Разные ожидания от отдыха"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Название сюжета</label>
                <input
                  type="text"
                  value={form.title || ''}
                  onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Краткое описание</label>
                <textarea
                  rows={2}
                  value={form.shortDescription || ''}
                  onChange={(e) => setForm((p) => ({ ...p, shortDescription: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Полная сюжетная основа
                </label>
                <textarea
                  rows={4}
                  value={form.fullPlot || ''}
                  onChange={(e) => setForm((p) => ({ ...p, fullPlot: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Участники</label>
                  <input
                    type="text"
                    value={form.participants || ''}
                    onChange={(e) => setForm((p) => ({ ...p, participants: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Место действия</label>
                  <input
                    type="text"
                    value={form.setting || ''}
                    onChange={(e) => setForm((p) => ({ ...p, setting: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Главный конфликт или действие
                  </label>
                  <input
                    type="text"
                    value={form.coreConflictOrAction || ''}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, coreConflictOrAction: e.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Сюжетная механика</label>
                  <select
                    value={form.plotMechanic || PLOT_MECHANICS[0]}
                    onChange={(e) => setForm((p) => ({ ...p, plotMechanic: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  >
                    {PLOT_MECHANICS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    {collection === 'debate'
                      ? 'Позиция первой стороны'
                      : 'Перспектива инициатора'}
                  </label>
                  <textarea
                    rows={2}
                    value={form.sideAPosition || ''}
                    onChange={(e) => setForm((p) => ({ ...p, sideAPosition: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    {collection === 'debate'
                      ? 'Позиция второй стороны'
                      : 'Реакция второго участника'}
                  </label>
                  <textarea
                    rows={2}
                    value={form.sideBPosition || ''}
                    onChange={(e) => setForm((p) => ({ ...p, sideBPosition: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Эмоциональный механизм
                  </label>
                  <input
                    type="text"
                    value={form.emotionalMechanism || ''}
                    onChange={(e) => setForm((p) => ({ ...p, emotionalMechanism: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Скрытое ожидание</label>
                  <input
                    type="text"
                    value={form.hiddenExpectation || ''}
                    onChange={(e) => setForm((p) => ({ ...p, hiddenExpectation: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Неожиданный нюанс</label>
                  <input
                    type="text"
                    value={form.unexpectedNuance || ''}
                    onChange={(e) => setForm((p) => ({ ...p, unexpectedNuance: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Возможный поворот / финал
                  </label>
                  <input
                    type="text"
                    value={form.possibleTwist || ''}
                    onChange={(e) => setForm((p) => ({ ...p, possibleTwist: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Основной триггерный вопрос
                  </label>
                  <input
                    type="text"
                    value={form.mainTriggerQuestion || ''}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, mainTriggerQuestion: e.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Ключевые слова (через запятую)
                  </label>
                  <input
                    type="text"
                    value={keywordsText}
                    onChange={(e) => setKeywordsText(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Дополнительные вопросы (по одному на строке)
                  </label>
                  <textarea
                    rows={2}
                    value={questionsText}
                    onChange={(e) => setQuestionsText(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Главная тема</label>
                    <input
                      type="text"
                      value={form.mainTheme || ''}
                      onChange={(e) => setForm((p) => ({ ...p, mainTheme: e.target.value }))}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Уникальная деталь
                    </label>
                    <input
                      type="text"
                      value={form.uniqueDetails || ''}
                      onChange={(e) => setForm((p) => ({ ...p, uniqueDetails: e.target.value }))}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                    />
                  </div>
                </div>
              </div>

              {/* Source & Status */}
              <div className="grid grid-cols-1 gap-4 border-t border-slate-200 pt-4 sm:grid-cols-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Происхождение</label>
                  <select
                    value={form.originType || 'original'}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, originType: e.target.value as OriginType }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  >
                    <option value="original">Оригинальная идея</option>
                    <option value="external">Внешний источник</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Источник идеи</label>
                  <input
                    type="text"
                    value={form.ideaSource || ''}
                    onChange={(e) => setForm((p) => ({ ...p, ideaSource: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">URL источника</label>
                  <input
                    type="url"
                    value={form.sourceUrl || ''}
                    disabled={form.originType !== 'external'}
                    onChange={(e) => setForm((p) => ({ ...p, sourceUrl: e.target.value }))}
                    placeholder="Только реальный URL"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Статус проверки</label>
                  <select
                    value={form.verificationStatus || 'pending'}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        verificationStatus: e.target.value as VerificationStatus,
                      }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  >
                    <option value="approved">Проверен и принят</option>
                    <option value="pending">Ожидает проверки</option>
                    <option value="needs_revision">На доработке</option>
                    <option value="rejected">Отклонён</option>
                  </select>
                </div>
              </div>

              {/* Quality editing */}
              {q && (
                <div className="border-t border-slate-200 pt-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-800">
                      Рубрика оценки качества
                    </span>
                    <span className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                      Итог: {q.overall}/100
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <ScoreInput
                      label="Оригинальность"
                      value={q.originality}
                      onChange={(v) => updateQualityField('originality', v)}
                    />
                    <ScoreInput
                      label="Жизненность"
                      value={q.realism}
                      onChange={(v) => updateQualityField('realism', v)}
                    />
                    <ScoreInput
                      label="Эмоц. выразительность"
                      value={q.emotionalExpressiveness}
                      onChange={(v) => updateQualityField('emotionalExpressiveness', v)}
                    />
                    <ScoreInput
                      label="Потенциал обсуждения"
                      value={q.discussionPotential}
                      onChange={(v) => updateQualityField('discussionPotential', v)}
                    />
                  </div>
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-slate-700">
                      Комментарий редактора по качеству
                    </label>
                    <input
                      type="text"
                      value={q.editorialNote || ''}
                      onChange={(e) => updateQualityField('editorialNote', e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          {editing ? (
            <>
              <button
                type="button"
                onClick={handleCheckDuplicates}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                Проверить уникальность
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => (isNew ? onClose() : setEditing(false))}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={() => handleSave(false)}
                  disabled={saving}
                  className="rounded-md bg-indigo-700 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
                >
                  {saving ? 'Сохранение...' : isNew ? 'Сохранить в базу' : 'Сохранить изменения'}
                </button>
              </div>
            </>
          ) : (
            <div className="flex w-full items-center justify-between">
              <div className="text-xs text-slate-500">
                Создано: {story ? new Date(story.createdAt).toLocaleString('ru-RU') : ''}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                Закрыть
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const ScoreRow: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-slate-600">{label}</span>
    <span className="font-mono font-medium text-slate-900 tabular-nums">{value}</span>
  </div>
);

const ScoreInput: React.FC<{
  label: string;
  value: number;
  onChange: (val: number) => void;
}> = ({ label, value, onChange }) => (
  <div>
    <label className="block text-[11px] text-slate-600">{label}</label>
    <input
      type="number"
      min={0}
      max={100}
      value={value}
      onChange={(e) => onChange(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
      className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono text-xs text-slate-900 tabular-nums"
    />
  </div>
);
