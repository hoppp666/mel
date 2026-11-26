export type CollectionType = 'debate' | 'romantic';
export type OriginType = 'external' | 'original';
export type VerificationStatus = 'pending' | 'approved' | 'needs_revision' | 'rejected';
export type UsageStatus = 'unused' | 'drafted' | 'published' | 'archived';

export type NavSection =
  | 'overview'
  | 'debate'
  | 'romantic'
  | 'categories'
  | 'sources'
  | 'uniqueness'
  | 'quality'
  | 'research'
  | 'generator'
  | 'studio'
  | 'scheduler'
  | 'export'
  | 'settings';

export interface StoryQualityBreakdown {
  originality: number;
  realism: number;
  emotionalDepth: number;
  engagement: number;
  discussionPotential: number;
  specificity: number;
  variability: number;
  ambiguity?: number;
  bothSidesStrength?: number;
  contradictionPower?: number;
  warmth?: number;
  relatability?: number;
  smallDetailPower?: number;
  naturalness?: number;
}

export interface StoryQuality {
  overall: number;
  breakdown: StoryQualityBreakdown;
  editorialNote: string;
}

export interface SimilarityMatch {
  storyId: string;
  title: string;
  collection: CollectionType;
  score: number;
  reason: string;
}

export interface StoryPlot {
  id: string;
  collection: CollectionType;
  category: string;
  subcategory: string;
  title: string;
  shortDescription: string;
  fullPlot: string;
  participants: string;
  setting: string;
  coreConflictOrAction: string;
  sideAPosition: string;
  sideBPosition: string;
  emotionalMechanism: string;
  hiddenExpectation: string;
  unexpectedNuance: string;
  possibleTwist: string;
  mainTriggerQuestion: string;
  additionalQuestions: string[];
  keywords: string[];
  ideaSource: string;
  sourceUrl: string;
  originType: OriginType;
  createdAt: string;
  verificationStatus: VerificationStatus;
  usageStatus: UsageStatus;
  semanticFingerprint: string;
  mainTheme: string;
  plotMechanic: string;
  uniqueDetails: string;
  sourceAnalysisNote: string;
  batchNumber: number;
  researchId?: string;
  researchNotes?: string;
  quality: StoryQuality;
  similarityMatches: SimilarityMatch[];
  duplicateFlag: boolean;
}

export interface BatchRecord {
  batchNumber: number;
  collection: CollectionType;
  categoryFocus: string;
  searchMode: 'original' | 'web_search';
  requestedCount: number;
  generatedCount: number;
  approvedCount: number;
  rejectedCount: number;
  createdAt: string;
  committedAt?: string;
  note?: string;
}

export interface StagedStoryCandidate extends StoryPlot {
  candidateId: string;
  decision: 'pending' | 'approved' | 'needs_revision' | 'rejected';
}

export interface PendingBatch {
  batchNumber: number;
  collection: CollectionType;
  categoryFocus: string;
  searchMode: 'original' | 'web_search';
  createdAt: string;
  candidates: StagedStoryCandidate[];
}

export interface AppSettings {
  targetTotal: number;
  targetDebate: number;
  targetRomantic: number;
  similarityThreshold: number;
  minQualityScore: number;
  defaultBatchSize: 10 | 25 | 35 | 50;
}

export interface CustomCategory {
  id: string;
  collection: CollectionType;
  name: string;
  subcategories: string[];
  createdAt: string;
}

export interface BackupEntry {
  filename: string;
  createdAt: string;
  sizeBytes: number;
  storyCount: number;
}

export interface DatabaseStats {
  total: number;
  debateCount: number;
  romanticCount: number;
  approvedCount: number;
  pendingCount: number;
  needsRevisionCount: number;
  rejectedCount: number;
  unusedCount: number;
  draftedCount: number;
  publishedCount: number;
  archivedCount: number;
  duplicatesCount: number;
  externalCount: number;
  originalCount: number;
  averageQuality: number;
  progressPercent: number;
}

