import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { crawl } from './crawler';
import { parsePage } from './parser';
import { diff as diffSnapshots } from './diff';
import { sendReport } from './notify';
import { shouldSendReport } from './report';
import {
  Competitor,
  CompetitorResult,
  DEFAULT_TRACK,
  PageMeta,
  TrackField,
} from './types';

const ROOT = path.resolve(__dirname, '..');
const SNAPSHOTS_DIR = path.join(ROOT, 'data', 'snapshots');
const ERROR_LOG = path.join(ROOT, 'data', 'error.log');

function log(id: string, step: string, message: string): void {
  console.log(`[${id}][${step}] ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadCompetitors(): Competitor[] {
  const filePath = path.join(ROOT, 'competitors.json');
  if (!fs.existsSync(filePath)) {
    throw new Error(`competitors.json не найден по пути ${filePath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    throw new Error(`competitors.json содержит невалидный JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('competitors.json должен содержать непустой массив конкурентов');
  }
  return parsed as Competitor[];
}

function snapshotPath(id: string): string {
  return path.join(SNAPSHOTS_DIR, `${id}.json`);
}

function prevSnapshotPath(id: string): string {
  return path.join(SNAPSHOTS_DIR, `${id}.prev.json`);
}

interface LoadedSnapshot {
  pages: PageMeta[] | null;
  isFirstRun: boolean;
  invalid: boolean;
}

function loadPrevSnapshot(id: string): LoadedSnapshot {
  const file = snapshotPath(id);
  if (!fs.existsSync(file)) {
    return { pages: [], isFirstRun: true, invalid: false };
  }
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('снэпшот не является массивом');
    return { pages: parsed as PageMeta[], isFirstRun: false, invalid: false };
  } catch (err) {
    log(id, 'step-3', `Невалидный снэпшот: ${(err as Error).message}`);
    return { pages: null, isFirstRun: false, invalid: true };
  }
}

async function processCompetitor(competitor: Competitor): Promise<CompetitorResult> {
  const startedAt = Date.now();
  const track: TrackField[] = competitor.track ?? DEFAULT_TRACK;

  const prevSnapshot = loadPrevSnapshot(competitor.id);
  if (prevSnapshot.invalid) {
    return {
      competitor,
      diff: null,
      totalPages: 0,
      duration: Math.round((Date.now() - startedAt) / 1000),
      isFirstRun: false,
      error: 'Невалидный JSON в предыдущем снэпшоте, конкурент пропущен',
    };
  }

  try {
    const urls = await crawl(competitor);

    const requestDelayMs = Number(process.env.REQUEST_DELAY_MS || 800);
    const currentPages: PageMeta[] = [];
    for (const url of urls) {
      try {
        const meta = await parsePage(url, track);
        currentPages.push(meta);
      } catch (err) {
        log(competitor.id, 'step-2', `Пропуск ${url}: ${(err as Error).message || err}`);
      }
      await sleep(requestDelayMs);
    }
    log(competitor.id, 'step-2', `Обработано ${currentPages.length} из ${urls.length} страниц.`);

    const prevPages = prevSnapshot.pages ?? [];
    const result = diffSnapshots(prevPages, currentPages, track);
    log(
      competitor.id,
      'step-4',
      `new=${result.newPages.length} removed=${result.removedPages.length} title=${result.changedTitle.length} h1=${result.changedH1.length} desc=${result.changedDesc.length}`,
    );

    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    const currentSnapshotFile = snapshotPath(competitor.id);
    if (fs.existsSync(currentSnapshotFile)) {
      fs.copyFileSync(currentSnapshotFile, prevSnapshotPath(competitor.id));
    }
    fs.writeFileSync(currentSnapshotFile, JSON.stringify(currentPages, null, 2));
    log(competitor.id, 'step-5', `Снэпшот сохранён (${currentPages.length} стр.).`);

    return {
      competitor,
      diff: prevSnapshot.isFirstRun ? null : result,
      totalPages: currentPages.length,
      duration: Math.round((Date.now() - startedAt) / 1000),
      isFirstRun: prevSnapshot.isFirstRun,
      error: null,
    };
  } catch (err) {
    log(competitor.id, 'step-1', `Ошибка: ${(err as Error).message || err}`);
    return {
      competitor,
      diff: null,
      totalPages: 0,
      duration: Math.round((Date.now() - startedAt) / 1000),
      isFirstRun: prevSnapshot.isFirstRun,
      error: (err as Error).message || String(err),
    };
  }
}

async function main(): Promise<void> {
  const competitors = loadCompetitors();
  const only = process.env.ONLY;
  const dryRun = process.env.DRY_RUN === 'true';
  const forceReport = process.env.FORCE_REPORT === 'true';

  const targets = only ? competitors.filter((c) => c.id === only) : competitors;
  if (targets.length === 0) {
    throw new Error(`Конкурент с id=${only} не найден в competitors.json`);
  }

  const allResults: CompetitorResult[] = [];
  for (const competitor of targets) {
    const result = await processCompetitor(competitor);
    allResults.push(result);
  }

  const date = new Date();
  const hasReportableChanges = shouldSendReport(allResults);

  if (!dryRun && (forceReport || hasReportableChanges)) {
    try {
      await sendReport(allResults, date);
      log('report', 'step-7', `Отчёт отправлен через ${process.env.NOTIFY_CHANNEL || 'telegram'}.`);
    } catch (err) {
      log('report', 'step-7', `Не удалось отправить отчёт: ${(err as Error).message || err}`);
    }
  } else if (dryRun) {
    log('report', 'step-7', 'DRY_RUN=true — отчёт не отправлен.');
  } else {
    log('report', 'step-7', 'Изменений нет — тихий выход без отправки отчёта.');
  }

  const totalPages = allResults.reduce((sum, r) => sum + r.totalPages, 0);
  const dateStr = date.toISOString().slice(0, 10);
  const channel = process.env.NOTIFY_CHANNEL || 'telegram';

  if (hasReportableChanges) {
    console.log(
      `[competitor-monitor] ${dateStr} — ${allResults.length} конкурентов, ${totalPages} страниц, ${allResults.filter((r) => !r.error && !r.isFirstRun && r.diff?.hasChanges).length} с изменениями, отчёт → ${channel}.`,
    );
  } else {
    console.log(
      `[competitor-monitor] ${dateStr} — ${allResults.length} конкурентов, ${totalPages} страниц, изменений нет. Тихий выход.`,
    );
  }
}

main().catch((err: Error) => {
  fs.mkdirSync(path.dirname(ERROR_LOG), { recursive: true });
  fs.writeFileSync(ERROR_LOG, `${new Date().toISOString()}\n${err.stack || err.message}\n`);
  console.error('[competitor-monitor] Необработанная ошибка:', err.message);
  process.exit(1);
});
