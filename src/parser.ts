import axios from 'axios';
import * as cheerio from 'cheerio';
import { PageMeta, TrackField } from './types';

const USER_AGENT = 'Mozilla/5.0 (compatible; CompetitorMonitorBot/1.0)';

function normalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    u.protocol = u.protocol.toLowerCase();
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

export async function parsePage(url: string, track: TrackField[]): Promise<PageMeta | null> {
  let html: string;
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': USER_AGENT },
      validateStatus: (s) => s >= 200 && s < 400,
    });
    html = typeof res.data === 'string' ? res.data : '';
  } catch (err: any) {
    console.warn(`[parser] Ошибка загрузки ${url}: ${err?.message ?? 'unknown'}`);
    return null;
  }

  const $ = cheerio.load(html);

  const title = track.includes('title') ? $('title').first().text().trim() : '';
  const description = track.includes('description')
    ? ($('meta[name="description"]').first().attr('content') ?? '').trim()
    : '';
  const h1 = track.includes('h1') ? $('h1').first().text().trim() : '';

  return {
    url: normalizeUrl(url),
    title,
    description,
    h1,
    scannedAt: new Date().toISOString(),
  };
}
