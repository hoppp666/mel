import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Check,
  Copy,
  Database,
  Download,
  ExternalLink,
  FolderPlus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react';
import {
  EXTERNAL_SOURCE_GUIDES,
  getCategoriesForCollection,
} from '../shared/categories.ts';
import { SUPABASE_SQL_SCHEMA } from '../shared/similarity.ts';
import type {
  AppSettings,
  BatchRecord,
  CollectionType,
  DatabaseStats,
  NavSection,
  SimilarityMatch,
  StoryPlot,
  VerificationStatus,
} from '../shared/types.ts';
import * as api from '../services/api.ts';
import type { BackupSnapshotInfo, StagedBatch } from '../services/api.ts';

/* ============================================================================
   1. ОБЩИЙ ОБЗОР (OVERVIEW)
   ============================================================================ */
export const OverviewSection: React.FC<{
  stats: DatabaseStats;
  settings: AppSettings;
  stories: StoryPlot[];
  batches: BatchRecord[];
  stagedBatch: StagedBatch | null;
  onNavigate: (section: NavSection, categoryFilter?: string) => void;
  onLaunchBatch: (collection?: CollectionType) => void;
  onSelectStory: (story: StoryPlot) => void;
}> = ({
  stats,
  settings,
  stories,
  batches,
  stagedBatch,
  onNavigate,
  onLaunchBatch,
  onSelectStory,
}) => {
  const recentStories = useMemo(() => stories.slice(0, 6), [stories]);

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Интеллектуальная библиотека сюжетов MELO_LOVE
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Центральное хранилище проверенных сюжетных основ для будущих публикаций: контроль
            уникальности, оценка качества и пакетное пополнение.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onLaunchBatch('debate')}
          className="inline-flex items-center gap-2 rounded-md bg-indigo-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-800 whitespace-nowrap shrink-0"
        >
          <Sparkles className="h-4 w-4" />
          Создать следующую партию
        </button>
      </div>

      {/* Staged batch reminder if unfinished */}
      {stagedBatch && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-indigo-200 bg-indigo-50/70 px-5 py-3.5">
          <div className="text-sm text-indigo-950">
            <strong>Незавершённая проверка партии #{stagedBatch.batchNumber}:</strong> в очереди{' '}
            <span className="font-mono font-semibold tabular-nums">
              {stagedBatch.candidates.length}
            </span>{' '}
            сюжетов ({stagedBatch.collection === 'debate' ? 'Кто здесь прав?' : 'Романтические'}).
          </div>
          <button
            type="button"
            onClick={() => onLaunchBatch(stagedBatch.collection)}
            className="rounded-md bg-indigo-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-800 whitespace-nowrap"
          >
            Продолжить проверку партии
          </button>
        </div>
      )}

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiBox
          label="Всего сюжетов в базе"
          value={stats.total}
          sub={`Цель: ${settings.targetTotalStories.toLocaleString('ru-RU')} записей`}
        />
        <KpiBox
          label="Коллекция A: Кто здесь прав?"
          value={stats.debateTotal}
          sub={`${stats.debateProgressPercent}% от цели ${settings.targetDebateStories}`}
          onClick={() => onNavigate('debate')}
        />
        <KpiBox
          label="Коллекция B: Романтические"
          value={stats.romanticTotal}
          sub={`${stats.romanticProgressPercent}% от цели ${settings.targetRomanticStories}`}
          onClick={() => onNavigate('romantic')}
        />
        <KpiBox
          label="Проверено и принято"
          value={stats.approved}
          sub={`Средний балл качества: ${stats.averageQuality}/100`}
        />
      </div>

      {/* Secondary Operational Metrics */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiBox
          label="Ожидает проверки"
          value={stats.pending}
          sub="В очереди редактора"
          onClick={() => onNavigate('quality')}
        />
        <KpiBox
          label="На доработке"
          value={stats.needsRevision}
          sub="Нужно усилить детали"
          onClick={() => onNavigate('quality')}
        />
        <KpiBox
          label="Отклонено"
          value={stats.rejected}
          sub="Не прошли порог качества"
        />
        <KpiBox
          label="Совпадений / дублей"
          value={stats.duplicatesDetected}
          sub="Смысловой фильтр уникальности"
          onClick={() => onNavigate('uniqueness')}
        />
      </div>

      {/* Progress to 3000 */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Прогресс накопления целевой библиотеки (3000 проверенных сюжетов)
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Порядок наполнения: партии 1–30 — дискуссионные истории, партии 31–60 — романтические
              истории.
            </p>
          </div>
          <span className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
            {stats.approved} / {settings.targetTotalStories} ({stats.progressPercent}%)
          </span>
        </div>

        <div className="space-y-3">
          <ProgressBar
            label="Коллекция A — «Кто здесь прав?» (цель 1500)"
            current={stats.debateTotal}
            target={settings.targetDebateStories}
            percent={stats.debateProgressPercent}
          />
          <ProgressBar
            label="Коллекция B — «Романтические истории» (цель 1500)"
            current={stats.romanticTotal}
            target={settings.targetRomanticStories}
            percent={stats.romanticProgressPercent}
          />
        </div>
      </div>

      {/* Two-Column Lower Workspace: Batch Log + Recent Additions */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-base font-semibold text-slate-900">Журнал партий</h2>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              Всего партий: {batches.length}
            </span>
          </div>
          <div className="mt-3 divide-y divide-slate-100">
            {batches.slice(0, 8).map((b) => (
              <div key={`${b.batchNumber}-${b.createdAt}`} className="py-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">
                    <span className="font-mono">Партия #{b.batchNumber}</span> ·{' '}
                    {b.collection === 'debate' ? 'Кто здесь прав?' : 'Романтические'}
                  </span>
                  <span className="font-mono text-slate-500 tabular-nums">
                    {new Date(b.createdAt).toLocaleDateString('ru-RU')}
                  </span>
                </div>
                <p className="mt-1 text-slate-600">{b.notes}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-base font-semibold text-slate-900">Недавние сюжеты в базе</h2>
            <button
              type="button"
              onClick={() => onNavigate('debate')}
              className="text-xs font-medium text-indigo-700 hover:underline"
            >
              Перейти ко всем →
            </button>
          </div>
          <div className="mt-3 divide-y divide-slate-100">
            {recentStories.map((s) => (
              <div key={s.id} className="py-3">
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                  <span>
                    <span className="font-mono text-slate-700">{s.id}</span> · {s.category}
                  </span>
                  <span className="font-mono font-medium text-slate-800 tabular-nums">
                    {s.quality.overall}/100
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectStory(s)}
                  className="mt-0.5 text-left text-sm font-medium text-slate-900 hover:text-indigo-700"
                >
                  {s.title}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
   2. КАТЕГОРИИ (CATEGORIES)
   ============================================================================ */
export const CategoriesSection: React.FC<{
  stories: StoryPlot[];
  customCategories: { debate: string[]; romantic: string[] };
  onAddCategory: (collection: CollectionType, name: string) => Promise<void>;
  onOpenCollectionCategory: (collection: CollectionType, category: string) => void;
}> = ({ stories, customCategories, onAddCategory, onOpenCollectionCategory }) => {
  const [activeCollection, setActiveCollection] = useState<CollectionType>('debate');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [adding, setAdding] = useState(false);

  const categories = getCategoriesForCollection(activeCollection, customCategories);

  const countsByCat = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of stories) {
      if (s.collection === activeCollection && s.verificationStatus !== 'rejected') {
        map.set(s.category, (map.get(s.category) ?? 0) + 1);
      }
    }
    return map;
  }, [stories, activeCollection]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    setAdding(true);
    try {
      await onAddCategory(activeCollection, newCategoryName.trim());
      setNewCategoryName('');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Тематическая карта и баланс категорий
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Контроль наполнения всех направлений для равномерного роста базы к 3000 сюжетов.
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setActiveCollection('debate')}
            className={`rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
              activeCollection === 'debate'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Кто здесь прав? ({getCategoriesForCollection('debate', customCategories).length})
          </button>
          <button
            type="button"
            onClick={() => setActiveCollection('romantic')}
            className={`rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
              activeCollection === 'romantic'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Романтические ({getCategoriesForCollection('romantic', customCategories).length})
          </button>
        </div>
      </div>

      {/* Add new direction */}
      <form
        onSubmit={handleAdd}
        className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4"
      >
        <input
          type="text"
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          placeholder="Добавить новое тематическое направление (например, «Соседство и дача»)..."
          className="min-w-[260px] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
        />
        <button
          type="submit"
          disabled={adding || !newCategoryName.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-700 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-800 disabled:opacity-50 whitespace-nowrap"
        >
          <FolderPlus className="h-3.5 w-3.5" />
          Добавить категорию
        </button>
      </form>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((cat) => {
          const count = countsByCat.get(cat) ?? 0;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => onOpenCollectionCategory(activeCollection, cat)}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left transition-colors hover:border-indigo-300 hover:bg-slate-50"
            >
              <span className="truncate pr-3 text-sm font-medium text-slate-900">{cat}</span>
              <span
                className={`font-mono text-xs font-semibold tabular-nums ${
                  count === 0 ? 'text-slate-400' : 'text-indigo-700'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

/* ============================================================================
   3. ЗАРУБЕЖНЫЕ ИСТОЧНИКИ (EXTERNAL SOURCES)
   ============================================================================ */
export const SourcesSection: React.FC<{
  stories: StoryPlot[];
  onLaunchSearchBatch: () => void;
  onSelectStory: (story: StoryPlot) => void;
}> = ({ stories, onLaunchSearchBatch, onSelectStory }) => {
  const externalStories = useMemo(
    () => stories.filter((s) => s.originType === 'external'),
    [stories]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Исследование зарубежных источников
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Реестр международных площадок для поиска житейских механик. Внешний URL сохраняется
            строго при подтверждении реальным поиском — вымышленные ссылки запрещены.
          </p>
        </div>
        <button
          type="button"
          onClick={onLaunchSearchBatch}
          className="inline-flex items-center gap-2 rounded-md bg-indigo-700 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-800 whitespace-nowrap"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Запустить партию с Google Search
        </button>
      </div>

      {/* Transparency summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiBox
          label="Оригинальные сюжеты"
          value={stories.filter((s) => s.originType === 'original').length}
          sub="Явно помечены без внешнего URL"
        />
        <KpiBox
          label="Вдохновлено внешними источниками"
          value={externalStories.length}
          sub="С подтверждённым URL и аналитической заметкой"
        />
        <KpiBox
          label="Приоритетных площадок"
          value={EXTERNAL_SOURCE_GUIDES.length}
          sub="Reddit, NYT Modern Love, The Cut"
        />
      </div>

      {/* Source Directory */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {EXTERNAL_SOURCE_GUIDES.map((src) => (
          <div
            key={src.id}
            className="rounded-lg border border-slate-200 bg-white p-5 space-y-2.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs text-slate-500">{src.platform}</div>
                <h3 className="text-base font-semibold text-slate-900">{src.name}</h3>
              </div>
              <a
                href={src.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:underline shrink-0"
              >
                Открыть <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <p className="text-xs leading-relaxed text-slate-600">{src.focus}</p>
            <div className="border-t border-slate-100 pt-2 text-xs text-slate-700">
              <strong>Ключевые механики:</strong> {src.mechanicsExtracted.join(' · ')}
            </div>
            <div className="text-xs text-slate-500">
              <strong>Принцип переосмысления:</strong> {src.adaptationPrinciples}
            </div>
          </div>
        ))}
      </div>

      {/* External stories ledger */}
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-900">
          Записи с подтверждёнными внешними ссылками
        </h2>
        {externalStories.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            Пока все {stories.length} стартовых сюжетов созданы как оригинальные редакционные
            разработки (без вымышленных URL). Запустите партию в режиме «Google Search + адаптация»
            или добавьте проверенный источник вручную в паспорте сюжета.
          </p>
        ) : (
          <div className="mt-3 divide-y divide-slate-100">
            {externalStories.map((s) => (
              <div key={s.id} className="py-3 flex items-start justify-between gap-4">
                <div>
                  <button
                    type="button"
                    onClick={() => onSelectStory(s)}
                    className="text-sm font-semibold text-slate-900 hover:text-indigo-700 text-left"
                  >
                    {s.id} · {s.title}
                  </button>
                  <p className="mt-0.5 text-xs text-slate-600">
                    {s.sourceAnalysisNote || s.ideaSource}
                  </p>
                </div>
                {s.sourceUrl && (
                  <a
                    href={s.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-indigo-700 hover:underline shrink-0"
                  >
                    Источник <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/* ============================================================================
   4. ПРОВЕРКА УНИКАЛЬНОСТИ (UNIQUENESS CONSOLE)
   ============================================================================ */
export const UniquenessSection: React.FC<{
  stories: StoryPlot[];
  threshold: number;
  onRescan: () => Promise<void>;
  onSelectStory: (story: StoryPlot) => void;
}> = ({ stories, threshold, onRescan, onSelectStory }) => {
  const [scanning, setScanning] = useState(false);
  const [testTitle, setTestTitle] = useState('');
  const [testPlot, setTestPlot] = useState('');
  const [testCollection, setTestCollection] = useState<CollectionType>('debate');
  const [testMatches, setTestMatches] = useState<SimilarityMatch[] | null>(null);
  const [checking, setChecking] = useState(false);

  const flaggedStories = useMemo(
    () =>
      stories.filter(
        (s) => s.duplicateFlag || (s.similarityMatches && s.similarityMatches.length > 0)
      ),
    [stories]
  );

  const handleRescan = async () => {
    setScanning(true);
    try {
      await onRescan();
    } finally {
      setScanning(false);
    }
  };

  const handleTestCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testTitle.trim() && !testPlot.trim()) return;
    setChecking(true);
    try {
      const res = await api.checkSimilarity({
        collection: testCollection,
        title: testTitle,
        shortDescription: testPlot,
        fullPlot: testPlot,
        coreConflictOrAction: testPlot,
      });
      setTestMatches(res.matches);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Проверка смысловой уникальности
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Анализ лексико-тематической и структурной близости по отпечатку, теме, участникам и
            механике (порог срабатывания: <span className="font-mono">{threshold}%</span>).
          </p>
        </div>
        <button
          type="button"
          onClick={handleRescan}
          disabled={scanning}
          className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} />
          {scanning ? 'Пересканирование...' : 'Перепроверить всю базу'}
        </button>
      </div>

      {/* Live Idea Sandbox Checker */}
      <form
        onSubmit={handleTestCheck}
        className="rounded-lg border border-slate-200 bg-white p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">
            Проверить новую идею на смысловой повтор перед добавлением
          </h2>
          <select
            value={testCollection}
            onChange={(e) => setTestCollection(e.target.value as CollectionType)}
            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-800"
          >
            <option value="debate">Коллекция A: Кто здесь прав?</option>
            <option value="romantic">Коллекция B: Романтические</option>
          </select>
        </div>
        <input
          type="text"
          value={testTitle}
          onChange={(e) => setTestTitle(e.target.value)}
          placeholder="Короткий заголовок идеи (напр., «Парень не купил подарок на годовщину»)"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
        />
        <textarea
          rows={3}
          value={testPlot}
          onChange={(e) => setTestPlot(e.target.value)}
          placeholder="Опишите суть конфликта или сцены, участников и ключевую деталь..."
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">
            Сравниваются стеммы слов, сюжетные биграммы, механика и семантический отпечаток.
          </span>
          <button
            type="submit"
            disabled={checking}
            className="rounded-md bg-indigo-700 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-800 disabled:opacity-50"
          >
            {checking ? 'Проверка...' : 'Проверить сходство'}
          </button>
        </div>

        {testMatches !== null && (
          <div className="border-t border-slate-100 pt-3">
            {testMatches.length === 0 ? (
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-800">
                <ShieldCheck className="h-4 w-4" />
                Похожих сюжетов не найдено — идея уникальна относительно текущих {stories.length}{' '}
                записей.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-amber-900">
                  Обнаружены похожие записи ({testMatches.length}):
                </div>
                {testMatches.map((m) => (
                  <div
                    key={m.matchedId}
                    className="rounded border border-amber-200 bg-amber-50/60 p-3 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2 font-semibold text-slate-900">
                      <span>
                        <span className="font-mono">{m.matchedId}</span> · {m.matchedTitle}
                      </span>
                      <span className="font-mono text-amber-800 tabular-nums">
                        {m.similarityScore}%
                      </span>
                    </div>
                    <p className="mt-1 text-slate-600">{m.matchedShortDescription}</p>
                    <p className="mt-1 text-amber-900">{m.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </form>

      {/* Flagged overlaps inside existing DB */}
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-900">
          Потенциальные пересечения в текущей базе ({flaggedStories.length})
        </h2>
        {flaggedStories.length === 0 ? (
          <div className="mt-3 flex items-center gap-2 text-sm text-emerald-800">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span>
              Все {stories.length} сюжетов прошли проверку при пороге {threshold}% — дубли не
              обнаружены.
            </span>
          </div>
        ) : (
          <div className="mt-3 divide-y divide-slate-200">
            {flaggedStories.map((s) => (
              <div key={s.id} className="py-3.5 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => onSelectStory(s)}
                    className="text-left text-sm font-semibold text-slate-900 hover:text-indigo-700"
                  >
                    <span className="font-mono text-xs text-slate-500 mr-2">{s.id}</span>
                    {s.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectStory(s)}
                    className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Разобрать / объединить
                  </button>
                </div>
                {s.similarityMatches?.map((m) => (
                  <div
                    key={m.matchedId}
                    className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50/50 px-3 py-2 text-xs text-amber-950"
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
                    <div>
                      <strong>
                        Совпадение {m.similarityScore}% с {m.matchedId} («{m.matchedTitle}»):
                      </strong>{' '}
                      {m.reason}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/* ============================================================================
   5. КАЧЕСТВО ИДЕЙ (QUALITY AUDIT)
   ============================================================================ */
export const QualitySection: React.FC<{
  stories: StoryPlot[];
  minScore: number;
  onSelectStory: (story: StoryPlot) => void;
  onQuickStatus: (id: string, status: VerificationStatus) => Promise<void>;
}> = ({ stories, minScore, onSelectStory, onQuickStatus }) => {
  const queue = useMemo(
    () =>
      stories
        .filter((s) => s.verificationStatus === 'pending' || s.verificationStatus === 'needs_revision')
        .sort((a, b) => a.quality.overall - b.quality.overall),
    [stories]
  );

  const distribution = useMemo(() => {
    const active = stories.filter((s) => s.verificationStatus !== 'rejected');
    return {
      high: active.filter((s) => s.quality.overall >= 90).length,
      good: active.filter((s) => s.quality.overall >= 80 && s.quality.overall < 90).length,
      medium: active.filter((s) => s.quality.overall >= minScore && s.quality.overall < 80).length,
      weak: active.filter((s) => s.quality.overall < minScore).length,
    };
  }, [stories, minScore]);

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Контроль качества сюжетных основ
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Критическая оценка по шкале 0–100: оригинальность, жизненность, конкретность,
          вариативность и специфические метрики каждой коллекции (порог одобрения: {minScore}).
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiBox label="Отличные (90–100)" value={distribution.high} sub="Эталонные сюжеты" />
        <KpiBox label="Сильные (80–89)" value={distribution.good} sub="Готовы к работе" />
        <KpiBox
          label={`Рабочие (${minScore}–79)`}
          value={distribution.medium}
          sub="Допустимы, можно усилить"
        />
        <KpiBox
          label={`Ниже порога (<${minScore})`}
          value={distribution.weak}
          sub="На доработку или отклонение"
        />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 className="text-base font-semibold text-slate-900">
            Очередь редакторской проверки ({queue.length})
          </h2>
          <span className="text-xs text-slate-500">Сначала слабые оценки</span>
        </div>

        {queue.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">
            Все текущие сюжеты в базе проверены. Запустите следующую партию, чтобы пополнить
            очередь.
          </p>
        ) : (
          <div className="mt-2 divide-y divide-slate-200">
            {queue.map((s) => (
              <div
                key={s.id}
                className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono text-slate-700">{s.id}</span>
                    <span aria-hidden="true">·</span>
                    <span>{s.collection === 'debate' ? 'Кто здесь прав?' : 'Романтическая'}</span>
                    <span aria-hidden="true">·</span>
                    <span>{s.category}</span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={
                        s.verificationStatus === 'needs_revision'
                          ? 'font-medium text-amber-700'
                          : 'text-slate-600'
                      }
                    >
                      {s.verificationStatus === 'needs_revision'
                        ? 'На доработке'
                        : 'Ожидает проверки'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectStory(s)}
                    className="mt-1 text-left text-sm font-semibold text-slate-900 hover:text-indigo-700"
                  >
                    {s.title}
                  </button>
                  <p className="mt-0.5 text-xs text-slate-600">{s.quality.editorialNote}</p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono text-base font-bold text-slate-900 tabular-nums">
                    {s.quality.overall}/100
                  </span>
                  <button
                    type="button"
                    onClick={() => onQuickStatus(s.id, 'approved')}
                    className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Принять
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectStory(s)}
                    className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Доработать
                  </button>
                  <button
                    type="button"
                    onClick={() => onQuickStatus(s.id, 'rejected')}
                    className="rounded border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    Отклонить
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/* ============================================================================
   6. ЭКСПОРТ БАЗЫ, БЭКАПЫ И SUPABASE-СХЕМА (EXPORT)
   ============================================================================ */
export const ExportSection: React.FC<{
  stats: DatabaseStats;
  backups: BackupSnapshotInfo[];
  onCreateBackup: () => Promise<void>;
  onRestoreBackup: (filename: string) => Promise<void>;
  onImported: () => Promise<void>;
}> = ({ stats, backups, onCreateBackup, onRestoreBackup, onImported }) => {
  const [exportCollection, setExportCollection] = useState<'all' | 'debate' | 'romantic'>('all');
  const [onlyApproved, setOnlyApproved] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);

  const buildQuery = () => {
    const p = new URLSearchParams();
    if (exportCollection !== 'all') p.set('collection', exportCollection);
    if (onlyApproved) p.set('onlyApproved', 'true');
    const qs = p.toString();
    return qs ? `?${qs}` : '';
  };

  const handleBackupNow = async () => {
    setCreatingBackup(true);
    try {
      await onCreateBackup();
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportStatus(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : parsed.stories;
      if (!Array.isArray(list)) {
        setImportStatus('Ошибка: файл должен содержать массив stories.');
        return;
      }
      const res = await api.importJsonStories(list, true);
      setImportStatus(
        `Импортировано: ${res.importedCount} сюжетов. Пропущено дублей: ${res.skippedDuplicatesCount}.`
      );
      await onImported();
    } catch (err) {
      setImportStatus(`Ошибка импорта: ${(err as Error).message}`);
    }
  };

  const handleCopySql = () => {
    navigator.clipboard.writeText(SUPABASE_SQL_SCHEMA);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Экспорт, резервное копирование и подготовка к Supabase
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Все данные сохраняются локально на диске сервера (UTF-8) без ложного ощущения облачной
          синхронизации. Готово к прямому импорту в Supabase PostgreSQL.
        </p>
      </div>

      {/* Full GitHub Project + DB Archive */}
      <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-5 space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1.5 max-w-2xl">
            <div className="flex items-center gap-2 text-indigo-800">
              <Archive className="h-4 w-4 shrink-0" />
              <h2 className="text-base font-semibold text-slate-900">
                Полный архив этапа 1 для переноса на GitHub (.zip)
              </h2>
            </div>
            <p className="text-xs leading-relaxed text-slate-700">
              Архив содержит весь исходный код (<code>src/</code>, <code>server/</code>,{' '}
              <code>server.ts</code>, конфигурации), текущую базу сюжетов{' '}
              <code>data/melo_love_db.json</code> ({stats.total} записей), <code>README.md</code>{' '}
              и документацию <code>MELO_LOVE_SUMMARY.txt</code>. Лишние папки (
              <code>node_modules</code>, <code>dist</code>, <code>.env</code>, временные снимки)
              исключены по <code>.gitignore</code>.
            </p>
          </div>
          <a
            href="/api/export/archive"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-indigo-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-indigo-800 shrink-0"
          >
            <Download className="h-4 w-4" />
            Скачать архив этапа 1 (.zip)
          </a>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-md border border-slate-200 bg-white p-3.5 text-xs text-slate-700 space-y-1.5">
            <div className="font-semibold text-slate-900">
              Через браузер на GitHub (без консоли и bash)
            </div>
            <ol className="list-decimal pl-4 space-y-1 leading-relaxed text-slate-700">
              <li>Распакуйте скачанный <code>.zip</code> в отдельную папку на компьютере.</li>
              <li>
                На <strong>github.com</strong> создайте новый пустой репозиторий (без галочки README)
                и нажмите ссылку <strong>uploading an existing file</strong> (или{' '}
                <em>Add file → Upload files</em>).
              </li>
              <li>
                Выделите всё содержимое папки (включая скрытые файлы <code>.gitignore</code> и{' '}
                <code>.env.example</code>) и перетащите в окно браузера — в архиве всего 28 файлов,
                поэтому всё загрузится за один раз.
              </li>
              <li>Нажмите зелёную кнопку <strong>Commit changes</strong>.</li>
            </ol>
          </div>

          <div className="rounded-md border border-slate-200 bg-white p-3.5 text-xs text-slate-700 space-y-1.5">
            <div className="font-semibold text-slate-900">
              Через терминал / Git (альтернатива):
            </div>
            <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed text-slate-800">
{`git init
git add .
git commit -m "Stage 1: MELO_LOVE initial base"
git branch -M main
git remote add origin https://github.com/<ПРОФИЛЬ>/melo-love.git
git push -u origin main`}
            </pre>
          </div>
        </div>
      </div>

      {/* Export Controls */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
        <h2 className="text-base font-semibold text-slate-900">Выгрузка базы (UTF-8)</h2>
        <div className="flex flex-wrap items-center gap-4">
          <select
            value={exportCollection}
            onChange={(e) => setExportCollection(e.target.value as 'all' | 'debate' | 'romantic')}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          >
            <option value="all">Обе коллекции ({stats.total})</option>
            <option value="debate">Только «Кто здесь прав?» ({stats.debateTotal})</option>
            <option value="romantic">Только «Романтические истории» ({stats.romanticTotal})</option>
          </select>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={onlyApproved}
              onChange={(e) => setOnlyApproved(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-700"
            />
            <span>Только проверенные и принятые ({stats.approved})</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <a
            href={`/api/export/json${buildQuery()}`}
            className="inline-flex items-center gap-2 rounded-md bg-indigo-700 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-800"
          >
            <Download className="h-3.5 w-3.5" />
            Скачать JSON (структура 26 полей)
          </a>
          <a
            href={`/api/export/csv${buildQuery()}`}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" />
            Скачать CSV (UTF-8 BOM для Supabase / Excel)
          </a>
        </div>
      </div>

      {/* Backups & Import */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Локальные снимки на диске</h2>
            <button
              type="button"
              onClick={handleBackupNow}
              disabled={creatingBackup}
              className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
            >
              <Database className="h-3.5 w-3.5" />
              {creatingBackup ? 'Создание...' : 'Создать снимок сейчас'}
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {backups.length === 0 ? (
              <p className="py-3 text-xs text-slate-500">
                Снимки создаются автоматически при сохранении партий или вручную по кнопке выше.
              </p>
            ) : (
              backups.map((b) => (
                <div key={b.filename} className="flex items-center justify-between gap-2 py-2.5 text-xs">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-slate-800">{b.filename}</div>
                    <div className="text-slate-500 tabular-nums">
                      {(b.sizeBytes / 1024).toFixed(1)} КБ ·{' '}
                      {new Date(b.createdAt).toLocaleString('ru-RU')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRestoreBackup(b.filename)}
                    className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 shrink-0"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Восстановить
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <h2 className="text-base font-semibold text-slate-900">Импорт JSON в базу</h2>
          <p className="text-xs leading-relaxed text-slate-600">
            Загрузите ранее экспортированный JSON-файл. При импорте каждая запись проходит проверку
            смысловых дублей — повторяющиеся сюжеты будут автоматически пропущены.
          </p>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50">
            <Upload className="h-3.5 w-3.5" />
            Выбрать JSON-файл для импорта
            <input type="file" accept=".json,application/json" onChange={handleFileImport} className="hidden" />
          </label>
          {importStatus && (
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800">
              {importStatus}
            </div>
          )}
        </div>
      </div>

      {/* Supabase SQL Schema */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              SQL-схема для будущего подключения Supabase
            </h2>
            <p className="text-xs text-slate-500">
              Таблица PostgreSQL полностью соответствует 26 полям сюжетной основы и индексирована по
              семантическим отпечаткам.
            </p>
          </div>
          <button
            type="button"
            onClick={handleCopySql}
            className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Copy className="h-3.5 w-3.5" />
            {copiedSql ? 'Скопировано' : 'Копировать SQL'}
          </button>
        </div>
        <pre className="max-h-64 overflow-auto rounded-md border border-slate-200 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-200">
          {SUPABASE_SQL_SCHEMA}
        </pre>
      </div>
    </div>
  );
};

/* ============================================================================
   7. НАСТРОЙКИ (SETTINGS)
   ============================================================================ */
export const SettingsSection: React.FC<{
  settings: AppSettings;
  onSaveSettings: (next: Partial<AppSettings>) => Promise<void>;
}> = ({ settings, onSaveSettings }) => {
  const [form, setForm] = useState<AppSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedOk(false);
    try {
      await onSaveSettings(form);
      setSavedOk(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Настройки генератора и хранилища
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Параметры объёма библиотеки, размера партий, порога уникальности и локальной сохранности
          данных.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="max-w-3xl rounded-lg border border-slate-200 bg-white p-6 space-y-5"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-slate-700">
              Общая цель библиотеки
            </label>
            <input
              type="number"
              min={100}
              value={form.targetTotalStories}
              onChange={(e) =>
                setForm((p) => ({ ...p, targetTotalStories: Number(e.target.value) || 3000 }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">
              Цель «Кто здесь прав?»
            </label>
            <input
              type="number"
              min={50}
              value={form.targetDebateStories}
              onChange={(e) =>
                setForm((p) => ({ ...p, targetDebateStories: Number(e.target.value) || 1500 }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">
              Цель «Романтические»
            </label>
            <input
              type="number"
              min={50}
              value={form.targetRomanticStories}
              onChange={(e) =>
                setForm((p) => ({ ...p, targetRomanticStories: Number(e.target.value) || 1500 }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-slate-700">
              Размер партии по умолчанию
            </label>
            <input
              type="number"
              min={5}
              max={50}
              value={form.defaultBatchSize}
              onChange={(e) =>
                setForm((p) => ({ ...p, defaultBatchSize: Number(e.target.value) || 25 }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">
              Порог дубля (% сходства)
            </label>
            <input
              type="number"
              min={20}
              max={85}
              value={form.similarityThreshold}
              onChange={(e) =>
                setForm((p) => ({ ...p, similarityThreshold: Number(e.target.value) || 38 }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">
              Мин. балл качества
            </label>
            <input
              type="number"
              min={40}
              max={95}
              value={form.minimumApprovalScore}
              onChange={(e) =>
                setForm((p) => ({ ...p, minimumApprovalScore: Number(e.target.value) || 72 }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
            />
          </div>
        </div>

        <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700 space-y-1">
          <div className="font-semibold text-slate-900">Режим хранения данных</div>
          <p>
            Текущее хранилище: <strong>Локальный серверный диск (data/melo_love_db.json)</strong> +
            промежуточное сохранение проверяемых партий (data/pending_batch.json) и снимки в{' '}
            <code>data/backups/</code>.
          </p>
          <p className="text-slate-500">
            Подключение Supabase на данном этапе не активно: используйте раздел «Экспорт базы» для
            переноса или резервирования.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-indigo-700 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-800 disabled:opacity-50"
          >
            {saving ? 'Сохранение...' : 'Сохранить настройки'}
          </button>
          {savedOk && <span className="text-xs font-medium text-emerald-700">Настройки сохранены.</span>}
        </div>
      </form>
    </div>
  );
};

/* ============================================================================
   SHARED COMPACT COMPONENTS
   ============================================================================ */
const KpiBox: React.FC<{
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

const ProgressBar: React.FC<{
  label: string;
  current: number;
  target: number;
  percent: number;
}> = ({ label, current, target, percent }) => (
  <div>
    <div className="flex items-center justify-between text-xs">
      <span className="font-medium text-slate-700">{label}</span>
      <span className="font-mono text-slate-700 tabular-nums">
        {current} / {target} ({percent}%)
      </span>
    </div>
    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-full rounded-full bg-indigo-700 transition-all duration-300"
        style={{ width: `${Math.max(1.5, Math.min(100, percent))}%` }}
      />
    </div>
  </div>
);
