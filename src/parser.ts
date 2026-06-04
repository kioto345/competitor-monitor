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
    if (res.status !== 200) {
      console.warn(`  [parser] WARN: HTTP ${res.status} for ${url}`);
      return null;
    }
    const $ = cheerio.load(res.data);
    const meta: PageMeta = {
      url,
      title: track.includes('title') ? ($('title').first().text().trim() || '') : '',
      description: track.includes('description')
        ? ($('meta[name="description"]').attr('content')?.trim() || '')
        : '',
      h1: track.includes('h1') ? ($('h1').first().text().trim() || '') : '',
      scannedAt: new Date().toISOString(),
    };
    return meta;
  } catch (err: any) {
    console.warn(`  [parser] WARN: failed to parse ${url}: ${err.message}`);
    return null;
  }
}
