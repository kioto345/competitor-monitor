import axios from 'axios';
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { Competitor } from './types';

const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 800);
const SKIP_EXT = /\.(pdf|jpg|jpeg|png|gif|zip|svg|webp|mp4|mp3|css|js|ico|xml|txt|woff|woff2|ttf)(\?.*)?$/i;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, '');
}

function sameDomain(base: string, target: string): boolean {
  try {
    return new URL(base).host === new URL(target).host;
  } catch {
    return false;
  }
}

function isSkippable(href: string): boolean {
  if (!href) return true;
  if (href.startsWith('#')) return true;
  if (href.startsWith('mailto:')) return true;
  if (href.startsWith('tel:')) return true;
  if (SKIP_EXT.test(href)) return true;
  return false;
}

async function fetchXml(url: string): Promise<any | null> {
  try {
    const res = await axios.get(url, { timeout: 15000, validateStatus: (s) => s === 200 });
    const parser = new XMLParser({ ignoreAttributes: false });
    return parser.parse(res.data);
  } catch {
    return null;
  }
}

async function collectFromSitemap(sitemapUrl: string, depth = 0): Promise<string[]> {
  if (depth > 3) return [];
  const parsed = await fetchXml(sitemapUrl);
  if (!parsed) return [];

  const urls: string[] = [];

  if (parsed.sitemapindex?.sitemap) {
    const entries = Array.isArray(parsed.sitemapindex.sitemap)
      ? parsed.sitemapindex.sitemap
      : [parsed.sitemapindex.sitemap];
    for (const entry of entries) {
      const loc = entry.loc;
      if (typeof loc === 'string') {
        await sleep(REQUEST_DELAY_MS);
        const nested = await collectFromSitemap(loc, depth + 1);
        urls.push(...nested);
      }
    }
  } else if (parsed.urlset?.url) {
    const entries = Array.isArray(parsed.urlset.url) ? parsed.urlset.url : [parsed.urlset.url];
    for (const entry of entries) {
      if (typeof entry.loc === 'string') urls.push(entry.loc);
    }
  }

  return urls;
}

async function tryLoadSitemap(competitor: Competitor): Promise<string[] | null> {
  const base = normalizeBase(competitor.url);
  const urls = await collectFromSitemap(`${base}/sitemap.xml`);
  if (urls.length === 0) return null;
  return Array.from(new Set(urls)).slice(0, competitor.maxPages || 300);
}

async function crawlRecursive(competitor: Competitor): Promise<string[]> {
  const base = normalizeBase(competitor.url);
  const maxDepth = competitor.maxDepth ?? 3;
  const maxPages = competitor.maxPages ?? 300;

  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: base, depth: 0 }];

  while (queue.length > 0 && visited.size < maxPages) {
    const { url, depth } = queue.shift()!;
    if (visited.has(url)) continue;
    if (depth > maxDepth) continue;

    visited.add(url);

    try {
      const res = await axios.get(url, {
        timeout: 15000,
        validateStatus: (s) => s >= 200 && s < 400,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CompetitorMonitorBot/1.0)' },
      });
      const $ = cheerio.load(res.data);

      if (depth < maxDepth) {
        $('a[href]').each((_, el) => {
          const href = $(el).attr('href') || '';
          if (isSkippable(href)) return;
          try {
            const resolved = new URL(href, url).toString().split('#')[0];
            if (sameDomain(base, resolved) && !visited.has(resolved)) {
              queue.push({ url: resolved, depth: depth + 1 });
            }
          } catch {
            // ignore malformed links
          }
        });
      }
    } catch (err) {
      console.warn(`[${competitor.id}][step-1] Ошибка загрузки ${url}: ${(err as Error).message}`);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  return Array.from(visited);
}

export async function crawl(competitor: Competitor): Promise<string[]> {
  const fromSitemap = await tryLoadSitemap(competitor);
  if (fromSitemap && fromSitemap.length > 0) {
    return fromSitemap;
  }
  return crawlRecursive(competitor);
}
