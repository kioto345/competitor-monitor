import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { Competitor, CompetitorResult, PageMeta, TrackField } from './types';
import { crawl } from './crawler';
import { parsePage } from './parser';
import { diff } from './diff';
import { hasReportableChanges, formatReportText, buildCompetitorMessage } from './report';
import { notifyTelegram, notifySlack, notifyEmail } from './notify';

dotenv.config();

const ROOT = path.resolve(__dirname, '..');
const SNAPSHOTS_DIR = path.join(ROOT, 'data', 'snapshots');
const COMPETITORS_FILE = path.join(ROOT, 'competitors.json');
const ERROR_LOG = path.join(ROOT, 'data', 'error.log');

const DEFAULT_TRACK: TrackField[] = ['title', 'h1', 'description'];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadCompetitors(): Competitor[] {
  if (!fs.existsSync(COMPETITORS_FILE)) {
    throw new Error(`competitors.json не найден: ${COMPETITORS_FILE}`);
  }
  const raw = fs.readFileSync(COMPETITORS_FILE, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`competitors.json содержит невалидный JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('competitors.json пуст или имеет неверный формат');
  }
  return parsed as Competitor[];
}

function loadSnapshot(id: string): { pages: PageMeta[] | null; isFirstRun: boolean; invalid: boolean } {
  const file = path.join(SNAPSHOTS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) {
    return { pages: [], isFirstRun: true, invalid: false };
  }
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as PageMeta[];
    return { pages: parsed, isFirstRun: false, invalid: false };
  } catch (err) {
    console.error(`[${id}][step-3] Невалидный снэпшот: ${(err as Error).message}`);
    return { pages: null, isFirstRun: false, invalid: true };
  }
}

function saveSnapshot(id: string, pages: PageMeta[]): void {
  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  }
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
      error: 'Невалидный существующий снэпшот, конкурент пропущен',
    };
  }

  try {
    const urls = await crawl(competitor);
    console.log(`[${competitor.id}][step-1] Собрано ${urls.length} URL за ${((Date.now() - start) / 1000).toFixed(1)} сек.`);

    const delayMs = parseInt(process.env.REQUEST_DELAY_MS || '800', 10) || 800;
    const pages: PageMeta[] = [];
    for (let i = 0; i < urls.length; i++) {
      if (i > 0) await delay(delayMs);
      const meta = await parsePage(urls[i], track);
      if (meta) pages.push(meta);
    }
    console.log(`[${competitor.id}][step-2] Разобрано ${pages.length} страниц.`);

    const prevPages = snapshot.pages ?? [];
    const diffResult = diff(prevPages, pages, track);
    console.log(`[${competitor.id}][step-4] Diff: +${diffResult.newPages.length} -${diffResult.removedPages.length} title:${diffResult.changedTitle.length} h1:${diffResult.changedH1.length} desc:${diffResult.changedDesc.length}`);

    saveSnapshot(competitor.id, pages);
    console.log(`[${competitor.id}][step-5] Снэпшот сохранён (${pages.length} стр.).`);

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
    const message = (err as Error).message;
    console.error(`[${competitor.id}] Ошибка: ${message}`);
    return {
      competitor,
      diff: null,
      totalPages: 0,
      duration: Math.round((Date.now() - start) / 1000),
      isFirstRun: snapshot.isFirstRun,
      error: message,
    };
  }
}

async function sendReport(results: CompetitorResult[]): Promise<boolean> {
  const dryRun = process.env.DRY_RUN === 'true';
  const forceReport = process.env.FORCE_REPORT === 'true';

  const shouldSend = forceReport || hasReportableChanges(results);
  if (!shouldSend) {
    return false;
  }

  const reportText = formatReportText(results);

  if (dryRun) {
    console.log('--- DRY RUN: отчёт не отправлен ---');
    console.log(reportText);
    return true;
  }

  const channel = (process.env.NOTIFY_CHANNEL || 'telegram').toLowerCase();

  const notableBlocks = results
    .filter((r) => r.error || (!r.isFirstRun && r.diff && r.diff.hasChanges))
    .map((r) => buildCompetitorMessage(r));

  const summaryLines = reportText.split('\n');
  const summaryStart = summaryLines.findIndex((l) => l.includes('📋 ИТОГО'));
  const summary = summaryStart >= 0 ? summaryLines.slice(summaryStart - 1).join('\n') : reportText;

  try {
    if (channel === 'telegram') {
      await notifyTelegram(reportText, notableBlocks, summary);
    } else if (channel === 'slack') {
      await notifySlack(reportText);
    } else if (channel === 'email') {
      const date = new Date().toISOString().slice(0, 10);
      await notifyEmail(`[Competitor Monitor] Еженедельный отчёт ${date}`, reportText);
    } else {
      throw new Error(`Неизвестный NOTIFY_CHANNEL: ${channel}`);
    }
    console.log(`[report] Отправлено через ${channel}.`);
  } catch (err) {
    console.error(`[report] Не удалось отправить отчёт: ${(err as Error).message}`);
    throw err;
  }

  return true;
}

async function main(): Promise<void> {
  let competitors: Competitor[];
  try {
    competitors = loadCompetitors();
  } catch (err) {
    console.error(`[fatal] ${(err as Error).message}`);
    process.exit(1);
  }

  const only = process.env.ONLY;
  if (only) {
    competitors = competitors.filter((c) => c.id === only);
    if (competitors.length === 0) {
      console.error(`[fatal] Конкурент с id="${only}" не найден в competitors.json`);
      process.exit(1);
    }
  }

  const allResults: CompetitorResult[] = [];
  for (const competitor of competitors) {
    const result = await processCompetitor(competitor);
    allResults.push(result);
  }

  let reportSent = false;
  try {
    reportSent = await sendReport(allResults);
  } catch (err) {
    console.error(`[report] Финальная ошибка отправки: ${(err as Error).message}`);
  }

  const totalPages = allResults.reduce((sum, r) => sum + r.totalPages, 0);
  const withChanges = allResults.filter((r) => !r.isFirstRun && r.diff && r.diff.hasChanges).length;
  const date = new Date().toISOString().slice(0, 10);
  const channel = process.env.NOTIFY_CHANNEL || 'telegram';

  if (reportSent) {
    console.log(`[competitor-monitor] ${date} — ${allResults.length} конкурентов, ${totalPages} страниц, ${withChanges} с изменениями, отчёт → ${channel}.`);
  } else {
    console.log(`[competitor-monitor] ${date} — ${allResults.length} конкурентов, ${totalPages} страниц, изменений нет. Тихий выход.`);
  }
}

main().catch((err) => {
  const stack = (err && err.stack) || String(err);
  try {
    if (!fs.existsSync(path.dirname(ERROR_LOG))) {
      fs.mkdirSync(path.dirname(ERROR_LOG), { recursive: true });
    }
    fs.appendFileSync(ERROR_LOG, `[${new Date().toISOString()}]\n${stack}\n\n`);
  } catch {
    // ignore
  }
  console.error(stack);
  process.exit(1);
});
