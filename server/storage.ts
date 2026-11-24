import fs from 'node:fs';
import path from 'node:path';
import {
  buildSemanticFingerprint,
  calculateOverallQuality,
  findSimilarStories,
} from '../src/shared/similarity.ts';
import type {
  AppSettings,
  BatchRecord,
  CollectionType,
  DatabaseState,
  DatabaseStats,
  StoryPlot,
} from '../src/shared/types.ts';
import { INITIAL_DEBATE_STORIES } from './seedDebate.ts';
import { INITIAL_ROMANTIC_STORIES } from './seedRomantic.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'melo_love_db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

export const DEFAULT_SETTINGS: AppSettings = {
  targetTotalStories: 3000,
  targetDebateStories: 1500,
  targetRomanticStories: 1500,
  defaultBatchSize: 25,
  similarityThreshold: 38,
  minimumApprovalScore: 72,
  storageMode: 'local_disk',
  supabaseConfigured: false,
};

function ensureDirectories() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function createInitialState(): DatabaseState {
  const initialStories: StoryPlot[] = [
    ...INITIAL_DEBATE_STORIES,
    ...INITIAL_ROMANTIC_STORIES,
  ];

  // Re-evaluate similarity cross-checks across the initial 50 plots
  for (let i = 0; i < initialStories.length; i++) {
    const others = initialStories.filter((_, idx) => idx !== i);
    const matches = findSimilarStories(
      initialStories[i],
      others,
      DEFAULT_SETTINGS.similarityThreshold
    );
    initialStories[i].similarityMatches = matches;
    initialStories[i].duplicateFlag = matches.length > 0;
  }

  const initialBatches: BatchRecord[] = [
    {
      batchNumber: 1,
      collection: 'debate',
      targetCategory: 'Сбалансированный подбор (25 категорий)',
      requestedCount: 25,
      generatedCount: 25,
      acceptedCount: 22,
      flaggedDuplicatesCount: 0,
      rejectedCount: 0,
      researchMode: 'original',
      createdAt: '2026-11-20T09:00:00.000Z',
      notes: 'Стартовая редакционная партия #1 (Коллекция A «Кто здесь прав?»): 25 уникальных сюжетов, 22 подтверждены, 2 ожидают финального подтверждения, 1 на доработке.',
    },
    {
      batchNumber: 31,
      collection: 'romantic',
      targetCategory: 'Сбалансированный подбор (25 категорий)',
      requestedCount: 25,
      generatedCount: 25,
      acceptedCount: 23,
      flaggedDuplicatesCount: 0,
      rejectedCount: 0,
      researchMode: 'original',
      createdAt: '2026-11-20T09:15:00.000Z',
      notes: 'Стартовая редакционная партия #31 (Коллекция B «Романтические истории»): 25 уникальных жизненных сцен, 23 подтверждены, 2 ожидают финального подтверждения.',
    },
  ];

  return {
    version: 1,
    lastUpdated: new Date().toISOString(),
    stories: initialStories,
    batches: initialBatches,
    customCategories: {
      debate: [],
      romantic: [],
    },
    settings: { ...DEFAULT_SETTINGS },
  };
}

export function loadDatabase(): DatabaseState {
  ensureDirectories();
  if (!fs.existsSync(DB_FILE)) {
    const initial = createInitialState();
    saveDatabase(initial);
    return initial;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as DatabaseState;
    if (!Array.isArray(parsed.stories)) {
      throw new Error('Corrupted database structure');
    }
    return {
      version: parsed.version ?? 1,
      lastUpdated: parsed.lastUpdated ?? new Date().toISOString(),
      stories: parsed.stories,
      batches: Array.isArray(parsed.batches) ? parsed.batches : [],
      customCategories: parsed.customCategories ?? { debate: [], romantic: [] },
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
    };
  } catch (err) {
    console.error('Failed to read database, re-initializing from backup or seed:', err);
    const initial = createInitialState();
    saveDatabase(initial);
    return initial;
  }
}

export function saveDatabase(state: DatabaseState): void {
  ensureDirectories();
  state.lastUpdated = new Date().toISOString();
  const tempFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tempFile, DB_FILE);
}

export function createBackupSnapshot(state: DatabaseState): string {
  ensureDirectories();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `melo_love_backup_${stamp}.json`;
  const target = path.join(BACKUP_DIR, filename);
  fs.writeFileSync(target, JSON.stringify(state, null, 2), 'utf-8');

  // Keep latest 15 snapshots
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('melo_love_backup_') && f.endsWith('.json'))
    .sort()
    .reverse();
  for (const old of files.slice(15)) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, old));
    } catch {
      // ignore cleanup error
    }
  }
  return filename;
}

export function listBackupSnapshots(): Array<{ filename: string; sizeBytes: number; createdAt: string }> {
  ensureDirectories();
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();
  return files.map((filename) => {
    const stat = fs.statSync(path.join(BACKUP_DIR, filename));
    return {
      filename,
      sizeBytes: stat.size,
      createdAt: stat.mtime.toISOString(),
    };
  });
}

