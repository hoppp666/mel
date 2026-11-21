import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Check,
  Copy,
  Database,
  Download,
  ExternalLink,
  GitMerge,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import {
  AppSettings,
  BackupEntry,
  BatchRecord,
  CollectionType,
  CustomCategory,
  DatabaseStats,
  NavSection,
  PendingBatch,
  StoryPlot,
  TelegramIntegrationStatus,
} from '../shared/types.js';
import {
  DEBATE_CATEGORIES,
  PLOT_MECHANICS,
  REFERENCE_FOREIGN_PLATFORMS,
  ROMANTIC_CATEGORIES,
} from '../shared/categories.js';
import { SUPABASE_SQL_SCHEMA } from '../shared/similarity.js';
import {
  fetchIntegrationStatus,
  getExportCsvUrl,
  getExportJsonUrl,
  getProjectArchiveUrl,
} from '../services/api.js';

// ============================================================================
// 1. OVERVIEW SECTION
// ============================================================================

export const OverviewSection: React.FC<{
  stats: DatabaseStats;
  settings: AppSettings;
  batches: BatchRecord[];
  pendingBatch: PendingBatch | null;
  stories: StoryPlot[];
  onNavigate: (section: NavSection) => void;
  onOpenBatchModal: () => void;
  onOpenStory: (story: StoryPlot) => void;
}> = ({
  stats,
  settings,
  batches,
  pendingBatch,
  stories,
  onNavigate,
  onOpenBatchModal,
  onOpenStory,
}) => {
  const debatePct = Math.min(100, Math.round((stats.debateCount / Math.max(1, settings.targetDebate)) * 100));
  const romanticPct = Math.min(100, Math.round((stats.romanticCount / Math.max(1, settings.targetRomantic)) * 100));

  const recentStories = useMemo(() => stories.slice(-6).reverse(), [stories]);

  return (
    <div className="space-y-6">
      {/* Pending Batch Banner */}
      {pendingBatch && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-amber-300 bg-amber-50 px-5 py-3.5">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-amber-900">
              Партия #{pendingBatch.batchNumber} ожидает приёмки
            </div>
            <p className="mt-0.5 text-sm text-amber-950">
              {pendingBatch.candidates.length} кандидатов в буфере ·{' '}
              {pendingBatch.collection === 'debate' ? 'Споры и мнения' : 'Романтика'}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenBatchModal}
            className="rounded-md bg-amber-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-amber-950 whitespace-nowrap cursor-pointer"
          >
            Открыть приёмку партии
          </button>
        </div>
      )}

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-lg border border-stone-200 bg-white p-5">
          <div className="text-xs font-medium text-zinc-500">Всего сюжетов в базе</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-semibold tracking-tight text-zinc-900 tabular-nums">
              {stats.total}
            </span>
            <span className="font-mono text-xs text-zinc-400 tabular-nums">
              / {settings.targetTotal}
            </span>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
            <div
              className="h-full bg-zinc-900"
              style={{ width: `${Math.min(100, stats.progressPercent)}%` }}
            />
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5">
          <div className="text-xs font-medium text-zinc-500">Споры / Романтика</div>
          <div className="mt-2 font-mono text-2xl font-semibold tracking-tight text-zinc-900 tabular-nums">
            {stats.debateCount} / {stats.romanticCount}
          </div>
          <div className="mt-2 text-xs text-zinc-500 font-mono tabular-nums">
            Прогресс: {debatePct}% · {romanticPct}%
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5">
          <div className="text-xs font-medium text-zinc-500">Подтверждено / Свободно</div>
          <div className="mt-2 font-mono text-2xl font-semibold tracking-tight text-teal-800 tabular-nums">
            {stats.approvedCount} / {stats.unusedCount}
          </div>
          <div className="mt-2 text-xs text-zinc-500 font-mono tabular-nums">
            Ожидают: {stats.pendingCount} · Доработка: {stats.needsRevisionCount}
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5">
          <div className="text-xs font-medium text-zinc-500">Средний балл / Дубли</div>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="font-mono text-2xl font-semibold tracking-tight text-zinc-900 tabular-nums">
              {stats.averageQuality}/100
            </span>
            <span
              className={`font-mono text-xs tabular-nums ${
                stats.duplicatesCount > 0 ? 'text-rose-700 font-semibold' : 'text-teal-700'
              }`}
            >
              дублей: {stats.duplicatesCount}
            </span>
          </div>
          <div className="mt-2 text-xs text-zinc-500 font-mono tabular-nums">
            Внешние: {stats.externalCount} · Оригин.: {stats.originalCount}
          </div>
        </div>
      </div>

      {/* Stage Pipeline Quick Jump */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-stone-200 bg-white p-5 flex flex-col justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Этап 1 · Пополнение базы
            </div>
            <h3 className="mt-1 text-base font-semibold text-zinc-900">
              Генератор партий (10–50 сюжетов)
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-600">
              Сбалансированное наполнение категорий споров и романтики с автоматической проверкой
              дублей и очередью приёмки.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenBatchModal}
            className="self-start rounded-md bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-zinc-800 cursor-pointer"
          >
            Создать следующую партию
          </button>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5 flex flex-col justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Этап 2 · Зарубежные площадки
            </div>
            <h3 className="mt-1 text-base font-semibold text-zinc-900">
              Foreign Research Engine
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-600">
              13 открытых источников (Reddit, NYT Modern Love, The Cut, Psychology Today), анализ
              живых ситуаций и 3-контурная дедупликация.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('research')}
            className="self-start rounded-md border border-stone-300 bg-white px-3.5 py-2 text-xs font-medium text-zinc-800 hover:bg-stone-50 cursor-pointer"
          >
            Открыть исследование источников
          </button>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5 flex flex-col justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Этап 3 · Редакционный голос
            </div>
            <h3 className="mt-1 text-base font-semibold text-zinc-900">
              Story Generator & Voice Engine
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-600">
              Генерация публикаций из утверждённых сюжетов, 5 голосовых пресетов, словарь
              выражений и антиштамп-контроль качества.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('generator')}
            className="self-start rounded-md border border-stone-300 bg-white px-3.5 py-2 text-xs font-medium text-zinc-800 hover:bg-stone-50 cursor-pointer"
          >
            Перейти в Story Generator
          </button>
        </div>
      </div>

      {/* Two-column lower section */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent stories */}
        <div className="rounded-lg border border-stone-200 bg-white">
          <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3.5">
            <h3 className="text-sm font-semibold text-zinc-900">Последние сюжеты в базе</h3>
            <button
              type="button"
              onClick={() => onNavigate('debate')}
              className="text-xs font-medium text-rose-800 hover:text-rose-900 cursor-pointer"
            >
              Все сюжеты →
            </button>
          </div>
          <div className="divide-y divide-stone-200">
            {recentStories.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onOpenStory(s)}
                className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-stone-50 cursor-pointer"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <span className="font-mono text-zinc-700">{s.id}</span>
                    <span>·</span>
                    <span>{s.category}</span>
                  </div>
                  <div className="truncate text-sm font-medium text-zinc-900">{s.title}</div>
                </div>
                <div className="font-mono text-xs font-semibold text-zinc-700 tabular-nums shrink-0">
                  {s.quality?.overall ?? 0}/100
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Batch log */}
        <div className="rounded-lg border border-stone-200 bg-white">
          <div className="border-b border-stone-200 px-5 py-3.5">
            <h3 className="text-sm font-semibold text-zinc-900">Журнал партий наполнения</h3>
          </div>
          <div className="divide-y divide-stone-200">
            {batches.length === 0 ? (
              <div className="px-5 py-8 text-center text-xs text-zinc-500">
                Партии ещё не фиксировались
              </div>
            ) : (
              batches
                .slice()
                .reverse()
                .slice(0, 8)
                .map((b) => (
                  <div key={`${b.collection}-${b.batchNumber}-${b.createdAt}`} className="px-5 py-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-semibold text-zinc-900 tabular-nums">
                        Партия #{b.batchNumber} ·{' '}
                        {b.collection === 'debate' ? 'Споры' : 'Романтика'}
                      </span>
                      <span className="font-mono text-zinc-500 tabular-nums">
                        +{b.approvedCount} одобр. / {b.generatedCount} всего
                      </span>
                    </div>
                    <div className="mt-1 text-zinc-500">
                      Фокус: {b.categoryFocus} · Режим:{' '}
                      {b.searchMode === 'web_search' ? 'Веб-поиск' : 'Оригинальные'}
                      {b.note ? ` · ${b.note}` : ''}
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 2. CATEGORIES SECTION
// ============================================================================

export const CategoriesSection: React.FC<{
  stories: StoryPlot[];
  customCategories: CustomCategory[];
  onCreateCategory: (payload: {
    collection: CollectionType;
    name: string;
    subcategories: string[];
  }) => Promise<void>;
}> = ({ stories, customCategories, onCreateCategory }) => {
  const [collection, setCollection] = useState<CollectionType>('debate');
  const [name, setName] = useState('');
  const [subtext, setSubtext] = useState('');
  const [saving, setSaving] = useState(false);

  const countMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of stories) {
      const key = `${s.collection}:${s.category}`;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [stories]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onCreateCategory({
        collection,
        name: name.trim(),
        subcategories: subtext
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setName('');
      setSubtext('');
    } finally {
      setSaving(false);
    }
  };

  const renderGrid = (col: CollectionType, baseCats: string[]) => {
    const custom = customCategories.filter((c) => c.collection === col).map((c) => c.name);
    const all = Array.from(new Set([...baseCats, ...custom]));
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {all.map((cat) => {
          const count = countMap.get(`${col}:${cat}`) || 0;
          return (
            <div
              key={`${col}-${cat}`}
              className="flex items-center justify-between rounded border border-stone-200 bg-white px-3.5 py-2.5 text-sm"
            >
              <span className="truncate text-zinc-800">{cat}</span>
              <span
                className={`font-mono text-xs tabular-nums ${
                  count === 0 ? 'text-zinc-400' : 'font-semibold text-zinc-900'
                }`}
              >
                {count}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-stone-200 pb-4">
        <h2 className="text-xl font-semibold text-zinc-900">Категории и подтемы</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Покрытие {DEBATE_CATEGORIES.length} тем раздела споров, {ROMANTIC_CATEGORIES.length} тем
          романтики и {PLOT_MECHANICS.length} сюжетных механик.
        </p>
      </div>

      {/* Add custom category */}
      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-stone-200 bg-white p-4 grid grid-cols-1 gap-3 md:grid-cols-12 items-end"
      >
        <label className="block text-xs font-medium text-zinc-700 md:col-span-3">
          Раздел
          <select
            value={collection}
            onChange={(e) => setCollection(e.target.value as CollectionType)}
            className="mt-1 w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
          >
            <option value="debate">Споры и мнения</option>
            <option value="romantic">Романтические истории</option>
          </select>
        </label>
        <label className="block text-xs font-medium text-zinc-700 md:col-span-4">
          Новая категория
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например: Общие финансы после рождения ребёнка"
            className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-xs font-medium text-zinc-700 md:col-span-3">
          Подтемы (через запятую)
          <input
            type="text"
            value={subtext}
            onChange={(e) => setSubtext(e.target.value)}
            placeholder="Бюджет, декрет, помощь родни"
            className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm"
          />
        </label>
        <div className="md:col-span-2">
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Добавить
          </button>
        </div>
      </form>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-zinc-900">
          Споры и мнения ({DEBATE_CATEGORIES.length})
        </h3>
        {renderGrid('debate', DEBATE_CATEGORIES)}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-zinc-900">
          Романтические и трогательные истории ({ROMANTIC_CATEGORIES.length})
        </h3>
        {renderGrid('romantic', ROMANTIC_CATEGORIES)}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-zinc-900">
          Сюжетные механики ({PLOT_MECHANICS.length})
        </h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {PLOT_MECHANICS.map((mech) => (
            <div
              key={mech}
              className="rounded border border-stone-200 bg-white px-3.5 py-2 text-xs text-zinc-700"
            >
              {mech}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 3. SOURCES REFERENCE SECTION
// ============================================================================

export const SourcesReferenceSection: React.FC<{
  onNavigateResearch: () => void;
}> = ({ onNavigateResearch }) => {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900">Каталог источников идей</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Проверенные англоязычные площадки и медиа для поиска реальных жизненных конфликтов и
            романтических наблюдений.
          </p>
        </div>
        <button
          type="button"
          onClick={onNavigateResearch}
          className="rounded-md bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-zinc-800 cursor-pointer"
        >
          Открыть живой парсинг в Foreign Research →
        </button>
      </div>

      <div className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
        {REFERENCE_FOREIGN_PLATFORMS.map((src) => (
          <div
            key={src.url}
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <span className="uppercase font-mono">{src.type}</span>
                <span>·</span>
                <span>
                  {src.focus === 'debate'
                    ? 'Споры'
                    : src.focus === 'romantic'
                      ? 'Романтика'
                      : 'Споры и романтика'}
                </span>
              </div>
              <div className="text-sm font-semibold text-zinc-900">{src.name}</div>
              <p className="text-xs text-zinc-600">{src.notes}</p>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono text-zinc-500">
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="truncate max-w-[260px]">{src.url}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// 4. UNIQUENESS SECTION
// ============================================================================

export const UniquenessSection: React.FC<{
  stories: StoryPlot[];
  similarityThreshold: number;
  onRescan: () => Promise<void>;
  onOpenStory: (story: StoryPlot) => void;
  onMergeStories: (payload: { targetStoryId: string; nuanceToAppend: string }) => Promise<void>;
}> = ({ stories, similarityThreshold, onRescan, onOpenStory, onMergeStories }) => {
  const [scanning, setScanning] = useState(false);
  const flagged = useMemo(() => stories.filter((s) => s.duplicateFlag), [stories]);

  const handleRescan = async () => {
    setScanning(true);
    try {
      await onRescan();
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900">Контроль смысловой уникальности</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Проверка URL, семантических отпечатков и биграмм при пороге{' '}
            <span className="font-mono tabular-nums">{similarityThreshold}%</span>.
          </p>
        </div>
        <button
          type="button"
          disabled={scanning}
          onClick={handleRescan}
          className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`h-4 w-4 ${scanning ? 'animate-spin' : ''}`} />
          {scanning ? 'Пересканируем базу...' : 'Пересканировать все сюжеты'}
        </button>
      </div>

      {flagged.length === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-white px-6 py-12 text-center space-y-2">
          <ShieldCheck className="mx-auto h-7 w-7 text-teal-700" />
          <div className="text-sm font-semibold text-zinc-900">
            Дублей и смысловых пересечений не обнаружено
          </div>
          <p className="text-xs text-zinc-500">
            Все {stories.length} сюжетов в базе имеют самостоятельный конфликт или уникальный нюанс.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
          {flagged.map((s) => (
            <div key={s.id} className="p-5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-mono text-zinc-500">
                    {s.id} · {s.category}
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenStory(s)}
                    className="mt-0.5 text-left text-base font-semibold text-zinc-900 hover:text-rose-800 cursor-pointer"
                  >
                    {s.title}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenStory(s)}
                  className="rounded border border-stone-200 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-stone-50 cursor-pointer"
                >
                  Редактировать
                </button>
              </div>
              <div className="space-y-1.5">
                {s.similarityMatches.map((m) => (
                  <div
                    key={`${s.id}-${m.storyId}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-200 bg-amber-50/50 px-3 py-2 text-xs"
                  >
                    <div>
                      <span className="font-mono font-semibold text-zinc-900">{m.storyId}</span>
                      <span className="mx-2 text-zinc-400">·</span>
                      <span className="text-zinc-800">{m.title}</span>
                      <span className="ml-2 font-mono font-semibold text-amber-800 tabular-nums">
                        {m.score}%
                      </span>
                      <div className="text-zinc-500">{m.reason}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onMergeStories({
                          targetStoryId: m.storyId,
                          nuanceToAppend: s.unexpectedNuance || s.shortDescription,
                        })
                      }
                      className="inline-flex items-center gap-1 rounded border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-800 hover:bg-stone-100 cursor-pointer"
                    >
                      <GitMerge className="h-3.5 w-3.5" />
                      Слить нюанс в {m.storyId}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 5. QUALITY SECTION
// ============================================================================

export const QualitySection: React.FC<{
  stories: StoryPlot[];
  minQualityScore: number;
  onOpenStory: (story: StoryPlot) => void;
}> = ({ stories, minQualityScore, onOpenStory }) => {
  const { excellent, good, needsWork } = useMemo(() => {
    const sorted = [...stories].sort((a, b) => (a.quality?.overall ?? 0) - (b.quality?.overall ?? 0));
    return {
      excellent: sorted.filter((s) => (s.quality?.overall ?? 0) >= 90),
      good: sorted.filter(
        (s) => (s.quality?.overall ?? 0) >= minQualityScore && (s.quality?.overall ?? 0) < 90
      ),
      needsWork: sorted.filter((s) => (s.quality?.overall ?? 0) < minQualityScore),
    };
  }, [stories, minQualityScore]);

  return (
    <div className="space-y-6">
      <div className="border-b border-stone-200 pb-4">
        <h2 className="text-xl font-semibold text-zinc-900">Контроль редакционного качества</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Целевой порог базы: <span className="font-mono tabular-nums">{minQualityScore}/100</span>.
          Оцениваются конкретика, жизненная достоверность, глубина мотивации и потенциал дискуссии.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-stone-200 bg-white p-5">
          <div className="text-xs text-zinc-500">Высокий уровень (90+)</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-teal-800 tabular-nums">
            {excellent.length}
          </div>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-5">
          <div className="text-xs text-zinc-500">В норме ({minQualityScore}–89)</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900 tabular-nums">
            {good.length}
          </div>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-5">
          <div className="text-xs text-zinc-500">Ниже порога (&lt; {minQualityScore})</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-amber-700 tabular-nums">
            {needsWork.length}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-zinc-900">
            Сюжеты, требующие внимания или усиления детали ({needsWork.length})
          </h3>
        </div>
        {needsWork.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-zinc-500">
            Все сюжеты в базе проходят минимальный порог качества {minQualityScore}/100.
          </div>
        ) : (
          <div className="divide-y divide-stone-200">
            {needsWork.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onOpenStory(s)}
                className="flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left hover:bg-stone-50 cursor-pointer"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-mono text-zinc-500">
                    {s.id} · {s.category} · {s.verificationStatus}
                  </div>
                  <div className="font-medium text-sm text-zinc-900">{s.title}</div>
                  <div className="text-xs text-zinc-500 truncate">{s.quality?.editorialNote}</div>
                </div>
                <div className="font-mono text-sm font-semibold text-amber-800 tabular-nums">
                  {s.quality?.overall ?? 0}/100
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// 6. EXPORT & BACKUP SECTION
// ============================================================================

export const ExportSection: React.FC<{
  backups: BackupEntry[];
  onCreateBackup: () => Promise<void>;
  onRestoreBackup: (filename: string) => Promise<void>;
  onImportJson: (stories: Partial<StoryPlot>[]) => Promise<{ imported: number; skippedDuplicates: number }>;
}> = ({ backups, onCreateBackup, onRestoreBackup, onImportJson }) => {
  const [exportCol, setExportCol] = useState('all');
  const [exportStatus, setExportStatus] = useState('all');
  const [busy, setBusy] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleCopySql = async () => {
    await navigator.clipboard.writeText(SUPABASE_SQL_SCHEMA);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setImportMessage(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed?.stories) ? parsed.stories : Array.isArray(parsed) ? parsed : null;
      if (!list) throw new Error('Файл должен содержать массив stories');
      const res = await onImportJson(list);
      setImportMessage(
        `Импортировано сюжетов: ${res.imported}. Пропущено дублей: ${res.skippedDuplicates}.`
      );
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : 'Ошибка чтения JSON');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-stone-200 pb-4">
        <h2 className="text-xl font-semibold text-zinc-900">Экспорт, резервные копии и миграция</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Выгрузка базы сюжетов, импорт JSON, ротируемые снимки данных и полный исходный код
          проекта в ZIP.
        </p>
      </div>

      {/* Export stories */}
      <div className="rounded-lg border border-stone-200 bg-white p-5 space-y-4">
        <h3 className="text-sm font-semibold text-zinc-900">Экспорт базы сюжетов (JSON и CSV)</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block text-xs font-medium text-zinc-700">
            Раздел
            <select
              value={exportCol}
              onChange={(e) => setExportCol(e.target.value)}
              className="mt-1 w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
            >
              <option value="all">Вся база (Споры + Романтика)</option>
              <option value="debate">Только «Споры и мнения»</option>
              <option value="romantic">Только «Романтические истории»</option>
            </select>
          </label>
          <label className="block text-xs font-medium text-zinc-700">
            Статус проверки
            <select
              value={exportStatus}
              onChange={(e) => setExportStatus(e.target.value)}
              className="mt-1 w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
            >
              <option value="all">Все статусы</option>
              <option value="approved">Только подтверждённые</option>
              <option value="pending">Только ожидающие</option>
              <option value="needs_revision">На доработке</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={getExportJsonUrl(exportCol, exportStatus)}
            download="melo_love_stories.json"
            className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-zinc-800"
          >
            <Download className="h-3.5 w-3.5" />
            Скачать JSON
          </a>
          <a
            href={getExportCsvUrl(exportCol, exportStatus)}
            download="melo_love_stories.csv"
            className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3.5 py-2 text-xs font-medium text-zinc-800 hover:bg-stone-50"
          >
            <Download className="h-3.5 w-3.5" />
            Скачать CSV (UTF-8 BOM для Excel)
          </a>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileImport}
            className="hidden"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3.5 py-2 text-xs font-medium text-zinc-800 hover:bg-stone-50 cursor-pointer"
          >
            <Upload className="h-3.5 w-3.5" />
            Импортировать JSON в базу
          </button>
        </div>
        {importMessage && (
          <div className="rounded border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-zinc-800">
            {importMessage}
          </div>
        )}
      </div>

      {/* Full project archive */}
      <div className="rounded-lg border border-stone-200 bg-white p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">
              Полный архив проекта (Этапы 1–4) для переноса на GitHub
            </h3>
            <p className="mt-0.5 text-xs text-zinc-600">
              Содержит сервер, клиент, тесты, конфигурацию и актуальную базу `data/*.json` без
              временных файлов и секретов.
            </p>
          </div>
          <a
            href={getProjectArchiveUrl()}
            download="melo_love_project.zip"
            className="inline-flex items-center gap-1.5 rounded-md bg-rose-800 px-3.5 py-2 text-xs font-medium text-white hover:bg-rose-900 whitespace-nowrap"
          >
            <Archive className="h-3.5 w-3.5" />
            Скачать проект (.zip)
          </a>
        </div>
        <p className="text-xs text-zinc-500">
          После распаковки архива откройте новый репозиторий на GitHub, выберите «Add file → Upload
          files» и перетащите папки проекта в окно браузера, либо выполните `git init && git push`.
        </p>
      </div>

      {/* Backups */}
      <div className="rounded-lg border border-stone-200 bg-white p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">Резервные снимки на сервере</h3>
            <p className="text-xs text-zinc-500">
              До 15 последних снимков в `data/backups/` перед коммитом партий или вручную.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onCreateBackup();
              } finally {
                setBusy(false);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-stone-50 cursor-pointer"
          >
            <Database className="h-3.5 w-3.5" />
            Создать снимок сейчас
          </button>
        </div>

        <div className="divide-y divide-stone-200 rounded border border-stone-200">
          {backups.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-zinc-500">
              Резервных снимков пока нет
            </div>
          ) : (
            backups.map((b) => (
              <div
                key={b.filename}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs"
              >
                <div className="font-mono text-zinc-800">
                  {b.filename} · {b.storyCount} сюжетов · {Math.round(b.sizeBytes / 1024)} КБ
                </div>
                <button
                  type="button"
                  onClick={() => onRestoreBackup(b.filename)}
                  className="inline-flex items-center gap-1 rounded border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-stone-100 cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" />
                  Восстановить
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Supabase SQL Schema */}
      <div className="rounded-lg border border-stone-200 bg-white p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">
              SQL-схема для будущей миграции в Supabase / PostgreSQL
            </h3>
            <p className="text-xs text-zinc-500">
              Готовый DDL таблицы `public.melo_story_plots` (в текущей версии используется локальное
              дисковое хранилище).
            </p>
          </div>
          <button
            type="button"
            onClick={handleCopySql}
            className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-stone-50 cursor-pointer"
          >
            {copiedSql ? <Check className="h-3.5 w-3.5 text-teal-700" /> : <Copy className="h-3.5 w-3.5" />}
            {copiedSql ? 'Скопировано' : 'Скопировать SQL'}
          </button>
        </div>
        <pre className="max-h-60 overflow-auto rounded border border-stone-200 bg-stone-50 p-3 font-mono text-[11px] leading-relaxed text-zinc-800">
          {SUPABASE_SQL_SCHEMA}
        </pre>
      </div>
    </div>
  );
};

// ============================================================================
// 7. SETTINGS SECTION
// ============================================================================

export const SettingsSection: React.FC<{
  settings: AppSettings;
  onSaveSettings: (updates: Partial<AppSettings>) => Promise<void>;
}> = ({ settings, onSaveSettings }) => {
  const [form, setForm] = useState<AppSettings>({ ...settings });
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [integrations, setIntegrations] = useState<TelegramIntegrationStatus | null>(null);
  const [checkingEnv, setCheckingEnv] = useState(false);

  const loadEnvStatus = async () => {
    setCheckingEnv(true);
    try {
      const status = await fetchIntegrationStatus();
      setIntegrations(status);
    } catch {
      // Non-blocking
    } finally {
      setCheckingEnv(false);
    }
  };

  useEffect(() => {
    loadEnvStatus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedNotice(false);
    try {
      await onSaveSettings(form);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-stone-200 pb-4">
        <h2 className="text-xl font-semibold text-zinc-900">Настройки базы и порогов</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Текущий режим хранения: локальное файловое хранилище сервера (`data/*.json` с атомарной
          записью и ротацией бэкапов).
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-stone-200 bg-white p-6 space-y-5 max-w-2xl"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="block text-xs font-medium text-zinc-700">
            Целевой объём базы
            <input
              type="number"
              min={100}
              max={10000}
              value={form.targetTotal}
              onChange={(e) => setForm({ ...form, targetTotal: Number(e.target.value) || 3000 })}
              className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 font-mono text-sm tabular-nums"
            />
          </label>
          <label className="block text-xs font-medium text-zinc-700">
            Цель · Споры
            <input
              type="number"
              min={50}
              max={5000}
              value={form.targetDebate}
              onChange={(e) => setForm({ ...form, targetDebate: Number(e.target.value) || 1500 })}
              className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 font-mono text-sm tabular-nums"
            />
          </label>
          <label className="block text-xs font-medium text-zinc-700">
            Цель · Романтика
            <input
              type="number"
              min={50}
              max={5000}
              value={form.targetRomantic}
              onChange={(e) => setForm({ ...form, targetRomantic: Number(e.target.value) || 1500 })}
              className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 font-mono text-sm tabular-nums"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="block text-xs font-medium text-zinc-700">
            Порог дублей (%)
            <input
              type="number"
              min={20}
              max={90}
              value={form.similarityThreshold}
              onChange={(e) =>
                setForm({ ...form, similarityThreshold: Number(e.target.value) || 38 })
              }
              className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 font-mono text-sm tabular-nums"
            />
          </label>
          <label className="block text-xs font-medium text-zinc-700">
            Мин. балл качества
            <input
              type="number"
              min={50}
              max={98}
              value={form.minQualityScore}
              onChange={(e) => setForm({ ...form, minQualityScore: Number(e.target.value) || 75 })}
              className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 font-mono text-sm tabular-nums"
            />
          </label>
          <label className="block text-xs font-medium text-zinc-700">
            Размер партии по умолч.
            <select
              value={form.defaultBatchSize}
              onChange={(e) =>
                setForm({
                  ...form,
                  defaultBatchSize: Number(e.target.value) as AppSettings['defaultBatchSize'],
                })
              }
              className="mt-1 w-full rounded-md border border-stone-200 bg-white px-3 py-2 font-mono text-sm"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={35}>35</option>
              <option value={50}>50</option>
            </select>
          </label>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
          >
            {saving ? 'Сохраняем...' : 'Сохранить настройки'}
          </button>
          {savedNotice && <span className="text-xs font-medium text-teal-800">Сохранено</span>}
        </div>
      </form>

      {/* Optional External Integrations Status */}
      <div className="rounded-lg border border-stone-200 bg-white p-6 space-y-4 max-w-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">
              Внешние интеграции и ключи (необязательны для работы)
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              Все ключи опциональны: приложение, база сюжетов, редакторы и экспорт полностью работают
              на локальных файлах без внешних API. Подключите нужные ключи позже через серверный{' '}
              <code>.env</code> или панель Secrets.
            </p>
          </div>
          <button
            type="button"
            disabled={checkingEnv}
            onClick={loadEnvStatus}
            className="inline-flex items-center gap-1.5 rounded border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-stone-50 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${checkingEnv ? 'animate-spin' : ''}`} />
            Обновить статус
          </button>
        </div>

        {integrations && (
          <div className="divide-y divide-stone-200 rounded border border-stone-200 text-xs">
            <div className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div>
                <div className="font-medium text-zinc-900">GitHub Models (openai/gpt-4o)</div>
                <div className="text-zinc-500">
                  Нужен только для AI-генерации партий, переписывания и AI-помощников.
                </div>
              </div>
              <span
                className={`font-mono font-medium whitespace-nowrap ${
                  integrations.hasGeminiConfigured ? 'text-teal-800' : 'text-zinc-600'
                }`}
              >
                {integrations.hasGeminiConfigured ? 'Подключён' : 'Не задан (опционально)'}
              </span>
            </div>

            <div className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div>
                <div className="font-medium text-zinc-900">
                  Telegram Bot API (TELEGRAM_BOT_TOKEN)
                </div>
                <div className="text-zinc-500">
                  Нужен только при реальной отправке в канал. Dry-Run и редактор работают без него.
                </div>
              </div>
              <span
                className={`font-mono font-medium whitespace-nowrap ${
                  integrations.hasBotTokenConfigured ? 'text-teal-800' : 'text-zinc-600'
                }`}
              >
                {integrations.hasBotTokenConfigured ? 'Подключён' : 'Не задан (опционально)'}
              </span>
            </div>

            <div className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div>
                <div className="font-medium text-zinc-900">
                  Supabase (SUPABASE_URL + SERVICE_ROLE_KEY)
                </div>
                <div className="text-zinc-500">
                  Нужен только при переносе данных в облако; сейчас используется локальный JSON.
                </div>
              </div>
              <span
                className={`font-mono font-medium whitespace-nowrap ${
                  integrations.hasSupabaseConfigured ? 'text-teal-800' : 'text-zinc-600'
                }`}
              >
                {integrations.hasSupabaseConfigured ? 'Подключена' : 'Не задана (локальный JSON)'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
