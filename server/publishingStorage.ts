import fs from 'fs';
import path from 'path';
import {
  CollectionType,
  PublicationItem,
  PublishingAnalytics,
  PublishingLogEntry,
  PublishingQueueStatus,
  PublishingSettings,
  TelegramIntegrationStatus,
} from '../src/shared/types.js';
import { atomicWriteJson, DATA_DIR, loadDatabase, saveDatabase } from './storage.js';
import {
  measurePublicationLength,
  normalizeHashtagsList,
  runEditorialDiagnostics,
  TELEGRAM_SAFE_CHAR_LIMIT,
} from '../src/shared/publishingUtils.js';
import {
  isAiConfigured,
  isGeminiPrimaryConfigured,
  isGigaChatConfigured,
} from './aiClient.js';

export const PUBLICATIONS_PATH = path.join(DATA_DIR, 'publications.json');
export const PUBLISHING_SETTINGS_PATH = path.join(DATA_DIR, 'publishing_settings.json');
export const PUBLISHING_LOGS_PATH = path.join(DATA_DIR, 'publishing_logs.json');
export const PUBLISHING_BACKUPS_DIR = path.join(DATA_DIR, 'publishing_backups');

export function ensurePublishingDirs(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(PUBLISHING_BACKUPS_DIR, { recursive: true });
}

