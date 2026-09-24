import axios from 'axios';
import * as cheerio from 'cheerio';
import { PageMeta, TrackField } from './types';

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
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
    return raw;
  }
}

export async function parsePage(url: string, track: TrackField[]): Promise<PageMeta | null> {
  let html: string;
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CompetitorMonitor/1.0)' },
      validateStatus: (status) => status >= 200 && status < 400,
    });
    html = typeof res.data === 'string' ? res.data : String(res.data);
  } catch (err: any) {
    console.warn(`[parser] Failed to fetch ${url}: ${err?.message || err}`);
    return null;
  }

  const $ = cheerio.load(html);

  const meta: PageMeta = {
    url: normalizeUrl(url),
    title: '',
    description: '',
    h1: '',
    scannedAt: new Date().toISOString(),
  };

  if (track.includes('title')) {
    meta.title = $('title').first().text().trim();
  }
  if (track.includes('description')) {
    meta.description = $('meta[name="description"]').first().attr('content')?.trim() || '';
  }
  if (track.includes('h1')) {
    meta.h1 = $('h1').first().text().trim();
  }

  return meta;
}