export interface DatabaseFile {
  version: string;
  updatedAt: string;
  stories: StoryPlot[];
  batches: BatchRecord[];
  customCategories: CustomCategory[];
  settings: AppSettings;
}

export interface DatabaseSnapshotResponse {
  database: DatabaseFile;
  stats: DatabaseStats;
  pendingBatch: PendingBatch | null;
  backups: BackupEntry[];
  storageMode: 'local_disk';
}

// ============================================================================
// ЭТАП 2: FOREIGN RESEARCH ENGINE
// ============================================================================

export type ResearchSourceType = 'reddit' | 'media' | 'blog' | 'community';
export type ResearchSourceStatus = 'available' | 'restricted' | 'unavailable' | 'unchecked';

export interface ResearchSource {
  id: string;
  name: string;
  url: string;
  rssUrl?: string;
  sourceType: ResearchSourceType;
  defaultCollection: CollectionType | 'both';
  language: string;
  enabled: boolean;
  isSystem: boolean;
  status: ResearchSourceStatus;
  robotsAllowed: boolean | null;
  lastHttpStatus?: number | null;
  lastError?: string;
  foundCount: number;
  lastCheckedAt?: string;
}

export type ResearchJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ResearchJob {
  id: string;
  collection: CollectionType;
  sourceIds: string[];
  categoryFocus: string;
  sourceLanguage: string;
  requestedCount: number;
  analysisDepth: 'standard' | 'deep';
  transformMode: 'analyze_only' | 'analyze_and_generate';
  status: ResearchJobStatus;
  methodUsed: 'direct_public_feed' | 'google_search_grounding' | 'hybrid';
  processedCount: number;
  foundCount: number;
  failedCount: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  logs: string[];
}

export type ResearchQueueStatus =
  | 'research_pending'
  | 'analysis_completed'
  | 'idea_generated'
  | 'duplicate_check'
  | 'awaiting_review'
  | 'approved_for_database'
  | 'rejected';

export interface ResearchQualityScore {
  overall: number;
  tierLabel: 'Отличная идея' | 'Хорошая идея' | 'Требует проверки' | 'Рекомендуется доработка или отклонение';
  explanation: string;
  breakdown: {
    originality: number;
    realism: number;
    specificity: number;
    emotionalExpressiveness: number;
    readerInterest: number;
    diversity: number;
    discussionPotential: number;
    mechanicQuality: number;
    ambiguity?: number;
    bothSidesArgument?: number;
    debatePotential?: number;
    warmth?: number;
    naturalness?: number;
    detailStrength?: number;
    relatability?: number;
    antiSaccharine?: number;
  };
}

export interface ResearchGeneratedPlotDraft {
  category: string;
  subcategory: string;
  title: string;
  shortDescription: string;
  fullPlot: string;
  participants: string;
  setting: string;
  coreConflictOrAction: string;
  sideAPosition: string;
  sideBPosition: string;
  emotionalMechanism: string;
  hiddenExpectation: string;
  unexpectedNuance: string;
  possibleTwist: string;
  mainTriggerQuestion: string;
  additionalQuestions: string[];
  keywords: string[];
  mainTheme: string;
  plotMechanic: string;
  uniqueDetails: string;
}

export interface ResearchResult {
  researchId: string;
  jobId: string;
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceAuthor: string;
  sourceDate: string;
  researchDate: string;
  sourceType: ResearchSourceType;
  collection: CollectionType;
  originalLanguage: string;
  sourceExcerpt: string;
  sourceSummary: string;
  mainSituation: string;
  participants: string;
  relationshipType: string;
  mainConflict: string;
  positionsOfParticipants: string;
  emotionalMechanism: string;
  hiddenExpectation: string;
  unexpectedDetail: string;
  possibleTwist: string;
  readerReactionPotential: string;
  storyMechanic: string;
  keywords: string[];
  researchNotes: string;
  sourceReliability: 'verified_direct' | 'verified_grounding' | 'unverified';
  analysisStatus: 'pending' | 'completed' | 'failed';
  originalityAssessment: string;
  queueStatus: ResearchQueueStatus;
  generatedPlot: ResearchGeneratedPlotDraft | null;
  quality: ResearchQualityScore | null;
  similarityMatches: SimilarityMatch[];
  duplicateFlag: boolean;
  approvedStoryId?: string;
}

