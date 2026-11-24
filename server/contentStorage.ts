import fs from 'node:fs';
import path from 'node:path';
import {
  buildContentSemanticFingerprint,
  countWords,
  detectUsedPhrasebookEntries,
} from '../src/shared/contentUtils.ts';
import type {
  CollectionType,
  ContentDraft,
  ContentStatistics,
  PhrasebookEntry,
  PhrasebookTone,
  StoryPlot,
  VoiceEngineConfig,
  VoiceProfileSettings,
} from '../src/shared/types.ts';
import { loadDatabase, saveDatabase } from './storage.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DRAFTS_FILE = path.join(DATA_DIR, 'content_drafts.json');
const VOICE_FILE = path.join(DATA_DIR, 'content_voice_config.json');
const PHRASEBOOK_FILE = path.join(DATA_DIR, 'content_phrasebook.json');
const CONTENT_BACKUP_DIR = path.join(DATA_DIR, 'content_backups');

function ensureContentDirs(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(CONTENT_BACKUP_DIR)) {
    fs.mkdirSync(CONTENT_BACKUP_DIR, { recursive: true });
  }
}

function writeJsonAtomic(filePath: string, payload: unknown): void {
  ensureContentDirs();
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

export function createDefaultVoiceProfiles(): VoiceProfileSettings[] {
  return [
    {
      id: 'melo_love_standard',
      name: 'Стандартный MELO_LOVE',
      description:
        'Узнаваемая авторская интонация проекта: живой наблюдательный рассказчик, точные детали и баланс между иронией и теплотой.',
      collectionHint: 'both',
      isCustom: false,
      irony: 6,
      conversational: 9,
      emotionality: 7,
      provocativeness: 6,
      phraseDensity: 5,
      sentenceLength: 'mixed',
      dramaLevel: 5,
    },
    {
      id: 'more_ironic',
      name: 'Более ироничный',
      description:
        'Острая наблюдательность, контраст слов и поступков, лёгкие подколки без грубости — идеально для неоднозначных споров.',
      collectionHint: 'debate',
      isCustom: false,
      irony: 8,
      conversational: 9,
      emotionality: 7,
      provocativeness: 8,
      phraseDensity: 6,
      sentenceLength: 'short',
      dramaLevel: 6,
    },
    {
      id: 'more_emotional',
      name: 'Более эмоциональный',
      description:
        'Высокая теплота, проживание момента через бытовые мелочи, искреннее сопереживание без сентиментальных штампов.',
      collectionHint: 'romantic',
      isCustom: false,
      irony: 3,
      conversational: 8,
      emotionality: 9,
      provocativeness: 2,
      phraseDensity: 4,
      sentenceLength: 'mixed',
      dramaLevel: 5,
    },
    {
      id: 'calm_conversational',
      name: 'Спокойный разговорный',
      description:
        'Неторопливый доверительный тон умного собеседника без резких перепадов и лишней драматизации.',
      collectionHint: 'both',
      isCustom: false,
      irony: 4,
      conversational: 9,
      emotionality: 6,
      provocativeness: 4,
      phraseDensity: 3,
      sentenceLength: 'free',
      dramaLevel: 3,
    },
    {
      id: 'author_experiment',
      name: 'Авторский эксперимент',
      description:
        'Смелые композиционные ходы: старт с финала, короткий ритм, неожиданные авторские замечания на полях.',
      collectionHint: 'both',
      isCustom: false,
      irony: 7,
      conversational: 8,
      emotionality: 8,
      provocativeness: 7,
      phraseDensity: 5,
      sentenceLength: 'free',
      dramaLevel: 7,
    },
  ];
}

export function createDefaultVoiceConfig(): VoiceEngineConfig {
  return {
    debateProfileId: 'melo_love_standard',
    romanticProfileId: 'more_emotional',
    rubricSettings: {
      debate: {
        irony: 8,
        conversational: 9,
        emotionality: 7,
        provocativeness: 8,
        phraseDensity: 5,
        sentenceLength: 'mixed',
        dramaLevel: 6,
      },
      romantic: {
        irony: 3,
        conversational: 8,
        emotionality: 8,
        provocativeness: 2,
        phraseDensity: 4,
        sentenceLength: 'mixed',
        dramaLevel: 4,
      },
    },
    profiles: createDefaultVoiceProfiles(),
    updatedAt: new Date().toISOString(),
  };
}

export function createInitialPhrasebook(): PhrasebookEntry[] {
  const now = new Date().toISOString();
  const seeds: Array<{
    id: string;
    phrase: string;
    collections: CollectionType[];
    tone: PhrasebookTone;
    maxFrequencyPer10: number;
    weight: number;
    notes: string;
  }> = [
    {
      id: 'pb-01',
      phrase: 'И вот тут начинается самое интересное.',
      collections: ['debate', 'romantic'],
      tone: 'intrigued',
      maxFrequencyPer10: 2,
      weight: 8,
      notes: 'Подходит для перелома перед раскрытием неожиданного нюанса.',
    },
    {
      id: 'pb-02',
      phrase: 'А теперь внимание.',
      collections: ['debate'],
      tone: 'ironic',
      maxFrequencyPer10: 2,
      weight: 7,
      notes: 'Акцент на детали, меняющей расклад сторон.',
    },
    {
      id: 'pb-03',
      phrase: 'Красиво звучит, но есть нюанс.',
      collections: ['debate'],
      tone: 'skeptical',
      maxFrequencyPer10: 2,
      weight: 8,
      notes: 'Контраст между декларируемыми словами и реальностью.',
    },
    {
      id: 'pb-04',
      phrase: 'Любопытная арифметика.',
      collections: ['debate'],
      tone: 'ironic',
      maxFrequencyPer10: 2,
      weight: 7,
      notes: 'Хорошо работает в спорах о бюджете, быте и распределении усилий.',
    },
    {
      id: 'pb-05',
      phrase: 'Вот такой романтический сюрприз.',
      collections: ['debate', 'romantic'],
      tone: 'ironic',
      maxFrequencyPer10: 1,
      weight: 6,
      notes: 'Использовать аккуратно — уместно для неловкой или двойственной сцены.',
    },
    {
      id: 'pb-06',
      phrase: 'И вроде мелочь, а осадочек остался.',
      collections: ['debate'],
      tone: 'observational',
      maxFrequencyPer10: 2,
      weight: 8,
      notes: 'Для бытовых ситуаций, где проблема кроется не в сумме, а в жесте.',
    },
    {
      id: 'pb-07',
      phrase: 'Не всё так однозначно.',
      collections: ['debate'],
      tone: 'neutral',
      maxFrequencyPer10: 2,
      weight: 6,
      notes: 'Мягкий разворот к позиции второй стороны.',
    },
    {
      id: 'pb-08',
      phrase: 'Тут уже каждый сам себе судья.',
      collections: ['debate'],
      tone: 'neutral',
      maxFrequencyPer10: 2,
      weight: 7,
      notes: 'Фиксация открытого финала без навязанного приговора.',
    },
    {
      id: 'pb-09',
      phrase: 'Вроде договорились, но жизнь внесла свои коррективы.',
      collections: ['debate', 'romantic'],
      tone: 'observational',
      maxFrequencyPer10: 2,
      weight: 7,
      notes: 'Для историй, где планы пары проверяются реальным случаем.',
    },
    {
      id: 'pb-10',
      phrase: 'И тут выяснилась одна интересная подробность.',
      collections: ['debate', 'romantic'],
      tone: 'intrigued',
      maxFrequencyPer10: 2,
      weight: 8,
      notes: 'Плавный переход к скрытому ожиданию или твисту.',
    },
  ];

  return seeds.map((s) => ({
    ...s,
    banned: false,
    usageCount: 0,
    recentUsageCount: 0,
    isOverused: false,
    isCustom: false,
    createdAt: now,
    updatedAt: now,
  }));
}

export function loadVoiceConfig(): VoiceEngineConfig {
  ensureContentDirs();
  if (!fs.existsSync(VOICE_FILE)) {
    const def = createDefaultVoiceConfig();
    saveVoiceConfig(def);
    return def;
  }
  try {
    const raw = fs.readFileSync(VOICE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<VoiceEngineConfig>;
    const def = createDefaultVoiceConfig();
    return {
      debateProfileId: parsed.debateProfileId || def.debateProfileId,
      romanticProfileId: parsed.romanticProfileId || def.romanticProfileId,
      rubricSettings: {
        debate: { ...def.rubricSettings.debate, ...(parsed.rubricSettings?.debate || {}) },
        romantic: { ...def.rubricSettings.romantic, ...(parsed.rubricSettings?.romantic || {}) },
      },
      profiles: Array.isArray(parsed.profiles) && parsed.profiles.length > 0 ? parsed.profiles : def.profiles,
      updatedAt: parsed.updatedAt || def.updatedAt,
    };
  } catch {
    const def = createDefaultVoiceConfig();
    saveVoiceConfig(def);
    return def;
  }
}

export function saveVoiceConfig(config: VoiceEngineConfig): void {
  config.updatedAt = new Date().toISOString();
  writeJsonAtomic(VOICE_FILE, config);
}

export function loadPhrasebook(): PhrasebookEntry[] {
  ensureContentDirs();
  if (!fs.existsSync(PHRASEBOOK_FILE)) {
    const init = createInitialPhrasebook();
    savePhrasebook(init);
    return init;
  }
  try {
    const raw = fs.readFileSync(PHRASEBOOK_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PhrasebookEntry[]) : createInitialPhrasebook();
  } catch {
    const init = createInitialPhrasebook();
    savePhrasebook(init);
    return init;
  }
}

export function savePhrasebook(entries: PhrasebookEntry[]): void {
  writeJsonAtomic(PHRASEBOOK_FILE, entries);
}

export function recomputePhrasebookUsage(
  drafts: ContentDraft[],
  phrasebook: PhrasebookEntry[]
): PhrasebookEntry[] {
  const nonRejected = drafts.filter((d) => d.status !== 'rejected');
  const recent10 = nonRejected.slice(0, 10);

  const updated = phrasebook.map((entry) => {
    const norm = entry.phrase.trim().toLowerCase().replace(/[.!?]+$/, '');
    let totalCount = 0;
    let recentCount = 0;
    for (const d of nonRejected) {
      const matched =
        (d.usedPhrases || []).some((p) => p.toLowerCase().includes(norm)) ||
        d.body.toLowerCase().includes(norm);
      if (matched) totalCount++;
    }
    for (const d of recent10) {
      const matched =
        (d.usedPhrases || []).some((p) => p.toLowerCase().includes(norm)) ||
        d.body.toLowerCase().includes(norm);
      if (matched) recentCount++;
    }
    const maxFreq = Math.max(1, entry.maxFrequencyPer10 || 2);
    return {
      ...entry,
      usageCount: totalCount,
      recentUsageCount: recentCount,
      isOverused: recentCount >= maxFreq,
    };
  });

  savePhrasebook(updated);
  return updated;
}

export function loadContentDrafts(): ContentDraft[] {
  ensureContentDirs();
  if (!fs.existsSync(DRAFTS_FILE)) {
    saveContentDrafts([]);
    return [];
  }
  try {
    const raw = fs.readFileSync(DRAFTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ContentDraft[]) : [];
  } catch {
    return [];
  }
}

export function saveContentDrafts(drafts: ContentDraft[]): void {
  writeJsonAtomic(DRAFTS_FILE, drafts);
}

export function recoverInterruptedContentDrafts(): void {
  const drafts = loadContentDrafts();
  let changed = false;
  const now = new Date().toISOString();
  for (const d of drafts) {
    if (d.status === 'generating') {
      d.status = 'needs_revision';
      d.updatedAt = now;
      d.editorialNotes = `${d.editorialNotes ? d.editorialNotes + '\n' : ''}[Восстановлено после перезапуска сервера: генерация была прервана.]`;
      changed = true;
    }
  }
  if (changed) {
    saveContentDrafts(drafts);
  }
}

export function generateNextContentId(drafts: ContentDraft[], collection: CollectionType): string {
  const prefix = collection === 'debate' ? 'ML-P-D-' : 'ML-P-R-';
  let maxNum = 0;
  for (const d of drafts) {
    if (d.id.startsWith(prefix)) {
      const n = Number.parseInt(d.id.slice(prefix.length), 10);
      if (!Number.isNaN(n) && n > maxNum) {
        maxNum = n;
      }
    }
  }
  return `${prefix}${String(maxNum + 1).padStart(6, '0')}`;
}

export function createContentBackupSnapshot(): string {
  ensureContentDirs();
  const payload = {
    createdAt: new Date().toISOString(),
    drafts: loadContentDrafts(),
    voiceConfig: loadVoiceConfig(),
    phrasebook: loadPhrasebook(),
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `content_backup_${stamp}.json`;
  fs.writeFileSync(path.join(CONTENT_BACKUP_DIR, filename), JSON.stringify(payload, null, 2), 'utf-8');

  const files = fs
    .readdirSync(CONTENT_BACKUP_DIR)
    .filter((f) => f.startsWith('content_backup_') && f.endsWith('.json'))
    .sort()
    .reverse();
  for (const old of files.slice(15)) {
    try {
      fs.unlinkSync(path.join(CONTENT_BACKUP_DIR, old));
    } catch {
      // ignore cleanup error
    }
  }
  return filename;
}

export function listContentBackupSnapshots(): Array<{
  filename: string;
  sizeBytes: number;
  createdAt: string;
}> {
  ensureContentDirs();
  return fs
    .readdirSync(CONTENT_BACKUP_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse()
    .map((filename) => {
      const stat = fs.statSync(path.join(CONTENT_BACKUP_DIR, filename));
      return {
        filename,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
      };
    });
}

/**
 * Safely synchronize sourceStory.usageStatus in data/melo_love_db.json.
 * - Marks story 'drafted' when a draft is saved (never forces 'published').
 * - On delete/reject, inspects whether any other non-rejected/non-archived drafts exist first.
 */
export function syncSourceStoryUsageStatus(
  sourceStoryId: string,
  allDrafts: ContentDraft[],
  action: 'draft_saved' | 'draft_removed'
): StoryPlot | null {
  const db = loadDatabase();
  const idx = db.stories.findIndex((s) => s.id === sourceStoryId);
  if (idx === -1) return null;

  const currentStory = db.stories[idx];
  if (currentStory.usageStatus === 'published') {
    return currentStory;
  }

  if (action === 'draft_saved') {
    if (currentStory.usageStatus !== 'drafted') {
      db.stories[idx] = {
        ...currentStory,
        usageStatus: 'drafted',
        updatedAt: new Date().toISOString(),
      };
      saveDatabase(db);
    }
    return db.stories[idx];
  }

  // Only consider resetting to 'unused' if NO remaining active drafts exist for this story
  const remainingActive = allDrafts.filter(
    (d) => d.sourceStoryId === sourceStoryId && d.status !== 'rejected' && d.status !== 'archived'
  );
  if (remainingActive.length === 0 && currentStory.usageStatus === 'drafted') {
    db.stories[idx] = {
      ...currentStory,
      usageStatus: 'unused',
      updatedAt: new Date().toISOString(),
    };
    saveDatabase(db);
  }
  return db.stories[idx];
}

export function enrichDraftDerivedFields(
  draft: ContentDraft,
  phrasebook: PhrasebookEntry[]
): ContentDraft {
  return {
    ...draft,
    contentLength: countWords(draft.body),
    usedPhrases: detectUsedPhrasebookEntries(draft.body, phrasebook),
    semanticFingerprint: buildContentSemanticFingerprint(
      draft.collection,
      draft.category,
      draft.title,
      draft.body,
      draft.keywords || []
    ),
  };
}

export function computeContentStatistics(
  stories: StoryPlot[],
  drafts: ContentDraft[],
  phrasebook: PhrasebookEntry[]
): ContentStatistics {
  const approvedStories = stories.filter((s) => s.verificationStatus === 'approved');
  const unusedApproved = approvedStories.filter((s) => s.usageStatus === 'unused');
  const activeDrafts = drafts.filter((d) => d.status !== 'rejected');

  const averageQualityScore =
    activeDrafts.length > 0
      ? Math.round(
          activeDrafts.reduce((sum, d) => sum + (d.qualityScore || 0), 0) / activeDrafts.length
        )
      : 0;

  return {
    approvedStoriesCount: approvedStories.length,
    unusedApprovedStoriesCount: unusedApproved.length,
    totalDraftsCount: drafts.length,
    draftsInProgressCount: drafts.filter((d) => d.status === 'draft').length,
    readyForReviewCount: drafts.filter((d) => d.status === 'ready_for_review').length,
    needsRevisionCount: drafts.filter((d) => d.status === 'needs_revision').length,
    approvedPublicationsCount: drafts.filter((d) => d.status === 'approved').length,
    rejectedCount: drafts.filter((d) => d.status === 'rejected').length,
    averageQualityScore,
    debateDraftsCount: drafts.filter((d) => d.collection === 'debate').length,
    romanticDraftsCount: drafts.filter((d) => d.collection === 'romantic').length,
    debateApprovedStoriesCount: unusedApproved.filter((s) => s.collection === 'debate').length,
    romanticApprovedStoriesCount: unusedApproved.filter((s) => s.collection === 'romantic').length,
    activePhrasebookCount: phrasebook.filter((p) => !p.banned).length,
    overusedPhrasebookCount: phrasebook.filter((p) => p.isOverused).length,
  };
}
