import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { crawl } from './crawler';
import { parsePage } from './parser';
import { diff } from './diff';
import { buildReport } from './report';
import { notify } from './notify';
import { Competitor, CompetitorResult, PageMeta } from './types';

const SNAPSHOTS_DIR = path.join(__dirname, '..', 'data', 'snapshots');
const COMPETITORS_FILE = path.join(__dirname, '..', 'competitors.json');
const REQUEST_DELAY_MS = parseInt(process.env.REQUEST_DELAY_MS || '800', 10);

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function loadCompetitors(): Competitor[] {
  if (!fs.existsSync(COMPETITORS_FILE)) {
    throw new Error(`competitors.json не найден: ${COMPETITORS_FILE}`);
  }
  const raw = fs.readFileSync(COMPETITORS_FILE, 'utf-8');
  return JSON.parse(raw) as Competitor[];
}

type SnapshotResult = PageMeta[] | null | 'INVALID';

function loadSnapshot(id: string): SnapshotResult {
  const filePath = path.join(SNAPSHOTS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PageMeta[];
  } catch {
    console.error(`[${id}][step-3] Невалидный JSON в снэпшоте`);
    return 'INVALID';
  }
}

function saveSnapshot(id: string, pages: PageMeta[]): void {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  const filePath = path.join(SNAPSHOTS_DIR, `${id}.json`);
  const prevPath = path.join(SNAPSHOTS_DIR, `${id}.prev.json`);
  if (fs.existsSync(filePath)) fs.copyFileSync(filePath, prevPath);
  fs.writeFileSync(filePath, JSON.stringify(pages, null, 2), 'utf-8');
}

