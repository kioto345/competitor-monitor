import axios from 'axios';
import { load } from 'cheerio';
import { Competitor } from './types';

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const DELAY_MS = parseInt(process.env.REQUEST_DELAY_MS ?? '800', 10);

const SKIP_EXTENSIONS = [
  '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.mp4', '.mp3', '.avi', '.mov', '.webm',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.css', '.js', '.json', '.xml', '.ico',
];

function shouldSkipUrl(url: string): boolean {
  if (url.startsWith('mailto:') || url.startsWith('tel:') || url.startsWith('javascript:')) return true;
  if (url.includes('#')) return true;
  const lower = url.toLowerCase().split('?')[0];
  return SKIP_EXTENSIONS.some(ext => lower.endsWith(ext));
}

function normalizeUrl(url: string, base?: string): string {
  try {
    const resolved = base ? new URL(url, base) : new URL(url);
    const scheme = resolved.protocol.toLowerCase();
    const host = resolved.hostname.toLowerCase();
    const port = resolved.port ? `:${resolved.port}` : '';
    let pathname = resolved.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    return `${scheme}//${host}${port}${pathname}${resolved.search}`;
  } catch {
    return url;
  }
}

function isSameDomain(url: string, baseUrl: string): boolean {
  try {
    return new URL(url).hostname === new URL(baseUrl).hostname;
  } catch {
    return false;
  }
}

async function parseSitemapXml(xml: string): Promise<{ isSitemapIndex: boolean; urls: string[] }> {
  const isSitemapIndex = /<sitemapindex/i.test(xml);

  if (isSitemapIndex) {
    const urls: string[] = [];
    const matches = xml.match(/<sitemap[\s\S]*?<\/sitemap>/gi) ?? [];
    for (const block of matches) {
      const locMatch = block.match(/<loc>([\s\S]*?)<\/loc>/i);
      if (locMatch) {
        const loc = locMatch[1].trim();
        if (loc) urls.push(loc);
      }
    }
    return { isSitemapIndex: true, urls };
  }

  const urls: string[] = [];
  const $ = load(xml, { xmlMode: true });
  $('url loc').each((_, el) => {
    const loc = $(el).text().trim();
    if (loc) urls.push(loc);
  });

  if (urls.length === 0) {
    const matches = xml.match(/<loc>([\s\S]*?)<\/loc>/gi) ?? [];
    for (const m of matches) {
      const inner = m.replace(/<\/?loc>/gi, '').trim();
      if (inner && !inner.endsWith('.xml')) urls.push(inner);
    }
  }

  return { isSitemapIndex: false, urls };
}

async function fetchSitemapUrls(sitemapUrl: string, depth = 0): Promise<string[]> {
  if (depth > 3) return [];
  try {
    await delay(DELAY_MS);
    const resp = await axios.get(sitemapUrl, {
      timeout: 20000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CompetitorMonitor/1.0)' },
      maxRedirects: 5,
    });

    const { isSitemapIndex, urls } = await parseSitemapXml(String(resp.data));

    if (isSitemapIndex) {
      const all: string[] = [];
      for (const childUrl of urls) {
        const childUrls = await fetchSitemapUrls(childUrl, depth + 1);
        all.push(...childUrls);
      }
      return all;
    }

    return urls;
  } catch {
    return [];
  }
}

async function crawlRecursive(
  baseUrl: string,
  maxPages: number,
  maxDepth: number,
): Promise<string[]> {
  const visited = new Set<string>();
  const results: string[] = [];
  const queue: Array<{ url: string; depth: number }> = [{ url: baseUrl, depth: 0 }];

  while (queue.length > 0 && results.length < maxPages) {
    const { url, depth } = queue.shift()!;
    const normalized = normalizeUrl(url);

    if (visited.has(normalized)) continue;
    visited.add(normalized);

    try {
      await delay(DELAY_MS);
      const resp = await axios.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CompetitorMonitor/1.0)' },
        maxRedirects: 5,
      });

      results.push(normalized);
      console.log(`[crawler] Fetched (${results.length}/${maxPages}): ${normalized}`);

      if (depth < maxDepth) {
        const $ = load(String(resp.data));
        $('a[href]').each((_, el) => {
          const href = $(el).attr('href');
          if (!href) return;
          try {
            const absolute = new URL(href, url).href;
            if (shouldSkipUrl(absolute)) return;
            if (!isSameDomain(absolute, baseUrl)) return;
            const norm = normalizeUrl(absolute);
            if (!visited.has(norm)) {
              queue.push({ url: absolute, depth: depth + 1 });
            }
          } catch {
            // ignore invalid URLs
          }
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[crawler] Failed ${url}: ${msg}`);
    }
  }

  return results;
}

export async function crawl(competitor: Competitor): Promise<string[]> {
  const maxPages = competitor.maxPages ?? 300;
  const maxDepth = competitor.maxDepth ?? 3;
  const startTime = Date.now();

  console.log(`[${competitor.id}][step-1] Checking sitemap at ${competitor.url}/sitemap.xml ...`);
  const sitemapUrls = await fetchSitemapUrls(`${competitor.url}/sitemap.xml`);

  if (sitemapUrls.length > 0) {
    const deduped = [...new Set(sitemapUrls.map(u => normalizeUrl(u)))].slice(0, maxPages);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[${competitor.id}][step-1] Sitemap: ${deduped.length} URL за ${elapsed} сек.`);
    return deduped;
  }

  console.log(`[${competitor.id}][step-1] Sitemap not found, starting recursive crawl (maxPages=${maxPages}, maxDepth=${maxDepth}) ...`);
  const crawled = await crawlRecursive(competitor.url, maxPages, maxDepth);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[${competitor.id}][step-1] Собрано ${crawled.length} URL за ${elapsed} сек.`);
  return crawled;
}
