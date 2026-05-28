import axios from 'axios';
import * as cheerio from 'cheerio';
import { parseStringPromise } from 'xml2js';
import { Competitor } from './types';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function getDelayMs(): number {
  return parseInt(process.env.REQUEST_DELAY_MS || '800', 10);
}

function normalizeUrl(href: string): string {
  try {
    const u = new URL(href);
    u.hash = '';
    let path = u.pathname.replace(/\/$/, '') || '/';
    return u.protocol.toLowerCase() + '//' + u.hostname.toLowerCase() + path + u.search;
  } catch {
    return href;
  }
}

function shouldSkip(href: string): boolean {
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
    return true;
  }
  return /\.(pdf|jpg|jpeg|png|gif|svg|webp|ico|zip|tar\.gz|gz|mp3|mp4|avi|mov|woff|woff2|ttf|eot|css|js|xml|json)(\?|$)/i.test(href);
}

async function fetchSitemapUrls(sitemapUrl: string, visited = new Set<string>()): Promise<string[]> {
  if (visited.has(sitemapUrl)) return [];
  visited.add(sitemapUrl);

  try {
    const resp = await axios.get(sitemapUrl, {
      timeout: 30000,
      responseType: 'text',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CompetitorMonitor/1.0)' },
    });

    const result = await parseStringPromise(resp.data, { explicitArray: true });
    const urls: string[] = [];

    // Sitemap index
    if (result.sitemapindex?.sitemap) {
      for (const s of result.sitemapindex.sitemap) {
        const loc = Array.isArray(s.loc) ? s.loc[0] : s.loc;
        if (loc && typeof loc === 'string') {
          const subUrls = await fetchSitemapUrls(loc.trim(), visited);
          urls.push(...subUrls);
          await sleep(300);
        }
      }
    }

    // Regular sitemap
    if (result.urlset?.url) {
      for (const u of result.urlset.url) {
        const loc = Array.isArray(u.loc) ? u.loc[0] : u.loc;
        if (loc && typeof loc === 'string') {
          urls.push(loc.trim());
        }
      }
    }

    return urls;
  } catch {
    return [];
  }
}

async function recursiveCrawl(
  startUrl: string,
  maxPages: number,
  maxDepth: number,
  delayMs: number,
  competitorId: string,
): Promise<string[]> {
  const baseHostname = new URL(startUrl).hostname;
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [];

  const normalizedStart = normalizeUrl(startUrl);
  visited.add(normalizedStart);
  queue.push({ url: normalizedStart, depth: 0 });

  let fetched = 0;

  while (queue.length > 0 && visited.size <= maxPages) {
    const { url, depth } = queue.shift()!;
    fetched++;

    if (fetched % 50 === 0) {
      console.log(`[${competitorId}][step-1] Crawled ${fetched} pages, queue=${queue.length}...`);
    }

    try {
      const resp = await axios.get(url, {
        timeout: 20000,
        responseType: 'text',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CompetitorMonitor/1.0)' },
      });

      if (depth < maxDepth) {
        const $ = cheerio.load(resp.data);
        $('a[href]').each((_, el) => {
          const href = $(el).attr('href') || '';
          if (shouldSkip(href)) return;

          try {
            const resolved = new URL(href, url);
            if (resolved.hostname !== baseHostname) return;
            const normalized = normalizeUrl(resolved.href);
            if (!visited.has(normalized) && visited.size < maxPages) {
              visited.add(normalized);
              queue.push({ url: normalized, depth: depth + 1 });
            }
          } catch {}
        });
      }
    } catch (err: any) {
      console.warn(`[${competitorId}][step-1] Warning fetching ${url}: ${err.message}`);
    }

    if (queue.length > 0) await sleep(delayMs);
  }

  return Array.from(visited);
}

export async function crawl(competitor: Competitor): Promise<string[]> {
  const maxPages = competitor.maxPages ?? 300;
  const maxDepth = competitor.maxDepth ?? 3;
  const delayMs = getDelayMs();

  console.log(`[${competitor.id}][step-1] Trying sitemap at ${competitor.url}/sitemap.xml ...`);
  const sitemapUrls = await fetchSitemapUrls(competitor.url + '/sitemap.xml');

  if (sitemapUrls.length > 0) {
    const limited = sitemapUrls.slice(0, maxPages);
    console.log(`[${competitor.id}][step-1] Sitemap found: ${limited.length} URLs (total in sitemap: ${sitemapUrls.length})`);
    return limited;
  }

  console.log(`[${competitor.id}][step-1] No sitemap, starting recursive crawl (maxDepth=${maxDepth}, maxPages=${maxPages})...`);
  const start = Date.now();
  const urls = await recursiveCrawl(competitor.url, maxPages, maxDepth, delayMs, competitor.id);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[${competitor.id}][step-1] Collected ${urls.length} URLs in ${elapsed}s`);
  return urls;
}
