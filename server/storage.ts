import fs from 'fs';
import path from 'path';
import {
  AppSettings,
  BackupEntry,
  CollectionType,
  DatabaseFile,
  DatabaseSnapshotResponse,
  DatabaseStats,
  PendingBatch,
  StoryPlot,
} from '../src/shared/types.js';
import {
  buildSemanticFingerprint,
  calculateQualityScore,
  findSimilarStories,
} from '../src/shared/similarity.js';
import { buildDebateSeeds } from './seedDebate.js';
import { buildRomanticSeeds } from './seedRomantic.js';

export const DATA_DIR = path.resolve(process.cwd(), 'data');
export const DB_PATH = path.join(DATA_DIR, 'melo_love_db.json');
export const PENDING_BATCH_PATH = path.join(DATA_DIR, 'pending_batch.json');
export const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

const DEFAULT_SETTINGS: AppSettings = {
  targetTotal: 3000,
  targetDebate: 1500,
  targetRomantic: 1500,
  similarityThreshold: 38,
  minQualityScore: 78,
  defaultBatchSize: 25,
};

export function ensureDataDirs(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

export function atomicWriteJson(filePath: string, payload: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

export function normalizeAndScoreStory(
  raw: Partial<StoryPlot>,
  existingStories: StoryPlot[],
  threshold = 38
): StoryPlot {
  const collection: CollectionType = raw.collection === 'romantic' ? 'romantic' : 'debate';
  const quality =
    raw.quality && typeof raw.quality.overall === 'number'
      ? raw.quality
      : calculateQualityScore(collection);

  const normalized: StoryPlot = {
    id: raw.id || '',
    collection,
    category: (raw.category || 'Разные взгляды на жизнь').trim(),
    subcategory: (raw.subcategory || 'Жизненная сцена').trim(),
    title: (raw.title || 'Без названия').trim(),
    shortDescription: (raw.shortDescription || '').trim(),
    fullPlot: (raw.fullPlot || '').trim(),
    participants: (raw.participants || 'Партнёры').trim(),
    setting: (raw.setting || 'Бытовая обстановка').trim(),
    coreConflictOrAction: (raw.coreConflictOrAction || '').trim(),
    sideAPosition: (raw.sideAPosition || '').trim(),
    sideBPosition: (raw.sideBPosition || '').trim(),
    emotionalMechanism: (raw.emotionalMechanism || '').trim(),
    hiddenExpectation: (raw.hiddenExpectation || '').trim(),
    unexpectedNuance: (raw.unexpectedNuance || '').trim(),
    possibleTwist: (raw.possibleTwist || '').trim(),
    mainTriggerQuestion: (raw.mainTriggerQuestion || '').trim(),
    additionalQuestions: Array.isArray(raw.additionalQuestions)
      ? raw.additionalQuestions.map((q) => String(q).trim()).filter(Boolean)
      : [],
    keywords: Array.isArray(raw.keywords)
      ? raw.keywords.map((k) => String(k).trim()).filter(Boolean)
      : [],
    ideaSource: (raw.ideaSource || 'Редакционная база MELO_LOVE').trim(),
    sourceUrl: (raw.sourceUrl || '').trim(),
    originType: raw.originType === 'external' ? 'external' : 'original',
    createdAt: raw.createdAt || new Date().toISOString(),
    verificationStatus: raw.verificationStatus || 'pending',
    usageStatus: raw.usageStatus || 'unused',
    semanticFingerprint: '',
    mainTheme: (raw.mainTheme || raw.title || '').trim(),
    plotMechanic: (raw.plotMechanic || 'Неожиданный конфликт ценностей').trim(),
    uniqueDetails: (raw.uniqueDetails || raw.unexpectedNuance || '').trim(),
    sourceAnalysisNote: (raw.sourceAnalysisNote || '').trim(),
    batchNumber: typeof raw.batchNumber === 'number' ? raw.batchNumber : 1,
    researchId: raw.researchId ? String(raw.researchId).trim() : undefined,
    researchNotes: raw.researchNotes ? String(raw.researchNotes).trim() : undefined,
    quality,
    similarityMatches: [],
    duplicateFlag: false,
  };

  normalized.semanticFingerprint = buildSemanticFingerprint(normalized);
  const matches = findSimilarStories(normalized, existingStories, threshold, normalized.id);
  normalized.similarityMatches = matches;
  normalized.duplicateFlag = matches.length > 0;
  return normalized;
}

function createInitialDatabase(): DatabaseFile {
  const debateSeeds = buildDebateSeeds();
  const romanticSeeds = buildRomanticSeeds();
  const allStories: StoryPlot[] = [];

  for (const s of [...debateSeeds, ...romanticSeeds]) {
    allStories.push(normalizeAndScoreStory(s, allStories, DEFAULT_SETTINGS.similarityThreshold));
  }

  return {
    version: '1.0.0',
    updatedAt: new Date().toISOString(),
    stories: allStories,
    batches: [
      {
        batchNumber: 1,
        collection: 'debate',
        categoryFocus: 'Стартовый сбалансированный набор',
        searchMode: 'original',
        requestedCount: 25,
        generatedCount: 25,
        approvedCount: 23,
        rejectedCount: 0,
        createdAt: '2026-11-10T10:00:00.000Z',
        committedAt: '2026-11-10T12:00:00.000Z',
        note: 'Стартовые 25 дискуссионных сюжетных основ',
      },
      {
        batchNumber: 31,
        collection: 'romantic',
        categoryFocus: 'Стартовый сбалансированный набор',
        searchMode: 'original',
        requestedCount: 25,
        generatedCount: 25,
        approvedCount: 23,
        rejectedCount: 0,
        createdAt: '2026-11-11T10:00:00.000Z',
        committedAt: '2026-11-11T12:00:00.000Z',
        note: 'Стартовые 25 романтических сюжетных основ',
      },
    ],
    customCategories: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

export function loadDatabase(): DatabaseFile {
  ensureDataDirs();
  if (!fs.existsSync(DB_PATH)) {
    const initial = createInitialDatabase();
    atomicWriteJson(DB_PATH, initial);
    return initial;
  }
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const parsed = JSON.parse(raw) as DatabaseFile;
  return {
    version: parsed.version || '1.0.0',
    updatedAt: parsed.updatedAt || new Date().toISOString(),
    stories: Array.isArray(parsed.stories) ? parsed.stories : [],
    batches: Array.isArray(parsed.batches) ? parsed.batches : [],
    customCategories: Array.isArray(parsed.customCategories) ? parsed.customCategories : [],
    settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
  };
}

export function saveDatabase(db: DatabaseFile): void {
  ensureDataDirs();
  db.updatedAt = new Date().toISOString();
  atomicWriteJson(DB_PATH, db);
}

export function createBackupSnapshot(db?: DatabaseFile): BackupEntry {
  ensureDataDirs();
  const data = db || loadDatabase();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `melo_love_backup_${stamp}.json`;
  const target = path.join(BACKUPS_DIR, filename);
  atomicWriteJson(target, data);

  // Rotate to max 15 backups
  const files = fs
    .readdirSync(BACKUPS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();

  for (const old of files.slice(15)) {
    fs.unlinkSync(path.join(BACKUPS_DIR, old));
  }

  const stat = fs.statSync(target);
  return {
    filename,
    createdAt: new Date().toISOString(),
    sizeBytes: stat.size,
    storyCount: data.stories.length,
  };
}

export function listBackups(): BackupEntry[] {
  ensureDataDirs();
  const files = fs
    .readdirSync(BACKUPS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();

  return files.map((filename) => {
    const full = path.join(BACKUPS_DIR, filename);
    const stat = fs.statSync(full);
    let storyCount = 0;
    try {
      const parsed = JSON.parse(fs.readFileSync(full, 'utf8')) as Partial<DatabaseFile>;
      storyCount = Array.isArray(parsed.stories) ? parsed.stories.length : 0;
    } catch {
      storyCount = 0;
    }
    return {
      filename,
      createdAt: stat.mtime.toISOString(),
      sizeBytes: stat.size,
      storyCount,
    };
  });
}

export function restoreBackup(filename: string): DatabaseFile {
  ensureDataDirs();
  const safeName = path.basename(filename);
  const full = path.join(BACKUPS_DIR, safeName);
  if (!fs.existsSync(full)) {
    throw new Error(`Снимок ${safeName} не найден`);
  }
  const current = loadDatabase();
  createBackupSnapshot(current);
  const restored = JSON.parse(fs.readFileSync(full, 'utf8')) as DatabaseFile;
  saveDatabase(restored);
  return restored;
}

export function loadPendingBatch(): PendingBatch | null {
  ensureDataDirs();
  if (!fs.existsSync(PENDING_BATCH_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(PENDING_BATCH_PATH, 'utf8')) as PendingBatch;
  } catch {
    return null;
  }
}

export function savePendingBatch(batch: PendingBatch | null): void {
  ensureDataDirs();
  if (!batch) {
    if (fs.existsSync(PENDING_BATCH_PATH)) {
      fs.unlinkSync(PENDING_BATCH_PATH);
    }
    return;
  }
  atomicWriteJson(PENDING_BATCH_PATH, batch);
}

export function nextStoryId(stories: StoryPlot[], collection: CollectionType): string {
  const prefix = collection === 'debate' ? 'ML-D-' : 'ML-R-';
  let maxNum = 0;
  for (const s of stories) {
    if (s.id.startsWith(prefix)) {
      const num = parseInt(s.id.slice(prefix.length), 10);
      if (!Number.isNaN(num) && num > maxNum) maxNum = num;
    }
  }
  return `${prefix}${String(maxNum + 1).padStart(4, '0')}`;
}

export function nextBatchNumber(db: DatabaseFile, collection: CollectionType): number {
  const baseStart = collection === 'debate' ? 1 : 31;
  const relevant = db.batches
    .filter((b) => b.collection === collection)
    .map((b) => b.batchNumber);
  if (relevant.length === 0) return baseStart;
  return Math.max(...relevant, baseStart) + 1;
}

export function computeStats(db: DatabaseFile): DatabaseStats {
  const stories = db.stories;
  const total = stories.length;
  const debateCount = stories.filter((s) => s.collection === 'debate').length;
  const romanticCount = stories.filter((s) => s.collection === 'romantic').length;
  const approvedCount = stories.filter((s) => s.verificationStatus === 'approved').length;
  const pendingCount = stories.filter((s) => s.verificationStatus === 'pending').length;
  const needsRevisionCount = stories.filter((s) => s.verificationStatus === 'needs_revision').length;
  const rejectedCount = stories.filter((s) => s.verificationStatus === 'rejected').length;
  const unusedCount = stories.filter((s) => s.usageStatus === 'unused').length;
  const draftedCount = stories.filter((s) => s.usageStatus === 'drafted').length;
  const publishedCount = stories.filter((s) => s.usageStatus === 'published').length;
  const archivedCount = stories.filter((s) => s.usageStatus === 'archived').length;
  const duplicatesCount = stories.filter((s) => s.duplicateFlag).length;
  const externalCount = stories.filter((s) => s.originType === 'external').length;
  const originalCount = stories.filter((s) => s.originType === 'original').length;

  const avgQuality =
    total > 0
      ? Math.round(stories.reduce((sum, s) => sum + (s.quality?.overall || 0), 0) / total)
      : 0;

  const target = db.settings.targetTotal || 3000;
  const progressPercent = Math.min(100, Math.round((approvedCount / target) * 1000) / 10);

  return {
    total,
    debateCount,
    romanticCount,
    approvedCount,
    pendingCount,
    needsRevisionCount,
    rejectedCount,
    unusedCount,
    draftedCount,
    publishedCount,
    archivedCount,
    duplicatesCount,
    externalCount,
    originalCount,
    averageQuality: avgQuality,
    progressPercent,
  };
}

export function buildSnapshotResponse(): DatabaseSnapshotResponse {
  const database = loadDatabase();
  return {
    database,
    stats: computeStats(database),
    pendingBatch: loadPendingBatch(),
    backups: listBackups(),
    storageMode: 'local_disk',
  };
}
