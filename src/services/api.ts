import {
  AppSettings,
  AutonomousMonitoringSnapshot,
  AutonomousSchedulerConfig,
  BackupEntry,
  CollectionType,
  ContentDraft,
  ContentDraftStatus,
  ContentExportMode,
  ContentLengthPreset,
  ContentMetrics,
  DatabaseSnapshotResponse,
  NarrativeStartStyle,
  PendingBatch,
  PhrasebookEntry,
  PublicationItem,
  PublicationManualStats,
  PublishingAnalytics,
  PublishingLogEntry,
  PublishingQueueStatus,
  PublishingSettings,
  ResearchJob,
  ResearchResult,
  ResearchSource,
  ResearchStatistics,
  RewriteMode,
  SchedulerRunLog,
  SimilarityMatch,
  StagedStoryCandidate,
  StoryPlot,
  TelegramIntegrationStatus,
  UsageStatus,
  VerificationStatus,
  VoiceConfig,
  VoicePreset,
} from '../shared/types.js';

export class ApiError extends Error {
  status: number;
  matches?: SimilarityMatch[];
  pendingBatch?: PendingBatch;

  constructor(
    message: string,
    status: number,
    extra?: { matches?: SimilarityMatch[]; pendingBatch?: PendingBatch }
  ) {
    super(message);
    this.status = status;
    this.matches = extra?.matches;
    this.pendingBatch = extra?.pendingBatch;
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
    ...options,
  });

  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(res.ok ? 'Некорректный ответ сервера' : `Ошибка HTTP ${res.status}`, res.status);
    }
  }

  if (!res.ok) {
    throw new ApiError(
      String(data.error || `Ошибка запроса (${res.status})`),
      res.status,
      {
        matches: data.matches as SimilarityMatch[] | undefined,
        pendingBatch: data.pendingBatch as PendingBatch | undefined,
      }
    );
  }

  return data as T;
}

// ============================================================================
// ЭТАП 1: STORY DATABASE GENERATOR
// ============================================================================

export function fetchDatabase(): Promise<DatabaseSnapshotResponse> {
  return request<DatabaseSnapshotResponse>('/api/database');
}

export function checkStorySimilarity(
  candidate: Partial<StoryPlot>
): Promise<{ matches: SimilarityMatch[]; duplicateFlag: boolean }> {
  return request('/api/stories/check-similarity', {
    method: 'POST',
    body: JSON.stringify(candidate),
  });
}

