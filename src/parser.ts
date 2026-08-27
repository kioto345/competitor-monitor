import axios from 'axios';
import * as cheerio from 'cheerio';
import { PageMeta, TrackField } from './types';

const USER_AGENT = 'CompetitorMonitorBot/1.0 (+https://github.com/)';

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

export async function parsePage(url: string, track: TrackField[]): Promise<PageMeta | null> {
  let html: string;
  try {
    const res = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 15000,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    html = typeof res.data === 'string' ? res.data : String(res.data);
  } catch (err: any) {
    console.warn(`  [warn] Failed to fetch ${url}: ${err?.message ?? err}`);
    return null;
  }

  const $ = cheerio.load(html);

  const title = track.includes('title') ? ($('title').first().text().trim() || '') : '';
  const description = track.includes('description')
    ? ($('meta[name="description"]').attr('content')?.trim() || '')
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
