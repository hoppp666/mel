import type {
  AppSettings,
  CollectionType,
  ContentDraft,
  ContentDraftStatus,
  ContentLengthPreset,
  ContentQualityBreakdown,
  ContentRevisionSnapshot,
  ContentStatistics,
  DatabaseState,
  DatabaseStats,
  NarrativeStructurePattern,
  PhrasebookEntry,
  PhrasebookTone,
  ResearchConversionMode,
  ResearchDepth,
  ResearchDuplicateMatch,
  ResearchJob,
  ResearchResult,
  ResearchSource,
  ResearchStatistics,
  RewriteActionType,
  SimilarityMatch,
  StoryPlot,
  UsageStatus,
  VerificationStatus,
  VoiceEngineConfig,
  VoiceSliders,
} from '../shared/types.ts';

export interface StagedBatch {
  batchNumber: number;
  collection: CollectionType;
  targetCategory: string;
  researchMode: 'original' | 'external_search';
  usedSearchGrounding: boolean;
  groundingUrls: Array<{ uri: string; title: string }>;
  createdAt: string;
  candidates: StoryPlot[];
}

export interface BackupSnapshotInfo {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

export interface DatabasePayload extends DatabaseState {
  stats: DatabaseStats;
  backups: BackupSnapshotInfo[];
  stagedBatch: StagedBatch | null;
}

async function handleJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Ошибка сервера (${res.status})`) as Error & {
      status?: number;
      matches?: SimilarityMatch[];
      candidate?: StoryPlot;
    };
    err.status = res.status;
    err.matches = data.matches;
    err.candidate = data.candidate;
    throw err;
  }
  return data as T;
}

export async function fetchDatabase(): Promise<DatabasePayload> {
  const res = await fetch('/api/database');
  return handleJson<DatabasePayload>(res);
}

export async function checkSimilarity(
  candidate: Partial<StoryPlot>,
  threshold?: number
): Promise<{ hasDuplicates: boolean; matches: SimilarityMatch[] }> {
  const res = await fetch('/api/stories/check-similarity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...candidate, threshold }),
  });
  return handleJson(res);
}

export async function createStory(
  story: Partial<StoryPlot>,
  forceSave = false
): Promise<{ story: StoryPlot; stats: DatabaseStats }> {
  const res = await fetch('/api/stories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ story, forceSave }),
  });
  return handleJson(res);
}

export async function updateStory(
  id: string,
  story: Partial<StoryPlot>
): Promise<{ story: StoryPlot; stats: DatabaseStats }> {
  const res = await fetch(`/api/stories/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(story),
  });
  return handleJson(res);
}

export async function updateStoryStatus(
  id: string,
  payload: {
    verificationStatus?: VerificationStatus;
    usageStatus?: UsageStatus;
    duplicateFlag?: boolean;
  }
): Promise<{ story: StoryPlot; stats: DatabaseStats }> {
  const res = await fetch(`/api/stories/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleJson(res);
}

export async function mergeStories(payload: {
  targetId: string;
  mergedFields: Partial<StoryPlot>;
  removeDuplicateId?: string;
}): Promise<{ story: StoryPlot; stats: DatabaseStats }> {
  const res = await fetch('/api/stories/merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleJson(res);
}

export async function deleteStory(id: string): Promise<{ deletedId: string; stats: DatabaseStats }> {
  const res = await fetch(`/api/stories/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  return handleJson(res);
}

export async function rescanUniqueness(
  threshold?: number
): Promise<{ stories: StoryPlot[]; stats: DatabaseStats }> {
  const res = await fetch('/api/uniqueness/rescan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threshold }),
  });
  return handleJson(res);
}

