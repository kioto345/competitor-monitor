import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { Competitor, CompetitorResult, PageMeta, TrackField } from './types';
import { crawl } from './crawler';
import { parsePage } from './parser';
import { diff as diffSnapshots } from './diff';
import { buildReport, shouldSendReport, splitReportByCompetitor } from './report';
import { notify } from './notify';

dotenv.config();

const ROOT = path.resolve(__dirname, '..');
const SNAPSHOTS_DIR = path.join(ROOT, 'data', 'snapshots');
const ERROR_LOG = path.join(ROOT, 'data', 'error.log');
const DEFAULT_TRACK: TrackField[] = ['title', 'h1', 'description'];

function log(competitorId: string, step: string, message: string): void {
  console.log(`[${competitorId}][${step}] ${message}`);
}

function loadCompetitors(): Competitor[] {
  const filePath = path.join(ROOT, 'competitors.json');
  if (!fs.existsSync(filePath)) {
    throw new Error(`competitors.json не найден по пути ${filePath}`);
  }
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err: any) {
    throw new Error(`Не удалось прочитать competitors.json: ${err?.message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(`competitors.json содержит невалидный JSON: ${err?.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('competitors.json должен быть массивом конкурентов');
  }
  return parsed as Competitor[];
}

function loadPrevSnapshot(competitorId: string): { snapshot: PageMeta[] | null; isFirstRun: boolean; invalid: boolean } {
  const filePath = path.join(SNAPSHOTS_DIR, `${competitorId}.json`);
  if (!fs.existsSync(filePath)) {
    return { snapshot: [], isFirstRun: true, invalid: false };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { snapshot: null, isFirstRun: false, invalid: true };
    }
    return { snapshot: parsed as PageMeta[], isFirstRun: false, invalid: false };
  } catch {
    return { snapshot: null, isFirstRun: false, invalid: true };
  }
}

function saveSnapshot(competitorId: string, curr: PageMeta[]): void {
  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  }
  const filePath = path.join(SNAPSHOTS_DIR, `${competitorId}.json`);
  const backupPath = path.join(SNAPSHOTS_DIR, `${competitorId}.prev.json`);
  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, backupPath);
  }
  fs.writeFileSync(filePath, JSON.stringify(curr, null, 2), 'utf-8');
}

async function processCompetitor(competitor: Competitor): Promise<CompetitorResult> {
  const startedAt = Date.now();
  const track = competitor.track ?? DEFAULT_TRACK;

  try {
    log(competitor.id, 'step-1', `Начинаю сбор URL для ${competitor.url}`);
    const stepStart = Date.now();
    const urls = await crawl(competitor, (msg) => log(competitor.id, 'step-1', msg));
    log(competitor.id, 'step-1', `Собрано ${urls.length} URL за ${Math.round((Date.now() - stepStart) / 1000)} сек.`);

    const { snapshot: prevSnapshot, isFirstRun, invalid } = loadPrevSnapshot(competitor.id);
    if (invalid) {
      const errMsg = `Снэпшот data/snapshots/${competitor.id}.json повреждён (невалидный JSON), конкурент пропущен`;
      log(competitor.id, 'step-3', errMsg);
      return {
        competitor,
        diff: null,
        totalPages: urls.length,
        duration: Math.round((Date.now() - startedAt) / 1000),
        isFirstRun: false,
        error: errMsg,
      };
    }

    log(competitor.id, 'step-2', `Извлекаю метаданные для ${urls.length} страниц`);
    const currentPages: PageMeta[] = [];
    for (const url of urls) {
      const meta = await parsePage(url, track);
      if (meta) currentPages.push(meta);
      const delayMs = Number(process.env.REQUEST_DELAY_MS);
      if (Number.isFinite(delayMs) && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    log(competitor.id, 'step-2', `Успешно обработано ${currentPages.length} из ${urls.length} страниц`);

    const result = diffSnapshots(prevSnapshot ?? [], currentPages, track);

    saveSnapshot(competitor.id, currentPages);
    log(competitor.id, 'step-5', `Снэпшот сохранён (${currentPages.length} стр.)`);

    const duration = Math.round((Date.now() - startedAt) / 1000);

    return {
      competitor,
      diff: result,
      totalPages: currentPages.length,
      duration,
      isFirstRun,
      error: null,
    };
  } catch (err: any) {
    const errMsg = err?.message ?? String(err);
    log(competitor.id, 'error', errMsg);
    return {
      competitor,
      diff: null,
      totalPages: 0,
      duration: Math.round((Date.now() - startedAt) / 1000),
      isFirstRun: false,
      error: errMsg,
    };
  }
}

async function main(): Promise<void> {
  const competitors = loadCompetitors();
  const only = process.env.ONLY;
  const dryRun = process.env.DRY_RUN === 'true';
  const channel = process.env.NOTIFY_CHANNEL ?? 'telegram';

  const targets = only ? competitors.filter((c) => c.id === only) : competitors;
  if (only && targets.length === 0) {
    throw new Error(`Конкурент с id="${only}" не найден в competitors.json`);
  }

  const allResults: CompetitorResult[] = [];
  for (const competitor of targets) {
    const result = await processCompetitor(competitor);
    allResults.push(result);
  }

  const date = new Date();
  const totalPages = allResults.reduce((sum, r) => sum + r.totalPages, 0);
  const withChanges = allResults.filter((r) => !r.error && !r.isFirstRun && r.diff?.hasChanges).length;

  const send = shouldSendReport(allResults);

  if (send && !dryRun) {
    const reportMarkdown = buildReport(allResults, date);
    const splitMessages = splitReportByCompetitor(allResults, date);
    try {
      await notify(channel, reportMarkdown, splitMessages, date);
      console.log(`[competitor-monitor] Отчёт отправлен через ${channel}`);
    } catch (err: any) {
      console.error(`[competitor-monitor] Не удалось отправить отчёт: ${err?.message}`);
    }
  } else if (send && dryRun) {
    console.log('[competitor-monitor] DRY_RUN=true — отчёт не отправлен, но был бы отправлен');
    console.log(buildReport(allResults, date));
  }

  if (send) {
    const dateStr = date.toISOString().slice(0, 10);
    console.log(
      `[competitor-monitor] ${dateStr} — ${allResults.length} конкурентов, ${totalPages} страниц, ${withChanges} с изменениями, отчёт → ${channel}.`
    );
  } else {
    const dateStr = date.toISOString().slice(0, 10);
    console.log(
      `[competitor-monitor] ${dateStr} — ${allResults.length} конкурентов, ${totalPages} страниц, изменений нет. Тихий выход.`
    );
  }
}

main().catch((err) => {
  const stack = err?.stack ?? String(err);
  try {
    const dataDir = path.dirname(ERROR_LOG);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.appendFileSync(ERROR_LOG, `[${new Date().toISOString()}]\n${stack}\n\n`);
  } catch {
    // ignore secondary failure writing the error log
  }
  console.error('[competitor-monitor] Необработанная ошибка:', stack);
  process.exit(1);
});
