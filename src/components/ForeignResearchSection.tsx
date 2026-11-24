import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Database,
  Download,
  ExternalLink,
  FolderPlus,
  Globe,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { getCategoriesForCollection } from '../shared/categories.ts';
import type {
  CollectionType,
  ResearchConversionMode,
  ResearchDepth,
  ResearchJob,
  ResearchQueueStatus,
  ResearchResult,
  ResearchSource,
  ResearchStatistics,
  SourceAvailabilityStatus,
} from '../shared/types.ts';
import * as api from '../services/api.ts';
import { QUEUE_STATUS_LABELS, ResearchDetailModal } from './ResearchDetailModal.tsx';

type ResearchSubTab = 'overview' | 'sources' | 'search' | 'results' | 'queue';

interface ForeignResearchSectionProps {
  customCategories: { debate: string[]; romantic: string[] };
  onDatabaseUpdated: () => Promise<void>;
}

const AVAILABILITY_LABEL: Record<SourceAvailabilityStatus, string> = {
  unchecked: 'Не проверен',
  available: 'Доступен',
  restricted: 'Ограничен (robots/HTTP)',
  unavailable: 'Недоступен',
};

const AVAILABILITY_COLOR: Record<SourceAvailabilityStatus, string> = {
  unchecked: 'text-slate-500',
  available: 'text-emerald-700',
  restricted: 'text-amber-700',
  unavailable: 'text-red-700',
};

const ALL_QUEUE_STATUSES: ResearchQueueStatus[] = [
  'research_pending',
  'analysis_completed',
  'idea_generated',
  'duplicate_check',
  'awaiting_review',
  'approved_for_database',
  'rejected',
];

