export type CollectionType = 'debate' | 'romantic';

export type OriginType = 'external' | 'original';

export type VerificationStatus = 'pending' | 'approved' | 'needs_revision' | 'rejected';

export type UsageStatus = 'unused' | 'drafted' | 'published' | 'archived';

export interface QualityMetrics {
  overall: number;
  originality: number;
  realism: number;
  emotionalExpressiveness: number;
  interest: number;
  discussionPotential: number;
  specificity: number;
  plotVariability: number;
  // Debate-specific
  ambiguity?: number;
  bothSidesArgumentation?: number;
  contradictionStrength?: number;
  // Romantic-specific
  emotionalWarmth?: number;
  relatability?: number;
  smallDetailPower?: number;
  naturalness?: number;
  editorialNote: string;
}

export interface SimilarityMatch {
  matchedId: string;
  matchedTitle: string;
  matchedShortDescription: string;
  matchedCollection: CollectionType;
  matchedCategory: string;
  similarityScore: number; // 0 to 100
  sharedKeywords: string[];
  reason: string;
}

export interface StoryPlot {
  // 26 обязательных структурированных полей
  id: string; // 1. ID
  collection: CollectionType; // 2. Коллекция
  category: string; // 3. Категория
  subcategory: string; // 4. Подкатегория
  title: string; // 5. Название сюжета
  shortDescription: string; // 6. Краткое описание
  fullPlot: string; // 7. Полная сюжетная основа
  participants: string; // 8. Участники
  setting: string; // 9. Место действия
  coreConflictOrAction: string; // 10. Главный конфликт или действие
  sideAPosition: string; // 11. Позиция первой стороны (или инициатора в романтике)
  sideBPosition: string; // 12. Позиция второй стороны (или реакция партнёра в романтике)
  emotionalMechanism: string; // 13. Эмоциональный механизм
  hiddenExpectation: string; // 14. Скрытое ожидание
  unexpectedNuance: string; // 15. Неожиданный нюанс
  possibleTwist: string; // 16. Возможный поворот / финал
  mainTriggerQuestion: string; // 17. Основной триггерный вопрос
  additionalQuestions: string[]; // 18. Дополнительные вопросы
  keywords: string[]; // 19. Ключевые слова
  ideaSource: string; // 20. Источник идеи
  sourceUrl: string; // 21. URL источника
  originType: OriginType; // 22. Тип происхождения
  createdAt: string; // 23. Дата создания
  verificationStatus: VerificationStatus; // 24. Статус проверки
  usageStatus: UsageStatus; // 25. Статус использования
  semanticFingerprint: string; // 26. Семантический отпечаток

  // Дополнительные аналитические поля для контроля уникальности и качества
  mainTheme: string;
  plotMechanic: string;
  uniqueDetails: string;
  sourceAnalysisNote?: string;
  researchId?: string;
  researchNotes?: string;
  batchNumber: number;
  quality: QualityMetrics;
  similarityMatches?: SimilarityMatch[];
  duplicateFlag?: boolean;
  updatedAt?: string;
}

export interface BatchRecord {
  batchNumber: number;
  collection: CollectionType;
  targetCategory: string;
  requestedCount: number;
  generatedCount: number;
  acceptedCount: number;
  flaggedDuplicatesCount: number;
  rejectedCount: number;
  researchMode: 'original' | 'external_search';
  createdAt: string;
  notes: string;
}

export interface AppSettings {
  targetTotalStories: number; // 3000
  targetDebateStories: number; // 1500
  targetRomanticStories: number; // 1500
  defaultBatchSize: number; // 25
  similarityThreshold: number; // 42 (%)
  minimumApprovalScore: number; // 70
  storageMode: 'local_disk'; // Supabase-ready adapter pattern
  supabaseConfigured: boolean;
}

