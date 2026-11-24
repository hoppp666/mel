import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { getCategoriesForCollection, PLOT_MECHANICS } from '../shared/categories.ts';
import type {
  ResearchDuplicateMatch,
  ResearchIdeaDraft,
  ResearchQueueStatus,
  ResearchResult,
} from '../shared/types.ts';
import * as api from '../services/api.ts';

interface ResearchDetailModalProps {
  result: ResearchResult;
  customCategories: { debate: string[]; romantic: string[] };
  onClose: () => void;
  onUpdated: (next: ResearchResult) => void;
  onApprovedToDatabase: () => Promise<void>;
}

export const QUEUE_STATUS_LABELS: Record<ResearchQueueStatus, string> = {
  research_pending: 'Ожидает анализа',
  analysis_completed: 'Анализ завершён',
  idea_generated: 'Идея сформирована',
  duplicate_check: 'Проверка дублей',
  awaiting_review: 'Ожидает решения',
  approved_for_database: 'Добавлено в базу',
  rejected: 'Отклонено',
};

export const ResearchDetailModal: React.FC<ResearchDetailModalProps> = ({
  result,
  customCategories,
  onClose,
  onUpdated,
  onApprovedToDatabase,
}) => {
  const [card, setCard] = useState<ResearchResult>(result);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [duplicateWarningMatches, setDuplicateWarningMatches] = useState<
    ResearchDuplicateMatch[] | null
  >(null);

  useEffect(() => {
    setCard(result);
    setDuplicateWarningMatches(null);
  }, [result]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const categories = getCategoriesForCollection(card.collection, customCategories);

  const updateIdeaField = <K extends keyof ResearchIdeaDraft>(
    field: K,
    val: ResearchIdeaDraft[K]
  ) => {
    setCard((prev) => {
      const existingIdea: ResearchIdeaDraft = prev.generatedIdea || {
        collection: prev.collection,
        category: prev.targetCategory || categories[0],
        subcategory: prev.relationshipType || 'Зарубежное исследование',
        title: '',
        shortDescription: '',
        fullPlot: '',
        participants: prev.participants,
        setting: '',
        coreConflictOrAction: prev.mainConflict,
        sideAPosition: prev.positionsOfParticipants.sideA,
        sideBPosition: prev.positionsOfParticipants.sideB,
        emotionalMechanism: prev.emotionalMechanism,
        hiddenExpectation: prev.hiddenExpectation,
        unexpectedNuance: prev.unexpectedDetail,
        possibleTwist: prev.possibleTwist,
        mainTriggerQuestion: prev.readerReactionPotential,
        additionalQuestions: [],
        keywords: prev.keywords,
        mainTheme: prev.mainSituation,
        plotMechanic: prev.storyMechanic,
        uniqueDetails: prev.unexpectedDetail,
        originType: 'external',
        sourceUrl: prev.sourceUrl,
        ideaSource: `${prev.sourceName} (${prev.researchId})`,
        researchNotes: prev.researchNotes,
      };
      return {
        ...prev,
        generatedIdea: {
          ...existingIdea,
          [field]: val,
        },
      };
    });
  };

  const handleSaveChanges = async () => {
    setBusyAction('save');
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const res = await api.updateResearchResult(card.researchId, {
        targetCategory: card.targetCategory,
        mainSituation: card.mainSituation,
        participants: card.participants,
        relationshipType: card.relationshipType,
        mainConflict: card.mainConflict,
        positionsOfParticipants: card.positionsOfParticipants,
        emotionalMechanism: card.emotionalMechanism,
        hiddenExpectation: card.hiddenExpectation,
        unexpectedDetail: card.unexpectedDetail,
        possibleTwist: card.possibleTwist,
        readerReactionPotential: card.readerReactionPotential,
        storyMechanic: card.storyMechanic,
        researchNotes: card.researchNotes,
        generatedIdea: card.generatedIdea,
      });
      setCard(res.result);
      onUpdated(res.result);
      setInfoMsg('Изменения карточки и заготовки сохранены.');
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleReanalyze = async () => {
    setBusyAction('analyze');
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const res = await api.analyzeResearchResult(card.researchId);
      setCard(res.result);
      onUpdated(res.result);
      setInfoMsg('Повторный анализ материала завершён.');
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleGenerateIdea = async () => {
    setBusyAction('generate');
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const res = await api.generateResearchIdea(card.researchId);
      setCard(res.result);
      onUpdated(res.result);
      setInfoMsg('Сформирована новая переосмысленная сюжетная основа.');
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleCheckDuplicates = async () => {
    setBusyAction('dedup');
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const res = await api.checkResearchDuplicate(card.researchId);
      setCard(res.result);
      onUpdated(res.result);
      setInfoMsg(
        res.result.duplicateMatches.length > 0
          ? `Найдено смысловых совпадений: ${res.result.duplicateMatches.length}.`
          : 'Совпадений с базой и очередью не обнаружено.'
      );
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleApprove = async (forceIgnoreDuplicates = false) => {
    setBusyAction('approve');
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      await api.updateResearchResult(card.researchId, {
        targetCategory: card.targetCategory,
        researchNotes: card.researchNotes,
        generatedIdea: card.generatedIdea,
      });
      const res = await api.approveResearchResult(card.researchId, forceIgnoreDuplicates);
      setCard(res.result);
      onUpdated(res.result);
      setDuplicateWarningMatches(null);
      await onApprovedToDatabase();
      setInfoMsg(
        `Идея добавлена в основную STORY DATABASE под ID ${res.story.id} (verificationStatus = pending, usageStatus = unused).`
      );
    } catch (err) {
      const typed = err as Error & {
        status?: number;
        matches?: ResearchDuplicateMatch[];
        result?: ResearchResult;
      };
      if (typed.status === 409 && typed.matches) {
        if (typed.result) {
          setCard(typed.result);
          onUpdated(typed.result);
        }
        setDuplicateWarningMatches(typed.matches);
        setErrorMsg(typed.message);
      } else {
        setErrorMsg(typed.message);
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleReject = async () => {
    setBusyAction('reject');
    setErrorMsg(null);
    try {
      const res = await api.rejectResearchResult(card.researchId);
      setCard(res.result);
      onUpdated(res.result);
      setInfoMsg('Идея переведена в статус rejected.');
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  const qb = card.qualityBreakdown;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 md:p-6"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-mono font-semibold text-slate-800">{card.researchId}</span>
              <span aria-hidden="true">·</span>
              <span>
                {card.collection === 'debate'
                  ? 'DEBATE RESEARCH («Кто здесь прав?»)'
                  : 'ROMANTIC RESEARCH («Романтические»)'}
              </span>
              <span aria-hidden="true">·</span>
              <span>{card.sourceName}</span>
              <span aria-hidden="true">·</span>
              <span className="font-medium text-indigo-800">
                {QUEUE_STATUS_LABELS[card.queueStatus]}
              </span>
              {card.savedStoryId && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono font-semibold text-emerald-700">
                    В базе: {card.savedStoryId}
                  </span>
                </>
              )}
            </div>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">
              {card.generatedIdea?.title || card.sourceTitle}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть карточку"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {errorMsg && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
              {errorMsg}
            </div>
          )}
          {infoMsg && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
              {infoMsg}
            </div>
          )}

          {/* Duplicate Alert Block */}
          {(duplicateWarningMatches || card.duplicateMatches.length > 0) && (
            <div className="rounded-lg border border-amber-300 bg-amber-50/70 p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-950">
                  <AlertTriangle className="h-4 w-4 text-amber-700" />
                  <span>
                    Обнаружены смысловые совпадения ({(duplicateWarningMatches || card.duplicateMatches).length})
                  </span>
                </div>
                {duplicateWarningMatches && card.queueStatus !== 'approved_for_database' && (
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => handleApprove(true)}
                    className="rounded border border-amber-500 bg-white px-3 py-1 text-xs font-semibold text-amber-950 hover:bg-amber-100"
                  >
                    Всё равно добавить в базу
                  </button>
                )}
              </div>
              {(duplicateWarningMatches || card.duplicateMatches).map((m) => (
                <div
                  key={`${m.matchScope}-${m.matchedId}`}
                  className="rounded border border-amber-200 bg-white px-3 py-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2 font-semibold text-slate-900">
                    <span>
                      [{m.matchScope === 'story_database' ? 'Основная база' : m.matchScope === 'current_batch' ? 'Текущая партия' : 'Очередь исследований'}]{' '}
                      <span className="font-mono">{m.matchedId}</span> · {m.matchedTitle}
                    </span>
                    <span className="font-mono text-amber-800 tabular-nums">{m.similarityScore}%</span>
                  </div>
                  <p className="mt-1 text-slate-600">{m.reason}</p>
                </div>
              ))}
            </div>
          )}

          {/* SECTION A: VERIFIED SOURCE FACTS (Separated from AI deductions) */}
          <section className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
              <h3 className="text-sm font-semibold text-slate-900">
                1. Факты из найденного зарубежного источника
              </h3>
              {card.sourceUrl && (
                <a
                  href={card.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:underline"
                >
                  Открыть оригинал <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div>
                <div className="text-slate-500">Площадка</div>
                <div className="font-medium text-slate-900">{card.sourceName}</div>
              </div>
              <div>
                <div className="text-slate-500">Автор (факт)</div>
                <div className="font-mono text-slate-800">{card.sourceAuthor || 'unknown'}</div>
              </div>
              <div>
                <div className="text-slate-500">Дата оригинала</div>
                <div className="font-mono text-slate-800">{card.sourceDate || 'unknown'}</div>
              </div>
              <div>
                <div className="text-slate-500">Надёжность ссылки</div>
                <div className="font-medium text-slate-800">{card.sourceReliability}</div>
              </div>
            </div>

            <div className="text-xs">
              <div className="text-slate-500">Заголовок источника ({card.originalLanguage})</div>
              <div className="mt-0.5 font-medium text-slate-900">{card.sourceTitle}</div>
            </div>

            <div className="text-xs">
              <div className="text-slate-500">Фактическая выжимка материала</div>
              <p className="mt-0.5 leading-relaxed text-slate-700">{card.sourceSummary}</p>
            </div>
          </section>

          {/* SECTION B: ANALYTICAL CONCLUSIONS */}
          <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h3 className="text-sm font-semibold text-slate-900">
                2. Аналитические выводы модели (редактируемо)
              </h3>
              <span className="font-mono text-xs text-slate-600 tabular-nums">
                Оригинальность переосмысления: {card.originalityAssessment}/100
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-600">Категория</label>
                <select
                  value={card.targetCategory}
                  onChange={(e) => setCard({ ...card, targetCategory: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600">Сюжетная механика</label>
                <select
                  value={card.storyMechanic}
                  onChange={(e) => setCard({ ...card, storyMechanic: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                >
                  {!PLOT_MECHANICS.includes(card.storyMechanic) && (
                    <option value={card.storyMechanic}>{card.storyMechanic}</option>
                  )}
                  {PLOT_MECHANICS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
              <div>
                <label className="block font-medium text-slate-600">Основная ситуация</label>
                <textarea
                  rows={2}
                  value={card.mainSituation}
                  onChange={(e) => setCard({ ...card, mainSituation: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-slate-900"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-600">Конфликт / эмоциональное событие</label>
                <textarea
                  rows={2}
                  value={card.mainConflict}
                  onChange={(e) => setCard({ ...card, mainConflict: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-slate-900"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-600">Позиция / мотивация стороны A</label>
                <textarea
                  rows={2}
                  value={card.positionsOfParticipants.sideA}
                  onChange={(e) =>
                    setCard({
                      ...card,
                      positionsOfParticipants: {
                        ...card.positionsOfParticipants,
                        sideA: e.target.value,
                      },
                    })
                  }
                  className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-slate-900"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-600">Позиция / реакция стороны B</label>
                <textarea
                  rows={2}
                  value={card.positionsOfParticipants.sideB}
                  onChange={(e) =>
                    setCard({
                      ...card,
                      positionsOfParticipants: {
                        ...card.positionsOfParticipants,
                        sideB: e.target.value,
                      },
                    })
                  }
                  className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-slate-900"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-600">Скрытое противоречие / ожидание</label>
                <input
                  type="text"
                  value={card.hiddenExpectation}
                  onChange={(e) => setCard({ ...card, hiddenExpectation: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-slate-900"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-600">Неожиданная деталь / возможный поворот</label>
                <input
                  type="text"
                  value={card.unexpectedDetail}
                  onChange={(e) => setCard({ ...card, unexpectedDetail: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-slate-900"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
              <div>
                <label className="block font-medium text-slate-600">Почему история интересна читателям</label>
                <textarea
                  rows={2}
                  value={card.readerReactionPotential}
                  onChange={(e) => setCard({ ...card, readerReactionPotential: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-slate-900"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-600">Заметки исследователя (researchNotes)</label>
                <textarea
                  rows={2}
                  value={card.researchNotes}
                  onChange={(e) => setCard({ ...card, researchNotes: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-slate-900"
                />
              </div>
            </div>
          </section>

          {/* SECTION C: GENERATED ORIGINAL IDEA FOR STORY DATABASE */}
          <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
              <h3 className="text-sm font-semibold text-slate-900">
                3. Переосмысленная оригинальная сюжетная основа (для STORY DATABASE)
              </h3>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={handleGenerateIdea}
                className="inline-flex items-center gap-1.5 rounded border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {card.generatedIdea ? 'Создать новую версию идеи' : 'Сгенерировать оригинальную идею'}
              </button>
            </div>

            {!card.generatedIdea ? (
              <p className="text-xs text-slate-500">
                Пока выполнен только анализ источника. Нажмите кнопку справа, чтобы создать самостоятельную русскую сюжетную основу без дословного перевода.
              </p>
            ) : (
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-medium text-slate-600">Название сюжета</label>
                  <input
                    type="text"
                    value={card.generatedIdea.title}
                    onChange={(e) => updateIdeaField('title', e.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm font-semibold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-600">Краткое описание</label>
                  <textarea
                    rows={2}
                    value={card.generatedIdea.shortDescription}
                    onChange={(e) => updateIdeaField('shortDescription', e.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-600">Полная сюжетная основа</label>
                  <textarea
                    rows={4}
                    value={card.generatedIdea.fullPlot}
                    onChange={(e) => updateIdeaField('fullPlot', e.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 leading-relaxed text-slate-900"
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block font-medium text-slate-600">Участники</label>
                    <input
                      type="text"
                      value={card.generatedIdea.participants}
                      onChange={(e) => updateIdeaField('participants', e.target.value)}
                      className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-600">Место действия</label>
                    <input
                      type="text"
                      value={card.generatedIdea.setting}
                      onChange={(e) => updateIdeaField('setting', e.target.value)}
                      className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-600">Возможный поворот</label>
                    <input
                      type="text"
                      value={card.generatedIdea.possibleTwist}
                      onChange={(e) => updateIdeaField('possibleTwist', e.target.value)}
                      className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-600">Основной триггерный вопрос</label>
                    <input
                      type="text"
                      value={card.generatedIdea.mainTriggerQuestion}
                      onChange={(e) => updateIdeaField('mainTriggerQuestion', e.target.value)}
                      className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-slate-900"
                    />
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* SECTION D: QUALITY SCORE BREAKDOWN (0-100) */}
          <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
              <h3 className="text-sm font-semibold text-slate-900">
                4. Оценка качества исследования и идеи
              </h3>
              <div className="flex items-center gap-2 text-xs">
                <span className="font-semibold text-slate-900">{qb.tierLabel}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-base font-bold text-indigo-800 tabular-nums">
                  {qb.overall}/100
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs sm:grid-cols-4">
              <MetricCell label="Оригинальность" value={qb.originality} />
              <MetricCell label="Жизненность" value={qb.realism} />
              <MetricCell label="Конкретность" value={qb.specificity} />
              <MetricCell label="Эмоц. выразительность" value={qb.emotionalExpressiveness} />
              <MetricCell label="Интерес для читателя" value={qb.readerInterest} />
              <MetricCell label="Разнообразие" value={qb.diversity} />
              <MetricCell label="Потенциал обсуждения" value={qb.discussionPotential} />
              <MetricCell label="Качество механики" value={qb.mechanicQuality} />
              {card.collection === 'debate' ? (
                <>
                  <MetricCell label="Неоднозначность" value={qb.ambiguity ?? 75} />
                  <MetricCell label="Аргументы обеих сторон" value={qb.bothSidesArgumentation ?? 75} />
                  <MetricCell label="Потенциал дискуссии" value={qb.debatePotential ?? 75} />
                </>
              ) : (
                <>
                  <MetricCell label="Теплота" value={qb.warmth ?? 76} />
                  <MetricCell label="Естественность" value={qb.naturalness ?? 76} />
                  <MetricCell label="Сила детали" value={qb.emotionalDetailPower ?? 76} />
                  <MetricCell label="Узнаваемость" value={qb.relatability ?? 76} />
                  <MetricCell label="Без приторности" value={qb.nonSaccharine ?? 76} />
                </>
              )}
            </div>
            <p className="text-xs leading-relaxed text-slate-600">{qb.explanation}</p>
          </section>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={handleReanalyze}
              className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busyAction === 'analyze' ? 'animate-spin' : ''}`} />
              Повторно проанализировать
            </button>
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={handleCheckDuplicates}
              className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Проверить дубли
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {card.queueStatus !== 'approved_for_database' && card.queueStatus !== 'rejected' && (
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={handleReject}
                className="rounded border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Отклонить
              </button>
            )}
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={handleSaveChanges}
              className="rounded border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50"
            >
              {busyAction === 'save' ? 'Сохранение...' : 'Сохранить правки'}
            </button>
            {card.queueStatus !== 'approved_for_database' && (
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => handleApprove(false)}
                className="inline-flex items-center gap-1.5 rounded bg-indigo-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-800 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                {busyAction === 'approve' ? 'Добавление...' : 'Одобрить в STORY DATABASE'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const MetricCell: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5">
    <span className="truncate pr-2 text-slate-600">{label}</span>
    <span className="font-mono font-semibold text-slate-900 tabular-nums">{value}</span>
  </div>
);
