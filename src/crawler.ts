import axios from 'axios';
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { Competitor } from './types';

const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 800);
const SKIP_EXTENSIONS = /\.(pdf|jpe?g|png|gif|svg|zip|rar|7z|mp4|mp3|avi|mov|webp|ico|css|js|woff2?|ttf|eot|xml|json|doc|docx|xls|xlsx|ppt|pptx)$/i;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
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
    return raw;
  }
}

function isSkippableHref(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:') || trimmed.startsWith('javascript:')) {
    return true;
  }
  if (SKIP_EXTENSIONS.test(trimmed.split('?')[0].split('#')[0])) {
    return true;
  }
  return false;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CompetitorMonitor/1.0)' },
      validateStatus: (status) => status >= 200 && status < 400,
    });
    return typeof res.data === 'string' ? res.data : String(res.data);
  } catch {
    return null;
  }
}

async function fetchSitemapUrls(sitemapUrl: string, depth = 0): Promise<string[]> {
  if (depth > 3) return [];
  const xml = await fetchText(sitemapUrl);
  if (!xml) return [];

  const parser = new XMLParser({ ignoreAttributes: true });
  let parsed: any;
  try {
    parsed = parser.parse(xml);
  } catch {
    return [];
  }

  const urls: string[] = [];

  if (parsed.sitemapindex) {
    const entries = toArray(parsed.sitemapindex.sitemap);
    for (const entry of entries) {
      const loc = entry?.loc;
      if (typeof loc === 'string') {
        await sleep(REQUEST_DELAY_MS);
        const nested = await fetchSitemapUrls(loc, depth + 1);
        urls.push(...nested);
      }
    }
  } else if (parsed.urlset) {
    const entries = toArray(parsed.urlset.url);
    for (const entry of entries) {
      const loc = entry?.loc;
      if (typeof loc === 'string') {
        urls.push(loc);
      }
    }
  }

  return urls;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

async function crawlViaSitemap(competitor: Competitor): Promise<string[]> {
  const sitemapUrl = `${competitor.url}/sitemap.xml`;
  const rawUrls = await fetchSitemapUrls(sitemapUrl);
  const host = new URL(competitor.url).hostname.toLowerCase();

  const unique = new Set<string>();
  for (const raw of rawUrls) {
    if (isSkippableHref(raw)) continue;
    try {
      const u = new URL(raw);
      if (u.hostname.toLowerCase() !== host) continue;
      unique.add(normalizeUrl(raw));
    } catch {
      continue;
    }
  }

  const maxPages = competitor.maxPages ?? 300;
  return Array.from(unique).slice(0, maxPages);
}

async function crawlRecursive(competitor: Competitor): Promise<string[]> {
  const maxPages = competitor.maxPages ?? 300;
  const maxDepth = competitor.maxDepth ?? 3;
  const host = new URL(competitor.url).hostname.toLowerCase();

  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: normalizeUrl(competitor.url), depth: 0 }];
  const result: string[] = [];

  while (queue.length > 0 && result.length < maxPages) {
    const { url, depth } = queue.shift()!;
    const normalized = normalizeUrl(url);
    if (visited.has(normalized)) continue;
    visited.add(normalized);

    const html = await fetchText(normalized);
    await sleep(REQUEST_DELAY_MS);
    if (html === null) continue;

    result.push(normalized);
    if (result.length >= maxPages) break;
    if (depth >= maxDepth) continue;

    const $ = cheerio.load(html);
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href || isSkippableHref(href)) return;
      try {
        const resolved = new URL(href, normalized);
        if (resolved.hostname.toLowerCase() !== host) return;
        const normalizedResolved = normalizeUrl(resolved.toString());
        if (!visited.has(normalizedResolved)) {
          queue.push({ url: normalizedResolved, depth: depth + 1 });
        }
      } catch {
        // ignore malformed URLs
      }
    });
  }

  return result;
}

export async function crawl(competitor: Competitor): Promise<string[]> {
  const sitemapUrls = await crawlViaSitemap(competitor);
  if (sitemapUrls.length > 0) {
    return sitemapUrls;
  }
  return crawlRecursive(competitor);
}
