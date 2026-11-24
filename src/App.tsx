import React, { useEffect, useState } from 'react';
import {
  Award,
  BookOpen,
  Clock,
  Database,
  Download,
  Feather,
  Globe,
  Heart,
  Layers,
  Menu,
  MessageSquare,
  Plus,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import {
  CollectionType,
  DatabaseSnapshotResponse,
  NavSection,
  StoryPlot,
} from './shared/types.js';
import {
  commitStagedBatch,
  createCustomCategory,
  createDatabaseBackup,
  createStory,
  discardStagedBatch,
  fetchDatabase,
  generateBatch,
  importStoriesJson,
  mergeStories,
  rescanUniqueness,
  restoreDatabaseBackup,
  updateSettings,
  updateStagedCandidate,
  updateStory,
  updateStoryStatus,
  deleteStory,
} from './services/api.js';
import { StoryListView } from './components/StoryListView.js';
import { StoryModal } from './components/StoryModal.js';
import { BatchModal } from './components/BatchModal.js';
import {
  CategoriesSection,
  ExportSection,
  OverviewSection,
  QualitySection,
  SettingsSection,
  SourcesReferenceSection,
  UniquenessSection,
} from './components/Sections.js';
import { ForeignResearchSection } from './components/ForeignResearchSection.js';
import { StoryGeneratorSection } from './components/StoryGeneratorSection.js';
import { ContentStudioSection } from './components/ContentStudioSection.js';
import { AutonomousSchedulerSection } from './components/AutonomousSchedulerSection.js';

interface NavItem {
  id: NavSection;
  label: string;
  icon: React.FC<{ className?: string }>;
  group: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Обзор базы', icon: Database, group: 'База сюжетов' },
  { id: 'debate', label: 'Споры и мнения', icon: MessageSquare, group: 'База сюжетов' },
  { id: 'romantic', label: 'Романтические истории', icon: Heart, group: 'База сюжетов' },
  { id: 'categories', label: 'Категории и подтемы', icon: Layers, group: 'База сюжетов' },
  { id: 'sources', label: 'Источники идей', icon: BookOpen, group: 'База сюжетов' },
  { id: 'uniqueness', label: 'Проверка уникальности', icon: ShieldCheck, group: 'Контроль' },
  { id: 'quality', label: 'Контроль качества', icon: Award, group: 'Контроль' },
  { id: 'research', label: 'Foreign Research', icon: Globe, group: 'Инструменты' },
  { id: 'generator', label: 'Story Generator', icon: Feather, group: 'Инструменты' },
  { id: 'studio', label: 'Content Studio · Публикации', icon: Send, group: 'Инструменты' },
  { id: 'scheduler', label: 'Автопилот · Планировщик', icon: Clock, group: 'Инструменты' },
  { id: 'export', label: 'Экспорт и миграция', icon: Download, group: 'Система' },
  { id: 'settings', label: 'Настройки', icon: Settings, group: 'Система' },
];

export default function App() {
  const [section, setSection] = useState<NavSection>('overview');
  const [snapshot, setSnapshot] = useState<DatabaseSnapshotResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Modals
  const [storyModal, setStoryModal] = useState<{
    open: boolean;
    mode: 'view' | 'create';
    story: StoryPlot | null;
    defaultCollection: CollectionType;
  }>({
    open: false,
    mode: 'view',
    story: null,
    defaultCollection: 'debate',
  });
  const [batchModalOpen, setBatchModalOpen] = useState(false);

  const loadSnapshot = async () => {
    try {
      const data = await fetchDatabase();
      setSnapshot(data);
      setErrorMsg(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Не удалось загрузить базу данных');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSnapshot();
  }, []);

  const currentNav = NAV_ITEMS.find((n) => n.id === section) || NAV_ITEMS[0];

  const renderSidebarContent = () => {
    const groups = ['База сюжетов', 'Контроль', 'Инструменты', 'Система'];
    return (
      <div className="flex h-full flex-col justify-between">
        <div className="space-y-6 px-3 py-5">
          <div className="px-3">
            <div className="font-display text-lg font-bold tracking-tight text-zinc-900">
              MELO_LOVE
            </div>
            <div className="mt-0.5 text-xs text-zinc-500">
              Редакционная студия сюжетов
            </div>
          </div>

          <nav className="space-y-5">
            {groups.map((grp) => (
              <div key={grp} className="space-y-1">
                <div className="px-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  {grp}
                </div>
                {NAV_ITEMS.filter((item) => item.group === grp).map((item) => {
                  const Icon = item.icon;
                  const active = section === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setSection(item.id);
                        setMobileNavOpen(false);
                      }}
                      className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors cursor-pointer ${
                        active
                          ? 'bg-zinc-900 text-white'
                          : 'text-zinc-700 hover:bg-stone-100 hover:text-zinc-900'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>

        {snapshot && (
          <div className="border-t border-stone-200 px-5 py-4 text-xs text-zinc-500 space-y-1">
            <div className="flex justify-between font-mono tabular-nums">
              <span>Сюжетов:</span>
              <span className="font-semibold text-zinc-800">
                {snapshot.stats.total} / {snapshot.database.settings.targetTotal}
              </span>
            </div>
            <div className="flex justify-between font-mono tabular-nums">
              <span>Споры / Романт.:</span>
              <span>
                {snapshot.stats.debateCount} / {snapshot.stats.romanticCount}
              </span>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#FAF9F7] text-zinc-900 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-[256px] shrink-0 border-r border-stone-200 bg-white">
        <div className="sticky top-0 h-screen overflow-y-auto">{renderSidebarContent()}</div>
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div
            className="fixed inset-0 bg-zinc-950/40"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative z-50 w-[264px] bg-white border-r border-stone-200 h-full overflow-y-auto">
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              className="absolute right-3 top-4 rounded p-1 text-zinc-400 hover:text-zinc-700"
            >
              <X className="h-5 w-5" />
            </button>
            {renderSidebarContent()}
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar Contract: single-line controls, max 1-2 primary CTA actions */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-stone-200 bg-white/95 px-4 sm:px-6 backdrop-blur-sm">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="rounded-md p-1.5 text-zinc-600 hover:bg-stone-100 lg:hidden cursor-pointer"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="truncate text-sm font-semibold text-zinc-900">
              {currentNav.group} <span className="mx-1.5 text-zinc-300">/</span> {currentNav.label}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() =>
                setStoryModal({
                  open: true,
                  mode: 'create',
                  story: null,
                  defaultCollection: section === 'romantic' ? 'romantic' : 'debate',
                })
              }
              className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-stone-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              Новый сюжет
            </button>

            <button
              type="button"
              onClick={() => setBatchModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-rose-800 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-rose-900 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {snapshot?.pendingBatch
                ? `Приёмка партии (${snapshot.pendingBatch.candidates.length})`
                : 'Создать следующую партию'}
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
          {errorMsg && (
            <div className="mb-5 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
              {errorMsg}
            </div>
          )}

          {loading || !snapshot ? (
            <div className="py-16 text-center text-sm text-zinc-500">
              Загружаем базу сюжетных основ MELO_LOVE...
            </div>
          ) : (
            <>
              {section === 'overview' && (
                <OverviewSection
                  stats={snapshot.stats}
                  settings={snapshot.database.settings}
                  batches={snapshot.database.batches}
                  pendingBatch={snapshot.pendingBatch}
                  stories={snapshot.database.stories}
                  onNavigate={setSection}
                  onOpenBatchModal={() => setBatchModalOpen(true)}
                  onOpenStory={(story) =>
                    setStoryModal({
                      open: true,
                      mode: 'view',
                      story,
                      defaultCollection: story.collection,
                    })
                  }
                />
              )}

              {(section === 'debate' || section === 'romantic') && (
                <StoryListView
                  collection={section}
                  stories={snapshot.database.stories}
                  customCategories={snapshot.database.customCategories}
                  onOpenStory={(story) =>
                    setStoryModal({
                      open: true,
                      mode: 'view',
                      story,
                      defaultCollection: story.collection,
                    })
                  }
                  onCreateNew={(col) =>
                    setStoryModal({
                      open: true,
                      mode: 'create',
                      story: null,
                      defaultCollection: col,
                    })
                  }
                  onQuickStatus={async (id, payload) => {
                    const res = await updateStoryStatus(id, payload);
                    setSnapshot(res.snapshot);
                  }}
                  onDeleteStory={async (id) => {
                    const res = await deleteStory(id);
                    setSnapshot(res.snapshot);
                  }}
                />
              )}

              {section === 'categories' && (
                <CategoriesSection
                  stories={snapshot.database.stories}
                  customCategories={snapshot.database.customCategories}
                  onCreateCategory={async (payload) => {
                    const res = await createCustomCategory(payload);
                    setSnapshot(res.snapshot);
                  }}
                />
              )}

              {section === 'sources' && (
                <SourcesReferenceSection onNavigateResearch={() => setSection('research')} />
              )}

              {section === 'uniqueness' && (
                <UniquenessSection
                  stories={snapshot.database.stories}
                  similarityThreshold={snapshot.database.settings.similarityThreshold}
                  onRescan={async () => {
                    const res = await rescanUniqueness();
                    setSnapshot(res.snapshot);
                  }}
                  onOpenStory={(story) =>
                    setStoryModal({
                      open: true,
                      mode: 'view',
                      story,
                      defaultCollection: story.collection,
                    })
                  }
                  onMergeStories={async (payload) => {
                    const res = await mergeStories(payload);
                    setSnapshot(res.snapshot);
                  }}
                />
              )}

              {section === 'quality' && (
                <QualitySection
                  stories={snapshot.database.stories}
                  minQualityScore={snapshot.database.settings.minQualityScore}
                  onOpenStory={(story) =>
                    setStoryModal({
                      open: true,
                      mode: 'view',
                      story,
                      defaultCollection: story.collection,
                    })
                  }
                />
              )}

              {section === 'research' && (
                <ForeignResearchSection onDatabaseChanged={loadSnapshot} />
              )}

              {section === 'generator' && (
                <StoryGeneratorSection onDatabaseChanged={loadSnapshot} />
              )}

              {section === 'studio' && (
                <ContentStudioSection onDatabaseChanged={loadSnapshot} />
              )}

              {section === 'scheduler' && (
                <AutonomousSchedulerSection onDatabaseChanged={loadSnapshot} />
              )}

              {section === 'export' && (
                <ExportSection
                  backups={snapshot.backups}
                  onCreateBackup={async () => {
                    const res = await createDatabaseBackup();
                    setSnapshot(res.snapshot);
                  }}
                  onRestoreBackup={async (filename) => {
                    const res = await restoreDatabaseBackup(filename);
                    setSnapshot(res.snapshot);
                  }}
                  onImportJson={async (stories) => {
                    const res = await importStoriesJson(stories);
                    setSnapshot(res.snapshot);
                    return {
                      imported: res.imported,
                      skippedDuplicates: res.skippedDuplicates,
                    };
                  }}
                />
              )}

              {section === 'settings' && (
                <SettingsSection
                  settings={snapshot.database.settings}
                  onSaveSettings={async (updates) => {
                    const res = await updateSettings(updates);
                    setSnapshot(res.snapshot);
                  }}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Story Modal */}
      {storyModal.open && snapshot && (
        <StoryModal
          mode={storyModal.mode}
          story={storyModal.story}
          defaultCollection={storyModal.defaultCollection}
          customCategories={snapshot.database.customCategories}
          onClose={() =>
            setStoryModal((prev) => ({
              ...prev,
              open: false,
            }))
          }
          onSaveExisting={async (id, updates) => {
            const res = await updateStory(id, updates);
            setSnapshot(res.snapshot);
          }}
          onCreateStory={async (payload) => {
            const res = await createStory(payload);
            setSnapshot(res.snapshot);
          }}
          onMergeStory={async (payload) => {
            const res = await mergeStories(payload);
            setSnapshot(res.snapshot);
          }}
        />
      )}

      {/* Batch Modal */}
      {batchModalOpen && snapshot && (
        <BatchModal
          pendingBatch={snapshot.pendingBatch}
          defaultBatchSize={snapshot.database.settings.defaultBatchSize}
          customCategories={snapshot.database.customCategories}
          onClose={() => setBatchModalOpen(false)}
          onGenerateBatch={async (payload) => {
            const res = await generateBatch(payload);
            setSnapshot((prev) =>
              prev ? { ...prev, pendingBatch: res.pendingBatch } : prev
            );
          }}
          onUpdateCandidate={async (candidateId, updates) => {
            const res = await updateStagedCandidate(candidateId, updates);
            setSnapshot((prev) =>
              prev ? { ...prev, pendingBatch: res.pendingBatch } : prev
            );
          }}
          onCommitBatch={async () => {
            const res = await commitStagedBatch();
            setSnapshot(res.snapshot);
          }}
          onDiscardBatch={async () => {
            const res = await discardStagedBatch();
            setSnapshot(res.snapshot);
          }}
        />
      )}
    </div>
  );
}
