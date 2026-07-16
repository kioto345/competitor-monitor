import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { Competitor, CompetitorResult, PageMeta, TrackField } from './types';
import { crawl } from './crawler';
import { parsePage } from './parser';
import { diff } from './diff';
import { buildReport, shouldSendReport } from './report';
import { notify } from './notify';

const ROOT = path.resolve(__dirname, '..');
const SNAPSHOTS_DIR = path.join(ROOT, 'data', 'snapshots');
const COMPETITORS_PATH = path.join(ROOT, 'competitors.json');
const ERROR_LOG_PATH = path.join(ROOT, 'data', 'error.log');

const DEFAULT_TRACK: TrackField[] = ['title', 'h1', 'description'];

function log(competitorId: string, step: string, message: string): void {
  console.log(`[${competitorId}][${step}] ${message}`);
}

function loadCompetitors(): Competitor[] {
  if (!fs.existsSync(COMPETITORS_PATH)) {
    throw new Error(`competitors.json не найден по пути ${COMPETITORS_PATH}`);
  }
  const raw = fs.readFileSync(COMPETITORS_PATH, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`competitors.json содержит невалидный JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('competitors.json должен быть массивом конкурентов');
  }
  return parsed as Competitor[];
}

function loadSnapshot(id: string): { snapshot: PageMeta[]; isFirstRun: boolean } | { invalid: true } {
  const snapshotPath = path.join(SNAPSHOTS_DIR, `${id}.json`);
  if (!fs.existsSync(snapshotPath)) {
    return { snapshot: [], isFirstRun: true };
  }
  try {
    const raw = fs.readFileSync(snapshotPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { invalid: true };
    }
    return { snapshot: parsed as PageMeta[], isFirstRun: false };
  } catch {
    return { invalid: true };
  }
}

function saveSnapshot(id: string, pages: PageMeta[]): void {
  const snapshotPath = path.join(SNAPSHOTS_DIR, `${id}.json`);
  const prevPath = path.join(SNAPSHOTS_DIR, `${id}.prev.json`);

  if (fs.existsSync(snapshotPath)) {
    fs.copyFileSync(snapshotPath, prevPath);
  }

  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  fs.writeFileSync(snapshotPath, JSON.stringify(pages, null, 2), 'utf-8');
}

async function processCompetitor(competitor: Competitor): Promise<CompetitorResult> {
  const startedAt = Date.now();
  const track = competitor.track ?? DEFAULT_TRACK;

  const snapshotResult = loadSnapshot(competitor.id);
  if ('invalid' in snapshotResult) {
    log(competitor.id, 'step-3', 'Снэпшот повреждён (невалидный JSON) — пропуск конкурента.');
    return {
      competitor,
      diff: null,
      totalPages: 0,
      duration: Math.round((Date.now() - startedAt) / 1000),
      isFirstRun: false,
      error: 'Повреждённый снэпшот (невалидный JSON), конкурент пропущен',
    };
  }

  const { snapshot: prevSnapshot, isFirstRun } = snapshotResult;

  try {
    const urls = await crawl(competitor);
    log(competitor.id, 'step-1', `Собрано ${urls.length} URL.`);

    const currentPages: PageMeta[] = [];
    for (const url of urls) {
      try {
        const page = await parsePage(url, track);
        currentPages.push(page);
      } catch (err) {
        log(competitor.id, 'step-2', `Предупреждение: не удалось загрузить ${url}: ${(err as Error).message}`);
      }
    }
    log(competitor.id, 'step-2', `Извлечены метаданные для ${currentPages.length} страниц.`);

    const diffResult = diff(prevSnapshot, currentPages, track);
    log(competitor.id, 'step-4', `Diff: +${diffResult.newPages.length} новых, -${diffResult.removedPages.length} удалённых, изменений title/h1/desc: ${diffResult.changedTitle.length}/${diffResult.changedH1.length}/${diffResult.changedDesc.length}.`);

    saveSnapshot(competitor.id, currentPages);
    log(competitor.id, 'step-5', 'Снэпшот сохранён.');

    const duration = Math.round((Date.now() - startedAt) / 1000);

    return {
      competitor,
      diff: diffResult,
      totalPages: currentPages.length,
      duration,
      isFirstRun,
      error: null,
    };
  } catch (err) {
    const duration = Math.round((Date.now() - startedAt) / 1000);
    log(competitor.id, 'error', `Ошибка обработки конкурента: ${(err as Error).message}`);
    return {
      competitor,
      diff: null,
      totalPages: 0,
      duration,
      isFirstRun,
      error: (err as Error).message,
    };
  }
}

function gitCommitAndPush(dateStr: string): void {
  try {
    const status = execSync('git status --porcelain -- data/snapshots/', { cwd: ROOT }).toString().trim();
    if (!status) {
      console.log('[git] Нет изменений в data/snapshots/, коммит пропущен.');
      return;
    }
    execSync('git add data/snapshots/', { cwd: ROOT });
    execSync(`git commit -m "chore: snapshot ${dateStr}"`, { cwd: ROOT });
    execSync('git push', { cwd: ROOT });
    console.log('[git] Снэпшоты закоммичены и запушены.');
  } catch (err) {
    console.error(`[git] Ошибка при коммите/пуше: ${(err as Error).message}`);
    throw err;
  }
}

async function main(): Promise<void> {
  const competitors = loadCompetitors();
  const only = process.env.ONLY;
  const dryRun = process.env.DRY_RUN === 'true';
  const forceReport = process.env.FORCE_REPORT === 'true';

  const targets = only ? competitors.filter((c) => c.id === only) : competitors;

  const allResults: CompetitorResult[] = [];
  for (const competitor of targets) {
    const result = await processCompetitor(competitor);
    allResults.push(result);
  }

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);

  const totalPages = allResults.reduce((sum, r) => sum + r.totalPages, 0);
  const withChanges = allResults.filter((r) => !r.error && !r.isFirstRun && r.diff?.hasChanges).length;
  const channel = process.env.NOTIFY_CHANNEL || 'telegram';

  const shouldSend = forceReport || shouldSendReport(allResults);

  if (shouldSend && !dryRun) {
    await notify(allResults, now);
    console.log('[report] Отчёт отправлен.');
  } else if (shouldSend && dryRun) {
    console.log('[report] DRY_RUN включён — отчёт сформирован, но не отправлен:');
    console.log(buildReport(allResults, now));
  } else {
    console.log('[report] Изменений нет — тихий выход без отправки отчёта.');
  }

  if (!dryRun) {
    gitCommitAndPush(dateStr);
  }

  if (withChanges > 0 || forceReport) {
    console.log(`[competitor-monitor] ${dateStr} — ${allResults.length} конкурентов, ${totalPages} страниц, ${withChanges} с изменениями, отчёт → ${channel}.`);
  } else {
    console.log(`[competitor-monitor] ${dateStr} — ${allResults.length} конкурентов, ${totalPages} страниц, изменений нет. Тихий выход.`);
  }
}

main().catch((err) => {
  const stack = err instanceof Error ? (err.stack || err.message) : String(err);
  fs.mkdirSync(path.dirname(ERROR_LOG_PATH), { recursive: true });
  fs.writeFileSync(ERROR_LOG_PATH, `${new Date().toISOString()}\n${stack}\n`, 'utf-8');
  console.error('[competitor-monitor] Необработанная ошибка, см. data/error.log');
  console.error(stack);
  process.exit(1);
});
