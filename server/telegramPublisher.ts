import { PublicationItem, PublishingSettings } from '../src/shared/types.js';
import {
  formatPublicationForTelegram,
  measurePublicationLength,
  TELEGRAM_CAPTION_MAX_CHARS,
  TELEGRAM_SAFE_CHAR_LIMIT,
} from '../src/shared/publishingUtils.js';
import {
  appendPublishingLog,
  loadPublications,
  loadPublishingSettings,
  savePublications,
} from './publishingStorage.js';
import { publishPostToVk } from './vkPublisher.js';

export interface TelegramSendResult {
  mode: 'dry_run' | 'live';
  ok: boolean;
  publication: PublicationItem;
  formattedPreview: string;
  messageId?: number;
  note: string;
}

function maskToken(text: string, token: string): string {
  if (!token) return text;
  return text.split(token).join('[REDACTED_TOKEN]');
}

export function resolveTelegramCredentials(settings: PublishingSettings): {
  botToken: string;
  channelId: string;
} {
  const rawToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
  const botToken = rawToken === 'MY_TELEGRAM_BOT_TOKEN' ? '' : rawToken;
  const rawChannel =
    process.env.TELEGRAM_CHANNEL_ID?.trim() || settings.telegramChannelRef?.trim() || '';
  const channelId = rawChannel === 'MY_TELEGRAM_CHANNEL_ID' ? '' : rawChannel;
  return { botToken, channelId };
}

export function validateBeforeTelegramSend(pub: PublicationItem): {
  ok: boolean;
  reason?: string;
  formattedText: string;
} {
  const alreadyDispatchedStatuses = new Set([
    'sending',
    'sent_to_telegram',
    'zen_delivery_unconfirmed',
    'zen_delivery_verified',
  ]);
  if (alreadyDispatchedStatuses.has(pub.status) || pub.telegramMessageId) {
    return {
      ok: false,
      reason: `Повторная отправка заблокирована: публикация ${pub.publicationId} уже имеет статус "${pub.status}"${
        pub.telegramMessageId ? ` (Telegram message_id: ${pub.telegramMessageId})` : ''
      }.`,
      formattedText: '',
    };
  }

  const length = measurePublicationLength({
    title: pub.title,
    body: pub.body,
    closingQuestion: pub.closingQuestion,
    hashtags: pub.hashtags,
    safeLimit: TELEGRAM_SAFE_CHAR_LIMIT,
  });

  if (length.exceedsSafeLimit) {
    return {
      ok: false,
      reason: `Автоматическая отправка заблокирована: длина материала ${length.totalChars} симв. превышает безопасный лимит ${TELEGRAM_SAFE_CHAR_LIMIT} симв. Сократите текст или экспортируйте его для ручной публикации в Дзене.`,
      formattedText: length.formattedText,
    };
  }

  if (pub.hasImageAttachment && length.totalChars > TELEGRAM_CAPTION_MAX_CHARS) {
    return {
      ok: false,
      reason: `Публикация отмечена как пост с изображением: Telegram ограничивает подпись к фото (caption) ${TELEGRAM_CAPTION_MAX_CHARS} символами (у вас ${length.totalChars}). Нельзя отправлять длинную статью как подпись к картинке — снимите отметку «как caption» или опубликуйте вручную в Дзене.`,
      formattedText: length.formattedText,
    };
  }

  if (!pub.title.trim() || !pub.body.trim()) {
    return {
      ok: false,
      reason: 'Заголовок и текст публикации не могут быть пустыми.',
      formattedText: length.formattedText,
    };
  }

  return { ok: true, formattedText: length.formattedText };
}

