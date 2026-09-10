import axios from 'axios';
import * as cheerio from 'cheerio';
import { Competitor } from './types';

const DEFAULT_MAX_PAGES = 300;
const DEFAULT_MAX_DEPTH = 3;
const SKIP_EXTENSIONS = /\.(pdf|jpg|jpeg|png|gif|svg|zip|rar|7z|mp4|mp3|avi|mov|doc|docx|xls|xlsx|ppt|pptx|css|js|json|xml|webp|ico|woff|woff2|ttf)$/i;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestDelayMs(): number {
  const v = parseInt(process.env.REQUEST_DELAY_MS || '800', 10);
  return Number.isFinite(v) && v >= 0 ? v : 800;
}

function normalizeUrl(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    let pathname = u.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    u.pathname = pathname;
    return u.toString();
  } catch {
    return null;
  }
}

function isSameDomain(url: string, baseHost: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === baseHost;
  } catch {
    return false;
  }
}

function shouldSkipLink(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#')) return true;
  if (/^mailto:/i.test(trimmed)) return true;
  if (/^tel:/i.test(trimmed)) return true;
  if (/^javascript:/i.test(trimmed)) return true;
  if (SKIP_EXTENSIONS.test(trimmed.split('?')[0].split('#')[0])) return true;
  return false;
}

async function fetchXml(url: string): Promise<string | null> {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      validateStatus: (s) => s >= 200 && s < 300,
      headers: { 'User-Agent': 'CompetitorMonitorBot/1.0' },
    });
    return typeof res.data === 'string' ? res.data : String(res.data);
  } catch {
    return null;
  }
}

async function collectFromSitemap(sitemapUrl: string, visitedSitemaps: Set<string>): Promise<string[]> {
  if (visitedSitemaps.has(sitemapUrl)) return [];
  visitedSitemaps.add(sitemapUrl);

  const xml = await fetchXml(sitemapUrl);
  if (!xml) return [];

  const $ = cheerio.load(xml, { xmlMode: true });

  const nestedSitemaps: string[] = [];
  $('sitemapindex > sitemap > loc').each((_, el) => {
    const loc = $(el).text().trim();
    if (loc) nestedSitemaps.push(loc);
  });

  if (nestedSitemaps.length > 0) {
    const urls: string[] = [];
    for (const nested of nestedSitemaps) {
      await delay(requestDelayMs());
      const nestedUrls = await collectFromSitemap(nested, visitedSitemaps);
      urls.push(...nestedUrls);
    }
    return urls;
  }

  const urls: string[] = [];
  $('urlset > url > loc').each((_, el) => {
    const loc = $(el).text().trim();
    if (loc) urls.push(loc);
  });
  return urls;
}

async function crawlViaSitemap(competitor: Competitor): Promise<string[]> {
  const sitemapUrl = `${competitor.url}/sitemap.xml`;
  const visited = new Set<string>();
  const rawUrls = await collectFromSitemap(sitemapUrl, visited);

  const normalized = new Set<string>();
  for (const raw of rawUrls) {
    const n = normalizeUrl(raw);
    if (n) normalized.add(n);
  }

  const maxPages = competitor.maxPages ?? DEFAULT_MAX_PAGES;
  return Array.from(normalized).slice(0, maxPages);
}

async function crawlRecursive(competitor: Competitor): Promise<string[]> {
  const maxPages = competitor.maxPages ?? DEFAULT_MAX_PAGES;
  const maxDepth = competitor.maxDepth ?? DEFAULT_MAX_DEPTH;
  const baseHost = new URL(competitor.url).hostname.toLowerCase();

  const startUrl = normalizeUrl(competitor.url);
  if (!startUrl) return [];

  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }];
  const result: string[] = [];

  while (queue.length > 0 && result.length < maxPages) {
    const { url, depth } = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    let html: string;
    try {
      await delay(requestDelayMs());
      const res = await axios.get(url, {
        timeout: 15000,
        validateStatus: (s) => s >= 200 && s < 300,
        headers: { 'User-Agent': 'CompetitorMonitorBot/1.0' },
      });
      if (typeof res.data !== 'string') continue;
      html = res.data;
    } catch {
      continue;
    }

    result.push(url);
    if (result.length >= maxPages) break;
    if (depth >= maxDepth) continue;

    const $ = cheerio.load(html);
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href || shouldSkipLink(href)) return;
      let absolute: string;
      try {
        absolute = new URL(href, url).toString();
      } catch {
        return;
      }
      if (!isSameDomain(absolute, baseHost)) return;
      const normalized = normalizeUrl(absolute);
      if (!normalized || visited.has(normalized)) return;
      queue.push({ url: normalized, depth: depth + 1 });
    });
  }

  return result;
}

export async function crawl(competitor: Competitor): Promise<string[]> {
  const sitemapUrls = await crawlViaSitemap(competitor);
  if (sitemapUrls.length > 0) return sitemapUrls;
  return crawlRecursive(competitor);
}
