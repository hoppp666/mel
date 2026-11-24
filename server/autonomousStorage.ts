import fs from 'fs';
import path from 'path';
import {
  AutonomousSchedulerConfig,
  AutonomousSchedulerState,
  ProcessedMaterialEntry,
  ProcessedMaterialStatus,
} from '../src/shared/types.js';
import { atomicWriteJson, DATA_DIR, getDataDir } from './storage.js';
import { loadResearchResults } from './researchStorage.js';
import { loadPublications } from './publishingStorage.js';

export function getProcessedRegistryPath(): string {
  return path.join(getDataDir(), 'processed_materials_registry.json');
}
export function getAutonomousStatePath(): string {
  return path.join(getDataDir(), 'autonomous_scheduler_state.json');
}

export const PROCESSED_REGISTRY_PATH = path.join(DATA_DIR, 'processed_materials_registry.json');
export const AUTONOMOUS_STATE_PATH = path.join(DATA_DIR, 'autonomous_scheduler_state.json');

export function getTodayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function defaultSchedulerConfig(): AutonomousSchedulerConfig {
  return {
    researchEnabled: true,
    autoPublishEnabled: false,
    researchIntervalHours: 4,
    researchBatchSize: 4,
    productionBatchSize: 3,
    publishMinIntervalHours: 2,
    maxPublishesPerDay: 12,
    collectionsRotation: 'alternate',
    stopRequested: false,
    githubRepo: process.env.GITHUB_REPOSITORY?.trim() || '',
    updatedAt: new Date().toISOString(),
  };
}

export function defaultAutonomousState(): AutonomousSchedulerState {
  const now = new Date().toISOString();
  const cfg = defaultSchedulerConfig();
  return {
    config: cfg,
    batches: [],
    nextScheduledResearchAt: new Date(
      Date.now() + cfg.researchIntervalHours * 3600_000
    ).toISOString(),
    publishedTodayDate: getTodayUtcDate(),
    publishedTodayCount: 0,
    totalDiscoveredMaterials: 0,
    totalUniqueStoriesSaved: 0,
    totalPublicationsCreated: 0,
    totalPublishedToTelegram: 0,
    runHistory: [],
    lastCollectionUsed: undefined,
    activeBatchId: undefined,
    lastResearchRunAt: undefined,
    lastResearchError: undefined,
    lastProductionRunAt: undefined,
    lastProductionError: undefined,
    lastPublishRunAt: undefined,
    nextScheduledPublishAt: undefined,
    lastSuccessfulTelegramAt: undefined,
    lastPublishError: undefined,
  };
}

export function loadProcessedRegistry(): ProcessedMaterialEntry[] {
  fs.mkdirSync(getDataDir(), { recursive: true });
  const registryPath = getProcessedRegistryPath();
  if (!fs.existsSync(registryPath)) {
    atomicWriteJson(registryPath, []);
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveProcessedRegistry(entries: ProcessedMaterialEntry[]): void {
  fs.mkdirSync(getDataDir(), { recursive: true });
  atomicWriteJson(getProcessedRegistryPath(), entries);
}

export function nextRegistryId(entries: ProcessedMaterialEntry[]): string {
  let maxNum = 0;
  for (const e of entries) {
    if (e.id.startsWith('REG-')) {
      const n = parseInt(e.id.slice(4), 10);
      if (!Number.isNaN(n) && n > maxNum) maxNum = n;
    }
  }
  return `REG-${String(maxNum + 1).padStart(6, '0')}`;
}

export function loadAutonomousState(): AutonomousSchedulerState {
  fs.mkdirSync(getDataDir(), { recursive: true });
  const statePath = getAutonomousStatePath();
  const def = defaultAutonomousState();
  if (!fs.existsSync(statePath)) {
    atomicWriteJson(statePath, def);
    return def;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Partial<AutonomousSchedulerState>;
    const merged: AutonomousSchedulerState = {
      ...def,
      ...parsed,
      config: {
        ...def.config,
        ...(parsed.config || {}),
        githubRepo:
          parsed.config?.githubRepo || process.env.GITHUB_REPOSITORY?.trim() || '',
      },
      batches: Array.isArray(parsed.batches) ? parsed.batches : [],
      runHistory: Array.isArray(parsed.runHistory) ? parsed.runHistory : [],
    };
    const today = getTodayUtcDate();
    if (merged.publishedTodayDate !== today) {
      merged.publishedTodayDate = today;
      merged.publishedTodayCount = 0;
    }
    return merged;
  } catch {
    return def;
  }
}

export function saveAutonomousState(state: AutonomousSchedulerState): void {
  fs.mkdirSync(getDataDir(), { recursive: true });
  const today = getTodayUtcDate();
  if (state.publishedTodayDate !== today) {
    state.publishedTodayDate = today;
    state.publishedTodayCount = 0;
  }
  state.batches = state.batches.slice(0, 60);
  state.runHistory = state.runHistory.slice(0, 40);
  atomicWriteJson(getAutonomousStatePath(), state);
}

export function recoverAutonomousState(): void {
  loadProcessedRegistry();
  const state = loadAutonomousState();
  let changed = false;

  // Recover any registry entry stuck in transient states ('generating' or 'sending')
  const registry = loadProcessedRegistry();
  let regChanged = false;
  for (const item of registry) {
    if (item.status === 'generating' || item.status === 'sending') {
      item.status = 'failed';
      item.error = 'Операция прервана перезапуском или остановкой процесса; требуется безопасная проверка.';
      item.updatedAt = new Date().toISOString();
      regChanged = true;
    }
  }
  if (regChanged) saveProcessedRegistry(registry);

  if (state.config.stopRequested) {
    // Preserve explicit stopRequested flag across restarts
  }
  if (changed) saveAutonomousState(state);
}

export function computeRegistryStats(): {
  registryCount: number;
  registryByStatus: Record<ProcessedMaterialStatus, number>;
  recentRegistry: ProcessedMaterialEntry[];
  pendingAnalysisCount: number;
  readyToPublishCount: number;
} {
  const registry = loadProcessedRegistry();
  const results = loadResearchResults();
  const pubs = loadPublications();

  const statuses: ProcessedMaterialStatus[] = [
    'discovered',
    'duplicate',
    'approved',
    'generating',
    'generated',
    'quality_check',
    'ready',
    'sending',
    'published_to_telegram',
    'failed',
  ];
  const registryByStatus = Object.fromEntries(
    statuses.map((s) => [s, 0])
  ) as Record<ProcessedMaterialStatus, number>;

  for (const entry of registry) {
    if (registryByStatus[entry.status] !== undefined) {
      registryByStatus[entry.status] += 1;
    }
  }

  const pendingAnalysisCount = results.filter(
    (r) =>
      r.queueStatus === 'research_pending' &&
      (r.analysisStatus === 'pending' || r.analysisStatus === 'failed')
  ).length;

  const readyToPublishCount = pubs.filter(
    (p) => (p.status === 'ready' || p.status === 'scheduled') && !p.telegramMessageId
  ).length;

  return {
    registryCount: registry.length,
    registryByStatus,
    recentRegistry: registry.slice(0, 50),
    pendingAnalysisCount,
    readyToPublishCount,
  };
}