export function loadPublications(): PublicationItem[] {
  ensurePublishingDirs();
  if (!fs.existsSync(PUBLICATIONS_PATH)) {
    atomicWriteJson(PUBLICATIONS_PATH, []);
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(PUBLICATIONS_PATH, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePublications(items: PublicationItem[]): void {
  ensurePublishingDirs();
  atomicWriteJson(PUBLICATIONS_PATH, items);
}

export function loadPublishingSettings(): PublishingSettings {
  ensurePublishingDirs();
  const defaultSettings: PublishingSettings = {
    autoSendEnabled: process.env.TELEGRAM_AUTO_SEND_ENABLED === 'true',
    dryRunMode: process.env.TELEGRAM_AUTO_SEND_ENABLED !== 'true',
    telegramChannelRef: '',
    dzenChannelName: 'MELO_LOVE',
    dzenSyncMode: 'automatic',
    utmSource: 'telegram',
    safeTelegramCharLimit: TELEGRAM_SAFE_CHAR_LIMIT,
    updatedAt: new Date().toISOString(),
  };

  if (!fs.existsSync(PUBLISHING_SETTINGS_PATH)) {
    atomicWriteJson(PUBLISHING_SETTINGS_PATH, defaultSettings);
    return defaultSettings;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(PUBLISHING_SETTINGS_PATH, 'utf8'));
    return { ...defaultSettings, ...parsed, safeTelegramCharLimit: TELEGRAM_SAFE_CHAR_LIMIT };
  } catch {
    return defaultSettings;
  }
}

export function savePublishingSettings(settings: PublishingSettings): void {
  ensurePublishingDirs();
  settings.updatedAt = new Date().toISOString();
  settings.safeTelegramCharLimit = TELEGRAM_SAFE_CHAR_LIMIT;
  atomicWriteJson(PUBLISHING_SETTINGS_PATH, settings);
}

export function loadPublishingLogs(): PublishingLogEntry[] {
  ensurePublishingDirs();
  if (!fs.existsSync(PUBLISHING_LOGS_PATH)) {
    atomicWriteJson(PUBLISHING_LOGS_PATH, []);
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(PUBLISHING_LOGS_PATH, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendPublishingLog(entry: Omit<PublishingLogEntry, 'id' | 'createdAt'>): void {
  const logs = loadPublishingLogs();
  logs.unshift({
    id: `PLOG-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    ...entry,
    createdAt: new Date().toISOString(),
  });
  atomicWriteJson(PUBLISHING_LOGS_PATH, logs.slice(0, 300));
}

export function nextPublicationId(items: PublicationItem[], collection: CollectionType): string {
  const prefix = collection === 'debate' ? 'PUB-D-' : 'PUB-R-';
  let maxNum = 0;
  for (const p of items) {
    if (p.publicationId.startsWith(prefix)) {
      const n = parseInt(p.publicationId.slice(prefix.length), 10);
      if (!Number.isNaN(n) && n > maxNum) maxNum = n;
    }
  }
  return `${prefix}${String(maxNum + 1).padStart(6, '0')}`;
}

export function enrichPublicationMetrics(
  item: PublicationItem,
  safeLimit = TELEGRAM_SAFE_CHAR_LIMIT
): PublicationItem {
  const db = loadDatabase();
  const story = db.stories.find((s) => s.id === item.sourceStoryId);
  const hashtags = normalizeHashtagsList(item.hashtags || []);
  const length = measurePublicationLength({
    title: item.title,
    body: item.body,
    closingQuestion: item.closingQuestion,
    hashtags,
    safeLimit,
  });
  const editorialChecks = runEditorialDiagnostics(
    {
      collection: item.collection,
      title: item.title,
      body: item.body,
      closingQuestion: item.closingQuestion,
      hashtags,
    },
    story
  );

  return {
    ...item,
    hashtags,
    totalChars: length.totalChars,
    remainingChars: length.remainingChars,
    exceedsTelegramLimit: length.exceedsSafeLimit,
    firstSentenceLength: length.firstSentenceLength,
    editorialChecks,
  };
}

export function syncStoryPublishedStatus(sourceStoryId: string, pubStatus: PublishingQueueStatus): void {
  if (pubStatus !== 'zen_delivery_verified') return;
  const db = loadDatabase();
  const story = db.stories.find((s) => s.id === sourceStoryId);
  if (!story) return;
  if (story.usageStatus !== 'published') {
    story.usageStatus = 'published';
    saveDatabase(db);
  }
}

export function recoverInterruptedPublications(): void {
  loadPublishingSettings();
  const items = loadPublications();
  let changed = false;
  for (const item of items) {
    if (item.status === 'sending') {
      item.status = 'failed';
      item.error = 'Отправка прервана перезапуском сервера; проверьте канал перед повтором.';
      item.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) savePublications(items);
}

export function getTelegramIntegrationStatus(): TelegramIntegrationStatus {
  const settings = loadPublishingSettings();
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
  const channel = process.env.TELEGRAM_CHANNEL_ID?.trim() || settings.telegramChannelRef?.trim() || '';
  const supaUrl = process.env.SUPABASE_URL?.trim() || '';
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';

  return {
    hasBotTokenConfigured: Boolean(token && token !== 'MY_TELEGRAM_BOT_TOKEN'),
    hasChannelConfigured: Boolean(channel && channel !== 'MY_TELEGRAM_CHANNEL_ID'),
    hasGeminiConfigured: isAiConfigured(),
    hasGeminiPrimaryConfigured: isGeminiPrimaryConfigured(),
    hasGigaChatConfigured: isGigaChatConfigured(),
    hasSupabaseConfigured: Boolean(
      supaUrl &&
        supaUrl !== 'MY_SUPABASE_URL' &&
        supaKey &&
        supaKey !== 'MY_SUPABASE_SERVICE_ROLE_KEY'
    ),
    autoSendEnabled: settings.autoSendEnabled,
    dryRunMode: settings.dryRunMode,
  };
}

export function computePublishingAnalytics(): PublishingAnalytics {
  const items = loadPublications();
  let totalManualViews = 0;
  let totalManualReads = 0;
  let totalManualReactions = 0;
  let hasExternalStats = false;

  for (const item of items) {
    if (item.manualStats) {
      if (typeof item.manualStats.views === 'number') {
        totalManualViews += item.manualStats.views;
        hasExternalStats = true;
      }
      if (typeof item.manualStats.reads === 'number') {
        totalManualReads += item.manualStats.reads;
        hasExternalStats = true;
      }
      if (typeof item.manualStats.reactions === 'number') {
        totalManualReactions += item.manualStats.reactions;
        hasExternalStats = true;
      }
    }
  }

  return {
    totalPublications: items.length,
    draftCount: items.filter((i) => i.status === 'draft').length,
    readyCount: items.filter((i) => i.status === 'ready').length,
    scheduledCount: items.filter((i) => i.status === 'scheduled').length,
    sentToTelegramCount: items.filter(
      (i) =>
        i.status === 'sent_to_telegram' ||
        i.status === 'zen_delivery_unconfirmed' ||
        i.status === 'zen_delivery_verified'
    ).length,
    zenUnconfirmedCount: items.filter(
      (i) => i.status === 'zen_delivery_unconfirmed' || i.status === 'sent_to_telegram'
    ).length,
    zenVerifiedCount: items.filter((i) => i.status === 'zen_delivery_verified').length,
    failedCount: items.filter((i) => i.status === 'failed').length,
    totalManualViews,
    totalManualReads,
    totalManualReactions,
    hasExternalStats,
  };
}

export function createPublishingBackup(): {
  filename: string;
  createdAt: string;
  publicationCount: number;
} {
  ensurePublishingDirs();
  const payload = {
    createdAt: new Date().toISOString(),
    publications: loadPublications(),
    settings: loadPublishingSettings(),
    logs: loadPublishingLogs(),
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `publishing_backup_${stamp}.json`;
  atomicWriteJson(path.join(PUBLISHING_BACKUPS_DIR, filename), payload);

  const files = fs
    .readdirSync(PUBLISHING_BACKUPS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();
  for (const old of files.slice(15)) {
    fs.unlinkSync(path.join(PUBLISHING_BACKUPS_DIR, old));
  }

  return {
    filename,
    createdAt: payload.createdAt,
    publicationCount: payload.publications.length,
  };
}
