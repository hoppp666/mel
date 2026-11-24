import fs from 'node:fs';
import path from 'node:path';
import type {
  CollectionType,
  ResearchJob,
  ResearchResult,
  ResearchSource,
  ResearchStatistics,
} from '../src/shared/types.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SOURCES_FILE = path.join(DATA_DIR, 'research_sources.json');
const JOBS_FILE = path.join(DATA_DIR, 'research_jobs.json');
const RESULTS_FILE = path.join(DATA_DIR, 'research_results.json');
const RESEARCH_BACKUP_DIR = path.join(DATA_DIR, 'research_backups');

function ensureResearchDirs(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(RESEARCH_BACKUP_DIR)) {
    fs.mkdirSync(RESEARCH_BACKUP_DIR, { recursive: true });
  }
}

function writeJsonAtomic(filePath: string, payload: unknown): void {
  ensureResearchDirs();
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

export function createInitialResearchSources(): ResearchSource[] {
  const now = new Date().toISOString();
  const defs: Array<{
    id: string;
    name: string;
    url: string;
    domain: string;
    platform: 'reddit' | 'media';
    sourceType: string;
    directions: CollectionType[];
    notes: string;
  }> = [
    {
      id: 'reddit-aita',
      name: 'Reddit r/AmItheAsshole',
      url: 'https://www.reddit.com/r/AmItheAsshole/',
      domain: 'reddit.com',
      platform: 'reddit',
      sourceType: 'Reddit Community',
      directions: ['debate'],
      notes: 'Моральные дилеммы, бытовые границы, деньги, обязательства, столкновение ожиданий (ESH / NAH).',
    },
    {
      id: 'reddit-rel-advice',
      name: 'Reddit r/relationship_advice',
      url: 'https://www.reddit.com/r/relationship_advice/',
      domain: 'reddit.com',
      platform: 'reddit',
      sourceType: 'Reddit Community',
      directions: ['debate', 'romantic'],
      notes: 'Переписки, ревность, скрытые ожидания, вмешательство родственников, кризисы доверия.',
    },
    {
      id: 'reddit-relationships',
      name: 'Reddit r/relationships',
      url: 'https://www.reddit.com/r/relationships/',
      domain: 'reddit.com',
      platform: 'reddit',
      sourceType: 'Reddit Community',
      directions: ['debate', 'romantic'],
      notes: 'Длительные союзы, совместный быт, дети, привычки, распределение ресурсов и примирения.',
    },
    {
      id: 'reddit-bor-updates',
      name: 'Reddit r/BestofRedditorUpdates',
      url: 'https://www.reddit.com/r/BestofRedditorUpdates/',
      domain: 'reddit.com',
      platform: 'reddit',
      sourceType: 'Reddit Community',
      directions: ['debate', 'romantic'],
      notes: 'Истории с развитием во времени, неожиданной развязкой и скрытой мотивацией участников.',
    },
    {
      id: 'reddit-marriage',
      name: 'Reddit r/Marriage',
      url: 'https://www.reddit.com/r/Marriage/',
      domain: 'reddit.com',
      platform: 'reddit',
      sourceType: 'Reddit Community',
      directions: ['debate', 'romantic'],
      notes: 'Супружеская жизнь, зрелая любовь, бытовые ритуалы, распределение ролей и семейные бюджеты.',
    },
    {
      id: 'reddit-dating-advice',
      name: 'Reddit r/dating_advice',
      url: 'https://www.reddit.com/r/dating_advice/',
      domain: 'reddit.com',
      platform: 'reddit',
      sourceType: 'Reddit Community',
      directions: ['debate', 'romantic'],
      notes: 'Первые свидания, оплата счетов, неловкие моменты сближения, современные знакомства.',
    },
    {
      id: 'reddit-love',
      name: 'Reddit r/love',
      url: 'https://www.reddit.com/r/love/',
      domain: 'reddit.com',
      platform: 'reddit',
      sourceType: 'Reddit Community',
      directions: ['romantic'],
      notes: 'Маленькие проявления заботы, тихая поддержка, повседневная нежность и память о мелочах.',
    },
    {
      id: 'media-nyt-modern-love',
      name: 'The New York Times — Modern Love',
      url: 'https://www.nytimes.com/column/modern-love',
      domain: 'nytimes.com',
      platform: 'media',
      sourceType: 'Editorial Column',
      directions: ['romantic', 'debate'],
      notes: 'Авторские эссе о зрелой любви, потерях, примирении и сложных поворотных моментах в отношениях.',
    },
    {
      id: 'media-the-cut',
      name: 'The Cut — Relationships',
      url: 'https://www.thecut.com/tags/relationships/',
      domain: 'thecut.com',
      platform: 'media',
      sourceType: 'Digital Magazine',
      directions: ['debate', 'romantic'],
      notes: 'Современные союзы, разница в доходах, личное пространство, цифровые границы и откровенные колонки.',
    },
    {
      id: 'media-psychology-today',
      name: 'Psychology Today — Relationships',
      url: 'https://www.psychologytoday.com/us/basics/relationships',
      domain: 'psychologytoday.com',
      platform: 'media',
      sourceType: 'Psychology Publication',
      directions: ['debate', 'romantic'],
      notes: 'Психологические паттерны привязанности, скрытые ожидания и бытовые механизмы конфликтов.',
    },
    {
      id: 'media-huffpost',
      name: 'HuffPost — Relationships',
      url: 'https://www.huffpost.com/life/topic/relationships',
      domain: 'huffpost.com',
      platform: 'media',
      sourceType: 'Digital Media',
      directions: ['debate', 'romantic'],
      notes: 'Реальные кейсы семейных споров, разводов, свадеб и маленьких привычек, укрепляющих брак.',
    },
    {
      id: 'media-yourtango',
      name: 'YourTango',
      url: 'https://www.yourtango.com/love',
      domain: 'yourtango.com',
      platform: 'media',
      sourceType: 'Relationship Media',
      directions: ['debate', 'romantic'],
      notes: 'Наблюдения о совместимости, повседневных поступках партнёров и поводах для обсуждений.',
    },
    {
      id: 'media-brides',
      name: 'Brides — Relationships',
      url: 'https://www.brides.com/relationships-4692140',
      domain: 'brides.com',
      platform: 'media',
      sourceType: 'Editorial Magazine',
      directions: ['debate', 'romantic'],
      notes: 'Подготовка к свадьбе, конфликты со свекровью/тёщей, бюджеты торжества и трогательные традиции.',
    },
  ];

  return defs.map((d) => ({
    id: d.id,
    name: d.name,
    url: d.url,
    domain: d.domain,
    platform: d.platform,
    sourceType: d.sourceType,
    language: 'en',
    directions: d.directions,
    enabled: true,
    isCustom: false,
    availabilityStatus: 'unchecked',
    availabilityMessage: 'Доступность ещё не проверялась',
    robotsAllowed: null,
    lastCheckedAt: null,
    itemsFoundCount: 0,
    notes: d.notes,
    createdAt: now,
    updatedAt: now,
  }));
}

export function loadResearchSources(): ResearchSource[] {
  ensureResearchDirs();
  if (!fs.existsSync(SOURCES_FILE)) {
    const initial = createInitialResearchSources();
    saveResearchSources(initial);
    return initial;
  }
  try {
    const raw = fs.readFileSync(SOURCES_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Invalid sources array');
    return parsed as ResearchSource[];
  } catch {
    const initial = createInitialResearchSources();
    saveResearchSources(initial);
    return initial;
  }
}

export function saveResearchSources(sources: ResearchSource[]): void {
  writeJsonAtomic(SOURCES_FILE, sources);
}

export function loadResearchJobs(): ResearchJob[] {
  ensureResearchDirs();
  if (!fs.existsSync(JOBS_FILE)) {
    saveResearchJobs([]);
    return [];
  }
  try {
    const raw = fs.readFileSync(JOBS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ResearchJob[]) : [];
  } catch {
    return [];
  }
}

export function saveResearchJobs(jobs: ResearchJob[]): void {
  writeJsonAtomic(JOBS_FILE, jobs);
}

export function loadResearchResults(): ResearchResult[] {
  ensureResearchDirs();
  if (!fs.existsSync(RESULTS_FILE)) {
    saveResearchResults([]);
    return [];
  }
  try {
    const raw = fs.readFileSync(RESULTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ResearchResult[]) : [];
  } catch {
    return [];
  }
}

export function saveResearchResults(results: ResearchResult[]): void {
  writeJsonAtomic(RESULTS_FILE, results);
}

export function recoverInterruptedResearchJobs(): void {
  const jobs = loadResearchJobs();
  let changed = false;
  const now = new Date().toISOString();
  for (const job of jobs) {
    if (job.status === 'running') {
      job.status = 'interrupted';
      job.updatedAt = now;
      job.errorMessage = 'Задание прервано из-за перезапуска сервера; уже собранные материалы сохранены.';
      job.logs.push({
        timestamp: now,
        level: 'warn',
        message: 'Обнаружено незавершённое задание после перезапуска сервера — статус переведён в interrupted.',
      });
      changed = true;
    }
  }
  if (changed) {
    saveResearchJobs(jobs);
  }
}

export function generateNextResearchId(
  results: ResearchResult[],
  collection: CollectionType
): string {
  const prefix = collection === 'debate' ? 'RES-D-' : 'RES-R-';
  let maxNum = 0;
  for (const r of results) {
    if (r.researchId.startsWith(prefix)) {
      const n = Number.parseInt(r.researchId.slice(prefix.length), 10);
      if (!Number.isNaN(n) && n > maxNum) {
        maxNum = n;
      }
    }
  }
  return `${prefix}${String(maxNum + 1).padStart(4, '0')}`;
}

export function createResearchBackupSnapshot(): string {
  ensureResearchDirs();
  const payload = {
    createdAt: new Date().toISOString(),
    sources: loadResearchSources(),
    jobs: loadResearchJobs(),
    results: loadResearchResults(),
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `research_backup_${stamp}.json`;
  fs.writeFileSync(path.join(RESEARCH_BACKUP_DIR, filename), JSON.stringify(payload, null, 2), 'utf-8');

  const files = fs
    .readdirSync(RESEARCH_BACKUP_DIR)
    .filter((f) => f.startsWith('research_backup_') && f.endsWith('.json'))
    .sort()
    .reverse();
  for (const old of files.slice(12)) {
    try {
      fs.unlinkSync(path.join(RESEARCH_BACKUP_DIR, old));
    } catch {
      // ignore cleanup error
    }
  }
  return filename;
}

export function listResearchBackupSnapshots(): Array<{
  filename: string;
  sizeBytes: number;
  createdAt: string;
}> {
  ensureResearchDirs();
  return fs
    .readdirSync(RESEARCH_BACKUP_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse()
    .map((filename) => {
      const stat = fs.statSync(path.join(RESEARCH_BACKUP_DIR, filename));
      return {
        filename,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
      };
    });
}

export function computeResearchStatistics(
  sources: ResearchSource[],
  jobs: ResearchJob[],
  results: ResearchResult[]
): ResearchStatistics {
  const activeResults = results.filter((r) => r.queueStatus !== 'rejected');
  const processedSourceIds = new Set(results.map((r) => r.sourceId));

  const awaitingReviewCount = results.filter((r) =>
    ['research_pending', 'analysis_completed', 'idea_generated', 'duplicate_check', 'awaiting_review'].includes(
      r.queueStatus
    )
  ).length;

  const approvedForDatabaseCount = results.filter(
    (r) => r.queueStatus === 'approved_for_database'
  ).length;
  const rejectedCount = results.filter((r) => r.queueStatus === 'rejected').length;
  const originalIdeasCount = results.filter((r) => Boolean(r.generatedIdea)).length;
  const duplicatesDetectedCount = results.filter((r) => r.duplicateFlag).length;

  const debateResults = results.filter((r) => r.collection === 'debate');
  const romanticResults = results.filter((r) => r.collection === 'romantic');

  const averageResearchQuality =
    activeResults.length > 0
      ? Math.round(
          activeResults.reduce((acc, r) => acc + (r.qualityBreakdown?.overall ?? 0), 0) /
            activeResults.length
        )
      : 0;

  return {
    totalJobs: jobs.length,
    completedJobs: jobs.filter((j) => j.status === 'completed').length,
    totalMaterialsFound: results.length,
    processedSourcesCount: processedSourceIds.size,
    enabledSourcesCount: sources.filter((s) => s.enabled).length,
    availableSourcesCount: sources.filter((s) => s.availabilityStatus === 'available').length,
    originalIdeasCount,
    awaitingReviewCount,
    approvedForDatabaseCount,
    rejectedCount,
    duplicatesDetectedCount,
    debateCount: debateResults.length,
    romanticCount: romanticResults.length,
    debateApprovedCount: debateResults.filter((r) => r.queueStatus === 'approved_for_database').length,
    romanticApprovedCount: romanticResults.filter((r) => r.queueStatus === 'approved_for_database').length,
    averageResearchQuality,
  };
}

// --- Compatibility Exports ---
export const createResearchBackup = createResearchBackupSnapshot;
export function nextResearchId(collection: CollectionType = 'debate') {
  const prefix = collection === 'debate' ? 'RES-D-' : 'RES-R-';
  return `${prefix}${Date.now().toString(36).toUpperCase()}`;
}
export function getResearchJobsPath() { return JOBS_FILE; }
export function getResearchResultsPath() { return RESULTS_FILE; }
export function getResearchSourcesPath() { return SOURCES_FILE; }