export function computeDatabaseStats(state: DatabaseState): DatabaseStats {
  const stories = state.stories;
  const total = stories.length;
  const debateTotal = stories.filter((s) => s.collection === 'debate' && s.verificationStatus !== 'rejected').length;
  const romanticTotal = stories.filter((s) => s.collection === 'romantic' && s.verificationStatus !== 'rejected').length;
  const approved = stories.filter((s) => s.verificationStatus === 'approved').length;
  const pending = stories.filter((s) => s.verificationStatus === 'pending').length;
  const needsRevision = stories.filter((s) => s.verificationStatus === 'needs_revision').length;
  const rejected = stories.filter((s) => s.verificationStatus === 'rejected').length;
  const duplicatesDetected = stories.filter((s) => s.duplicateFlag || (s.similarityMatches && s.similarityMatches.length > 0)).length;
  const externalOriginCount = stories.filter((s) => s.originType === 'external').length;
  const originalOriginCount = stories.filter((s) => s.originType === 'original').length;

  const activeStories = stories.filter((s) => s.verificationStatus !== 'rejected');
  const averageQuality =
    activeStories.length > 0
      ? Math.round(
          activeStories.reduce((acc, s) => acc + (s.quality?.overall ?? 0), 0) / activeStories.length
        )
      : 0;

  const targetTotal = state.settings.targetTotalStories || 3000;
  const targetDebate = state.settings.targetDebateStories || 1500;
  const targetRomantic = state.settings.targetRomanticStories || 1500;

  return {
    total,
    debateTotal,
    romanticTotal,
    approved,
    pending,
    needsRevision,
    rejected,
    duplicatesDetected,
    externalOriginCount,
    originalOriginCount,
    averageQuality,
    progressPercent: Math.min(100, Number(((approved / targetTotal) * 100).toFixed(2))),
    debateProgressPercent: Math.min(100, Number(((debateTotal / targetDebate) * 100).toFixed(2))),
    romanticProgressPercent: Math.min(100, Number(((romanticTotal / targetRomantic) * 100).toFixed(2))),
  };
}

export function generateNextStoryId(stories: StoryPlot[], collection: CollectionType): string {
  const prefix = collection === 'debate' ? 'ML-D-' : 'ML-R-';
  let maxNum = 0;
  for (const s of stories) {
    if (s.id.startsWith(prefix)) {
      const n = Number.parseInt(s.id.slice(prefix.length), 10);
      if (!Number.isNaN(n) && n > maxNum) {
        maxNum = n;
      }
    }
  }
  return `${prefix}${String(maxNum + 1).padStart(4, '0')}`;
}

export function generateNextBatchNumber(state: DatabaseState, collection: CollectionType): number {
  const existing = state.batches
    .filter((b) => b.collection === collection)
    .map((b) => b.batchNumber);
  if (collection === 'debate') {
    return existing.length === 0 ? 1 : Math.max(...existing) + 1;
  }
  return existing.length === 0 ? 31 : Math.max(...existing) + 1;
}

export function normalizeAndScoreStory(
  raw: Partial<StoryPlot>,
  existingStories: StoryPlot[],
  similarityThreshold: number
): StoryPlot {
  const collection: CollectionType = raw.collection === 'romantic' ? 'romantic' : 'debate';
  const qualityInput = raw.quality || {
    overall: 75,
    originality: 75,
    realism: 75,
    emotionalExpressiveness: 75,
    interest: 75,
    discussionPotential: 75,
    specificity: 75,
    plotVariability: 75,
    editorialNote: 'Автоматическая первичная оценка',
  };
  const overall = calculateOverallQuality(qualityInput, collection);

  const normalized: StoryPlot = {
    id: raw.id || generateNextStoryId(existingStories, collection),
    collection,
    category: raw.category || (collection === 'debate' ? 'Бытовые привычки' : 'Маленькие проявления любви'),
    subcategory: raw.subcategory || 'Общая жизненная сцена',
    title: raw.title || 'Без названия',
    shortDescription: raw.shortDescription || '',
    fullPlot: raw.fullPlot || '',
    participants: raw.participants || '',
    setting: raw.setting || '',
    coreConflictOrAction: raw.coreConflictOrAction || '',
    sideAPosition: raw.sideAPosition || '',
    sideBPosition: raw.sideBPosition || '',
    emotionalMechanism: raw.emotionalMechanism || '',
    hiddenExpectation: raw.hiddenExpectation || '',
    unexpectedNuance: raw.unexpectedNuance || '',
    possibleTwist: raw.possibleTwist || '',
    mainTriggerQuestion: raw.mainTriggerQuestion || '',
    additionalQuestions: Array.isArray(raw.additionalQuestions) ? raw.additionalQuestions : [],
    keywords: Array.isArray(raw.keywords) ? raw.keywords : [],
    ideaSource:
      raw.originType === 'external' && raw.sourceUrl
        ? raw.ideaSource || 'Внешний источник'
        : raw.ideaSource || 'Оригинальная редакционная разработка (без внешнего URL)',
    sourceUrl: raw.originType === 'external' ? raw.sourceUrl || '' : '',
    originType: raw.originType === 'external' && raw.sourceUrl ? 'external' : 'original',
    createdAt: raw.createdAt || new Date().toISOString(),
    verificationStatus: raw.verificationStatus || 'pending',
    usageStatus: raw.usageStatus || 'unused',
    semanticFingerprint: '',
    mainTheme: raw.mainTheme || raw.category || '',
    plotMechanic: raw.plotMechanic || 'Неожиданный конфликт ценностей',
    uniqueDetails: raw.uniqueDetails || '',
    sourceAnalysisNote: raw.sourceAnalysisNote || '',
    researchId: raw.researchId,
    researchNotes: raw.researchNotes,
    batchNumber: raw.batchNumber || 1,
    quality: {
      ...qualityInput,
      overall,
    },
    updatedAt: new Date().toISOString(),
  };

  normalized.semanticFingerprint = buildSemanticFingerprint(normalized);
  const matches = findSimilarStories(normalized, existingStories, similarityThreshold);
  normalized.similarityMatches = matches;
  normalized.duplicateFlag = matches.length > 0;

  return normalized;
}
