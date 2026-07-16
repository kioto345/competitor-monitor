import axios from 'axios';
import * as cheerio from 'cheerio';
import { Competitor } from './types';

const DEFAULT_MAX_PAGES = 300;
const DEFAULT_MAX_DEPTH = 3;
const REQUEST_TIMEOUT_MS = 15000;
const SKIP_EXTENSIONS = [
  '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.zip', '.rar',
  '.7z', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.mp3', '.mp4',
  '.avi', '.mov', '.css', '.js', '.json', '.xml', '.woff', '.woff2', '.ttf',
  '.ico',
];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, '');
}

function shouldSkipLink(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('#')) return true;
  if (trimmed.startsWith('mailto:')) return true;
  if (trimmed.startsWith('tel:')) return true;
  if (trimmed.startsWith('javascript:')) return true;
  const withoutQuery = trimmed.split('?')[0].split('#')[0].toLowerCase();
  if (SKIP_EXTENSIONS.some((ext) => withoutQuery.endsWith(ext))) return true;
  return false;
}

function resolveUrl(base: string, href: string): string | null {
  try {
    const resolved = new URL(href, base);
    resolved.hash = '';
    return resolved.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function isSameDomain(url: string, baseHost: string): boolean {
  try {
    return new URL(url).host === baseHost;
  } catch {
    return false;
  }
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await axios.get(url, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'User-Agent': 'CompetitorMonitorBot/1.0' },
      validateStatus: (status) => status >= 200 && status < 400,
    });
    return typeof res.data === 'string' ? res.data : String(res.data);
  } catch {
    return null;
  }
}

async function collectSitemapUrls(sitemapUrl: string, delayMs: number, seen: Set<string>): Promise<string[]> {
  if (seen.has(sitemapUrl)) return [];
  seen.add(sitemapUrl);

  const xml = await fetchText(sitemapUrl);
  if (!xml) return [];

  const $ = cheerio.load(xml, { xmlMode: true });
  const urls: string[] = [];

  const sitemapEntries = $('sitemapindex > sitemap > loc');
  if (sitemapEntries.length > 0) {
    const nestedSitemaps = sitemapEntries
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    for (const nested of nestedSitemaps) {
      await delay(delayMs);
      const nestedUrls = await collectSitemapUrls(nested, delayMs, seen);
      urls.push(...nestedUrls);
    }
    return urls;
  }

  $('urlset > url > loc').each((_, el) => {
    const loc = $(el).text().trim();
    if (loc) urls.push(loc.replace(/\/+$/, ''));
  });

  return urls;
}

async function crawlSitemap(baseUrl: string, delayMs: number): Promise<string[]> {
  const sitemapUrl = `${baseUrl}/sitemap.xml`;
  const urls = await collectSitemapUrls(sitemapUrl, delayMs, new Set());
  return Array.from(new Set(urls));
}

async function crawlRecursive(
  baseUrl: string,
  maxDepth: number,
  maxPages: number,
  delayMs: number
): Promise<string[]> {
  const baseHost = new URL(baseUrl).host;
  const visited = new Set<string>();
  const collected: string[] = [];
  let queue: { url: string; depth: number }[] = [{ url: baseUrl, depth: 0 }];

  while (queue.length > 0 && collected.length < maxPages) {
    const { url, depth } = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    await delay(delayMs);
    const html = await fetchText(url);
    if (html === null) continue;

    collected.push(url);
    if (collected.length >= maxPages) break;
    if (depth >= maxDepth) continue;

    const $ = cheerio.load(html);
    const nextLinks: string[] = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (shouldSkipLink(href)) return;
      const resolved = resolveUrl(url, href);
      if (!resolved) return;
      if (!isSameDomain(resolved, baseHost)) return;
      if (visited.has(resolved)) return;
      nextLinks.push(resolved);
    });

    for (const link of nextLinks) {
      if (!visited.has(link) && !queue.some((q) => q.url === link)) {
        queue.push({ url: link, depth: depth + 1 });
      }
    }
  }

  return collected.slice(0, maxPages);
}

export async function crawl(competitor: Competitor): Promise<string[]> {
  const baseUrl = normalizeBase(competitor.url);
  const maxDepth = competitor.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxPages = competitor.maxPages ?? DEFAULT_MAX_PAGES;
  const delayMs = Number(process.env.REQUEST_DELAY_MS ?? 800);

  const sitemapUrls = await crawlSitemap(baseUrl, delayMs);
  if (sitemapUrls.length > 0) {
    return sitemapUrls.slice(0, maxPages);
  }

  return crawlRecursive(baseUrl, maxDepth, maxPages, delayMs);
}
