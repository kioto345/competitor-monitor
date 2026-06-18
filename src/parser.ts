import axios from 'axios';
import * as cheerio from 'cheerio';
import { PageMeta, TrackField } from './types';

const delay = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

const HTTP_OPTS = {
  timeout: 15000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CompetitorMonitor/1.0; +https://github.com)' },
  maxRedirects: 5,
};

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    const path = u.pathname.replace(/\/$/, '') || '/';
    return u.protocol.toLowerCase() + '//' + u.host.toLowerCase() + path + u.search;
  } catch {
    return url;
  }
}

export async function parsePage(url: string, track: TrackField[]): Promise<PageMeta | null> {
  const delayMs = parseInt(process.env.REQUEST_DELAY_MS ?? '800', 10);
  await delay(delayMs);

  try {
    const res = await axios.get(url, { ...HTTP_OPTS, responseType: 'text' });
    const $ = cheerio.load(res.data as string);

    const title = track.includes('title') ? ($('title').first().text().trim()) : '';
    const description = track.includes('description')
      ? ($('meta[name="description"]').attr('content')?.trim() ?? '')
      : '';
    const h1 = track.includes('h1') ? ($('h1').first().text().trim()) : '';

    return {
      url: normalizeUrl(url),
      title,
      description,
      h1,
      scannedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    console.warn(`[parser] Ошибка ${url}: ${err.message}`);
    return null;
  }
}
