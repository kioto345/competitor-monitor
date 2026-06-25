import axios from 'axios';
import * as cheerio from 'cheerio';
import { TrackField, PageMeta } from './types';

export async function parsePage(url: string, track: TrackField[]): Promise<PageMeta | null> {
  try {
    const resp = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'CompetitorMonitor/1.0',
        'Accept': 'text/html,application/xhtml+xml,*/*',
      },
      validateStatus: s => s < 500,
    });

    if (resp.status !== 200) {
      console.warn(`[parser] HTTP ${resp.status} для ${url}`);
      return null;
    }

    const $ = cheerio.load(resp.data as string);

    const title = track.includes('title') ? ($('title').text().trim() || '') : '';
    const h1 = track.includes('h1') ? ($('h1').first().text().trim() || '') : '';
    const description = track.includes('description')
      ? ($('meta[name="description"]').attr('content')?.trim() || '')
      : '';

    return {
      url,
      title,
      description,
      h1,
      scannedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.warn(`[parser] Ошибка ${url}: ${(err as Error).message}`);
    return null;
  }
}
