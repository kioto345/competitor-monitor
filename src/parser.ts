import axios from 'axios';
import * as cheerio from 'cheerio';
import { PageMeta, TrackField } from './types';

function normalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    let pathname = u.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    u.pathname = pathname;
    return `${u.protocol}//${u.hostname}${u.pathname}${u.search}`;
  } catch {
    return rawUrl;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtml(url: string): Promise<string> {
  const attempts = 3;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await axios.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': 'competitor-monitor-bot/1.0' },
        validateStatus: (s) => s >= 200 && s < 300,
      });
      return typeof res.data === 'string' ? res.data : String(res.data);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await sleep(1500 * (i + 1));
      }
    }
  }
  throw lastErr;
}

export async function parsePage(url: string, track: TrackField[]): Promise<PageMeta> {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

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
}
