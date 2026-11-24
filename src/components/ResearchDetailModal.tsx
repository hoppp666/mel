import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { ResearchResult, SimilarityMatch } from '../shared/types.js';
import { ApiError } from '../services/api.js';

interface ResearchDetailModalProps {
  result: ResearchResult;
  onClose: () => void;
  onPatchResult: (id: string, updates: Partial<ResearchResult>) => Promise<void>;
  onReanalyze: (id: string) => Promise<void>;
  onGenerateIdea: (id: string) => Promise<void>;
  onCheckDuplicate: (id: string) => Promise<void>;
  onApproveToDatabase: (id: string, forceApprove: boolean) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}

export const ResearchDetailModal: React.FC<ResearchDetailModalProps> = ({
  result,
  onClose,
  onPatchResult,
  onReanalyze,
  onGenerateIdea,
  onCheckDuplicate,
  onApproveToDatabase,
  onReject,
}) => {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [conflictMatches, setConflictMatches] = useState<SimilarityMatch[]>(
    result.similarityMatches || []
  );

  // Editable model insights
  const [mainSituation, setMainSituation] = useState(result.mainSituation || '');
  const [mainConflict, setMainConflict] = useState(result.mainConflict || '');
  const [emotionalMechanism, setEmotionalMechanism] = useState(result.emotionalMechanism || '');
  const [hiddenExpectation, setHiddenExpectation] = useState(result.hiddenExpectation || '');
  const [unexpectedDetail, setUnexpectedDetail] = useState(result.unexpectedDetail || '');
  const [researchNotes, setResearchNotes] = useState(result.researchNotes || '');

  // Editable draft title/fullPlot if present
  const [draftTitle, setDraftTitle] = useState(result.generatedPlot?.title || '');
  const [draftFullPlot, setDraftFullPlot] = useState(result.generatedPlot?.fullPlot || '');
  const [draftQuestion, setDraftQuestion] = useState(
    result.generatedPlot?.mainTriggerQuestion || ''
  );

  const runAction = async (key: string, fn: () => Promise<void>) => {
    setBusyAction(key);
    setErrorMsg(null);
    try {
      await fn();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.matches) {
        setConflictMatches(err.matches);
        setErrorMsg(err.message);
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Ошибка выполнения операции');
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveEdits = () =>
    runAction('save', async () => {
      const updates: Partial<ResearchResult> = {
        mainSituation,
        mainConflict,
        emotionalMechanism,
        hiddenExpectation,
        unexpectedDetail,
        researchNotes,
      };
      if (result.generatedPlot) {
        updates.generatedPlot = {
          ...result.generatedPlot,
          title: draftTitle,
          fullPlot: draftFullPlot,
          mainTriggerQuestion: draftQuestion,
        };
      }
      await onPatchResult(result.researchId, updates);
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4">
          <div className="min-w-0 pr-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span className="font-mono font-semibold text-zinc-800">{result.researchId}</span>
              <span>·</span>
              <span>{result.sourceName}</span>
              <span>·</span>
              <span>{result.collection === 'debate' ? 'Споры' : 'Романтика'}</span>
              <span>·</span>
              <span className="font-mono">{result.analysisStatus}</span>
              <span>·</span>
              <span className="font-mono">{result.queueStatus}</span>
            </div>
            <h3 className="mt-0.5 truncate text-lg font-semibold text-zinc-900">
              {result.generatedPlot?.title || result.sourceTitle}
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {errorMsg && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
              {errorMsg}
            </div>
          )}

          {/* Block 1: Verified source facts */}
          <div className="rounded-md border border-stone-200 bg-stone-50/70 p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold uppercase tracking-wider text-zinc-500">
                Блок 1 · Проверенные факты внешнего источника
              </span>
              <span className="font-mono text-zinc-600">
                Достоверность: {result.sourceReliability} · Дата: {result.sourceDate || '—'}
              </span>
            </div>
            <div className="text-sm font-medium text-zinc-900">{result.sourceTitle}</div>
            <p className="text-xs leading-relaxed text-zinc-700">
              {result.sourceSummary || result.sourceExcerpt || 'Фрагмент источника'}
            </p>
            {result.sourceUrl && (
              <div className="flex items-center gap-1.5 pt-1 text-xs font-mono text-zinc-600 break-all">
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                <span>{result.sourceUrl}</span>
              </div>
            )}
          </div>

          {/* Block 2: Editable analytical conclusions */}
          <div className="rounded-md border border-stone-200 bg-white p-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Блок 2 · Аналитический разбор и психологический механизм (редактируется)
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="block text-xs font-medium text-zinc-700">
                Суть ситуации (mainSituation)
                <textarea
                  rows={2}
                  value={mainSituation}
                  onChange={(e) => setMainSituation(e.target.value)}
                  className="mt-1 w-full rounded border border-stone-200 px-2.5 py-1.5 text-xs text-zinc-900"
                />
              </label>
              <label className="block text-xs font-medium text-zinc-700">
                Основной конфликт / дилемма
                <textarea
                  rows={2}
                  value={mainConflict}
                  onChange={(e) => setMainConflict(e.target.value)}
                  className="mt-1 w-full rounded border border-stone-200 px-2.5 py-1.5 text-xs text-zinc-900"
                />
              </label>
              <label className="block text-xs font-medium text-zinc-700">
                Эмоциональный механизм
                <textarea
                  rows={2}
                  value={emotionalMechanism}
                  onChange={(e) => setEmotionalMechanism(e.target.value)}
                  className="mt-1 w-full rounded border border-stone-200 px-2.5 py-1.5 text-xs text-zinc-900"
                />
              </label>
              <label className="block text-xs font-medium text-zinc-700">
                Скрытое ожидание
                <textarea
                  rows={2}
                  value={hiddenExpectation}
                  onChange={(e) => setHiddenExpectation(e.target.value)}
                  className="mt-1 w-full rounded border border-stone-200 px-2.5 py-1.5 text-xs text-zinc-900"
                />
              </label>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="block text-xs font-medium text-zinc-700">
                Неожиданная деталь (unexpectedDetail)
                <input
                  type="text"
                  value={unexpectedDetail}
                  onChange={(e) => setUnexpectedDetail(e.target.value)}
                  className="mt-1 w-full rounded border border-stone-200 px-2.5 py-1.5 text-xs text-zinc-900"
                />
              </label>
              <label className="block text-xs font-medium text-zinc-700">
                Редакторские заметки (researchNotes)
                <input
                  type="text"
                  value={researchNotes}
                  onChange={(e) => setResearchNotes(e.target.value)}
                  className="mt-1 w-full rounded border border-stone-200 px-2.5 py-1.5 text-xs text-zinc-900"
                />
              </label>
            </div>
          </div>

          {/* Block 3: Generated Russian plot draft */}
          <div className="rounded-md border border-stone-200 bg-white p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Блок 3 · Заготовка сюжетной основы для базы MELO_LOVE
              </span>
              {!result.generatedPlot && (
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => runAction('idea', () => onGenerateIdea(result.researchId))}
                  className="inline-flex items-center gap-1 rounded bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
                >
                  {busyAction === 'idea' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Сформировать заготовку
                </button>
              )}
            </div>

            {result.generatedPlot ? (
              <div className="space-y-3">
                <div className="text-xs text-zinc-500">
                  Категория: <span className="font-medium text-zinc-800">{result.generatedPlot.category}</span>{' '}
                  / {result.generatedPlot.subcategory} · Механика: {result.generatedPlot.plotMechanic}
                </div>
                <label className="block text-xs font-medium text-zinc-700">
                  Название заготовки
                  <input
                    type="text"
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    className="mt-1 w-full rounded border border-stone-200 px-3 py-1.5 text-sm font-medium text-zinc-900"
                  />
                </label>
                <label className="block text-xs font-medium text-zinc-700">
                  Сюжетная основа (fullPlot)
                  <textarea
                    rows={4}
                    value={draftFullPlot}
                    onChange={(e) => setDraftFullPlot(e.target.value)}
                    className="mt-1 w-full rounded border border-stone-200 px-3 py-1.5 text-xs leading-relaxed text-zinc-900"
                  />
                </label>
                <label className="block text-xs font-medium text-zinc-700">
                  Главный триггер-вопрос
                  <input
                    type="text"
                    value={draftQuestion}
                    onChange={(e) => setDraftQuestion(e.target.value)}
                    className="mt-1 w-full rounded border border-stone-200 px-3 py-1.5 text-xs text-zinc-900"
                  />
                </label>
              </div>
            ) : (
              <p className="text-xs text-zinc-500">
                Заготовка ещё не сгенерирована (режим «Только анализ» или требуется повторный анализ).
              </p>
            )}
          </div>

          {/* Block 4: 100-point rubric */}
          {result.quality && (
            <div className="rounded-md border border-stone-200 bg-stone-50 p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold uppercase tracking-wider text-zinc-500">
                  Блок 4 · Оценка потенциала идеи · {result.quality.tierLabel}
                </span>
                <span className="font-mono text-base font-semibold text-zinc-900 tabular-nums">
                  {result.quality.overall}/100
                </span>
              </div>
              <p className="text-xs text-zinc-600">{result.quality.explanation}</p>
              <div className="grid grid-cols-2 gap-2 pt-1 text-xs sm:grid-cols-4">
                {Object.entries(result.quality.breakdown).map(([k, val]) => (
                  <div key={k} className="rounded border border-stone-200 bg-white px-2.5 py-1.5">
                    <div className="truncate text-[11px] text-zinc-500">{k}</div>
                    <div className="font-mono font-semibold text-zinc-900 tabular-nums">{val}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Block 5: Duplicate check & 409 force-approve */}
          <div className="rounded-md border border-stone-200 bg-white p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Блок 5 · Трёхконтурная проверка дублей (URL + База + Очередь)
              </span>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => runAction('dup', () => onCheckDuplicate(result.researchId))}
                className="rounded border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-stone-50 cursor-pointer"
              >
                {busyAction === 'dup' ? 'Проверяем...' : 'Проверить дубли сейчас'}
              </button>
            </div>

            {conflictMatches.length === 0 ? (
              <p className="text-xs text-teal-800">
                Совпадений с основной базой сюжетов и очередью исследований не найдено.
              </p>
            ) : (
              <div className="space-y-2 rounded border border-amber-200 bg-amber-50/70 p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-950">
                  <AlertTriangle className="h-4 w-4 text-amber-700" />
                  Найдены пересечения ({conflictMatches.length})
                </div>
                {conflictMatches.map((m) => (
                  <div key={m.storyId} className="text-xs text-zinc-800">
                    <span className="font-mono font-semibold">{m.storyId}</span> · {m.title} (
                    <span className="font-mono tabular-nums">{m.score}%</span>) — {m.reason}
                  </div>
                ))}
                {!result.approvedStoryId && result.generatedPlot && (
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => runAction('force', () => onApproveToDatabase(result.researchId, true))}
                    className="mt-1 inline-flex items-center gap-1.5 rounded border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-800 hover:bg-rose-50 cursor-pointer"
                  >
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Подтвердить перенос принудительно (forceApprove)
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 bg-stone-50 px-6 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => runAction('reanalyze', () => onReanalyze(result.researchId))}
              className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-stone-100 cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busyAction === 'reanalyze' ? 'animate-spin' : ''}`} />
              Переанализировать
            </button>
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={handleSaveEdits}
              className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-stone-100 cursor-pointer"
            >
              {busyAction === 'save' ? 'Сохраняем...' : 'Сохранить правки'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {result.queueStatus !== 'rejected' && !result.approvedStoryId && (
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() =>
                  runAction('reject', async () => {
                    await onReject(result.researchId);
                    onClose();
                  })
                }
                className="inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-800 hover:bg-rose-50 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Отклонить
              </button>
            )}

            {result.approvedStoryId ? (
              <span className="font-mono text-xs font-semibold text-teal-800">
                Перенесено в базу как {result.approvedStoryId}
              </span>
            ) : (
              <button
                type="button"
                disabled={busyAction !== null || !result.generatedPlot}
                onClick={() =>
                  runAction('approve', async () => {
                    await onApproveToDatabase(result.researchId, false);
                    onClose();
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
              >
                <Check className="h-3.5 w-3.5" />
                Одобрить и перенести в базу
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
