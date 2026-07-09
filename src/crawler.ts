import axios from 'axios';
import * as cheerio from 'cheerio';
import { Competitor } from './types';

const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 800);
const USER_AGENT = 'CompetitorMonitorBot/1.0 (+weekly site monitoring)';

const SKIP_EXT = /\.(pdf|jpe?g|png|gif|svg|webp|zip|rar|7z|mp3|mp4|avi|mov|css|js|xml|json|woff2?|ttf|eot|ico|txt)(\?.*)?$/i;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(raw: string, base: string): string | null {
  try {
    const u = new URL(raw, base);
    u.hash = '';
    if (!/^https?:$/.test(u.protocol)) return null;
    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    u.pathname = path;
    return u.toString();
  } catch {
    return null;
  }
}

function isSameDomain(url: string, base: string): boolean {
  try {
    return new URL(url).hostname === new URL(base).hostname;
  } catch {
    return false;
  }
}

function shouldSkip(url: string): boolean {
  if (/^(mailto:|tel:|javascript:)/i.test(url)) return true;
  if (SKIP_EXT.test(url)) return true;
  return false;
}

async function fetchXml(url: string): Promise<string | null> {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': USER_AGENT },
      validateStatus: (s) => s === 200,
    });
    return typeof res.data === 'string' ? res.data : String(res.data);
  } catch {
    return null;
  }
}

async function crawlSitemap(sitemapUrl: string, maxPages: number, seen: Set<string>): Promise<void> {
  if (seen.size >= maxPages) return;
  const xml = await fetchXml(sitemapUrl);
  if (!xml) return;
  const $ = cheerio.load(xml, { xmlMode: true });

  const nestedSitemaps: string[] = [];
  $('sitemapindex > sitemap > loc').each((_, el) => {
    nestedSitemaps.push($(el).text().trim());
  });

  if (nestedSitemaps.length > 0) {
    for (const nested of nestedSitemaps) {
      if (seen.size >= maxPages) break;
      await sleep(REQUEST_DELAY_MS);
      await crawlSitemap(nested, maxPages, seen);
    }
    return;
  }

  $('urlset > url > loc').each((_, el) => {
    if (seen.size >= maxPages) return;
    const loc = $(el).text().trim();
    const norm = normalizeUrl(loc, sitemapUrl);
    if (norm && !shouldSkip(norm)) seen.add(norm);
  });
}

async function tryLoadSitemap(baseUrl: string, maxPages: number): Promise<string[] | null> {
  const seen = new Set<string>();
  await crawlSitemap(`${baseUrl}/sitemap.xml`, maxPages, seen);
  if (seen.size === 0) return null;
  return Array.from(seen).slice(0, maxPages);
}

async function recursiveCrawl(baseUrl: string, maxPages: number, maxDepth: number): Promise<string[]> {
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: normalizeUrl(baseUrl, baseUrl) || baseUrl, depth: 0 }];
  const result: string[] = [];

  while (queue.length > 0 && result.length < maxPages) {
    const { url, depth } = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    result.push(url);

    if (depth >= maxDepth) continue;

    try {
      if (queue.length > 0 || visited.size > 1) await sleep(REQUEST_DELAY_MS);
      const res = await axios.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': USER_AGENT },
        validateStatus: (s) => s >= 200 && s < 400,
      });
      const contentType = String(res.headers['content-type'] || '');
      if (!contentType.includes('text/html')) continue;

      const $ = cheerio.load(res.data);
      $('a[href]').each((_, el) => {
        if (result.length + queue.length >= maxPages) return;
        const href = $(el).attr('href');
        if (!href || shouldSkip(href)) return;
        const norm = normalizeUrl(href, url);
        if (!norm || shouldSkip(norm)) return;
        if (!isSameDomain(norm, baseUrl)) return;
        if (visited.has(norm)) return;
        queue.push({ url: norm, depth: depth + 1 });
      });
    } catch {
      // skip page on error, continue crawl
    }
  }

  return result.slice(0, maxPages);
}

export async function crawl(competitor: Competitor): Promise<string[]> {
  const maxPages = competitor.maxPages ?? 300;
  const maxDepth = competitor.maxDepth ?? 3;
  const baseUrl = competitor.url.replace(/\/+$/, '');

  const sitemapUrls = await tryLoadSitemap(baseUrl, maxPages);
  if (sitemapUrls && sitemapUrls.length > 0) {
    return sitemapUrls;
  }

  return recursiveCrawl(baseUrl, maxPages, maxDepth);
}
