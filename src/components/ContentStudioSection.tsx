import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Copy,
  Database,
  Download,
  Eye,
  Hash,
  History,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Save,
  Scissors,
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  ContentDraft,
  PublicationItem,
  PublishingAnalytics,
  PublishingLogEntry,
  PublishingQueueStatus,
  PublishingSettings,
  StoryPlot,
  TelegramIntegrationStatus,
} from '../shared/types.js';
import {
  DZEN_HEADLINE_MAX_CHARS,
  formatPublicationForTelegram,
  measurePublicationLength,
  TELEGRAM_CAPTION_MAX_CHARS,
  TELEGRAM_SAFE_CHAR_LIMIT,
} from '../shared/publishingUtils.js';
import {
  confirmZenDelivery,
  createPublication,
  createPublishingBackupApi,
  deletePublication,
  fetchPublishingState,
  fetchSupabaseSchema,
  generatePublicationHeadlines,
  generatePublicationSeoProposal,
  generatePublicationShortenProposal,
  prepareOrRunSupabaseMigrationApi,
  processDuePublishingQueue,
  restorePublicationVersion,
  sendPublicationToTelegram,
  suggestPublicationHashtags,
  testTelegramConnectionApi,
  updatePublication,
  updatePublicationStatus,
  updatePublishingSettings,
} from '../services/api.js';

type StudioTab = 'editor' | 'ready' | 'queue' | 'settings' | 'history' | 'analytics';

interface ContentStudioSectionProps {
  onDatabaseChanged: () => Promise<void>;
}

const STATUS_LABEL: Record<PublishingQueueStatus, string> = {
  draft: 'Черновик',
  ready: 'Готов к отправке',
  scheduled: 'Запланирован',
  sending: 'Отправляется',
  sent_to_telegram: 'Отправлен в Telegram',
  zen_delivery_unconfirmed: 'В Telegram · Дзен не подтверждён',
  zen_delivery_verified: 'Подтверждён в Дзене',
  failed: 'Ошибка отправки',
};