export const ForeignResearchSection: React.FC<ForeignResearchSectionProps> = ({
  customCategories,
  onDatabaseUpdated,
}) => {
  const [subTab, setSubTab] = useState<ResearchSubTab>('overview');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [stats, setStats] = useState<ResearchStatistics | null>(null);
  const [geminiConfigured, setGeminiConfigured] = useState<boolean>(true);
  const [sources, setSources] = useState<ResearchSource[]>([]);
  const [jobs, setJobs] = useState<ResearchJob[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [results, setResults] = useState<ResearchResult[]>([]);
  const [selectedCard, setSelectedCard] = useState<ResearchResult | null>(null);

  // Source management state
  const [checkingSourceId, setCheckingSourceId] = useState<string | null>(null);
  const [checkingAllSources, setCheckingAllSources] = useState(false);
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [newSourceType, setNewSourceType] = useState('Зарубежное медиа');
  const [newSourceNotes, setNewSourceNotes] = useState('');
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [editSourceName, setEditSourceName] = useState('');
  const [editSourceUrl, setEditSourceUrl] = useState('');
  const [editSourceNotes, setEditSourceNotes] = useState('');

  // Search launch state
  const [searchCollection, setSearchCollection] = useState<CollectionType>('debate');
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [searchCategory, setSearchCategory] = useState<string>('ALL_BALANCED');
  const [searchLanguage, setSearchLanguage] = useState<string>('en');
  const [requestedCount, setRequestedCount] = useState<number>(3);
  const [depth, setDepth] = useState<ResearchDepth>('standard');
  const [conversionMode, setConversionMode] = useState<ResearchConversionMode>('analysis_and_idea');
  const [launchingSearch, setLaunchingSearch] = useState(false);

  // Results & Queue filters
  const [resultDirFilter, setResultDirFilter] = useState<'ALL' | CollectionType>('ALL');
  const [resultSourceFilter, setResultSourceFilter] = useState<string>('ALL');
  const [resultSearchText, setResultSearchText] = useState('');
  const [queueStatusFilter, setQueueStatusFilter] = useState<'ALL' | ResearchQueueStatus>('ALL');
  const [queueBusyId, setQueueBusyId] = useState<string | null>(null);
  const [queueNotice, setQueueNotice] = useState<string | null>(null);

  const loadAllResearch = useCallback(async () => {
    try {
      const [statRes, srcRes, jobsRes, resList] = await Promise.all([
        api.fetchResearchStatistics(),
        api.fetchResearchSources(),
        api.fetchResearchJobs(),
        api.fetchResearchResults(),
      ]);
      setStats(statRes.stats);
      setGeminiConfigured(statRes.geminiConfigured);
      setActiveJobId(jobsRes.activeJobId);
      setSources(srcRes.sources);
      setJobs(jobsRes.jobs);
      setResults(resList.results);
    } catch (err) {
      setErrorMsg((err as Error).message || 'Не удалось загрузить данные FOREIGN RESEARCH');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAllResearch();
  }, [loadAllResearch]);

  // Poll live progress while any research job is running
  const runningJob = useMemo(
    () => jobs.find((j) => j.status === 'running') || null,
    [jobs]
  );

  useEffect(() => {
    if (!runningJob && !activeJobId) return;
    const timer = setInterval(() => {
      void loadAllResearch();
    }, 2200);
    return () => clearInterval(timer);
  }, [runningJob, activeJobId, loadAllResearch]);

  const categoriesForSearch = getCategoriesForCollection(searchCollection, customCategories);

  const handleCheckSingleSource = async (id: string) => {
    setCheckingSourceId(id);
    setErrorMsg(null);
    try {
      const res = await api.checkResearchSource(id);
      setSources(res.sources);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setCheckingSourceId(null);
    }
  };

  const handleCheckAllSources = async () => {
    setCheckingAllSources(true);
    setErrorMsg(null);
    try {
      const res = await api.checkAllResearchSources();
      setSources(res.sources);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setCheckingAllSources(false);
    }
  };

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSourceName.trim() || !newSourceUrl.trim()) return;
    setErrorMsg(null);
    try {
      const res = await api.addResearchSource({
        name: newSourceName.trim(),
        url: newSourceUrl.trim(),
        sourceType: newSourceType.trim() || 'Пользовательский источник',
        notes: newSourceNotes.trim(),
      });
      setSources(res.sources);
      setNewSourceName('');
      setNewSourceUrl('');
      setNewSourceNotes('');
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleToggleSource = async (src: ResearchSource) => {
    const res = await api.updateResearchSource(src.id, { enabled: !src.enabled });
    setSources(res.sources);
  };

  const handleSaveEditSource = async (id: string) => {
    const res = await api.updateResearchSource(id, {
      name: editSourceName,
      url: editSourceUrl,
      notes: editSourceNotes,
    });
    setSources(res.sources);
    setEditingSourceId(null);
  };

  const handleDeleteSource = async (id: string) => {
    try {
      const res = await api.deleteResearchSource(id);
      setSources(res.sources);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleLaunchSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setLaunchingSearch(true);
    setErrorMsg(null);
    try {
      const res = await api.startResearchSearch({
        collection: searchCollection,
        sourceIds: selectedSourceIds,
        category: searchCategory,
        sourceLanguage: searchLanguage,
        requestedCount,
        depth,
        conversionMode,
      });
      setActiveJobId(res.job.id);
      setJobs((prev) => [res.job, ...prev]);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setLaunchingSearch(false);
    }
  };

  const handleCancelJob = async (jobId: string) => {
    try {
      await api.cancelResearchJob(jobId);
      await loadAllResearch();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleQueueAction = async (
    researchId: string,
    action: 'analyze' | 'generate' | 'dedup' | 'approve' | 'reject'
  ) => {
    setQueueBusyId(researchId);
    setErrorMsg(null);
    setQueueNotice(null);
    try {
      if (action === 'analyze') {
        const res = await api.analyzeResearchResult(researchId);
        setQueueNotice(`${res.result.researchId}: повторный анализ завершён.`);
      } else if (action === 'generate') {
        const res = await api.generateResearchIdea(researchId);
        setQueueNotice(`${res.result.researchId}: создана новая оригинальная версия идеи.`);
      } else if (action === 'dedup') {
        const res = await api.checkResearchDuplicate(researchId);
        setQueueNotice(
          res.result.duplicateFlag
            ? `${res.result.researchId}: найдено совпадений — ${res.result.duplicateMatches.length}.`
            : `${res.result.researchId}: совпадений не обнаружено.`
        );
      } else if (action === 'approve') {
        const res = await api.approveResearchResult(researchId, false);
        await onDatabaseUpdated();
        setQueueNotice(
          `${res.result.researchId} добавлен в основную базу под ID ${res.story.id} (verificationStatus = pending).`
        );
      } else if (action === 'reject') {
        const res = await api.rejectResearchResult(researchId);
        setQueueNotice(`${res.result.researchId} отклонён.`);
      }
      await loadAllResearch();
    } catch (err) {
      const typed = err as Error & { status?: number };
      setErrorMsg(typed.message);
      if (typed.status === 409) {
        const target = results.find((r) => r.researchId === researchId);
        if (target) setSelectedCard(target);
      }
      await loadAllResearch();
    } finally {
      setQueueBusyId(null);
    }
  };

  const filteredResults = useMemo(() => {
    const q = resultSearchText.trim().toLowerCase();
    return results.filter((r) => {
      if (resultDirFilter !== 'ALL' && r.collection !== resultDirFilter) return false;
      if (resultSourceFilter !== 'ALL' && r.sourceId !== resultSourceFilter) return false;
      if (q) {
        const hay = [
          r.researchId,
          r.sourceTitle,
          r.sourceSummary,
          r.mainSituation,
          r.storyMechanic,
          r.targetCategory,
          r.generatedIdea?.title || '',
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [results, resultDirFilter, resultSourceFilter, resultSearchText]);

  const queueItems = useMemo(() => {
    if (queueStatusFilter === 'ALL') return results;
    return results.filter((r) => r.queueStatus === queueStatusFilter);
  }, [results, queueStatusFilter]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-10 w-80 rounded bg-slate-200" />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg border border-slate-200 bg-white" />
          ))}
        </div>
        <div className="h-64 rounded-lg border border-slate-200 bg-white" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Sub-navigation */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            FOREIGN RESEARCH
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Поиск зарубежных историй и обсуждений, структурный анализ, переосмысление в оригинальные
            сюжетные заготовки и проверка перед добавлением в базу.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-md bg-slate-100 p-1">
          {(
            [
              ['overview', 'Обзор исследований'],
              ['sources', `Источники (${sources.length})`],
              ['search', 'Новый поиск'],
              ['results', `Результаты (${results.length})`],
              ['queue', `Очередь идей (${stats?.awaitingReviewCount ?? 0})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSubTab(id)}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                subTab === id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-start justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-red-700 hover:text-red-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {queueNotice && (
        <div className="flex items-start justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
          <span>{queueNotice}</span>
          <button
            type="button"
            onClick={() => setQueueNotice(null)}
            className="text-emerald-700 hover:text-emerald-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Active running job banner */}
      {runningJob && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-indigo-200 bg-indigo-50/70 px-5 py-3.5">
          <div className="text-xs text-indigo-950">
            <strong>Выполняется исследование {runningJob.id}:</strong>{' '}
            {runningJob.collection === 'debate' ? 'DEBATE' : 'ROMANTIC'} · обработано{' '}
            <span className="font-mono font-semibold tabular-nums">
              {runningJob.processedCount}/{runningJob.requestedCount}
            </span>{' '}
            · найдено URL:{' '}
            <span className="font-mono font-semibold tabular-nums">{runningJob.foundCount}</span>
          </div>
          <button
            type="button"
            onClick={() => handleCancelJob(runningJob.id)}
            className="inline-flex items-center gap-1.5 rounded border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
          >
            <Square className="h-3 w-3" />
            Отменить исследование
          </button>
        </div>
      )}

      {/* =====================================================================
          1. ОБЗОР ИССЛЕДОВАНИЙ
          ===================================================================== */}
      {subTab === 'overview' && stats && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Проведено исследований" value={stats.totalJobs} sub={`Завершено: ${stats.completedJobs}`} />
            <StatCard label="Найдено материалов" value={stats.totalMaterialsFound} sub="С проверенным URL" />
            <StatCard label="Обработано источников" value={stats.processedSourcesCount} sub={`Включено: ${stats.enabledSourcesCount}`} />
            <StatCard label="Оригинальных идей" value={stats.originalIdeasCount} sub={`Средний балл: ${stats.averageResearchQuality}/100`} />
            <StatCard label="Ожидают проверки" value={stats.awaitingReviewCount} sub="В очереди редактора" onClick={() => setSubTab('queue')} />
            <StatCard label="Добавлено в базу" value={stats.approvedForDatabaseCount} sub="В STORY DATABASE" />
            <StatCard label="Отклонено идей" value={stats.rejectedCount} sub="Не прошли отбор" />
            <StatCard label="Обнаружено дублей" value={stats.duplicatesDetectedCount} sub="По базе и очереди" />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
              <h2 className="text-base font-semibold text-slate-900">
                Статистика по направлениям
              </h2>
              <div className="divide-y divide-slate-100 text-xs">
                <div className="flex items-center justify-between py-2.5">
                  <span className="font-medium text-slate-800">DEBATE RESEARCH («Кто здесь прав?»)</span>
                  <span className="font-mono text-slate-700 tabular-nums">
                    Найдено: {stats.debateCount} · В базу: {stats.debateApprovedCount}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span className="font-medium text-slate-800">ROMANTIC RESEARCH («Романтические»)</span>
                  <span className="font-mono text-slate-700 tabular-nums">
                    Найдено: {stats.romanticCount} · В базу: {stats.romanticApprovedCount}
                  </span>
                </div>
              </div>
              <div className="pt-1 text-xs text-slate-500">
                Статус поискового движка:{' '}
                <strong className={geminiConfigured ? 'text-emerald-700' : 'text-amber-700'}>
                  {geminiConfigured
                    ? 'Gemini API + Google Search Grounding настроены на сервере'
                    : 'GEMINI_API_KEY не задан (поиск и анализ через Gemini недоступны)'}
                </strong>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
              <h2 className="text-base font-semibold text-slate-900">
                Экспорт и резервное копирование исследований
              </h2>
              <p className="text-xs leading-relaxed text-slate-600">
                Все источники, задания и аналитические карточки хранятся на диске сервера в{' '}
                <code>data/research_*.json</code>. Экспорт работает независимо от основной базы.
              </p>
              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <a
                  href="/api/research/export/json"
                  className="inline-flex items-center gap-1.5 rounded-md bg-indigo-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  Экспорт исследований (JSON)
                </a>
                <a
                  href="/api/research/export/csv"
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  Экспорт CSV (UTF-8)
                </a>
                <button
                  type="button"
                  onClick={async () => {
                    const res = await api.createResearchBackup();
                    setQueueNotice(`Создан снимок исследований: ${res.filename}`);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Database className="h-3.5 w-3.5" />
                  Снимок research_backups
                </button>
              </div>
            </div>
          </div>

          {/* Jobs History Log */}
          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-semibold text-slate-900">
                Журнал заданий исследования ({jobs.length})
              </h2>
              <button
                type="button"
                onClick={() => setSubTab('search')}
                className="text-xs font-semibold text-indigo-700 hover:underline"
              >
                Запустить новый поиск →
              </button>
            </div>
            {jobs.length === 0 ? (
              <div className="py-6 text-center space-y-2">
                <p className="text-sm text-slate-700">Исследования ещё не запускались.</p>
                <p className="text-xs text-slate-500">
                  Перейдите во вкладку «Новый поиск» или проверьте доступность источников.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {jobs.slice(0, 10).map((j) => (
                  <div key={j.id} className="py-3 space-y-1.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-semibold text-slate-900">{j.id}</span>
                        <span aria-hidden="true">·</span>
                        <span>{j.collection === 'debate' ? 'DEBATE' : 'ROMANTIC'}</span>
                        <span aria-hidden="true">·</span>
                        <span>{j.category === 'ALL_BALANCED' ? 'Сбалансировано' : j.category}</span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={
                            j.status === 'completed'
                              ? 'font-medium text-emerald-700'
                              : j.status === 'failed' || j.status === 'interrupted'
                                ? 'font-medium text-red-700'
                                : j.status === 'running'
                                  ? 'font-medium text-indigo-700'
                                  : 'text-amber-700'
                          }
                        >
                          {j.status}
                        </span>
                      </div>
                      <span className="font-mono text-slate-500 tabular-nums">
                        {new Date(j.createdAt).toLocaleString('ru-RU')}
                      </span>
                    </div>
                    <div className="text-slate-600">
                      Найдено: <span className="font-mono">{j.foundCount}</span> · Обработано:{' '}
                      <span className="font-mono">{j.processedCount}/{j.requestedCount}</span> · Идей:{' '}
                      <span className="font-mono">{j.ideasGeneratedCount}</span> · Дублей:{' '}
                      <span className="font-mono">{j.duplicatesDetectedCount}</span> · Метод:{' '}
                      <span className="font-mono">{j.searchMethodUsed}</span>
                    </div>
                    {j.errorMessage && (
                      <div className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-red-800">
                        {j.errorMessage}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          2. ИСТОЧНИКИ (SOURCES CATALOG)
          ===================================================================== */}
      {subTab === 'sources' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-600 max-w-2xl">
              Каталог соблюдает <code>robots.txt</code>, не обходит CAPTCHA и авторизацию. Источник
              показывается как «Доступен» только после реальной проверки сервером.
            </div>
            <button
              type="button"
              disabled={checkingAllSources}
              onClick={handleCheckAllSources}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${checkingAllSources ? 'animate-spin' : ''}`} />
              {checkingAllSources ? 'Проверка источников...' : 'Проверить доступность всех'}
            </button>
          </div>

          {/* Add custom source */}
          <form
            onSubmit={handleAddSource}
            className="rounded-lg border border-slate-200 bg-white p-5 space-y-3"
          >
            <h2 className="text-sm font-semibold text-slate-900">Добавить новый источник</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <input
                type="text"
                required
                value={newSourceName}
                onChange={(e) => setNewSourceName(e.target.value)}
                placeholder="Название (напр. The Guardian — Relationships)"
                className="md:col-span-4 rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900"
              />
              <input
                type="url"
                required
                value={newSourceUrl}
                onChange={(e) => setNewSourceUrl(e.target.value)}
                placeholder="https://..."
                className="md:col-span-4 rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900"
              />
              <input
                type="text"
                value={newSourceType}
                onChange={(e) => setNewSourceType(e.target.value)}
                placeholder="Тип площадки"
                className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900"
              />
              <button
                type="submit"
                className="md:col-span-2 inline-flex items-center justify-center gap-1.5 rounded-md bg-indigo-700 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-800"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                Добавить
              </button>
            </div>
            <input
              type="text"
              value={newSourceNotes}
              onChange={(e) => setNewSourceNotes(e.target.value)}
              placeholder="Примечание: какие темы или сюжетные механики искать на этой площадке..."
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-900"
            />
          </form>

          {/* Sources list */}
          <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
            {sources.map((src) => (
              <div key={src.id} className="p-4 space-y-2">
                {editingSourceId === src.id ? (
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <input
                        type="text"
                        value={editSourceName}
                        onChange={(e) => setEditSourceName(e.target.value)}
                        className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                      />
                      <input
                        type="url"
                        value={editSourceUrl}
                        onChange={(e) => setEditSourceUrl(e.target.value)}
                        className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                      />
                    </div>
                    <input
                      type="text"
                      value={editSourceNotes}
                      onChange={(e) => setEditSourceNotes(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleSaveEditSource(src.id)}
                        className="rounded bg-indigo-700 px-3 py-1 text-xs font-semibold text-white"
                      >
                        Сохранить
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingSourceId(null)}
                        className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-700"
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>{src.sourceType}</span>
                        <span aria-hidden="true">·</span>
                        <span className={`font-medium ${AVAILABILITY_COLOR[src.availabilityStatus]}`}>
                          {AVAILABILITY_LABEL[src.availabilityStatus]}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          Найдено: {src.itemsFoundCount}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          Проверка:{' '}
                          {src.lastCheckedAt
                            ? new Date(src.lastCheckedAt).toLocaleString('ru-RU')
                            : 'не проводилась'}
                        </span>
                        {!src.enabled && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-medium text-slate-500">Отключён</span>
                          </>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">{src.name}</span>
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-indigo-700 hover:underline"
                        >
                          {src.url} <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                      <p className="text-xs text-slate-600">{src.notes}</p>
                      <p className="text-[11px] text-slate-500">{src.availabilityMessage}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={checkingSourceId === src.id}
                        onClick={() => handleCheckSingleSource(src.id)}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <RefreshCw
                          className={`h-3 w-3 ${checkingSourceId === src.id ? 'animate-spin' : ''}`}
                        />
                        Проверить
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSourceId(src.id);
                          setEditSourceName(src.name);
                          setEditSourceUrl(src.url);
                          setEditSourceNotes(src.notes);
                        }}
                        className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Изменить
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleSource(src)}
                        className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {src.enabled ? 'Отключить' : 'Включить'}
                      </button>
                      {src.isCustom && (
                        <button
                          type="button"
                          onClick={() => handleDeleteSource(src.id)}
                          className="inline-flex items-center gap-1 rounded border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* =====================================================================
          3. НОВЫЙ ПОИСК
          ===================================================================== */}
      {subTab === 'search' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <form
            onSubmit={handleLaunchSearch}
            className="lg:col-span-7 rounded-lg border border-slate-200 bg-white p-5 space-y-4"
          >
            <h2 className="text-base font-semibold text-slate-900">
              Параметры исследования зарубежных площадок
            </h2>

            {!geminiConfigured && (
              <div className="rounded border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-950">
                На сервере не обнаружен <code>GEMINI_API_KEY</code>. Прямые ленты (если не
                заблокированы) могут читаться, но глубокий поиск Google Search Grounding и
                ИИ-переосмысление потребуют активного ключа.
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-700">Направление</label>
                <select
                  value={searchCollection}
                  onChange={(e) => {
                    setSearchCollection(e.target.value as CollectionType);
                    setSearchCategory('ALL_BALANCED');
                  }}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
                >
                  <option value="debate">DEBATE RESEARCH — «Кто здесь прав?»</option>
                  <option value="romantic">ROMANTIC RESEARCH — «Романтические истории»</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Категория</label>
                <select
                  value={searchCategory}
                  onChange={(e) => setSearchCategory(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
                >
                  <option value="ALL_BALANCED">Все подходящие категории (сбалансировано)</option>
                  {categoriesForSearch.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Язык исходных материалов
                </label>
                <select
                  value={searchLanguage}
                  onChange={(e) => setSearchLanguage(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
                >
                  <option value="en">Английский (en)</option>
                  <option value="any">Любой зарубежный</option>
                  <option value="de">Немецкий (de)</option>
                  <option value="fr">Французский (fr)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Количество материалов (лимит 1–10 за запуск)
                </label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={requestedCount}
                  onChange={(e) =>
                    setRequestedCount(Math.max(1, Math.min(10, Number(e.target.value) || 3)))
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs tabular-nums text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Глубина анализа</label>
                <select
                  value={depth}
                  onChange={(e) => setDepth(e.target.value as ResearchDepth)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
                >
                  <option value="standard">Стандартный структурный разбор</option>
                  <option value="deep">Глубокий психологический анализ мотивации</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Режим преобразования
                </label>
                <select
                  value={conversionMode}
                  onChange={(e) => setConversionMode(e.target.value as ResearchConversionMode)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
                >
                  <option value="analysis_and_idea">
                    Анализ + создание оригинальной сюжетной идеи
                  </option>
                  <option value="analysis_only">Только аналитическая карточка источника</option>
                </select>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs font-medium text-slate-700 mb-1.5">
                <span>
                  Источники ({selectedSourceIds.length === 0 ? 'все включённые' : selectedSourceIds.length})
                </span>
                {selectedSourceIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedSourceIds([])}
                    className="text-indigo-700 hover:underline"
                  >
                    Сбросить (выбрать все включённые)
                  </button>
                )}
              </div>
              <div className="max-h-52 overflow-y-auto rounded-md border border-slate-200 divide-y divide-slate-100">
                {sources
                  .filter((s) => s.enabled)
                  .map((s) => {
                    const checked = selectedSourceIds.includes(s.id);
                    return (
                      <label
                        key={s.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-slate-50 cursor-pointer"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedSourceIds((prev) => [...prev, s.id]);
                              } else {
                                setSelectedSourceIds((prev) => prev.filter((id) => id !== s.id));
                              }
                            }}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-700"
                          />
                          <span className="truncate font-medium text-slate-900">{s.name}</span>
                        </span>
                        <span className={`shrink-0 ${AVAILABILITY_COLOR[s.availabilityStatus]}`}>
                          {AVAILABILITY_LABEL[s.availabilityStatus]}
                        </span>
                      </label>
                    );
                  })}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="submit"
                disabled={launchingSearch || Boolean(runningJob)}
                className="inline-flex items-center gap-2 rounded-md bg-indigo-700 px-5 py-2.5 text-xs font-semibold text-white hover:bg-indigo-800 disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5" />
                {runningJob
                  ? 'Исследование уже выполняется...'
                  : launchingSearch
                    ? 'Запуск...'
                    : 'Запустить исследование'}
              </button>
            </div>
          </form>

          {/* Live Job Monitor */}
          <div className="lg:col-span-5 rounded-lg border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-semibold text-slate-900">
                Текущий ход выполнения
              </h2>
              <button
                type="button"
                onClick={loadAllResearch}
                className="text-xs text-indigo-700 hover:underline"
              >
                Обновить
              </button>
            </div>

            {jobs.length === 0 ? (
              <p className="text-xs leading-relaxed text-slate-500">
                Здесь в реальном времени отображаются шаги поиска, проверки достоверности URL,
                глубокий анализ и сохранение результатов на диск.
              </p>
            ) : (
              (() => {
                const latest = jobs[0];
                return (
                  <div className="space-y-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-semibold text-slate-900">{latest.id}</span>
                      <span className="font-medium text-slate-700">{latest.status}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded border border-slate-200 bg-slate-50 p-2">
                        <div className="text-slate-500">Найдено URL</div>
                        <div className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
                          {latest.foundCount}
                        </div>
                      </div>
                      <div className="rounded border border-slate-200 bg-slate-50 p-2">
                        <div className="text-slate-500">Обработано</div>
                        <div className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
                          {latest.processedCount} / {latest.requestedCount}
                        </div>
                      </div>
                    </div>

                    {latest.errorMessage && (
                      <div className="rounded border border-red-200 bg-red-50 p-2.5 text-red-800">
                        {latest.errorMessage}
                      </div>
                    )}

                    <div className="max-h-72 overflow-y-auto rounded border border-slate-200 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-200 space-y-1">
                      {latest.logs.map((entry, idx) => (
                        <div
                          key={idx}
                          className={
                            entry.level === 'error'
                              ? 'text-red-300'
                              : entry.level === 'warn'
                                ? 'text-amber-300'
                                : 'text-slate-200'
                          }
                        >
                          [{new Date(entry.timestamp).toLocaleTimeString('ru-RU')}] {entry.message}
                        </div>
                      ))}
                    </div>

                    {latest.status === 'completed' && latest.resultIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSubTab('queue')}
                        className="w-full rounded-md border border-indigo-200 bg-indigo-50 py-2 text-xs font-semibold text-indigo-800 hover:bg-indigo-100"
                      >
                        Перейти в очередь идей ({latest.resultIds.length}) →
                      </button>
                    )}
                  </div>
                );
              })()
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          4. РЕЗУЛЬТАТЫ ИССЛЕДОВАНИЯ
          ===================================================================== */}
      {subTab === 'results' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={resultSearchText}
                onChange={(e) => setResultSearchText(e.target.value)}
                placeholder="Поиск по заголовку, механике, выжимке..."
                className="w-full rounded border border-slate-300 py-1.5 pl-8 pr-3 text-xs text-slate-900"
              />
            </div>
            <select
              value={resultDirFilter}
              onChange={(e) => setResultDirFilter(e.target.value as 'ALL' | CollectionType)}
              className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
            >
              <option value="ALL">Все направления</option>
              <option value="debate">DEBATE («Кто здесь прав?»)</option>
              <option value="romantic">ROMANTIC («Романтические»)</option>
            </select>
            <select
              value={resultSourceFilter}
              onChange={(e) => setResultSourceFilter(e.target.value)}
              className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
            >
              <option value="ALL">Все источники</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {filteredResults.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center space-y-2">
              <Globe className="mx-auto h-6 w-6 text-slate-400" />
              <p className="text-sm font-medium text-slate-900">
                Материалы по выбранным фильтрам пока отсутствуют
              </p>
              <p className="text-xs text-slate-500">
                Запустите реальный поиск во вкладке «Новый поиск», чтобы получить проверенные ссылки
                и аналитические карточки.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {filteredResults.map((r) => (
                <div
                  key={r.researchId}
                  className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-5 space-y-3"
                >
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono font-semibold text-slate-800">{r.researchId}</span>
                      <span aria-hidden="true">·</span>
                      <span>{r.sourceName}</span>
                      <span aria-hidden="true">·</span>
                      <span>{r.targetCategory}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-medium text-indigo-800">
                        {QUEUE_STATUS_LABELS[r.queueStatus]}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedCard(r)}
                      className="text-left text-base font-semibold text-slate-900 hover:text-indigo-700"
                    >
                      {r.generatedIdea?.title || r.sourceTitle}
                    </button>

                    <p className="text-xs leading-relaxed text-slate-600 line-clamp-3">
                      {r.sourceSummary}
                    </p>

                    <div className="text-xs text-slate-600 space-y-1 pt-1">
                      <div>
                        <strong className="text-slate-800">Механика:</strong> {r.storyMechanic}
                      </div>
                      <div>
                        <strong className="text-slate-800">Эмоциональный потенциал:</strong>{' '}
                        {r.readerReactionPotential}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs">
                    <div className="flex items-center gap-3 font-mono tabular-nums text-slate-700">
                      <span>Оригинальность: {r.originalityAssessment}/100</span>
                      <span aria-hidden="true">·</span>
                      <span>Качество: {r.qualityBreakdown.overall}/100</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.sourceUrl && (
                        <a
                          href={r.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-indigo-700 hover:underline"
                        >
                          Оригинал <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => setSelectedCard(r)}
                        className="rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-800 hover:bg-slate-50"
                      >
                        Аналитическая карточка
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          5. ОЧЕРЕДЬ ИДЕЙ
          ===================================================================== */}
      {subTab === 'queue' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1 rounded-md bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setQueueStatusFilter('ALL')}
              className={`rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                queueStatusFilter === 'ALL'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Все ({results.length})
            </button>
            {ALL_QUEUE_STATUSES.map((st) => {
              const count = results.filter((r) => r.queueStatus === st).length;
              return (
                <button
                  key={st}
                  type="button"
                  onClick={() => setQueueStatusFilter(st)}
                  className={`rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap tabular-nums ${
                    queueStatusFilter === st
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {QUEUE_STATUS_LABELS[st]} ({count})
                </button>
              );
            })}
          </div>

          {queueItems.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-600">
              В этом статусе очереди пока нет записей.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
              {queueItems.map((item) => {
                const isBusy = queueBusyId === item.researchId;
                return (
                  <div key={item.researchId} className="p-5 space-y-3">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span className="font-mono font-semibold text-slate-800">
                            {item.researchId}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{item.collection === 'debate' ? 'DEBATE' : 'ROMANTIC'}</span>
                          <span aria-hidden="true">·</span>
                          <span>{item.targetCategory}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-indigo-800">
                            {QUEUE_STATUS_LABELS[item.queueStatus]}
                          </span>
                          {item.duplicateFlag && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                                <AlertTriangle className="h-3 w-3" />
                                Есть совпадение ({item.duplicateMatches[0]?.similarityScore ?? ''}%)
                              </span>
                            </>
                          )}
                          {item.savedStoryId && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono font-semibold text-emerald-700">
                                Сохранено как {item.savedStoryId}
                              </span>
                            </>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => setSelectedCard(item)}
                          className="text-left text-base font-semibold text-slate-900 hover:text-indigo-700"
                        >
                          {item.generatedIdea?.title || item.sourceTitle}
                        </button>

                        <p className="text-xs leading-relaxed text-slate-600">
                          {item.generatedIdea?.shortDescription || item.mainSituation}
                        </p>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="font-mono text-base font-bold text-slate-900 tabular-nums">
                          {item.qualityBreakdown.overall}/100
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {item.qualityBreakdown.tierLabel}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setSelectedCard(item)}
                        className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Просмотреть / редактировать
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleQueueAction(item.researchId, 'analyze')}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3 w-3 ${isBusy ? 'animate-spin' : ''}`} />
                        Переанализировать
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleQueueAction(item.researchId, 'generate')}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <Sparkles className="h-3 w-3" />
                        Новая оригинальная версия
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleQueueAction(item.researchId, 'dedup')}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <ShieldCheck className="h-3 w-3" />
                        Проверить дубли
                      </button>
                      {item.queueStatus !== 'approved_for_database' && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleQueueAction(item.researchId, 'approve')}
                          className="inline-flex items-center gap-1 rounded bg-indigo-700 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-800 disabled:opacity-50"
                        >
                          <Check className="h-3 w-3" />
                          Одобрить в базу
                        </button>
                      )}
                      {item.queueStatus !== 'approved_for_database' &&
                        item.queueStatus !== 'rejected' && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleQueueAction(item.researchId, 'reject')}
                            className="rounded border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            Отклонить
                          </button>
                        )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {selectedCard && (
        <ResearchDetailModal
          result={selectedCard}
          customCategories={customCategories}
          onClose={() => setSelectedCard(null)}
          onUpdated={(next) => {
            setSelectedCard(next);
            setResults((prev) =>
              prev.map((item) => (item.researchId === next.researchId ? next : item))
            );
          }}
          onApprovedToDatabase={async () => {
            await onDatabaseUpdated();
            await loadAllResearch();
          }}
        />
      )}
    </div>
  );
};

const StatCard: React.FC<{
  label: string;
  value: number;
  sub: string;
  onClick?: () => void;
}> = ({ label, value, sub, onClick }) => {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`rounded-lg border border-slate-200 bg-white p-4 text-left ${
        onClick ? 'transition-colors hover:border-indigo-300 hover:bg-slate-50/50' : ''
      }`}
    >
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1.5 font-mono text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
        {value.toLocaleString('ru-RU')}
      </div>
      <div className="mt-1 text-xs text-slate-500">{sub}</div>
    </Wrapper>
  );
};
