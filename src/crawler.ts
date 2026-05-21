import axios from 'axios';
import * as cheerio from 'cheerio';
import { Competitor } from './types';

const DELAY = parseInt(process.env.REQUEST_DELAY_MS || '800', 10);

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'CompetitorMonitor/1.0' },
      maxRedirects: 5,
    });
    return typeof res.data === 'string' ? res.data : String(res.data);
  } catch {
    return null;
  }
}

async function fetchSitemap(baseUrl: string): Promise<string[]> {
  const sitemapUrl = `${baseUrl}/sitemap.xml`;
  const xml = await fetchHtml(sitemapUrl);
  if (!xml) return [];

  const $ = cheerio.load(xml, { xmlMode: true });
  const urls: string[] = [];

  // Check if it's a sitemap index
  const sitemapLocs = $('sitemapindex sitemap loc');
  if (sitemapLocs.length > 0) {
    for (const el of sitemapLocs.toArray()) {
      const subUrl = $(el).text().trim();
      if (!subUrl) continue;
      const subXml = await fetchHtml(subUrl);
      if (!subXml) continue;
      const $sub = cheerio.load(subXml, { xmlMode: true });
      $sub('urlset url loc').each((_, el) => {
        const u = $sub(el).text().trim();
        if (u) urls.push(u);
      });
      await sleep(DELAY);
    }
    return urls;
  }

  // Regular sitemap
  $('urlset url loc').each((_, el) => {
    const u = $(el).text().trim();
    if (u) urls.push(u);
  });

  return urls;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${u.pathname.replace(/\/$/, '') || '/'}${u.search}`;
  } catch {
    return url;
  }
}

function isSameDomain(url: string, baseHost: string): boolean {
  try {
    const u = new URL(url);
    return u.host.toLowerCase() === baseHost.toLowerCase();
  } catch {
    return false;
  }
}

function isSkippable(url: string): boolean {
  if (url.startsWith('#') || url.startsWith('mailto:') || url.startsWith('tel:')) return true;
  const skipExts = /\.(pdf|jpg|jpeg|png|gif|zip|rar|doc|docx|xls|xlsx|mp3|mp4|svg|ico|css|js|woff|woff2|ttf)$/i;
  try {
    const u = new URL(url);
    return skipExts.test(u.pathname);
  } catch {
    return skipExts.test(url);
  }
}

function extractLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const resolved = new URL(href, baseUrl).toString();
      if (!isSkippable(resolved)) {
        links.push(resolved);
      }
    } catch {
      // ignore invalid URLs
    }
  });
  return links;
}

async function crawlRecursive(competitor: Competitor): Promise<string[]> {
  const maxPages = competitor.maxPages ?? 300;
  const maxDepth = competitor.maxDepth ?? 3;
  const baseHost = new URL(competitor.url).host.toLowerCase();

  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: competitor.url, depth: 0 }];
  const result: string[] = [];

  while (queue.length > 0 && result.length < maxPages) {
    const item = queue.shift()!;
    const normalized = normalizeUrl(item.url);

    if (visited.has(normalized)) continue;
    if (!isSameDomain(item.url, baseHost)) continue;

    visited.add(normalized);

    const html = await fetchHtml(item.url);
    if (!html) continue;

    result.push(normalized);
    console.log(`[${competitor.id}][crawler] ${result.length}/${maxPages} - ${normalized}`);

    if (item.depth < maxDepth) {
      const links = extractLinks(html, item.url);
      for (const link of links) {
        const normLink = normalizeUrl(link);
        if (!visited.has(normLink) && isSameDomain(link, baseHost)) {
          queue.push({ url: link, depth: item.depth + 1 });
        }
      }
    }

    await sleep(DELAY);
  }

  return result;
}

export async function crawl(competitor: Competitor): Promise<string[]> {
  const start = Date.now();
  console.log(`[${competitor.id}][step-1] Starting URL collection for ${competitor.url}`);

  // Try sitemap first
  const sitemapUrls = await fetchSitemap(competitor.url);

  if (sitemapUrls.length > 0) {
    const maxPages = competitor.maxPages ?? 300;
    const limited = sitemapUrls.slice(0, maxPages);
    const unique = [...new Set(limited.map(u => normalizeUrl(u)))];
    console.log(`[${competitor.id}][step-1] Sitemap found: ${unique.length} URLs in ${Math.round((Date.now()-start)/1000)} sec.`);
    return unique;
  }

  console.log(`[${competitor.id}][step-1] No sitemap, starting recursive crawl`);
  const urls = await crawlRecursive(competitor);
  console.log(`[${competitor.id}][step-1] Crawled ${urls.length} URLs in ${Math.round((Date.now()-start)/1000)} sec.`);
  return urls;
}
