import axios from 'axios';
import * as cheerio from 'cheerio';
import { Competitor } from './types';

const SKIP_EXTENSIONS = /\.(pdf|jpg|jpeg|png|gif|zip|rar|tar|gz|svg|ico|css|js|woff|woff2|ttf|eot|mp4|mp3|avi|doc|docx|xls|xlsx|ppt|pptx)(\?.*)?$/i;

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    let path = u.pathname.replace(/\/+$/, '') || '/';
    u.pathname = path;
    return u.href.toLowerCase().split('?')[0] + (u.search ? u.search : '');
  } catch {
    return url;
  }
}

function isSameDomain(url: string, base: string): boolean {
  try {
    const urlHost = new URL(url).hostname;
    const baseHost = new URL(base).hostname;
    return urlHost === baseHost || urlHost.endsWith('.' + baseHost);
  } catch {
    return false;
  }
}

function shouldSkip(url: string): boolean {
  if (url.startsWith('mailto:') || url.startsWith('tel:') || url.startsWith('#')) return true;
  if (SKIP_EXTENSIONS.test(url)) return true;
  return false;
}

async function fetchSitemap(baseUrl: string, delayMs: number): Promise<string[]> {
  const urls: string[] = [];
  const sitemapUrl = baseUrl.replace(/\/$/, '') + '/sitemap.xml';
  try {
    const res = await axios.get(sitemapUrl, { timeout: 15000, headers: { 'User-Agent': 'CompetitorMonitor/1.0' } });
    if (res.status === 200 && res.data) {
      const $ = cheerio.load(res.data, { xmlMode: true });
      // Handle sitemap index
      const sitemapIndexLocs = $('sitemapindex sitemap loc');
      if (sitemapIndexLocs.length > 0) {
        const subSitemaps: string[] = [];
        sitemapIndexLocs.each((_, el) => { subSitemaps.push($(el).text().trim()); });
        for (const sub of subSitemaps) {
          await new Promise(r => setTimeout(r, delayMs));
          try {
            const subRes = await axios.get(sub, { timeout: 15000, headers: { 'User-Agent': 'CompetitorMonitor/1.0' } });
            const $sub = cheerio.load(subRes.data, { xmlMode: true });
            $sub('url loc').each((_, el) => {
              const loc = $sub(el).text().trim();
              if (loc) urls.push(loc);
            });
          } catch {
            // ignore sub-sitemap errors
          }
        }
      } else {
        $('url loc').each((_, el) => {
          const loc = $(el).text().trim();
          if (loc) urls.push(loc);
        });
      }
    }
  } catch {
    // sitemap not available
  }
  return urls;
}

async function crawlRecursive(
  startUrl: string,
  maxPages: number,
  maxDepth: number,
  delayMs: number
): Promise<string[]> {
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: normalizeUrl(startUrl), depth: 0 }];
  const result: string[] = [];

  while (queue.length > 0 && result.length < maxPages) {
    const item = queue.shift()!;
    const normUrl = item.url;

    if (visited.has(normUrl)) continue;
    visited.add(normUrl);

    if (shouldSkip(normUrl)) continue;
    if (!isSameDomain(normUrl, startUrl)) continue;

    try {
      await new Promise(r => setTimeout(r, delayMs));
      const res = await axios.get(normUrl, {
        timeout: 15000,
        headers: { 'User-Agent': 'CompetitorMonitor/1.0' },
        maxRedirects: 5,
      });
      if (res.status !== 200) continue;
      result.push(normUrl);
      console.log(`  [crawl] ${normUrl} (depth=${item.depth}, found=${result.length})`);

      if (item.depth < maxDepth) {
        const $ = cheerio.load(res.data);
        $('a[href]').each((_, el) => {
          const href = $(el).attr('href') || '';
          if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
          try {
            const abs = new URL(href, normUrl).href;
            const norm = normalizeUrl(abs);
            if (!visited.has(norm) && isSameDomain(norm, startUrl) && !shouldSkip(norm)) {
              queue.push({ url: norm, depth: item.depth + 1 });
            }
          } catch {
            // ignore invalid URLs
          }
        });
      }
    } catch (err: any) {
      console.warn(`  [crawl] WARN: failed to fetch ${normUrl}: ${err.message}`);
    }
  }

  return result;
}

export async function crawl(competitor: Competitor, delayMs: number): Promise<string[]> {
  const maxPages = competitor.maxPages ?? 300;
  const maxDepth = competitor.maxDepth ?? 3;
  const baseUrl = competitor.url.replace(/\/$/, '');

  console.log(`[${competitor.id}][step-1] Trying sitemap at ${baseUrl}/sitemap.xml`);
  const sitemapUrls = await fetchSitemap(baseUrl, delayMs);

  if (sitemapUrls.length > 0) {
    const filtered = sitemapUrls
      .filter(u => !shouldSkip(u) && isSameDomain(u, baseUrl))
      .slice(0, maxPages)
      .map(normalizeUrl);
    const unique = [...new Set(filtered)];
    console.log(`[${competitor.id}][step-1] Sitemap: ${unique.length} URLs`);
    return unique;
  }

  console.log(`[${competitor.id}][step-1] No sitemap found, starting recursive crawl`);
  const crawled = await crawlRecursive(baseUrl, maxPages, maxDepth, delayMs);
  console.log(`[${competitor.id}][step-1] Crawled: ${crawled.length} URLs`);
  return crawled;
}
