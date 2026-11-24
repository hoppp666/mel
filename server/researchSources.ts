import type { ResearchSource } from '../src/shared/types.ts';

const BOT_USER_AGENT = 'MELO_LOVE_ResearchAssistant/1.0 (respectful editorial research)';

export interface DiscoveredRawMaterial {
  sourceId: string;
  sourceName: string;
  sourceType: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceAuthor: string;
  sourceDate: string;
  originalLanguage: string;
  snippet: string;
  reliability: 'direct_feed' | 'search_grounded' | 'verified_url';
}

export function extractDomainFromUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

async function fetchWithTimeout(
  url: string,
  timeoutMs = 7000,
  accept = 'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8'
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': BOT_USER_AGENT,
        Accept: accept,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function parseRobotsAllowsPath(robotsTxt: string, targetPathname: string): boolean {
  const lines = robotsTxt.split(/\r?\n/);
  let inStarBlock = false;
  let foundSpecificRules = false;
  const disallows: string[] = [];
  const allows: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (key === 'user-agent') {
      const ua = value.toLowerCase();
      if (ua === '*') {
        inStarBlock = true;
        foundSpecificRules = true;
      } else {
        inStarBlock = false;
      }
      continue;
    }

    if (inStarBlock) {
      if (key === 'disallow' && value) {
        disallows.push(value);
      } else if (key === 'allow' && value) {
        allows.push(value);
      }
    }
  }

  if (!foundSpecificRules) return true;

  // Longest matching rule wins
  let bestAllowLen = -1;
  for (const rule of allows) {
    if (targetPathname.startsWith(rule) && rule.length > bestAllowLen) {
      bestAllowLen = rule.length;
    }
  }

  let bestDisallowLen = -1;
  for (const rule of disallows) {
    if (rule === '/' || targetPathname.startsWith(rule)) {
      if (rule.length > bestDisallowLen) {
        bestDisallowLen = rule.length;
      }
    }
  }

  if (bestDisallowLen === -1) return true;
  return bestAllowLen >= bestDisallowLen;
}

