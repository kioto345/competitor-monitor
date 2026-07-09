import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { Competitor, PageMeta, CompetitorResult, TrackField } from './types';
import { crawl } from './crawler';
import { parsePage } from './parser';
import { diff } from './diff';
import { shouldSendReport, buildReport } from './report';
import { sendReport } from './notify';

const ROOT = path.resolve(__dirname, '..');
const SNAPSHOTS_DIR = path.join(ROOT, 'data', 'snapshots');
const ERROR_LOG = path.join(ROOT, 'data', 'error.log');
const COMPETITORS_FILE = path.join(ROOT, 'competitors.json');

const DEFAULT_TRACK: TrackField[] = ['title', 'h1', 'description'];
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 800);

const DRY_RUN = process.env.DRY_RUN === 'true';
const FORCE_REPORT = process.env.FORCE_REPORT === 'true';
const ONLY = process.env.ONLY;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadCompetitors(): Competitor[] {
  if (!fs.existsSync(COMPETITORS_FILE)) {
    throw new Error(`competitors.json не найден: ${COMPETITORS_FILE}`);
  }
  let raw: string;
  try {
    raw = fs.readFileSync(COMPETITORS_FILE, 'utf-8');
  } catch (err: any) {
    throw new Error(`Не удалось прочитать competitors.json: ${err.message}`);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(`competitors.json невалиден: ${err.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('competitors.json должен быть массивом');
  }
  return parsed as Competitor[];
}

function loadSnapshot(competitorId: string): { snapshot: PageMeta[]; isFirstRun: boolean } | 'invalid' {
  const file = path.join(SNAPSHOTS_DIR, `${competitorId}.json`);
  if (!fs.existsSync(file)) {
    return { snapshot: [], isFirstRun: true };
  }
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('снэпшот не массив');
    return { snapshot: parsed as PageMeta[], isFirstRun: false };
  } catch (err: any) {
    console.error(`[${competitorId}] Ошибка чтения снэпшота: ${err.message}`);
    return 'invalid';
  }
}

function saveSnapshot(competitorId: string, pages: PageMeta[]): void {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  const file = path.join(SNAPSHOTS_DIR, `${competitorId}.json`);
  const prevFile = path.join(SNAPSHOTS_DIR, `${competitorId}.prev.json`);

  if (fs.existsSync(file)) {
    fs.copyFileSync(file, prevFile);
  }

  fs.writeFileSync(file, JSON.stringify(pages, null, 2), 'utf-8');
}

async function processCompetitor(competitor: Competitor): Promise<CompetitorResult> {
  const start = Date.now();
  const track = competitor.track && competitor.track.length > 0 ? competitor.track : DEFAULT_TRACK;

  const loaded = loadSnapshot(competitor.id);
  if (loaded === 'invalid') {
    return {
      competitor,
      diff: null,
      totalPages: 0,
      duration: 0,
      isFirstRun: false,
      error: 'Невалидный снэпшот, конкурент пропущен',
    };
  }
  const { snapshot: prevSnapshot, isFirstRun } = loaded;

  try {
    const urls = await crawl(competitor);
    console.log(`[${competitor.id}][step-1] Собрано ${urls.length} URL.`);

    const pages: PageMeta[] = [];
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const meta = await parsePage(url, track);
      if (meta) pages.push(meta);
      if (i < urls.length - 1) await sleep(REQUEST_DELAY_MS);
    }
    console.log(`[${competitor.id}][step-2] Извлечено метаданных: ${pages.length}/${urls.length}.`);

    const diffResult = diff(prevSnapshot, pages, track);
    console.log(`[${competitor.id}][step-4] Изменений: ${diffResult.hasChanges ? 'да' : 'нет'}.`);

    if (!DRY_RUN) {
      saveSnapshot(competitor.id, pages);
      console.log(`[${competitor.id}][step-5] Снэпшот сохранён.`);
    } else {
      console.log(`[${competitor.id}][step-5] DRY_RUN: снэпшот не сохранён.`);
    }

    const duration = Math.round((Date.now() - start) / 1000);

    return {
      competitor,
      diff: diffResult,
      totalPages: pages.length,
      duration,
      isFirstRun,
      error: null,
    };
  } catch (err: any) {
    const duration = Math.round((Date.now() - start) / 1000);
    console.error(`[${competitor.id}] Ошибка: ${err?.message || err}`);
    return {
      competitor,
      diff: null,
      totalPages: 0,
      duration,
      isFirstRun,
      error: err?.message || String(err),
    };
  }
}

async function main() {
  let competitors: Competitor[];
  try {
    competitors = loadCompetitors();
  } catch (err: any) {
    console.error(`[competitor-monitor] Ошибка конфигурации: ${err.message}`);
    fs.mkdirSync(path.dirname(ERROR_LOG), { recursive: true });
    fs.appendFileSync(ERROR_LOG, `${new Date().toISOString()} ${err.stack || err.message}\n`);
    process.exit(1);
  }

  if (ONLY) {
    competitors = competitors.filter((c) => c.id === ONLY);
  }

  const allResults: CompetitorResult[] = [];
  for (const competitor of competitors) {
    const result = await processCompetitor(competitor);
    allResults.push(result);
  }

  const date = new Date();
  const needsReport = FORCE_REPORT || shouldSendReport(allResults);

  const channel = process.env.NOTIFY_CHANNEL || 'telegram';

  if (needsReport && !DRY_RUN) {
    try {
      await sendReport(allResults, date);
      console.log('[competitor-monitor] Отчёт отправлен.');
    } catch (err: any) {
      console.error(`[competitor-monitor] Не удалось отправить отчёт: ${err?.message || err}`);
    }
  } else if (needsReport && DRY_RUN) {
    console.log('[competitor-monitor] DRY_RUN: отчёт сформирован, но не отправлен.');
    console.log(buildReport(allResults, date));
  } else {
    console.log('[competitor-monitor] Изменений нет — тихий выход, отчёт не отправляется.');
  }

  const dateStr = date.toISOString().slice(0, 10);
  const totalPages = allResults.reduce((sum, r) => sum + r.totalPages, 0);
  const withChanges = allResults.filter((r) => !r.isFirstRun && !r.error && r.diff?.hasChanges).length;

  if (needsReport) {
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
  console.error('[competitor-monitor] Необработанная ошибка:', err);
  fs.mkdirSync(path.dirname(ERROR_LOG), { recursive: true });
  fs.appendFileSync(ERROR_LOG, `${new Date().toISOString()} ${err.stack || err.message}\n`);
  process.exit(1);
});
