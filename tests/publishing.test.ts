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
  callChatCompletionJson,
  resolveGeminiModelList,
  resolveGigaChatCredentials,
  setGigaChatTransportForTest,
} from '../server/aiClient.js';
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

test('all integrations operate non-blockingly when GEMINI_API_KEY, GIGACHAT_*, TELEGRAM_BOT_TOKEN, and SUPABASE_* are unset', async () => {
  const snapPubs = snapshotFile(PUBLICATIONS_PATH);
  const snapSettings = snapshotFile(PUBLISHING_SETTINGS_PATH);
  const snapLogs = snapshotFile(PUBLISHING_LOGS_PATH);
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevGigaAuth = process.env.GIGACHAT_AUTH_KEY;
  const prevGigaCreds = process.env.GIGACHAT_CREDENTIALS;
  const prevGigaKey = process.env.GIGACHAT_API_KEY;
  const prevGigaClientId = process.env.GIGACHAT_CLIENT_ID;
  const prevGigaClientSecret = process.env.GIGACHAT_CLIENT_SECRET;
  const prevGigaScope = process.env.GIGACHAT_SCOPE;
  const prevGroq = process.env.GROQ_API_KEY;
  const prevAiKey = process.env.AI_API_KEY;
  const prevGroqEndpoint = process.env.GROQ_API_ENDPOINT;
  const prevAiEndpoint = process.env.AI_ENDPOINT;
  const prevOpenAi = process.env.OPENAI_API_KEY;
  const prevTg = process.env.TELEGRAM_BOT_TOKEN;
  const prevCh = process.env.TELEGRAM_CHANNEL_ID;
  const prevSupaUrl = process.env.SUPABASE_URL;
  const prevSupaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GIGACHAT_AUTH_KEY;
    delete process.env.GIGACHAT_CREDENTIALS;
    delete process.env.GIGACHAT_API_KEY;
    delete process.env.GIGACHAT_CLIENT_ID;
    delete process.env.GIGACHAT_CLIENT_SECRET;
    delete process.env.GIGACHAT_SCOPE;
    delete process.env.GROQ_API_KEY;
    delete process.env.AI_API_KEY;
    delete process.env.GROQ_API_ENDPOINT;
    delete process.env.AI_ENDPOINT;
    delete process.env.OPENAI_API_KEY;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHANNEL_ID;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    // 1. Integration status returns false booleans cleanly without throwing or leaking secrets
    const status = getTelegramIntegrationStatus();
    assert.equal(status.hasGeminiConfigured, false);
    assert.equal(status.hasGeminiPrimaryConfigured, false);
    assert.equal(status.hasGigaChatConfigured, false);
    assert.equal(status.hasBotTokenConfigured, false);
    assert.equal(status.hasSupabaseConfigured, false);

    // 2. AI API check reports unconfigured calmly, without crashing module
    assert.equal(isGeminiConfigured(), false);
    assert.throws(() => getGeminiClient(), /API_KEY_MISSING|GEMINI_API_KEY|GIGACHAT_AUTH_KEY/);

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
    if (prevGigaAuth === undefined) delete process.env.GIGACHAT_AUTH_KEY;
    else process.env.GIGACHAT_AUTH_KEY = prevGigaAuth;
    if (prevGigaCreds === undefined) delete process.env.GIGACHAT_CREDENTIALS;
    else process.env.GIGACHAT_CREDENTIALS = prevGigaCreds;
    if (prevGigaKey === undefined) delete process.env.GIGACHAT_API_KEY;
    else process.env.GIGACHAT_API_KEY = prevGigaKey;
    if (prevGigaClientId === undefined) delete process.env.GIGACHAT_CLIENT_ID;
    else process.env.GIGACHAT_CLIENT_ID = prevGigaClientId;
    if (prevGigaClientSecret === undefined) delete process.env.GIGACHAT_CLIENT_SECRET;
    else process.env.GIGACHAT_CLIENT_SECRET = prevGigaClientSecret;
    if (prevGigaScope === undefined) delete process.env.GIGACHAT_SCOPE;
    else process.env.GIGACHAT_SCOPE = prevGigaScope;
    if (prevGroq === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = prevGroq;
    if (prevAiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = prevAiKey;
    if (prevGroqEndpoint === undefined) delete process.env.GROQ_API_ENDPOINT;
    else process.env.GROQ_API_ENDPOINT = prevGroqEndpoint;
    if (prevAiEndpoint === undefined) delete process.env.AI_ENDPOINT;
    else process.env.AI_ENDPOINT = prevAiEndpoint;
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

test('Gemini model cascade includes free fallback and GigaChat OAuth + model failover works when primary returns 503', async () => {
  const models = resolveGeminiModelList();
  assert.equal(models[0], 'gemini-4-hydrogen');
  assert.ok(models.includes('gemini-3.1-flash-lite'));

  const prevGemini = process.env.GEMINI_API_KEY;
  const prevGigaAuth = process.env.GIGACHAT_AUTH_KEY;
  const prevGigaScope = process.env.GIGACHAT_SCOPE;

  try {
    delete process.env.GEMINI_API_KEY;
    process.env.GIGACHAT_AUTH_KEY = 'Basic dGVzdC1jbGllbnQ6dGVzdC1zZWNyZXQ=';
    delete process.env.GIGACHAT_SCOPE;

    const creds = resolveGigaChatCredentials();
    assert.equal(creds.authKey, 'dGVzdC1jbGllbnQ6dGVzdC1zZWNyZXQ=');
    assert.equal(creds.scope, 'GIGACHAT_API_PERS');
    assert.deepEqual(creds.models, ['GigaChat-2-Pro', 'GigaChat-2', 'GigaChat']);

    const calls: Array<{
      url: string;
      headers: Record<string, string>;
      body: string;
    }> = [];

    setGigaChatTransportForTest(async ({ url, headers, body }) => {
      calls.push({ url, headers, body });

      if (url === 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth') {
        return {
          status: 200,
          bodyText: JSON.stringify({
            access_token: 'giga-access-token-abc',
            expires_at: Date.now() + 25 * 60_000,
          }),
        };
      }

      const parsed = JSON.parse(body) as { model: string };
      if (parsed.model === 'GigaChat-2-Pro') {
        return {
          status: 503,
          bodyText: JSON.stringify({ message: 'Model overloaded' }),
        };
      }

      return {
        status: 200,
        bodyText: JSON.stringify({
          choices: [{ message: { content: '{"ok":true,"provider":"gigachat-2"}' } }],
        }),
      };
    });

    const result = await callChatCompletionJson<{ ok: boolean; provider: string }>({
      systemInstruction: 'Тест JSON',
      userPrompt: 'Верни JSON',
    });

    assert.deepEqual(result, { ok: true, provider: 'gigachat-2' });
    assert.equal(calls.length, 3);

    // Call 1: OAuth token exchange
    assert.equal(calls[0].url, 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth');
    assert.equal(calls[0].headers.Authorization, 'Basic dGVzdC1jbGllbnQ6dGVzdC1zZWNyZXQ=');
    assert.ok(calls[0].headers.RqUID && calls[0].headers.RqUID.length > 10);
    assert.equal(calls[0].body, 'scope=GIGACHAT_API_PERS');

    // Call 2: GigaChat-2-Pro returns 503
    assert.equal(calls[1].url, 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions');
    assert.equal(calls[1].headers.Authorization, 'Bearer giga-access-token-abc');
    assert.equal((JSON.parse(calls[1].body) as { model: string }).model, 'GigaChat-2-Pro');

    // Call 3: Automatic failover to GigaChat-2 reusing the cached Bearer token without a second OAuth call
    assert.equal(calls[2].url, 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions');
    assert.equal(calls[2].headers.Authorization, 'Bearer giga-access-token-abc');
    assert.equal((JSON.parse(calls[2].body) as { model: string }).model, 'GigaChat-2');
  } finally {
    setGigaChatTransportForTest(null);
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
    if (prevGigaAuth === undefined) delete process.env.GIGACHAT_AUTH_KEY;
    else process.env.GIGACHAT_AUTH_KEY = prevGigaAuth;
    if (prevGigaScope === undefined) delete process.env.GIGACHAT_SCOPE;
    else process.env.GIGACHAT_SCOPE = prevGigaScope;
  }
});