export async function dispatchPublicationToTelegram(
  publicationId: string,
  options?: { dryRunOverride?: boolean; fetchImpl?: typeof fetch }
): Promise<TelegramSendResult> {
  const items = loadPublications();
  const idx = items.findIndex((p) => p.publicationId === publicationId);
  if (idx === -1) {
    throw Object.assign(new Error('Публикация не найдена'), { status: 404 });
  }

  const current = items[idx];
  const settings = loadPublishingSettings();
  const validation = validateBeforeTelegramSend(current);

  if (!validation.ok) {
    throw Object.assign(new Error(validation.reason || 'Ошибка валидации перед отправкой'), {
      status: 400,
    });
  }

  const isDryRun =
    options?.dryRunOverride !== undefined
      ? options.dryRunOverride
      : settings.dryRunMode || !settings.autoSendEnabled;

  if (isDryRun) {
    appendPublishingLog({
      publicationId: current.publicationId,
      action: 'dry_run_check',
      status: current.status,
      detail: `Тестовая проверка (без реальной отправки): ${validation.formattedText.length}/${TELEGRAM_SAFE_CHAR_LIMIT} симв. Статус не изменён.`,
    });

    return {
      mode: 'dry_run',
      ok: true,
      publication: current,
      formattedPreview: validation.formattedText,
      note: 'Тестовый режим (Dry-Run): сообщение прошло все проверки (включая лимит 3800 символов), но в Telegram не отправлялось.',
    };
  }

  const { botToken, channelId } = resolveTelegramCredentials(settings);
  if (!botToken || botToken === 'MY_TELEGRAM_BOT_TOKEN') {
    throw Object.assign(
      new Error(
        'Telegram пока не подключён (не задан TELEGRAM_BOT_TOKEN). Редактор, проверки и Dry-Run работают без токена; добавьте токен позже в Secrets или .env сервера.'
      ),
      { status: 400 }
    );
  }
  if (!channelId) {
    throw Object.assign(
      new Error('Не указан публичный Telegram-канал (укажите @username в настройках Content Studio или TELEGRAM_CHANNEL_ID на сервере).'),
      { status: 400 }
    );
  }

  // Mark sending atomically before network request for crash/idempotency safety
  const nowStart = new Date().toISOString();
  items[idx] = {
    ...current,
    status: 'sending',
    error: undefined,
    updatedAt: nowStart,
  };
  savePublications(items);

  const fetchFn = options?.fetchImpl || fetch;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    const response = await fetchFn(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: channelId,
          text: validation.formattedText,
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      }
    );
    clearTimeout(timer);

    const rawText = await response.text();
    let parsed: { ok?: boolean; description?: string; error_code?: number; result?: { message_id?: number; chat?: { id?: number | string } } } = {};
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = { ok: false, description: rawText.slice(0, 200) };
    }

    if (!response.ok || !parsed.ok || !parsed.result?.message_id) {
      const errDetail = maskToken(
        parsed.description || `HTTP ${response.status} от Telegram Bot API`,
        botToken
      );
      const fresh = loadPublications();
      const fIdx = fresh.findIndex((p) => p.publicationId === publicationId);
      if (fIdx !== -1) {
        fresh[fIdx] = {
          ...fresh[fIdx],
          status: 'failed',
          error: errDetail,
          updatedAt: new Date().toISOString(),
        };
        savePublications(fresh);
      }
      appendPublishingLog({
        publicationId,
        action: 'telegram_send_failed',
        status: 'failed',
        detail: errDetail,
      });
      throw Object.assign(new Error(`Ошибка Telegram API: ${errDetail}`), {
        status: response.status >= 400 ? response.status : 502,
      });
    }

    const messageId = parsed.result.message_id;
    const chatIdStr = String(parsed.result.chat?.id ?? channelId);
    const sentAt = new Date().toISOString();

    const fresh = loadPublications();
    const fIdx = fresh.findIndex((p) => p.publicationId === publicationId);
    // Critical invariant: Telegram success NEVER sets zen_delivery_verified!
    const updatedItem: PublicationItem = {
      ...(fIdx !== -1 ? fresh[fIdx] : current),
      status: 'zen_delivery_unconfirmed',
      telegramMessageId: messageId,
      telegramChatId: chatIdStr,
      sentToTelegramAt: sentAt,
      error: undefined,
      updatedAt: sentAt,
    };
    if (fIdx !== -1) {
      fresh[fIdx] = updatedItem;
      savePublications(fresh);
    }

    appendPublishingLog({
      publicationId,
      action: 'telegram_sent',
      status: 'zen_delivery_unconfirmed',
      detail: `Отправлено в Telegram (message_id=${messageId}). Ожидает фактического подтверждения выхода в Дзене.`,
    });

    const vkResult = await publishPostToVk({
      text: validation.formattedText,
      fetchImpl: options?.fetchImpl,
    });

    if (vkResult.ok && vkResult.postId) {
      appendPublishingLog({
        publicationId,
        action: 'vk_sent',
        status: 'vk_published',
        detail: `Дублировано на стену ВК (post_id=${vkResult.postId}).`,
      });
    } else if (!vkResult.skipped) {
      appendPublishingLog({
        publicationId,
        action: 'vk_send_failed',
        status: 'vk_failed',
        detail: `Не удалось продублировать в ВК: ${vkResult.error}`,
      });
    }

    return {
      mode: 'live',
      ok: true,
      publication: updatedItem,
      formattedPreview: validation.formattedText,
      messageId,
      note: 'Отправлено в Telegram. Статус установлен в zen_delivery_unconfirmed до подтверждения публикации в Дзене.',
    };
  } catch (err) {

    if ((err as { status?: number }).status) throw err;
    const safeMsg = maskToken(err instanceof Error ? err.message : 'Сетевой сбой Telegram API', botToken);
    const fresh = loadPublications();
    const fIdx = fresh.findIndex((p) => p.publicationId === publicationId);
    if (fIdx !== -1 && fresh[fIdx].status === 'sending') {
      fresh[fIdx] = {
        ...fresh[fIdx],
        status: 'failed',
        error: safeMsg,
        updatedAt: new Date().toISOString(),
      };
      savePublications(fresh);
    }
    appendPublishingLog({
      publicationId,
      action: 'telegram_send_error',
      status: 'failed',
      detail: safeMsg,
    });
    throw Object.assign(new Error(`Сбой отправки в Telegram: ${safeMsg}`), { status: 502 });
  }
}

