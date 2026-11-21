import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Clock,
  ExternalLink,
  Loader2,
  PauseOctagon,
  Play,
  RefreshCw,
  Save,
  Send,
  Sparkles,
} from 'lucide-react';
import {
  AutonomousMonitoringSnapshot,
  AutonomousSchedulerConfig,
  ProcessedMaterialStatus,
} from '../shared/types.js';
import {
  fetchAutonomousState,
  resumeAutonomousScheduler,
  runAutonomousFullCycleNow,
  runAutonomousProductionNow,
  runAutonomousPublishNow,
  runAutonomousResearchNow,
  stopAutonomousScheduler,
  updateAutonomousConfig,
} from '../services/api.js';

interface AutonomousSchedulerSectionProps {
  onDatabaseChanged: () => Promise<void>;
}

const REGISTRY_STATUS_LABELS: Record<ProcessedMaterialStatus, string> = {
  discovered: 'Найден',
  duplicate: 'Дубликат',
  approved: 'В базе сюжетов',
  generating: 'Генерация текста',
  generated: 'Черновик создан',
  quality_check: 'Проверка качества',
  ready: 'Готов к отправке',
  sending: 'Отправляется',
  published_to_telegram: 'Опубликован в TG',
  failed: 'Ошибка',
};

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const AutonomousSchedulerSection: React.FC<AutonomousSchedulerSectionProps> = ({
  onDatabaseChanged,
}) => {
  const [snapshot, setSnapshot] = useState<AutonomousMonitoringSnapshot | null>(null);
  const [cfgForm, setCfgForm] = useState<AutonomousSchedulerConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [regStatusFilter, setRegStatusFilter] = useState<'all' | ProcessedMaterialStatus>('all');
  const [subTab, setSubTab] = useState<'monitor' | 'registry' | 'batches' | 'settings'>('monitor');

  const loadSnapshot = async () => {
    try {
      const data = await fetchAutonomousState();
      setSnapshot(data);
      setCfgForm(data.state.config);
      setErrorMsg(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка загрузки состояния планировщика');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSnapshot();
  }, []);

  const filteredRegistry = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.recentRegistry.filter((e) =>
      regStatusFilter === 'all' ? true : e.status === regStatusFilter
    );
  }, [snapshot, regStatusFilter]);

  const activeBatch = useMemo(() => {
    if (!snapshot) return null;
    return (
      snapshot.state.batches.find((b) => b.batchId === snapshot.state.activeBatchId) ||
      snapshot.state.batches[0] ||
      null
    );
  }, [snapshot]);

  const handleAction = async (
    label: string,
    fn: () => Promise<{ snapshot: AutonomousMonitoringSnapshot; summary?: string }>
  ) => {
    setBusyAction(label);
    setErrorMsg(null);
    setNotice(null);
    try {
      const res = await fn();
      setSnapshot(res.snapshot);
      setCfgForm(res.snapshot.state.config);
      if (res.summary) setNotice(res.summary);
      await onDatabaseChanged();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка выполнения операции');
    } finally {
      setBusyAction(null);
    }
  };

  if (loading || !snapshot || !cfgForm) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-zinc-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Загружаем мониторинг автономного планировщика...
      </div>
    );
  }

  const { state, registryByStatus, readyToPublishCount, pendingAnalysisCount, githubActions } =
    snapshot;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900">
            Autonomous Research & Publishing Scheduler
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            Два независимых расписания для GitHub Actions: поиск и дедупликация новых материалов
            (каждые {state.config.researchIntervalHours} ч.) + производство и лимитированная отправка
            в Telegram (раз в {state.config.publishMinIntervalHours} ч., до{' '}
            {state.config.maxPublishesPerDay}/сутки).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => loadSnapshot()}
            className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-stone-50 cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Обновить
          </button>

          {state.config.stopRequested ? (
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() =>
                handleAction('resume', async () => ({
                  snapshot: await resumeAutonomousScheduler(),
                  summary: 'Планировщик возобновлён (stopRequested=false).',
                }))
              }
              className="inline-flex items-center gap-1.5 rounded-md bg-teal-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-900 cursor-pointer"
            >
              <Play className="h-3.5 w-3.5" />
              Возобновить задания
            </button>
          ) : (
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() =>
                handleAction('stop', async () => ({
                  snapshot: await stopAutonomousScheduler(),
                  summary: 'Включена безопасная остановка: новые автоматические задания приостановлены.',
                }))
              }
              className="inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-900 hover:bg-rose-100 cursor-pointer"
            >
              <PauseOctagon className="h-3.5 w-3.5" />
              Безопасная остановка
            </button>
          )}
        </div>
      </div>

      {/* Notices */}
      {errorMsg && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-900">
          {errorMsg}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-zinc-800">
          {notice}
        </div>
      )}

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <div className="rounded-lg border border-stone-200 bg-white p-3.5">
          <div className="text-[11px] text-zinc-500">Статус автосбора</div>
          <div
            className={`mt-1 font-mono text-sm font-semibold ${
              state.config.stopRequested
                ? 'text-rose-800'
                : state.config.researchEnabled
                  ? 'text-teal-800'
                  : 'text-zinc-600'
            }`}
          >
            {state.config.stopRequested
              ? 'Остановлен'
              : state.config.researchEnabled
                ? 'Включён'
                : 'Выключен'}
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-3.5">
          <div className="text-[11px] text-zinc-500">Найдено всего</div>
          <div className="mt-1 font-mono text-xl font-semibold text-zinc-900 tabular-nums">
            {state.totalDiscoveredMaterials}
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-3.5">
          <div className="text-[11px] text-zinc-500">Дубликатов отсечено</div>
          <div className="mt-1 font-mono text-xl font-semibold text-zinc-700 tabular-nums">
            {registryByStatus.duplicate}
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-3.5">
          <div className="text-[11px] text-zinc-500">Ожидает анализа</div>
          <div className="mt-1 font-mono text-xl font-semibold text-amber-800 tabular-nums">
            {pendingAnalysisCount}
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-3.5">
          <div className="text-[11px] text-zinc-500">Сюжетов в базе</div>
          <div className="mt-1 font-mono text-xl font-semibold text-zinc-900 tabular-nums">
            {state.totalUniqueStoriesSaved}
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-3.5">
          <div className="text-[11px] text-zinc-500">Создано публикаций</div>
          <div className="mt-1 font-mono text-xl font-semibold text-zinc-900 tabular-nums">
            {state.totalPublicationsCreated}
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-3.5">
          <div className="text-[11px] text-zinc-500">Ожидают публикации</div>
          <div className="mt-1 font-mono text-xl font-semibold text-zinc-900 tabular-nums">
            {readyToPublishCount}
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-3.5">
          <div className="text-[11px] text-zinc-500">В Telegram (сегодня)</div>
          <div className="mt-1 font-mono text-xl font-semibold text-teal-800 tabular-nums">
            {state.totalPublishedToTelegram}{' '}
            <span className="text-xs font-normal text-zinc-500">
              ({state.publishedTodayCount}/{state.config.maxPublishesPerDay})
            </span>
          </div>
        </div>
      </div>

      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-stone-200 pb-3">
        {(
          [
            ['monitor', 'Мониторинг и ручной запуск'],
            ['registry', `Постоянный реестр (${snapshot.registryCount})`],
            ['batches', `Партии (${state.batches.length})`],
            ['settings', 'Расписание и лимиты'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSubTab(id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer ${
              subTab === id
                ? 'bg-zinc-900 text-white'
                : 'text-zinc-600 hover:bg-stone-100 hover:text-zinc-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ================================================================ */}
      {/* TAB 1: MONITOR & MANUAL TRIGGER                                  */}
      {/* ================================================================ */}
      {subTab === 'monitor' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Schedule Status */}
            <div className="rounded-lg border border-stone-200 bg-white p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-zinc-500" />
                  Состояние расписаний и текущей партии
                </h3>
                <span className="font-mono text-xs text-zinc-600">
                  {activeBatch ? `${activeBatch.batchId} (${activeBatch.status})` : 'Нет активной партии'}
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs border-t border-stone-200 pt-3">
                <div>
                  <dt className="text-zinc-500">Последний поиск</dt>
                  <dd className="font-mono text-zinc-900 tabular-nums">
                    {fmtDate(state.lastResearchRunAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Следующий поиск</dt>
                  <dd className="font-mono text-zinc-900 tabular-nums">
                    {fmtDate(state.nextScheduledResearchAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Последняя отправка в Telegram</dt>
                  <dd className="font-mono text-zinc-900 tabular-nums">
                    {fmtDate(state.lastSuccessfulTelegramAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Следующее окно публикации</dt>
                  <dd className="font-mono text-zinc-900 tabular-nums">
                    {fmtDate(state.nextScheduledPublishAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Автопубликация в Telegram</dt>
                  <dd
                    className={`font-mono font-medium ${
                      state.config.autoPublishEnabled ? 'text-teal-800' : 'text-zinc-600'
                    }`}
                  >
                    {state.config.autoPublishEnabled ? 'Разрешена' : 'Выключена (безопасный режим)'}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Лимит в сутки</dt>
                  <dd className="font-mono text-zinc-900 tabular-nums">
                    {state.publishedTodayCount} / {state.config.maxPublishesPerDay} (шаг{' '}
                    {state.config.publishMinIntervalHours} ч.)
                  </dd>
                </div>
              </dl>

              {(state.lastResearchError || state.lastProductionError || state.lastPublishError) && (
                <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 space-y-1">
                  <div className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Последние ошибки конвейера
                  </div>
                  {state.lastResearchError && <div>Исследование: {state.lastResearchError}</div>}
                  {state.lastProductionError && <div>Генерация: {state.lastProductionError}</div>}
                  {state.lastPublishError && <div>Публикация: {state.lastPublishError}</div>}
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-2 border-t border-stone-200">
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() =>
                    handleAction('research', async () => {
                      const r = await runAutonomousResearchNow();
                      return { snapshot: r.snapshot, summary: r.log.summary };
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 cursor-pointer"
                >
                  {busyAction === 'research' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Activity className="h-3.5 w-3.5" />
                  )}
                  Запустить поиск (партия)
                </button>

                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() =>
                    handleAction('production', async () => {
                      const r = await runAutonomousProductionNow();
                      return { snapshot: r.snapshot, summary: r.log.summary };
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-stone-50 cursor-pointer"
                >
                  {busyAction === 'production' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Сгенерировать публикации
                </button>

                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() =>
                    handleAction('publish_dry', async () => {
                      const r = await runAutonomousPublishNow({ dryRun: true });
                      return { snapshot: r.snapshot, summary: r.log.summary };
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-stone-50 cursor-pointer"
                >
                  <Send className="h-3.5 w-3.5" />
                  Очередь отправки (Dry-Run)
                </button>

                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() =>
                    handleAction('full', async () => {
                      const r = await runAutonomousFullCycleNow({ dryRunPublish: true });
                      return {
                        snapshot: r.snapshot,
                        summary: `${r.result.research.summary} | ${r.result.production.summary} | ${r.result.publish.summary}`,
                      };
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded bg-rose-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-900 cursor-pointer"
                >
                  {busyAction === 'full' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  Полный цикл (Dry-Run)
                </button>
              </div>
            </div>

            {/* Real GitHub Actions Status */}
            <div className="rounded-lg border border-stone-200 bg-white p-5 space-y-3">
              <h3 className="text-sm font-semibold text-zinc-900">
                Реальный статус GitHub Actions (`melo-love-research.yml`)
              </h3>
              <p className="text-xs text-zinc-600">{githubActions.note}</p>

              {githubActions.runs.length === 0 ? (
                <div className="rounded border border-stone-200 bg-stone-50 p-4 text-xs text-zinc-600">
                  Укажите репозиторий <code>owner/repo</code> во вкладке «Расписание и лимиты» (и
                  для приватных репозиториев задайте серверный <code>GITHUB_TOKEN</code>), чтобы
                  подтягивать реальные запуски GitHub Actions. Фиктивный статус не отображается.
                </div>
              ) : (
                <div className="divide-y divide-stone-200 rounded border border-stone-200">
                  {githubActions.runs.map((run) => (
                    <div
                      key={run.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                    >
                      <div>
                        <div className="font-medium text-zinc-900">
                          #{run.id} · {run.event}
                        </div>
                        <div className="font-mono text-[11px] text-zinc-500 tabular-nums">
                          {fmtDate(run.createdAt)} · {run.status} / {run.conclusion || 'in_progress'}
                        </div>
                      </div>
                      {run.htmlUrl && (
                        <a
                          href={run.htmlUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-zinc-700 hover:underline"
                        >
                          Лог <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Run History */}
          <div className="rounded-lg border border-stone-200 bg-white overflow-hidden">
            <div className="border-b border-stone-200 px-5 py-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900">Журнал последних запусков</h3>
              <span className="font-mono text-xs text-zinc-500 tabular-nums">
                {state.runHistory.length} записей
              </span>
            </div>
            {state.runHistory.length === 0 ? (
              <div className="px-5 py-8 text-center text-xs text-zinc-500">
                Запусков планировщика ещё не было.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-stone-200 bg-stone-50 text-zinc-500">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Время</th>
                      <th className="px-4 py-2.5 font-medium">Этап / Режим</th>
                      <th className="px-4 py-2.5 font-medium">Найдено / Новых / Дубл.</th>
                      <th className="px-4 py-2.5 font-medium">Анализ / Сюжеты / TG</th>
                      <th className="px-4 py-2.5 font-medium">Итог</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {state.runHistory.slice(0, 15).map((r) => (
                      <tr key={r.runId}>
                        <td className="px-4 py-2.5 font-mono text-zinc-600 tabular-nums whitespace-nowrap">
                          {fmtDate(r.finishedAt)}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-zinc-800 whitespace-nowrap">
                          {r.kind} · {r.mode}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-zinc-700 tabular-nums whitespace-nowrap">
                          {r.discovered} / {r.uniqueAdded} / {r.duplicates}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-zinc-700 tabular-nums whitespace-nowrap">
                          {r.analyzed} / {r.storiesApproved} / {r.publishedToTelegram}
                        </td>
                        <td className="px-4 py-2.5 text-zinc-800">{r.summary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB 2: PERMANENT REGISTRY                                        */}
      {/* ================================================================ */}
      {subTab === 'registry' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-zinc-600">
              Постоянный реестр всех обнаруженных материалов (`data/processed_materials_registry.json`).
              Не очищается при новых партиях и защищает от повторного сбора и отправки.
            </p>
            <select
              value={regStatusFilter}
              onChange={(e) =>
                setRegStatusFilter(e.target.value as 'all' | ProcessedMaterialStatus)
              }
              className="rounded border border-stone-200 bg-white px-3 py-1.5 text-xs"
            >
              <option value="all">Все статусы ({snapshot.registryCount})</option>
              {(Object.keys(REGISTRY_STATUS_LABELS) as ProcessedMaterialStatus[]).map((st) => (
                <option key={st} value={st}>
                  {REGISTRY_STATUS_LABELS[st]} ({registryByStatus[st] || 0})
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-lg border border-stone-200 bg-white overflow-x-auto">
            {filteredRegistry.length === 0 ? (
              <div className="px-5 py-10 text-center text-xs text-zinc-500">
                Записей в реестре пока нет.
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-stone-200 bg-stone-50 text-zinc-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">ID / Статус</th>
                    <th className="px-4 py-2.5 font-medium">Заголовок / Источник</th>
                    <th className="px-4 py-2.5 font-medium">Связи ID</th>
                    <th className="px-4 py-2.5 font-medium">Обнаружен</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {filteredRegistry.map((entry) => (
                    <tr key={entry.id}>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="font-mono font-semibold text-zinc-900">{entry.id}</div>
                        <div className="text-[11px] text-zinc-600">
                          {REGISTRY_STATUS_LABELS[entry.status]}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 max-w-md">
                        <div className="font-medium text-zinc-900 truncate">{entry.title}</div>
                        <div className="font-mono text-[11px] text-zinc-500 truncate">
                          {entry.sourceName} · {entry.url}
                        </div>
                        {entry.error && (
                          <div className="mt-0.5 text-[11px] text-rose-800">{entry.error}</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-zinc-700 whitespace-nowrap">
                        {[
                          entry.researchId,
                          entry.storyId,
                          entry.contentId,
                          entry.publicationId,
                          entry.telegramMessageId ? `tg:${entry.telegramMessageId}` : null,
                        ]
                          .filter(Boolean)
                          .join(' → ') || '—'}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-zinc-500 tabular-nums whitespace-nowrap">
                        {fmtDate(entry.discoveredAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB 3: BATCHES                                                   */}
      {/* ================================================================ */}
      {subTab === 'batches' && (
        <div className="rounded-lg border border-stone-200 bg-white overflow-x-auto">
          {state.batches.length === 0 ? (
            <div className="px-5 py-10 text-center text-xs text-zinc-500">
              Автоматические партии ещё не запускались.
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="border-b border-stone-200 bg-stone-50 text-zinc-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Партия</th>
                  <th className="px-4 py-2.5 font-medium">Рубрика</th>
                  <th className="px-4 py-2.5 font-medium">Статус</th>
                  <th className="px-4 py-2.5 font-medium">Найдено / Новых / Дубл. / Анализ</th>
                  <th className="px-4 py-2.5 font-medium">Начало / Завершение</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {state.batches.map((b) => (
                  <tr key={b.batchId}>
                    <td className="px-4 py-2.5 font-mono font-semibold text-zinc-900">
                      {b.batchId}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-700">
                      {b.collection === 'debate' ? 'Споры и мнения' : 'Романтика'}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-zinc-800">{b.status}</td>
                    <td className="px-4 py-2.5 font-mono text-zinc-700 tabular-nums">
                      {b.discoveredCount} / {b.newUniqueCount} / {b.duplicateCount} / {b.analyzedCount}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-zinc-500 tabular-nums">
                      {fmtDate(b.startedAt)} → {fmtDate(b.finishedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB 4: CONFIG                                                    */}
      {/* ================================================================ */}
      {subTab === 'settings' && (
        <div className="rounded-lg border border-stone-200 bg-white p-6 space-y-5 max-w-3xl">
          <h3 className="text-sm font-semibold text-zinc-900">
            Параметры автономного исследования и публикаций
          </h3>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="block text-xs font-medium text-zinc-700">
              Интервал поиска (часы)
              <input
                type="number"
                min={1}
                max={48}
                value={cfgForm.researchIntervalHours}
                onChange={(e) =>
                  setCfgForm({ ...cfgForm, researchIntervalHours: Number(e.target.value) || 4 })
                }
                className="mt-1 w-full rounded border border-stone-200 px-3 py-2 font-mono text-sm tabular-nums"
              />
            </label>
            <label className="block text-xs font-medium text-zinc-700">
              Размер партии поиска (за запуск)
              <input
                type="number"
                min={1}
                max={10}
                value={cfgForm.researchBatchSize}
                onChange={(e) =>
                  setCfgForm({ ...cfgForm, researchBatchSize: Number(e.target.value) || 4 })
                }
                className="mt-1 w-full rounded border border-stone-200 px-3 py-2 font-mono text-sm tabular-nums"
              />
            </label>
            <label className="block text-xs font-medium text-zinc-700">
              Размер генерации (постов/запуск)
              <input
                type="number"
                min={1}
                max={5}
                value={cfgForm.productionBatchSize}
                onChange={(e) =>
                  setCfgForm({ ...cfgForm, productionBatchSize: Number(e.target.value) || 3 })
                }
                className="mt-1 w-full rounded border border-stone-200 px-3 py-2 font-mono text-sm tabular-nums"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="block text-xs font-medium text-zinc-700">
              Мин. интервал публикаций (часы)
              <input
                type="number"
                min={1}
                max={24}
                value={cfgForm.publishMinIntervalHours}
                onChange={(e) =>
                  setCfgForm({ ...cfgForm, publishMinIntervalHours: Number(e.target.value) || 2 })
                }
                className="mt-1 w-full rounded border border-stone-200 px-3 py-2 font-mono text-sm tabular-nums"
              />
            </label>
            <label className="block text-xs font-medium text-zinc-700">
              Макс. публикаций в сутки
              <input
                type="number"
                min={1}
                max={12}
                value={cfgForm.maxPublishesPerDay}
                onChange={(e) =>
                  setCfgForm({ ...cfgForm, maxPublishesPerDay: Number(e.target.value) || 12 })
                }
                className="mt-1 w-full rounded border border-stone-200 px-3 py-2 font-mono text-sm tabular-nums"
              />
            </label>
            <label className="block text-xs font-medium text-zinc-700">
              Чередование рубрик
              <select
                value={cfgForm.collectionsRotation}
                onChange={(e) =>
                  setCfgForm({
                    ...cfgForm,
                    collectionsRotation: e.target.value as AutonomousSchedulerConfig['collectionsRotation'],
                  })
                }
                className="mt-1 w-full rounded border border-stone-200 bg-white px-3 py-2 text-xs"
              >
                <option value="alternate">Чередовать (Споры / Романтика)</option>
                <option value="debate">Только «Кто здесь прав?»</option>
                <option value="romantic">Только «Романтические истории»</option>
              </select>
            </label>
          </div>

          <label className="block text-xs font-medium text-zinc-700">
            GitHub репозиторий (owner/repo) для мониторинга workflow
            <input
              type="text"
              value={cfgForm.githubRepo || ''}
              onChange={(e) => setCfgForm({ ...cfgForm, githubRepo: e.target.value })}
              placeholder="username/melo-love"
              className="mt-1 w-full rounded border border-stone-200 px-3 py-2 font-mono text-xs"
            />
          </label>

          <div className="space-y-2 text-xs text-zinc-800">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={cfgForm.researchEnabled}
                onChange={(e) => setCfgForm({ ...cfgForm, researchEnabled: e.target.checked })}
              />
              <span>Включить автономный RESEARCH SCHEDULER (сбор и анализ по расписанию)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={cfgForm.autoPublishEnabled}
                onChange={(e) => setCfgForm({ ...cfgForm, autoPublishEnabled: e.target.checked })}
              />
              <span>
                Разрешить автоматическую отправку готовых публикаций в Telegram (требует также
                TELEGRAM_AUTO_SEND_ENABLED=true и настроенных Secrets)
              </span>
            </label>
          </div>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() =>
              handleAction('save_cfg', async () => ({
                snapshot: await updateAutonomousConfig(cfgForm),
                summary: 'Параметры автономного планировщика сохранены.',
              }))
            }
            className="inline-flex items-center gap-1.5 rounded bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 cursor-pointer"
          >
            <Save className="h-3.5 w-3.5" />
            Сохранить настройки планировщика
          </button>
        </div>
      )}
    </div>
  );
};