export interface ResearchStatistics {
  totalJobs: number;
  activeJobs: number;
  totalResults: number;
  sourcesChecked: number;
  sourcesAvailable: number;
  sourcesRestricted: number;
  sourcesUnavailable: number;
  ideasGenerated: number;
  awaitingReviewCount: number;
  approvedToDatabaseCount: number;
  rejectedCount: number;
  duplicatesDetectedCount: number;
  debateResultsCount: number;
  romanticResultsCount: number;
}

// ============================================================================
// ЭТАП 3: STORY GENERATOR + MELO_LOVE VOICE ENGINE
// ============================================================================

export type NarrativeStartStyle =
  | 'action_start'
  | 'detail_start'
  | 'dialogue_start'
  | 'emotion_start'
  | 'contradiction_start'
  | 'observer_start'
  | 'outcome_first'
  | 'gradual_reveal';

export type ContentLengthPreset = 'short' | 'standard' | 'expanded' | 'longread';

export type ContentDraftStatus =
  | 'generating'
  | 'draft'
  | 'needs_revision'
  | 'ready_for_review'
  | 'approved'
  | 'rejected'
  | 'archived';

export type RewriteMode =
  | 'more_lively'
  | 'more_conversational'
  | 'sharpen_hook'
  | 'softer_romantic'
  | 'sharper_debate'
  | 'shorten'
  | 'expand'
  | 'change_opening'
  | 'change_ending'
  | 'remove_ai_feel';

export type ContentExportMode = 'draft_only' | 'with_source' | 'story_only';

export interface VoiceProfileSettings {
  irony: number;
  conversational: number;
  emotionality: number;
  provocativeness: number;
  phraseDensity: number;
  sentenceLength: number;
  dramaLevel: number;
}

export interface VoicePreset {
  id: string;
  name: string;
  description: string;
  debate: VoiceProfileSettings;
  romantic: VoiceProfileSettings;
  isSystem: boolean;
}

export interface VoiceConfig {
  activePresetId: string;
  debate: VoiceProfileSettings;
  romantic: VoiceProfileSettings;
  customPresets: VoicePreset[];
  minPublishQualityScore: number;
  updatedAt: string;
}

export interface PhrasebookEntry {
  id: string;
  phrase: string;
  meaningNote: string;
  collectionScope: CollectionType | 'both';
  toneTag: string;
  weight: number;
  maxFrequencyPer10: number;
  banned: boolean;
  recentUsageCount: number;
  totalUsageCount: number;
  createdAt: string;
}

export interface ContentQualityPenalties {
  hasMeaninglessRepetition: boolean;
  soundsLikeAiTemplate: boolean;
  artificialColloquialism: boolean;
  phraseOveruse: boolean;
  contradictsSource: boolean;
  lostImportantDetail: boolean;
  artificialEnding: boolean;
  unsubstantiatedClaims: boolean;
  verbatimCopy: boolean;
  details: string[];
}

export interface ContentQualityScore {
  overall: number;
  breakdown: {
    hookStrength: number;
    languageNaturalness: number;
    emotionalImpact: number;
    plotDepth: number;
    narrativeUniqueness: number;
    voiceRecognition: number;
    endingQuality: number;
    sourceFidelity: number;
  };
  penalties: ContentQualityPenalties;
  editorialComment: string;
  passedThreshold: boolean;
}

export interface ContentRevision {
  version: number;
  title: string;
  body: string;
  triggerQuestion: string;
  qualityScore: number;
  reason: string;
  createdAt: string;
}

