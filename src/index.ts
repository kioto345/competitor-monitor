import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { crawl } from './crawler';
import { parsePage } from './parser';
import { diff } from './diff';
import { sendReport } from './notify';
import { shouldSendReport } from './report';
import { Competitor, CompetitorResult, PageMeta, TrackField } from './types';

dotenv.config();

const ROOT = path.resolve(__dirname, '..');
const SNAPSHOTS_DIR = path.join(ROOT, 'data', 'snapshots');
const ERROR_LOG = path.join(ROOT, 'data', 'error.log');
const DEFAULT_TRACK: TrackField[] = ['title', 'h1', 'description'];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestDelayMs(): number {
  const v = parseInt(process.env.REQUEST_DELAY_MS || '800', 10);
  return Number.isFinite(v) && v >= 0 ? v : 800;
}

function loadCompetitors(): Competitor[] {
  const competitorsPath = path.join(ROOT, 'competitors.json');
  if (!fs.existsSync(competitorsPath)) {
    throw new Error(`competitors.json не найден по пути ${competitorsPath}`);
  }
  const raw = fs.readFileSync(competitorsPath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`competitors.json невалиден: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('competitors.json должен быть массивом конкурентов');
  }
  return parsed as Competitor[];
}

function snapshotPath(id: string): string {
  return path.join(SNAPSHOTS_DIR, `${id}.json`);
}

function backupPath(id: string): string {
  return path.join(SNAPSHOTS_DIR, `${id}.prev.json`);
}

function loadPreviousSnapshot(id: string): { snapshot: PageMeta[] | null; isFirstRun: boolean; corrupted: boolean } {
  const filePath = snapshotPath(id);
  if (!fs.existsSync(filePath)) {
    return { snapshot: [], isFirstRun: true, corrupted: false };
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('snapshot is not an array');
    return { snapshot: parsed as PageMeta[], isFirstRun: false, corrupted: false };
  } catch (err) {
    console.warn(`[${id}] Невалидный снэпшот: ${(err as Error).message}`);
    return { snapshot: null, isFirstRun: false, corrupted: true };
  }
}

function saveSnapshot(id: string, pages: PageMeta[]): void {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  const filePath = snapshotPath(id);
  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, backupPath(id));
  }
  fs.writeFileSync(filePath, JSON.stringify(pages, null, 2), 'utf-8');
}

async function processCompetitor(competitor: Competitor): Promise<CompetitorResult> {
  const id = competitor.id;
  const track = competitor.track && competitor.track.length > 0 ? competitor.track : DEFAULT_TRACK;
  const startedAt = Date.now();

  try {
    const step1Start = Date.now();
    const urls = await crawl(competitor);
    console.log(`[${id}][step-1] Собрано ${urls.length} URL за ${Math.round((Date.now() - step1Start) / 1000)} сек.`);

    const step2Start = Date.now();
    const currentPages: PageMeta[] = [];
    const delayMs = requestDelayMs();
    for (let i = 0; i < urls.length; i++) {
      if (i > 0) await delay(delayMs);
      const meta = await parsePage(urls[i], track);
      if (meta) currentPages.push(meta);
    }
    console.log(`[${id}][step-2] Извлечены метаданные ${currentPages.length}/${urls.length} страниц за ${Math.round((Date.now() - step2Start) / 1000)} сек.`);

    const { snapshot: prevSnapshot, isFirstRun, corrupted } = loadPreviousSnapshot(id);
    console.log(`[${id}][step-3] ${corrupted ? 'Снэпшот повреждён' : isFirstRun ? 'Первый запуск' : `Загружен предыдущий снэпшот (${prevSnapshot!.length} стр.)`}`);

    if (corrupted) {
      return {
        competitor,
        diff: null,
        totalPages: currentPages.length,
        duration: Math.round((Date.now() - startedAt) / 1000),
        isFirstRun: false,
        error: 'Предыдущий снэпшот повреждён (невалидный JSON), конкурент пропущен',
      };
    }

    const diffResult = diff(prevSnapshot!, currentPages, track);
    console.log(`[${id}][step-4] Diff: новых=${diffResult.newPages.length}, удалено=${diffResult.removedPages.length}, title=${diffResult.changedTitle.length}, h1=${diffResult.changedH1.length}, desc=${diffResult.changedDesc.length}`);

    saveSnapshot(id, currentPages);
    console.log(`[${id}][step-5] Снэпшот сохранён (${currentPages.length} стр.)`);

    const duration = Math.round((Date.now() - startedAt) / 1000);
    console.log(`[${id}][step-6] Обработка завершена за ${duration} сек.`);

    return {
      competitor,
      diff: diffResult,
      totalPages: currentPages.length,
      duration,
      isFirstRun,
      error: null,
    };
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.warn(`[${id}] Ошибка обработки конкурента: ${message}`);
    return {
      competitor,
      diff: null,
      totalPages: 0,
      duration: Math.round((Date.now() - startedAt) / 1000),
      isFirstRun: false,
      error: message,
    };
  }
}

async function main(): Promise<void> {
  const competitors = loadCompetitors();
  const only = process.env.ONLY;
  const targets = only ? competitors.filter((c) => c.id === only) : competitors;

  if (targets.length === 0) {
    throw new Error(only ? `Конкурент с id="${only}" не найден в competitors.json` : 'competitors.json пуст');
  }

  const allResults: CompetitorResult[] = [];
  for (const competitor of targets) {
    const result = await processCompetitor(competitor);
    allResults.push(result);
  }

  const channel = process.env.NOTIFY_CHANNEL || 'telegram';
  const dryRun = process.env.DRY_RUN === 'true';
  const totalPages = allResults.reduce((sum, r) => sum + r.totalPages, 0);
  const withChanges = allResults.filter((r) => !r.isFirstRun && !r.error && r.diff && r.diff.hasChanges).length;
  const dateStr = new Date().toISOString().slice(0, 10);

  if (shouldSendReport(allResults)) {
    if (!dryRun) {
      await sendReport(allResults);
    } else {
      await sendReport(allResults);
    }
    console.log(`[competitor-monitor] ${dateStr} — ${allResults.length} конкурентов, ${totalPages} страниц, ${withChanges} с изменениями, отчёт → ${channel}.`);
  } else {
    console.log(`[competitor-monitor] ${dateStr} — ${allResults.length} конкурентов, ${totalPages} страниц, изменений нет. Тихий выход.`);
  }
}

main().catch((err) => {
  const stack = err?.stack ?? String(err);
  fs.mkdirSync(path.dirname(ERROR_LOG), { recursive: true });
  fs.appendFileSync(ERROR_LOG, `[${new Date().toISOString()}]\n${stack}\n\n`);
  console.error('[competitor-monitor] Необработанная ошибка:', err?.message ?? err);
  process.exit(1);
});
