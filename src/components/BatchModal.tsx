import React, { useEffect, useState } from 'react';
import { Check, Loader2, RotateCcw, Sparkles, Trash2, X } from 'lucide-react';
import {
  CollectionType,
  CustomCategory,
  PendingBatch,
  StagedStoryCandidate,
} from '../shared/types.js';
import { getCategoriesForCollection } from '../shared/categories.js';
import { fetchIntegrationStatus } from '../services/api.js';

interface BatchModalProps {
  pendingBatch: PendingBatch | null;
  defaultBatchSize: 10 | 25 | 35 | 50;
  customCategories: CustomCategory[];
  onClose: () => void;
  onGenerateBatch: (payload: {
    collection: CollectionType;
    categoryFocus: string;
    count: number;
    searchMode: 'original' | 'web_search';
  }) => Promise<void>;
  onUpdateCandidate: (
    candidateId: string,
    updates: Partial<StagedStoryCandidate>
  ) => Promise<void>;
  onCommitBatch: () => Promise<void>;
  onDiscardBatch: () => Promise<void>;
}

export const BatchModal: React.FC<BatchModalProps> = ({
  pendingBatch,
  defaultBatchSize,
  customCategories,
  onClose,
  onGenerateBatch,
  onUpdateCandidate,
  onCommitBatch,
  onDiscardBatch,
}) => {
  const [collection, setCollection] = useState<CollectionType>('debate');
  const [categoryFocus, setCategoryFocus] = useState('balanced');
  const [count, setCount] = useState<number>(defaultBatchSize || 10);
  const [searchMode, setSearchMode] = useState<'original' | 'web_search'>('original');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [aiConfigured, setAiConfigured] = useState<boolean>(true);

  useEffect(() => {
    fetchIntegrationStatus()
      .then((s) => setAiConfigured(s.hasGeminiConfigured))
      .catch(() => {});
  }, []);

  const categories = Array.from(
    new Set([
      ...getCategoriesForCollection(collection),
      ...customCategories.filter((c) => c.collection === collection).map((c) => c.name),
    ])
  );

  const handleStartGenerate = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      await onGenerateBatch({ collection, categoryFocus, count, searchMode });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Не удалось сгенерировать партию');
    } finally {
      setBusy(false);
    }
  };

  const handleDecision = async (
    candidateId: string,
    decision: StagedStoryCandidate['decision']
  ) => {
    setErrorMsg(null);
    try {
      await onUpdateCandidate(candidateId, { decision });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка обновления кандидата');
    }
  };

  const handleCommit = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      await onCommitBatch();
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка сохранения партии');
    } finally {
      setBusy(false);
    }
  };

  const handleDiscard = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      await onDiscardBatch();
      setConfirmDiscard(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка сброса партии');
    } finally {
      setBusy(false);
    }
  };

  const approvedCount =
    pendingBatch?.candidates.filter((c) => c.decision === 'approved').length ?? 0;
  const revisionCount =
    pendingBatch?.candidates.filter((c) => c.decision === 'needs_revision').length ?? 0;
  const rejectedCount =
    pendingBatch?.candidates.filter((c) => c.decision === 'rejected').length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              {pendingBatch ? `Приёмка партии #${pendingBatch.batchNumber}` : 'Генератор партий сюжетов'}
            </div>
            <h3 className="mt-0.5 text-lg font-semibold text-zinc-900">
              {pendingBatch
                ? `${
                    pendingBatch.collection === 'debate' ? 'Споры и мнения' : 'Романтические истории'
                  } · ${pendingBatch.candidates.length} кандидатов`
                : 'Создать следующую партию сюжетов'}
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
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {errorMsg && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
              {errorMsg}
            </div>
          )}

          {!pendingBatch && !aiConfigured && (
            <div className="rounded-md border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-zinc-700">
              <span className="font-medium text-zinc-900">
                AI-провайдер (Gemini / GigaChat / Z.ai) пока не подключён:
              </span>{' '}
              для AI-генерации партии требуется серверный ключ <code>GEMINI_API_KEY</code>,
              резервный <code>GIGACHAT_AUTH_KEY</code> или <code>ZAI_API_KEY</code>. Ручное
              добавление сюжетов, импорт JSON, проверка уникальности и все остальные разделы
              работают без ключа.
            </div>
          )}

          {!pendingBatch ? (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="block text-xs font-medium text-zinc-700">
                  Раздел базы
                  <select
                    value={collection}
                    onChange={(e) => {
                      setCollection(e.target.value as CollectionType);
                      setCategoryFocus('balanced');
                    }}
                    className="mt-1.5 w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-zinc-900"
                  >
                    <option value="debate">Раздел 1 · Споры и мнения</option>
                    <option value="romantic">Раздел 2 · Романтические истории</option>
                  </select>
                </label>

                <label className="block text-xs font-medium text-zinc-700">
                  Размер партии
                  <select
                    value={count}
                    onChange={(e) => setCount(Number(e.target.value))}
                    className="mt-1.5 w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm font-mono text-zinc-900"
                  >
                    <option value={10}>10 сюжетов (быстрая проверка)</option>
                    <option value={25}>25 сюжетов (стандартная партия)</option>
                    <option value={35}>35 сюжетов (расширенная)</option>
                    <option value={50}>50 сюжетов (максимальная)</option>
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="block text-xs font-medium text-zinc-700">
                  Категория / распределение
                  <select
                    value={categoryFocus}
                    onChange={(e) => setCategoryFocus(e.target.value)}
                    className="mt-1.5 w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-zinc-900"
                  >
                    <option value="balanced">Равномерно по редким категориям базы</option>
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>
                        Фокус: {cat}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-xs font-medium text-zinc-700">
                  Режим генерации
                  <select
                    value={searchMode}
                    onChange={(e) =>
                      setSearchMode(e.target.value === 'web_search' ? 'web_search' : 'original')
                    }
                    className="mt-1.5 w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-zinc-900"
                  >
                    <option value="original">Оригинальные сюжетные основы (строгий JSON)</option>
                    <option value="web_search">С поиском реальных зарубежных сюжетов (Grounding)</option>
                  </select>
                </label>
              </div>

              <div className="rounded-md border border-stone-200 bg-stone-50 p-4 text-xs leading-relaxed text-zinc-600">
                Перед сохранением в основную базу каждый сгенерированный кандидат автоматически
                проверяется на семантические и URL-дубли среди активных сюжетов и поступает в
                буферную очередь приёмки. Ни одна запись не попадёт в базу без вашего решения.
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-stone-200 bg-stone-50 px-4 py-2.5 text-xs text-zinc-700">
                <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums">
                  <span>Подтверждено: {approvedCount}</span>
                  <span>·</span>
                  <span>На доработку: {revisionCount}</span>
                  <span>·</span>
                  <span>Отклонено: {rejectedCount}</span>
                  <span>·</span>
                  <span>
                    Ожидают:{' '}
                    {pendingBatch.candidates.length - approvedCount - revisionCount - rejectedCount}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    for (const c of pendingBatch.candidates) {
                      if (!c.duplicateFlag && c.decision === 'pending') {
                        await onUpdateCandidate(c.candidateId, { decision: 'approved' });
                      }
                    }
                  }}
                  className="font-medium text-teal-800 hover:text-teal-950 cursor-pointer"
                >
                  Одобрить всех без дублей
                </button>
              </div>

              <div className="divide-y divide-stone-200 rounded-md border border-stone-200">
                {pendingBatch.candidates.map((cand, index) => (
                  <div key={cand.candidateId} className="p-4 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                          <span className="font-mono font-semibold text-zinc-800 tabular-nums">
                            #{index + 1}
                          </span>
                          <span>·</span>
                          <span>{cand.category}</span>
                          <span>·</span>
                          <span className="font-mono tabular-nums">
                            Качество: {cand.quality?.overall ?? 0}/100
                          </span>
                          {cand.duplicateFlag && (
                            <>
                              <span>·</span>
                              <span className="font-medium text-rose-700">
                                Совпадение с {cand.similarityMatches[0]?.storyId} (
                                {cand.similarityMatches[0]?.score}%)
                              </span>
                            </>
                          )}
                        </div>
                        {editingId === cand.candidateId ? (
                          <div className="space-y-2 pt-1">
                            <input
                              type="text"
                              defaultValue={cand.title}
                              onBlur={(e) =>
                                onUpdateCandidate(cand.candidateId, { title: e.target.value })
                              }
                              className="w-full rounded border border-stone-300 px-2.5 py-1.5 text-sm font-medium text-zinc-900"
                            />
                            <textarea
                              rows={3}
                              defaultValue={cand.fullPlot}
                              onBlur={(e) =>
                                onUpdateCandidate(cand.candidateId, { fullPlot: e.target.value })
                              }
                              className="w-full rounded border border-stone-300 px-2.5 py-1.5 text-xs text-zinc-800"
                            />
                          </div>
                        ) : (
                          <>
                            <h4 className="text-sm font-semibold text-zinc-900">{cand.title}</h4>
                            <p className="text-xs leading-relaxed text-zinc-600">{cand.fullPlot}</p>
                            <p className="text-xs text-zinc-500">
                              Вопрос: «{cand.mainTriggerQuestion}»
                            </p>
                          </>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setEditingId(editingId === cand.candidateId ? null : cand.candidateId)
                          }
                          className="rounded border border-stone-200 px-2 py-1 text-xs text-zinc-600 hover:bg-stone-100 cursor-pointer"
                        >
                          {editingId === cand.candidateId ? 'Готово' : 'Править'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDecision(cand.candidateId, 'approved')}
                          className={`inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs font-medium cursor-pointer ${
                            cand.decision === 'approved'
                              ? 'border-teal-700 bg-teal-700 text-white'
                              : 'border-stone-200 bg-white text-zinc-700 hover:border-teal-300'
                          }`}
                        >
                          <Check className="h-3.5 w-3.5" />
                          Одобрить
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDecision(cand.candidateId, 'needs_revision')}
                          title="На доработку"
                          className={`rounded border p-1.5 cursor-pointer ${
                            cand.decision === 'needs_revision'
                              ? 'border-amber-600 bg-amber-600 text-white'
                              : 'border-stone-200 bg-white text-zinc-500 hover:border-amber-300'
                          }`}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDecision(cand.candidateId, 'rejected')}
                          title="Отклонить"
                          className={`rounded border p-1.5 cursor-pointer ${
                            cand.decision === 'rejected'
                              ? 'border-rose-700 bg-rose-700 text-white'
                              : 'border-stone-200 bg-white text-zinc-500 hover:border-rose-300'
                          }`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 bg-stone-50 px-6 py-3.5">
          {pendingBatch ? (
            <>
              <div>
                {confirmDiscard ? (
                  <div className="inline-flex items-center gap-2 text-xs">
                    <span className="text-rose-800">Сбросить всю буферную партию?</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleDiscard}
                      className="rounded bg-rose-700 px-2.5 py-1 font-medium text-white hover:bg-rose-800 cursor-pointer"
                    >
                      Да, сбросить
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDiscard(false)}
                      className="rounded border border-stone-300 bg-white px-2.5 py-1 text-zinc-700 cursor-pointer"
                    >
                      Отмена
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDiscard(true)}
                    className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-800 hover:bg-rose-50 cursor-pointer"
                  >
                    Сбросить буфер
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-stone-100 cursor-pointer"
                >
                  Свернуть
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleCommit}
                  className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Зафиксировать в базе ({pendingBatch.candidates.length - rejectedCount})
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="text-xs text-zinc-500">
                Серверная генерация через Gemini API (с резервом GigaChat и Z.ai) и защитой от повторов
              </div>
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
                  disabled={busy}
                  onClick={handleStartGenerate}
                  className="inline-flex items-center gap-1.5 rounded-md bg-rose-800 px-4 py-2 text-sm font-medium text-white hover:bg-rose-900 disabled:opacity-50 cursor-pointer"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {busy ? 'Генерируем партию...' : `Сгенерировать ${count} сюжетов`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
