import axios from 'axios';
import * as cheerio from 'cheerio';
import { TrackField, PageMeta } from './types';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function parsePage(url: string, track: TrackField[]): Promise<PageMeta | null> {
  const delayMs = parseInt(process.env.REQUEST_DELAY_MS || '800', 10);

  try {
    const resp = await axios.get(url, {
      timeout: 20000,
      responseType: 'text',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CompetitorMonitor/1.0)' },
    });

    const $ = cheerio.load(resp.data);

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
      meta.description = ($('meta[name="description"]').attr('content') || '').trim();
    }
    if (track.includes('h1')) {
      meta.h1 = $('h1').first().text().trim();
    }

    await sleep(delayMs);
    return meta;
  } catch (err: any) {
    console.warn(`[parser] Warning: ${url} — ${err.message}`);
    await sleep(delayMs);
    return null;
  }
}