export async function checkRobotsPermission(targetUrl: string): Promise<{
  checked: boolean;
  allowed: boolean;
  note: string;
}> {
  try {
    const parsed = new URL(targetUrl);
    const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`;
    const res = await fetchWithTimeout(robotsUrl, 5000, 'text/plain');
    if (res.status === 404) {
      return { checked: true, allowed: true, note: 'robots.txt отсутствует (404)' };
    }
    if (!res.ok) {
      return {
        checked: false,
        allowed: false,
        note: `robots.txt недоступен (HTTP ${res.status})`,
      };
    }
    const text = await res.text();
    const allowed = parseRobotsAllowsPath(text, parsed.pathname || '/');
    return {
      checked: true,
      allowed,
      note: allowed
        ? 'robots.txt разрешает чтение пути'
        : 'robots.txt ограничивает автоматическое чтение пути',
    };
  } catch (err) {
    return {
      checked: false,
      allowed: false,
      note: `Не удалось проверить robots.txt: ${(err as Error).message}`,
    };
  }
}

export async function probeSourceAvailability(
  source: ResearchSource
): Promise<ResearchSource> {
  const now = new Date().toISOString();
  const robots = await checkRobotsPermission(source.url);

  if (robots.checked && !robots.allowed) {
    return {
      ...source,
      robotsAllowed: false,
      availabilityStatus: 'restricted',
      availabilityMessage: `${robots.note}. Прямой обход не выполняется; исследование возможно только через Google Search Grounding.`,
      lastCheckedAt: now,
      updatedAt: now,
    };
  }

  try {
    const res = await fetchWithTimeout(source.url, 7000);
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      return {
        ...source,
        robotsAllowed: robots.allowed,
        availabilityStatus: 'restricted',
        availabilityMessage: `Площадка вернула HTTP ${res.status} (ограничение доступа/авторизация/лимит). Прямой обход не выполняется; доступен поиск через Google Search Grounding.`,
        lastCheckedAt: now,
        updatedAt: now,
      };
    }

    if (!res.ok) {
      return {
        ...source,
        robotsAllowed: robots.allowed,
        availabilityStatus: 'unavailable',
        availabilityMessage: `Страница вернула HTTP ${res.status} (${res.statusText || 'ошибка'})`,
        lastCheckedAt: now,
        updatedAt: now,
      };
    }

    const bodySample = (await res.text()).slice(0, 6000).toLowerCase();
    const hasChallenge =
      bodySample.includes('captcha') ||
      bodySample.includes('cf-browser-verification') ||
      bodySample.includes('just a moment') ||
      bodySample.includes('enable javascript and cookies to continue');

    if (hasChallenge) {
      return {
        ...source,
        robotsAllowed: robots.allowed,
        availabilityStatus: 'restricted',
        availabilityMessage:
          'Обнаружена защита от автоматических запросов (CAPTCHA / проверка браузера). Обход не применяется.',
        lastCheckedAt: now,
        updatedAt: now,
      };
    }

    return {
      ...source,
      robotsAllowed: robots.allowed,
      availabilityStatus: 'available',
      availabilityMessage: `Доступен напрямую (HTTP ${res.status}, ${robots.note})`,
      lastCheckedAt: now,
      updatedAt: now,
    };
  } catch (err) {
    return {
      ...source,
      robotsAllowed: robots.allowed,
      availabilityStatus: 'unavailable',
      availabilityMessage: `Сетевая ошибка или таймаут: ${(err as Error).message}`,
      lastCheckedAt: now,
      updatedAt: now,
    };
  }
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchDirectPublicFeedMaterials(
  source: ResearchSource,
  maxItems: number
): Promise<{
  ok: boolean;
  reason: string;
  items: DiscoveredRawMaterial[];
}> {
  // Strictly check robots.txt first
  const robots = await checkRobotsPermission(source.url);
  if (robots.checked && !robots.allowed) {
    return {
      ok: false,
      reason: `${source.name}: ${robots.note}`,
      items: [],
    };
  }

  // Only attempt public RSS / JSON feeds for Reddit or RSS endpoints; no scraping bypass
  const normalizedUrl = source.url.replace(/\/+$/, '');
  if (source.platform === 'reddit' || normalizedUrl.includes('reddit.com/r/')) {
    const rssUrl = `${normalizedUrl}/.rss`;
    try {
      const res = await fetchWithTimeout(rssUrl, 7000, 'application/atom+xml,application/xml,text/xml');
      if (!res.ok) {
        return {
          ok: false,
          reason: `${source.name} RSS вернул HTTP ${res.status}`,
          items: [],
        };
      }
      const xml = await res.text();
      if (!xml.includes('<entry>')) {
        return {
          ok: false,
          reason: `${source.name} не вернул открытую Atom/RSS-ленту`,
          items: [],
        };
      }

      const entries = xml.split('<entry>').slice(1);
      const items: DiscoveredRawMaterial[] = [];

      for (const entry of entries) {
        if (items.length >= maxItems) break;
        const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/i);
        const linkMatch = entry.match(/<link[^>]+href="([^"]+)"/i);
        const authorMatch = entry.match(/<author>\s*<name>([\s\S]*?)<\/name>/i);
        const updatedMatch = entry.match(/<updated>([\s\S]*?)<\/updated>/i);
        const contentMatch = entry.match(/<content[^>]*>([\s\S]*?)<\/content>/i);

        const url = linkMatch?.[1]?.trim() || '';
        const title = decodeHtmlEntities(titleMatch?.[1] || '');
        if (!url || !title) continue;

        const rawContent = decodeHtmlEntities(contentMatch?.[1] || '').slice(0, 1200);
        items.push({
          sourceId: source.id,
          sourceName: source.name,
          sourceType: source.sourceType,
          sourceUrl: url,
          sourceTitle: title,
          sourceAuthor: authorMatch?.[1]?.trim() || 'unknown',
          sourceDate: updatedMatch?.[1]?.trim() || 'unknown',
          originalLanguage: source.language || 'en',
          snippet: rawContent || title,
          reliability: 'direct_feed',
        });
      }

      return {
        ok: items.length > 0,
        reason: items.length > 0 ? `Получено ${items.length} записей из публичной RSS-ленты` : 'Лента пуста',
        items,
      };
    } catch (err) {
      return {
        ok: false,
        reason: `${source.name} RSS недоступен: ${(err as Error).message}`,
        items: [],
      };
    }
  }

  // Respectful open HTML / RSS reader for available media & custom sources (no auth/CAPTCHA bypass)
  try {
    const res = await fetchWithTimeout(source.url, 8000);
    if (!res.ok) {
      return {
        ok: false,
        reason: `${source.name} вернул HTTP ${res.status}`,
        items: [],
      };
    }

    const body = await res.text();
    const lowerSample = body.slice(0, 6000).toLowerCase();
    if (
      lowerSample.includes('captcha') ||
      lowerSample.includes('cf-browser-verification') ||
      lowerSample.includes('just a moment')
    ) {
      return {
        ok: false,
        reason: `${source.name}: обнаружена CAPTCHA/проверка, обход не выполняется`,
        items: [],
      };
    }

    // 1. Standard RSS / Atom check if user added an RSS feed
    if (body.includes('<item>') || body.includes('<entry>')) {
      const blocks = body.includes('<entry>') ? body.split('<entry>').slice(1) : body.split('<item>').slice(1);
      const items: DiscoveredRawMaterial[] = [];
      for (const blk of blocks) {
        if (items.length >= maxItems) break;
        const t = decodeHtmlEntities(blk.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
        const linkAttr = blk.match(/<link[^>]+href="([^"]+)"/i)?.[1];
        const linkText = blk.match(/<link>([\s\S]*?)<\/link>/i)?.[1];
        const url = (linkAttr || linkText || '').trim();
        if (!t || !url.startsWith('http')) continue;
        const author = decodeHtmlEntities(
          blk.match(/<author[^>]*>[\s\S]*?<name>([\s\S]*?)<\/name>/i)?.[1] ||
            blk.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i)?.[1] ||
            ''
        );
        const pubDate = decodeHtmlEntities(
          blk.match(/<(?:pubDate|updated|published)>([\s\S]*?)<\/(?:pubDate|updated|published)>/i)?.[1] || ''
        );
        const desc = decodeHtmlEntities(
          blk.match(/<(?:description|summary|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i)?.[1] ||
            ''
        ).slice(0, 1200);

        items.push({
          sourceId: source.id,
          sourceName: source.name,
          sourceType: source.sourceType,
          sourceUrl: url,
          sourceTitle: t,
          sourceAuthor: author || 'unknown',
          sourceDate: pubDate || 'unknown',
          originalLanguage: source.language || 'en',
          snippet: desc || t,
          reliability: 'direct_feed',
        });
      }
      if (items.length > 0) {
        return {
          ok: true,
          reason: `${source.name}: получено ${items.length} записей из открытой RSS/Atom-ленты`,
          items,
        };
      }
    }

    // 2. HTML editorial index extraction (same domain, real article URLs)
    const baseParsed = new URL(source.url);
    const baseHost = baseParsed.hostname.replace(/^www\./, '').toLowerCase();
    const anchorMatches = Array.from(body.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi));

    const candidateLinks: Array<{ url: string; anchorTitle: string }> = [];
    const seenUrls = new Set<string>();

    const RELATIONSHIP_HINT_RE =
      /(relationship|marriage|couple|partner|husband|wife|love|dating|divorce|wedding|family|boundary|boundaries|argue|argument|trust|jealous|in-law|stocking|gift|money|affair|ex-|boyfriend|girlfriend|spouse)/i;
    const NOISE_HREF_RE =
      /(\/tests\/|\/account|\/login|\/subscribe|\/newsletter|\/author\/|\/tag\/|\/tags\/|\/topics?\/|origin=top-ad|trump|pentagon|senate|congress|ufo|election)/i;

    for (const match of anchorMatches) {
      let href = match[1].trim();
      const anchorTitle = decodeHtmlEntities(match[2] || '');
      if (!href || anchorTitle.length < 24 || href.startsWith('#') || href.startsWith('javascript:')) {
        continue;
      }
      if (href.startsWith('/')) {
        href = `${baseParsed.protocol}//${baseParsed.host}${href}`;
      } else if (!href.startsWith('http')) {
        continue;
      }

      let parsedLink: URL;
      try {
        parsedLink = new URL(href);
      } catch {
        continue;
      }
      const linkHost = parsedLink.hostname.replace(/^www\./, '').toLowerCase();
      if (linkHost !== baseHost && !linkHost.endsWith(`.${baseHost}`)) continue;
      parsedLink.search = '';
      parsedLink.hash = '';
      const cleanUrl = parsedLink.toString();
      if (cleanUrl.replace(/\/+$/, '') === source.url.replace(/\/+$/, '')) continue;
      if (NOISE_HREF_RE.test(cleanUrl) || NOISE_HREF_RE.test(match[1])) continue;
      if (parsedLink.pathname.split('/').filter(Boolean).length < 2) continue;

      // Require relationship relevance for broad news domains like huffpost
      if (baseHost.includes('huffpost.com') && !RELATIONSHIP_HINT_RE.test(anchorTitle)) {
        continue;
      }
      if (seenUrls.has(cleanUrl)) continue;
      seenUrls.add(cleanUrl);
      candidateLinks.push({ url: cleanUrl, anchorTitle });
      if (candidateLinks.length >= maxItems * 2) break;
    }

    const items: DiscoveredRawMaterial[] = [];
    for (const cand of candidateLinks) {
      if (items.length >= maxItems) break;
      try {
        const artRobots = await checkRobotsPermission(cand.url);
        if (artRobots.checked && !artRobots.allowed) continue;

        const artRes = await fetchWithTimeout(cand.url, 7000);
        if (!artRes.ok) continue;
        const artHtml = await artRes.text();
        if (/captcha|cf-browser-verification|just a moment/i.test(artHtml.slice(0, 4000))) {
          continue;
        }

        const metaTitle =
          artHtml.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1] ||
          artHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
          cand.anchorTitle;
        const metaDesc =
          artHtml.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i)?.[1] ||
          artHtml.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i)?.[1] ||
          '';
        const metaAuthor =
          artHtml.match(/<meta[^>]+name="author"[^>]+content="([^"]+)"/i)?.[1] ||
          artHtml.match(/"author"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/i)?.[1] ||
          '';
        const metaDate =
          artHtml.match(/<meta[^>]+property="article:published_time"[^>]+content="([^"]+)"/i)?.[1] ||
          artHtml.match(/"datePublished"\s*:\s*"([^"]+)"/i)?.[1] ||
          '';

        const cleanedArticleRegion = (
          artHtml.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ||
          artHtml.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] ||
          artHtml
        )
          .replace(/<(header|nav|footer|aside|script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');

        const paragraphs = Array.from(cleanedArticleRegion.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi))
          .map((p) => decodeHtmlEntities(p[1]))
          .filter(
            (p) =>
              p.length > 70 &&
              !/^(photo|photo-illustration)\s*:/i.test(p) &&
              !/getty images|cookie|subscribe|sign up|privacy policy|vox media|menu close|latest stories|saved for later|earn a commission|may earn/i.test(
                p
              )
          )
          .slice(0, 4)
          .join(' ');

        const snippet = [decodeHtmlEntities(metaDesc), paragraphs]
          .filter(Boolean)
          .join(' — ')
          .slice(0, 1400);

        if (snippet.length < 40) continue;

        items.push({
          sourceId: source.id,
          sourceName: source.name,
          sourceType: source.sourceType,
          sourceUrl: cand.url,
          sourceTitle: decodeHtmlEntities(metaTitle),
          sourceAuthor: metaAuthor ? decodeHtmlEntities(metaAuthor) : 'unknown',
          sourceDate: metaDate ? metaDate.slice(0, 32) : 'unknown',
          originalLanguage: source.language || 'en',
          snippet,
          reliability: 'verified_url',
        });
      } catch {
        // skip unreachable article cleanly
      }
    }

    return {
      ok: items.length > 0,
      reason:
        items.length > 0
          ? `${source.name}: получено ${items.length} открытых публикаций напрямую`
          : `${source.name}: открытые публикации по теме не найдены`,
      items,
    };
  } catch (err) {
    return {
      ok: false,
      reason: `${source.name}: ошибка чтения страницы (${(err as Error).message})`,
      items: [],
    };
  }
}

// --- Compatibility Exports ---
export const checkResearchSourceAvailability = probeSourceAvailability;
export type DiscoveredPublicArticle = DiscoveredRawMaterial;
export async function fetchPublicArticlesFromSource(_source: unknown): Promise<DiscoveredRawMaterial[]> {
  return [];
}

