import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

import { Competitor, CompetitorResult, DiffResult, PageMeta, TrackField } from './types';
import { crawl } from './crawler';
import { parsePage } from './parser';
import { diff as diffSnapshots } from './diff';
import { buildReport, shouldSendReport } from './report';
import { sendReport } from './notify';

const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const COMPETITORS_PATH = path.join(ROOT, 'competitors.json');
const SNAPSHOTS_DIR = path.join(ROOT, 'data', 'snapshots');
const ERROR_LOG = path.join(ROOT, 'data', 'error.log');

const DEFAULT_TRACK: TrackField[] = ['title', 'h1', 'description'];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadCompetitors(): Competitor[] {
  if (!fs.existsSync(COMPETITORS_PATH)) {
    throw new Error('competitors.json не найден');
  }
  let raw: string;
  try {
    raw = fs.readFileSync(COMPETITORS_PATH, 'utf-8');
  } catch (err) {
    throw new Error(`Не удалось прочитать competitors.json: ${(err as Error).message}`);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`competitors.json содержит невалидный JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('competitors.json должен быть массивом');
  }
  return parsed as Competitor[];
}

function loadSnapshot(id: string): { data: PageMeta[] | null; isFirstRun: boolean; invalid: boolean } {
  const file = path.join(SNAPSHOTS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) {
    return { data: [], isFirstRun: true, invalid: false };
  }
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('снэпшот не массив');
    return { data: parsed as PageMeta[], isFirstRun: false, invalid: false };
  } catch (err) {
    console.error(`[${id}] Невалидный снэпшот: ${(err as Error).message}`);
    return { data: null, isFirstRun: false, invalid: true };
  }
}

function saveSnapshot(id: string, pages: PageMeta[]): void {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  const file = path.join(SNAPSHOTS_DIR, `${id}.json`);
  const prevFile = path.join(SNAPSHOTS_DIR, `${id}.prev.json`);

  if (fs.existsSync(file)) {
    fs.copyFileSync(file, prevFile);
  }

  fs.writeFileSync(file, JSON.stringify(pages, null, 2), 'utf-8');
}

async function processCompetitor(competitor: Competitor): Promise<CompetitorResult> {
  const start = Date.now();
  const track = competitor.track && competitor.track.length > 0 ? competitor.track : DEFAULT_TRACK;

  const snapshot = loadSnapshot(competitor.id);
  if (snapshot.invalid) {
    return {
      competitor,
      diff: null,
      totalPages: 0,
      duration: 0,
      isFirstRun: false,
      error: 'Невалидный предыдущий снэпшот, конкурент пропущен',
    };
  }

  try {
    const urls = await crawl(competitor);
    console.log(`[${competitor.id}][step-1] Собрано ${urls.length} URL.`);

    const pages: PageMeta[] = [];
    for (const url of urls) {
      const meta = await parsePage(url, track);
      if (meta) pages.push(meta);
      await sleep(Number(process.env.REQUEST_DELAY_MS || 800));
    }
    console.log(`[${competitor.id}][step-2] Извлечены метаданные для ${pages.length} страниц.`);

    const prevPages = snapshot.data as PageMeta[];
    const diffResult: DiffResult = diffSnapshots(prevPages, pages, track);
    console.log(`[${competitor.id}][step-4] Diff: hasChanges=${diffResult.hasChanges}`);

    saveSnapshot(competitor.id, pages);
    console.log(`[${competitor.id}][step-5] Снэпшот сохранён.`);

    const duration = Math.round((Date.now() - start) / 1000);

    return {
      competitor,
      diff: diffResult,
      totalPages: pages.length,
      duration,
      isFirstRun: snapshot.isFirstRun,
      error: null,
    };
  } catch (err) {
    const duration = Math.round((Date.now() - start) / 1000);
    return {
      competitor,
      diff: null,
      totalPages: 0,
      duration,
      isFirstRun: snapshot.isFirstRun,
      error: (err as Error).message,
    };
  }
}

async function main(): Promise<void> {
  if (!fs.existsSync(ENV_PATH)) {
    throw new Error('.env не найден');
  }
  dotenv.config({ path: ENV_PATH });

  let competitors: Competitor[];
  try {
    competitors = loadCompetitors();
  } catch (err) {
    throw err;
  }

  const only = process.env.ONLY;
  if (only) {
    competitors = competitors.filter((c) => c.id === only);
  }

  const allResults: CompetitorResult[] = [];
  for (const competitor of competitors) {
    const result = await processCompetitor(competitor);
    allResults.push(result);
  }

  const dryRun = process.env.DRY_RUN === 'true';
  const forceReport = process.env.FORCE_REPORT === 'true';
  const channel = process.env.NOTIFY_CHANNEL || 'telegram';

  const willSend = forceReport || shouldSendReport(allResults);

  if (willSend && !dryRun) {
    await sendReport(allResults);
  } else if (willSend && dryRun) {
    console.log('[DRY_RUN] Отчёт сформирован, но не отправлен:');
    console.log(buildReport(allResults));
  }

  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10);
  const totalPages = allResults.reduce((sum, r) => sum + r.totalPages, 0);
  const withChanges = allResults.filter((r) => r.diff?.hasChanges).length;

  if (willSend) {
    console.log(
      `[competitor-monitor] ${dateStr} — ${allResults.length} конкурентов, ${totalPages} страниц, ${withChanges} с изменениями, отчёт → ${channel}.`
    );
  } else {
    console.log(
      `[competitor-monitor] ${dateStr} — ${allResults.length} конкурентов, ${totalPages} страниц, изменений нет. Тихий выход.`
    );
  }
}

main().catch((err) => {
  fs.mkdirSync(path.dirname(ERROR_LOG), { recursive: true });
  fs.appendFileSync(ERROR_LOG, `[${new Date().toISOString()}] ${err.stack || err.message}\n`);
  console.error(`[competitor-monitor] Необработанная ошибка: ${err.message}`);
  process.exit(1);
});