export interface ContentDraft {
  contentId: string;
  sourceStoryId: string;
  collection: CollectionType;
  category: string;
  subcategory: string;
  title: string;
  subtitle: string;
  body: string;
  triggerQuestion: string;
  wordCount: number;
  lengthPreset: ContentLengthPreset;
  narrativeStyle: NarrativeStartStyle;
  voicePresetId: string;
  usedPhraseIds: string[];
  usedPhrases: string[];
  openingPattern: string;
  endingPattern: string;
  status: ContentDraftStatus;
  quality: ContentQualityScore;
  autoRefined: boolean;
  completenessAuditNote: string;
  variantGroupId?: string;
  variantIndex?: number;
  researchId?: string;
  sourceUrl?: string;
  originType: OriginType;
  revisionHistory: ContentRevision[];
  createdAt: string;
  updatedAt: string;
}

export interface ContentMetrics {
  availableStoriesCount: number;
  availableDebateCount: number;
  availableRomanticCount: number;
  totalDrafts: number;
  readyForReviewCount: number;
  needsRevisionCount: number;
  approvedCount: number;
  averageQualityScore: number;
  activePhrasesCount: number;
  overusedPhrasesCount: number;
}

// ============================================================================
// ЭТАП 4: CONTENT STUDIO + PUBLISHING INFRASTRUCTURE (TELEGRAM & ДЗЕН)
// ============================================================================

export type PublishingQueueStatus =
  | 'draft'
  | 'ready'
  | 'scheduled'
  | 'sending'
  | 'sent_to_telegram'
  | 'zen_delivery_unconfirmed'
  | 'zen_delivery_verified'
  | 'failed';

export interface EditorialCheckReport {
  overallScore?: number;
  spellingOk: boolean;
  noRepetitionOk: boolean;
  logicOk: boolean;
  styleOk?: boolean;
  meloStyleOk?: boolean;
  headlineOk: boolean;
  hashtagsOk: boolean;
  sourceMatchOk?: boolean;
  notes: string[];
}

export interface PublicationRevision {
  version: number;
  title: string;
  teaser: string;
  body: string;
  closingQuestion: string;
  hashtags: string[];
  reason: string;
  createdAt: string;
}

export interface PublicationManualStats {
  views?: number;
  reads?: number;
  reactions?: number;
  updatedAt?: string;
}

export interface PublicationItem {
  publicationId: string;
  sourceDraftId?: string;
  sourceStoryId: string;
  researchId?: string;
  sourceUrl?: string;
  collection: CollectionType;
  category: string;
  subcategory: string;
  title: string;
  alternativeTitles: string[];
  teaser: string;
  body: string;
  closingQuestion: string;
  hashtags: string[];
  hasImageAttachment: boolean;
  totalChars: number;
  remainingChars: number;
  exceedsTelegramLimit: boolean;
  firstSentenceLength: number;
  seoNotes: string;
  seoKeywords: string[];
  editorialChecks: EditorialCheckReport;
  status: PublishingQueueStatus;
  idempotencyKey: string;
  telegramMessageId?: number;
  telegramChatId?: string;
  scheduledAt?: string;
  sentToTelegramAt?: string;
  zenConfirmedAt?: string;
  zenConfirmedSource?: string;
  error?: string;
  manualStats?: PublicationManualStats;
  revisionHistory: PublicationRevision[];
  createdAt: string;
  updatedAt: string;
}

export interface PublishingSettings {
  autoSendEnabled: boolean;
  dryRunMode: boolean;
  telegramChannelRef: string;
  dzenChannelName: string;
  dzenSyncMode: 'automatic' | 'manual_forward';
  utmSource: string;
  safeTelegramCharLimit: number;
  updatedAt: string;
}

export interface TelegramIntegrationStatus {
  hasBotTokenConfigured: boolean;
  hasChannelConfigured: boolean;
  hasGeminiConfigured: boolean;
  hasGeminiPrimaryConfigured?: boolean;
  hasGigaChatConfigured?: boolean;
  hasSupabaseConfigured: boolean;
  autoSendEnabled: boolean;
  dryRunMode: boolean;
}

export interface PublishingLogEntry {
  id: string;
  publicationId: string;
  action: string;
  status: string;
  detail: string;
  createdAt: string;
}

