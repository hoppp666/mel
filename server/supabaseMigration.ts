import fs from 'fs';
import path from 'path';
import { createBackupSnapshot, loadDatabase } from './storage.js';
import { createResearchBackup, loadResearchResults } from './researchStorage.js';
import { createContentBackup, loadContentDrafts, loadPhrasebook } from './contentStorage.js';
import {
  createPublishingBackup,
  loadPublications,
  loadPublishingLogs,
} from './publishingStorage.js';

export const FULL_SUPABASE_SCHEMA_SQL = `-- Полная схема MELO_LOVE (Этапы 1–4) для миграции в Supabase (PostgreSQL)

create table if not exists public.melo_story_plots (
  id text primary key,
  collection text not null check (collection in ('debate', 'romantic')),
  category text not null,
  subcategory text not null,
  title text not null,
  short_description text not null,
  full_plot text not null,
  participants text not null,
  setting text not null,
  core_conflict_or_action text not null,
  side_a_position text not null,
  side_b_position text not null,
  emotional_mechanism text not null,
  hidden_expectation text not null,
  unexpected_nuance text not null,
  possible_twist text not null,
  main_trigger_question text not null,
  additional_questions jsonb not null default '[]'::jsonb,
  keywords jsonb not null default '[]'::jsonb,
  idea_source text not null,
  source_url text not null default '',
  origin_type text not null check (origin_type in ('external', 'original')),
  created_at timestamptz not null default now(),
  verification_status text not null check (verification_status in ('pending', 'approved', 'needs_revision', 'rejected')),
  usage_status text not null check (usage_status in ('unused', 'drafted', 'published', 'archived')),
  semantic_fingerprint text not null,
  main_theme text not null default '',
  plot_mechanic text not null default '',
  unique_details text not null default '',
  source_analysis_note text not null default '',
  research_id text,
  research_notes text,
  batch_number integer not null default 1,
  quality_overall integer not null default 85,
  quality_payload jsonb not null default '{}'::jsonb,
  duplicate_flag boolean not null default false
);

create table if not exists public.melo_research_results (
  research_id text primary key,
  job_id text not null,
  source_id text not null,
  source_name text not null,
  source_url text not null,
  source_title text not null,
  collection text not null check (collection in ('debate', 'romantic')),
  analysis_status text not null,
  queue_status text not null,
  approved_story_id text references public.melo_story_plots(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  research_date timestamptz not null default now()
);

create table if not exists public.melo_content_drafts (
  content_id text primary key,
  source_story_id text not null references public.melo_story_plots(id) on delete restrict,
  research_id text,
  source_url text,
  collection text not null check (collection in ('debate', 'romantic')),
  title text not null,
  body text not null,
  trigger_question text not null default '',
  status text not null,
  quality_overall integer not null default 0,
  revision_history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.melo_publications (
  publication_id text primary key,
  source_draft_id text references public.melo_content_drafts(content_id) on delete set null,
  source_story_id text not null references public.melo_story_plots(id) on delete restrict,
  research_id text,
  source_url text,
  collection text not null check (collection in ('debate', 'romantic')),
  title text not null,
  teaser text not null default '',
  body text not null,
  closing_question text not null default '',
  hashtags jsonb not null default '[]'::jsonb,
  total_chars integer not null default 0,
  status text not null check (status in (
    'draft', 'ready', 'scheduled', 'sending',
    'sent_to_telegram', 'zen_delivery_unconfirmed', 'zen_delivery_verified', 'failed'
  )),
  idempotency_key text not null unique,
  telegram_message_id bigint,
  telegram_chat_id text,
  scheduled_at timestamptz,
  sent_to_telegram_at timestamptz,
  zen_confirmed_at timestamptz,
  zen_confirmed_source text,
  error text,
  manual_stats jsonb,
  revision_history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.melo_publishing_logs (
  id text primary key,
  publication_id text not null,
  action text not null,
  status text not null,
  detail text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.melo_phrasebook (
  id text primary key,
  phrase text not null,
  collection_scope text not null,
  weight integer not null default 7,
  max_frequency_per_10 integer not null default 2,
  banned boolean not null default false,
  recent_usage_count integer not null default 0,
  total_usage_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_melo_story_status on public.melo_story_plots (collection, verification_status, usage_status);
create index if not exists idx_melo_pub_status on public.melo_publications (status, scheduled_at);
create index if not exists idx_melo_draft_story on public.melo_content_drafts (source_story_id);
`;

export interface MigrationIntegrityReport {
  ready: boolean;
  backupsCreated: {
    database: string;
    research: string;
    content: string;
    publishing: string;
  };
  counts: {
    stories: number;
    researchResults: number;
    contentDrafts: number;
    publications: number;
    phrasebook: number;
    logs: number;
  };
  integrityErrors: string[];
  supabaseConfigured: boolean;
  liveSyncAttempted: boolean;
  liveSyncResult?: string;
}

