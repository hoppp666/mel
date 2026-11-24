import fs from 'fs';
import path from 'path';
import {
  CollectionType,
  ContentDraft,
  ContentMetrics,
  PhrasebookEntry,
  VoiceConfig,
  VoicePreset,
} from '../src/shared/types.js';
import { atomicWriteJson, DATA_DIR, getDataDir, loadDatabase, saveDatabase } from './storage.js';

export function getContentDraftsPath(): string {
  return path.join(getDataDir(), 'content_drafts.json');
}
export function getContentVoicePath(): string {
  return path.join(getDataDir(), 'content_voice_config.json');
}
export function getContentPhrasebookPath(): string {
  return path.join(getDataDir(), 'content_phrasebook.json');
}
export function getContentBackupsDir(): string {
  return path.join(getDataDir(), 'content_backups');
}

export const CONTENT_DRAFTS_PATH = path.join(DATA_DIR, 'content_drafts.json');
export const CONTENT_VOICE_PATH = path.join(DATA_DIR, 'content_voice_config.json');
export const CONTENT_PHRASEBOOK_PATH = path.join(DATA_DIR, 'content_phrasebook.json');
export const CONTENT_BACKUPS_DIR = path.join(DATA_DIR, 'content_backups');

export const SYSTEM_VOICE_PRESETS: VoicePreset[] = [
  {
    id: 'melo-standard',
    name: 'Стандартный MELO_LOVE',
    description: 'Наблюдательный живой голос: баланс эмпатии, жизненной детали и ясного ритма без менторства.',
    isSystem: true,
    debate: {
      irony: 45,
      conversational: 70,
      emotionality: 65,
      provocativeness: 60,
      phraseDensity: 40,
      sentenceLength: 55,
      dramaLevel: 55,
    },
    romantic: {
      irony: 20,
      conversational: 65,
      emotionality: 80,
      provocativeness: 20,
      phraseDensity: 35,
      sentenceLength: 50,
      dramaLevel: 45,
    },
  },
  {
    id: 'melo-ironic',
    name: 'Более ироничный',
    description: 'Острее подсвечивает противоречия между словами и поступками, сохраняя уважение к героям.',
    isSystem: true,
    debate: {
      irony: 75,
      conversational: 80,
      emotionality: 50,
      provocativeness: 75,
      phraseDensity: 55,
      sentenceLength: 45,
      dramaLevel: 60,
    },
    romantic: {
      irony: 45,
      conversational: 75,
      emotionality: 65,
      provocativeness: 25,
      phraseDensity: 40,
      sentenceLength: 45,
      dramaLevel: 40,
    },
  },
  {
    id: 'melo-emotional',
    name: 'Более эмоциональный',
    description: 'Глубже фокусируется на внутреннем переживании, паузах и психологическом нерве сцены.',
    isSystem: true,
    debate: {
      irony: 25,
      conversational: 60,
      emotionality: 85,
      provocativeness: 55,
      phraseDensity: 35,
      sentenceLength: 60,
      dramaLevel: 75,
    },
    romantic: {
      irony: 10,
      conversational: 60,
      emotionality: 92,
      provocativeness: 15,
      phraseDensity: 30,
      sentenceLength: 60,
      dramaLevel: 65,
    },
  },
  {
    id: 'melo-calm',
    name: 'Спокойный разговорный',
    description: 'Неторопливый тон доверительного разговора на кухне без резких перегибов.',
    isSystem: true,
    debate: {
      irony: 30,
      conversational: 85,
      emotionality: 55,
      provocativeness: 45,
      phraseDensity: 30,
      sentenceLength: 60,
      dramaLevel: 40,
    },
    romantic: {
      irony: 15,
      conversational: 85,
      emotionality: 75,
      provocativeness: 10,
      phraseDensity: 25,
      sentenceLength: 55,
      dramaLevel: 35,
    },
  },
  {
    id: 'melo-experimental',
    name: 'Авторский эксперимент',
    description: 'Рваный кинематографичный ритм, короткие сцены, неожиданные акценты на бытовых деталях.',
    isSystem: true,
    debate: {
      irony: 60,
      conversational: 70,
      emotionality: 70,
      provocativeness: 80,
      phraseDensity: 50,
      sentenceLength: 35,
      dramaLevel: 70,
    },
    romantic: {
      irony: 25,
      conversational: 65,
      emotionality: 82,
      provocativeness: 30,
      phraseDensity: 40,
      sentenceLength: 38,
      dramaLevel: 55,
    },
  },
];