export interface DatabaseState {
  version: number;
  lastUpdated: string;
  stories: StoryPlot[];
  batches: BatchRecord[];
  customCategories: {
    debate: string[];
    romantic: string[];
  };
  settings: AppSettings;
}

export interface DatabaseStats {
  total: number;
  debateTotal: number;
  romanticTotal: number;
  approved: number;
  pending: number;
  needsRevision: number;
  rejected: number;
  duplicatesDetected: number;
  externalOriginCount: number;
  originalOriginCount: number;
  averageQuality: number;
  progressPercent: number;
  debateProgressPercent: number;
  romanticProgressPercent: number;
}

export type NavSection =
  | 'overview'
  | 'debate'
  | 'romantic'
  | 'research'
  | 'generator'
  | 'categories'
  | 'sources'
  | 'uniqueness'
  | 'quality'
  | 'export'
  | 'settings';

/* ============================================================================
   STAGE 2: FOREIGN RESEARCH ENGINE TYPES
   ============================================================================ */

export type ResearchPlatformType = 'reddit' | 'media' | 'custom';

export type SourceAvailabilityStatus =
  | 'unchecked'
  | 'available'
  | 'restricted'
  | 'unavailable';

export interface ResearchSource {
  id: string;
  name: string;
  url: string;
  domain: string;
  platform: ResearchPlatformType;
  sourceType: string; // e.g. 'Reddit Community', 'Editorial Column', 'Digital Magazine'
  language: string; // 'en' | 'other'
  directions: CollectionType[];
  enabled: boolean;
  isCustom: boolean;
  availabilityStatus: SourceAvailabilityStatus;
  availabilityMessage: string;
  robotsAllowed: boolean | null;
  lastCheckedAt: string | null;
  itemsFoundCount: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type ResearchQueueStatus =
  | 'research_pending'
  | 'analysis_completed'
  | 'idea_generated'
  | 'duplicate_check'
  | 'awaiting_review'
  | 'approved_for_database'
  | 'rejected';

export type ResearchAnalysisStatus = 'pending' | 'completed' | 'failed';
export type SourceReliabilityStatus = 'verified_url' | 'search_grounded' | 'direct_feed' | 'unverified';
export type ResearchDepth = 'standard' | 'deep';
export type ResearchConversionMode = 'analysis_only' | 'analysis_and_idea';

export interface ResearchQualityBreakdown {
  overall: number; // 0-100
  originality: number;
  realism: number;
  specificity: number;
  emotionalExpressiveness: number;
  readerInterest: number;
  diversity: number;
  discussionPotential: number;
  mechanicQuality: number;
  // Debate-specific
  ambiguity?: number;
  bothSidesArgumentation?: number;
  debatePotential?: number;
  // Romantic-specific
  warmth?: number;
  naturalness?: number;
  emotionalDetailPower?: number;
  relatability?: number;
  nonSaccharine?: number;
  tierLabel: string; // e.g. 'Отличная идея', 'Хорошая идея', 'Требует проверки', 'Рекомендуется доработка'
  explanation: string;
}

export interface ResearchDuplicateMatch extends SimilarityMatch {
  matchScope: 'story_database' | 'research_queue' | 'current_batch';
}

export interface ResearchIdeaDraft {
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
  mainTheme: string;
  plotMechanic: string;
  uniqueDetails: string;
  originType: OriginType;
  sourceUrl: string;
  ideaSource: string;
  researchNotes: string;
}

export interface ResearchResult {
  researchId: string;
  jobId: string;
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceAuthor: string; // 'unknown' if not reliably known
  sourceDate: string; // 'unknown' if not reliably known
  researchDate: string;
  sourceType: string;
  collection: CollectionType;
  targetCategory: string;
  originalLanguage: string;
  // Facts from source vs Model analysis
  sourceSummary: string;
  mainSituation: string;
  participants: string;
  relationshipType: string;
  mainConflict: string;
  positionsOfParticipants: {
    sideA: string;
    sideB: string;
  };
  emotionalMechanism: string;
  hiddenExpectation: string;
  unexpectedDetail: string;
  possibleTwist: string;
  readerReactionPotential: string;
  storyMechanic: string;
  keywords: string[];
  researchNotes: string;
  sourceReliability: SourceReliabilityStatus;
  analysisStatus: ResearchAnalysisStatus;
  originalityAssessment: number; // 0-100
  // Queue & Integration
  queueStatus: ResearchQueueStatus;
  generatedIdea: ResearchIdeaDraft | null;
  qualityBreakdown: ResearchQualityBreakdown;
  duplicateMatches: ResearchDuplicateMatch[];
  duplicateFlag: boolean;
  savedStoryId?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}

export type ResearchJobStatus = 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted';

export interface ResearchJobLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface ResearchJob {
  id: string;
  collection: CollectionType;
  sourceIds: string[];
  sourceNames: string[];
  category: string;
  sourceLanguage: string;
  requestedCount: number;
  processedCount: number;
  foundCount: number;
  ideasGeneratedCount: number;
  duplicatesDetectedCount: number;
  depth: ResearchDepth;
  conversionMode: ResearchConversionMode;
  status: ResearchJobStatus;
  searchMethodUsed: 'google_search_grounding' | 'direct_public_feed' | 'hybrid' | 'unavailable';
  errorMessage?: string;
  logs: ResearchJobLogEntry[];
  resultIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface ResearchStatistics {
  totalJobs: number;
  completedJobs: number;
  totalMaterialsFound: number;
  processedSourcesCount: number;
  enabledSourcesCount: number;
  availableSourcesCount: number;
  originalIdeasCount: number;
  awaitingReviewCount: number;
  approvedForDatabaseCount: number;
  rejectedCount: number;
  duplicatesDetectedCount: number;
  debateCount: number;
  romanticCount: number;
  debateApprovedCount: number;
  romanticApprovedCount: number;
  averageResearchQuality: number;
}

/* ============================================================================
   STAGE 3: STORY GENERATOR + MELO_LOVE VOICE ENGINE TYPES
   ============================================================================ */

export type VoicePresetId =
  | 'melo_love_standard'
  | 'more_ironic'
  | 'more_emotional'
  | 'calm_conversational'
  | 'author_experiment'
  | string;

export type SentenceLengthMode = 'short' | 'mixed' | 'free';

export type ContentLengthPreset = 'short' | 'standard' | 'expanded' | 'longread';

export type ContentDraftStatus =
  | 'generating'
  | 'draft'
  | 'needs_revision'
  | 'ready_for_review'
  | 'approved'
  | 'rejected'
  | 'archived';

export type NarrativeStructurePattern =
  | 'action_start'
  | 'detail_start'
  | 'dialogue_start'
  | 'emotion_start'
  | 'contradiction_start'
  | 'observer_start'
  | 'outcome_first'
  | 'gradual_reveal';

export type PhrasebookTone =
  | 'ironic'
  | 'intrigued'
  | 'skeptical'
  | 'warm'
  | 'observational'
  | 'neutral';

export interface VoiceSliders {
  irony: number; // 0-10
  conversational: number; // 0-10
  emotionality: number; // 0-10
  provocativeness: number; // 0-10
  phraseDensity: number; // 0-10
  sentenceLength: SentenceLengthMode;
  dramaLevel: number; // 0-10
}

export interface VoiceProfileSettings extends VoiceSliders {
  id: VoicePresetId;
  name: string;
  description: string;
  collectionHint?: CollectionType | 'both';
  isCustom: boolean;
}

export interface VoiceEngineConfig {
  debateProfileId: VoicePresetId;
  romanticProfileId: VoicePresetId;
  rubricSettings: {
    debate: VoiceSliders;
    romantic: VoiceSliders;
  };
  profiles: VoiceProfileSettings[];
  updatedAt: string;
}

export interface PhrasebookEntry {
  id: string;
  phrase: string;
  collections: CollectionType[];
  tone: PhrasebookTone;
  maxFrequencyPer10: number;
  weight: number; // 1-10 priority
  banned: boolean;
  usageCount: number;
  recentUsageCount: number; // count in last 10 publications
  isOverused: boolean;
  isCustom: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentQualityChecks {
  hasMeaninglessRepetition: boolean;
  soundsLikeAiTemplate: boolean;
  artificialColloquialism: boolean;
  phraseOveruse: boolean;
  contradictsSource: boolean;
  lostImportantDetail: boolean;
  artificialEnding: boolean;
  unsubstantiatedClaims: boolean;
  verbatimCopy: boolean;
}

export interface ContentQualityBreakdown {
  hookStrength: number; // max 15
  languageNaturalness: number; // max 15
  emotionalImpact: number; // max 15
  plotDepth: number; // max 15
  narrativeUniqueness: number; // max 15
  voiceRecognition: number; // max 10
  endingQuality: number; // max 10
  sourceFidelity: number; // max 5
  overall: number; // 0-100 sum
  tierLabel: string;
  checks: ContentQualityChecks;
  warnings: string[];
  editorialNotes: string;
}

export interface ContentRevisionSnapshot {
  versionId: string;
  versionNumber: number;
  createdAt: string;
  actionLabel: string;
  title: string;
  alternativeTitles: string[];
  excerpt: string;
  body: string;
  mainTriggerQuestion: string;
  voiceProfile: VoicePresetId;
  voiceSettings: VoiceSliders;
  narrativeStructure: NarrativeStructurePattern;
  lengthPreset: ContentLengthPreset;
  qualityScore: number;
  qualityBreakdown: ContentQualityBreakdown;
  editorialNotes: string;
}

export interface ContentDraft {
  id: string; // ML-P-D-000001 | ML-P-R-000001
  sourceStoryId: string;
  collection: CollectionType;
  category: string;
  subcategory: string;
  title: string;
  alternativeTitles: string[];
  excerpt: string;
  body: string;
  mainTriggerQuestion: string;
  voiceProfile: VoicePresetId;
  voiceSettings: VoiceSliders;
  narrativeStructure: NarrativeStructurePattern;
  contentLength: number; // word count
  lengthPreset: ContentLengthPreset;
  qualityScore: number;
  qualityBreakdown: ContentQualityBreakdown;
  editorialNotes: string;
  generationModel: string;
  generationPromptVersion: string;
  createdAt: string;
  updatedAt: string;
  status: ContentDraftStatus;
  revisionHistory: ContentRevisionSnapshot[];
  // Extra traceability & diversity metadata
  sourceUrl: string;
  researchId?: string;
  sourceOriginType: OriginType;
  keywords: string[];
  usedPhrases: string[];
  openingPattern: string;
  endingPattern: string;
  semanticFingerprint: string;
  variantIndex: number;
  rejectionReason?: string;
}

export type RewriteActionType =
  | 'rewrite_opening'
  | 'rewrite_ending'
  | 'more_ironic'
  | 'more_emotional'
  | 'less_pathos'
  | 'simpler'
  | 'more_natural'
  | 'shorter'
  | 'longer'
  | 'custom';

export interface ContentStatistics {
  approvedStoriesCount: number;
  unusedApprovedStoriesCount: number;
  totalDraftsCount: number;
  draftsInProgressCount: number;
  readyForReviewCount: number;
  needsRevisionCount: number;
  approvedPublicationsCount: number;
  rejectedCount: number;
  averageQualityScore: number;
  debateDraftsCount: number;
  romanticDraftsCount: number;
  debateApprovedStoriesCount: number;
  romanticApprovedStoriesCount: number;
  activePhrasebookCount: number;
  overusedPhrasebookCount: number;
}

