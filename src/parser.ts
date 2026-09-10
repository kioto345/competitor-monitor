import axios from 'axios';
import * as cheerio from 'cheerio';
import { PageMeta, TrackField } from './types';

function normalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    let pathname = u.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    u.pathname = pathname;
    return u.toString();
  } catch {
    return rawUrl;
  }
}

const MAX_ATTEMPTS = 3;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtml(url: string): Promise<string | null> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await axios.get(url, {
        timeout: 15000,
        validateStatus: (s) => s >= 200 && s < 300,
        headers: { 'User-Agent': 'CompetitorMonitorBot/1.0' },
      });
      return typeof res.data === 'string' ? res.data : null;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) await delay(1000 * attempt);
    }
  }
  console.warn(`[parser] Failed to fetch ${url}: ${(lastErr as any)?.message ?? lastErr}`);
  return null;
}

export async function parsePage(url: string, track: TrackField[]): Promise<PageMeta | null> {
  const html = await fetchHtml(url);
  if (html === null) return null;

  const $ = cheerio.load(html);

  const title = track.includes('title') ? ($('title').first().text().trim() || '') : '';
  const description = track.includes('description')
    ? ($('meta[name="description"]').first().attr('content')?.trim() || '')
    : '';
  const h1 = track.includes('h1') ? ($('h1').first().text().trim() || '') : '';

  return {
    url: normalizeUrl(url),
    title,
    description,
    h1,
    scannedAt: new Date().toISOString(),
  };
}
