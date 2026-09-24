import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { crawl } from './crawler';
import { parsePage } from './parser';
import { diff as diffSnapshots } from './diff';
import { buildReport, shouldSendReport, splitReportByCompetitor } from './report';
import { notify } from './notify';
import { Competitor, CompetitorResult, PageMeta, TrackField } from './types';

dotenv.config();

const ROOT = path.resolve(__dirname, '..');
const SNAPSHOTS_DIR = path.join(ROOT, 'data', 'snapshots');
const ERROR_LOG = path.join(ROOT, 'data', 'error.log');
const COMPETITORS_FILE = path.join(ROOT, 'competitors.json');

const DEFAULT_TRACK: TrackField[] = ['title', 'h1', 'description'];

const ONLY = process.env.ONLY;
const DRY_RUN = process.env.DRY_RUN === 'true';
const FORCE_REPORT = process.env.FORCE_REPORT === 'true';

function loadCompetitors(): Competitor[] {
  if (!fs.existsSync(COMPETITORS_FILE)) {
    throw new Error('competitors.json не найден');
  }
  let raw: string;
  try {
    raw = fs.readFileSync(COMPETITORS_FILE, 'utf-8');
  } catch (err) {
    throw new Error(`Не удалось прочитать competitors.json: ${(err as Error).message}`);
  }
  let parsed: unknown;
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

function loadSnapshot(competitorId: string): { snapshot: PageMeta[]; isFirstRun: boolean } | { corrupted: true } {
  const file = path.join(SNAPSHOTS_DIR, `${competitorId}.json`);
  if (!fs.existsSync(file)) {
    return { snapshot: [], isFirstRun: true };
  }
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { corrupted: true };
    }
    return { snapshot: parsed as PageMeta[], isFirstRun: false };
  } catch {
    return { corrupted: true };
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

async function processCompetitor(competitor: Competitor): Promise<CompetitorResult> {
  const start = Date.now();
  const track = competitor.track && competitor.track.length > 0 ? competitor.track : DEFAULT_TRACK;

  try {
    console.log(`[${competitor.id}][step-1] Сбор URL начат...`);
    const step1Start = Date.now();
    const urls = await crawl(competitor);
    console.log(`[${competitor.id}][step-1] Собрано ${urls.length} URL за ${Math.round((Date.now() - step1Start) / 1000)} сек.`);

    console.log(`[${competitor.id}][step-2] Извлечение метаданных для ${urls.length} страниц...`);
    const requestDelay = Number(process.env.REQUEST_DELAY_MS || 800);
    const pages: PageMeta[] = [];
    for (const url of urls) {
      const meta = await parsePage(url, track);
      if (meta) {
        pages.push(meta);
      }
      if (requestDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, requestDelay));
      }
    }
    console.log(`[${competitor.id}][step-2] Обработано ${pages.length} страниц.`);

    console.log(`[${competitor.id}][step-3] Загрузка предыдущего снэпшота...`);
    const loaded = loadSnapshot(competitor.id);
    if ('corrupted' in loaded) {
      console.error(`[${competitor.id}][step-3] Снэпшот повреждён (невалидный JSON). Конкурент пропущен.`);
      return {
        competitor,
        diff: null,
        totalPages: pages.length,
        duration: Math.round((Date.now() - start) / 1000),
        isFirstRun: false,
        error: 'Снэпшот повреждён (невалидный JSON), пропущено без перезаписи',
      };
    }
    const { snapshot: prevPages, isFirstRun } = loaded;

    console.log(`[${competitor.id}][step-4] Сравнение снэпшотов...`);
    const diffResult = diffSnapshots(prevPages, pages, track);

    console.log(`[${competitor.id}][step-5] Сохранение снэпшота...`);
    saveSnapshot(competitor.id, pages);

    const duration = Math.round((Date.now() - start) / 1000);
    console.log(`[${competitor.id}][step-6] Готово: ${pages.length} стр. за ${duration} сек. isFirstRun=${isFirstRun} hasChanges=${diffResult.hasChanges}`);

    return {
      competitor,
      diff: diffResult,
      totalPages: pages.length,
      duration,
      isFirstRun,
      error: null,
    };
  } catch (err) {
    const duration = Math.round((Date.now() - start) / 1000);
    const message = (err as Error)?.message || String(err);
    console.error(`[${competitor.id}] Ошибка: ${message}`);
    return {
      competitor,
      diff: null,
      totalPages: 0,
      duration,
      isFirstRun: false,
      error: message,
    };
  }
}

function gitCommitSnapshots(): void {
  const { execSync } = require('child_process');
  try {
    execSync('git add data/snapshots/', { cwd: ROOT, stdio: 'inherit' });
    const status = execSync('git status --porcelain -- data/snapshots/', { cwd: ROOT }).toString().trim();
    if (!status) {
      console.log('[git] Нечего коммитить.');
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    execSync(`git commit -m "chore: weekly snapshot ${date}"`, { cwd: ROOT, stdio: 'inherit' });
    execSync('git push', { cwd: ROOT, stdio: 'inherit' });
  } catch (err) {
    console.error(`[git] Ошибка при коммите/пуше: ${(err as Error).message}`);
    throw err;
  }
}

async function main() {
  try {
    let competitors: Competitor[];
    try {
      competitors = loadCompetitors();
    } catch (err) {
      console.error(`[competitor-monitor] Ошибка конфигурации: ${(err as Error).message}`);
      process.exit(1);
      return;
    }

    if (ONLY) {
      competitors = competitors.filter((c) => c.id === ONLY);
    }

    const allResults: CompetitorResult[] = [];
    for (const competitor of competitors) {
      const result = await processCompetitor(competitor);
      allResults.push(result);
    }

    const channel = process.env.NOTIFY_CHANNEL || 'telegram';
    const totalPages = allResults.reduce((sum, r) => sum + r.totalPages, 0);
    const withChanges = allResults.filter((r) => !r.error && !r.isFirstRun && r.diff?.hasChanges).length;

    const send = FORCE_REPORT || shouldSendReport(allResults);

    if (send && !DRY_RUN) {
      const reportText = buildReport(allResults);
      const splitMessages = splitReportByCompetitor(allResults);
      try {
        await notify(channel, reportText, splitMessages);
      } catch (err) {
        console.error(`[notify] Не удалось отправить отчёт: ${(err as Error).message}`);
      }
    } else if (send && DRY_RUN) {
      console.log('[competitor-monitor] DRY_RUN=true — отчёт не отправлен.');
      console.log(buildReport(allResults));
    }

    if (!DRY_RUN) {
      gitCommitSnapshots();
    }

    const date = new Date().toISOString().slice(0, 10);
    if (withChanges > 0) {
      console.log(`[competitor-monitor] ${date} — ${allResults.length} конкурентов, ${totalPages} страниц, ${withChanges} с изменениями, отчёт → ${channel}.`);
    } else {
      console.log(`[competitor-monitor] ${date} — ${allResults.length} конкурентов, ${totalPages} страниц, изменений нет. Тихий выход.`);
    }
  } catch (err) {
    const stack = (err as Error)?.stack || String(err);
    fs.mkdirSync(path.dirname(ERROR_LOG), { recursive: true });
    fs.writeFileSync(ERROR_LOG, stack, 'utf-8');
    console.error('[competitor-monitor] Необработанная ошибка, см. data/error.log');
    process.exit(1);
  }
}

main();