export async function generateBatch(params: {
  collection: CollectionType;
  targetCategory: string;
  batchSize: number;
  researchMode: 'original' | 'external_search';
}): Promise<{ stagedBatch: StagedBatch }> {
  const res = await fetch('/api/batches/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJson(res);
}

export async function updateStagedCandidate(
  candidateId: string,
  patch: Partial<StoryPlot>
): Promise<{ stagedBatch: StagedBatch }> {
  const res = await fetch(`/api/batches/staged/${encodeURIComponent(candidateId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return handleJson(res);
}

export async function commitStagedBatch(payload: {
  acceptedIds: string[];
  rejectedIds: string[];
  forceIncludeDuplicates?: boolean;
}): Promise<{
  stagedBatch: StagedBatch | null;
  committedCount: number;
  rejectedCount: number;
  stats: DatabaseStats;
  batches: DatabasePayload['batches'];
  stories: StoryPlot[];
  backups: BackupSnapshotInfo[];
}> {
  const res = await fetch('/api/batches/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleJson(res);
}

export async function discardStagedBatch(): Promise<{ ok: boolean }> {
  const res = await fetch('/api/batches/staged', { method: 'DELETE' });
  return handleJson(res);
}

export async function addCustomCategory(
  collection: CollectionType,
  name: string
): Promise<{ customCategories: { debate: string[]; romantic: string[] } }> {
  const res = await fetch('/api/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collection, name }),
  });
  return handleJson(res);
}

export async function updateSettings(
  settings: Partial<AppSettings>
): Promise<{ settings: AppSettings; stats: DatabaseStats }> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  return handleJson(res);
}

export async function createBackup(): Promise<{
  filename: string;
  backups: BackupSnapshotInfo[];
}> {
  const res = await fetch('/api/backup', { method: 'POST' });
  return handleJson(res);
}

export async function restoreBackup(filename: string): Promise<DatabasePayload> {
  const res = await fetch('/api/backup/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename }),
  });
  return handleJson(res);
}

export async function importJsonStories(
  stories: Array<Partial<StoryPlot>>,
  skipDuplicates = true
): Promise<{
  importedCount: number;
  skippedDuplicatesCount: number;
  stats: DatabaseStats;
  stories: StoryPlot[];
  backups: BackupSnapshotInfo[];
}> {
  const res = await fetch('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stories, skipDuplicates }),
  });
  return handleJson(res);
}

/* ============================================================================
   STAGE 2: FOREIGN RESEARCH ENGINE CLIENT API
   ============================================================================ */

export async function fetchResearchStatistics(): Promise<{
  stats: ResearchStatistics;
  activeJobId: string | null;
  geminiConfigured: boolean;
  backups: BackupSnapshotInfo[];
}> {
  const res = await fetch('/api/research/statistics');
  return handleJson(res);
}

export async function fetchResearchSources(): Promise<{ sources: ResearchSource[] }> {
  const res = await fetch('/api/research/sources');
  return handleJson(res);
}

export async function addResearchSource(payload: {
  name: string;
  url: string;
  platform?: 'reddit' | 'media' | 'custom';
  sourceType?: string;
  language?: string;
  directions?: CollectionType[];
  notes?: string;
}): Promise<{ source: ResearchSource; sources: ResearchSource[] }> {
  const res = await fetch('/api/research/sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleJson(res);
}

export async function updateResearchSource(
  id: string,
  patch: Partial<ResearchSource>
): Promise<{ source: ResearchSource; sources: ResearchSource[] }> {
  const res = await fetch(`/api/research/sources/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return handleJson(res);
}

export async function deleteResearchSource(
  id: string
): Promise<{ deletedId: string; sources: ResearchSource[] }> {
  const res = await fetch(`/api/research/sources/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  return handleJson(res);
}

export async function checkResearchSource(
  id: string
): Promise<{ source: ResearchSource; sources: ResearchSource[] }> {
  const res = await fetch(`/api/research/sources/${encodeURIComponent(id)}/check`, {
    method: 'POST',
  });
  return handleJson(res);
}

export async function checkAllResearchSources(): Promise<{ sources: ResearchSource[] }> {
  const res = await fetch('/api/research/sources/check-all', {
    method: 'POST',
  });
  return handleJson(res);
}

export async function startResearchSearch(params: {
  collection: CollectionType;
  sourceIds: string[];
  category: string;
  sourceLanguage: string;
  requestedCount: number;
  depth: ResearchDepth;
  conversionMode: ResearchConversionMode;
}): Promise<{ job: ResearchJob }> {
  const res = await fetch('/api/research/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJson(res);
}

export async function fetchResearchJobs(): Promise<{
  jobs: ResearchJob[];
  activeJobId: string | null;
}> {
  const res = await fetch('/api/research/jobs');
  return handleJson(res);
}

export async function fetchResearchJob(id: string): Promise<{ job: ResearchJob }> {
  const res = await fetch(`/api/research/jobs/${encodeURIComponent(id)}`);
  return handleJson(res);
}

export async function cancelResearchJob(id: string): Promise<{ ok: boolean; job?: ResearchJob }> {
  const res = await fetch(`/api/research/jobs/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
  });
  return handleJson(res);
}

export async function fetchResearchResults(): Promise<{ results: ResearchResult[] }> {
  const res = await fetch('/api/research/results');
  return handleJson(res);
}

export async function updateResearchResult(
  id: string,
  patch: Partial<ResearchResult>
): Promise<{ result: ResearchResult }> {
  const res = await fetch(`/api/research/results/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return handleJson(res);
}

export async function analyzeResearchResult(id: string): Promise<{ result: ResearchResult }> {
  const res = await fetch(`/api/research/results/${encodeURIComponent(id)}/analyze`, {
    method: 'POST',
  });
  return handleJson(res);
}

export async function generateResearchIdea(id: string): Promise<{ result: ResearchResult }> {
  const res = await fetch(`/api/research/results/${encodeURIComponent(id)}/generate-idea`, {
    method: 'POST',
  });
  return handleJson(res);
}

export async function checkResearchDuplicate(id: string): Promise<{ result: ResearchResult }> {
  const res = await fetch(`/api/research/results/${encodeURIComponent(id)}/check-duplicate`, {
    method: 'POST',
  });
  return handleJson(res);
}

export async function approveResearchResult(
  id: string,
  forceIgnoreDuplicates = false
): Promise<{
  result: ResearchResult;
  story: StoryPlot;
  dbStats: DatabaseStats;
}> {
  const res = await fetch(`/api/research/results/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ forceIgnoreDuplicates }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error || `Ошибка сервера (${res.status})`) as Error & {
      status?: number;
      matches?: ResearchDuplicateMatch[];
      result?: ResearchResult;
    };
    err.status = res.status;
    err.matches = data.matches;
    err.result = data.result;
    throw err;
  }
  return res.json();
}

