import axios from 'axios';
import * as cheerio from 'cheerio';
import { Competitor } from './types';
import { normalizeUrl } from './parser';

const DEFAULT_MAX_PAGES = 300;
const DEFAULT_MAX_DEPTH = 3;

const SKIP_EXTENSIONS = [
  '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico',
  '.zip', '.rar', '.7z', '.gz', '.tar',
  '.mp3', '.mp4', '.avi', '.mov', '.wav',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.css', '.js', '.json', '.xml', '.woff', '.woff2', '.ttf', '.eot',
];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRequestDelay(): number {
  const v = parseInt(process.env.REQUEST_DELAY_MS || '800', 10);
  return Number.isFinite(v) && v >= 0 ? v : 800;
}

function shouldSkipLink(href: string): boolean {
  const lower = href.toLowerCase().split('?')[0].split('#')[0];
  if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
    return true;
  }
  return SKIP_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

async function fetchXml(url: string): Promise<string | null> {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CompetitorMonitorBot/1.0)' },
      responseType: 'text',
      validateStatus: (status) => status >= 200 && status < 400,
    });
    return res.data;
  } catch {
    return null;
  }
}

async function fetchSitemapUrls(sitemapUrl: string, delayMs: number, depth = 0): Promise<string[]> {
  if (depth > 5) return [];
  const xml = await fetchXml(sitemapUrl);
  if (!xml) return [];

  const $ = cheerio.load(xml, { xmlMode: true });
  const isIndex = $('sitemapindex').length > 0;

  if (isIndex) {
    const nestedSitemaps: string[] = [];
    $('sitemap > loc').each((_, el) => {
      const loc = $(el).text().trim();
      if (loc) nestedSitemaps.push(loc);
    });

    const urls: string[] = [];
    for (const nested of nestedSitemaps) {
      await delay(delayMs);
      const nestedUrls = await fetchSitemapUrls(nested, delayMs, depth + 1);
      urls.push(...nestedUrls);
    }
    return urls;
  }

  const urls: string[] = [];
  $('url > loc').each((_, el) => {
    const loc = $(el).text().trim();
    if (loc) urls.push(loc);
  });
  return urls;
}

async function crawlSite(baseUrl: string, maxPages: number, maxDepth: number, delayMs: number): Promise<string[]> {
  const base = new URL(baseUrl);
  const visited = new Set<string>();
  const result: string[] = [];
  let queue: { url: string; depth: number }[] = [{ url: baseUrl, depth: 0 }];

  while (queue.length > 0 && result.length < maxPages) {
    const { url, depth } = queue.shift()!;
    const normalized = normalizeUrl(url);
    if (visited.has(normalized)) continue;
    visited.add(normalized);

    if (result.length > 0) {
      await delay(delayMs);
    }

    let html: string | null = null;
    try {
      const res = await axios.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CompetitorMonitorBot/1.0)' },
        responseType: 'text',
        validateStatus: (status) => status >= 200 && status < 400,
      });
      const contentType = String(res.headers['content-type'] || '');
      if (contentType.includes('html')) {
        html = res.data;
      }
    } catch (err) {
      console.warn(`[crawler] Failed to fetch ${url}: ${(err as Error).message}`);
      continue;
    }

    if (html === null) continue;
    result.push(url);

    if (depth >= maxDepth) continue;

    const $ = cheerio.load(html);
    const nextLinks: string[] = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href || shouldSkipLink(href)) return;
      let absolute: URL;
      try {
        absolute = new URL(href, url);
      } catch {
        return;
      }
      if (absolute.hostname.toLowerCase() !== base.hostname.toLowerCase()) return;
      const normalizedNext = normalizeUrl(absolute.toString());
      if (visited.has(normalizedNext)) return;
      nextLinks.push(absolute.toString());
    });

    for (const link of nextLinks) {
      if (result.length + queue.length >= maxPages) break;
      queue.push({ url: link, depth: depth + 1 });
    }
  }

  return result;
}

export async function crawl(competitor: Competitor): Promise<string[]> {
  const maxPages = competitor.maxPages ?? DEFAULT_MAX_PAGES;
  const maxDepth = competitor.maxDepth ?? DEFAULT_MAX_DEPTH;
  const delayMs = getRequestDelay();
  const baseUrl = competitor.url.replace(/\/$/, '');

  const sitemapUrls = await fetchSitemapUrls(`${baseUrl}/sitemap.xml`, delayMs);

  let urls: string[];
  if (sitemapUrls.length > 0) {
    urls = sitemapUrls;
  } else {
    urls = await crawlSite(baseUrl, maxPages, maxDepth, delayMs);
  }

  const unique = Array.from(new Set(urls.map((u) => normalizeUrl(u))));
  return unique.slice(0, maxPages);
}
