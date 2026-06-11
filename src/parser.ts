import axios from 'axios';
import { load } from 'cheerio';
import { PageMeta, TrackField } from './types';

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const DELAY_MS = parseInt(process.env.REQUEST_DELAY_MS ?? '800', 10);

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const scheme = u.protocol.toLowerCase();
    const host = u.hostname.toLowerCase();
    const port = u.port ? `:${u.port}` : '';
    let pathname = u.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    return `${scheme}//${host}${port}${pathname}${u.search}`;
  } catch {
    return url;
  }
}

export async function parsePage(url: string, track: TrackField[]): Promise<PageMeta | null> {
  try {
    await delay(DELAY_MS);
    const resp = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CompetitorMonitor/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      maxRedirects: 5,
    });

    const html = String(resp.data);
    const $ = load(html);

    const meta: PageMeta = {
      url: normalizeUrl(url),
      title: '',
      description: '',
      h1: '',
      scannedAt: new Date().toISOString(),
    };

    if (track.includes('title')) {
      meta.title = $('title').text().trim().replace(/\s+/g, ' ');
    }
    if (track.includes('description')) {
      meta.description = ($('meta[name="description"]').attr('content') ?? '').trim();
    }
    if (track.includes('h1')) {
      meta.h1 = $('h1').first().text().trim().replace(/\s+/g, ' ');
    }

    return meta;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[parser] Skipping ${url}: ${msg}`);
    return null;
  }
}
