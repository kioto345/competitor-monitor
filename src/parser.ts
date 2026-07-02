import axios from 'axios';
import * as cheerio from 'cheerio';
import { PageMeta, TrackField } from './types';

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.protocol = u.protocol.toLowerCase();
    u.host = u.host.toLowerCase();
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    u.hash = '';
    return u.toString().replace(/\/$/, '') || u.toString();
  } catch {
    return url;
  }
}

export async function parsePage(url: string, track: TrackField[]): Promise<PageMeta | null> {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      validateStatus: (s) => s >= 200 && s < 400,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CompetitorMonitorBot/1.0)' },
    });
    const $ = cheerio.load(res.data);

    const title = track.includes('title') ? ($('title').first().text() || '').trim() : '';
    const description = track.includes('description')
      ? ($('meta[name="description"]').attr('content') || '').trim()
      : '';
    const h1 = track.includes('h1') ? ($('h1').first().text() || '').trim() : '';

    return {
      url: normalizeUrl(url),
      title,
      description,
      h1,
      scannedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.warn(`[step-2] Ошибка загрузки страницы ${url}: ${(err as Error).message}`);
    return null;
  }
}
