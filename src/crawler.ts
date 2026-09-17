import axios from 'axios';
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { Competitor, DEFAULT_MAX_DEPTH, DEFAULT_MAX_PAGES } from './types';

const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 800);
const SKIP_EXTENSIONS = /\.(pdf|jpg|jpeg|png|gif|svg|zip|rar|7z|mp4|mp3|avi|mov|doc|docx|xls|xlsx|ppt|pptx|css|js|json|xml|woff|woff2|ttf|eot|ico|webp)$/i;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(id: string, step: string, message: string): void {
  console.log(`[${id}][${step}] ${message}`);
}

async function fetchXml(url: string): Promise<string | null> {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'competitor-monitor-bot/1.0' },
      validateStatus: (s) => s >= 200 && s < 300,
    });
    return typeof res.data === 'string' ? res.data : String(res.data);
  } catch {
    return null;
  }
}

async function collectSitemapUrls(sitemapUrl: string, seen: Set<string>): Promise<string[]> {
  if (seen.has(sitemapUrl)) return [];
  seen.add(sitemapUrl);

  const xml = await fetchXml(sitemapUrl);
  if (!xml) return [];

  const parser = new XMLParser({ ignoreAttributes: false });
  let parsed: any;
  try {
    parsed = parser.parse(xml);
  } catch {
    return [];
  }

  const urls: string[] = [];

  if (parsed?.sitemapindex?.sitemap) {
    const entries = Array.isArray(parsed.sitemapindex.sitemap)
      ? parsed.sitemapindex.sitemap
      : [parsed.sitemapindex.sitemap];
    for (const entry of entries) {
      const loc = entry?.loc;
      if (typeof loc === 'string') {
        await sleep(REQUEST_DELAY_MS);
        const nested = await collectSitemapUrls(loc, seen);
        urls.push(...nested);
      }
    }
  }

  if (parsed?.urlset?.url) {
    const entries = Array.isArray(parsed.urlset.url) ? parsed.urlset.url : [parsed.urlset.url];
    for (const entry of entries) {
      const loc = entry?.loc;
      if (typeof loc === 'string') {
        urls.push(loc);
      }
    }
  }

  return urls;
}

function shouldSkipLink(href: string): boolean {
  if (!href) return true;
  const trimmed = href.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return true;
  if (trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) return true;
  if (trimmed.startsWith('javascript:')) return true;
  const withoutQuery = trimmed.split('?')[0].split('#')[0];
  if (SKIP_EXTENSIONS.test(withoutQuery)) return true;
  return false;
}

function resolveUrl(base: string, href: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function isSameDomain(url: string, baseHost: string): boolean {
  try {
    return new URL(url).hostname === baseHost;
  } catch {
    return false;
  }
}

async function recursiveCrawl(competitor: Competitor): Promise<string[]> {
  const maxDepth = competitor.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxPages = competitor.maxPages ?? DEFAULT_MAX_PAGES;
  const baseHost = new URL(competitor.url).hostname;

  const visited = new Set<string>();
  const result: string[] = [];
  let queue: Array<{ url: string; depth: number }> = [{ url: competitor.url, depth: 0 }];

  while (queue.length > 0 && result.length < maxPages) {
    const { url, depth } = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    let html: string;
    try {
      const res = await axios.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': 'competitor-monitor-bot/1.0' },
        validateStatus: (s) => s >= 200 && s < 300,
      });
      html = typeof res.data === 'string' ? res.data : String(res.data);
    } catch (err: any) {
      log(competitor.id, 'step-1', `Пропуск ${url}: ${err.message || err}`);
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    result.push(url);

    if (depth < maxDepth) {
      const $ = cheerio.load(html);
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (shouldSkipLink(href)) return;
        const resolved = resolveUrl(url, href);
        if (!resolved) return;
        if (!isSameDomain(resolved, baseHost)) return;
        if (visited.has(resolved)) return;
        if (result.length + queue.length >= maxPages) return;
        queue.push({ url: resolved, depth: depth + 1 });
      });
    }

    await sleep(REQUEST_DELAY_MS);
  }

  return result.slice(0, maxPages);
}

export async function crawl(competitor: Competitor): Promise<string[]> {
  const startedAt = Date.now();
  const maxPages = competitor.maxPages ?? DEFAULT_MAX_PAGES;

  const sitemapUrl = `${competitor.url}/sitemap.xml`;
  const sitemapUrls = await collectSitemapUrls(sitemapUrl, new Set<string>());

  let urls: string[];
  if (sitemapUrls.length > 0) {
    urls = Array.from(new Set(sitemapUrls)).slice(0, maxPages);
    log(competitor.id, 'step-1', `Sitemap: собрано ${urls.length} URL за ${Math.round((Date.now() - startedAt) / 1000)} сек.`);
  } else {
    log(competitor.id, 'step-1', 'Sitemap недоступен или пуст, запускаю рекурсивный краулер.');
    urls = Array.from(new Set(await recursiveCrawl(competitor)));
    log(competitor.id, 'step-1', `Краулер: собрано ${urls.length} URL за ${Math.round((Date.now() - startedAt) / 1000)} сек.`);
  }

  return urls;
}