export interface PublishingAnalytics {
  totalPublications: number;
  draftCount: number;
  readyCount: number;
  scheduledCount: number;
  sentToTelegramCount: number;
  zenUnconfirmedCount: number;
  zenVerifiedCount: number;
  failedCount: number;
  totalManualViews: number;
  totalManualReads: number;
  totalManualReactions: number;
  hasExternalStats: boolean;
}

// ============================================================================
// ЭТАП 5: AUTONOMOUS RESEARCH, CONTENT PRODUCTION & PUBLISHING SCHEDULER
// ============================================================================

export type ProcessedMaterialStatus =
  | 'discovered'
  | 'duplicate'
  | 'approved'
  | 'generating'
  | 'generated'
  | 'quality_check'
  | 'ready'
  | 'sending'
  | 'published_to_telegram'
  | 'failed';

export interface ProcessedMaterialEntry {
  id: string;
  url: string;
  normalizedUrl: string;
  sourceId: string;
  sourceName: string;
  title: string;
  normalizedTitle: string;
  collection: CollectionType;
  publishedAt?: string;
  discoveredAt: string;
  contentFingerprint: string;
  status: ProcessedMaterialStatus;
  batchId?: string;
  researchId?: string;
  storyId?: string;
  contentId?: string;
  publicationId?: string;
  telegramMessageId?: number;
  error?: string;
  updatedAt: string;
}

export interface ResearchBatchRecord {
  batchId: string;
  collection: CollectionType;
  status: 'in_progress' | 'completed' | 'paused';
  targetCount: number;
  processedUrls: string[];
  discoveredCount: number;
  newUniqueCount: number;
  duplicateCount: number;
  analyzedCount: number;
  pendingAnalysisCount: number;
  failedCount: number;
  startedAt: string;
  finishedAt?: string;
  lastError?: string;
}

export interface AutonomousSchedulerConfig {
  researchEnabled: boolean;
  autoPublishEnabled: boolean;
  researchIntervalHours: number;
  researchBatchSize: number;
  productionBatchSize: number;
  publishMinIntervalHours: number;
  maxPublishesPerDay: number;
  collectionsRotation: 'alternate' | 'debate' | 'romantic';
  stopRequested: boolean;
  githubRepo?: string;
  updatedAt: string;
}

export interface SchedulerRunLog {
  runId: string;
  kind: 'research' | 'production' | 'publish' | 'full_cycle';
  mode: 'github_actions' | 'manual' | 'server';
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  discovered: number;
  uniqueAdded: number;
  duplicates: number;
  analyzed: number;
  pendingAnalysis: number;
  storiesApproved: number;
  publicationsCreated: number;
  publishedToTelegram: number;
  summary: string;
  error?: string;
}

export interface AutonomousSchedulerState {
  config: AutonomousSchedulerConfig;
  activeBatchId?: string;
  batches: ResearchBatchRecord[];
  lastCollectionUsed?: CollectionType;
  lastResearchRunAt?: string;
  nextScheduledResearchAt?: string;
  lastResearchError?: string;
  lastProductionRunAt?: string;
  lastProductionError?: string;
  lastPublishRunAt?: string;
  nextScheduledPublishAt?: string;
  lastSuccessfulTelegramAt?: string;
  lastPublishError?: string;
  publishedTodayDate: string;
  publishedTodayCount: number;
  totalDiscoveredMaterials: number;
  totalUniqueStoriesSaved: number;
  totalPublicationsCreated: number;
  totalPublishedToTelegram: number;
  runHistory: SchedulerRunLog[];
}

export interface GitHubWorkflowRunSummary {
  configured: boolean;
  repo?: string;
  available: boolean;
  runs: Array<{
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    event: string;
    createdAt: string;
    updatedAt: string;
    htmlUrl: string;
  }>;
  note: string;
}

export interface AutonomousMonitoringSnapshot {
  state: AutonomousSchedulerState;
  registryCount: number;
  registryByStatus: Record<ProcessedMaterialStatus, number>;
  recentRegistry: ProcessedMaterialEntry[];
  readyToPublishCount: number;
  pendingAnalysisCount: number;
  isCycleRunning: boolean;
  githubActions: GitHubWorkflowRunSummary;
}


