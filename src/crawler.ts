import axios from 'axios';
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { Competitor } from './types';

const DEFAULT_MAX_PAGES = 300;
const DEFAULT_MAX_DEPTH = 3;
const SKIP_EXTENSIONS = /\.(pdf|jpg|jpeg|png|gif|svg|webp|zip|rar|7z|mp4|mp3|avi|mov|doc|docx|xls|xlsx|ppt|pptx|css|js|json|xml|ico|woff|woff2|ttf)$/i;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDelay(): number {
  const raw = process.env.REQUEST_DELAY_MS;
  const n = raw ? parseInt(raw, 10) : 800;
  return Number.isFinite(n) && n >= 0 ? n : 800;
}

function normalizeUrl(raw: string, base: string): string | null {
  try {
    const u = new URL(raw, base);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    u.protocol = u.protocol.toLowerCase();
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

async function fetchXml(url: string): Promise<any | null> {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'competitor-monitor-bot/1.0' },
      validateStatus: (s) => s === 200,
    });
    const parser = new XMLParser({ ignoreAttributes: false });
    return parser.parse(res.data);
  } catch {
    return null;
  }
}

async function collectFromSitemap(
  sitemapUrl: string,
  baseUrl: string,
  maxPages: number,
  seen: Set<string>,
  log: (msg: string) => void,
  depth = 0
): Promise<void> {
  if (depth > 5 || seen.size >= maxPages) return;
  const data = await fetchXml(sitemapUrl);
  if (!data) return;

  if (data.sitemapindex) {
    let entries = data.sitemapindex.sitemap;
    if (!entries) return;
    if (!Array.isArray(entries)) entries = [entries];
    for (const entry of entries) {
      if (seen.size >= maxPages) break;
      const loc = entry?.loc;
      if (typeof loc === 'string') {
        await collectFromSitemap(loc, baseUrl, maxPages, seen, log, depth + 1);
      }
    }
    return;
  }

  if (data.urlset) {
    let entries = data.urlset.url;
    if (!entries) return;
    if (!Array.isArray(entries)) entries = [entries];
    for (const entry of entries) {
      if (seen.size >= maxPages) break;
      const loc = entry?.loc;
      if (typeof loc === 'string') {
        const normalized = normalizeUrl(loc, baseUrl);
        if (normalized && !SKIP_EXTENSIONS.test(normalized)) {
          seen.add(normalized);
        }
      }
    }
  }
}

async function crawlViaSitemap(
  competitor: Competitor,
  maxPages: number,
  log: (msg: string) => void
): Promise<string[]> {
  const seen = new Set<string>();
  const sitemapUrl = `${competitor.url}/sitemap.xml`;
  await collectFromSitemap(sitemapUrl, competitor.url, maxPages, seen, log);
  return Array.from(seen).slice(0, maxPages);
}

function isSameDomain(url: string, base: string): boolean {
  try {
    return new URL(url).hostname === new URL(base).hostname;
  } catch {
    return false;
  }
}

function isSkippableLink(href: string): boolean {
  if (!href) return true;
  const trimmed = href.trim();
  if (trimmed.startsWith('#')) return true;
  if (trimmed.startsWith('mailto:')) return true;
  if (trimmed.startsWith('tel:')) return true;
  if (trimmed.startsWith('javascript:')) return true;
  return false;
}

async function crawlRecursive(
  competitor: Competitor,
  maxPages: number,
  maxDepth: number,
  log: (msg: string) => void
): Promise<string[]> {
  const delay = getDelay();
  const visited = new Set<string>();
  const startUrl = normalizeUrl(competitor.url, competitor.url);
  if (!startUrl) return [];

  const queue: { url: string; depth: number }[] = [{ url: startUrl, depth: 0 }];
  const result: string[] = [];

  while (queue.length > 0 && result.length < maxPages) {
    const { url, depth } = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    let html: string;
    try {
      const res = await axios.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': 'competitor-monitor-bot/1.0' },
        validateStatus: (s) => s === 200,
      });
      html = res.data;
    } catch {
      continue;
    }

    result.push(url);

    if (depth < maxDepth) {
      const $ = cheerio.load(html);
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (isSkippableLink(href)) return;
        if (SKIP_EXTENSIONS.test(href)) return;
        const normalized = normalizeUrl(href, url);
        if (!normalized) return;
        if (!isSameDomain(normalized, competitor.url)) return;
        if (visited.has(normalized)) return;
        queue.push({ url: normalized, depth: depth + 1 });
      });
    }

    if (queue.length > 0 && result.length < maxPages) {
      await sleep(delay);
    }
  }

  return result.slice(0, maxPages);
}

export async function crawl(competitor: Competitor): Promise<string[]> {
  const maxPages = competitor.maxPages ?? DEFAULT_MAX_PAGES;
  const maxDepth = competitor.maxDepth ?? DEFAULT_MAX_DEPTH;
  const log = (msg: string) => console.log(`[${competitor.id}][step-1] ${msg}`);

  const sitemapUrls = await crawlViaSitemap(competitor, maxPages, log);
  if (sitemapUrls.length > 0) {
    log(`Собрано ${sitemapUrls.length} URL через sitemap.xml`);
    return sitemapUrls;
  }

  log('Sitemap недоступен или пуст, запускаю рекурсивный краулер');
  const crawledUrls = await crawlRecursive(competitor, maxPages, maxDepth, log);
  log(`Собрано ${crawledUrls.length} URL через рекурсивный краулер`);
  return crawledUrls;
}
