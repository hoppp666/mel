import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import {
  DZEN_HEADLINE_MAX_CHARS,
  formatPublicationForTelegram,
  formatPublicationTitleForDzen,
  measurePublicationLength,
  TELEGRAM_SAFE_CHAR_LIMIT,
  validateHashtags,
} from '../src/shared/publishingUtils.js';
import {
  dispatchPublicationToTelegram,
  testTelegramConnection,
  validateBeforeTelegramSend,
} from '../server/telegramPublisher.js';
import {
  getTelegramIntegrationStatus,
  loadPublications,
  loadPublishingLogs,
  PUBLICATIONS_PATH,
  PUBLISHING_LOGS_PATH,
  PUBLISHING_SETTINGS_PATH,
  recoverInterruptedPublications,
  savePublications,
} from '../server/publishingStorage.js';
import { getGeminiClient, isGeminiConfigured } from '../server/geminiClient.js';
import {
  prepareOrRunSupabaseMigration,
  verifyAllDataIntegrity,
} from '../server/supabaseMigration.js';
import { PublicationItem } from '../src/shared/types.js';
import { buildDebateSeeds } from '../server/seedDebate.js';

function makePublication(overrides: Partial<PublicationItem> = {}): PublicationItem {
  const story = buildDebateSeeds()[0];
  const now = new Date().toISOString();
  const base: PublicationItem = {
    publicationId: 'PUB-D-999001',
    sourceStoryId: story.id,
    collection: 'debate',
    category: story.category,
    subcategory: story.subcategory,
    title: 'Общий бюджет оказался проверкой доверия',
    alternativeTitles: [],
    teaser: 'Спор о первом совместном отпуске и скрытом счёте.',
    body: 'Анна заметила, что партнёр перевёл премию на отдельный счёт без предупреждения.\n\nНа прямой вопрос он ответил, что каждый имеет право на финансовую подушку.',
    closingQuestion: 'А вы бы восприняли это как осторожность или недоверие?',
    hashtags: ['#отношения', '#семейный_бюджет', '#кто_здесь_прав'],
    hasImageAttachment: false,
    totalChars: 0,
    remainingChars: TELEGRAM_SAFE_CHAR_LIMIT,
    exceedsTelegramLimit: false,
    firstSentenceLength: 0,
    seoNotes: '',
    seoKeywords: [],
    editorialChecks: {
      spellingOk: true,
      noRepetitionOk: true,
      logicOk: true,
      meloStyleOk: true,
      headlineOk: true,
      hashtagsOk: true,
      notes: [],
    },
    status: 'ready',
    idempotencyKey: `TEST-IDEMP-${Date.now()}`,
    revisionHistory: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  const m = measurePublicationLength(base);
  base.totalChars = m.totalChars;
  base.remainingChars = m.remainingChars;
  base.exceedsTelegramLimit = m.exceedsSafeLimit;
  base.firstSentenceLength = m.firstSentenceLength;
  return base;
}

function snapshotFile(filePath: string): string | null {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
}

function restoreFile(filePath: string, content: string | null): void {
  if (content === null) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } else {
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

test('formatPublicationForTelegram & measurePublicationLength enforce Dzen 140-char headline and include hashtags in 3800-char total', () => {
  assert.equal(
    formatPublicationTitleForDzen('Заголовок без точки'),
    'Заголовок без точки.'
  );
  assert.equal(
    formatPublicationTitleForDzen('Уже с вопросом?'),
    'Уже с вопросом?'
  );

  const measured = measurePublicationLength({
    title: 'Короткий заголовок для Дзена',
    body: 'Первый абзац истории.\n\nВторой абзац истории.',
    closingQuestion: 'Кто прав в этой ситуации?',
    hashtags: ['#любовь', '#психология_отношений', '#спор_в_паре'],
  });

  assert.equal(measured.firstSentence, 'Короткий заголовок для Дзена.');
  assert.ok(measured.firstSentenceLength <= DZEN_HEADLINE_MAX_CHARS);
  assert.equal(measured.headlineExceeds140, false);
  assert.ok(measured.formattedText.includes('#психология_отношений'));
  assert.equal(measured.totalChars, measured.formattedText.length);
  assert.equal(measured.exceedsSafeLimit, false);

  const longHeadline = measurePublicationLength({
    title: 'А'.repeat(145),
    body: 'Текст.',
    hashtags: ['#тег1', '#тег2', '#тег3'],
  });
  assert.equal(longHeadline.headlineExceeds140, true);
});

test('validateHashtags enforces 3-5 unique non-generic tags', () => {
  const ok = validateHashtags(['Отношения', '#семейный бюджет', 'доверие_в_паре']);
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.normalized, ['#отношения', '#семейный_бюджет', '#доверие_в_паре']);

  const tooFew = validateHashtags(['#отношения', '#любовь']);
  assert.equal(tooFew.valid, false);

  const tooMany = validateHashtags(['#раз', '#два', '#три', '#четыре', '#пять', '#шесть']);
  assert.equal(tooMany.valid, false);

  const dup = validateHashtags(['#отношения', '#отношения', '#брак', '#конфликт']);
  assert.equal(dup.valid, false);

  const genericOnly = validateHashtags(['#история', '#жизнь', '#люди']);
  assert.equal(genericOnly.valid, false);
});

test('validateBeforeTelegramSend blocks >3800 chars, >1024 image caption, and duplicate sending', () => {
  const tooLong = makePublication({
    body: 'Абзац истории с длинным описанием конфликта. '.repeat(110),
  });
  const longCheck = validateBeforeTelegramSend(tooLong);
  assert.equal(longCheck.ok, false);
  assert.match(longCheck.reason || '', /3800/);

  const longCaption = makePublication({
    hasImageAttachment: true,
    body: 'Текст для поста с картинкой. '.repeat(45),
  });
  const captionCheck = validateBeforeTelegramSend(longCaption);
  assert.equal(captionCheck.ok, false);
  assert.match(captionCheck.reason || '', /1024/);

  for (const blockedStatus of [
    'sending',
    'sent_to_telegram',
    'zen_delivery_unconfirmed',
    'zen_delivery_verified',
  ] as const) {
    const dupCheck = validateBeforeTelegramSend(makePublication({ status: blockedStatus }));
    assert.equal(dupCheck.ok, false);
    assert.match(dupCheck.reason || '', /Повторная отправка заблокирована/);
  }

  const withMsgId = validateBeforeTelegramSend(
    makePublication({ status: 'failed', telegramMessageId: 4242 })
  );
  assert.equal(withMsgId.ok, false);
});

test('dispatchPublicationToTelegram handles dry-run, live send (-> zen_delivery_unconfirmed), token masking, and failure', async () => {
  const snapPubs = snapshotFile(PUBLICATIONS_PATH);
  const snapSettings = snapshotFile(PUBLISHING_SETTINGS_PATH);
  const snapLogs = snapshotFile(PUBLISHING_LOGS_PATH);
  const prevToken = process.env.TELEGRAM_BOT_TOKEN;
  const prevChannel = process.env.TELEGRAM_CHANNEL_ID;

  try {
    const pub = makePublication({ publicationId: 'PUB-D-999101', status: 'ready' });
    savePublications([pub]);

    // 1. Dry-run leaves status untouched
    const dryRes = await dispatchPublicationToTelegram('PUB-D-999101', { dryRunOverride: true });
    assert.equal(dryRes.mode, 'dry_run');
    assert.equal(dryRes.ok, true);
    assert.equal(loadPublications()[0].status, 'ready');

    // 2. Live send sets zen_delivery_unconfirmed (NEVER zen_delivery_verified) & masks token
    const secretToken = '999999999:SUPER_SECRET_BOT_TOKEN_XYZ';
    process.env.TELEGRAM_BOT_TOKEN = secretToken;
    process.env.TELEGRAM_CHANNEL_ID = '@melo_love_test_channel';

    const liveRes = await dispatchPublicationToTelegram('PUB-D-999101', {
      dryRunOverride: false,
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            ok: true,
            result: { message_id: 778899, chat: { id: -1001234567890 } },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )) as typeof fetch,
    });

    assert.equal(liveRes.mode, 'live');
    assert.equal(liveRes.messageId, 778899);
    assert.equal(liveRes.publication.status, 'zen_delivery_unconfirmed');
    assert.notEqual(liveRes.publication.status, 'zen_delivery_verified');
    assert.equal(JSON.stringify(liveRes).includes(secretToken), false);

    // 3. Failure sets failed and masks token in error & logs
    const failPub = makePublication({ publicationId: 'PUB-D-999102', status: 'ready' });
    savePublications([failPub]);

    await assert.rejects(
      () =>
        dispatchPublicationToTelegram('PUB-D-999102', {
          dryRunOverride: false,
          fetchImpl: (async () =>
            new Response(
              JSON.stringify({
                ok: false,
                description: `Forbidden for bot ${secretToken} in channel`,
              }),
              { status: 403, headers: { 'Content-Type': 'application/json' } }
            )) as typeof fetch,
        }),
      (err: Error) => !err.message.includes(secretToken)
    );

    const storedFail = loadPublications()[0];
    assert.equal(storedFail.status, 'failed');
    assert.equal((storedFail.error || '').includes(secretToken), false);
    const logsStr = JSON.stringify(loadPublishingLogs());
    assert.equal(logsStr.includes(secretToken), false);
  } finally {
    if (prevToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prevToken;
    if (prevChannel === undefined) delete process.env.TELEGRAM_CHANNEL_ID;
    else process.env.TELEGRAM_CHANNEL_ID = prevChannel;
    restoreFile(PUBLICATIONS_PATH, snapPubs);
    restoreFile(PUBLISHING_SETTINGS_PATH, snapSettings);
    restoreFile(PUBLISHING_LOGS_PATH, snapLogs);
  }
});

