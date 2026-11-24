import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Award,
  BookMarked,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Edit3,
  FileJson,
  FileText,
  History,
  Layers,
  Mic,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sliders,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  XCircle,
} from 'lucide-react';
import {
  CONTENT_LENGTH_RANGES,
  NARRATIVE_STRUCTURE_LABELS,
  countWords,
} from '../shared/contentUtils.ts';
import type {
  CollectionType,
  ContentDraft,
  ContentDraftStatus,
  ContentLengthPreset,
  ContentRevisionSnapshot,
  ContentStatistics,
  NarrativeStructurePattern,
  PhrasebookEntry,
  PhrasebookTone,
  RewriteActionType,
  SentenceLengthMode,
  StoryPlot,
  VoiceEngineConfig,
  VoiceProfileSettings,
  VoiceSliders,
} from '../shared/types.ts';
import * as api from '../services/api.ts';
import type {
  AvailableStoryItem,
  BackupSnapshotInfo,
  ContentDraftListItem,
} from '../services/api.ts';

type GeneratorTab =
  | 'generate'
  | 'drafts'
  | 'ready'
  | 'history'
  | 'voice'
  | 'phrasebook'
  | 'quality_settings';

interface StoryGeneratorSectionProps {
  onDatabaseUpdated: () => Promise<void>;
}

const DRAFT_STATUS_LABELS: Record<ContentDraftStatus, string> = {
  generating: 'Генерируется',
  draft: 'Черновик',
  needs_revision: 'Требует редактуры',
  ready_for_review: 'Готов к проверке',
  approved: 'Утверждена',
  rejected: 'Отклонена',
  archived: 'В архиве',
};

const TONE_LABELS: Record<PhrasebookTone, string> = {
  ironic: 'Ироничный',
  intrigued: 'Интрига',
  skeptical: 'Скепсис',
  warm: 'Тёплый',
  observational: 'Наблюдение',
  neutral: 'Нейтральный',
};