function formatDate(): string {
  const now = new Date();
  const months = [
    'января','февраля','марта','апреля','мая','июня',
    'июля','августа','сентября','октября','ноября','декабря',
  ];
  return `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
}

async function processCompetitor(competitor: Competitor): Promise<CompetitorResult> {
  const start = Date.now();
  const track = competitor.track ?? ['title', 'h1', 'description'];

  // Step 1: Collect URLs
  let urls: string[];
  try {
    urls = await crawl(competitor);
  } catch (err) {
    const msg = `Ошибка краулинга: ${(err as Error).message}`;
    console.error(`[${competitor.id}] ${msg}`);
    return { competitor, diff: null, totalPages: 0, duration: elapsed(start), isFirstRun: false, error: msg };
  }
  console.log(`[${competitor.id}][step-1] Собрано ${urls.length} URL за ${elapsed(start)}с`);

  // Step 2: Parse each page
  console.log(`[${competitor.id}][step-2] Парсим ${urls.length} страниц...`);
  const currentPages: PageMeta[] = [];

  for (let i = 0; i < urls.length; i++) {
    await delay(REQUEST_DELAY_MS);
    const page = await parsePage(urls[i], track);
    if (page) currentPages.push(page);
    if ((i + 1) % 50 === 0 || i + 1 === urls.length) {
      console.log(`[${competitor.id}][step-2] ${i + 1}/${urls.length} страниц обработано`);
    }
  }
  console.log(`[${competitor.id}][step-2] Получено метаданных: ${currentPages.length} страниц`);

  // Step 3: Load previous snapshot
  const snapshotResult = loadSnapshot(competitor.id);

  if (snapshotResult === 'INVALID') {
    const msg = 'Невалидный JSON в снэпшоте — конкурент пропущен';
    console.error(`[${competitor.id}][step-3] ${msg}`);
    return { competitor, diff: null, totalPages: currentPages.length, duration: elapsed(start), isFirstRun: false, error: msg };
  }

  const prevSnapshot: PageMeta[] = snapshotResult ?? [];
  const isFirstRun = snapshotResult === null;

  console.log(`[${competitor.id}][step-3] ${isFirstRun ? 'Первый запуск' : `Снэпшот загружен: ${prevSnapshot.length} страниц`}`);

  // Step 4: Diff
  const diffResult = diff(prevSnapshot, currentPages, track);
  console.log(`[${competitor.id}][step-4] Новых: ${diffResult.newPages.length}, удалённых: ${diffResult.removedPages.length}, изм.title: ${diffResult.changedTitle.length}, H1: ${diffResult.changedH1.length}, desc: ${diffResult.changedDesc.length}`);

  // Step 5: Save snapshot
  saveSnapshot(competitor.id, currentPages);
  console.log(`[${competitor.id}][step-5] Снэпшот сохранён`);

  return {
    competitor,
    diff: diffResult,
    totalPages: currentPages.length,
    duration: elapsed(start),
    isFirstRun,
    error: null,
  };
}

function elapsed(start: number): number {
  return Math.round((Date.now() - start) / 1000);
}

async function main(): Promise<void> {
  const totalStart = Date.now();

  let competitors: Competitor[];
  try {
    competitors = loadCompetitors();
    if (!Array.isArray(competitors) || competitors.length === 0) {
      throw new Error('competitors.json пуст или невалиден');
    }
  } catch (err) {
    console.error(`[main] Ошибка загрузки конкурентов: ${(err as Error).message}`);
    process.exit(1);
  }

  const only = process.env.ONLY;
  if (only) {
    competitors = competitors.filter(c => c.id === only);
    if (competitors.length === 0) {
      console.error(`[main] Конкурент id="${only}" не найден`);
      process.exit(1);
    }
  }

  console.log(`[main] Начинаем мониторинг ${competitors.length} конкурент(ов): ${competitors.map(c => c.id).join(', ')}`);

  const allResults: CompetitorResult[] = [];

  for (const competitor of competitors) {
    console.log(`\n[main] ===== ${competitor.name} (${competitor.id}) =====`);
    const result = await processCompetitor(competitor);
    allResults.push(result);
    // Step 6: log accumulation
    console.log(`[${competitor.id}][step-6] Страниц: ${result.totalPages}, время: ${result.duration}с, первый запуск: ${result.isFirstRun}, ошибка: ${result.error ?? 'нет'}`);
  }

  // Step 7: Report
  const allFirstRunOrEmpty = allResults.every(r => r.isFirstRun || (!r.diff?.hasChanges && !r.error));
  const hasRealChanges = allResults.some(r => !r.isFirstRun && (r.diff?.hasChanges || r.error));
  const dryRun = process.env.DRY_RUN === 'true';
  const forceReport = process.env.FORCE_REPORT === 'true';

  const date = formatDate();

  if (hasRealChanges || forceReport) {
    const messages = buildReport(allResults, date);
    if (!dryRun) {
      console.log(`\n[main][step-7] Отправляем отчёт (${messages.length} сообщ.)...`);
      await notify(messages);
      console.log(`[main][step-7] Отчёт отправлен`);
    } else {
      console.log(`\n[main][step-7] DRY_RUN: отчёт не отправлен`);
      messages.forEach((m, i) => console.log(`--- Сообщение ${i + 1} ---\n${m}`));
    }
  } else {
    console.log(`\n[main][step-7] ${allFirstRunOrEmpty ? 'Все конкуренты на первом запуске или без изменений' : 'Нет изменений'} — отчёт не отправляем`);
  }

  const totalPages = allResults.reduce((s, r) => s + r.totalPages, 0);
  const withChanges = allResults.filter(r => !r.isFirstRun && r.diff?.hasChanges).length;
  const channel = process.env.NOTIFY_CHANNEL || 'telegram';

  if (hasRealChanges) {
    console.log(`\n[competitor-monitor] ${date} — ${allResults.length} конкурентов, ${totalPages} страниц, ${withChanges} с изменениями, отчёт → ${channel}.`);
  } else {
    console.log(`\n[competitor-monitor] ${date} — ${allResults.length} конкурентов, ${totalPages} страниц, изменений нет. Тихий выход.`);
  }
}

main().catch(err => {
  console.error('[main] Необработанная ошибка:', err);
  fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
  fs.appendFileSync(
    path.join(__dirname, '..', 'data', 'error.log'),
    `${new Date().toISOString()} — ${err.stack || err.message}\n`,
  );
  process.exit(1);
});
