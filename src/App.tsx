import React, { useCallback, useEffect, useState } from 'react';
import {
  Award,
  BookOpen,
  Compass,
  Download,
  FolderTree,
  Globe,
  LayoutDashboard,
  Menu,
  MessageSquareMore,
  PenLine,
  Settings,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { BatchModal } from './components/BatchModal.tsx';
import { ForeignResearchSection } from './components/ForeignResearchSection.tsx';
import { StoryGeneratorSection } from './components/StoryGeneratorSection.tsx';
import {
  CategoriesSection,
  ExportSection,
  OverviewSection,
  QualitySection,
  SettingsSection,
  SourcesSection,
  UniquenessSection,
} from './components/Sections.tsx';
import { StoryListView } from './components/StoryListView.tsx';
import { StoryModal } from './components/StoryModal.tsx';
import * as api from './services/api.ts';
import type { DatabasePayload, StagedBatch } from './services/api.ts';
import type {
  AppSettings,
  CollectionType,
  NavSection,
  StoryPlot,
  VerificationStatus,
} from './shared/types.ts';

interface NavItem {
  id: NavSection;
  label: string;
  icon: React.FC<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Общий обзор', icon: LayoutDashboard },
  { id: 'debate', label: 'Дискуссионные сюжеты', icon: MessageSquareMore },
  { id: 'romantic', label: 'Романтические сюжеты', icon: BookOpen },
  { id: 'research', label: 'FOREIGN RESEARCH', icon: Compass },
  { id: 'generator', label: 'STORY GENERATOR', icon: PenLine },
  { id: 'categories', label: 'Категории', icon: FolderTree },
  { id: 'sources', label: 'Зарубежные источники', icon: Globe },
  { id: 'uniqueness', label: 'Проверка уникальности', icon: ShieldCheck },
  { id: 'quality', label: 'Качество идей', icon: Award },
  { id: 'export', label: 'Экспорт базы', icon: Download },
  { id: 'settings', label: 'Настройки', icon: Settings },
];

export default function App() {
  const [data, setData] = useState<DatabasePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<NavSection>('overview');
  const [categoryPrefill, setCategoryPrefill] = useState<string>('ALL');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Modals
  const [selectedStory, setSelectedStory] = useState<StoryPlot | null | undefined>(undefined); // undefined = closed, null = create
  const [createCollection, setCreateCollection] = useState<CollectionType>('debate');
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchDefaultCollection, setBatchDefaultCollection] = useState<CollectionType>('debate');

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const payload = await api.fetchDatabase();
      setData(payload);
    } catch (err) {
      setError((err as Error).message || 'Не удалось загрузить базу сюжетов');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleNavigate = (section: NavSection, catFilter = 'ALL') => {
    setCategoryPrefill(catFilter);
    setActiveSection(section);
    setMobileMenuOpen(false);
  };

  const handleOpenBatchModal = (collection?: CollectionType) => {
    if (collection) setBatchDefaultCollection(collection);
    else if (activeSection === 'romantic') setBatchDefaultCollection('romantic');
    else setBatchDefaultCollection('debate');
    setBatchModalOpen(true);
  };

  const handleQuickStatus = async (id: string, status: VerificationStatus) => {
    await api.updateStoryStatus(id, { verificationStatus: status });
    await loadData();
  };

  const handleStagedUpdated = (staged: StagedBatch | null) => {
    setData((prev) => (prev ? { ...prev, stagedBatch: staged } : prev));
  };

  const activeNavMeta = NAV_ITEMS.find((n) => n.id === activeSection) || NAV_ITEMS[0];

  if (loading) {
    return (
      <div className="flex min-h-screen bg-slate-50">
        <div className="hidden w-[260px] shrink-0 border-r border-slate-200 bg-white p-5 lg:block">
          <div className="h-6 w-36 rounded bg-slate-200" />
          <div className="mt-8 space-y-3">
            {Array.from({ length: 9 }).map((_, idx) => (
              <div key={idx} className="h-8 rounded bg-slate-100" />
            ))}
          </div>
        </div>
        <div className="flex-1 p-8 space-y-6">
          <div className="h-10 w-72 rounded bg-slate-200" />
          <div className="grid grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={idx} className="h-24 rounded-lg border border-slate-200 bg-white" />
            ))}
          </div>
          <div className="h-64 rounded-lg border border-slate-200 bg-white" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center space-y-4">
          <h1 className="text-lg font-semibold text-slate-900">Ошибка загрузки базы данных</h1>
          <p className="text-sm text-slate-600">{error || 'Неизвестная ошибка соединения'}</p>
          <button
            type="button"
            onClick={loadData}
            className="rounded-md bg-indigo-700 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-800"
          >
            Повторить загрузку
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Desktop Sidebar (260px) */}
      <aside className="hidden w-[260px] shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="border-b border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={() => handleNavigate('overview')}
            className="text-left text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap"
          >
            MELO_LOVE
          </button>
          <div className="mt-0.5 text-xs text-slate-500">База сюжетных основ</div>
        </div>

        <nav className="flex-1 space-y-1 p-3" aria-label="Разделы базы">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            const badgeCount =
              item.id === 'debate'
                ? data.stats.debateTotal
                : item.id === 'romantic'
                  ? data.stats.romanticTotal
                  : item.id === 'uniqueness'
                    ? data.stats.duplicatesDetected
                    : item.id === 'quality'
                      ? data.stats.pending + data.stats.needsRevision
                      : null;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-indigo-50 font-semibold text-indigo-900'
                    : 'font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      isActive ? 'text-indigo-700' : 'text-slate-400'
                    }`}
                  />
                  <span className="truncate">{item.label}</span>
                </span>
                {badgeCount !== null && (
                  <span className="ml-2 font-mono text-xs text-slate-500 tabular-nums">
                    {badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Compact Progress Footer in Sidebar */}
        <div className="border-t border-slate-200 p-4 text-xs">
          <div className="flex items-center justify-between text-slate-600">
            <span>Прогресс к цели</span>
            <span className="font-mono font-semibold text-slate-900 tabular-nums">
              {data.stats.approved} / {data.settings.targetTotalStories}
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-indigo-700"
              style={{ width: `${Math.max(2, data.stats.progressPercent)}%` }}
            />
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            Локальное сохранение на диск · UTF-8
          </div>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 flex w-64 flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <span className="text-lg font-bold text-slate-900">MELO_LOVE</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1 text-slate-500"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 p-3">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavigate(item.id)}
                    className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-sm ${
                      isActive
                        ? 'bg-indigo-50 font-semibold text-indigo-900'
                        : 'font-medium text-slate-600'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Открыть меню"
              className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm text-slate-500 truncate">
              <span className="font-medium text-slate-900 whitespace-nowrap">MELO_LOVE</span>
              <span aria-hidden="true">/</span>
              <span className="truncate text-slate-700">{activeNavMeta.label}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => handleOpenBatchModal()}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-800 whitespace-nowrap shrink-0"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {data.stagedBatch
                ? `Проверить партию #${data.stagedBatch.batchNumber}`
                : 'Создать следующую партию'}
            </button>
          </div>
        </header>

        {/* Workspace Canvas */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {activeSection === 'overview' && (
            <OverviewSection
              stats={data.stats}
              settings={data.settings}
              stories={data.stories}
              batches={data.batches}
              stagedBatch={data.stagedBatch}
              onNavigate={handleNavigate}
              onLaunchBatch={(col) => handleOpenBatchModal(col)}
              onSelectStory={(story) => setSelectedStory(story)}
            />
          )}

          {activeSection === 'debate' && (
            <StoryListView
              key={`debate-${categoryPrefill}`}
              collection="debate"
              stories={data.stories}
              customCategories={data.customCategories}
              initialCategoryFilter={categoryPrefill}
              onSelectStory={(story) => setSelectedStory(story)}
              onCreateStory={() => {
                setCreateCollection('debate');
                setSelectedStory(null);
              }}
              onLaunchBatch={() => handleOpenBatchModal('debate')}
              onQuickStatus={handleQuickStatus}
            />
          )}

          {activeSection === 'romantic' && (
            <StoryListView
              key={`romantic-${categoryPrefill}`}
              collection="romantic"
              stories={data.stories}
              customCategories={data.customCategories}
              initialCategoryFilter={categoryPrefill}
              onSelectStory={(story) => setSelectedStory(story)}
              onCreateStory={() => {
                setCreateCollection('romantic');
                setSelectedStory(null);
              }}
              onLaunchBatch={() => handleOpenBatchModal('romantic')}
              onQuickStatus={handleQuickStatus}
            />
          )}

          {activeSection === 'research' && (
            <ForeignResearchSection
              customCategories={data.customCategories}
              onDatabaseUpdated={loadData}
            />
          )}

          {activeSection === 'generator' && (
            <StoryGeneratorSection onDatabaseUpdated={loadData} />
          )}

          {activeSection === 'categories' && (
            <CategoriesSection
              stories={data.stories}
              customCategories={data.customCategories}
              onAddCategory={async (collection, name) => {
                await api.addCustomCategory(collection, name);
                await loadData();
              }}
              onOpenCollectionCategory={(col, cat) =>
                handleNavigate(col === 'debate' ? 'debate' : 'romantic', cat)
              }
            />
          )}

          {activeSection === 'sources' && (
            <SourcesSection
              stories={data.stories}
              onLaunchSearchBatch={() => handleOpenBatchModal('debate')}
              onSelectStory={(story) => setSelectedStory(story)}
            />
          )}

          {activeSection === 'uniqueness' && (
            <UniquenessSection
              stories={data.stories}
              threshold={data.settings.similarityThreshold}
              onRescan={async () => {
                await api.rescanUniqueness();
                await loadData();
              }}
              onSelectStory={(story) => setSelectedStory(story)}
            />
          )}

          {activeSection === 'quality' && (
            <QualitySection
              stories={data.stories}
              minScore={data.settings.minimumApprovalScore}
              onSelectStory={(story) => setSelectedStory(story)}
              onQuickStatus={handleQuickStatus}
            />
          )}

          {activeSection === 'export' && (
            <ExportSection
              stats={data.stats}
              backups={data.backups}
              onCreateBackup={async () => {
                await api.createBackup();
                await loadData();
              }}
              onRestoreBackup={async (filename) => {
                const restored = await api.restoreBackup(filename);
                setData(restored);
              }}
              onImported={loadData}
            />
          )}

          {activeSection === 'settings' && (
            <SettingsSection
              settings={data.settings}
              onSaveSettings={async (next: Partial<AppSettings>) => {
                await api.updateSettings(next);
                await loadData();
              }}
            />
          )}
        </main>
      </div>

      {/* Story Inspect / Edit / Create Modal */}
      {selectedStory !== undefined && (
        <StoryModal
          story={selectedStory}
          initialCollection={createCollection}
          customCategories={data.customCategories}
          onClose={() => setSelectedStory(undefined)}
          onSaved={async (saved) => {
            setSelectedStory(saved);
            await loadData();
          }}
          onDeleted={async () => {
            setSelectedStory(undefined);
            await loadData();
          }}
          onMerged={loadData}
        />
      )}

      {/* Batch Generation & Review Modal */}
      {batchModalOpen && (
        <BatchModal
          stagedBatch={data.stagedBatch}
          defaultCollection={batchDefaultCollection}
          defaultBatchSize={data.settings.defaultBatchSize}
          customCategories={data.customCategories}
          onClose={() => setBatchModalOpen(false)}
          onBatchUpdated={handleStagedUpdated}
          onCommitted={loadData}
        />
      )}
    </div>
  );
}
