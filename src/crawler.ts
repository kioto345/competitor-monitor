import axios from 'axios';
import * as cheerio from 'cheerio';
import { Competitor } from './types';

const DEFAULT_MAX_PAGES = 300;
const DEFAULT_MAX_DEPTH = 3;
const SKIP_EXTENSIONS = /\.(pdf|jpg|jpeg|png|gif|svg|webp|zip|rar|7z|mp4|mp3|avi|mov|doc|docx|xls|xlsx|ppt|pptx|css|js|json|xml|ico|woff|woff2|ttf|eot)$/i;
const USER_AGENT = 'Mozilla/5.0 (compatible; CompetitorMonitorBot/1.0)';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestDelayMs(): number {
  const v = Number(process.env.REQUEST_DELAY_MS);
  return Number.isFinite(v) && v >= 0 ? v : 800;
}

function normalizeUrl(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    u.protocol = u.protocol.toLowerCase();
    if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) {
      u.port = '';
    }
    let pathname = u.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    u.pathname = pathname;
    let result = u.toString();
    if (result.endsWith('/') && u.pathname === '') {
      result = result.slice(0, -1);
    }
    return result;
  } catch {
    return null;
  }
}

function isSkippable(rawUrl: string): boolean {
  if (!rawUrl) return true;
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith('#') || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:') || trimmed.startsWith('javascript:')) {
    return true;
  }
  if (SKIP_EXTENSIONS.test(trimmed.split('?')[0].split('#')[0])) {
    return true;
  }
  return false;
}

async function fetchXml(url: string): Promise<string | null> {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': USER_AGENT },
      validateStatus: (s) => s >= 200 && s < 300,
    });
    if (typeof res.data === 'string') return res.data;
    return null;
  } catch {
    return null;
  }
}

async function collectFromSitemap(baseUrl: string, log: (msg: string) => void): Promise<string[] | null> {
  const sitemapUrl = `${baseUrl}/sitemap.xml`;
  const rootXml = await fetchXml(sitemapUrl);
  if (!rootXml) return null;

  const urls = new Set<string>();
  const sitemapQueue: string[] = [sitemapUrl];
  const visitedSitemaps = new Set<string>();
  let first = true;

  while (sitemapQueue.length > 0) {
    const current = sitemapQueue.shift()!;
    if (visitedSitemaps.has(current)) continue;
    visitedSitemaps.add(current);

    const xml = first ? rootXml : await fetchXml(current);
    first = false;
    if (!xml) continue;

    const $ = cheerio.load(xml, { xmlMode: true });

    const sitemapLocs = $('sitemapindex > sitemap > loc');
    if (sitemapLocs.length > 0) {
      sitemapLocs.each((_, el) => {
        const loc = $(el).text().trim();
        if (loc) sitemapQueue.push(loc);
      });
      continue;
    }

    $('urlset > url > loc').each((_, el) => {
      const loc = $(el).text().trim();
      const normalized = loc ? normalizeUrl(loc) : null;
      if (normalized && !isSkippable(normalized)) {
        urls.add(normalized);
      }
    });
  }

  if (urls.size === 0) return null;
  log(`sitemap найден, собрано ${urls.size} URL`);
  return Array.from(urls);
}

async function crawlRecursive(competitor: Competitor, log: (msg: string) => void): Promise<string[]> {
  const maxPages = competitor.maxPages ?? DEFAULT_MAX_PAGES;
  const maxDepth = competitor.maxDepth ?? DEFAULT_MAX_DEPTH;
  const startUrl = normalizeUrl(competitor.url);
  if (!startUrl) return [];

  const startHost = new URL(startUrl).hostname;
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }];
  const collected: string[] = [];
  const delayMs = requestDelayMs();

  while (queue.length > 0 && collected.length < maxPages) {
    const { url, depth } = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    let html: string;
    try {
      const res = await axios.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': USER_AGENT },
        validateStatus: (s) => s >= 200 && s < 400,
      });
      html = typeof res.data === 'string' ? res.data : '';
    } catch (err: any) {
      log(`Пропуск ${url}: ${err?.message ?? 'ошибка запроса'}`);
      continue;
    }

    collected.push(url);

    if (depth < maxDepth) {
      const $ = cheerio.load(html);
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href || isSkippable(href)) return;
        let absolute: string;
        try {
          absolute = new URL(href, url).toString();
        } catch {
          return;
        }
        const normalized = normalizeUrl(absolute);
        if (!normalized) return;
        let host: string;
        try {
          host = new URL(normalized).hostname;
        } catch {
          return;
        }
        if (host !== startHost) return;
        if (!visited.has(normalized)) {
          queue.push({ url: normalized, depth: depth + 1 });
        }
      });
    }

    if (delayMs > 0) await delay(delayMs);
  }

  return collected;
}

export async function crawl(competitor: Competitor, log: (msg: string) => void = () => {}): Promise<string[]> {
  const sitemapUrls = await collectFromSitemap(competitor.url, log);
  if (sitemapUrls && sitemapUrls.length > 0) {
    const maxPages = competitor.maxPages ?? DEFAULT_MAX_PAGES;
    return sitemapUrls.slice(0, maxPages);
  }
  log('sitemap недоступен или пуст, запускаю рекурсивный краулер');
  return crawlRecursive(competitor, log);
}