test('recoverInterruptedPublications resets stale sending items to failed', () => {
  const snapPubs = snapshotFile(PUBLICATIONS_PATH);
  const snapSettings = snapshotFile(PUBLISHING_SETTINGS_PATH);
  try {
    const stuck = makePublication({ publicationId: 'PUB-D-999201', status: 'sending' });
    savePublications([stuck]);
    recoverInterruptedPublications();
    const after = loadPublications()[0];
    assert.equal(after.status, 'failed');
    assert.match(after.error || '', /прервана/i);
  } finally {
    restoreFile(PUBLICATIONS_PATH, snapPubs);
    restoreFile(PUBLISHING_SETTINGS_PATH, snapSettings);
  }
});

test('verifyAllDataIntegrity & prepareOrRunSupabaseMigration create 4-module backups without deleting local JSON', async () => {
  const integrity = verifyAllDataIntegrity();
  assert.equal(integrity.integrityErrors.length, 0);
  assert.ok(integrity.counts.stories >= 50);

  const report = await prepareOrRunSupabaseMigration({ executeLiveSync: false });
  assert.equal(report.ready, true);
  assert.equal(report.integrityErrors.length, 0);
  assert.ok(report.backupsCreated.database);
  assert.ok(report.backupsCreated.research);
  assert.ok(report.backupsCreated.content);
  assert.ok(report.backupsCreated.publishing);
  assert.equal(fs.existsSync('data/melo_love_db.json'), true);
  assert.equal(fs.existsSync('supabase/schema.sql'), true);
});

