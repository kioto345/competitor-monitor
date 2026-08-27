import axios from 'axios';
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { Competitor } from './types';

const USER_AGENT = 'CompetitorMonitorBot/1.0 (+https://github.com/)';
const SKIP_EXTENSIONS = /\.(pdf|jpg|jpeg|png|gif|svg|webp|zip|rar|7z|mp4|mp3|avi|mov|doc|docx|xls|xlsx|ppt|pptx|css|js|json|xml|ico|woff|woff2|ttf|eot)(\?.*)?$/i;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    let pathname = u.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    return `${u.protocol.toLowerCase()}//${u.hostname.toLowerCase()}${pathname}${u.search}`;
  } catch {
    return raw;
  }
}

async function fetchXml(url: string): Promise<string | null> {
  try {
    const res = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 15000,
      validateStatus: (s) => s === 200,
    });
    return typeof res.data === 'string' ? res.data : String(res.data);
  } catch {
    return null;
  }
}

async function tryFetchSitemap(baseUrl: string, requestDelayMs: number): Promise<string[] | null> {
  const sitemapUrl = `${baseUrl}/sitemap.xml`;
  const xml = await fetchXml(sitemapUrl);
  if (!xml) return null;

  const parser = new XMLParser({ ignoreAttributes: false });
  let parsed: any;
  try {
    parsed = parser.parse(xml);
  } catch {
    return null;
  }

  const urls: string[] = [];

  if (parsed.sitemapindex) {
    let entries = parsed.sitemapindex.sitemap;
    if (!entries) return null;
    if (!Array.isArray(entries)) entries = [entries];
    for (const entry of entries) {
      const loc = entry?.loc;
      if (!loc) continue;
      await delay(requestDelayMs);
      const childXml = await fetchXml(loc);
      if (!childXml) continue;
      try {
        const childParsed = parser.parse(childXml);
        let urlEntries = childParsed?.urlset?.url;
        if (!urlEntries) continue;
        if (!Array.isArray(urlEntries)) urlEntries = [urlEntries];
        for (const u of urlEntries) {
          if (u?.loc) urls.push(u.loc);
        }
      } catch {
        continue;
      }
    }
  } else if (parsed.urlset) {
    let urlEntries = parsed.urlset.url;
    if (!urlEntries) return null;
    if (!Array.isArray(urlEntries)) urlEntries = [urlEntries];
    for (const u of urlEntries) {
      if (u?.loc) urls.push(u.loc);
    }
  } else {
    return null;
  }

  if (urls.length === 0) return null;

  const unique = Array.from(new Set(urls.map(normalizeUrl)));
  return unique;
}

async function recursiveCrawl(
  competitor: Competitor,
  requestDelayMs: number
): Promise<string[]> {
  const maxDepth = competitor.maxDepth ?? 3;
  const maxPages = competitor.maxPages ?? 300;
  const baseHost = new URL(competitor.url).hostname.toLowerCase();

  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: normalizeUrl(competitor.url), depth: 0 }];
  const result: string[] = [];

  while (queue.length > 0 && result.length < maxPages) {
    const { url, depth } = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    let html: string | null = null;
    try {
      const res = await axios.get(url, {
        headers: { 'User-Agent': USER_AGENT },
        timeout: 15000,
        validateStatus: (s) => s >= 200 && s < 400,
      });
      html = typeof res.data === 'string' ? res.data : String(res.data);
    } catch {
      await delay(requestDelayMs);
      continue;
    }

    result.push(url);

    if (depth < maxDepth && html) {
      const $ = cheerio.load(html);
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        const trimmed = href.trim();
        if (
          trimmed.startsWith('#') ||
          trimmed.startsWith('mailto:') ||
          trimmed.startsWith('tel:') ||
          trimmed.startsWith('javascript:')
        ) {
          return;
        }
        if (SKIP_EXTENSIONS.test(trimmed)) return;

        let absolute: string;
        try {
          absolute = new URL(trimmed, url).toString();
        } catch {
          return;
        }
        const normalized = normalizeUrl(absolute);
        let host: string;
        try {
          host = new URL(normalized).hostname.toLowerCase();
        } catch {
          return;
        }
        if (host !== baseHost) return;
        if (visited.has(normalized)) return;
        if (SKIP_EXTENSIONS.test(normalized)) return;

        queue.push({ url: normalized, depth: depth + 1 });
      });
    }

    await delay(requestDelayMs);
  }

  return result.slice(0, maxPages);
}

export async function crawl(competitor: Competitor, requestDelayMs = 800): Promise<string[]> {
  const baseUrl = competitor.url.replace(/\/+$/, '');
  const maxPages = competitor.maxPages ?? 300;

  const sitemapUrls = await tryFetchSitemap(baseUrl, requestDelayMs);
  if (sitemapUrls && sitemapUrls.length > 0) {
    return sitemapUrls.slice(0, maxPages);
  }

  return recursiveCrawl(competitor, requestDelayMs);
}