const DEFAULT_PHRASEBOOK: PhrasebookEntry[] = [
  {
    id: 'PHR-0001',
    phrase: 'на словах всё звучало складно',
    meaningNote: 'Мягкий контраст между декларацией и бытовой реальностью',
    collectionScope: 'debate',
    toneTag: 'наблюдение',
    weight: 8,
    maxFrequencyPer10: 2,
    banned: false,
    recentUsageCount: 0,
    totalUsageCount: 0,
    createdAt: '2026-11-15T10:00:00.000Z',
  },
  {
    id: 'PHR-0002',
    phrase: 'внутри уже щёлкнула та самая усталость',
    meaningNote: 'Точка накопленного напряжения без мелодрамы',
    collectionScope: 'both',
    toneTag: 'эмоция',
    weight: 7,
    maxFrequencyPer10: 2,
    banned: false,
    recentUsageCount: 0,
    totalUsageCount: 0,
    createdAt: '2026-11-15T10:00:00.000Z',
  },
  {
    id: 'PHR-0003',
    phrase: 'мелочь, мимо которой легко пройти',
    meaningNote: 'Фокус на маленькой говорящей детали',
    collectionScope: 'romantic',
    toneTag: 'деталь',
    weight: 9,
    maxFrequencyPer10: 2,
    banned: false,
    recentUsageCount: 0,
    totalUsageCount: 0,
    createdAt: '2026-11-15T10:00:00.000Z',
  },
  {
    id: 'PHR-0004',
    phrase: 'тут у каждого своя правда и свой счёт',
    meaningNote: 'Переход к аргументации обеих сторон в дискуссии',
    collectionScope: 'debate',
    toneTag: 'баланс',
    weight: 8,
    maxFrequencyPer10: 2,
    banned: false,
    recentUsageCount: 0,
    totalUsageCount: 0,
    createdAt: '2026-11-15T10:00:00.000Z',
  },
  {
    id: 'PHR-0005',
    phrase: 'без громких обещаний и лишних свидетелей',
    meaningNote: 'Характеристика тихой взрослой заботы',
    collectionScope: 'romantic',
    toneTag: 'теплота',
    weight: 9,
    maxFrequencyPer10: 2,
    banned: false,
    recentUsageCount: 0,
    totalUsageCount: 0,
    createdAt: '2026-11-15T10:00:00.000Z',
  },
  {
    id: 'PHR-0006',
    phrase: 'самое неприятное началось уже потом',
    meaningNote: 'Поворот от бытового эпизода к его последствиям',
    collectionScope: 'debate',
    toneTag: 'динамика',
    weight: 7,
    maxFrequencyPer10: 2,
    banned: false,
    recentUsageCount: 0,
    totalUsageCount: 0,
    createdAt: '2026-11-15T10:00:00.000Z',
  },
  {
    id: 'PHR-0007',
    phrase: 'в такие вечера дом проверяется на прочность',
    meaningNote: 'Наблюдение про совместный быт и поддержку',
    collectionScope: 'both',
    toneTag: 'атмосфера',
    weight: 8,
    maxFrequencyPer10: 1,
    banned: false,
    recentUsageCount: 0,
    totalUsageCount: 0,
    createdAt: '2026-11-15T10:00:00.000Z',
  },
  {
    id: 'PHR-0008',
    phrase: 'казалось бы, сущая ерунда',
    meaningNote: 'Снижение пафоса перед важной деталью',
    collectionScope: 'both',
    toneTag: 'разговорный',
    weight: 7,
    maxFrequencyPer10: 2,
    banned: false,
    recentUsageCount: 0,
    totalUsageCount: 0,
    createdAt: '2026-11-15T10:00:00.000Z',
  },
  {
    id: 'PHR-0009',
    phrase: 'именно в эту секунду стало всё понятно',
    meaningNote: 'Фиксация тихого инсайта героя',
    collectionScope: 'romantic',
    toneTag: 'поворот',
    weight: 7,
    maxFrequencyPer10: 1,
    banned: false,
    recentUsageCount: 0,
    totalUsageCount: 0,
    createdAt: '2026-11-15T10:00:00.000Z',
  },
  {
    id: 'PHR-0010',
    phrase: 'спорить здесь можно долго, но факт остаётся фактом',
    meaningNote: 'Подводка к триггерному вопросу в финале',
    collectionScope: 'debate',
    toneTag: 'финал',
    weight: 6,
    maxFrequencyPer10: 2,
    banned: false,
    recentUsageCount: 0,
    totalUsageCount: 0,
    createdAt: '2026-11-15T10:00:00.000Z',
  },
];

