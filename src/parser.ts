import axios from 'axios';
import * as cheerio from 'cheerio';
import { PageMeta, TrackField } from './types';

const USER_AGENT = 'CompetitorMonitorBot/1.0 (+weekly site monitoring)';

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    u.hash = '';
    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    u.pathname = path;
    return u.toString();
  } catch {
    return raw;
  }
}

export async function parsePage(url: string, track: TrackField[]): Promise<PageMeta | null> {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': USER_AGENT },
      validateStatus: (s) => s >= 200 && s < 300,
    });

    const $ = cheerio.load(res.data);

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
  } catch (err: any) {
    console.warn(`  [parser] warning: failed to fetch ${url}: ${err?.message || err}`);
    return null;
  }
}