export const StoryGeneratorSection: React.FC<StoryGeneratorSectionProps> = ({
  onDatabaseUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<GeneratorTab>('generate');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  const [stats, setStats] = useState<ContentStatistics | null>(null);
  const [geminiConfigured, setGeminiConfigured] = useState(true);
  const [backups, setBackups] = useState<BackupSnapshotInfo[]>([]);
  const [stories, setStories] = useState<AvailableStoryItem[]>([]);
  const [drafts, setDrafts] = useState<ContentDraftListItem[]>([]);
  const [voiceConfig, setVoiceConfig] = useState<VoiceEngineConfig | null>(null);
  const [phrasebook, setPhrasebook] = useState<PhrasebookEntry[]>([]);

  // Generation Workspace State
  const [storyFilterCol, setStoryFilterCol] = useState<'ALL' | CollectionType>('ALL');
  const [storyFilterResearch, setStoryFilterResearch] = useState<'ALL' | 'true' | 'false'>('ALL');
  const [storySearch, setStorySearch] = useState('');
  const [includeDraftedStories, setIncludeDraftedStories] = useState(false);
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);

  const [lengthPreset, setLengthPreset] = useState<ContentLengthPreset>('standard');
  const [narrativeChoice, setNarrativeChoice] = useState<'auto' | NarrativeStructurePattern>('auto');
  const [selectedVoiceProfileId, setSelectedVoiceProfileId] = useState<string>('');
  const [slidersOverride, setSlidersOverride] = useState<Partial<VoiceSliders>>({});

  // Working Draft / Unsaved Candidate State
  const [workingDraft, setWorkingDraft] = useState<Partial<ContentDraft> | null>(null);
  const [variantCandidates, setVariantCandidates] = useState<Array<Partial<ContentDraft>>>([]);
  const [activeVariantIdx, setActiveVariantIdx] = useState(0);

  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [customRewritePrompt, setCustomRewritePrompt] = useState('');

  // Drafts / Ready List Filters & Multi-select
  const [draftColFilter, setDraftColFilter] = useState<'ALL' | CollectionType>('ALL');
  const [draftStatusFilter, setDraftStatusFilter] = useState<'ALL' | ContentDraftStatus>('ALL');
  const [draftMinQuality, setDraftMinQuality] = useState<number>(0);
  const [draftResearchFilter, setDraftResearchFilter] = useState<'ALL' | 'true' | 'false'>('ALL');
  const [draftDateFrom, setDraftDateFrom] = useState('');
  const [selectedExportIds, setSelectedExportIds] = useState<Set<string>>(new Set());

  // Version History Tab
  const [historyDraftId, setHistoryDraftId] = useState<string | null>(null);
  const [historyVersions, setHistoryVersions] = useState<ContentRevisionSnapshot[]>([]);
  const [historyCurrentDraft, setHistoryCurrentDraft] = useState<ContentDraft | null>(null);

  // Voice Engine Editor State
  const [voiceEditTab, setVoiceEditTab] = useState<CollectionType>('debate');
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileDesc, setNewProfileDesc] = useState('');

  // Phrasebook Form State
  const [newPhrase, setNewPhrase] = useState('');
  const [newPhraseCollections, setNewPhraseCollections] = useState<CollectionType[]>(['debate']);
  const [newPhraseTone, setNewPhraseTone] = useState<PhrasebookTone>('observational');
  const [newPhraseFreq, setNewPhraseFreq] = useState(2);
  const [newPhraseWeight, setNewPhraseWeight] = useState(7);
  const [newPhraseNotes, setNewPhraseNotes] = useState('');

  const loadAll = useCallback(async () => {
    try {
      setErrorMsg(null);
      const [statsRes, storiesRes, draftsRes, voiceRes, phraseRes] = await Promise.all([
        api.fetchContentStatistics(),
        api.fetchAvailableStoriesForContent({
          includeDrafted: includeDraftedStories,
        }),
        api.fetchContentDrafts(),
        api.fetchVoiceConfig(),
        api.fetchPhrasebook(),
      ]);
      setStats(statsRes.stats);
      setGeminiConfigured(statsRes.geminiConfigured);
      setBackups(statsRes.backups);
      setStories(storiesRes.stories);
      setDrafts(draftsRes.drafts);
      setVoiceConfig(voiceRes.voiceConfig);
      setPhrasebook(phraseRes.phrasebook);

      if (!selectedStoryId && storiesRes.stories.length > 0) {
        setSelectedStoryId(storiesRes.stories[0].id);
      }
    } catch (err) {
      setErrorMsg((err as Error).message || 'Не удалось загрузить данные генератора.');
    } finally {
      setLoading(false);
    }
  }, [includeDraftedStories, selectedStoryId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const selectedStory = useMemo(
    () => stories.find((s) => s.id === selectedStoryId) || null,
    [stories, selectedStoryId]
  );

  // Sync default profile selection when story changes
  useEffect(() => {
    if (!selectedStory || !voiceConfig) return;
    const defId =
      selectedStory.collection === 'debate'
        ? voiceConfig.debateProfileId
        : voiceConfig.romanticProfileId;
    setSelectedVoiceProfileId(defId);
    setSlidersOverride({});
  }, [selectedStory, voiceConfig]);

  const filteredStories = useMemo(() => {
    return stories.filter((s) => {
      if (storyFilterCol !== 'ALL' && s.collection !== storyFilterCol) return false;
      if (storyFilterResearch === 'true' && !s.researchId && s.originType !== 'external') return false;
      if (storyFilterResearch === 'false' && (Boolean(s.researchId) || s.originType === 'external'))
        return false;
      if (storySearch.trim()) {
        const q = storySearch.toLowerCase();
        return (
          s.id.toLowerCase().includes(q) ||
          s.title.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q) ||
          s.shortDescription.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [stories, storyFilterCol, storyFilterResearch, storySearch]);

  const filteredDrafts = useMemo(() => {
    return drafts.filter((d) => {
      if (activeTab === 'ready' && !['ready_for_review', 'approved'].includes(d.status)) {
        return false;
      }
      if (draftColFilter !== 'ALL' && d.collection !== draftColFilter) return false;
      if (activeTab === 'drafts' && draftStatusFilter !== 'ALL' && d.status !== draftStatusFilter)
        return false;
      if (d.qualityScore < draftMinQuality) return false;
      if (draftResearchFilter === 'true' && !d.researchId && d.sourceOriginType !== 'external')
        return false;
      if (draftResearchFilter === 'false' && (Boolean(d.researchId) || d.sourceOriginType === 'external'))
        return false;
      if (draftDateFrom && d.createdAt.slice(0, 10) < draftDateFrom) return false;
      return true;
    });
  }, [
    drafts,
    activeTab,
    draftColFilter,
    draftStatusFilter,
    draftMinQuality,
    draftResearchFilter,
    draftDateFrom,
  ]);

  const loadVersionsForDraft = async (draftId: string) => {
    setHistoryDraftId(draftId);
    try {
      const res = await api.fetchContentVersions(draftId);
      setHistoryVersions(res.versions);
      setHistoryCurrentDraft(res.currentDraft);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleGenerateSingle = async () => {
    if (!selectedStory) return;
    const taskId = `GEN-${Date.now().toString(36).toUpperCase()}`;
    setBusyTaskId(taskId);
    setBusyLabel(`Генерация публикации по сюжету ${selectedStory.id} через MELO_LOVE VOICE ENGINE...`);
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const res = await api.generateContentPublication({
        sourceStoryId: selectedStory.id,
        voiceProfileId: selectedVoiceProfileId || undefined,
        voiceSlidersOverride: slidersOverride,
        lengthPreset,
        narrativeStructure: narrativeChoice,
        autoSaveDraft: false,
        taskId,
      });
      setVariantCandidates([]);
      setWorkingDraft(res.candidate);
      setNoticeMsg(
        `Сформирован черновик (${res.candidate.contentLength} слов, оценка качества: ${res.candidate.qualityScore}/100). Проверьте текст и нажмите «Сохранить черновик».`
      );
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusyTaskId(null);
      setBusyLabel(null);
    }
  };

  const handleGenerateVariants = async () => {
    if (!selectedStory) return;
    const taskId = `VAR-${Date.now().toString(36).toUpperCase()}`;
    setBusyTaskId(taskId);
    setBusyLabel(`Генерация до 3 различных вариантов по сюжету ${selectedStory.id}...`);
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const res = await api.generateContentVariants({
        sourceStoryId: selectedStory.id,
        count: 3,
        voiceProfileId: selectedVoiceProfileId || undefined,
        voiceSlidersOverride: slidersOverride,
        lengthPreset,
        taskId,
      });
      setVariantCandidates(res.variants);
      setActiveVariantIdx(0);
      if (res.variants.length > 0) {
        setWorkingDraft(res.variants[0]);
      }
      setNoticeMsg(
        `Создано ${res.variants.length} разноплановых варианта. Переключайтесь между вкладками вариантов и сохраните нужные.`
      );
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusyTaskId(null);
      setBusyLabel(null);
    }
  };

  const handleCancelBusyTask = async () => {
    if (!busyTaskId) return;
    try {
      await api.cancelContentTask(busyTaskId);
      setNoticeMsg('Запрос на отмену генерации отправлен.');
    } catch {
      // ignore cancel UI error
    }
  };

  const handleRewrite = async (action: RewriteActionType) => {
    if (!workingDraft || !workingDraft.body) return;
    const taskId = `REW-${Date.now().toString(36).toUpperCase()}`;
    setBusyTaskId(taskId);
    setBusyLabel('Редактура текста и пересчёт качества...');
    setErrorMsg(null);
    try {
      if (action === 'rewrite_opening' || action === 'rewrite_ending') {
        const res = await api.rewriteContentSection({
          draftId: workingDraft.id,
          draftSnapshot: workingDraft.id ? undefined : workingDraft,
          section: action === 'rewrite_opening' ? 'opening' : 'ending',
          customInstruction: customRewritePrompt || undefined,
          taskId,
        });
        const next = res.draft || (res.rewritten as Partial<ContentDraft>);
        setWorkingDraft(next);
        setNoticeMsg('Фрагмент переписан; предыдущая версия сохранена в истории.');
      } else {
        const res = await api.rewriteContentPublication({
          draftId: workingDraft.id,
          draftSnapshot: workingDraft.id ? undefined : workingDraft,
          action,
          customInstruction: customRewritePrompt || undefined,
          taskId,
        });
        const next = res.draft || (res.rewritten as Partial<ContentDraft>);
        setWorkingDraft(next);
        setNoticeMsg('Текст переработан с сохранением предыдущей версии в истории.');
      }
      await loadAll();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusyTaskId(null);
      setBusyLabel(null);
    }
  };

  const handleQualityRecheck = async () => {
    if (!workingDraft || !workingDraft.body) return;
    setBusyTaskId('QC');
    setBusyLabel('Проверка качества и соответствия исходному сюжету...');
    setErrorMsg(null);
    try {
      const res = await api.checkContentQuality({
        draftId: workingDraft.id,
        sourceStoryId: workingDraft.sourceStoryId || selectedStory?.id,
        title: workingDraft.title,
        excerpt: workingDraft.excerpt,
        body: workingDraft.body,
        mainTriggerQuestion: workingDraft.mainTriggerQuestion,
      });
      if (res.draft) {
        setWorkingDraft(res.draft);
      } else {
        setWorkingDraft((prev) =>
          prev
            ? {
                ...prev,
                qualityScore: res.qualityBreakdown.overall,
                qualityBreakdown: res.qualityBreakdown,
                editorialNotes: res.qualityBreakdown.editorialNotes,
              }
            : prev
        );
      }
      setNoticeMsg(`Оценка качества обновлена: ${res.qualityBreakdown.overall}/100 (${res.qualityBreakdown.tierLabel}).`);
      await loadAll();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusyTaskId(null);
      setBusyLabel(null);
    }
  };

  const handleSaveWorkingDraft = async () => {
    if (!workingDraft || !workingDraft.body || !workingDraft.title) return;
    setErrorMsg(null);
    try {
      if (workingDraft.id) {
        const res = await api.updateContentDraft(workingDraft.id, {
          title: workingDraft.title,
          alternativeTitles: workingDraft.alternativeTitles,
          excerpt: workingDraft.excerpt,
          body: workingDraft.body,
          mainTriggerQuestion: workingDraft.mainTriggerQuestion,
          editorialNotes: workingDraft.editorialNotes,
        });
        setWorkingDraft(res.draft);
        setNoticeMsg(`Изменения черновика ${res.draft.id} сохранены (предыдущий вариант добавлен в историю).`);
      } else {
        const res = await api.saveContentDraft({
          ...workingDraft,
          sourceStoryId: workingDraft.sourceStoryId || selectedStory?.id,
        });
        setWorkingDraft(res.draft);
        setNoticeMsg(
          `Черновик ${res.draft.id} сохранён. Статус исходного сюжета ${res.draft.sourceStoryId} обновлён на «drafted».`
        );
      }
      await loadAll();
      await onDatabaseUpdated();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleSetDraftStatus = async (draftId: string, status: ContentDraftStatus) => {
    setErrorMsg(null);
    try {
      const res = await api.updateContentDraftStatus(draftId, status);
      if (workingDraft?.id === draftId) {
        setWorkingDraft(res.draft);
      }
      setNoticeMsg(`Статус публикации ${draftId} изменён на «${DRAFT_STATUS_LABELS[status]}».`);
      await loadAll();
      await onDatabaseUpdated();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleDeleteDraft = async (draftId: string) => {
    setErrorMsg(null);
    try {
      await api.deleteContentDraft(draftId);
      if (workingDraft?.id === draftId) {
        setWorkingDraft(null);
      }
      setNoticeMsg(`Черновик ${draftId} удалён.`);
      await loadAll();
      await onDatabaseUpdated();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleOpenDraftInEditor = async (draftId: string) => {
    setErrorMsg(null);
    try {
      const res = await api.fetchContentDraft(draftId);
      setWorkingDraft(res.draft);
      setVariantCandidates([]);
      setIncludeDraftedStories(true);
      setSelectedStoryId(res.draft.sourceStoryId);
      setActiveTab('generate');
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleRestoreRevision = async (draftId: string, versionId: string) => {
    setErrorMsg(null);
    try {
      const res = await api.restoreContentVersion(draftId, versionId);
      setNoticeMsg(`Версия восстановлена для ${draftId}.`);
      await loadVersionsForDraft(draftId);
      await loadAll();
      if (workingDraft?.id === draftId) setWorkingDraft(res.draft);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleImportJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await api.importContentJson(parsed);
      setNoticeMsg(
        `Импортировано публикаций: ${res.importedCount}.${
          res.rejectedErrors.length > 0 ? ` Пропущено с ошибками: ${res.rejectedErrors.length}` : ''
        }`
      );
      if (res.rejectedErrors.length > 0) {
        setErrorMsg(res.rejectedErrors.slice(0, 3).join(' | '));
      }
      await loadAll();
      await onDatabaseUpdated();
    } catch (err) {
      setErrorMsg(`Ошибка импорта JSON: ${(err as Error).message}`);
    } finally {
      e.target.value = '';
    }
  };

  const handleSaveVoiceConfig = async (nextConfig: VoiceEngineConfig) => {
    setErrorMsg(null);
    try {
      const res = await api.saveVoiceConfigApi(nextConfig);
      setVoiceConfig(res.voiceConfig);
      setNoticeMsg('Настройки MELO_LOVE VOICE ENGINE сохранены на диск.');
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleCreateCustomVoiceProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voiceConfig || !newProfileName.trim()) return;
    const baseSliders = voiceConfig.rubricSettings[voiceEditTab];
    const newProfile: VoiceProfileSettings = {
      id: `custom_${Date.now().toString(36)}`,
      name: newProfileName.trim(),
      description: newProfileDesc.trim() || 'Пользовательский голосовой профиль редактора',
      collectionHint: voiceEditTab,
      isCustom: true,
      ...baseSliders,
    };
    const nextConfig: VoiceEngineConfig = {
      ...voiceConfig,
      profiles: [...voiceConfig.profiles, newProfile],
    };
    await handleSaveVoiceConfig(nextConfig);
    setNewProfileName('');
    setNewProfileDesc('');
  };

  const handleAddPhrase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPhrase.trim()) return;
    setErrorMsg(null);
    try {
      const res = await api.addPhrasebookEntry({
        phrase: newPhrase.trim(),
        collections: newPhraseCollections.length > 0 ? newPhraseCollections : ['debate'],
        tone: newPhraseTone,
        maxFrequencyPer10: newPhraseFreq,
        weight: newPhraseWeight,
        notes: newPhraseNotes.trim(),
      });
      setPhrasebook(res.phrasebook);
      setNewPhrase('');
      setNewPhraseNotes('');
      setNoticeMsg('Выражение добавлено в словарь MELO_LOVE.');
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-24 rounded-lg border border-slate-200 bg-white" />
        <div className="h-96 rounded-lg border border-slate-200 bg-white" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header & Summary Metrics */}
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-indigo-700" />
              <h1 className="text-xl font-bold text-slate-900">STORY GENERATOR + MELO_LOVE VOICE ENGINE</h1>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Редакционный генератор публикаций для Яндекс Дзена на основе подтверждённых сюжетов из STORY DATABASE.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!geminiConfigured && (
              <span className="border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
                GEMINI_API_KEY не настроен
              </span>
            )}
            <a
              href="/api/content/export/json?mode=with_source"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" />
              Экспорт всех в JSON
            </a>
          </div>
        </div>

        {/* 7 Key Dashboard Counters */}
        {stats && (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
              <div className="text-[11px] font-medium text-slate-500">Одобрено в базе</div>
              <div className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums">
                {stats.approvedStoriesCount}
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
              <div className="text-[11px] font-medium text-slate-500">Свободно (unused)</div>
              <div className="mt-1 font-mono text-lg font-bold text-indigo-700 tabular-nums">
                {stats.unusedApprovedStoriesCount}
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
              <div className="text-[11px] font-medium text-slate-500">Всего публикаций</div>
              <div className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums">
                {stats.totalDraftsCount}
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
              <div className="text-[11px] font-medium text-slate-500">Черновики</div>
              <div className="mt-1 font-mono text-lg font-bold text-slate-800 tabular-nums">
                {stats.draftsInProgressCount + stats.needsRevisionCount}
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
              <div className="text-[11px] font-medium text-slate-500">Ждут проверки</div>
              <div className="mt-1 font-mono text-lg font-bold text-amber-700 tabular-nums">
                {stats.readyForReviewCount}
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
              <div className="text-[11px] font-medium text-slate-500">Среднее качество</div>
              <div className="mt-1 font-mono text-lg font-bold text-emerald-700 tabular-nums">
                {stats.averageQualityScore}/100
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
              <div className="text-[11px] font-medium text-slate-500">Споры / Романтика</div>
              <div className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums">
                {stats.debateDraftsCount} / {stats.romanticDraftsCount}
              </div>
            </div>
          </div>
        )}

        {/* 7 Sub-Tabs Navigation */}
        <div className="mt-5 flex flex-wrap gap-1 border-b border-slate-200">
          {(
            [
              { id: 'generate', label: 'Генерация', icon: Wand2 },
              { id: 'drafts', label: `Черновики (${drafts.length})`, icon: FileText },
              {
                id: 'ready',
                label: `Готовые публикации (${
                  drafts.filter((d) => ['ready_for_review', 'approved'].includes(d.status)).length
                })`,
                icon: CheckCircle2,
              },
              { id: 'history', label: 'История версий', icon: History },
              { id: 'voice', label: 'MELO_LOVE VOICE ENGINE', icon: Mic },
              { id: 'phrasebook', label: `Словарь выражений (${phrasebook.length})`, icon: BookMarked },
              { id: 'quality_settings', label: 'Настройки качества', icon: Sliders },
            ] as Array<{ id: GeneratorTab; label: string; icon: React.FC<{ className?: string }> }>
          ).map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  active
                    ? 'border-indigo-700 text-indigo-800'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Global Alerts */}
      {errorMsg && (
        <div className="flex items-start justify-between gap-3 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-rose-700 hover:underline shrink-0"
          >
            Скрыть
          </button>
        </div>
      )}

      {noticeMsg && (
        <div className="flex items-start justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
          <div className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <span>{noticeMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setNoticeMsg(null)}
            className="text-emerald-800 hover:underline shrink-0"
          >
            Скрыть
          </button>
        </div>
      )}

      {/* Active Task Bar with Cancel */}
      {busyTaskId && (
        <div className="flex items-center justify-between gap-4 rounded-md border border-indigo-200 bg-indigo-50 px-4 py-3 text-xs text-indigo-950">
          <div className="flex items-center gap-2 font-medium">
            <RefreshCw className="h-4 w-4 animate-spin text-indigo-700" />
            <span>{busyLabel || 'Выполняется обработка...'}</span>
          </div>
          {busyTaskId !== 'QC' && (
            <button
              type="button"
              onClick={handleCancelBusyTask}
              className="rounded border border-indigo-300 bg-white px-2.5 py-1 font-semibold text-indigo-800 hover:bg-indigo-100"
            >
              Отменить
            </button>
          )}
        </div>
      )}

      {/* ====================================================================
          TAB 1: GENERATION WORKSPACE (LEFT: SOURCE STORY, RIGHT: EDITOR)
         ==================================================================== */}
      {activeTab === 'generate' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* LEFT PANEL: Source Story Picker & Full Plot Details */}
          <div className="space-y-4 lg:col-span-5">
            <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">
                  1. Выбор исходного сюжета ({filteredStories.length})
                </h2>
                <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeDraftedStories}
                    onChange={(e) => setIncludeDraftedStories(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  Включить взятые в черновик
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <select
                  value={storyFilterCol}
                  onChange={(e) => setStoryFilterCol(e.target.value as 'ALL' | CollectionType)}
                  className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                >
                  <option value="ALL">Все рубрики</option>
                  <option value="debate">Кто здесь прав? (debate)</option>
                  <option value="romantic">Романтика (romantic)</option>
                </select>
                <select
                  value={storyFilterResearch}
                  onChange={(e) => setStoryFilterResearch(e.target.value as 'ALL' | 'true' | 'false')}
                  className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                >
                  <option value="ALL">Любое происхождение</option>
                  <option value="true">Из FOREIGN RESEARCH</option>
                  <option value="false">Оригинальные сюжеты</option>
                </select>
              </div>

              <input
                type="text"
                value={storySearch}
                onChange={(e) => setStorySearch(e.target.value)}
                placeholder="Поиск по ID, названию или категории..."
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs"
              />

              <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
                {filteredStories.length === 0 ? (
                  <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                    Нет доступных сюжетов с verificationStatus=approved и usageStatus=unused по заданным фильтрам.
                  </div>
                ) : (
                  filteredStories.map((s) => {
                    const active = s.id === selectedStoryId;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSelectedStoryId(s.id)}
                        className={`w-full rounded-md border p-2.5 text-left transition-colors ${
                          active
                            ? 'border-indigo-700 bg-indigo-50/70'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="font-mono font-semibold text-indigo-800">{s.id}</span>
                          <span className="text-slate-500 truncate">
                            {s.collection === 'debate' ? 'Дискуссия' : 'Романтика'} · {s.usageStatus}
                            {s.linkedDraftsCount > 0 ? ` (${s.linkedDraftsCount} вар.)` : ''}
                          </span>
                        </div>
                        <div className="mt-1 text-xs font-semibold text-slate-900 line-clamp-2">
                          {s.title}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500 truncate">{s.category}</div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Full Source Story Preview (Read-Only) */}
            {selectedStory && (
              <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3 text-xs">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div>
                    <span className="font-mono font-bold text-indigo-800">{selectedStory.id}</span>
                    <span className="ml-2 text-slate-500">{selectedStory.category}</span>
                  </div>
                  <a
                    href={`/api/content/export/json?mode=story_only&storyId=${encodeURIComponent(
                      selectedStory.id
                    )}`}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 hover:underline"
                  >
                    <Download className="h-3 w-3" />
                    JSON сюжета
                  </a>
                </div>

                <div>
                  <div className="font-semibold text-slate-900">{selectedStory.title}</div>
                  <p className="mt-1 text-slate-700 whitespace-pre-line">{selectedStory.fullPlot}</p>
                </div>

                <div className="grid grid-cols-1 gap-2 rounded bg-slate-50 p-2.5 text-[11px] text-slate-700">
                  <div>
                    <span className="font-semibold text-slate-900">Участники:</span>{' '}
                    {selectedStory.participants || '—'}
                  </div>
                  <div>
                    <span className="font-semibold text-slate-900">Обстановка:</span>{' '}
                    {selectedStory.setting || '—'}
                  </div>
                  <div>
                    <span className="font-semibold text-slate-900">Суть/конфликт:</span>{' '}
                    {selectedStory.coreConflictOrAction || '—'}
                  </div>
                  <div>
                    <span className="font-semibold text-slate-900">Сторона A:</span>{' '}
                    {selectedStory.sideAPosition || '—'}
                  </div>
                  <div>
                    <span className="font-semibold text-slate-900">Сторона B:</span>{' '}
                    {selectedStory.sideBPosition || '—'}
                  </div>
                  <div>
                    <span className="font-semibold text-slate-900">Эмоциональный механизм:</span>{' '}
                    {selectedStory.emotionalMechanism || '—'}
                  </div>
                  <div>
                    <span className="font-semibold text-slate-900">Скрытое ожидание:</span>{' '}
                    {selectedStory.hiddenExpectation || '—'}
                  </div>
                  <div>
                    <span className="font-semibold text-slate-900">Неожиданный нюанс:</span>{' '}
                    {selectedStory.unexpectedNuance || '—'}
                  </div>
                  <div>
                    <span className="font-semibold text-slate-900">Возможный поворот:</span>{' '}
                    {selectedStory.possibleTwist || '—'}
                  </div>
                  <div>
                    <span className="font-semibold text-slate-900">Триггер-вопрос базы:</span>{' '}
                    {selectedStory.mainTriggerQuestion || '—'}
                  </div>
                  {(selectedStory.researchId || selectedStory.sourceUrl) && (
                    <div className="border-t border-slate-200 pt-1.5 text-slate-600">
                      <span className="font-semibold text-slate-900">Внешнее исследование:</span>{' '}
                      {selectedStory.researchId || 'Внешний источник'}{' '}
                      {selectedStory.sourceUrl && (
                        <a
                          href={selectedStory.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-700 underline break-all"
                        >
                          {selectedStory.sourceUrl}
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT PANEL: VOICE SETTINGS, GENERATION & EDITORIAL WORKBENCH */}
          <div className="space-y-4 lg:col-span-7">
            {/* Generation Controls */}
            <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-bold text-slate-900">
                  2. Настройка стиля и запуск генерации
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!selectedStory || Boolean(busyTaskId)}
                    onClick={handleGenerateSingle}
                    className="inline-flex items-center gap-1.5 rounded-md bg-indigo-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-800 disabled:opacity-50"
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    Сгенерировать публикацию
                  </button>
                  <button
                    type="button"
                    disabled={!selectedStory || Boolean(busyTaskId)}
                    onClick={handleGenerateVariants}
                    className="inline-flex items-center gap-1.5 rounded-md border border-indigo-700 bg-white px-3 py-2 text-xs font-semibold text-indigo-800 hover:bg-indigo-50 disabled:opacity-50"
                  >
                    <Layers className="h-3.5 w-3.5" />
                    Создать 3 варианта
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600">
                    Голосовой профиль
                  </label>
                  <select
                    value={selectedVoiceProfileId}
                    onChange={(e) => {
                      setSelectedVoiceProfileId(e.target.value);
                      setSlidersOverride({});
                    }}
                    className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                  >
                    {(voiceConfig?.profiles || []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600">
                    Объём публикации
                  </label>
                  <select
                    value={lengthPreset}
                    onChange={(e) => setLengthPreset(e.target.value as ContentLengthPreset)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                  >
                    {Object.entries(
                      CONTENT_LENGTH_RANGES[selectedStory?.collection || 'debate']
                    ).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600">
                    Композиционный зачин
                  </label>
                  <select
                    value={narrativeChoice}
                    onChange={(e) =>
                      setNarrativeChoice(e.target.value as 'auto' | NarrativeStructurePattern)
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                  >
                    <option value="auto">Автоматическое разнообразие</option>
                    {Object.entries(NARRATIVE_STRUCTURE_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Quick Voice Sliders before Generation */}
              {voiceConfig && (
                <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 sm:grid-cols-3 text-[11px]">
                  {(
                    [
                      { key: 'irony', label: 'Ирония' },
                      { key: 'conversational', label: 'Разговорность' },
                      { key: 'emotionality', label: 'Эмоциональность' },
                      { key: 'provocativeness', label: 'Провокационность' },
                      { key: 'phraseDensity', label: 'Плотность фраз' },
                      { key: 'dramaLevel', label: 'Драматичность' },
                    ] as Array<{ key: keyof VoiceSliders; label: string }>
                  ).map((item) => {
                    const activeProfile = voiceConfig.profiles.find(
                      (p) => p.id === selectedVoiceProfileId
                    );
                    const val =
                      (slidersOverride[item.key] as number | undefined) ??
                      ((activeProfile?.[item.key] as number | undefined) ?? 6);
                    return (
                      <label key={item.key} className="block">
                        <div className="flex justify-between text-slate-600">
                          <span>{item.label}</span>
                          <span className="font-mono font-semibold text-slate-900 tabular-nums">
                            {val}/10
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={10}
                          value={val}
                          onChange={(e) =>
                            setSlidersOverride((prev) => ({
                              ...prev,
                              [item.key]: Number(e.target.value),
                            }))
                          }
                          className="mt-1 w-full accent-indigo-700"
                        />
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Variants Selector Strip if 3 variants were generated */}
            {variantCandidates.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
                <span className="text-xs font-semibold text-slate-700">Варианты подачи:</span>
                {variantCandidates.map((v, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setActiveVariantIdx(idx);
                      setWorkingDraft(v);
                    }}
                    className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      activeVariantIdx === idx
                        ? 'border-indigo-700 bg-indigo-50 text-indigo-900'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Вариант #{idx + 1} · {v.qualityScore ?? 0}/100
                  </button>
                ))}
              </div>
            )}

            {/* Editorial Text Editor */}
            {workingDraft ? (
              <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono font-bold text-indigo-800">
                        {workingDraft.id || 'НЕСОХРАНЁННЫЙ ЧЕРНОВИК'}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="font-medium text-slate-700">
                        Сюжет: {workingDraft.sourceStoryId}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="font-mono text-slate-600 tabular-nums">
                        {countWords(workingDraft.body || '')} слов
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {workingDraft.id && (
                      <a
                        href={`/api/content/export/${encodeURIComponent(workingDraft.id)}/json?withSource=true`}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <FileJson className="h-3.5 w-3.5" />
                        JSON
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={handleQualityRecheck}
                      disabled={Boolean(busyTaskId)}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Проверить качество
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveWorkingDraft}
                      className="inline-flex items-center gap-1 rounded bg-indigo-700 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-800"
                    >
                      <Save className="h-3.5 w-3.5" />
                      {workingDraft.id ? 'Сохранить изменения' : 'Сохранить черновик'}
                    </button>
                  </div>
                </div>

                {/* Title, Alternative Titles, Excerpt */}
                <div className="space-y-3 text-xs">
                  <div>
                    <label className="block font-semibold text-slate-700">Основной заголовок</label>
                    <input
                      type="text"
                      value={workingDraft.title || ''}
                      onChange={(e) =>
                        setWorkingDraft((p) => (p ? { ...p, title: e.target.value } : p))
                      }
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-900"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {[0, 1].map((altIdx) => (
                      <div key={altIdx}>
                        <label className="block font-medium text-slate-600">
                          Альтернативный заголовок #{altIdx + 1}
                        </label>
                        <input
                          type="text"
                          value={workingDraft.alternativeTitles?.[altIdx] || ''}
                          onChange={(e) => {
                            const nextAlts = [...(workingDraft.alternativeTitles || ['', ''])];
                            nextAlts[altIdx] = e.target.value;
                            setWorkingDraft((p) =>
                              p ? { ...p, alternativeTitles: nextAlts } : p
                            );
                          }}
                          className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                        />
                      </div>
                    ))}
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700">Краткий анонс</label>
                    <textarea
                      rows={2}
                      value={workingDraft.excerpt || ''}
                      onChange={(e) =>
                        setWorkingDraft((p) => (p ? { ...p, excerpt: e.target.value } : p))
                      }
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700">
                      Основной текст публикации
                    </label>
                    <textarea
                      rows={13}
                      value={workingDraft.body || ''}
                      onChange={(e) =>
                        setWorkingDraft((p) =>
                          p
                            ? {
                                ...p,
                                body: e.target.value,
                                contentLength: countWords(e.target.value),
                              }
                            : p
                        )
                      }
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm leading-relaxed text-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700">
                      Финальный вопрос / концовка
                    </label>
                    <input
                      type="text"
                      value={workingDraft.mainTriggerQuestion || ''}
                      onChange={(e) =>
                        setWorkingDraft((p) =>
                          p ? { ...p, mainTriggerQuestion: e.target.value } : p
                        )
                      }
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs"
                    />
                  </div>
                </div>

                {/* Targeted Rewrite Buttons */}
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  <div className="text-[11px] font-semibold text-slate-600">
                    Точечная ИИ-редактура (сохраняет предыдущую версию в истории):
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        { action: 'rewrite_opening', label: 'Переписать начало' },
                        { action: 'rewrite_ending', label: 'Переписать финал' },
                        { action: 'more_ironic', label: 'Ироничнее' },
                        { action: 'more_emotional', label: 'Эмоциональнее' },
                        { action: 'less_pathos', label: 'Убрать пафос' },
                        { action: 'simpler', label: 'Проще язык' },
                        { action: 'more_natural', label: 'Естественнее' },
                        { action: 'shorter', label: 'Короче' },
                        { action: 'longer', label: 'Длиннее' },
                      ] as Array<{ action: RewriteActionType; label: string }>
                    ).map((btn) => (
                      <button
                        key={btn.action}
                        type="button"
                        disabled={Boolean(busyTaskId)}
                        onClick={() => handleRewrite(btn.action)}
                        className="rounded border border-slate-300 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                      >
                        {btn.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={customRewritePrompt}
                      onChange={(e) => setCustomRewritePrompt(e.target.value)}
                      placeholder="Своя инструкция для переписывания (необязательно)..."
                      className="flex-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs"
                    />
                    <button
                      type="button"
                      disabled={Boolean(busyTaskId) || !customRewritePrompt.trim()}
                      onClick={() => handleRewrite('custom')}
                      className="rounded-md border border-indigo-700 px-3 py-1 text-xs font-semibold text-indigo-800 hover:bg-indigo-50 disabled:opacity-50"
                    >
                      Применить правку
                    </button>
                  </div>
                </div>

                {/* Bottom Quality Control & Editorial Decisions */}
                {workingDraft.qualityBreakdown && (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5 space-y-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Award className="h-4 w-4 text-indigo-700" />
                        <span className="font-bold text-slate-900">
                          MELO_LOVE QUALITY CONTROL:{' '}
                          <span className="font-mono tabular-nums">
                            {workingDraft.qualityBreakdown.overall}/100
                          </span>
                        </span>
                        <span className="text-slate-600">
                          — {workingDraft.qualityBreakdown.tierLabel}
                        </span>
                      </div>
                      {workingDraft.id && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleSetDraftStatus(workingDraft.id!, 'ready_for_review')}
                            disabled={(workingDraft.qualityScore ?? 0) < 85}
                            className="rounded border border-emerald-600 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-40"
                          >
                            На проверку (&ge;85)
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSetDraftStatus(workingDraft.id!, 'approved')}
                            className="rounded bg-emerald-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-800"
                          >
                            Утвердить
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSetDraftStatus(workingDraft.id!, 'rejected')}
                            className="rounded border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50"
                          >
                            Отклонить
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-[11px]">
                      <div className="rounded bg-white p-2 border border-slate-200">
                        Сила начала: <strong className="font-mono">{workingDraft.qualityBreakdown.hookStrength}/15</strong>
                      </div>
                      <div className="rounded bg-white p-2 border border-slate-200">
                        Естественность: <strong className="font-mono">{workingDraft.qualityBreakdown.languageNaturalness}/15</strong>
                      </div>
                      <div className="rounded bg-white p-2 border border-slate-200">
                        Эмоции: <strong className="font-mono">{workingDraft.qualityBreakdown.emotionalImpact}/15</strong>
                      </div>
                      <div className="rounded bg-white p-2 border border-slate-200">
                        Раскрытие сюжета: <strong className="font-mono">{workingDraft.qualityBreakdown.plotDepth}/15</strong>
                      </div>
                      <div className="rounded bg-white p-2 border border-slate-200">
                        Уникальность подачи: <strong className="font-mono">{workingDraft.qualityBreakdown.narrativeUniqueness}/15</strong>
                      </div>
                      <div className="rounded bg-white p-2 border border-slate-200">
                        Голос MELO_LOVE: <strong className="font-mono">{workingDraft.qualityBreakdown.voiceRecognition}/10</strong>
                      </div>
                      <div className="rounded bg-white p-2 border border-slate-200">
                        Финал: <strong className="font-mono">{workingDraft.qualityBreakdown.endingQuality}/10</strong>
                      </div>
                      <div className="rounded bg-white p-2 border border-slate-200">
                        Точность сюжету: <strong className="font-mono">{workingDraft.qualityBreakdown.sourceFidelity}/5</strong>
                      </div>
                    </div>

                    {workingDraft.qualityBreakdown.warnings?.length > 0 && (
                      <div className="rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
                        <div className="font-semibold">Замечания проверки:</div>
                        <ul className="mt-1 list-disc pl-4 space-y-0.5">
                          {workingDraft.qualityBreakdown.warnings.map((w, i) => (
                            <li key={i}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="text-[11px] text-slate-700 whitespace-pre-line">
                      <span className="font-semibold text-slate-900">Комментарий редактора:</span>{' '}
                      {workingDraft.qualityBreakdown.editorialNotes}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
                Выберите подтверждённый сюжет слева и нажмите «Сгенерировать публикацию» или «Создать 3 варианта», либо откройте существующий черновик из вкладки «Черновики».
              </div>
            )}
          </div>
        </div>
      )}

      {/* ====================================================================
          TAB 2 & 3: DRAFTS & READY PUBLICATIONS LIST
         ==================================================================== */}
      {(activeTab === 'drafts' || activeTab === 'ready') && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-slate-900">
              {activeTab === 'ready' ? 'Готовые публикации (ready_for_review / approved)' : 'Все черновики и публикации'}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {selectedExportIds.size > 0 && (
                <a
                  href={`/api/content/export/json?mode=with_source&ids=${encodeURIComponent(
                    Array.from(selectedExportIds).join(',')
                  )}`}
                  className="inline-flex items-center gap-1 rounded-md bg-indigo-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  Экспорт выбранных ({selectedExportIds.size})
                </a>
              )}
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                <Upload className="h-3.5 w-3.5" />
                Импорт JSON
                <input type="file" accept=".json" onChange={handleImportJsonFile} className="hidden" />
              </label>
            </div>
          </div>

          {/* Filters */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 text-xs">
            <select
              value={draftColFilter}
              onChange={(e) => setDraftColFilter(e.target.value as 'ALL' | CollectionType)}
              className="rounded-md border border-slate-300 px-2.5 py-1.5"
            >
              <option value="ALL">Все рубрики</option>
              <option value="debate">Кто здесь прав?</option>
              <option value="romantic">Романтические истории</option>
            </select>
            {activeTab === 'drafts' && (
              <select
                value={draftStatusFilter}
                onChange={(e) => setDraftStatusFilter(e.target.value as 'ALL' | ContentDraftStatus)}
                className="rounded-md border border-slate-300 px-2.5 py-1.5"
              >
                <option value="ALL">Все статусы</option>
                {Object.entries(DRAFT_STATUS_LABELS).map(([k, lbl]) => (
                  <option key={k} value={k}>
                    {lbl}
                  </option>
                ))}
              </select>
            )}
            <select
              value={draftMinQuality}
              onChange={(e) => setDraftMinQuality(Number(e.target.value))}
              className="rounded-md border border-slate-300 px-2.5 py-1.5"
            >
              <option value={0}>Любое качество</option>
              <option value={85}>Качество &ge; 85</option>
              <option value={90}>Качество &ge; 90</option>
            </select>
            <select
              value={draftResearchFilter}
              onChange={(e) => setDraftResearchFilter(e.target.value as 'ALL' | 'true' | 'false')}
              className="rounded-md border border-slate-300 px-2.5 py-1.5"
            >
              <option value="ALL">Любое исследование</option>
              <option value="true">На базе FOREIGN RESEARCH</option>
              <option value="false">Оригинальные сюжеты</option>
            </select>
            <input
              type="date"
              value={draftDateFrom}
              onChange={(e) => setDraftDateFrom(e.target.value)}
              className="rounded-md border border-slate-300 px-2.5 py-1.5"
              title="Дата создания от"
            />
          </div>

          {filteredDrafts.length === 0 ? (
            <div className="rounded border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">
              Публикации по выбранным фильтрам пока отсутствуют.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 border-t border-slate-200">
              {filteredDrafts.map((d) => {
                const checked = selectedExportIds.has(d.id);
                return (
                  <div key={d.id} className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3 min-w-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setSelectedExportIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(d.id);
                            else next.delete(d.id);
                            return next;
                          });
                        }}
                        className="mt-1 rounded border-slate-300"
                      />
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                          <span className="font-mono font-bold text-indigo-800">{d.id}</span>
                          <span className="font-mono text-slate-500">← {d.sourceStoryId}</span>
                          <span className="font-semibold text-slate-700">
                            {DRAFT_STATUS_LABELS[d.status]}
                          </span>
                          <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                            {d.qualityScore}/100
                          </span>
                          <span className="text-slate-500 tabular-nums">{d.contentLength} слов</span>
                          {d.researchId && (
                            <span className="font-mono text-slate-600">{d.researchId}</span>
                          )}
                        </div>
                        <div className="text-sm font-semibold text-slate-900">{d.title}</div>
                        <div className="text-xs text-slate-600 line-clamp-2">{d.excerpt}</div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleOpenDraftInEditor(d.id)}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        Редактор
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          loadVersionsForDraft(d.id);
                          setActiveTab('history');
                        }}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <History className="h-3.5 w-3.5" />
                        Версии ({d.revisionHistory?.length || 0})
                      </button>
                      <a
                        href={`/api/content/export/${encodeURIComponent(d.id)}/json?withSource=true`}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <FileJson className="h-3.5 w-3.5" />
                        JSON
                      </a>
                      {d.status !== 'approved' && (
                        <button
                          type="button"
                          onClick={() => handleSetDraftStatus(d.id, 'approved')}
                          className="rounded bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-800"
                        >
                          Утвердить
                        </button>
                      )}
                      {d.status !== 'archived' && (
                        <button
                          type="button"
                          onClick={() => handleSetDraftStatus(d.id, 'archived')}
                          className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                          title="В архив"
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteDraft(d.id)}
                        className="inline-flex items-center gap-1 rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                        title="Удалить черновик"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ====================================================================
          TAB 4: REVISION HISTORY
         ==================================================================== */}
      {activeTab === 'history' && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-slate-900">История версий публикаций</h2>
            <select
              value={historyDraftId || ''}
              onChange={(e) => e.target.value && loadVersionsForDraft(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs"
            >
              <option value="">Выберите публикацию...</option>
              {drafts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.id} — {d.title.slice(0, 50)} ({d.revisionHistory?.length || 0} версий)
                </option>
              ))}
            </select>
          </div>

          {historyCurrentDraft ? (
            <div className="space-y-4">
              <div className="rounded-md border border-indigo-200 bg-indigo-50/50 p-3.5 text-xs">
                <div className="flex items-center justify-between font-semibold text-indigo-950">
                  <span>Актуальная версия: {historyCurrentDraft.id}</span>
                  <span className="font-mono tabular-nums">
                    {historyCurrentDraft.qualityScore}/100 · {historyCurrentDraft.contentLength} слов
                  </span>
                </div>
                <div className="mt-1 font-semibold text-slate-900">{historyCurrentDraft.title}</div>
                <p className="mt-1.5 text-slate-700 whitespace-pre-line">{historyCurrentDraft.body}</p>
              </div>

              {historyVersions.length === 0 ? (
                <div className="rounded border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
                  У этой публикации пока нет сохранённых предыдущих редакций (они создаются автоматически при переписывании и ручной правке).
                </div>
              ) : (
                <div className="space-y-3">
                  {[...historyVersions].reverse().map((ver) => (
                    <div key={ver.versionId} className="rounded-md border border-slate-200 p-3.5 text-xs space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Clock className="h-3.5 w-3.5 text-slate-500" />
                          <span className="font-bold text-slate-900">Версия #{ver.versionNumber}</span>
                          <span className="text-slate-500">{ver.actionLabel}</span>
                          <span className="font-mono text-slate-500">
                            {new Date(ver.createdAt).toLocaleString('ru-RU')}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold text-slate-700">
                            {ver.qualityScore}/100
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRestoreRevision(historyCurrentDraft.id, ver.versionId)}
                            className="inline-flex items-center gap-1 rounded border border-indigo-700 px-2.5 py-1 font-semibold text-indigo-800 hover:bg-indigo-50"
                          >
                            <RotateCcw className="h-3 w-3" />
                            Восстановить версию
                          </button>
                        </div>
                      </div>
                      <div className="font-semibold text-slate-800">{ver.title}</div>
                      <p className="text-slate-600 whitespace-pre-line">{ver.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">
              Выберите публикацию сверху или нажмите «Версии» в списке черновиков.
            </div>
          )}
        </div>
      )}

      {/* ====================================================================
          TAB 5: MELO_LOVE VOICE ENGINE
         ==================================================================== */}
      {activeTab === 'voice' && voiceConfig && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4 lg:col-span-7">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">
                Настройки голоса по рубрикам
              </h2>
              <div className="flex rounded-md border border-slate-200 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setVoiceEditTab('debate')}
                  className={`rounded px-3 py-1 font-semibold ${
                    voiceEditTab === 'debate' ? 'bg-indigo-700 text-white' : 'text-slate-600'
                  }`}
                >
                  Режим A: Кто здесь прав?
                </button>
                <button
                  type="button"
                  onClick={() => setVoiceEditTab('romantic')}
                  className={`rounded px-3 py-1 font-semibold ${
                    voiceEditTab === 'romantic' ? 'bg-indigo-700 text-white' : 'text-slate-600'
                  }`}
                >
                  Режим B: Романтика
                </button>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700">
                  Активный профиль по умолчанию для рубрики
                </label>
                <select
                  value={
                    voiceEditTab === 'debate'
                      ? voiceConfig.debateProfileId
                      : voiceConfig.romanticProfileId
                  }
                  onChange={(e) => {
                    const profId = e.target.value;
                    const chosen = voiceConfig.profiles.find((p) => p.id === profId);
                    const nextCfg: VoiceEngineConfig = {
                      ...voiceConfig,
                      ...(voiceEditTab === 'debate'
                        ? { debateProfileId: profId }
                        : { romanticProfileId: profId }),
                      rubricSettings: {
                        ...voiceConfig.rubricSettings,
                        ...(chosen
                          ? {
                              [voiceEditTab]: {
                                irony: chosen.irony,
                                conversational: chosen.conversational,
                                emotionality: chosen.emotionality,
                                provocativeness: chosen.provocativeness,
                                phraseDensity: chosen.phraseDensity,
                                sentenceLength: chosen.sentenceLength,
                                dramaLevel: chosen.dramaLevel,
                              },
                            }
                          : {}),
                      },
                    };
                    setVoiceConfig(nextCfg);
                  }}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5"
                >
                  {voiceConfig.profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.description}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(
                  [
                    { key: 'irony', label: 'Интенсивность иронии' },
                    { key: 'conversational', label: 'Разговорность' },
                    { key: 'emotionality', label: 'Эмоциональность' },
                    { key: 'provocativeness', label: 'Провокационность' },
                    { key: 'phraseDensity', label: 'Плотность фирменных выражений' },
                    { key: 'dramaLevel', label: 'Уровень драматичности' },
                  ] as Array<{ key: keyof VoiceSliders; label: string }>
                ).map((item) => {
                  const val = voiceConfig.rubricSettings[voiceEditTab][item.key] as number;
                  return (
                    <label key={item.key} className="block rounded border border-slate-200 p-2.5">
                      <div className="flex justify-between font-medium text-slate-700">
                        <span>{item.label}</span>
                        <span className="font-mono font-bold text-indigo-800 tabular-nums">
                          {val}/10
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={10}
                        value={val}
                        onChange={(e) => {
                          const num = Number(e.target.value);
                          setVoiceConfig((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  rubricSettings: {
                                    ...prev.rubricSettings,
                                    [voiceEditTab]: {
                                      ...prev.rubricSettings[voiceEditTab],
                                      [item.key]: num,
                                    },
                                  },
                                }
                              : prev
                          );
                        }}
                        className="mt-1.5 w-full accent-indigo-700"
                      />
                    </label>
                  );
                })}
              </div>

              <div>
                <label className="block font-semibold text-slate-700">Длина предложений</label>
                <select
                  value={voiceConfig.rubricSettings[voiceEditTab].sentenceLength}
                  onChange={(e) => {
                    const sl = e.target.value as SentenceLengthMode;
                    setVoiceConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            rubricSettings: {
                              ...prev.rubricSettings,
                              [voiceEditTab]: {
                                ...prev.rubricSettings[voiceEditTab],
                                sentenceLength: sl,
                              },
                            },
                          }
                        : prev
                    );
                  }}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5"
                >
                  <option value="short">Короткие (динамичный ритм)</option>
                  <option value="mixed">Смешанные (живой баланс)</option>
                  <option value="free">Свободные (развёрнутые авторские паузы)</option>
                </select>
              </div>

              <button
                type="button"
                onClick={() => handleSaveVoiceConfig(voiceConfig)}
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-700 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-800"
              >
                <Save className="h-3.5 w-3.5" />
                Сохранить настройки голоса
              </button>
            </div>
          </div>

          <div className="space-y-4 lg:col-span-5">
            <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3 text-xs">
              <h3 className="text-sm font-bold text-slate-900">Профили стиля</h3>
              <div className="space-y-2">
                {voiceConfig.profiles.map((p) => (
                  <div key={p.id} className="rounded border border-slate-200 p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">{p.name}</span>
                      <span className="font-mono text-[11px] text-slate-500">
                        ирония {p.irony} · тепл/эмоц {p.emotionality}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-600">{p.description}</p>
                  </div>
                ))}
              </div>
            </div>

            <form
              onSubmit={handleCreateCustomVoiceProfile}
              className="rounded-lg border border-slate-200 bg-white p-4 space-y-3 text-xs"
            >
              <h3 className="text-sm font-bold text-slate-900">
                Сохранить текущие слайдеры как собственный профиль
              </h3>
              <input
                type="text"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                placeholder="Название профиля (например: Сухой юмор)"
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5"
                required
              />
              <input
                type="text"
                value={newProfileDesc}
                onChange={(e) => setNewProfileDesc(e.target.value)}
                placeholder="Короткое описание интонации"
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-md border border-indigo-700 px-3 py-1.5 font-semibold text-indigo-800 hover:bg-indigo-50"
              >
                <Plus className="h-3.5 w-3.5" />
                Создать профиль
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================
          TAB 6: PHRASEBOOK (MELO_LOVE_PHRASEBOOK)
         ==================================================================== */}
      {activeTab === 'phrasebook' && (
        <div className="space-y-4">
          <form
            onSubmit={handleAddPhrase}
            className="rounded-lg border border-slate-200 bg-white p-4 space-y-3 text-xs"
          >
            <h2 className="text-sm font-bold text-slate-900">
              Добавить выражение в словарь MELO_LOVE_PHRASEBOOK
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              <input
                type="text"
                value={newPhrase}
                onChange={(e) => setNewPhrase(e.target.value)}
                placeholder="Текст выражения..."
                className="sm:col-span-2 rounded-md border border-slate-300 px-3 py-1.5"
                required
              />
              <select
                value={newPhraseTone}
                onChange={(e) => setNewPhraseTone(e.target.value as PhrasebookTone)}
                className="rounded-md border border-slate-300 px-2.5 py-1.5"
              >
                {Object.entries(TONE_LABELS).map(([k, lbl]) => (
                  <option key={k} value={k}>
                    {lbl}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-3 px-1">
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={newPhraseCollections.includes('debate')}
                    onChange={(e) =>
                      setNewPhraseCollections((prev) =>
                        e.target.checked
                          ? Array.from(new Set([...prev, 'debate']))
                          : prev.filter((c) => c !== 'debate')
                      )
                    }
                  />
                  Споры
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={newPhraseCollections.includes('romantic')}
                    onChange={(e) =>
                      setNewPhraseCollections((prev) =>
                        e.target.checked
                          ? Array.from(new Set([...prev, 'romantic']))
                          : prev.filter((c) => c !== 'romantic')
                      )
                    }
                  />
                  Романтика
                </label>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              <input
                type="text"
                value={newPhraseNotes}
                onChange={(e) => setNewPhraseNotes(e.target.value)}
                placeholder="Когда уместно использовать..."
                className="sm:col-span-2 rounded-md border border-slate-300 px-3 py-1.5"
              />
              <label className="flex items-center gap-2">
                <span>Лимит на 10 постов:</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={newPhraseFreq}
                  onChange={(e) => setNewPhraseFreq(Number(e.target.value))}
                  className="w-16 rounded border border-slate-300 px-2 py-1 font-mono"
                />
              </label>
              <label className="flex items-center gap-2">
                <span>Приоритет (1–10):</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={newPhraseWeight}
                  onChange={(e) => setNewPhraseWeight(Number(e.target.value))}
                  className="w-16 rounded border border-slate-300 px-2 py-1 font-mono"
                />
              </label>
            </div>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-700 px-3.5 py-1.5 font-semibold text-white hover:bg-indigo-800"
            >
              <Plus className="h-3.5 w-3.5" />
              Добавить в словарь
            </button>
          </form>

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase text-slate-600">
                <tr>
                  <th className="px-3 py-2.5">Выражение</th>
                  <th className="px-3 py-2.5">Рубрики</th>
                  <th className="px-3 py-2.5">Окраска</th>
                  <th className="px-3 py-2.5">Частота (последние 10)</th>
                  <th className="px-3 py-2.5">Статус</th>
                  <th className="px-3 py-2.5 text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {phrasebook.map((entry) => (
                  <tr key={entry.id} className={entry.banned ? 'bg-slate-50/70 opacity-70' : ''}>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-slate-900">«{entry.phrase}»</div>
                      {entry.notes && (
                        <div className="mt-0.5 text-[11px] text-slate-500">{entry.notes}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">
                      {entry.collections
                        .map((c) => (c === 'debate' ? 'Споры' : 'Романтика'))
                        .join(', ')}
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">{TONE_LABELS[entry.tone]}</td>
                    <td className="px-3 py-2.5 font-mono tabular-nums">
                      {entry.recentUsageCount} / {entry.maxFrequencyPer10} (всего {entry.usageCount})
                    </td>
                    <td className="px-3 py-2.5">
                      {entry.banned ? (
                        <span className="font-semibold text-rose-700">Запрещена</span>
                      ) : entry.isOverused ? (
                        <span className="font-semibold text-amber-700">Часто повторяется</span>
                      ) : (
                        <span className="font-semibold text-emerald-700">Активна</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap space-x-1.5">
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await api.updatePhrasebookEntry(entry.id, {
                            banned: !entry.banned,
                          });
                          setPhrasebook(res.phrasebook);
                        }}
                        className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        {entry.banned ? 'Разрешить' : 'Запретить'}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await api.deletePhrasebookEntry(entry.id);
                          setPhrasebook(res.phrasebook);
                        }}
                        className="rounded border border-rose-200 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50"
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ====================================================================
          TAB 7: QUALITY SETTINGS & BACKUPS
         ==================================================================== */}
      {activeTab === 'quality_settings' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3 text-xs">
            <h2 className="text-sm font-bold text-slate-900">
              Рубрика MELO_LOVE QUALITY CONTROL (100 баллов)
            </h2>
            <p className="text-slate-600">
              Автоматический перевод в статус «Готов к проверке» (ready_for_review) выполняется только при итоговой оценке не ниже 85/100 и отсутствии критических нарушений.
            </p>
            <div className="divide-y divide-slate-200 border border-slate-200 rounded">
              {[
                ['Сила начала и интерес', '15'],
                ['Естественность русского языка', '15'],
                ['Эмоциональное воздействие', '15'],
                ['Раскрытие сюжета', '15'],
                ['Уникальность повествования', '15'],
                ['Узнаваемость стиля MELO_LOVE', '10'],
                ['Качество финала', '10'],
                ['Соответствие исходному сюжету', '5'],
              ].map(([name, weight]) => (
                <div key={name} className="flex items-center justify-between px-3 py-2">
                  <span className="text-slate-800">{name}</span>
                  <span className="font-mono font-bold text-slate-900 tabular-nums">{weight} б.</span>
                </div>
              ))}
            </div>
            <div className="rounded bg-slate-50 p-3 text-[11px] text-slate-700 space-y-1">
              <div><strong>90–100:</strong> Отличная публикация</div>
              <div><strong>85–89:</strong> Хорошая публикация (порог автоперехода в ready_for_review)</div>
              <div><strong>75–84:</strong> Требует редактуры (предлагается доработка)</div>
              <div><strong>Ниже 75:</strong> Не рекомендуется к сохранению как готовый черновик</div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">
                Экспорт JSON и резервные копии публикаций
              </h2>
              <button
                type="button"
                onClick={async () => {
                  await api.createContentBackup();
                  await loadAll();
                  setNoticeMsg('Создана резервная копия data/content_backups/.');
                }}
                className="inline-flex items-center gap-1 rounded border border-indigo-700 px-2.5 py-1 font-semibold text-indigo-800 hover:bg-indigo-50"
              >
                <Copy className="h-3.5 w-3.5" />
                Создать снимок
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <a
                href="/api/content/export/json?mode=with_source"
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-700 px-3 py-1.5 font-semibold text-white hover:bg-indigo-800"
              >
                <Download className="h-3.5 w-3.5" />
                Все публикации + исходные сюжеты (JSON)
              </a>
              <a
                href="/api/content/export/json?mode=draft_only"
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" />
                Только публикации (JSON)
              </a>
            </div>

            <div>
              <div className="font-semibold text-slate-700 mb-2">
                Снимки data/content_backups/ ({backups.length})
              </div>
              {backups.length === 0 ? (
                <div className="text-slate-500">Резервных копий пока нет (создаются при сохранении/удалении черновиков).</div>
              ) : (
                <div className="max-h-48 divide-y divide-slate-200 overflow-y-auto rounded border border-slate-200">
                  {backups.map((b) => (
                    <div key={b.filename} className="flex items-center justify-between px-3 py-2 text-[11px]">
                      <span className="font-mono text-slate-800">{b.filename}</span>
                      <span className="font-mono text-slate-500 tabular-nums">
                        {(b.sizeBytes / 1024).toFixed(1)} KB
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
