import axios from 'axios';
import * as cheerio from 'cheerio';
import { PageMeta, TrackField } from './types';

export async function parsePage(url: string, track: TrackField[]): Promise<PageMeta | null> {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'CompetitorMonitor/1.0' },
      maxRedirects: 5,
    });
    const html = typeof res.data === 'string' ? res.data : String(res.data);
    const $ = cheerio.load(html);

    const meta: PageMeta = {
      url,
      title: '',
      description: '',
      h1: '',
      scannedAt: new Date().toISOString(),
    };

    if (track.includes('title')) {
      meta.title = $('title').first().text().trim();
    }
    if (track.includes('description')) {
      meta.description = $('meta[name="description"]').attr('content')?.trim() ?? '';
    }
    if (track.includes('h1')) {
      meta.h1 = $('h1').first().text().trim();
    }

    return meta;
  } catch (err: any) {
    console.warn(`[parser] Warning: failed to fetch ${url}: ${err.message}`);
    return null;
  }
}
