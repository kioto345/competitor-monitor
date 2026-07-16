import axios from 'axios';
import * as cheerio from 'cheerio';
import { PageMeta, TrackField } from './types';

const REQUEST_TIMEOUT_MS = 15000;

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const scheme = parsed.protocol.toLowerCase();
    const host = parsed.host.toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${scheme}//${host}${path}${parsed.search}`;
  } catch {
    return url.replace(/\/+$/, '');
  }
}

export async function parsePage(url: string, track: TrackField[]): Promise<PageMeta> {
  const res = await axios.get(url, {
    timeout: REQUEST_TIMEOUT_MS,
    headers: { 'User-Agent': 'CompetitorMonitorBot/1.0' },
    validateStatus: (status) => status >= 200 && status < 400,
  });

  const $ = cheerio.load(typeof res.data === 'string' ? res.data : String(res.data));

  const title = track.includes('title') ? $('title').first().text().trim() : '';
  const description = track.includes('description')
    ? ($('meta[name="description"]').attr('content') || '').trim()
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
