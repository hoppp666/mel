import { ResearchSource, ResearchSourceStatus } from '../src/shared/types.js';

export interface DiscoveredPublicArticle {
  url: string;
  title: string;
  author: string;
  publishedAt: string;
  excerpt: string;
  sourceId: string;
  sourceName: string;
}

const REQUEST_HEADERS = {
  'User-Agent': 'MELO_LOVE_ResearchBot/1.0 (+respectful-editorial-reader)',
  Accept: 'text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function fetchWithTimeout(url: string, timeoutMs = 9000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: REQUEST_HEADERS,
      redirect: 'follow',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function isPathAllowedByRobots(robotsTxt: string, targetPath: string): boolean {
  const lines = robotsTxt.split(/\r?\n/);
  let inStarBlock = false;
  const disallows: string[] = [];
  const allows: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const val = line.slice(colon + 1).trim();

    if (key === 'user-agent') {
      inStarBlock = val === '*';
    } else if (inStarBlock && key === 'disallow' && val) {
      disallows.push(val);
    } else if (inStarBlock && key === 'allow' && val) {
      allows.push(val);
    }
  }

  for (const a of allows) {
    if (a === '/' || targetPath.startsWith(a)) return true;
  }
  for (const d of disallows) {
    if (d === '/') return false;
    if (d && targetPath.startsWith(d)) return false;
  }
  return true;
}

export async function checkResearchSourceAvailability(
  source: ResearchSource
): Promise<ResearchSource> {
  const now = new Date().toISOString();
  try {
    const parsed = new URL(source.url);
    const origin = parsed.origin;
    const robotsUrl = `${origin}/robots.txt`;

    let robotsAllowed: boolean | null = true;
    try {
      const rResp = await fetchWithTimeout(robotsUrl, 6000);
      if (rResp.ok) {
        const robotsText = await rResp.text();
        robotsAllowed = isPathAllowedByRobots(robotsText, parsed.pathname || '/');
      }
    } catch {
      robotsAllowed = null;
    }

    if (robotsAllowed === false) {
      return {
        ...source,
        status: 'restricted',
        robotsAllowed: false,
        lastHttpStatus: null,
        lastError: 'robots.txt запрещает автоматический обход данного пути; доступен только поиск через Google Search Grounding.',
        lastCheckedAt: now,
      };
    }

    const pageResp = await fetchWithTimeout(source.rssUrl || source.url, 8000);
    const httpStatus = pageResp.status;

    let status: ResearchSourceStatus = 'unavailable';
    let lastError: string | undefined;

    if (httpStatus >= 200 && httpStatus < 300) {
      status = 'available';
    } else if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429) {
      status = 'restricted';
      lastError = `HTTP ${httpStatus}: источник ограничивает прямой доступ; используйте Google Search Grounding.`;
    } else {
      status = 'unavailable';
      lastError = `HTTP ${httpStatus}: страница недоступна для чтения.`;
    }

    return {
      ...source,
      status,
      robotsAllowed,
      lastHttpStatus: httpStatus,
      lastError,
      lastCheckedAt: now,
    };
  } catch (err) {
    return {
      ...source,
      status: 'unavailable',
      robotsAllowed: null,
      lastHttpStatus: null,
      lastError: err instanceof Error ? err.message : 'Сетевая ошибка при проверке источника',
      lastCheckedAt: now,
    };
  }
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  return m ? stripTags(m[1]) : '';
}

function parseRssOrAtom(
  xml: string,
  source: ResearchSource,
  limit: number
): DiscoveredPublicArticle[] {
  const items: DiscoveredPublicArticle[] = [];
  const itemMatches = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];

  for (const block of itemMatches.slice(0, limit * 2)) {
    const title = extractTag(block, 'title');
    let link = extractTag(block, 'link');
    if (!link) {
      const hrefMatch = block.match(/<link[^>]+href=["']([^"']+)["']/i);
      if (hrefMatch) link = hrefMatch[1].trim();
    }
    const author =
      extractTag(block, 'dc:creator') ||
      extractTag(block, 'author') ||
      extractTag(block, 'name');
    const publishedAt =
      extractTag(block, 'pubDate') ||
      extractTag(block, 'published') ||
      extractTag(block, 'updated');
    const rawDesc =
      extractTag(block, 'content:encoded') ||
      extractTag(block, 'description') ||
      extractTag(block, 'summary');

    if (title && link && link.startsWith('http')) {
      items.push({
        url: link,
        title,
        author: author || '',
        publishedAt: publishedAt || '',
        excerpt: rawDesc.slice(0, 1200),
        sourceId: source.id,
        sourceName: source.name,
      });
    }
    if (items.length >= limit) break;
  }

  return items;
}

export async function fetchPublicArticlesFromSource(
  source: ResearchSource,
  limit: number
): Promise<DiscoveredPublicArticle[]> {
  if (source.status === 'restricted' || source.status === 'unavailable' || source.robotsAllowed === false) {
    return [];
  }

  const targetUrl = source.rssUrl || source.url;
  const resp = await fetchWithTimeout(targetUrl, 10_000);
  if (!resp.ok) return [];

  const text = await resp.text();
  if (text.includes('<rss') || text.includes('<feed') || text.includes('<item')) {
    return parseRssOrAtom(text, source, limit);
  }

  // Fallback for open editorial HTML index: extract clean article links
  const baseOrigin = new URL(source.url).origin;
  const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set<string>();
  const results: DiscoveredPublicArticle[] = [];
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(text)) !== null) {
    const href = match[1].trim();
    const label = stripTags(match[2]);
    if (label.length < 28 || label.length > 180) continue;
    let absUrl = href;
    if (href.startsWith('/')) absUrl = `${baseOrigin}${href}`;
    if (!absUrl.startsWith('http') || seen.has(absUrl)) continue;
    if (/login|signup|subscribe|privacy|terms|tag\/|category\//i.test(absUrl)) continue;
    seen.add(absUrl);

    results.push({
      url: absUrl,
      title: label,
      author: '',
      publishedAt: '',
      excerpt: label,
      sourceId: source.id,
      sourceName: source.name,
    });
    if (results.length >= limit) break;
  }

  return results;
}