test('all integrations operate non-blockingly when GEMINI_API_KEY, TELEGRAM_BOT_TOKEN, and SUPABASE_* are unset', async () => {
  const snapPubs = snapshotFile(PUBLICATIONS_PATH);
  const snapSettings = snapshotFile(PUBLISHING_SETTINGS_PATH);
  const snapLogs = snapshotFile(PUBLISHING_LOGS_PATH);
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevGhToken = process.env.GITHUB_TOKEN;
  const prevGhModels = process.env.GITHUB_MODELS_TOKEN;
  const prevGhModelsAlt = process.env.GH_MODELS_TOKEN;
  const prevOpenAi = process.env.OPENAI_API_KEY;
  const prevTg = process.env.TELEGRAM_BOT_TOKEN;
  const prevCh = process.env.TELEGRAM_CHANNEL_ID;
  const prevSupaUrl = process.env.SUPABASE_URL;
  const prevSupaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_MODELS_TOKEN;
    delete process.env.GH_MODELS_TOKEN;
    delete process.env.OPENAI_API_KEY;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHANNEL_ID;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    // 1. Integration status returns false booleans cleanly without throwing or leaking secrets
    const status = getTelegramIntegrationStatus();
    assert.equal(status.hasGeminiConfigured, false);
    assert.equal(status.hasBotTokenConfigured, false);
    assert.equal(status.hasSupabaseConfigured, false);

    // 2. AI API check reports unconfigured calmly, without crashing module
    assert.equal(isGeminiConfigured(), false);
    assert.throws(() => getGeminiClient(), /API_KEY_MISSING|GITHUB_MODELS_TOKEN|GitHub Models/);

    // 3. Telegram connection check returns structured non-throwing note
    const tgTest = await testTelegramConnection();
    assert.equal(tgTest.ok, false);
    assert.match(tgTest.note, /TELEGRAM_BOT_TOKEN/);

    // 4. Dry-run works completely without any tokens
    savePublications([makePublication({ publicationId: 'PUB-D-999301', status: 'ready' })]);
    const dry = await dispatchPublicationToTelegram('PUB-D-999301', { dryRunOverride: true });
    assert.equal(dry.mode, 'dry_run');
    assert.equal(dry.ok, true);

    // 5. Supabase migration gracefully handles missing credentials without failing
    const supaReport = await prepareOrRunSupabaseMigration({ executeLiveSync: true });
    assert.equal(supaReport.ready, true);
    assert.equal(supaReport.supabaseConfigured, false);
    assert.equal(supaReport.liveSyncAttempted, false);
    assert.match(supaReport.liveSyncResult || '', /Supabase пока не подключён/);
  } finally {
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
    if (prevGhToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = prevGhToken;
    if (prevGhModels === undefined) delete process.env.GITHUB_MODELS_TOKEN;
    else process.env.GITHUB_MODELS_TOKEN = prevGhModels;
    if (prevGhModelsAlt === undefined) delete process.env.GH_MODELS_TOKEN;
    else process.env.GH_MODELS_TOKEN = prevGhModelsAlt;
    if (prevOpenAi === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenAi;
    if (prevTg === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prevTg;
    if (prevCh === undefined) delete process.env.TELEGRAM_CHANNEL_ID;
    else process.env.TELEGRAM_CHANNEL_ID = prevCh;
    if (prevSupaUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevSupaUrl;
    if (prevSupaKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevSupaKey;
    restoreFile(PUBLICATIONS_PATH, snapPubs);
    restoreFile(PUBLISHING_SETTINGS_PATH, snapSettings);
    restoreFile(PUBLISHING_LOGS_PATH, snapLogs);
  }
});