export function ensureContentDirs(): void {
  fs.mkdirSync(getDataDir(), { recursive: true });
  fs.mkdirSync(getContentBackupsDir(), { recursive: true });
}

export function loadContentDrafts(): ContentDraft[] {
  ensureContentDirs();
  const draftsPath = getContentDraftsPath();
  if (!fs.existsSync(draftsPath)) {
    atomicWriteJson(draftsPath, []);
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(draftsPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveContentDrafts(drafts: ContentDraft[]): void {
  ensureContentDirs();
  atomicWriteJson(getContentDraftsPath(), drafts);
  recalculatePhrasebookCounts(drafts);
}

export function loadVoiceConfig(): VoiceConfig {
  ensureContentDirs();
  const voicePath = getContentVoicePath();
  if (!fs.existsSync(voicePath)) {
    const standard = SYSTEM_VOICE_PRESETS[0];
    const initial: VoiceConfig = {
      activePresetId: standard.id,
      debate: { ...standard.debate },
      romantic: { ...standard.romantic },
      customPresets: [],
      minPublishQualityScore: 85,
      updatedAt: new Date().toISOString(),
    };
    atomicWriteJson(voicePath, initial);
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(voicePath, 'utf8')) as VoiceConfig;
  } catch {
    const standard = SYSTEM_VOICE_PRESETS[0];
    return {
      activePresetId: standard.id,
      debate: { ...standard.debate },
      romantic: { ...standard.romantic },
      customPresets: [],
      minPublishQualityScore: 85,
      updatedAt: new Date().toISOString(),
    };
  }
}

export function saveVoiceConfig(config: VoiceConfig): void {
  ensureContentDirs();
  config.updatedAt = new Date().toISOString();
  atomicWriteJson(getContentVoicePath(), config);
}

export function loadPhrasebook(): PhrasebookEntry[] {
  ensureContentDirs();
  const phrasebookPath = getContentPhrasebookPath();
  if (!fs.existsSync(phrasebookPath)) {
    const initial = DEFAULT_PHRASEBOOK.map((p) => ({ ...p }));
    atomicWriteJson(phrasebookPath, initial);
    return initial;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(phrasebookPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePhrasebook(entries: PhrasebookEntry[]): void {
  ensureContentDirs();
  atomicWriteJson(getContentPhrasebookPath(), entries);
}

export function recalculatePhrasebookCounts(drafts?: ContentDraft[]): PhrasebookEntry[] {
  const allDrafts = drafts || loadContentDrafts();
  const activeDrafts = allDrafts.filter((d) => d.status !== 'rejected' && d.status !== 'archived');
  const last10 = activeDrafts.slice(0, 10);
  const phrasebook = loadPhrasebook();

  const updated = phrasebook.map((entry) => {
    const norm = entry.phrase.toLowerCase().replace(/ё/g, 'е').trim();
    const recentUsageCount = last10.filter((d) =>
      `${d.title}\n${d.body}\n${d.triggerQuestion}`
        .toLowerCase()
        .replace(/ё/g, 'е')
        .includes(norm)
    ).length;

    const totalUsageCount = activeDrafts.filter((d) =>
      `${d.title}\n${d.body}\n${d.triggerQuestion}`
        .toLowerCase()
        .replace(/ё/g, 'е')
        .includes(norm)
    ).length;

    return {
      ...entry,
      recentUsageCount,
      totalUsageCount,
    };
  });

  savePhrasebook(updated);
  return updated;
}

export function nextContentId(drafts: ContentDraft[], collection: CollectionType): string {
  const prefix = collection === 'debate' ? 'ML-P-D-' : 'ML-P-R-';
  let maxNum = 0;
  for (const d of drafts) {
    if (d.contentId.startsWith(prefix)) {
      const num = parseInt(d.contentId.slice(prefix.length), 10);
      if (!Number.isNaN(num) && num > maxNum) maxNum = num;
    }
  }
  return `${prefix}${String(maxNum + 1).padStart(6, '0')}`;
}

export function syncStoryUsageStatus(sourceStoryId: string): void {
  const db = loadDatabase();
  const story = db.stories.find((s) => s.id === sourceStoryId);
  if (!story) return;

  // Never alter published or archived statuses on Stage 3
  if (story.usageStatus === 'published' || story.usageStatus === 'archived') return;

  const drafts = loadContentDrafts();
  const hasActiveDraft = drafts.some(
    (d) =>
      d.sourceStoryId === sourceStoryId &&
      d.status !== 'rejected' &&
      d.status !== 'archived'
  );

  const nextStatus = hasActiveDraft ? 'drafted' : 'unused';
  if (story.usageStatus !== nextStatus) {
    story.usageStatus = nextStatus;
    saveDatabase(db);
  }
}

export function recoverInterruptedDrafts(): void {
  loadVoiceConfig();
  loadPhrasebook();
  const drafts = loadContentDrafts();
  let changed = false;
  for (const d of drafts) {
    if (d.status === 'generating') {
      d.status = 'needs_revision';
      d.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) saveContentDrafts(drafts);
}

export function createContentBackup(): { filename: string; createdAt: string; draftCount: number } {
  ensureContentDirs();
  const payload = {
    createdAt: new Date().toISOString(),
    drafts: loadContentDrafts(),
    voiceConfig: loadVoiceConfig(),
    phrasebook: loadPhrasebook(),
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `content_backup_${stamp}.json`;
  const backupsDir = getContentBackupsDir();
  atomicWriteJson(path.join(backupsDir, filename), payload);

  const files = fs
    .readdirSync(backupsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();

  for (const old of files.slice(15)) {
    fs.unlinkSync(path.join(backupsDir, old));
  }

  return {
    filename,
    createdAt: payload.createdAt,
    draftCount: payload.drafts.length,
  };
}

export function computeContentMetrics(): ContentMetrics {
  const db = loadDatabase();
  const drafts = loadContentDrafts();
  const phrasebook = loadPhrasebook();

  const availableStories = db.stories.filter(
    (s) => s.verificationStatus === 'approved' && s.usageStatus === 'unused'
  );

  const activeDrafts = drafts.filter((d) => d.status !== 'archived');
  const avgScore =
    activeDrafts.length > 0
      ? Math.round(
          activeDrafts.reduce((sum, d) => sum + (d.quality?.overall || 0), 0) / activeDrafts.length
        )
      : 0;

  return {
    availableStoriesCount: availableStories.length,
    availableDebateCount: availableStories.filter((s) => s.collection === 'debate').length,
    availableRomanticCount: availableStories.filter((s) => s.collection === 'romantic').length,
    totalDrafts: drafts.length,
    readyForReviewCount: drafts.filter((d) => d.status === 'ready_for_review').length,
    needsRevisionCount: drafts.filter((d) => d.status === 'needs_revision' || d.status === 'draft').length,
    approvedCount: drafts.filter((d) => d.status === 'approved').length,
    averageQualityScore: avgScore,
    activePhrasesCount: phrasebook.filter((p) => !p.banned).length,
    overusedPhrasesCount: phrasebook.filter(
      (p) => !p.banned && p.recentUsageCount >= p.maxFrequencyPer10
    ).length,
  };
}
