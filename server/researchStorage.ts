import fs from 'fs';
import path from 'path';
import {
  CollectionType,
  ResearchJob,
  ResearchResult,
  ResearchSource,
  ResearchStatistics,
} from '../src/shared/types.js';
import { DEFAULT_RESEARCH_SOURCES } from '../src/shared/categories.js';
import { atomicWriteJson, DATA_DIR, getDataDir } from './storage.js';

export function getResearchSourcesPath(): string {
  return path.join(getDataDir(), 'research_sources.json');
}
export function getResearchJobsPath(): string {
  return path.join(getDataDir(), 'research_jobs.json');
}
export function getResearchResultsPath(): string {
  return path.join(getDataDir(), 'research_results.json');
}
export function getResearchBackupsDir(): string {
  return path.join(getDataDir(), 'research_backups');
}

export const RESEARCH_SOURCES_PATH = path.join(DATA_DIR, 'research_sources.json');
export const RESEARCH_JOBS_PATH = path.join(DATA_DIR, 'research_jobs.json');
export const RESEARCH_RESULTS_PATH = path.join(DATA_DIR, 'research_results.json');
export const RESEARCH_BACKUPS_DIR = path.join(DATA_DIR, 'research_backups');

export function ensureResearchDirs(): void {
  fs.mkdirSync(getDataDir(), { recursive: true });
  fs.mkdirSync(getResearchBackupsDir(), { recursive: true });
}

export function loadResearchSources(): ResearchSource[] {
  ensureResearchDirs();
  const sourcesPath = getResearchSourcesPath();
  if (!fs.existsSync(sourcesPath)) {
    const initial = DEFAULT_RESEARCH_SOURCES.map((s) => ({ ...s }));
    atomicWriteJson(sourcesPath, initial);
    return initial;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveResearchSources(sources: ResearchSource[]): void {
  ensureResearchDirs();
  atomicWriteJson(getResearchSourcesPath(), sources);
}

export function loadResearchJobs(): ResearchJob[] {
  ensureResearchDirs();
  const jobsPath = getResearchJobsPath();
  if (!fs.existsSync(jobsPath)) {
    atomicWriteJson(jobsPath, []);
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(jobsPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveResearchJobs(jobs: ResearchJob[]): void {
  ensureResearchDirs();
  atomicWriteJson(getResearchJobsPath(), jobs);
}

export function loadResearchResults(): ResearchResult[] {
  ensureResearchDirs();
  const resultsPath = getResearchResultsPath();
  if (!fs.existsSync(resultsPath)) {
    atomicWriteJson(resultsPath, []);
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveResearchResults(results: ResearchResult[]): void {
  ensureResearchDirs();
  atomicWriteJson(getResearchResultsPath(), results);
}

export function nextResearchId(results: ResearchResult[], collection: CollectionType): string {
  const prefix = collection === 'debate' ? 'RES-D-' : 'RES-R-';
  let maxNum = 0;
  for (const r of results) {
    if (r.researchId.startsWith(prefix)) {
      const n = parseInt(r.researchId.slice(prefix.length), 10);
      if (!Number.isNaN(n) && n > maxNum) maxNum = n;
    }
  }
  return `${prefix}${String(maxNum + 1).padStart(4, '0')}`;
}

export function recoverInterruptedResearchJobs(): void {
  loadResearchSources();
  const jobs = loadResearchJobs();
  let changed = false;
  for (const job of jobs) {
    if (job.status === 'running' || job.status === 'queued') {
      job.status = 'failed';
      job.finishedAt = new Date().toISOString();
      job.error = 'Задание прервано из-за перезапуска сервера; уже найденные карточки сохранены.';
      job.logs.push(`[${new Date().toISOString()}] Восстановление после рестарта: задание помечено как failed.`);
      changed = true;
    }
  }
  if (changed) saveResearchJobs(jobs);
}

export function createResearchBackup(): { filename: string; createdAt: string; resultCount: number } {
  ensureResearchDirs();
  const payload = {
    createdAt: new Date().toISOString(),
    sources: loadResearchSources(),
    jobs: loadResearchJobs(),
    results: loadResearchResults(),
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `research_backup_${stamp}.json`;
  const backupsDir = getResearchBackupsDir();
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
    resultCount: payload.results.length,
  };
}

export function computeResearchStatistics(): ResearchStatistics {
  const sources = loadResearchSources();
  const jobs = loadResearchJobs();
  const results = loadResearchResults();

  return {
    totalJobs: jobs.length,
    activeJobs: jobs.filter((j) => j.status === 'running' || j.status === 'queued').length,
    totalResults: results.length,
    sourcesChecked: sources.filter((s) => s.status !== 'unchecked').length,
    sourcesAvailable: sources.filter((s) => s.status === 'available').length,
    sourcesRestricted: sources.filter((s) => s.status === 'restricted').length,
    sourcesUnavailable: sources.filter((s) => s.status === 'unavailable').length,
    ideasGenerated: results.filter((r) => Boolean(r.generatedPlot)).length,
    awaitingReviewCount: results.filter(
      (r) => r.queueStatus === 'awaiting_review' || r.queueStatus === 'idea_generated' || r.queueStatus === 'duplicate_check' || r.queueStatus === 'research_pending'
    ).length,
    approvedToDatabaseCount: results.filter((r) => r.queueStatus === 'approved_for_database').length,
    rejectedCount: results.filter((r) => r.queueStatus === 'rejected').length,
    duplicatesDetectedCount: results.filter((r) => r.duplicateFlag).length,
    debateResultsCount: results.filter((r) => r.collection === 'debate').length,
    romanticResultsCount: results.filter((r) => r.collection === 'romantic').length,
  };
}