export async function processDueScheduledPublications(options?: {
  fetchImpl?: typeof fetch;
}): Promise<{ processed: number; sent: number; failed: number; skippedDryRun: number }> {
  const settings = loadPublishingSettings();
  const items = loadPublications();
  const nowMs = Date.now();

  const due = items.filter(
    (p) =>
      p.status === 'scheduled' &&
      (!p.scheduledAt || new Date(p.scheduledAt).getTime() <= nowMs)
  );

  const { botToken, channelId } = resolveTelegramCredentials(settings);
  const telegramReady = Boolean(botToken && channelId);
  const wantLive = !settings.dryRunMode && settings.autoSendEnabled;

  if (due.length > 0 && wantLive && !telegramReady) {
    appendPublishingLog({
      publicationId: 'QUEUE',
      action: 'process_due_queue',
      status: 'pending_telegram_setup',
      detail: `Запланировано публикаций: ${due.length}. Telegram пока не подключён (не заданы TELEGRAM_BOT_TOKEN или канал) — отправка отложена без ошибок.`,
    });
    return { processed: due.length, sent: 0, failed: 0, skippedDryRun: due.length };
  }

  let sent = 0;
  let failed = 0;
  let skippedDryRun = 0;

  for (const pub of due) {
    try {
      const res = await dispatchPublicationToTelegram(pub.publicationId, {
        fetchImpl: options?.fetchImpl,
      });
      if (res.mode === 'dry_run') {
        skippedDryRun++;
      } else {
        sent++;
      }
    } catch {
      failed++;
    }
  }

  if (due.length > 0) {
    appendPublishingLog({
      publicationId: 'QUEUE',
      action: 'process_due_queue',
      status: settings.dryRunMode || !settings.autoSendEnabled ? 'dry_run' : 'completed',
      detail: `Обработано запланированных: ${due.length} (отправлено: ${sent}, dry-run: ${skippedDryRun}, ошибок: ${failed}).`,
    });
  }

  return { processed: due.length, sent, failed, skippedDryRun };
}

export async function testTelegramConnection(): Promise<{
  ok: boolean;
  botUsername?: string;
  channelTitle?: string;
  channelType?: string;
  note: string;
}> {
  const settings = loadPublishingSettings();
  const { botToken, channelId } = resolveTelegramCredentials(settings);
  if (!botToken || botToken === 'MY_TELEGRAM_BOT_TOKEN') {
    return {
      ok: false,
      note: 'Telegram пока не подключён (TELEGRAM_BOT_TOKEN не задан). Редактор, очереди и Dry-Run работают без токена — добавьте токен позже в Secrets или .env сервера.',
    };
  }

  try {
    const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const meJson = (await meRes.json()) as { ok?: boolean; result?: { username?: string }; description?: string };
    if (!meJson.ok) {
      return { ok: false, note: `Неверный токен бота: ${maskToken(meJson.description || '', botToken)}` };
    }

    let channelTitle: string | undefined;
    let channelType: string | undefined;
    if (channelId) {
      const chatRes = await fetch(
        `https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(channelId)}`
      );
      const chatJson = (await chatRes.json()) as {
        ok?: boolean;
        result?: { title?: string; type?: string };
        description?: string;
      };
      if (!chatJson.ok) {
        return {
          ok: false,
          botUsername: meJson.result?.username,
          note: `Бот @${meJson.result?.username} активен, но канал ${channelId} недоступен: ${maskToken(chatJson.description || '', botToken)}`,
        };
      }
      channelTitle = chatJson.result?.title;
      channelType = chatJson.result?.type;
      if (channelType !== 'channel') {
        return {
          ok: false,
          botUsername: meJson.result?.username,
          channelTitle,
          channelType,
          note: `Внимание: "${channelTitle}" имеет тип "${channelType}". Для синхронизации с Дзеном нужен именно публичный Telegram-КАНАЛ (channel).`,
        };
      }
    }

    return {
      ok: true,
      botUsername: meJson.result?.username,
      channelTitle,
      channelType,
      note: channelTitle
        ? `Бот @${meJson.result?.username} видит публичный канал «${channelTitle}».`
        : `Бот @${meJson.result?.username} активен (канал ещё не указан).`,
    };
  } catch (err) {
    return {
      ok: false,
      note: maskToken(err instanceof Error ? err.message : 'Ошибка соединения с Telegram API', botToken),
    };
  }
}