export async function rejectResearchResult(
  id: string,
  reason?: string
): Promise<{ result: ResearchResult }> {
  const res = await fetch(`/api/research/results/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  return handleJson(res);
}

export async function createResearchBackup(): Promise<{
  filename: string;
  backups: BackupSnapshotInfo[];
}> {
  const res = await fetch('/api/research/backup', { method: 'POST' });
  return handleJson(res);
}

/* ============================================================================
   STAGE 3: STORY GENERATOR + MELO_LOVE VOICE ENGINE CLIENT API
   ============================================================================ */

export type AvailableStoryItem = StoryPlot & { linkedDraftsCount: number };
export type ContentDraftListItem = ContentDraft & { sourceStoryTitle?: string };

export async function fetchContentStatistics(): Promise<{
  stats: ContentStatistics;
  activeTaskIds: string[];
  geminiConfigured: boolean;
  backups: BackupSnapshotInfo[];
}> {
  const res = await fetch('/api/content/statistics');
  return handleJson(res);
}

export async function fetchAvailableStoriesForContent(params?: {
  collection?: CollectionType | 'ALL';
  category?: string;
  includeDrafted?: boolean;
  hasResearch?: 'ALL' | 'true' | 'false';
  search?: string;
}): Promise<{ stories: AvailableStoryItem[] }> {
  const q = new URLSearchParams();
  if (params?.collection && params.collection !== 'ALL') q.set('collection', params.collection);
  if (params?.category && params.category !== 'ALL') q.set('category', params.category);
  if (params?.includeDrafted) q.set('includeDrafted', 'true');
  if (params?.hasResearch && params.hasResearch !== 'ALL') q.set('hasResearch', params.hasResearch);
  if (params?.search) q.set('search', params.search);
  const res = await fetch(`/api/content/available-stories?${q.toString()}`);
  return handleJson(res);
}

export async function generateContentPublication(params: {
  sourceStoryId: string;
  voiceProfileId?: string;
  voiceSlidersOverride?: Partial<VoiceSliders>;
  lengthPreset?: ContentLengthPreset;
  narrativeStructure?: NarrativeStructurePattern | 'auto';
  autoSaveDraft?: boolean;
  taskId?: string;
}): Promise<{ candidate: ContentDraft; savedDraft?: ContentDraft }> {
  const res = await fetch('/api/content/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJson(res);
}

export async function generateContentVariants(params: {
  sourceStoryId: string;
  count?: number;
  voiceProfileId?: string;
  voiceSlidersOverride?: Partial<VoiceSliders>;
  lengthPreset?: ContentLengthPreset;
  taskId?: string;
}): Promise<{ variants: Array<Omit<ContentDraft, 'id' | 'createdAt' | 'updatedAt' | 'revisionHistory'>> }> {
  const res = await fetch('/api/content/generate-variants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJson(res);
}

export async function cancelContentTask(taskId: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/content/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: 'POST',
  });
  return handleJson(res);
}

export async function rewriteContentPublication(params: {
  draftId?: string;
  draftSnapshot?: Partial<ContentDraft>;
  action: RewriteActionType;
  customInstruction?: string;
  taskId?: string;
}): Promise<{ draft?: ContentDraft; rewritten: Partial<ContentDraft> }> {
  const res = await fetch('/api/content/rewrite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJson(res);
}

export async function rewriteContentSection(params: {
  draftId?: string;
  draftSnapshot?: Partial<ContentDraft>;
  section: 'opening' | 'ending';
  customInstruction?: string;
  taskId?: string;
}): Promise<{ draft?: ContentDraft; rewritten: Partial<ContentDraft> }> {
  const res = await fetch('/api/content/rewrite-section', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJson(res);
}

export async function checkContentQuality(params: {
  draftId?: string;
  sourceStoryId?: string;
  title?: string;
  excerpt?: string;
  body: string;
  mainTriggerQuestion?: string;
}): Promise<{ qualityBreakdown: ContentQualityBreakdown; draft?: ContentDraft }> {
  const res = await fetch('/api/content/quality-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJson(res);
}

export async function fetchContentDrafts(params?: {
  collection?: CollectionType | 'ALL';
  category?: string;
  status?: ContentDraftStatus | 'ALL';
  minQuality?: number;
  hasResearch?: 'ALL' | 'true' | 'false';
}): Promise<{ drafts: ContentDraftListItem[] }> {
  const q = new URLSearchParams();
  if (params?.collection && params.collection !== 'ALL') q.set('collection', params.collection);
  if (params?.category && params.category !== 'ALL') q.set('category', params.category);
  if (params?.status && params.status !== 'ALL') q.set('status', params.status);
  if (params?.minQuality !== undefined) q.set('minQuality', String(params.minQuality));
  if (params?.hasResearch && params.hasResearch !== 'ALL') q.set('hasResearch', params.hasResearch);
  const res = await fetch(`/api/content/drafts?${q.toString()}`);
  return handleJson(res);
}

export async function fetchContentDraft(id: string): Promise<{
  draft: ContentDraft;
  sourceStory: StoryPlot | null;
}> {
  const res = await fetch(`/api/content/drafts/${encodeURIComponent(id)}`);
  return handleJson(res);
}

export async function saveContentDraft(
  draft: Partial<ContentDraft>
): Promise<{ draft: ContentDraft; sourceStory: StoryPlot | null }> {
  const res = await fetch('/api/content/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
  });
  return handleJson(res);
}

export async function updateContentDraft(
  id: string,
  patch: Partial<ContentDraft>
): Promise<{ draft: ContentDraft }> {
  const res = await fetch(`/api/content/drafts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return handleJson(res);
}

export async function updateContentDraftStatus(
  id: string,
  status: ContentDraftStatus,
  rejectionReason?: string
): Promise<{ draft: ContentDraft; sourceStory: StoryPlot | null }> {
  const res = await fetch(`/api/content/drafts/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, rejectionReason }),
  });
  return handleJson(res);
}

export async function deleteContentDraft(
  id: string
): Promise<{ deletedId: string; sourceStory: StoryPlot | null }> {
  const res = await fetch(`/api/content/drafts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  return handleJson(res);
}

export async function fetchContentVersions(id: string): Promise<{
  versions: ContentRevisionSnapshot[];
  currentDraft: ContentDraft;
}> {
  const res = await fetch(`/api/content/drafts/${encodeURIComponent(id)}/versions`);
  return handleJson(res);
}

export async function restoreContentVersion(
  id: string,
  versionId: string
): Promise<{ draft: ContentDraft }> {
  const res = await fetch(`/api/content/drafts/${encodeURIComponent(id)}/restore-version`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ versionId }),
  });
  return handleJson(res);
}