export function verifyAllDataIntegrity(): {
  counts: MigrationIntegrityReport['counts'];
  integrityErrors: string[];
} {
  const db = loadDatabase();
  const research = loadResearchResults();
  const drafts = loadContentDrafts();
  const pubs = loadPublications();
  const phrasebook = loadPhrasebook();
  const logs = loadPublishingLogs();

  const storyIds = new Set(db.stories.map((s) => s.id));
  const draftIds = new Set(drafts.map((d) => d.contentId));
  const integrityErrors: string[] = [];

  for (const d of drafts) {
    if (!storyIds.has(d.sourceStoryId)) {
      integrityErrors.push(
        `Черновик ${d.contentId} ссылается на отсутствующий sourceStoryId=${d.sourceStoryId}`
      );
    }
  }

  for (const p of pubs) {
    if (!storyIds.has(p.sourceStoryId)) {
      integrityErrors.push(
        `Публикация ${p.publicationId} ссылается на отсутствующий sourceStoryId=${p.sourceStoryId}`
      );
    }
    if (p.sourceDraftId && !draftIds.has(p.sourceDraftId)) {
      integrityErrors.push(
        `Публикация ${p.publicationId} ссылается на удалённый sourceDraftId=${p.sourceDraftId}`
      );
    }
  }

  return {
    counts: {
      stories: db.stories.length,
      researchResults: research.length,
      contentDrafts: drafts.length,
      publications: pubs.length,
      phrasebook: phrasebook.length,
      logs: logs.length,
    },
    integrityErrors,
  };
}

export async function prepareOrRunSupabaseMigration(options?: {
  executeLiveSync?: boolean;
}): Promise<MigrationIntegrityReport> {
  // Always create full pre-migration backups across all 4 modules; never delete local JSON!
  const bDb = createBackupSnapshot();
  const bRes = createResearchBackup();
  const bCnt = createContentBackup();
  const bPub = createPublishingBackup();

  const { counts, integrityErrors } = verifyAllDataIntegrity();
  const rawSupaUrl = process.env.SUPABASE_URL?.trim() || '';
  const rawSupaKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
  const supaUrl = rawSupaUrl === 'MY_SUPABASE_URL' ? '' : rawSupaUrl;
  const supaKey = rawSupaKey === 'MY_SUPABASE_SERVICE_ROLE_KEY' ? '' : rawSupaKey;
  const supabaseConfigured = Boolean(supaUrl && supaKey);

  // Ensure schema file exists on disk for GitHub & manual Supabase SQL Editor import
  const schemaPath = path.resolve(process.cwd(), 'supabase', 'schema.sql');
  fs.mkdirSync(path.dirname(schemaPath), { recursive: true });
  fs.writeFileSync(schemaPath, FULL_SUPABASE_SCHEMA_SQL, 'utf8');

  let liveSyncAttempted = false;
  let liveSyncResult: string | undefined;

  if (options?.executeLiveSync && !supabaseConfigured) {
    liveSyncResult =
      'Supabase пока не подключён (не заданы SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY). Локальное хранение data/*.json и бэкапы работают полностью; подключите Supabase позже.';
  } else if (options?.executeLiveSync && supabaseConfigured && integrityErrors.length === 0) {
    liveSyncAttempted = true;
    try {
      const db = loadDatabase();
      const rows = db.stories.map((s) => ({
        id: s.id,
        collection: s.collection,
        category: s.category,
        subcategory: s.subcategory,
        title: s.title,
        short_description: s.shortDescription,
        full_plot: s.fullPlot,
        participants: s.participants,
        setting: s.setting,
        core_conflict_or_action: s.coreConflictOrAction,
        side_a_position: s.sideAPosition,
        side_b_position: s.sideBPosition,
        emotional_mechanism: s.emotionalMechanism,
        hidden_expectation: s.hiddenExpectation,
        unexpected_nuance: s.unexpectedNuance,
        possible_twist: s.possibleTwist,
        main_trigger_question: s.mainTriggerQuestion,
        additional_questions: s.additionalQuestions,
        keywords: s.keywords,
        idea_source: s.ideaSource,
        source_url: s.sourceUrl,
        origin_type: s.originType,
        created_at: s.createdAt,
        verification_status: s.verificationStatus,
        usage_status: s.usageStatus,
        semantic_fingerprint: s.semanticFingerprint,
        main_theme: s.mainTheme,
        plot_mechanic: s.plotMechanic,
        unique_details: s.uniqueDetails,
        source_analysis_note: s.sourceAnalysisNote,
        research_id: s.researchId || null,
        research_notes: s.researchNotes || null,
        batch_number: s.batchNumber,
        quality_overall: s.quality?.overall ?? 85,
        quality_payload: s.quality ?? {},
        duplicate_flag: s.duplicateFlag,
      }));

      const resp = await fetch(`${supaUrl.replace(/\/+$/, '')}/rest/v1/melo_story_plots`, {
        method: 'POST',
        headers: {
          apikey: supaKey,
          Authorization: `Bearer ${supaKey}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify(rows),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        liveSyncResult = `Ошибка Supabase REST (${resp.status}): ${errText.slice(0, 240)}`;
      } else {
        liveSyncResult = `Успешно синхронизировано ${rows.length} сюжетов в Supabase (локальные JSON-файлы сохранены).`;
      }
    } catch (err) {
      liveSyncResult = err instanceof Error ? err.message : 'Сбой подключения к Supabase';
    }
  }

  return {
    ready: integrityErrors.length === 0,
    backupsCreated: {
      database: bDb.filename,
      research: bRes.filename,
      content: bCnt.filename,
      publishing: bPub.filename,
    },
    counts,
    integrityErrors,
    supabaseConfigured,
    liveSyncAttempted,
    liveSyncResult,
  };
}
