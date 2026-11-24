import React, { useState } from 'react';
import { AlertTriangle, Check, Edit3, Loader2, Sparkles, Trash2, X } from 'lucide-react';
import { getCategoriesForCollection } from '../shared/categories.ts';
import type { CollectionType, StoryPlot } from '../shared/types.ts';
import * as api from '../services/api.ts';
import type { StagedBatch } from '../services/api.ts';

interface BatchModalProps {
  stagedBatch: StagedBatch | null;
  defaultCollection: CollectionType;
  defaultBatchSize: number;
  customCategories: { debate: string[]; romantic: string[] };
  onClose: () => void;
  onBatchUpdated: (staged: StagedBatch | null) => void;
  onCommitted: () => Promise<void>;
}

export const BatchModal: React.FC<BatchModalProps> = ({
  stagedBatch,
  defaultCollection,
  defaultBatchSize,
  customCategories,
  onClose,
  onBatchUpdated,
  onCommitted,
}) => {
  const [collection, setCollection] = useState<CollectionType>(defaultCollection);
  const [targetCategory, setTargetCategory] = useState<string>('ALL_BALANCED');
  const [batchSize, setBatchSize] = useState<number>(defaultBatchSize || 25);
  const [researchMode, setResearchMode] = useState<'original' | 'external_search'>('original');
  const [generating, setGenerating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editShort, setEditShort] = useState('');
  const [editFull, setEditFull] = useState('');
  const [decisions, setDecisions] = useState<Record<string, 'accept' | 'reject' | 'revision'>>({});

  const categories = getCategoriesForCollection(collection, customCategories);

  const handleGenerate = async () => {
    setErrorMsg(null);
    setGenerating(true);
    try {
      const res = await api.generateBatch({
        collection,
        targetCategory,
        batchSize,
        researchMode,
      });
      setDecisions({});
      onBatchUpdated(res.stagedBatch);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const setCandidateDecision = (id: string, status: 'accept' | 'reject' | 'revision') => {
    setDecisions((prev) => ({ ...prev, [id]: status }));
  };

  const acceptAllClean = () => {
    if (!stagedBatch) return;
    const next: Record<string, 'accept' | 'reject' | 'revision'> = { ...decisions };
    for (const c of stagedBatch.candidates) {
      if (!c.duplicateFlag && c.verificationStatus !== 'needs_revision') {
        next[c.id] = 'accept';
      }
    }
    setDecisions(next);
  };

  const startInlineEdit = (c: StoryPlot) => {
    setEditingId(c.id);
    setEditTitle(c.title);
    setEditShort(c.shortDescription);
    setEditFull(c.fullPlot);
  };

  const saveInlineEdit = async (candidateId: string) => {
    setErrorMsg(null);
    try {
      const res = await api.updateStagedCandidate(candidateId, {
        title: editTitle,
        shortDescription: editShort,
        fullPlot: editFull,
      });
      setEditingId(null);
      onBatchUpdated(res.stagedBatch);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleCommit = async () => {
    if (!stagedBatch) return;
    setCommitting(true);
    setErrorMsg(null);
    try {
      const acceptedIds: string[] = [];
      const rejectedIds: string[] = [];
      for (const c of stagedBatch.candidates) {
        const d = decisions[c.id];
        if (d === 'accept' || d === 'revision') {
          if (d === 'revision') {
            await api.updateStagedCandidate(c.id, { verificationStatus: 'needs_revision' });
          } else {
            await api.updateStagedCandidate(c.id, { verificationStatus: 'approved' });
          }
          acceptedIds.push(c.id);
        } else if (d === 'reject') {
          rejectedIds.push(c.id);
        }
      }

      if (acceptedIds.length === 0 && rejectedIds.length === 0) {
        setErrorMsg('Отметьте хотя бы один сюжет как «Принять» или «Отклонить» перед сохранением.');
        setCommitting(false);
        return;
      }

      const res = await api.commitStagedBatch({
        acceptedIds,
        rejectedIds,
        forceIncludeDuplicates: true,
      });
      onBatchUpdated(res.stagedBatch);
      await onCommitted();
      if (!res.stagedBatch) {
        onClose();
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setCommitting(false);
    }
  };

  const handleDiscardBatch = async () => {
    await api.discardStagedBatch();
    onBatchUpdated(null);
  };

  const acceptedCount = Object.values(decisions).filter((v) => v === 'accept').length;
  const rejectedCount = Object.values(decisions).filter((v) => v === 'reject').length;
  const revisionCount = Object.values(decisions).filter((v) => v === 'revision').length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 md:p-6"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div>
            <div className="text-xs text-slate-500">
              {stagedBatch
                ? `Партия #${stagedBatch.batchNumber} · ${
                    stagedBatch.collection === 'debate'
                      ? 'Кто здесь прав?'
                      : 'Романтические истории'
                  }`
                : 'Пакетное пополнение библиотеки (шаг 25–50 сюжетов)'}
            </div>
            <h2 className="mt-0.5 text-lg font-semibold text-slate-900">
              {stagedBatch
                ? `Проверка партии: ${stagedBatch.candidates.length} сюжетов`
                : 'Создать следующую партию сюжетов'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {errorMsg && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {errorMsg}
            </div>
          )}

          {!stagedBatch ? (
            /* Step 1: Configure & Launch */
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Целевая коллекция
                  </label>
                  <select
                    value={collection}
                    onChange={(e) => {
                      const next = e.target.value as CollectionType;
                      setCollection(next);
                      setTargetCategory('ALL_BALANCED');
                    }}
                    className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
                  >
                    <option value="debate">Коллекция A — «Кто здесь прав?» (цель 1500)</option>
                    <option value="romantic">
                      Коллекция B — «Романтические истории» (цель 1500)
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Категория для партии
                  </label>
                  <select
                    value={targetCategory}
                    onChange={(e) => setTargetCategory(e.target.value)}
                    className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
                  >
                    <option value="ALL_BALANCED">
                      Сбалансированный подбор (приоритет пустым категориям)
                    </option>
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Размер партии (рекомендовано 25–50)
                  </label>
                  <div className="mt-1.5 grid grid-cols-4 gap-2">
                    {[10, 25, 35, 50].map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => setBatchSize(size)}
                        className={`rounded-md border px-3 py-2 font-mono text-sm font-medium tabular-nums transition-colors ${
                          batchSize === size
                            ? 'border-indigo-700 bg-indigo-50 text-indigo-900'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Режим поиска идей
                  </label>
                  <select
                    value={researchMode}
                    onChange={(e) =>
                      setResearchMode(e.target.value as 'original' | 'external_search')
                    }
                    className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
                  >
                    <option value="original">
                      Оригинальные жизненные сюжеты (с учётом текущей базы)
                    </option>
                    <option value="external_search">
                      Исследование зарубежных источников (Google Search + адаптация)
                    </option>
                  </select>
                </div>
              </div>

              <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-600 space-y-1.5">
                <div className="font-semibold text-slate-800">Что произойдёт после запуска:</div>
                <p>
                  1. Сервер передаст модели перечень уже существующих сюжетов вашей базы, чтобы
                  исключить смысловые повторы и перелицовку одних и тех же сценариев.
                </p>
                <p>
                  2. Каждая сгенерированная запись пройдёт проверку структуры (26 полей), оценку
                  качества (0–100) и автоматический смысловой поиск дублей.
                </p>
                <p>
                  3. Партия откроется в окне редакторской проверки: потенциальные дубли не
                  попадут в базу автоматически — вы сами решите, что принять, доработать или
                  отклонить.
                </p>
              </div>
            </div>
          ) : (
            /* Step 2: Review Staged Candidates */
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-xs">
                <div className="flex flex-wrap items-center gap-3 text-slate-700">
                  <span>
                    Всего в партии:{' '}
                    <strong className="font-mono tabular-nums">
                      {stagedBatch.candidates.length}
                    </strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Дублей/пересечений:{' '}
                    <strong className="font-mono tabular-nums text-amber-800">
                      {stagedBatch.candidates.filter((c) => c.duplicateFlag).length}
                    </strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Отмечено: принято{' '}
                    <strong className="font-mono tabular-nums text-emerald-800">
                      {acceptedCount}
                    </strong>
                    , на доработку{' '}
                    <strong className="font-mono tabular-nums text-amber-800">
                      {revisionCount}
                    </strong>
                    , отклонено{' '}
                    <strong className="font-mono tabular-nums text-red-700">{rejectedCount}</strong>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={acceptAllClean}
                    className="rounded border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-800 hover:bg-slate-100 whitespace-nowrap"
                  >
                    Отметить все чистые к принятию
                  </button>
                  <button
                    type="button"
                    onClick={handleDiscardBatch}
                    className="rounded border border-red-200 bg-white px-3 py-1.5 font-medium text-red-700 hover:bg-red-50 whitespace-nowrap"
                  >
                    Сбросить партию
                  </button>
                </div>
              </div>

              {stagedBatch.researchMode === 'external_search' && (
                <div className="rounded-md border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-600">
                  {stagedBatch.usedSearchGrounding
                    ? `Использован живой поиск Google Search: найдено ${stagedBatch.groundingUrls.length} проверенных ссылок.`
                    : 'Живой поиск не вернул подтверждённых URL — сюжеты созданы как оригинальные без выдуманных ссылок.'}
                </div>
              )}

              <div className="space-y-3">
                {stagedBatch.candidates.map((cand) => {
                  const decision = decisions[cand.id];
                  const isEditingThis = editingId === cand.id;
                  return (
                    <div
                      key={cand.id}
                      className={`rounded-md border p-4 transition-colors ${
                        decision === 'accept'
                          ? 'border-emerald-300 bg-emerald-50/30'
                          : decision === 'reject'
                            ? 'border-red-200 bg-red-50/30 opacity-75'
                            : cand.duplicateFlag
                              ? 'border-amber-300 bg-amber-50/30'
                              : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <span className="font-mono font-medium text-slate-700">{cand.id}</span>
                            <span aria-hidden="true">·</span>
                            <span>{cand.category}</span>
                            <span aria-hidden="true">·</span>
                            <span>{cand.plotMechanic}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono font-semibold text-slate-900 tabular-nums">
                              Качество: {cand.quality.overall}/100
                            </span>
                          </div>

                          {isEditingThis ? (
                            <div className="mt-2 space-y-2">
                              <input
                                type="text"
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm font-medium"
                              />
                              <textarea
                                rows={2}
                                value={editShort}
                                onChange={(e) => setEditShort(e.target.value)}
                                className="w-full rounded border border-slate-300 px-3 py-1.5 text-xs"
                              />
                              <textarea
                                rows={3}
                                value={editFull}
                                onChange={(e) => setEditFull(e.target.value)}
                                className="w-full rounded border border-slate-300 px-3 py-1.5 text-xs"
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => saveInlineEdit(cand.id)}
                                  className="rounded bg-indigo-700 px-3 py-1 text-xs font-medium text-white"
                                >
                                  Сохранить правку и перепроверить дубли
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingId(null)}
                                  className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700"
                                >
                                  Отмена
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <h3 className="mt-1 text-sm font-semibold text-slate-900">
                                {cand.title}
                              </h3>
                              <p className="mt-1 text-xs leading-relaxed text-slate-700">
                                {cand.shortDescription}
                              </p>
                              <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                                {cand.fullPlot}
                              </p>
                              <div className="mt-2 grid grid-cols-1 gap-2 border-t border-slate-100 pt-2 text-xs text-slate-600 sm:grid-cols-2">
                                <div>
                                  <span className="font-medium text-slate-700">Суть: </span>
                                  {cand.coreConflictOrAction}
                                </div>
                                <div>
                                  <span className="font-medium text-slate-700">Вопрос: </span>
                                  {cand.mainTriggerQuestion}
                                </div>
                              </div>
                              <div className="mt-1.5 text-[11px] text-slate-500">
                                Оценка: {cand.quality.editorialNote}
                              </div>
                            </>
                          )}
                        </div>

                        {/* Action buttons */}
                        {!isEditingThis && (
                          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => setCandidateDecision(cand.id, 'accept')}
                              className={`inline-flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap ${
                                decision === 'accept'
                                  ? 'border-emerald-700 bg-emerald-700 text-white'
                                  : 'border-slate-300 bg-white text-slate-700 hover:bg-emerald-50'
                              }`}
                            >
                              <Check className="h-3.5 w-3.5" />
                              Принять
                            </button>
                            <button
                              type="button"
                              onClick={() => setCandidateDecision(cand.id, 'revision')}
                              className={`rounded border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap ${
                                decision === 'revision'
                                  ? 'border-amber-600 bg-amber-600 text-white'
                                  : 'border-slate-300 bg-white text-slate-700 hover:bg-amber-50'
                              }`}
                            >
                              Доработать
                            </button>
                            <button
                              type="button"
                              onClick={() => startInlineEdit(cand)}
                              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                              Править
                            </button>
                            <button
                              type="button"
                              onClick={() => setCandidateDecision(cand.id, 'reject')}
                              className={`inline-flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap ${
                                decision === 'reject'
                                  ? 'border-red-700 bg-red-700 text-white'
                                  : 'border-slate-300 bg-white text-slate-700 hover:bg-red-50'
                              }`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Отклонить
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Duplicate warning */}
                      {cand.similarityMatches && cand.similarityMatches.length > 0 && (
                        <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
                          <div className="flex items-center gap-1.5 font-semibold">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
                            <span>
                              Похожий сюжет уже есть в базе (не сохраняется автоматически):
                            </span>
                          </div>
                          {cand.similarityMatches.map((m) => (
                            <div key={m.matchedId} className="mt-1.5 pl-5">
                              <span className="font-mono font-semibold">{m.matchedId}</span> — «
                              {m.matchedTitle}» ({m.similarityScore}%). {m.reason}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            Свернуть окно
          </button>

          {!stagedBatch ? (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="inline-flex items-center gap-2 rounded-md bg-indigo-700 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-800 disabled:opacity-60 whitespace-nowrap"
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Генерация партии ({batchSize} сюжетов)...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Запустить создание партии ({batchSize})
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCommit}
              disabled={committing}
              className="inline-flex items-center gap-2 rounded-md bg-indigo-700 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-800 disabled:opacity-60 whitespace-nowrap"
            >
              {committing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Сохранение в базу...
                </>
              ) : (
                'Сохранить отмеченные решения в базу'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
