import React, { useMemo, useState } from 'react';
import {
  Check,
  ExternalLink,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import {
  CollectionType,
  CustomCategory,
  OriginType,
  StoryPlot,
  UsageStatus,
  VerificationStatus,
} from '../shared/types.js';
import { getCategoriesForCollection } from '../shared/categories.js';

interface StoryListViewProps {
  collection: CollectionType;
  stories: StoryPlot[];
  customCategories: CustomCategory[];
  onOpenStory: (story: StoryPlot) => void;
  onCreateNew: (collection: CollectionType) => void;
  onQuickStatus: (
    storyId: string,
    payload: { verificationStatus?: VerificationStatus; usageStatus?: UsageStatus }
  ) => Promise<void>;
  onDeleteStory: (storyId: string) => Promise<void>;
}

const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  approved: 'Подтверждён',
  pending: 'Ожидает',
  needs_revision: 'На доработке',
  rejected: 'Отклонён',
};

const USAGE_LABEL: Record<UsageStatus, string> = {
  unused: 'Не использован',
  drafted: 'Есть черновик',
  published: 'Опубликован',
  archived: 'В архиве',
};

export const StoryListView: React.FC<StoryListViewProps> = ({
  collection,
  stories,
  customCategories,
  onOpenStory,
  onCreateNew,
  onQuickStatus,
  onDeleteStory,
}) => {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | VerificationStatus>('all');
  const [usageFilter, setUsageFilter] = useState<'all' | UsageStatus>('all');
  const [originFilter, setOriginFilter] = useState<'all' | OriginType>('all');
  const [minScore, setMinScore] = useState(0);
  const [onlyDuplicates, setOnlyDuplicates] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const collectionStories = useMemo(
    () => stories.filter((s) => s.collection === collection),
    [stories, collection]
  );

  const categories = useMemo(() => {
    const base = getCategoriesForCollection(collection);
    const custom = customCategories
      .filter((c) => c.collection === collection)
      .map((c) => c.name);
    return Array.from(new Set([...base, ...custom]));
  }, [collection, customCategories]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return collectionStories.filter((s) => {
      if (categoryFilter !== 'all' && s.category !== categoryFilter) return false;
      if (statusFilter !== 'all' && s.verificationStatus !== statusFilter) return false;
      if (usageFilter !== 'all' && s.usageStatus !== usageFilter) return false;
      if (originFilter !== 'all' && s.originType !== originFilter) return false;
      if (minScore > 0 && (s.quality?.overall ?? 0) < minScore) return false;
      if (onlyDuplicates && !s.duplicateFlag) return false;
      if (!q) return true;
      const haystack = [
        s.id,
        s.title,
        s.category,
        s.subcategory,
        s.shortDescription,
        s.mainTheme,
        s.plotMechanic,
        ...(s.keywords || []),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [
    collectionStories,
    search,
    categoryFilter,
    statusFilter,
    usageFilter,
    originFilter,
    minScore,
    onlyDuplicates,
  ]);

  const handleQuickAction = async (
    storyId: string,
    payload: { verificationStatus?: VerificationStatus; usageStatus?: UsageStatus }
  ) => {
    setBusyId(storyId);
    try {
      await onQuickStatus(storyId, payload);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (storyId: string) => {
    setBusyId(storyId);
    try {
      await onDeleteStory(storyId);
      setConfirmDeleteId(null);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header strip */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-zinc-900">
            {collection === 'debate'
              ? 'Раздел 1 · Споры и мнения'
              : 'Раздел 2 · Романтические и трогательные истории'}
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            {collection === 'debate'
              ? 'Жизненные ситуации с двумя сильными сторонами, дилеммами границ, денег и ожиданий.'
              : 'Тёплые, неслащавые сюжеты о тихой заботе, памяти о мелочах и повседневной близости.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right text-xs text-zinc-500 font-mono tabular-nums">
            Показано {filtered.length} из {collectionStories.length}
          </div>
          <button
            type="button"
            onClick={() => onCreateNew(collection)}
            className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Добавить сюжет вручную
          </button>
        </div>
      </div>

      {/* Filters toolbar */}
      <div className="rounded-lg border border-stone-200 bg-white p-4 space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="relative md:col-span-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по ID, названию, механике, тегам..."
              className="w-full rounded-md border border-stone-200 bg-stone-50/50 py-2 pl-9 pr-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white focus:outline-none"
            />
          </div>

          <div className="md:col-span-3">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-zinc-800 focus:border-zinc-400 focus:outline-none"
            >
              <option value="all">Все категории ({categories.length})</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | VerificationStatus)}
              className="w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-zinc-800 focus:border-zinc-400 focus:outline-none"
            >
              <option value="all">Любая проверка</option>
              <option value="approved">Подтверждённые</option>
              <option value="pending">Ожидают</option>
              <option value="needs_revision">На доработке</option>
              <option value="rejected">Отклонённые</option>
            </select>
          </div>

          <div className="md:col-span-3">
            <select
              value={usageFilter}
              onChange={(e) => setUsageFilter(e.target.value as 'all' | UsageStatus)}
              className="w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-zinc-800 focus:border-zinc-400 focus:outline-none"
            >
              <option value="all">Любое использование</option>
              <option value="unused">Не использован</option>
              <option value="drafted">Есть черновик</option>
              <option value="published">Опубликован</option>
              <option value="archived">В архиве</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-zinc-600">
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2">
              <span>Происхождение:</span>
              <select
                value={originFilter}
                onChange={(e) => setOriginFilter(e.target.value as 'all' | OriginType)}
                className="rounded border border-stone-200 bg-white px-2 py-1 text-xs text-zinc-800"
              >
                <option value="all">Все</option>
                <option value="original">Оригинальные (ИИ / ручные)</option>
                <option value="external">Внешние источники</option>
              </select>
            </label>

            <label className="inline-flex items-center gap-2">
              <span>Мин. балл:</span>
              <input
                type="number"
                min={0}
                max={100}
                value={minScore}
                onChange={(e) => setMinScore(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                className="w-16 rounded border border-stone-200 px-2 py-1 text-xs font-mono tabular-nums text-zinc-800"
              />
            </label>

            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyDuplicates}
                onChange={(e) => setOnlyDuplicates(e.target.checked)}
                className="rounded border-stone-300 text-rose-700 focus:ring-rose-600"
              />
              <span>Только с флагом совпадений</span>
            </label>
          </div>

          {(search ||
            categoryFilter !== 'all' ||
            statusFilter !== 'all' ||
            usageFilter !== 'all' ||
            originFilter !== 'all' ||
            minScore > 0 ||
            onlyDuplicates) && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setCategoryFilter('all');
                setStatusFilter('all');
                setUsageFilter('all');
                setOriginFilter('all');
                setMinScore(0);
                setOnlyDuplicates(false);
              }}
              className="text-xs font-medium text-rose-800 hover:text-rose-900 cursor-pointer"
            >
              Сбросить фильтры
            </button>
          )}
        </div>
      </div>

      {/* Stories table / ledger */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-white px-6 py-12 text-center">
          <p className="text-sm font-medium text-zinc-800">Сюжеты по выбранным параметрам не найдены</p>
          <p className="mt-1 text-xs text-zinc-500">
            Сбросьте фильтры или добавьте новую сюжетную основу вручную или через партию.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
          <div className="divide-y divide-stone-200">
            {filtered.map((story) => {
              const score = story.quality?.overall ?? 0;
              const isBusy = busyId === story.id;
              return (
                <div
                  key={story.id}
                  className="group px-5 py-4 transition-colors hover:bg-stone-50/80"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      {/* Metadata strip - zero-pill plain typography */}
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-zinc-500">
                        <span className="font-mono font-medium text-zinc-800 tabular-nums">
                          {story.id}
                        </span>
                        <span>·</span>
                        <span className="font-medium text-zinc-700">{story.category}</span>
                        {story.subcategory && (
                          <>
                            <span>/</span>
                            <span>{story.subcategory}</span>
                          </>
                        )}
                        <span>·</span>
                        <span className="font-mono tabular-nums">Партия #{story.batchNumber}</span>
                        <span>·</span>
                        <span
                          className={
                            story.verificationStatus === 'approved'
                              ? 'font-medium text-teal-800'
                              : story.verificationStatus === 'needs_revision'
                                ? 'font-medium text-amber-800'
                                : story.verificationStatus === 'rejected'
                                  ? 'font-medium text-rose-800'
                                  : 'font-medium text-zinc-700'
                          }
                        >
                          {VERIFICATION_LABEL[story.verificationStatus]}
                        </span>
                        <span>·</span>
                        <span>{USAGE_LABEL[story.usageStatus]}</span>
                        {story.researchId && (
                          <>
                            <span>·</span>
                            <span className="font-mono text-zinc-600">{story.researchId}</span>
                          </>
                        )}
                        {story.duplicateFlag && (
                          <>
                            <span>·</span>
                            <span className="font-medium text-rose-700">
                              Возможный дубль ({story.similarityMatches[0]?.score ?? 0}%)
                            </span>
                          </>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => onOpenStory(story)}
                        className="block text-left text-base font-semibold text-zinc-900 hover:text-rose-800 cursor-pointer"
                      >
                        {story.title}
                      </button>

                      <p className="text-sm leading-relaxed text-zinc-600 line-clamp-2">
                        {story.shortDescription}
                      </p>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-0.5 text-xs text-zinc-500">
                        <span>Механика: {story.plotMechanic || '—'}</span>
                        <span>Вопрос: «{story.mainTriggerQuestion}»</span>
                        {story.sourceUrl && (
                          <span className="inline-flex items-center gap-1 text-zinc-600">
                            <ExternalLink className="h-3 w-3" />
                            Источник указан
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right side score & quick controls */}
                    <div className="flex shrink-0 items-center justify-between gap-4 lg:flex-col lg:items-end">
                      <div className="text-right">
                        <div className="text-[11px] uppercase tracking-wider text-zinc-400">
                          Качество
                        </div>
                        <div
                          className={`font-mono text-lg font-semibold tabular-nums ${
                            score >= 88
                              ? 'text-teal-800'
                              : score >= 75
                                ? 'text-zinc-900'
                                : 'text-amber-700'
                          }`}
                        >
                          {score}/100
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onOpenStory(story)}
                          className="rounded border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-stone-100 whitespace-nowrap cursor-pointer"
                        >
                          Паспорт
                        </button>

                        {story.verificationStatus !== 'approved' && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              handleQuickAction(story.id, { verificationStatus: 'approved' })
                            }
                            title="Подтвердить сюжет"
                            className="inline-flex items-center gap-1 rounded border border-teal-200 bg-teal-50/70 px-2 py-1 text-xs font-medium text-teal-900 hover:bg-teal-100 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                          >
                            <Check className="h-3.5 w-3.5" />
                            Одобрить
                          </button>
                        )}

                        {story.verificationStatus !== 'needs_revision' && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              handleQuickAction(story.id, { verificationStatus: 'needs_revision' })
                            }
                            title="Отправить на доработку"
                            className="rounded border border-stone-200 bg-white p-1.5 text-zinc-500 hover:text-amber-800 hover:border-amber-200 disabled:opacity-50 cursor-pointer"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        )}

                        {confirmDeleteId === story.id ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleDelete(story.id)}
                              className="rounded bg-rose-700 px-2 py-1 text-xs font-medium text-white hover:bg-rose-800 cursor-pointer"
                            >
                              Удалить
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="rounded border border-stone-200 px-2 py-1 text-xs text-zinc-600 hover:bg-stone-100 cursor-pointer"
                            >
                              Отмена
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(story.id)}
                            title="Удалить сюжет"
                            className="rounded border border-stone-200 bg-white p-1.5 text-zinc-400 hover:text-rose-700 hover:border-rose-200 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