export async function fetchVoiceConfig(): Promise<{ voiceConfig: VoiceEngineConfig }> {
  const res = await fetch('/api/content/voice');
  return handleJson(res);
}

export async function saveVoiceConfigApi(
  config: Partial<VoiceEngineConfig>
): Promise<{ voiceConfig: VoiceEngineConfig }> {
  const res = await fetch('/api/content/voice', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  return handleJson(res);
}

export async function fetchPhrasebook(): Promise<{ phrasebook: PhrasebookEntry[] }> {
  const res = await fetch('/api/content/phrasebook');
  return handleJson(res);
}

export async function addPhrasebookEntry(payload: {
  phrase: string;
  collections: CollectionType[];
  tone: PhrasebookTone;
  maxFrequencyPer10: number;
  weight: number;
  notes: string;
}): Promise<{ entry: PhrasebookEntry; phrasebook: PhrasebookEntry[] }> {
  const res = await fetch('/api/content/phrasebook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleJson(res);
}

export async function updatePhrasebookEntry(
  id: string,
  patch: Partial<PhrasebookEntry>
): Promise<{ entry: PhrasebookEntry; phrasebook: PhrasebookEntry[] }> {
  const res = await fetch(`/api/content/phrasebook/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return handleJson(res);
}

export async function deletePhrasebookEntry(
  id: string
): Promise<{ deletedId: string; phrasebook: PhrasebookEntry[] }> {
  const res = await fetch(`/api/content/phrasebook/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  return handleJson(res);
}

export async function importContentJson(
  payload: unknown
): Promise<{
  importedCount: number;
  rejectedErrors: string[];
  drafts: ContentDraft[];
}> {
  const res = await fetch('/api/content/import/json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleJson(res);
}

export async function createContentBackup(): Promise<{
  filename: string;
  backups: BackupSnapshotInfo[];
}> {
  const res = await fetch('/api/content/backup', { method: 'POST' });
  return handleJson(res);
}


