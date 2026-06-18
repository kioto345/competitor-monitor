import axios from 'axios';
import * as cheerio from 'cheerio';
import { Competitor } from './types';

const delay = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

const FILE_EXT_RE = /\.(pdf|jpg|jpeg|png|gif|svg|webp|zip|rar|doc|docx|xls|xlsx|mp3|mp4|avi|mov|css|js|woff|woff2|ttf|eot|ico|xml)(\?.*)?$/i;

const HTTP_OPTS = {
  timeout: 15000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CompetitorMonitor/1.0; +https://github.com)' },
  maxRedirects: 5,
};

function normalizeUrl(raw: string, base?: string): string | null {
  try {
    const u = new URL(raw, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    // drop fragment
    u.hash = '';
    // normalise scheme+host to lowercase, strip trailing slash from path
    const path = u.pathname.replace(/\/$/, '') || '/';
    return u.protocol.toLowerCase() + '//' + u.host.toLowerCase() + path + u.search;
  } catch {
    return null;
  }
}

function sameHost(url: string, base: string): boolean {
  try {
    return new URL(url).hostname === new URL(base).hostname;
  } catch {
    return false;
  }
}

async function fetchSitemapUrls(
  sitemapUrl: string,
  delayMs: number,
  maxPages: number,
  depth = 0,
): Promise<string[] | null> {
  if (depth > 3) return null;
  try {
    const res = await axios.get(sitemapUrl, { ...HTTP_OPTS, responseType: 'text' });
    const contentType = String(res.headers['content-type'] ?? '');
    // reject HTML responses (likely a 404 page served with 200)
    if (contentType.includes('text/html') && !contentType.includes('xml')) return null;

    const $ = cheerio.load(res.data as string, { xmlMode: true });
    const rootName = $.root().children().first().prop('tagName')?.toLowerCase();

    if (rootName === 'sitemapindex') {
      const urls: string[] = [];
      const locs: string[] = [];
      $('sitemap loc').each((_, el) => { locs.push($(el).text().trim()); });
      for (const loc of locs) {
        if (urls.length >= maxPages) break;
        await delay(delayMs);
        const sub = await fetchSitemapUrls(loc, delayMs, maxPages - urls.length, depth + 1);
        if (sub) urls.push(...sub);
      }
      return urls.length > 0 ? urls : null;
    }

    if (rootName === 'urlset') {
      const urls: string[] = [];
      $('url loc').each((_, el) => {
        if (urls.length >= maxPages) return false;
        const loc = $(el).text().trim();
        if (loc) urls.push(loc);
      });
      return urls.length > 0 ? urls : null;
    }

    return null;
  } catch {
    return null;
  }
}

export async function crawl(competitor: Competitor): Promise<string[]> {
  const maxPages = competitor.maxPages ?? 300;
  const maxDepth = competitor.maxDepth ?? 3;
  const delayMs = parseInt(process.env.REQUEST_DELAY_MS ?? '800', 10);
  const base = competitor.url.replace(/\/$/, '');

  // ── Step 1a: try sitemap ────────────────────────────────────────────────
  const sitemapUrl = base + '/sitemap.xml';
  console.log(`[${competitor.id}][step-1] Пробуем sitemap: ${sitemapUrl}`);
  const sitemapUrls = await fetchSitemapUrls(sitemapUrl, delayMs, maxPages);

  if (sitemapUrls && sitemapUrls.length > 0) {
    console.log(`[${competitor.id}][step-1] Sitemap найден: ${sitemapUrls.length} URL`);
    return sitemapUrls.slice(0, maxPages);
  }

  // ── Step 1b: recursive crawl fallback ──────────────────────────────────
  console.log(`[${competitor.id}][step-1] Sitemap недоступен, запускаем рекурсивный краулер`);

  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [];
  const results: string[] = [];

  const startNorm = normalizeUrl(base);
  if (!startNorm) return [];
  queue.push({ url: startNorm, depth: 0 });

  while (queue.length > 0 && results.length < maxPages) {
    const item = queue.shift()!;

    if (visited.has(item.url)) continue;
    visited.add(item.url);

    if (FILE_EXT_RE.test(item.url)) continue;
    if (item.depth > maxDepth) continue;

    try {
      await delay(delayMs);
      const res = await axios.get(item.url, { ...HTTP_OPTS, responseType: 'text' });
      results.push(item.url);

      if (item.depth < maxDepth && results.length < maxPages) {
        const $ = cheerio.load(res.data as string);
        $('a[href]').each((_, el) => {
          const href = $(el).attr('href');
          if (!href) return;
          const norm = normalizeUrl(href, item.url);
          if (!norm) return;
          if (!sameHost(norm, base)) return;
          if (FILE_EXT_RE.test(norm)) return;
          if (!visited.has(norm)) {
            queue.push({ url: norm, depth: item.depth + 1 });
          }
        });
      }
    } catch (err: any) {
      console.warn(`[${competitor.id}][step-1] Пропуск ${item.url}: ${err.message}`);
    }
  }

  console.log(`[${competitor.id}][step-1] Краулер собрал ${results.length} URL`);
  return results;
}
