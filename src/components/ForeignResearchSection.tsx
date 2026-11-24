import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Database,
  Download,
  Globe,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Square,
  Trash2,
} from 'lucide-react';
import {
  CollectionType,
  ResearchJob,
  ResearchResult,
  ResearchSource,
  ResearchStatistics,
} from '../shared/types.js';
import { getCategoriesForCollection } from '../shared/categories.js';
import {
  approveResearchResult,
  cancelResearchJob,
  checkAllResearchSources,
  checkResearchDuplicate,
  checkResearchSource,
  createResearchBackup,
  createResearchSource,
  deleteResearchSource,
  fetchResearchJobs,
  fetchResearchResults,
  fetchResearchSources,
  fetchResearchStatistics,
  fetchIntegrationStatus,
  generateIdeaFromResult,
  reanalyzeResearchResult,
  rejectResearchResult,
  startResearchSearch,
  updateResearchResult,
  updateResearchSource,
} from '../services/api.js';
import { ResearchDetailModal } from './ResearchDetailModal.js';

type ResearchTab = 'overview' | 'sources' | 'search' | 'results' | 'queue';

interface ForeignResearchSectionProps {
  onDatabaseChanged: () => Promise<void>;
}

const SOURCE_STATUS_TEXT: Record<ResearchSource['status'], string> = {
  available: 'Доступен',
  restricted: 'Через Grounding',
  unavailable: 'Недоступен',
  unchecked: 'Не проверен',
};

