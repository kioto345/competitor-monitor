import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

import { crawl } from './crawler';
import { parsePage } from './parser';
import { diff as diffSnapshots } from './diff';
import { formatReport, shouldSendReport, splitReportByCompetitor } from './report';
import { notify } from './notify';
import { Competitor, CompetitorResult, PageMeta, TrackField } from './types';

const ROOT = path.resolve(__dirname, '..');
const SNAPSHOTS_DIR = path.join(ROOT, 'data', 'snapshots');
const ERROR_LOG = path.join(ROOT, 'data', 'error.log');
const COMPETITORS_FILE = path.join(ROOT, 'competitors.json');
const ENV_FILE = path.join(ROOT, '.env');

const DEFAULT_TRACK: TrackField[] = ['title', 'h1', 'description'];

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function loadCompetitors(): Competitor[] {
  if (!fs.existsSync(COMPETITORS_FILE)) {
    fail('[competitor-monitor] Ошибка: competitors.json не найден.');
  }
  let raw: string;
  try {
    raw = fs.readFileSync(COMPETITORS_FILE, 'utf-8');
  } catch (err: any) {
    fail(`[competitor-monitor] Ошибка чтения competitors.json: ${err?.message || err}`);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    fail(`[competitor-monitor] Ошибка: competitors.json невалиден: ${err?.message || err}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    fail('[competitor-monitor] Ошибка: competitors.json пуст или имеет неверный формат.');
  }
  return parsed as Competitor[];
}

function loadPrevSnapshot(competitorId: string): { snapshot: PageMeta[]; isFirstRun: boolean; invalid: boolean } {
  const file = path.join(SNAPSHOTS_DIR, `${competitorId}.json`);
  if (!fs.existsSync(file)) {
    return { snapshot: [], isFirstRun: true, invalid: false };
  }
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('снэпшот не является массивом');
    }
    return { snapshot: parsed as PageMeta[], isFirstRun: false, invalid: false };
  } catch (err: any) {
    console.error(`[${competitorId}][step-3] Невалидный снэпшот: ${err?.message || err}`);
    return { snapshot: [], isFirstRun: false, invalid: true };
  }
}

function saveSnapshot(competitorId: string, pages: PageMeta[]): void {
  const file = path.join(SNAPSHOTS_DIR, `${competitorId}.json`);
  const backupFile = path.join(SNAPSHOTS_DIR, `${competitorId}.prev.json`);

  if (fs.existsSync(file)) {
    fs.copyFileSync(file, backupFile);
  }

  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(pages, null, 2), 'utf-8');
}

function logError(message: string, err: unknown): void {
  const stack = err instanceof Error ? err.stack : String(err);
  const entry = `[${new Date().toISOString()}] ${message}\n${stack}\n\n`;
  fs.mkdirSync(path.dirname(ERROR_LOG), { recursive: true });
  fs.appendFileSync(ERROR_LOG, entry, 'utf-8');
}

async function processCompetitor(competitor: Competitor): Promise<CompetitorResult> {
  const startTime = Date.now();
  const track = competitor.track && competitor.track.length > 0 ? competitor.track : DEFAULT_TRACK;
  const log = (step: string, msg: string) => console.log(`[${competitor.id}][${step}] ${msg}`);

  try {
    log('step-1', `Начинаю сбор URL для ${competitor.url}`);
    const urls = await crawl(competitor);
    log('step-1', `Собрано ${urls.length} URL`);

    log('step-2', `Извлечение метаданных с ${urls.length} страниц`);
    const pages: PageMeta[] = [];
    const delay = process.env.REQUEST_DELAY_MS ? parseInt(process.env.REQUEST_DELAY_MS, 10) : 800;
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const page = await parsePage(url, track);
      if (page) {
        pages.push(page);
      } else {
        log('step-2', `Пропущена страница (ошибка): ${url}`);
      }
      if (i < urls.length - 1 && delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    log('step-2', `Успешно извлечено ${pages.length}/${urls.length} страниц`);

    log('step-3', `Загрузка предыдущего снэпшота`);
    const { snapshot: prevSnapshot, isFirstRun, invalid } = loadPrevSnapshot(competitor.id);

    if (invalid) {
      const duration = Math.round((Date.now() - startTime) / 1000);
      return {
        competitor,
        diff: null,
        totalPages: pages.length,
        duration,
        isFirstRun: false,
        error: 'Предыдущий снэпшот повреждён (невалидный JSON), конкурент пропущен',
      };
    }

    log('step-4', `Сравнение с предыдущим снэпшотом (${prevSnapshot.length} стр.)`);
    const diffResult = diffSnapshots(prevSnapshot, pages, track);

    log('step-5', `Сохранение снэпшота (${pages.length} стр.)`);
    saveSnapshot(competitor.id, pages);

    const duration = Math.round((Date.now() - startTime) / 1000);
    log('step-6', `Готово за ${duration} сек.`);

    return {
      competitor,
      diff: diffResult,
      totalPages: pages.length,
      duration,
      isFirstRun,
      error: null,
    };
  } catch (err: any) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    log('error', `Необработанная ошибка: ${err?.message || err}`);
    logError(`[${competitor.id}] Необработанная ошибка`, err);
    return {
      competitor,
      diff: null,
      totalPages: 0,
      duration,
      isFirstRun: false,
      error: err?.message || String(err),
    };
  }
}

async function main(): Promise<void> {
  if (!fs.existsSync(ENV_FILE)) {
    console.warn('[competitor-monitor] Предупреждение: .env не найден, использую переменные окружения процесса.');
  }

  const allCompetitors = loadCompetitors();
  const only = process.env.ONLY;
  const dryRun = process.env.DRY_RUN === 'true';
  const forceReport = process.env.FORCE_REPORT === 'true';

  const competitors = only ? allCompetitors.filter((c) => c.id === only) : allCompetitors;
  if (only && competitors.length === 0) {
    fail(`[competitor-monitor] Ошибка: конкурент с id="${only}" не найден в competitors.json`);
  }

  const allResults: CompetitorResult[] = [];

  for (const competitor of competitors) {
    const result = await processCompetitor(competitor);
    allResults.push(result);
  }

  const date = new Date();
  const shouldSend = forceReport || shouldSendReport(allResults);

  if (shouldSend && !dryRun) {
    const fullReport = formatReport(allResults, date);
    const splitMessages = splitReportByCompetitor(allResults, date);
    try {
      await notify(fullReport, splitMessages);
      console.log('[competitor-monitor] Отчёт отправлен.');
    } catch (err: any) {
      console.error(`[competitor-monitor] Не удалось отправить отчёт: ${err?.message || err}`);
      logError('Не удалось отправить отчёт после всех попыток', err);
    }
  } else if (shouldSend && dryRun) {
    console.log('[competitor-monitor] DRY_RUN=true — отчёт сформирован, но не отправлен.');
    console.log(formatReport(allResults, date));
  }

  const totalPages = allResults.reduce((sum, r) => sum + r.totalPages, 0);
  const withChanges = allResults.filter((r) => !r.error && !r.isFirstRun && r.diff?.hasChanges).length;
  const channel = process.env.NOTIFY_CHANNEL || 'none';
  const dateStr = `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;

  if (shouldSend) {
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
  console.error('[competitor-monitor] Необработанная ошибка верхнего уровня:', err);
  logError('Необработанная ошибка верхнего уровня', err);
  process.exit(1);
});
