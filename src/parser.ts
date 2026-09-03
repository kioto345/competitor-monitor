import axios from 'axios';
import * as cheerio from 'cheerio';
import { PageMeta, TrackField } from './types';

const DEFAULT_TRACK: TrackField[] = ['title', 'h1', 'description'];

export function normalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    u.hash = '';
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

export async function parsePage(url: string, track: TrackField[] = DEFAULT_TRACK): Promise<PageMeta | null> {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CompetitorMonitorBot/1.0)',
      },
      responseType: 'text',
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const contentType = String(res.headers['content-type'] || '');
    if (!contentType.includes('html')) {
      return null;
    }

    const $ = cheerio.load(res.data);

    const title = track.includes('title') ? $('title').first().text().trim() : '';
    const description = track.includes('description')
      ? ($('meta[name="description"]').first().attr('content') || '').trim()
      : '';
    const h1 = track.includes('h1') ? $('h1').first().text().trim() : '';

    return {
      url: normalizeUrl(url),
      title,
      description,
      h1,
      scannedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.warn(`[parser] Failed to fetch ${url}: ${(err as Error).message}`);
    return null;
  }
}