export function createStory(
  payload: Partial<StoryPlot> & { forceSave?: boolean }
): Promise<{ story: StoryPlot; snapshot: DatabaseSnapshotResponse }> {
  return request('/api/stories', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateStory(
  id: string,
  updates: Partial<StoryPlot>
): Promise<{ story: StoryPlot; snapshot: DatabaseSnapshotResponse }> {
  return request(`/api/stories/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export function updateStoryStatus(
  id: string,
  payload: { verificationStatus?: VerificationStatus; usageStatus?: UsageStatus }
): Promise<{ story: StoryPlot; snapshot: DatabaseSnapshotResponse }> {
  return request(`/api/stories/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function mergeStories(payload: {
  targetStoryId: string;
  nuanceToAppend: string;
  newTitle?: string;
}): Promise<{ story: StoryPlot; snapshot: DatabaseSnapshotResponse }> {
  return request('/api/stories/merge', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function deleteStory(
  id: string
): Promise<{ deleted: boolean; snapshot: DatabaseSnapshotResponse }> {
  return request(`/api/stories/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function rescanUniqueness(): Promise<{ snapshot: DatabaseSnapshotResponse }> {
  return request('/api/uniqueness/rescan', { method: 'POST' });
}

export function generateBatch(payload: {
  collection: CollectionType;
  categoryFocus: string;
  count: number;
  searchMode: 'original' | 'web_search';
}): Promise<{ pendingBatch: PendingBatch }> {
  return request('/api/batches/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateStagedCandidate(
  candidateId: string,
  updates: Partial<StagedStoryCandidate>
): Promise<{ pendingBatch: PendingBatch }> {
  return request(`/api/batches/staged/${encodeURIComponent(candidateId)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export function commitStagedBatch(): Promise<{ snapshot: DatabaseSnapshotResponse }> {
  return request('/api/batches/commit', { method: 'POST' });
}

export function discardStagedBatch(): Promise<{
  cleared: boolean;
  snapshot: DatabaseSnapshotResponse;
}> {
  return request('/api/batches/staged', { method: 'DELETE' });
}

export function createCustomCategory(payload: {
  collection: CollectionType;
  name: string;
  subcategories: string[];
}): Promise<{ snapshot: DatabaseSnapshotResponse }> {
  return request('/api/categories', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateSettings(
  settings: Partial<AppSettings>
): Promise<{ snapshot: DatabaseSnapshotResponse }> {
  return request('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

export function createDatabaseBackup(): Promise<{
  backup: BackupEntry;
  snapshot: DatabaseSnapshotResponse;
}> {
  return request('/api/backup', { method: 'POST' });
}

export function restoreDatabaseBackup(
  filename: string
): Promise<{ snapshot: DatabaseSnapshotResponse }> {
  return request('/api/backup/restore', {
    method: 'POST',
    body: JSON.stringify({ filename }),
  });
}

export function importStoriesJson(
  stories: Partial<StoryPlot>[]
): Promise<{
  imported: number;
  skippedDuplicates: number;
  snapshot: DatabaseSnapshotResponse;
}> {
  return request('/api/import', {
    method: 'POST',
    body: JSON.stringify({ stories }),
  });
}

export function getExportJsonUrl(collection?: string, status?: string): string {
  const params = new URLSearchParams();
  if (collection && collection !== 'all') params.set('collection', collection);
  if (status && status !== 'all') params.set('status', status);
  const qs = params.toString();
  return `/api/export/json${qs ? `?${qs}` : ''}`;
}

export function getExportCsvUrl(collection?: string, status?: string): string {
  const params = new URLSearchParams();
  if (collection && collection !== 'all') params.set('collection', collection);
  if (status && status !== 'all') params.set('status', status);
  const qs = params.toString();
  return `/api/export/csv${qs ? `?${qs}` : ''}`;
}

export function getProjectArchiveUrl(): string {
  return '/api/export/archive';
}

export function getPatchArchiveUrl(): string {
  return '/api/export/patch-archive';
}

export async function downloadZipArchiveBlob(url: string): Promise<Blob> {
  const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Не удалось скачать архив (HTTP ${res.status})`);
  }
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error(
      'Сервер вернул не ZIP-файл (возможно, прокси предпросмотра перехватил запрос — откройте приложение в отдельной вкладке браузера).'
    );
  }
  return new Blob([buf], { type: 'application/zip' });
}

// ============================================================================
// ЭТАП 2: FOREIGN RESEARCH ENGINE
// ============================================================================

export function fetchResearchStatistics(): Promise<{ statistics: ResearchStatistics }> {
  return request('/api/research/statistics');
}

export function fetchResearchSources(): Promise<{ sources: ResearchSource[] }> {
  return request('/api/research/sources');
}

export function createResearchSource(
  payload: Partial<ResearchSource>
): Promise<{ source: ResearchSource; sources: ResearchSource[] }> {
  return request('/api/research/sources', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateResearchSource(
  id: string,
  updates: Partial<ResearchSource>
): Promise<{ source: ResearchSource; sources: ResearchSource[] }> {
  return request(`/api/research/sources/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export function deleteResearchSource(
  id: string
): Promise<{ deleted: boolean; sources: ResearchSource[] }> {
  return request(`/api/research/sources/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function checkResearchSource(
  id: string
): Promise<{ source: ResearchSource; sources: ResearchSource[] }> {
  return request(`/api/research/sources/${encodeURIComponent(id)}/check`, {
    method: 'POST',
  });
}

export function checkAllResearchSources(): Promise<{ sources: ResearchSource[] }> {
  return request('/api/research/sources/check-all', { method: 'POST' });
}

export function startResearchSearch(payload: {
  collection: CollectionType;
  sourceIds: string[];
  categoryFocus: string;
  sourceLanguage: string;
  requestedCount: number;
  analysisDepth: 'standard' | 'deep';
  transformMode: 'analyze_only' | 'analyze_and_generate';
}): Promise<{ job: ResearchJob }> {
  return request('/api/research/search', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchResearchJobs(): Promise<{ jobs: ResearchJob[] }> {
  return request('/api/research/jobs');
}

export function cancelResearchJob(id: string): Promise<{ job: ResearchJob }> {
  return request(`/api/research/jobs/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
  });
}

export function fetchResearchResults(): Promise<{ results: ResearchResult[] }> {
  return request('/api/research/results');
}

export function updateResearchResult(
  id: string,
  updates: Partial<ResearchResult>
): Promise<{ result: ResearchResult }> {
  return request(`/api/research/results/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export function reanalyzeResearchResult(id: string): Promise<{ result: ResearchResult }> {
  return request(`/api/research/results/${encodeURIComponent(id)}/analyze`, {
    method: 'POST',
  });
}

export function generateIdeaFromResult(id: string): Promise<{ result: ResearchResult }> {
  return request(`/api/research/results/${encodeURIComponent(id)}/generate-idea`, {
    method: 'POST',
  });
}

export function checkResearchDuplicate(id: string): Promise<{ result: ResearchResult }> {
  return request(`/api/research/results/${encodeURIComponent(id)}/check-duplicate`, {
    method: 'POST',
  });
}

export function approveResearchResult(
  id: string,
  forceApprove = false
): Promise<{ result: ResearchResult; story: StoryPlot; snapshot: DatabaseSnapshotResponse }> {
  return request(`/api/research/results/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    body: JSON.stringify({ forceApprove }),
  });
}

export function rejectResearchResult(id: string): Promise<{ result: ResearchResult }> {
  return request(`/api/research/results/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
  });
}

export function createResearchBackup(): Promise<{ backup: BackupEntry }> {
  return request('/api/research/backup', { method: 'POST' });
}

// ============================================================================
// ЭТАП 3: STORY GENERATOR + MELO_LOVE VOICE ENGINE
// ============================================================================

export interface ContentStateResponse {
  metrics: ContentMetrics;
  availableStories: StoryPlot[];
  drafts: ContentDraft[];
  voiceConfig: VoiceConfig;
  systemPresets: VoicePreset[];
  phrasebook: PhrasebookEntry[];
  isGenerating: boolean;
}

export function fetchContentState(): Promise<ContentStateResponse> {
  return request<ContentStateResponse>('/api/content/state');
}

export function generateContent(payload: {
  sourceStoryId: string;
  lengthPreset: ContentLengthPreset;
  narrativeStyle?: NarrativeStartStyle;
  variantsCount: number;
  voicePresetId?: string;
}): Promise<{ created: ContentDraft[]; metrics: ContentMetrics }> {
  return request('/api/content/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function cancelContentGeneration(): Promise<{ cancelled: boolean }> {
  return request('/api/content/generate/cancel', { method: 'POST' });
}

export function createContentDraft(payload: {
  sourceStoryId: string;
  title: string;
  subtitle?: string;
  body: string;
  triggerQuestion?: string;
  status?: ContentDraftStatus;
}): Promise<{ draft: ContentDraft; metrics: ContentMetrics }> {
  return request('/api/content/drafts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateContentDraft(
  id: string,
  updates: {
    title?: string;
    subtitle?: string;
    body?: string;
    triggerQuestion?: string;
    revisionReason?: string;
  }
): Promise<{ draft: ContentDraft; metrics: ContentMetrics }> {
  return request(`/api/content/drafts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export function updateContentDraftStatus(
  id: string,
  status: ContentDraftStatus
): Promise<{ draft: ContentDraft; metrics: ContentMetrics }> {
  return request(`/api/content/drafts/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function rewriteContentDraft(
  id: string,
  mode: RewriteMode
): Promise<{ draft: ContentDraft; metrics: ContentMetrics }> {
  return request(`/api/content/drafts/${encodeURIComponent(id)}/rewrite`, {
    method: 'POST',
    body: JSON.stringify({ mode }),
  });
}

export function restoreContentVersion(
  id: string,
  version: number
): Promise<{ draft: ContentDraft; metrics: ContentMetrics }> {
  return request(`/api/content/drafts/${encodeURIComponent(id)}/restore-version`, {
    method: 'POST',
    body: JSON.stringify({ version }),
  });
}

export function deleteContentDraft(
  id: string
): Promise<{ deleted: boolean; metrics: ContentMetrics }> {
  return request(`/api/content/drafts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function updateVoiceConfig(
  payload: Partial<VoiceConfig>
): Promise<{ voiceConfig: VoiceConfig }> {
  return request('/api/content/voice-config', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function createVoicePreset(payload: {
  name: string;
  description?: string;
  debate?: VoiceConfig['debate'];
  romantic?: VoiceConfig['romantic'];
}): Promise<{ voiceConfig: VoiceConfig; preset: VoicePreset }> {
  return request('/api/content/voice-presets', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function deleteVoicePreset(id: string): Promise<{ voiceConfig: VoiceConfig }> {
  return request(`/api/content/voice-presets/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function createPhrasebookEntry(
  payload: Partial<PhrasebookEntry>
): Promise<{ entry: PhrasebookEntry; phrasebook: PhrasebookEntry[] }> {
  return request('/api/content/phrasebook', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updatePhrasebookEntry(
  id: string,
  updates: Partial<PhrasebookEntry>
): Promise<{ entry: PhrasebookEntry; phrasebook: PhrasebookEntry[] }> {
  return request(`/api/content/phrasebook/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export function deletePhrasebookEntry(
  id: string
): Promise<{ phrasebook: PhrasebookEntry[] }> {
  return request(`/api/content/phrasebook/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function exportContentJson(
  mode: ContentExportMode,
  contentIds?: string[]
): Promise<Blob> {
  const res = await fetch('/api/content/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, contentIds }),
  });
  if (!res.ok) {
    throw new ApiError('Не удалось экспортировать публикации', res.status);
  }
  return res.blob();
}

export function importContentJson(
  items: unknown[]
): Promise<{ imported: number; errors: string[]; metrics: ContentMetrics }> {
  return request('/api/content/import', {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}

export function createContentBackup(): Promise<{ backup: BackupEntry }> {
  return request('/api/content/backup', { method: 'POST' });
}

// ============================================================================
// ЭТАП 4: CONTENT STUDIO + PUBLISHING INFRASTRUCTURE
// ============================================================================

export interface PublishingStateResponse {
  publications: PublicationItem[];
  settings: PublishingSettings;
  integrationStatus: TelegramIntegrationStatus;
  analytics: PublishingAnalytics;
  logs: PublishingLogEntry[];
  eligibleDrafts: ContentDraft[];
  eligibleStories: StoryPlot[];
}

export function fetchPublishingState(): Promise<PublishingStateResponse> {
  return request<PublishingStateResponse>('/api/publishing/state');
}

export function createPublication(payload: {
  sourceDraftId?: string;
  sourceStoryId?: string;
  title?: string;
  teaser?: string;
  body?: string;
  closingQuestion?: string;
  hashtags?: string[];
  hasImageAttachment?: boolean;
}): Promise<{ publication: PublicationItem; analytics: PublishingAnalytics }> {
  return request('/api/publishing/publications', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updatePublication(
  id: string,
  updates: Partial<PublicationItem> & { revisionReason?: string }
): Promise<{ publication: PublicationItem; analytics: PublishingAnalytics }> {
  return request(`/api/publishing/publications/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export function updatePublicationStatus(
  id: string,
  status: PublishingQueueStatus,
  extra?: { scheduledAt?: string; confirmationSource?: string }
): Promise<{ publication: PublicationItem; analytics: PublishingAnalytics }> {
  return request(`/api/publishing/publications/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, ...(extra || {}) }),
  });
}

export function restorePublicationVersion(
  id: string,
  version: number
): Promise<{ publication: PublicationItem; analytics: PublishingAnalytics }> {
  return request(`/api/publishing/publications/${encodeURIComponent(id)}/restore-version`, {
    method: 'POST',
    body: JSON.stringify({ version }),
  });
}

export function deletePublication(
  id: string
): Promise<{ deleted: boolean; analytics: PublishingAnalytics }> {
  return request(`/api/publishing/publications/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function generatePublicationHeadlines(
  id: string
): Promise<{ headlines: string[]; publication: PublicationItem }> {
  return request(`/api/publishing/publications/${encodeURIComponent(id)}/ai-headlines`, {
    method: 'POST',
  });
}

export function generatePublicationSeoProposal(id: string): Promise<{
  proposal: {
    adaptedTitle: string;
    adaptedTeaser: string;
    adaptedBody: string;
    seoKeywords: string[];
    suggestedHashtags: string[];
    diffSummary: string;
  };
}> {
  return request(`/api/publishing/publications/${encodeURIComponent(id)}/ai-seo`, {
    method: 'POST',
  });
}

export function generatePublicationShortenProposal(id: string): Promise<{
  proposal: { shortenedBody: string; explanation: string };
}> {
  return request(`/api/publishing/publications/${encodeURIComponent(id)}/ai-shorten`, {
    method: 'POST',
  });
}

export function suggestPublicationHashtags(
  id: string
): Promise<{ hashtags: string[] }> {
  return request(`/api/publishing/publications/${encodeURIComponent(id)}/ai-hashtags`, {
    method: 'POST',
  });
}

export function sendPublicationToTelegram(
  id: string,
  dryRun?: boolean
): Promise<{
  mode: 'dry_run' | 'live';
  ok: boolean;
  publication: PublicationItem;
  formattedPreview: string;
  messageId?: number;
  note: string;
  analytics: PublishingAnalytics;
}> {
  return request(`/api/publishing/publications/${encodeURIComponent(id)}/send-telegram`, {
    method: 'POST',
    body: JSON.stringify({ dryRun }),
  });
}

export function confirmZenDelivery(
  id: string,
  payload?: { source?: string; manualStats?: PublicationManualStats }
): Promise<{ publication: PublicationItem; analytics: PublishingAnalytics }> {
  return request(`/api/publishing/publications/${encodeURIComponent(id)}/confirm-zen`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function processDuePublishingQueue(): Promise<{
  summary: { processed: number; sent: number; failed: number; skippedDryRun: number };
  analytics: PublishingAnalytics;
}> {
  return request('/api/publishing/queue/process-due', { method: 'POST' });
}

export function updatePublishingSettings(
  updates: Partial<PublishingSettings>
): Promise<{
  settings: PublishingSettings;
  integrationStatus: TelegramIntegrationStatus;
}> {
  return request('/api/publishing/settings', {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export function testTelegramConnectionApi(): Promise<{
  ok: boolean;
  botUsername?: string;
  channelTitle?: string;
  channelType?: string;
  note: string;
}> {
  return request('/api/publishing/test-telegram', { method: 'POST' });
}

export function createPublishingBackupApi(): Promise<{
  backup: { filename: string; createdAt: string; publicationCount: number };
}> {
  return request('/api/publishing/backup', { method: 'POST' });
}

export function fetchSupabaseSchema(): Promise<{ sql: string }> {
  return request('/api/publishing/supabase/schema');
}

export function prepareOrRunSupabaseMigrationApi(executeLiveSync: boolean): Promise<{
  report: {
    ready: boolean;
    backupsCreated: { database: string; research: string; content: string; publishing: string };
    counts: {
      stories: number;
      researchResults: number;
      contentDrafts: number;
      publications: number;
      phrasebook: number;
      logs: number;
    };
    integrityErrors: string[];
    supabaseConfigured: boolean;
    liveSyncAttempted: boolean;
    liveSyncResult?: string;
  };
}> {
  return request('/api/publishing/supabase/prepare-migration', {
    method: 'POST',
    body: JSON.stringify({ executeLiveSync }),
  });
}

export function fetchIntegrationStatus(): Promise<TelegramIntegrationStatus> {
  return request<TelegramIntegrationStatus>('/api/integrations/status');
}

// ============================================================================
// ЭТАП 5: AUTONOMOUS RESEARCH & PUBLISHING SCHEDULER
// ============================================================================

export function fetchAutonomousState(): Promise<AutonomousMonitoringSnapshot> {
  return request<AutonomousMonitoringSnapshot>('/api/autonomous/state');
}

export function updateAutonomousConfig(
  updates: Partial<AutonomousSchedulerConfig>
): Promise<AutonomousMonitoringSnapshot> {
  return request<AutonomousMonitoringSnapshot>('/api/autonomous/config', {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export function stopAutonomousScheduler(): Promise<AutonomousMonitoringSnapshot> {
  return request<AutonomousMonitoringSnapshot>('/api/autonomous/stop', {
    method: 'POST',
  });
}

export function resumeAutonomousScheduler(): Promise<AutonomousMonitoringSnapshot> {
  return request<AutonomousMonitoringSnapshot>('/api/autonomous/resume', {
    method: 'POST',
  });
}

export function runAutonomousResearchNow(payload?: {
  collectionOverride?: CollectionType;
  ignoreStopFlag?: boolean;
}): Promise<{ log: SchedulerRunLog; snapshot: AutonomousMonitoringSnapshot }> {
  return request('/api/autonomous/run-research', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function runAutonomousProductionNow(payload?: {
  ignoreStopFlag?: boolean;
}): Promise<{ log: SchedulerRunLog; snapshot: AutonomousMonitoringSnapshot }> {
  return request('/api/autonomous/run-production', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function runAutonomousPublishNow(payload?: {
  dryRun?: boolean;
  ignoreStopFlag?: boolean;
}): Promise<{ log: SchedulerRunLog; snapshot: AutonomousMonitoringSnapshot }> {
  return request('/api/autonomous/run-publish', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function runAutonomousFullCycleNow(payload?: {
  dryRunPublish?: boolean;
  collectionOverride?: CollectionType;
  ignoreStopFlag?: boolean;
}): Promise<{
  result: {
    research: SchedulerRunLog;
    production: SchedulerRunLog;
    publish: SchedulerRunLog;
  };
  snapshot: AutonomousMonitoringSnapshot;
}> {
  return request('/api/autonomous/run-full-cycle', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}