export const ContentStudioSection: React.FC<ContentStudioSectionProps> = ({
  onDatabaseChanged,
}) => {
  const [tab, setTab] = useState<StudioTab>('editor');
  const [publications, setPublications] = useState<PublicationItem[]>([]);
  const [settings, setSettings] = useState<PublishingSettings | null>(null);
  const [integrationStatus, setIntegrationStatus] = useState<TelegramIntegrationStatus | null>(null);
  const [analytics, setAnalytics] = useState<PublishingAnalytics | null>(null);
  const [logs, setLogs] = useState<PublishingLogEntry[]>([]);
  const [eligibleDrafts, setEligibleDrafts] = useState<ContentDraft[]>([]);
  const [eligibleStories, setEligibleStories] = useState<StoryPlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  // Selected publication & editor fields
  const [selectedPubId, setSelectedPubId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editTeaser, setEditTeaser] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editQuestion, setEditQuestion] = useState('');
  const [editTagsText, setEditTagsText] = useState('');
  const [editHasImage, setEditHasImage] = useState(false);
  const [editScheduledAt, setEditScheduledAt] = useState('');

  // Create source pickers
  const [pickDraftId, setPickDraftId] = useState('');
  const [pickStoryId, setPickStoryId] = useState('');

  // AI Proposals (user must review & apply explicitly)
  const [seoProposal, setSeoProposal] = useState<{
    adaptedTitle: string;
    adaptedTeaser: string;
    adaptedBody: string;
    seoKeywords: string[];
    suggestedHashtags: string[];
    diffSummary: string;
  } | null>(null);
  const [shortenProposal, setShortenProposal] = useState<{
    shortenedBody: string;
    explanation: string;
  } | null>(null);
  const [previewMode, setPreviewMode] = useState<'telegram' | 'dzen'>('telegram');

  // Settings / Test / Migration
  const [testResultMsg, setTestResultMsg] = useState<string | null>(null);
  const [supaSql, setSupaSql] = useState<string>('');
  const [migrationReport, setMigrationReport] = useState<string | null>(null);
  const [manualViewsInput, setManualViewsInput] = useState<Record<string, string>>({});
  const [manualReadsInput, setManualReadsInput] = useState<Record<string, string>>({});
  const [manualReactsInput, setManualReactsInput] = useState<Record<string, string>>({});

  const loadState = async () => {
    try {
      const data = await fetchPublishingState();
      setPublications(data.publications);
      setSettings(data.settings);
      setIntegrationStatus(data.integrationStatus);
      setAnalytics(data.analytics);
      setLogs(data.logs);
      setEligibleDrafts(data.eligibleDrafts);
      setEligibleStories(data.eligibleStories);
      if (!pickDraftId && data.eligibleDrafts[0]) setPickDraftId(data.eligibleDrafts[0].contentId);
      if (!pickStoryId && data.eligibleStories[0]) setPickStoryId(data.eligibleStories[0].id);
      if (!selectedPubId && data.publications[0]) setSelectedPubId(data.publications[0].publicationId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка загрузки Content Studio');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activePub = useMemo(
    () => publications.find((p) => p.publicationId === selectedPubId) || publications[0] || null,
    [publications, selectedPubId]
  );

  useEffect(() => {
    if (activePub) {
      setEditTitle(activePub.title);
      setEditTeaser(activePub.teaser);
      setEditBody(activePub.body);
      setEditQuestion(activePub.closingQuestion);
      setEditTagsText((activePub.hashtags || []).join(' '));
      setEditHasImage(Boolean(activePub.hasImageAttachment));
      setEditScheduledAt(
        activePub.scheduledAt ? activePub.scheduledAt.slice(0, 16) : ''
      );
      setSeoProposal(null);
      setShortenProposal(null);
    }
  }, [activePub?.publicationId, activePub?.updatedAt]);

  const parsedTags = useMemo(
    () =>
      editTagsText
        .split(/[\s,]+/)
        .map((t) => t.trim())
        .filter(Boolean),
    [editTagsText]
  );

  const liveLength = useMemo(
    () =>
      measurePublicationLength({
        title: editTitle,
        body: editBody,
        closingQuestion: editQuestion,
        hashtags: parsedTags,
        safeLimit: settings?.safeTelegramCharLimit || TELEGRAM_SAFE_CHAR_LIMIT,
      }),
    [editTitle, editBody, editQuestion, parsedTags, settings?.safeTelegramCharLimit]
  );

  const readyItems = useMemo(
    () => publications.filter((p) => p.status === 'ready' || p.status === 'scheduled'),
    [publications]
  );

  const queueItems = useMemo(
    () =>
      publications.filter((p) =>
        [
          'scheduled',
          'sending',
          'sent_to_telegram',
          'zen_delivery_unconfirmed',
          'zen_delivery_verified',
          'failed',
        ].includes(p.status)
      ),
    [publications]
  );

  const handleCreateFromDraft = async () => {
    if (!pickDraftId) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await createPublication({ sourceDraftId: pickDraftId });
      await loadState();
      setSelectedPubId(res.publication.publicationId);
      setNoticeMsg(`Создана публикация ${res.publication.publicationId} из черновика.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Не удалось создать публикацию');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateFromStory = async () => {
    if (!pickStoryId) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await createPublication({ sourceStoryId: pickStoryId });
      await loadState();
      setSelectedPubId(res.publication.publicationId);
      setNoticeMsg(`Создана публикация ${res.publication.publicationId} из сюжета ${pickStoryId}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Не удалось создать публикацию');
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (!activePub) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      await updatePublication(activePub.publicationId, {
        title: editTitle,
        teaser: editTeaser,
        body: editBody,
        closingQuestion: editQuestion,
        hashtags: parsedTags,
        hasImageAttachment: editHasImage,
        scheduledAt: editScheduledAt ? new Date(editScheduledAt).toISOString() : undefined,
        revisionReason: 'Редактура в Content Studio',
      });
      await loadState();
      setNoticeMsg('Публикация сохранена, счётчик символов и проверки обновлены.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setBusy(false);
    }
  };

  const handleSendTelegram = async (pubId: string, dryRun?: boolean) => {
    setBusy(true);
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const res = await sendPublicationToTelegram(pubId, dryRun);
      await loadState();
      setNoticeMsg(res.note);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка отправки в Telegram');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmZen = async (pubId: string, includeStats = false) => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const viewsVal = Number(manualViewsInput[pubId]);
      const readsVal = Number(manualReadsInput[pubId]);
      const reactsVal = Number(manualReactsInput[pubId]);
      await confirmZenDelivery(pubId, {
        source: 'manual_owner_confirmation',
        manualStats: includeStats
          ? {
              views: Number.isFinite(viewsVal) && manualViewsInput[pubId] ? viewsVal : undefined,
              reads: Number.isFinite(readsVal) && manualReadsInput[pubId] ? readsVal : undefined,
              reactions:
                Number.isFinite(reactsVal) && manualReactsInput[pubId] ? reactsVal : undefined,
            }
          : undefined,
      });
      await loadState();
      await onDatabaseChanged();
      setNoticeMsg('Выход статьи в Яндекс Дзене подтверждён; статус исходного сюжета обновлён на published.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка подтверждения');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-zinc-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Загружаем Content Studio & Publishing Queue...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900">
            Content Studio · Публикации в Telegram и Яндекс Дзен
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            Единый редактор с проверкой стиля, 3–5 хештегами, безопасным лимитом Telegram (3800
            симв.), очередью отправки и честным отслеживанием синхронизации через @zen_sync_bot.
          </p>
        </div>
        {integrationStatus && (
          <div className="text-xs font-mono text-zinc-600">
            Режим:{' '}
            <span className="font-semibold text-zinc-900">
              {integrationStatus.dryRunMode || !integrationStatus.autoSendEnabled
                ? 'Тестовый (Dry-Run)'
                : 'Боевая отправка активна'}
            </span>
            {' · '}Бот: {integrationStatus.hasBotTokenConfigured ? 'настроен' : 'нет токена'}
            {' · '}Канал: {integrationStatus.hasChannelConfigured ? 'указан' : 'не указан'}
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {errorMsg}
        </div>
      )}
      {noticeMsg && (
        <div className="rounded-md border border-teal-200 bg-teal-50 px-4 py-2.5 text-xs text-teal-900">
          {noticeMsg}
        </div>
      )}

      {/* 6 Sub-tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-stone-200 pb-3">
        {(
          [
            ['editor', 'Редактор'],
            ['ready', `Готовые публикации (${readyItems.length})`],
            ['queue', `Очередь отправки (${queueItems.length})`],
            ['settings', 'Настройки Telegram и Дзена'],
            ['history', `История публикаций (${publications.length})`],
            ['analytics', 'Аналитика'],
          ] as Array<[StudioTab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap cursor-pointer ${
              tab === id
                ? 'bg-zinc-900 text-white'
                : 'border border-stone-200 bg-white text-zinc-700 hover:bg-stone-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ================================================================ */}
      {/* TAB 1: EDITOR                                                    */}
      {/* ================================================================ */}
      {tab === 'editor' && (
        <div className="space-y-5">
          {/* Import bar from Drafts or Stories */}
          <div className="rounded-lg border border-stone-200 bg-white p-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="flex items-center gap-2">
              <select
                value={pickDraftId}
                onChange={(e) => setPickDraftId(e.target.value)}
                className="min-w-0 flex-1 rounded border border-stone-200 bg-white px-2.5 py-1.5 text-xs"
              >
                {eligibleDrafts.length === 0 ? (
                  <option value="">Нет готовых черновиков из Story Generator</option>
                ) : (
                  eligibleDrafts.map((d) => (
                    <option key={d.contentId} value={d.contentId}>
                      {d.contentId} · {d.title} ({d.quality.overall}/100)
                    </option>
                  ))
                )}
              </select>
              <button
                type="button"
                disabled={busy || !pickDraftId}
                onClick={handleCreateFromDraft}
                className="inline-flex items-center gap-1 rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                Из черновика
              </button>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={pickStoryId}
                onChange={(e) => setPickStoryId(e.target.value)}
                className="min-w-0 flex-1 rounded border border-stone-200 bg-white px-2.5 py-1.5 text-xs"
              >
                {eligibleStories.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id} · {s.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || !pickStoryId}
                onClick={handleCreateFromStory}
                className="inline-flex items-center gap-1 rounded border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-stone-50 disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                Напрямую из сюжета
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left list of publications */}
            <div className="rounded-lg border border-stone-200 bg-white lg:col-span-3 divide-y divide-stone-200 max-h-[760px] overflow-y-auto">
              {publications.length === 0 ? (
                <div className="p-5 text-center text-xs text-zinc-500">
                  Публикаций пока нет. Создайте первую из черновика или сюжета выше.
                </div>
              ) : (
                publications.map((p) => (
                  <button
                    key={p.publicationId}
                    type="button"
                    onClick={() => setSelectedPubId(p.publicationId)}
                    className={`w-full px-3.5 py-3 text-left cursor-pointer ${
                      activePub?.publicationId === p.publicationId
                        ? 'bg-rose-50/70'
                        : 'hover:bg-stone-50'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500">
                      <span>{p.publicationId}</span>
                      <span
                        className={`tabular-nums ${
                          p.exceedsTelegramLimit ? 'text-rose-700 font-semibold' : ''
                        }`}
                      >
                        {p.totalChars} симв.
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs font-semibold text-zinc-900 line-clamp-2">
                      {p.title}
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-500">
                      {STATUS_LABEL[p.status]} · {p.sourceStoryId}
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Center & Right: Editor + Preview */}
            <div className="lg:col-span-9 space-y-4">
              {!activePub ? (
                <div className="rounded-lg border border-stone-200 bg-white p-12 text-center text-sm text-zinc-500">
                  Выберите или создайте публикацию для работы в Content Studio.
                </div>
              ) : (
                <>
                  {/* Character limit & Dzen headline telemetry */}
                  <div className="rounded-lg border border-stone-200 bg-white p-4 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="font-mono text-zinc-700 tabular-nums">
                        Символов с пробелами:{' '}
                        <span
                          className={`font-semibold ${
                            liveLength.exceedsSafeLimit ? 'text-rose-700' : 'text-teal-800'
                          }`}
                        >
                          {liveLength.totalChars}
                        </span>{' '}
                        / {TELEGRAM_SAFE_CHAR_LIMIT} (остаток:{' '}
                        <span className="font-semibold">{liveLength.remainingChars}</span>)
                      </div>
                      <div className="font-mono text-zinc-600 tabular-nums">
                        Заголовок (1-е предложение для Дзена):{' '}
                        <span
                          className={
                            liveLength.headlineExceeds140
                              ? 'text-rose-700 font-semibold'
                              : 'text-zinc-900'
                          }
                        >
                          {liveLength.firstSentenceLength}/{DZEN_HEADLINE_MAX_CHARS}
                        </span>
                      </div>
                    </div>

                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
                      <div
                        className={`h-full transition-all ${
                          liveLength.exceedsSafeLimit
                            ? 'bg-rose-600'
                            : liveLength.totalChars > 3400
                              ? 'bg-amber-600'
                              : 'bg-teal-700'
                        }`}
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round((liveLength.totalChars / TELEGRAM_SAFE_CHAR_LIMIT) * 100)
                          )}%`,
                        }}
                      />
                    </div>

                    {liveLength.exceedsSafeLimit && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
                        <span>
                          Превышен безопасный лимит {TELEGRAM_SAFE_CHAR_LIMIT} символов! Автоотправка в
                          Telegram заблокирована. Сократите текст или выгрузите его в TXT для ручной
                          публикации в Дзене.
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              const res = await generatePublicationShortenProposal(
                                activePub.publicationId
                              );
                              setShortenProposal(res.proposal);
                            } catch (err) {
                              setErrorMsg(err instanceof Error ? err.message : 'Ошибка сокращения');
                            } finally {
                              setBusy(false);
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded bg-rose-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-900 cursor-pointer"
                        >
                          <Scissors className="h-3.5 w-3.5" />
                          Предложить сокращение под 3800
                        </button>
                      </div>
                    )}

                    {editHasImage && liveLength.exceedsCaptionLimit && (
                      <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                        Telegram ограничивает подпись к изображению (caption){' '}
                        {TELEGRAM_CAPTION_MAX_CHARS} символами (сейчас {liveLength.totalChars}). Не
                        отправляйте длинную статью как подпись к картинке — публикуйте текстом или
                        вручную в Дзене.
                      </div>
                    )}

                    {integrationStatus && !integrationStatus.hasGeminiConfigured && (
                      <div className="rounded border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-zinc-600">
                        AI-помощники (заголовки, хештеги, SEO, сокращение) используют{' '}
                        <code>GEMINI_API_KEY</code> или резервный GigaChat API (
                        <code>GIGACHAT_AUTH_KEY</code>). Ручная
                        редактура, счётчик 3800 симв., предпросмотр и экспорт работают без ключа.
                      </div>
                    )}
                  </div>

                  {/* Main fields */}
                  <div className="rounded-lg border border-stone-200 bg-white p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 pb-3 text-xs text-zinc-500">
                      <span className="font-mono">
                        {activePub.publicationId} · сюжет {activePub.sourceStoryId}
                        {activePub.researchId ? ` · ${activePub.researchId}` : ''} ·{' '}
                        {STATUS_LABEL[activePub.status]}
                      </span>
                      <div className="flex items-center gap-2">
                        <a
                          href={`/api/publishing/publications/${encodeURIComponent(activePub.publicationId)}/export/txt`}
                          download={`${activePub.publicationId}.txt`}
                          className="inline-flex items-center gap-1 rounded border border-stone-200 px-2.5 py-1 text-xs text-zinc-700 hover:bg-stone-50"
                        >
                          <Download className="h-3.5 w-3.5" />
                          TXT
                        </a>
                        <a
                          href={`/api/publishing/publications/${encodeURIComponent(activePub.publicationId)}/export/json`}
                          download={`${activePub.publicationId}.json`}
                          className="inline-flex items-center gap-1 rounded border border-stone-200 px-2.5 py-1 text-xs text-zinc-700 hover:bg-stone-50"
                        >
                          <Download className="h-3.5 w-3.5" />
                          JSON
                        </a>
                        <button
                          type="button"
                          onClick={async () => {
                            await navigator.clipboard.writeText(
                              formatPublicationForTelegram({
                                title: editTitle,
                                body: editBody,
                                closingQuestion: editQuestion,
                                hashtags: parsedTags,
                              })
                            );
                            setNoticeMsg('Текст публикации скопирован в буфер обмена');
                          }}
                          className="inline-flex items-center gap-1 rounded border border-stone-200 px-2.5 py-1 text-xs text-zinc-700 hover:bg-stone-50 cursor-pointer"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Копировать
                        </button>
                      </div>
                    </div>

                    {/* Title + Alternative Headlines */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-zinc-700">
                          Заголовок (до 140 симв., первое предложение для Дзена)
                        </label>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await generatePublicationHeadlines(activePub.publicationId);
                              await loadState();
                            } catch (err) {
                              setErrorMsg(err instanceof Error ? err.message : 'Ошибка ИИ-заголовков');
                            } finally {
                              setBusy(false);
                            }
                          }}
                          className="inline-flex items-center gap-1 text-xs font-medium text-rose-800 hover:text-rose-900 cursor-pointer"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          Варианты заголовков
                        </button>
                      </div>
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="w-full rounded border border-stone-200 px-3 py-2 text-sm font-semibold text-zinc-900"
                      />
                      {activePub.alternativeTitles.length > 0 && (
                        <div className="space-y-1 pt-1">
                          <div className="text-[11px] text-zinc-500">
                            Нажмите на вариант, чтобы подставить в заголовок:
                          </div>
                          <div className="flex flex-col gap-1">
                            {activePub.alternativeTitles.map((alt, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => setEditTitle(alt)}
                                className="text-left rounded border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs text-zinc-800 hover:bg-stone-100 cursor-pointer"
                              >
                                {alt}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <label className="block text-xs font-medium text-zinc-700">
                      Анонс / подзаголовок (для Дзена и каталога)
                      <input
                        type="text"
                        value={editTeaser}
                        onChange={(e) => setEditTeaser(e.target.value)}
                        className="mt-1 w-full rounded border border-stone-200 px-3 py-1.5 text-xs text-zinc-800"
                      />
                    </label>

                    <label className="block text-xs font-medium text-zinc-700">
                      Основной текст (обычный читаемый текст без Markdown)
                      <textarea
                        rows={11}
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        className="mt-1 w-full rounded border border-stone-200 px-3 py-2 text-sm leading-relaxed text-zinc-900"
                      />
                    </label>

                    <label className="block text-xs font-medium text-zinc-700">
                      Эмоциональное завершение / вопрос читателям
                      <input
                        type="text"
                        value={editQuestion}
                        onChange={(e) => setEditQuestion(e.target.value)}
                        className="mt-1 w-full rounded border border-stone-200 px-3 py-1.5 text-sm text-zinc-900"
                      />
                    </label>

                    {/* Hashtags 3-5 */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-zinc-700">
                          Хештеги (3–5 тематических тегов в конце, входят в подсчёт 3800 симв.)
                        </label>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              const res = await suggestPublicationHashtags(activePub.publicationId);
                              setEditTagsText(res.hashtags.join(' '));
                            } catch (err) {
                              setErrorMsg(err instanceof Error ? err.message : 'Ошибка подбора тегов');
                            } finally {
                              setBusy(false);
                            }
                          }}
                          className="inline-flex items-center gap-1 text-xs font-medium text-rose-800 hover:text-rose-900 cursor-pointer"
                        >
                          <Hash className="h-3.5 w-3.5" />
                          Подобрать 3–5 хештегов
                        </button>
                      </div>
                      <input
                        type="text"
                        value={editTagsText}
                        onChange={(e) => setEditTagsText(e.target.value)}
                        placeholder="#отношения_в_паре #личные_границы #разговор_начистоту"
                        className="w-full rounded border border-stone-200 px-3 py-1.5 font-mono text-xs text-zinc-800"
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
                      <label className="inline-flex items-center gap-2 text-zinc-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editHasImage}
                          onChange={(e) => setEditHasImage(e.target.checked)}
                        />
                        <span>Публикация планируется с картинкой (проверять лимит подписи 1024 симв.)</span>
                      </label>

                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            const res = await generatePublicationSeoProposal(
                              activePub.publicationId
                            );
                            setSeoProposal(res.proposal);
                          } catch (err) {
                            setErrorMsg(err instanceof Error ? err.message : 'Ошибка SEO-адаптации');
                          } finally {
                            setBusy(false);
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-stone-50 cursor-pointer"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        SEO-адаптация под Дзен
                      </button>
                    </div>

                    {/* SEO Proposal Review Box (user confirms changes explicitly) */}
                    {seoProposal && (
                      <div className="rounded border border-amber-200 bg-amber-50/70 p-4 space-y-2 text-xs">
                        <div className="font-semibold text-amber-950">
                          Предложение SEO-адаптации (подтвердите применение): {seoProposal.diffSummary}
                        </div>
                        <div className="text-zinc-700">
                          Ключевые слова: {seoProposal.seoKeywords.join(', ')}
                        </div>
                        <div className="rounded border border-stone-200 bg-white p-2.5 text-zinc-800">
                          <div className="font-semibold">{seoProposal.adaptedTitle}</div>
                          <p className="mt-1 whitespace-pre-line">{seoProposal.adaptedBody}</p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditTitle(seoProposal.adaptedTitle);
                              setEditTeaser(seoProposal.adaptedTeaser);
                              setEditBody(seoProposal.adaptedBody);
                              if (seoProposal.suggestedHashtags.length >= 3) {
                                setEditTagsText(seoProposal.suggestedHashtags.join(' '));
                              }
                              setSeoProposal(null);
                              setNoticeMsg('SEO-предложение применено в редакторе. Не забудьте нажать «Сохранить».');
                            }}
                            className="rounded bg-zinc-900 px-3 py-1 text-xs font-medium text-white cursor-pointer"
                          >
                            Применить изменения
                          </button>
                          <button
                            type="button"
                            onClick={() => setSeoProposal(null)}
                            className="rounded border border-stone-300 bg-white px-3 py-1 text-xs text-zinc-700 cursor-pointer"
                          >
                            Отклонить
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Shorten Proposal Box */}
                    {shortenProposal && (
                      <div className="rounded border border-amber-200 bg-amber-50/70 p-4 space-y-2 text-xs">
                        <div className="font-semibold text-amber-950">
                          Предложение сокращения: {shortenProposal.explanation}
                        </div>
                        <div className="rounded border border-stone-200 bg-white p-2.5 whitespace-pre-line text-zinc-800">
                          {shortenProposal.shortenedBody}
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditBody(shortenProposal.shortenedBody);
                              setShortenProposal(null);
                            }}
                            className="rounded bg-zinc-900 px-3 py-1 text-xs font-medium text-white cursor-pointer"
                          >
                            Применить сокращённый текст
                          </button>
                          <button
                            type="button"
                            onClick={() => setShortenProposal(null)}
                            className="rounded border border-stone-300 bg-white px-3 py-1 text-xs text-zinc-700 cursor-pointer"
                          >
                            Отмена
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Editorial checks */}
                    <div className="rounded border border-stone-200 bg-stone-50 p-3 text-xs space-y-1.5">
                      <div className="font-semibold text-zinc-700">
                        Редакционные проверки публикации
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px]">
                        <span className={activePub.editorialChecks.headlineOk ? 'text-teal-800' : 'text-rose-700'}>
                          Заголовок≤140: {activePub.editorialChecks.headlineOk ? 'OK' : 'исправить'}
                        </span>
                        <span className={activePub.editorialChecks.spellingOk ? 'text-teal-800' : 'text-rose-700'}>
                          Чистота текста: {activePub.editorialChecks.spellingOk ? 'OK' : 'замечания'}
                        </span>
                        <span className={activePub.editorialChecks.noRepetitionOk ? 'text-teal-800' : 'text-rose-700'}>
                          Повторы: {activePub.editorialChecks.noRepetitionOk ? 'OK' : 'найдены'}
                        </span>
                        <span className={activePub.editorialChecks.meloStyleOk ? 'text-teal-800' : 'text-rose-700'}>
                          Стиль MELO_LOVE: {activePub.editorialChecks.meloStyleOk ? 'OK' : 'клише'}
                        </span>
                        <span className={activePub.editorialChecks.hashtagsOk ? 'text-teal-800' : 'text-rose-700'}>
                          Хештеги (3–5): {activePub.editorialChecks.hashtagsOk ? 'OK' : 'проверить'}
                        </span>
                      </div>
                      {activePub.editorialChecks.notes.length > 0 && (
                        <ul className="list-disc pl-4 text-amber-900 space-y-0.5">
                          {activePub.editorialChecks.notes.map((n, i) => (
                            <li key={i}>{n}</li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-3">
                      <button
                        type="button"
                        onClick={async () => {
                          await deletePublication(activePub.publicationId);
                          setSelectedPubId(null);
                          await loadState();
                        }}
                        className="inline-flex items-center gap-1 rounded border border-stone-200 px-3 py-1.5 text-xs text-rose-800 hover:bg-rose-50 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Удалить
                      </button>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={handleSave}
                          className="inline-flex items-center gap-1 rounded border border-stone-300 bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-800 hover:bg-stone-50 cursor-pointer"
                        >
                          <Save className="h-3.5 w-3.5" />
                          Сохранить изменения
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={async () => {
                            await handleSave();
                            await updatePublicationStatus(activePub.publicationId, 'ready');
                            await loadState();
                          }}
                          className="inline-flex items-center gap-1 rounded bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 cursor-pointer"
                        >
                          <Check className="h-3.5 w-3.5" />
                          Отметить как «Готово»
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Live Preview (Telegram vs Dzen) */}
                  <div className="rounded-lg border border-stone-200 bg-white p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-700">
                        <Eye className="h-4 w-4" />
                        Предпросмотр перед отправкой
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => setPreviewMode('telegram')}
                          className={`rounded px-2.5 py-1 text-xs cursor-pointer ${
                            previewMode === 'telegram'
                              ? 'bg-zinc-900 text-white'
                              : 'border border-stone-200 text-zinc-600'
                          }`}
                        >
                          Как пост в Telegram
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewMode('dzen')}
                          className={`rounded px-2.5 py-1 text-xs cursor-pointer ${
                            previewMode === 'dzen'
                              ? 'bg-zinc-900 text-white'
                              : 'border border-stone-200 text-zinc-600'
                          }`}
                        >
                          Как статья в Дзене
                        </button>
                      </div>
                    </div>
                    {previewMode === 'telegram' ? (
                      <pre className="whitespace-pre-wrap rounded border border-stone-200 bg-stone-50 p-4 font-sans text-sm leading-relaxed text-zinc-900">
                        {liveLength.formattedText}
                      </pre>
                    ) : (
                      <div className="rounded border border-stone-200 bg-stone-50 p-5 space-y-3">
                        <div className="text-[11px] font-mono text-zinc-500">
                          Заголовок из 1-го предложения ({liveLength.firstSentenceLength}/140 симв.):
                        </div>
                        <h4 className="text-lg font-bold text-zinc-900">{liveLength.firstSentence}</h4>
                        {editTeaser && <p className="text-sm italic text-zinc-600">{editTeaser}</p>}
                        <div className="whitespace-pre-line text-sm leading-relaxed text-zinc-800">
                          {editBody}
                        </div>
                        {editQuestion && (
                          <div className="text-sm font-medium text-zinc-900">{editQuestion}</div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Version history for this item */}
                  {activePub.revisionHistory.length > 0 && (
                    <div className="rounded-lg border border-stone-200 bg-white p-4 space-y-2">
                      <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-700">
                        <History className="h-3.5 w-3.5" />
                        Версии текста ({activePub.revisionHistory.length})
                      </div>
                      <div className="divide-y divide-stone-200 rounded border border-stone-200">
                        {activePub.revisionHistory.slice(0, 6).map((rev) => (
                          <div
                            key={rev.version}
                            className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                          >
                            <div className="min-w-0 flex-1 truncate">
                              <span className="font-mono font-semibold">v{rev.version}</span> ·{' '}
                              {rev.reason} · {rev.title}
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                restorePublicationVersion(activePub.publicationId, rev.version).then(
                                  loadState
                                )
                              }
                              className="inline-flex items-center gap-1 rounded border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50 cursor-pointer"
                            >
                              <RotateCcw className="h-3 w-3" />
                              Откатить
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB 2: READY PUBLICATIONS                                        */}
      {/* ================================================================ */}
      {tab === 'ready' && (
        <div className="space-y-4">
          {integrationStatus && !integrationStatus.hasBotTokenConfigured && (
            <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-zinc-700">
              <span className="font-medium text-zinc-900">Telegram пока не подключён:</span>{' '}
              <code>TELEGRAM_BOT_TOKEN</code> не задан. Режим <strong>Dry-Run</strong>, постановка в
              очередь и экспорт работают без токена; для реальной отправки в канал добавьте токен на
              сервере.
            </div>
          )}

          {readyItems.length === 0 ? (
            <div className="rounded-lg border border-stone-200 bg-white px-6 py-12 text-center text-sm text-zinc-500">
              Нет публикаций со статусом «Готов к отправке» или «Запланирован».
            </div>
          ) : (
            <div className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
              {readyItems.map((p) => (
                <div
                  key={p.publicationId}
                  className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 font-mono">
                      <span className="font-semibold text-zinc-800">{p.publicationId}</span>
                      <span>·</span>
                      <span>{p.sourceStoryId}</span>
                      <span>·</span>
                      <span className={p.exceedsTelegramLimit ? 'text-rose-700 font-semibold' : ''}>
                        {p.totalChars}/{TELEGRAM_SAFE_CHAR_LIMIT} симв.
                      </span>
                      <span>·</span>
                      <span>{STATUS_LABEL[p.status]}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPubId(p.publicationId);
                        setTab('editor');
                      }}
                      className="text-left text-sm font-semibold text-zinc-900 hover:text-rose-800 cursor-pointer"
                    >
                      {p.title}
                    </button>
                    <div className="text-xs text-zinc-500">{p.hashtags.join(' ')}</div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busy || p.exceedsTelegramLimit}
                      onClick={() =>
                        updatePublicationStatus(p.publicationId, 'scheduled', {
                          scheduledAt: new Date().toISOString(),
                        })
                          .then(loadState)
                          .catch((e) => setErrorMsg(e.message))
                      }
                      className="inline-flex items-center gap-1 rounded border border-stone-300 bg-white px-2.5 py-1.5 text-xs text-zinc-800 hover:bg-stone-50 disabled:opacity-50 cursor-pointer"
                    >
                      <CalendarClock className="h-3.5 w-3.5" />
                      В очередь
                    </button>

                    <button
                      type="button"
                      disabled={busy || p.exceedsTelegramLimit}
                      onClick={() => handleSendTelegram(p.publicationId, true)}
                      className="rounded border border-stone-300 bg-white px-2.5 py-1.5 text-xs text-zinc-700 hover:bg-stone-50 disabled:opacity-50 cursor-pointer"
                    >
                      Тест (Dry-Run)
                    </button>

                    <button
                      type="button"
                      disabled={busy || p.exceedsTelegramLimit}
                      onClick={() => handleSendTelegram(p.publicationId)}
                      className="inline-flex items-center gap-1 rounded bg-rose-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-900 disabled:opacity-50 cursor-pointer"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Отправить в Telegram
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB 3: SENDING QUEUE & DZEN CONFIRMATION                         */}
      {/* ================================================================ */}
      {tab === 'queue' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white p-4">
            <div className="text-xs text-zinc-600">
              Отправка в Telegram переводит публикацию в статус{' '}
              <span className="font-mono font-semibold text-zinc-800">zen_delivery_unconfirmed</span>.
              Перевод сюжета в <span className="font-mono">published</span> происходит только после
              подтверждения выхода в Дзене.
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const res = await processDuePublishingQueue();
                  await loadState();
                  setNoticeMsg(
                    `Очередь обработана: ${res.summary.processed} (отправлено: ${res.summary.sent}, dry-run: ${res.summary.skippedDryRun}, ошибок: ${res.summary.failed}).`
                  );
                } finally {
                  setBusy(false);
                }
              }}
              className="inline-flex items-center gap-1.5 rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 cursor-pointer"
            >
              <Play className="h-3.5 w-3.5" />
              Обработать очередь сейчас
            </button>
          </div>

          {queueItems.length === 0 ? (
            <div className="rounded-lg border border-stone-200 bg-white px-6 py-12 text-center text-sm text-zinc-500">
              Очередь отправки пуста.
            </div>
          ) : (
            <div className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
              {queueItems.map((p) => (
                <div key={p.publicationId} className="p-5 space-y-2.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-mono text-zinc-600">
                      <span className="font-semibold text-zinc-900">{p.publicationId}</span> ·{' '}
                      {STATUS_LABEL[p.status]}
                      {p.telegramMessageId ? ` · TG msg_id=${p.telegramMessageId}` : ''}
                    </div>
                    <span className="font-mono text-[11px] text-zinc-400">
                      idempotency: {p.idempotencyKey}
                    </span>
                  </div>
                  <div className="text-sm font-semibold text-zinc-900">{p.title}</div>
                  {p.error && (
                    <div className="flex items-center gap-1.5 text-rose-700">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span>{p.error}</span>
                    </div>
                  )}

                  {(p.status === 'zen_delivery_unconfirmed' || p.status === 'sent_to_telegram') && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <input
                        type="number"
                        min={0}
                        placeholder="Просмотры (опц.)"
                        value={manualViewsInput[p.publicationId] || ''}
                        onChange={(e) =>
                          setManualViewsInput((prev) => ({ ...prev, [p.publicationId]: e.target.value }))
                        }
                        className="w-32 rounded border border-stone-200 px-2 py-1 font-mono text-xs"
                      />
                      <input
                        type="number"
                        min={0}
                        placeholder="Дочитывания"
                        value={manualReadsInput[p.publicationId] || ''}
                        onChange={(e) =>
                          setManualReadsInput((prev) => ({ ...prev, [p.publicationId]: e.target.value }))
                        }
                        className="w-32 rounded border border-stone-200 px-2 py-1 font-mono text-xs"
                      />
                      <input
                        type="number"
                        min={0}
                        placeholder="Реакции"
                        value={manualReactsInput[p.publicationId] || ''}
                        onChange={(e) =>
                          setManualReactsInput((prev) => ({
                            ...prev,
                            [p.publicationId]: e.target.value,
                          }))
                        }
                        className="w-28 rounded border border-stone-200 px-2 py-1 font-mono text-xs"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleConfirmZen(p.publicationId, true)}
                        className="inline-flex items-center gap-1 rounded bg-teal-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-900 cursor-pointer"
                      >
                        <Check className="h-3.5 w-3.5" />
                        Подтвердить публикацию в Дзене
                      </button>
                    </div>
                  )}

                  {p.status === 'failed' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        updatePublicationStatus(p.publicationId, 'ready').then(loadState)
                      }
                      className="rounded border border-stone-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-stone-50 cursor-pointer"
                    >
                      Вернуть в «Готово» для исправления
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB 4: SETTINGS TELEGRAM & DZEN + SUPABASE MIGRATION             */}
      {/* ================================================================ */}
      {tab === 'settings' && settings && integrationStatus && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-stone-200 bg-white p-5 space-y-4">
            <h3 className="text-sm font-semibold text-zinc-900">
              Подключение Telegram Bot API и Яндекс Дзен (@zen_sync_bot)
            </h3>

            <div className="rounded border border-stone-200 bg-stone-50 p-3 text-xs space-y-1.5 font-mono">
              <div className="flex items-center justify-between gap-2 pb-1 border-b border-stone-200 font-sans">
                <span className="text-zinc-700 font-medium">
                  Статус серверных ключей (все интеграции опциональны)
                </span>
                <button
                  type="button"
                  onClick={loadState}
                  className="text-xs text-zinc-700 underline hover:text-zinc-900 cursor-pointer"
                >
                  Обновить
                </button>
              </div>
              <div>
                AI-генерация (Gemini + резерв GigaChat API):{' '}
                <span className={integrationStatus.hasGeminiConfigured ? 'text-teal-800' : 'text-zinc-600'}>
                  {integrationStatus.hasGeminiConfigured
                    ? [
                        integrationStatus.hasGeminiPrimaryConfigured ? 'Gemini' : '',
                        integrationStatus.hasGigaChatConfigured ? 'GigaChat API' : '',
                      ]
                        .filter(Boolean)
                        .join(' + ') || 'настроен'
                    : 'не задан (редактор работает без него)'}
                </span>
              </div>
              <div>
                TELEGRAM_BOT_TOKEN (сервер):{' '}
                <span className={integrationStatus.hasBotTokenConfigured ? 'text-teal-800' : 'text-zinc-600'}>
                  {integrationStatus.hasBotTokenConfigured ? 'настроен' : 'не задан (Dry-Run и очередь работают)'}
                </span>
              </div>
              <div>
                SUPABASE_URL + SERVICE_ROLE_KEY:{' '}
                <span className={integrationStatus.hasSupabaseConfigured ? 'text-teal-800' : 'text-zinc-600'}>
                  {integrationStatus.hasSupabaseConfigured ? 'настроены' : 'не заданы (локальный JSON)'}
                </span>
              </div>
            </div>

            <label className="block text-xs font-medium text-zinc-700">
              Публичный Telegram-канал (@username или -100...)
              <input
                type="text"
                value={settings.telegramChannelRef}
                onChange={(e) =>
                  setSettings({ ...settings, telegramChannelRef: e.target.value })
                }
                placeholder="@melo_love_channel"
                className="mt-1 w-full rounded border border-stone-200 px-3 py-2 font-mono text-xs"
              />
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-zinc-700">
                Канал в Дзене
                <input
                  type="text"
                  value={settings.dzenChannelName}
                  onChange={(e) => setSettings({ ...settings, dzenChannelName: e.target.value })}
                  className="mt-1 w-full rounded border border-stone-200 px-3 py-2 text-xs"
                />
              </label>
              <label className="block text-xs font-medium text-zinc-700">
                Режим @zen_sync_bot (/changemode)
                <select
                  value={settings.dzenSyncMode}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      dzenSyncMode: e.target.value as 'automatic' | 'manual_forward',
                    })
                  }
                  className="mt-1 w-full rounded border border-stone-200 bg-white px-3 py-2 text-xs"
                >
                  <option value="automatic">Автоматический</option>
                  <option value="manual_forward">Вручную (пересылка боту)</option>
                </select>
              </label>
            </div>

            <div className="space-y-2 pt-1 text-xs text-zinc-700">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.dryRunMode}
                  onChange={(e) => setSettings({ ...settings, dryRunMode: e.target.checked })}
                />
                <span>Тестовый режим Dry-Run (проверки без реальной отправки в канал)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.autoSendEnabled}
                  onChange={(e) =>
                    setSettings({ ...settings, autoSendEnabled: e.target.checked })
                  }
                />
                <span>Разрешить реальную отправку в Telegram Bot API</span>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  const res = await updatePublishingSettings(settings);
                  setSettings(res.settings);
                  setIntegrationStatus(res.integrationStatus);
                  setNoticeMsg('Настройки публикаций сохранены');
                }}
                className="rounded bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-zinc-800 cursor-pointer"
              >
                Сохранить настройки
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  const res = await testTelegramConnectionApi();
                  setTestResultMsg(res.note);
                }}
                className="rounded border border-stone-300 bg-white px-3.5 py-2 text-xs font-medium text-zinc-800 hover:bg-stone-50 cursor-pointer"
              >
                Проверить бота и канал
              </button>
            </div>

            {testResultMsg && (
              <div className="rounded border border-stone-200 bg-stone-50 p-3 text-xs text-zinc-800">
                {testResultMsg}
              </div>
            )}
          </div>

          {/* Supabase & Backups */}
          <div className="rounded-lg border border-stone-200 bg-white p-5 space-y-4">
            <h3 className="text-sm font-semibold text-zinc-900">
              Инфраструктура: Supabase миграция и бэкапы (Этапы 1–4)
            </h3>
            <p className="text-xs leading-relaxed text-zinc-600">
              Перед переносом в Supabase система автоматически создаёт резервные снимки всех
              четырёх хранилищ (сюжеты, исследования, черновики, публикации) и проверяет целостность
              связей `publication → sourceStoryId → researchId`. Локальные JSON не удаляются.
            </p>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  createPublishingBackupApi().then((r) =>
                    setNoticeMsg(`Создан бэкап публикаций: ${r.backup.filename}`)
                  )
                }
                className="inline-flex items-center gap-1 rounded border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-stone-50 cursor-pointer"
              >
                <Database className="h-3.5 w-3.5" />
                Бэкап публикаций
              </button>

              <button
                type="button"
                onClick={async () => {
                  const res = await fetchSupabaseSchema();
                  setSupaSql(res.sql);
                }}
                className="rounded border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-stone-50 cursor-pointer"
              >
                Показать полную SQL-схему
              </button>

              <button
                type="button"
                onClick={async () => {
                  const res = await prepareOrRunSupabaseMigrationApi(
                    Boolean(integrationStatus.hasSupabaseConfigured)
                  );
                  const r = res.report;
                  setMigrationReport(
                    `Готовность: ${r.ready ? 'ДА' : 'ОШИБКИ'} · Сюжетов: ${r.counts.stories}, Исслед.: ${r.counts.researchResults}, Черновиков: ${r.counts.contentDrafts}, Публикаций: ${r.counts.publications}. Ошибок связей: ${r.integrityErrors.length}. ${r.liveSyncResult || 'Синхронизация с Supabase не запускалась (используйте supabase/schema.sql).'}`
                  );
                }}
                className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 cursor-pointer"
              >
                Сверка целостности + бэкап всех 4 баз
              </button>
            </div>

            {migrationReport && (
              <div className="rounded border border-stone-200 bg-stone-50 p-3 text-xs text-zinc-800">
                {migrationReport}
              </div>
            )}

            {supaSql && (
              <pre className="max-h-56 overflow-auto rounded border border-stone-200 bg-stone-50 p-3 font-mono text-[11px] text-zinc-800">
                {supaSql}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB 5: PUBLICATION HISTORY & AUDIT LOG                           */}
      {/* ================================================================ */}
      {tab === 'history' && (
        <div className="space-y-6">
          <div className="rounded-lg border border-stone-200 bg-white">
            <div className="border-b border-stone-200 px-5 py-3.5">
              <h3 className="text-sm font-semibold text-zinc-900">
                Реестр связей публикаций (publication → sourceStoryId → researchId / URL)
              </h3>
            </div>
            <div className="divide-y divide-stone-200">
              {publications.length === 0 ? (
                <div className="px-5 py-8 text-center text-xs text-zinc-500">
                  Публикаций пока нет
                </div>
              ) : (
                publications.map((p) => (
                  <div key={p.publicationId} className="px-5 py-3.5 text-xs space-y-1">
                    <div className="flex flex-wrap justify-between gap-2 font-mono text-zinc-600">
                      <span>
                        {p.publicationId} → {p.sourceStoryId}
                        {p.sourceDraftId ? ` (из ${p.sourceDraftId})` : ''}
                        {p.researchId ? ` → ${p.researchId}` : ''}
                      </span>
                      <span>{STATUS_LABEL[p.status]}</span>
                    </div>
                    <div className="text-sm font-semibold text-zinc-900">{p.title}</div>
                    {p.sourceUrl && (
                      <div className="font-mono text-[11px] text-zinc-500 truncate">
                        Источник: {p.sourceUrl}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-lg border border-stone-200 bg-white">
            <div className="border-b border-stone-200 px-5 py-3.5">
              <h3 className="text-sm font-semibold text-zinc-900">Журнал операций отправки</h3>
            </div>
            <div className="divide-y divide-stone-200">
              {logs.length === 0 ? (
                <div className="px-5 py-6 text-center text-xs text-zinc-500">Записей пока нет</div>
              ) : (
                logs.slice(0, 20).map((l) => (
                  <div key={l.id} className="px-5 py-2.5 text-xs">
                    <span className="font-mono font-semibold text-zinc-800">{l.publicationId}</span>{' '}
                    · <span className="font-mono text-zinc-500">{l.action}</span> · {l.detail}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB 6: ANALYTICS (HONEST METRICS ONLY)                           */}
      {/* ================================================================ */}
      {tab === 'analytics' && analytics && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="rounded-lg border border-stone-200 bg-white p-5">
              <div className="text-xs text-zinc-500">Создано публикаций</div>
              <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900 tabular-nums">
                {analytics.totalPublications}
              </div>
              <div className="mt-1 text-xs text-zinc-500 font-mono tabular-nums">
                Готовы: {analytics.readyCount} · В очереди: {analytics.scheduledCount}
              </div>
            </div>

            <div className="rounded-lg border border-stone-200 bg-white p-5">
              <div className="text-xs text-zinc-500">Отправлено в Telegram</div>
              <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900 tabular-nums">
                {analytics.sentToTelegramCount}
              </div>
              <div className="mt-1 text-xs text-zinc-500 font-mono tabular-nums">
                Ждут подтверждения Дзена: {analytics.zenUnconfirmedCount}
              </div>
            </div>

            <div className="rounded-lg border border-stone-200 bg-white p-5">
              <div className="text-xs text-zinc-500">Подтверждено в Дзене</div>
              <div className="mt-1 font-mono text-2xl font-semibold text-teal-800 tabular-nums">
                {analytics.zenVerifiedCount}
              </div>
              <div className="mt-1 text-xs text-zinc-500 font-mono tabular-nums">
                Ошибок отправки: {analytics.failedCount}
              </div>
            </div>

            <div className="rounded-lg border border-stone-200 bg-white p-5">
              <div className="text-xs text-zinc-500">Просмотры / Дочитывания (ручн.)</div>
              {analytics.hasExternalStats ? (
                <>
                  <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900 tabular-nums">
                    {analytics.totalManualViews} / {analytics.totalManualReads}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500 font-mono tabular-nums">
                    Реакций: {analytics.totalManualReactions}
                  </div>
                </>
              ) : (
                <div className="mt-2 text-xs text-zinc-500">
                  Данных нет — введите фактические показатели при подтверждении в очереди.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-stone-200 bg-white p-5 text-xs text-zinc-600">
            Аналитика отражает только фактически зафиксированные операции внутри MELO_LOVE и
            внесённые владельцем показатели Дзен Студии. Сторонняя статистика никогда не
            симулируется.
          </div>
        </div>
      )}
    </div>
  );
};
