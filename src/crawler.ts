import axios from 'axios';
import * as cheerio from 'cheerio';
import { Competitor } from './types';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function normalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    const normalized = u.protocol.toLowerCase() + '//' + u.hostname.toLowerCase() + u.pathname + (u.search || '');
    return normalized.replace(/\/$/, '') || u.protocol.toLowerCase() + '//' + u.hostname.toLowerCase();
  } catch {
    return rawUrl;
  }
}

function isSameDomain(url: string, base: string): boolean {
  try {
    return new URL(url).hostname === new URL(base).hostname;
  } catch {
    return false;
  }
}

function isSkippable(url: string): boolean {
  if (!url || url.startsWith('#') || url.startsWith('mailto:') || url.startsWith('tel:') || url.startsWith('javascript:')) return true;
  return /\.(pdf|jpg|jpeg|png|gif|zip|svg|ico|css|js|woff|woff2|ttf|eot|mp4|mp3|webm|avi|mov|doc|docx|xls|xlsx|ppt|pptx|xml)(\?.*)?$/i.test(url);
}

async function fetchXml(url: string): Promise<string | null> {
  try {
    const resp = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'CompetitorMonitor/1.0', 'Accept': 'text/xml,application/xml,*/*' },
      validateStatus: s => s < 500,
    });
    if (resp.status !== 200 || !resp.data) return null;
    return typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
  } catch {
    return null;
  }
}

async function parseSitemap(sitemapUrl: string, requestDelay: number, depth: number = 0): Promise<string[]> {
  if (depth > 3) return [];
  const xml = await fetchXml(sitemapUrl);
  if (!xml) return [];

  const urls: string[] = [];

  if (xml.includes('<sitemapindex')) {
    const childUrls = [...xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi)].map(m => m[1]);
    for (const childUrl of childUrls) {
      await delay(requestDelay);
      const childResults = await parseSitemap(childUrl, requestDelay, depth + 1);
      urls.push(...childResults);
    }
  } else {
    const locMatches = [...xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi)];
    for (const match of locMatches) {
      urls.push(match[1].trim());
    }
  }

  return urls;
}

export async function crawl(competitor: Competitor): Promise<string[]> {
  const requestDelay = parseInt(process.env.REQUEST_DELAY_MS || '800', 10);
  const maxPages = competitor.maxPages ?? 300;
  const maxDepth = competitor.maxDepth ?? 3;
  const baseUrl = competitor.url;

  const sitemapUrl = `${baseUrl}/sitemap.xml`;
  console.log(`[${competitor.id}][step-1] Пробуем sitemap: ${sitemapUrl}`);

  const sitemapUrls = await parseSitemap(sitemapUrl, requestDelay);

  if (sitemapUrls.length > 0) {
    const filtered = Array.from(new Set(
      sitemapUrls
        .filter(u => isSameDomain(u, baseUrl) && !isSkippable(u))
        .map(normalizeUrl)
    )).slice(0, maxPages);

    console.log(`[${competitor.id}][step-1] Sitemap: найдено ${filtered.length} URL`);
    return filtered;
  }

  console.log(`[${competitor.id}][step-1] Sitemap не найден, запускаем BFS-краулер...`);

  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: baseUrl, depth: 0 }];
  const result: string[] = [];

  while (queue.length > 0 && result.length < maxPages) {
    const { url, depth } = queue.shift()!;
    const normalized = normalizeUrl(url);

    if (visited.has(normalized)) continue;
    visited.add(normalized);

    if (!isSameDomain(url, baseUrl) || isSkippable(url)) continue;

    await delay(requestDelay);

    try {
      const resp = await axios.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': 'CompetitorMonitor/1.0', 'Accept': 'text/html,*/*' },
        validateStatus: s => s < 500,
      });

      if (resp.status !== 200) continue;
      const ct = String(resp.headers['content-type'] || '');
      if (!ct.includes('text/html')) continue;

      result.push(normalized);

      if (depth < maxDepth) {
        const $ = cheerio.load(resp.data as string);
        $('a[href]').each((_, el) => {
          const href = $(el).attr('href');
          if (!href) return;
          try {
            const absolute = new URL(href, url).href;
            const normalizedHref = normalizeUrl(absolute);
            if (!visited.has(normalizedHref) && !isSkippable(absolute) && isSameDomain(absolute, baseUrl)) {
              queue.push({ url: absolute, depth: depth + 1 });
            }
          } catch {}
        });
      }
    } catch (err) {
      console.warn(`[${competitor.id}][step-1] Ошибка ${url}: ${(err as Error).message}`);
    }
  }

  console.log(`[${competitor.id}][step-1] BFS-краулер: найдено ${result.length} URL`);
  return result;
}