export const ForeignResearchSection: React.FC<ForeignResearchSectionProps> = ({
  onDatabaseChanged,
}) => {
  const [tab, setTab] = useState<ResearchTab>('overview');
  const [stats, setStats] = useState<ResearchStatistics | null>(null);
  const [sources, setSources] = useState<ResearchSource[]>([]);
  const [jobs, setJobs] = useState<ResearchJob[]>([]);
  const [results, setResults] = useState<ResearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedResult, setSelectedResult] = useState<ResearchResult | null>(null);
  const [geminiConfigured, setGeminiConfigured] = useState<boolean>(true);

  // New source form
  const [newSrcName, setNewSrcName] = useState('');
  const [newSrcUrl, setNewSrcUrl] = useState('');
  const [newSrcRss, setNewSrcRss] = useState('');
  const [newSrcType, setNewSrcType] = useState<ResearchSource['sourceType']>('media');
  const [newSrcCol, setNewSrcCol] = useState<ResearchSource['defaultCollection']>('both');

  // New search job form
  const [searchCol, setSearchCol] = useState<CollectionType>('debate');
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [categoryFocus, setCategoryFocus] = useState('balanced');
  const [requestedCount, setRequestedCount] = useState(3);
  const [analysisDepth, setAnalysisDepth] = useState<'standard' | 'deep'>('standard');
  const [transformMode, setTransformMode] = useState<'analyze_only' | 'analyze_and_generate'>(
    'analyze_and_generate'
  );
  const [checkingAll, setCheckingAll] = useState(false);

  // Results filters
  const [resColFilter, setResColFilter] = useState<'all' | CollectionType>('all');
  const [resQueueFilter, setResQueueFilter] = useState('all');

  const refreshAll = async () => {
    try {
      const [sRes, srcRes, jRes, rRes, envStatus] = await Promise.all([
        fetchResearchStatistics(),
        fetchResearchSources(),
        fetchResearchJobs(),
        fetchResearchResults(),
        fetchIntegrationStatus().catch(() => null),
      ]);
      if (envStatus) setGeminiConfigured(envStatus.hasGeminiConfigured);
      setStats(sRes.statistics);
      setSources(srcRes.sources);
      setJobs(jRes.jobs);
      setResults(rRes.results);
      if (selectedResult) {
        const updated = rRes.results.find((r) => r.researchId === selectedResult.researchId);
        if (updated) setSelectedResult(updated);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка загрузки модуля исследований');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeJob = useMemo(
    () => jobs.find((j) => j.status === 'running' || j.status === 'queued') || null,
    [jobs]
  );

  // Poll while a research job is running
  useEffect(() => {
    if (!activeJob) return;
    const timer = setInterval(() => {
      refreshAll();
    }, 2500);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob?.id]);

  const filteredResults = useMemo(() => {
    return results.filter((r) => {
      if (resColFilter !== 'all' && r.collection !== resColFilter) return false;
      if (resQueueFilter !== 'all' && r.queueStatus !== resQueueFilter) return false;
      return true;
    });
  }, [results, resColFilter, resQueueFilter]);

  const queueIdeas = useMemo(
    () =>
      results.filter(
        (r) =>
          r.queueStatus !== 'approved_for_database' &&
          r.queueStatus !== 'rejected' &&
          r.generatedPlot !== null
      ),
    [results]
  );

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSrcName.trim() || !newSrcUrl.trim()) return;
    setErrorMsg(null);
    try {
      const res = await createResearchSource({
        name: newSrcName.trim(),
        url: newSrcUrl.trim(),
        rssUrl: newSrcRss.trim() || undefined,
        sourceType: newSrcType,
        defaultCollection: newSrcCol,
      });
      setSources(res.sources);
      setNewSrcName('');
      setNewSrcUrl('');
      setNewSrcRss('');
      await refreshAll();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка добавления источника');
    }
  };

  const handleStartSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      await startResearchSearch({
        collection: searchCol,
        sourceIds: selectedSourceIds,
        categoryFocus,
        sourceLanguage: 'en',
        requestedCount,
        analysisDepth,
        transformMode,
      });
      await refreshAll();
      setTab('overview');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Не удалось запустить поиск');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-zinc-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Загружаем Foreign Research Engine...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900">
            Foreign Research Engine · Поиск зарубежных сюжетов
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            Реальный поиск публичных материалов (RSS/Atom + Google Search Grounding), разбор механики
            и безопасный перенос в основную базу.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/api/research/export/json"
            download="melo_love_research.json"
            className="inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-stone-50"
          >
            <Download className="h-3.5 w-3.5" />
            JSON
          </a>
          <a
            href="/api/research/export/csv"
            download="melo_love_research.csv"
            className="inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-stone-50"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </a>
          <button
            type="button"
            onClick={() => createResearchBackup().then(refreshAll)}
            className="inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-stone-50 cursor-pointer"
          >
            <Database className="h-3.5 w-3.5" />
            Снимок
          </button>
        </div>
      </div>

      {!geminiConfigured && (
        <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-zinc-700">
          <span className="font-medium text-zinc-900">AI-анализ (Gemini / GigaChat / Z.ai) пока не подключён (опционально):</span>{' '}
          автоматический разбор источников потребует <code>GEMINI_API_KEY</code>,{' '}
          <code>GIGACHAT_AUTH_KEY</code> или <code>ZAI_API_KEY</code>, но каталог площадок, проверка
          RSS/robots.txt, просмотр карточек и экспорт JSON/CSV полностью работают без ключа.
        </div>
      )}

      {errorMsg && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {errorMsg}
        </div>
      )}

      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-stone-200 pb-3">
        {(
          [
            ['overview', 'Обзор исследований'],
            ['sources', `Источники (${sources.length})`],
            ['search', 'Новый поиск'],
            ['results', `Результаты (${results.length})`],
            ['queue', `Очередь идей (${queueIdeas.length})`],
          ] as Array<[ResearchTab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-md px-3.5 py-1.5 text-xs font-medium whitespace-nowrap cursor-pointer ${
              tab === id
                ? 'bg-zinc-900 text-white'
                : 'border border-stone-200 bg-white text-zinc-700 hover:bg-stone-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* TAB 1: OVERVIEW */}
      {tab === 'overview' && stats && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="rounded-lg border border-stone-200 bg-white p-4">
              <div className="text-xs text-zinc-500">Найдено материалов</div>
              <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900 tabular-nums">
                {stats.totalResults}
              </div>
              <div className="mt-1 text-xs text-zinc-500 font-mono tabular-nums">
                Споры: {stats.debateResultsCount} · Романтика: {stats.romanticResultsCount}
              </div>
            </div>
            <div className="rounded-lg border border-stone-200 bg-white p-4">
              <div className="text-xs text-zinc-500">Заготовки / Ожидают</div>
              <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900 tabular-nums">
                {stats.ideasGenerated} / {stats.awaitingReviewCount}
              </div>
              <div className="mt-1 text-xs text-zinc-500 font-mono tabular-nums">
                Перенесено в базу: {stats.approvedToDatabaseCount}
              </div>
            </div>
            <div className="rounded-lg border border-stone-200 bg-white p-4">
              <div className="text-xs text-zinc-500">Источники</div>
              <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900 tabular-nums">
                {stats.sourcesAvailable} доступно
              </div>
              <div className="mt-1 text-xs text-zinc-500 font-mono tabular-nums">
                Grounding: {stats.sourcesRestricted} · Сбои: {stats.sourcesUnavailable}
              </div>
            </div>
            <div className="rounded-lg border border-stone-200 bg-white p-4">
              <div className="text-xs text-zinc-500">Задания и дубли</div>
              <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900 tabular-nums">
                {stats.totalJobs} прогонов
              </div>
              <div className="mt-1 text-xs text-zinc-500 font-mono tabular-nums">
                Активных: {stats.activeJobs} · Дублей: {stats.duplicatesDetectedCount}
              </div>
            </div>
          </div>

          {activeJob && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-950">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Выполняется поиск {activeJob.id} · найдено {activeJob.foundCount}
                </div>
                <button
                  type="button"
                  onClick={() => cancelResearchJob(activeJob.id).then(refreshAll)}
                  className="inline-flex items-center gap-1 rounded border border-rose-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-800 hover:bg-rose-50 cursor-pointer"
                >
                  <Square className="h-3 w-3" />
                  Остановить
                </button>
              </div>
              <div className="max-h-32 overflow-y-auto font-mono text-[11px] text-amber-900 space-y-0.5">
                {activeJob.logs.slice(-6).map((l, idx) => (
                  <div key={idx}>{l}</div>
                ))}
              </div>
            </div>
          )}

          {/* Jobs History */}
          <div className="rounded-lg border border-stone-200 bg-white">
            <div className="border-b border-stone-200 px-5 py-3.5">
              <h3 className="text-sm font-semibold text-zinc-900">История заданий поиска</h3>
            </div>
            <div className="divide-y divide-stone-200">
              {jobs.length === 0 ? (
                <div className="px-5 py-8 text-center text-xs text-zinc-500">
                  Поисковые задания ещё не запускались. Откройте вкладку «Новый поиск».
                </div>
              ) : (
                jobs.slice(0, 10).map((j) => (
                  <div key={j.id} className="px-5 py-3.5 text-xs space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-zinc-900">
                        {j.id} · {j.collection === 'debate' ? 'Споры' : 'Романтика'} · статус:{' '}
                        {j.status}
                      </span>
                      <span className="font-mono text-zinc-500 tabular-nums">
                        Найдено: {j.foundCount} · Ошибок: {j.failedCount} · Метод: {j.methodUsed}
                      </span>
                    </div>
                    {j.error && <div className="text-rose-700">{j.error}</div>}
                    {j.logs.length > 0 && (
                      <div className="text-zinc-500 truncate">{j.logs[j.logs.length - 1]}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: SOURCES */}
      {tab === 'sources' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-zinc-600">
              Проверка уважает `robots.txt` и открытый HTTP-доступ. При ограничениях площадки
              используется Google Search Grounding без обхода защиты.
            </p>
            <button
              type="button"
              disabled={checkingAll}
              onClick={async () => {
                setCheckingAll(true);
                try {
                  const res = await checkAllResearchSources();
                  setSources(res.sources);
                  await refreshAll();
                } finally {
                  setCheckingAll(false);
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${checkingAll ? 'animate-spin' : ''}`} />
              {checkingAll ? 'Проверяем источники...' : 'Проверить доступность всех'}
            </button>
          </div>

          <form
            onSubmit={handleAddSource}
            className="rounded-lg border border-stone-200 bg-white p-4 grid grid-cols-1 gap-3 md:grid-cols-12 items-end"
          >
            <label className="block text-xs font-medium text-zinc-700 md:col-span-3">
              Название источника
              <input
                type="text"
                value={newSrcName}
                onChange={(e) => setNewSrcName(e.target.value)}
                placeholder="Aeon Essays"
                className="mt-1 w-full rounded border border-stone-200 px-2.5 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-zinc-700 md:col-span-3">
              URL площадки
              <input
                type="url"
                value={newSrcUrl}
                onChange={(e) => setNewSrcUrl(e.target.value)}
                placeholder="https://example.com/relationships"
                className="mt-1 w-full rounded border border-stone-200 px-2.5 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-zinc-700 md:col-span-2">
              RSS URL (опционально)
              <input
                type="url"
                value={newSrcRss}
                onChange={(e) => setNewSrcRss(e.target.value)}
                placeholder="https://.../rss.xml"
                className="mt-1 w-full rounded border border-stone-200 px-2.5 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-zinc-700 md:col-span-2">
              Тип / Раздел
              <select
                value={newSrcCol}
                onChange={(e) => setNewSrcCol(e.target.value as ResearchSource['defaultCollection'])}
                className="mt-1 w-full rounded border border-stone-200 bg-white px-2.5 py-1.5 text-sm"
              >
                <option value="both">Оба раздела</option>
                <option value="debate">Споры</option>
                <option value="romantic">Романтика</option>
              </select>
            </label>
            <div className="md:col-span-2">
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center gap-1 rounded bg-zinc-900 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-800 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                Добавить
              </button>
            </div>
          </form>

          <div className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
            {sources.map((src) => (
              <div
                key={src.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-xs"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-zinc-500">
                    <span className="font-mono text-zinc-700">{src.sourceType}</span>
                    <span>·</span>
                    <span
                      className={
                        src.status === 'available'
                          ? 'font-medium text-teal-800'
                          : src.status === 'restricted'
                            ? 'font-medium text-amber-800'
                            : src.status === 'unavailable'
                              ? 'font-medium text-rose-700'
                              : 'text-zinc-500'
                      }
                    >
                      {SOURCE_STATUS_TEXT[src.status]}
                    </span>
                    {src.lastHttpStatus && (
                      <>
                        <span>·</span>
                        <span className="font-mono tabular-nums">HTTP {src.lastHttpStatus}</span>
                      </>
                    )}
                    <span>·</span>
                    <span className="font-mono tabular-nums">Найдено: {src.foundCount}</span>
                  </div>
                  <div className="text-sm font-semibold text-zinc-900">{src.name}</div>
                  <div className="truncate font-mono text-[11px] text-zinc-500">{src.url}</div>
                  {src.lastError && <div className="text-[11px] text-amber-800">{src.lastError}</div>}
                </div>

                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 text-xs text-zinc-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={src.enabled}
                      onChange={(e) =>
                        updateResearchSource(src.id, { enabled: e.target.checked }).then((r) =>
                          setSources(r.sources)
                        )
                      }
                    />
                    Активен
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      checkResearchSource(src.id).then((r) => setSources(r.sources))
                    }
                    className="rounded border border-stone-200 px-2.5 py-1 text-xs text-zinc-700 hover:bg-stone-50 cursor-pointer"
                  >
                    Проверить
                  </button>
                  {!src.isSystem && (
                    <button
                      type="button"
                      onClick={() =>
                        deleteResearchSource(src.id).then((r) => setSources(r.sources))
                      }
                      className="rounded border border-stone-200 p-1.5 text-zinc-400 hover:text-rose-700 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: NEW SEARCH */}
      {tab === 'search' && (
        <form
          onSubmit={handleStartSearch}
          className="rounded-lg border border-stone-200 bg-white p-6 space-y-5 max-w-3xl"
        >
          <h3 className="text-base font-semibold text-zinc-900">Запуск нового поискового задания</h3>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-xs font-medium text-zinc-700">
              Целевой раздел базы
              <select
                value={searchCol}
                onChange={(e) => {
                  setSearchCol(e.target.value as CollectionType);
                  setCategoryFocus('balanced');
                }}
                className="mt-1 w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
              >
                <option value="debate">Раздел 1 · Споры и мнения</option>
                <option value="romantic">Раздел 2 · Романтика и нежность</option>
              </select>
            </label>

            <label className="block text-xs font-medium text-zinc-700">
              Тематический фокус
              <select
                value={categoryFocus}
                onChange={(e) => setCategoryFocus(e.target.value)}
                className="mt-1 w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
              >
                <option value="balanced">Любая актуальная тема раздела</option>
                {getCategoriesForCollection(searchCol).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="block text-xs font-medium text-zinc-700">
              Сколько материалов собрать (1–15)
              <input
                type="number"
                min={1}
                max={15}
                value={requestedCount}
                onChange={(e) =>
                  setRequestedCount(Math.max(1, Math.min(15, Number(e.target.value) || 3)))
                }
                className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 font-mono text-sm tabular-nums"
              />
            </label>

            <label className="block text-xs font-medium text-zinc-700">
              Глубина анализа
              <select
                value={analysisDepth}
                onChange={(e) => setAnalysisDepth(e.target.value as 'standard' | 'deep')}
                className="mt-1 w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
              >
                <option value="standard">Стандартный разбор</option>
                <option value="deep">Глубокий психологический разбор</option>
              </select>
            </label>

            <label className="block text-xs font-medium text-zinc-700">
              Режим трансформации
              <select
                value={transformMode}
                onChange={(e) =>
                  setTransformMode(e.target.value as 'analyze_only' | 'analyze_and_generate')
                }
                className="mt-1 w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
              >
                <option value="analyze_and_generate">Анализ + русская заготовка сюжета</option>
                <option value="analyze_only">Только разбор фактов источника</option>
              </select>
            </label>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-zinc-700">
              Источники (если не выбраны — используются все активные для раздела)
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {sources
                .filter((s) => s.enabled)
                .map((s) => {
                  const checked = selectedSourceIds.includes(s.id);
                  return (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 rounded border border-stone-200 px-3 py-2 text-xs cursor-pointer hover:bg-stone-50"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setSelectedSourceIds((prev) =>
                            e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id)
                          );
                        }}
                      />
                      <span className="truncate font-medium text-zinc-800">{s.name}</span>
                    </label>
                  );
                })}
            </div>
          </div>

          <button
            type="submit"
            disabled={Boolean(activeJob)}
            className="inline-flex items-center gap-1.5 rounded-md bg-rose-800 px-4 py-2 text-sm font-medium text-white hover:bg-rose-900 disabled:opacity-50 cursor-pointer"
          >
            <Play className="h-4 w-4" />
            {activeJob ? 'Дождитесь завершения текущего задания' : 'Запустить поиск и разбор'}
          </button>
        </form>
      )}

      {/* TAB 4: RESULTS */}
      {tab === 'results' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={resColFilter}
              onChange={(e) => setResColFilter(e.target.value as 'all' | CollectionType)}
              className="rounded-md border border-stone-200 bg-white px-3 py-1.5 text-xs"
            >
              <option value="all">Все разделы</option>
              <option value="debate">Споры</option>
              <option value="romantic">Романтика</option>
            </select>
            <select
              value={resQueueFilter}
              onChange={(e) => setResQueueFilter(e.target.value)}
              className="rounded-md border border-stone-200 bg-white px-3 py-1.5 text-xs"
            >
              <option value="all">Любой статус очереди</option>
              <option value="awaiting_review">Ожидают решения</option>
              <option value="research_pending">Требуют анализа</option>
              <option value="approved_for_database">Перенесены в базу</option>
              <option value="rejected">Отклонены</option>
            </select>
          </div>

          {filteredResults.length === 0 ? (
            <div className="rounded-lg border border-stone-200 bg-white px-6 py-12 text-center text-sm text-zinc-500">
              Найденных карточек по выбранному фильтру нет.
            </div>
          ) : (
            <div className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
              {filteredResults.map((r) => (
                <div
                  key={r.researchId}
                  className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-start md:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <span className="font-mono font-semibold text-zinc-800">{r.researchId}</span>
                      <span>·</span>
                      <span>{r.sourceName}</span>
                      <span>·</span>
                      <span>{r.collection === 'debate' ? 'Споры' : 'Романтика'}</span>
                      <span>·</span>
                      <span className="font-mono">{r.queueStatus}</span>
                      {r.duplicateFlag && (
                        <>
                          <span>·</span>
                          <span className="font-medium text-rose-700">Возможный дубль</span>
                        </>
                      )}
                      {r.approvedStoryId && (
                        <>
                          <span>·</span>
                          <span className="font-mono font-medium text-teal-800">
                            → {r.approvedStoryId}
                          </span>
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedResult(r)}
                      className="text-left text-base font-semibold text-zinc-900 hover:text-rose-800 cursor-pointer"
                    >
                      {r.generatedPlot?.title || r.sourceTitle}
                    </button>
                    <p className="text-xs text-zinc-600 line-clamp-2">
                      {r.mainSituation || r.sourceSummary || r.sourceTitle}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    {r.quality && (
                      <div className="text-right">
                        <div className="font-mono text-sm font-semibold text-zinc-900 tabular-nums">
                          {r.quality.overall}/100
                        </div>
                        <div className="text-[11px] text-zinc-500">{r.quality.tierLabel}</div>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedResult(r)}
                      className="rounded border border-stone-200 px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-stone-50 cursor-pointer"
                    >
                      Открыть разбор
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 5: IDEA QUEUE */}
      {tab === 'queue' && (
        <div className="space-y-4">
          {queueIdeas.length === 0 ? (
            <div className="rounded-lg border border-stone-200 bg-white px-6 py-12 text-center space-y-2">
              <Globe className="mx-auto h-6 w-6 text-zinc-400" />
              <div className="text-sm font-medium text-zinc-800">Очередь готовых идей пуста</div>
              <p className="text-xs text-zinc-500">
                Запустите новый поиск или сгенерируйте заготовку внутри найденных карточек.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
              {queueIdeas.map((r) => (
                <div
                  key={r.researchId}
                  className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-xs font-mono text-zinc-500">
                      {r.researchId} · {r.sourceName} · {r.quality?.overall ?? 0}/100
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedResult(r)}
                      className="text-left text-sm font-semibold text-zinc-900 hover:text-rose-800 cursor-pointer"
                    >
                      {r.generatedPlot?.title}
                    </button>
                    <p className="text-xs text-zinc-600 line-clamp-2">
                      {r.generatedPlot?.shortDescription}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedResult(r)}
                      className="rounded border border-stone-200 px-3 py-1.5 text-xs text-zinc-700 hover:bg-stone-50 cursor-pointer"
                    >
                      Проверить
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await approveResearchResult(r.researchId, false);
                          await onDatabaseChanged();
                          await refreshAll();
                        } catch {
                          setSelectedResult(r);
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 cursor-pointer"
                    >
                      <Check className="h-3.5 w-3.5" />В базу
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Detail modal */}
      {selectedResult && (
        <ResearchDetailModal
          result={selectedResult}
          onClose={() => setSelectedResult(null)}
          onPatchResult={async (id, updates) => {
            await updateResearchResult(id, updates);
            await refreshAll();
          }}
          onReanalyze={async (id) => {
            await reanalyzeResearchResult(id);
            await refreshAll();
          }}
          onGenerateIdea={async (id) => {
            await generateIdeaFromResult(id);
            await refreshAll();
          }}
          onCheckDuplicate={async (id) => {
            await checkResearchDuplicate(id);
            await refreshAll();
          }}
          onApproveToDatabase={async (id, forceApprove) => {
            await approveResearchResult(id, forceApprove);
            await onDatabaseChanged();
            await refreshAll();
          }}
          onReject={async (id) => {
            await rejectResearchResult(id);
            await refreshAll();
          }}
        />
      )}
    </div>
  );
};
