import React, { useMemo, useState } from 'react';
import { Check, Plus, RotateCcw, Search, Sparkles } from 'lucide-react';
import { getCategoriesForCollection } from '../shared/categories.ts';
import { tokenizeNormalized } from '../shared/similarity.ts';
import type { CollectionType, StoryPlot, VerificationStatus } from '../shared/types.ts';

interface StoryListViewProps {
  collection: CollectionType;
  stories: StoryPlot[];
  customCategories: { debate: string[]; romantic: string[] };
  initialCategoryFilter?: string;
  onSelectStory: (story: StoryPlot) => void;
  onCreateStory: () => void;
  onLaunchBatch: () => void;
  onQuickStatus: (id: string, status: VerificationStatus) => Promise<void>;
}

const STATUS_LABEL: Record<VerificationStatus, string> = {
  approved: 'Проверен',
  pending: 'Ожидает проверки',
  needs_revision: 'На доработке',
  rejected: 'Отклонён',
};

const STATUS_TEXT_COLOR: Record<VerificationStatus, string> = {
  approved: 'text-emerald-700',
  pending: 'text-slate-600',
  needs_revision: 'text-amber-700',
  rejected: 'text-red-700',
};

export const StoryListView: React.FC<StoryListViewProps> = ({
  collection,
  stories,
  customCategories,
  initialCategoryFilter = 'ALL',
  onSelectStory,
  onCreateStory,
  onLaunchBatch,
  onQuickStatus,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState(initialCategoryFilter);
  const [statusFilter, setStatusFilter] = useState<'ALL' | VerificationStatus>('ALL');
  const [originFilter, setOriginFilter] = useState<'ALL' | 'original' | 'external'>('ALL');
  const [minQuality, setMinQuality] = useState<number>(0);
  const [sortBy, setSortBy] = useState<'newest' | 'quality_desc' | 'quality_asc'>('newest');

  const categories = getCategoriesForCollection(collection, customCategories);

  const collectionStories = useMemo(
    () => stories.filter((s) => s.collection === collection),
    [stories, collection]
  );

  const filtered = useMemo(() => {
    const queryLower = searchQuery.trim().toLowerCase();
    const queryStems = queryLower ? tokenizeNormalized(queryLower) : [];

    const items = collectionStories.filter((s) => {
      if (categoryFilter !== 'ALL' && s.category !== categoryFilter) return false;
      if (statusFilter !== 'ALL' && s.verificationStatus !== statusFilter) return false;
      if (originFilter !== 'ALL' && s.originType !== originFilter) return false;
      if ((s.quality?.overall ?? 0) < minQuality) return false;

      if (queryLower) {
        const haystack = [
          s.id,
          s.title,
          s.shortDescription,
          s.fullPlot,
          s.category,
          s.subcategory,
          s.mainTheme,
          s.plotMechanic,
          s.coreConflictOrAction,
          s.semanticFingerprint,
          ...s.keywords,
        ]
          .join(' ')
          .toLowerCase();

        const directMatch = haystack.includes(queryLower);
        const semanticMatch =
          queryStems.length > 0 &&
          queryStems.every((stem) => haystack.includes(stem));

        if (!directMatch && !semanticMatch) return false;
      }
      return true;
    });

    return [...items].sort((a, b) => {
      if (sortBy === 'quality_desc') return (b.quality?.overall ?? 0) - (a.quality?.overall ?? 0);
      if (sortBy === 'quality_asc') return (a.quality?.overall ?? 0) - (b.quality?.overall ?? 0);
      return b.id.localeCompare(a.id);
    });
  }, [
    collectionStories,
    searchQuery,
    categoryFilter,
    statusFilter,
    originFilter,
    minQuality,
    sortBy,
  ]);

  const title =
    collection === 'debate'
      ? 'Коллекция A — «Кто здесь прав?»'
      : 'Коллекция B — «Романтические истории»';

  const subtitle =
    collection === 'debate'
      ? 'Неоднозначные жизненные конфликты ценностей, границ и ожиданий с аргументами обеих сторон.'
      : 'Конкретные жизненные сцены, тёплые детали и тихие поступки, вызывающие узнавание и отклик.';

  return (
    <div className="space-y-5">
      {/* Section Heading & Controls */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onCreateStory}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            Добавить вручную
          </button>
          <button
            type="button"
            onClick={onLaunchBatch}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-700 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-800 whitespace-nowrap"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Создать следующую партию
          </button>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="relative md:col-span-5">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск по словам, смыслу, механике или ключевым словам..."
              className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:outline-none"
            />
          </div>

          <div className="md:col-span-3">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="ALL">Все категории ({categories.length})</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              value={originFilter}
              onChange={(e) =>
                setOriginFilter(e.target.value as 'ALL' | 'original' | 'external')
              }
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="ALL">Все источники</option>
              <option value="original">Оригинальные</option>
              <option value="external">Зарубежные</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy(e.target.value as 'newest' | 'quality_desc' | 'quality_asc')
              }
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="newest">Сначала новые</option>
              <option value="quality_desc">Качество: выше</option>
              <option value="quality_asc">Качество: ниже</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {/* Segmented status filter */}
          <div className="flex flex-wrap items-center gap-1 rounded-md bg-slate-100 p-1">
            {(
              [
                ['ALL', `Все (${collectionStories.length})`],
                [
                  'approved',
                  `Проверены (${collectionStories.filter((s) => s.verificationStatus === 'approved').length})`,
                ],
                [
                  'pending',
                  `Ожидают (${collectionStories.filter((s) => s.verificationStatus === 'pending').length})`,
                ],
                [
                  'needs_revision',
                  `На доработке (${collectionStories.filter((s) => s.verificationStatus === 'needs_revision').length})`,
                ],
                [
                  'rejected',
                  `Отклонены (${collectionStories.filter((s) => s.verificationStatus === 'rejected').length})`,
                ],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatusFilter(key)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap tabular-nums ${
                  statusFilter === key
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-600">
            <label className="flex items-center gap-2">
              <span>Мин. качество:</span>
              <select
                value={minQuality}
                onChange={(e) => setMinQuality(Number(e.target.value))}
                className="rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-900 tabular-nums"
              >
                <option value={0}>Любое</option>
                <option value={75}>75+</option>
                <option value={85}>85+</option>
                <option value={90}>90+</option>
              </select>
            </label>
            <span className="font-mono tabular-nums text-slate-500">
              Показано: {filtered.length}
            </span>
          </div>
        </div>
      </div>

      {/* Story List */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center">
          <p className="text-sm font-medium text-slate-900">
            По текущим фильтрам сюжеты не найдены
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Сбросьте параметры поиска или создайте новую партию сюжетов для этой категории.
          </p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setCategoryFilter('ALL');
                setStatusFilter('ALL');
                setOriginFilter('ALL');
                setMinQuality(0);
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Сбросить фильтры
            </button>
            <button
              type="button"
              onClick={onLaunchBatch}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-700 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-800"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Создать партию
            </button>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {filtered.map((story) => (
            <div
              key={story.id}
              className="group flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-slate-50/70 md:flex-row md:items-start md:justify-between"
            >
              <div className="min-w-0 flex-1">
                {/* Zero-pill inline typographic metadata */}
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-mono font-medium text-slate-700">{story.id}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-medium text-slate-700">{story.category}</span>
                  <span aria-hidden="true">·</span>
                  <span>{story.plotMechanic}</span>
                  <span aria-hidden="true">·</span>
                  <span>Партия #{story.batchNumber}</span>
                  <span aria-hidden="true">·</span>
                  <span className={`font-medium ${STATUS_TEXT_COLOR[story.verificationStatus]}`}>
                    {STATUS_LABEL[story.verificationStatus]}
                  </span>
                  {story.duplicateFlag && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-medium text-amber-700">
                        Есть смысловое совпадение
                      </span>
                    </>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => onSelectStory(story)}
                  className="mt-1 text-left text-base font-semibold text-slate-900 hover:text-indigo-700"
                >
                  {story.title}
                </button>

                <p className="mt-1 text-sm leading-relaxed text-slate-600">
                  {story.shortDescription}
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span>
                    <strong className="font-medium text-slate-700">Участники:</strong>{' '}
                    {story.participants}
                  </span>
                  <span>
                    <strong className="font-medium text-slate-700">Вопрос:</strong>{' '}
                    {story.mainTriggerQuestion}
                  </span>
                </div>
              </div>

              {/* Right metrics + actions */}
              <div className="flex items-center justify-between gap-4 md:flex-col md:items-end shrink-0">
                <div className="text-right">
                  <div className="font-mono text-base font-semibold text-slate-900 tabular-nums">
                    {story.quality.overall}/100
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {story.originType === 'external' ? 'Внешний источник' : 'Оригинальный'}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {story.verificationStatus !== 'approved' && (
                    <button
                      type="button"
                      onClick={() => onQuickStatus(story.id, 'approved')}
                      className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 whitespace-nowrap"
                    >
                      <Check className="h-3 w-3" />
                      Принять
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onSelectStory(story)}
                    className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                  >
                    Открыть паспорт
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
