import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import { Competitor, CompetitorResult, PageMeta } from './types';
import { crawl } from './crawler';
import { parsePage } from './parser';
import { diff } from './diff';
import { formatReport, formatCompetitorSection, formatSummary } from './report';
import { sendNotification } from './notify';

dotenv.config();

const ROOT = path.resolve(__dirname, '..');
const SNAPSHOTS_DIR = path.join(ROOT, 'data', 'snapshots');
const ERROR_LOG = path.join(ROOT, 'data', 'error.log');

function loadCompetitors(): Competitor[] {
  const p = path.join(ROOT, 'competitors.json');
  if (!fs.existsSync(p)) throw new Error('competitors.json не найден');
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as Competitor[];
}

function loadSnapshot(id: string): { pages: PageMeta[] | null; exists: boolean; corrupt: boolean } {
  const p = path.join(SNAPSHOTS_DIR, `${id}.json`);
  if (!fs.existsSync(p)) return { pages: null, exists: false, corrupt: false };
  try {
    return { pages: JSON.parse(fs.readFileSync(p, 'utf-8')) as PageMeta[], exists: true, corrupt: false };
  } catch {
    return { pages: null, exists: true, corrupt: true };
  }
}

function saveSnapshot(id: string, pages: PageMeta[]): void {
  const snapshotPath = path.join(SNAPSHOTS_DIR, `${id}.json`);
  const prevPath = path.join(SNAPSHOTS_DIR, `${id}.prev.json`);
  if (fs.existsSync(snapshotPath)) fs.copyFileSync(snapshotPath, prevPath);
  fs.writeFileSync(snapshotPath, JSON.stringify(pages, null, 2), 'utf-8');
  console.log(`[${id}][step-5] Снэпшот сохранён: ${pages.length} страниц`);
}

async function processCompetitor(competitor: Competitor): Promise<CompetitorResult> {
  const t0 = Date.now();
  const track = competitor.track ?? ['title', 'h1', 'description'];

  try {
    // Step 1
    const t1 = Date.now();
    const urls = await crawl(competitor);
    console.log(`[${competitor.id}][step-1] Собрано ${urls.length} URL за ${Math.round((Date.now() - t1) / 1000)} сек.`);

    // Step 2
    console.log(`[${competitor.id}][step-2] Извлекаем метаданные (${urls.length} стр.)`);
    const currentPages: PageMeta[] = [];
    for (let i = 0; i < urls.length; i++) {
      const page = await parsePage(urls[i], track);
      if (page) currentPages.push(page);
      if ((i + 1) % 100 === 0 || i + 1 === urls.length) {
        console.log(`[${competitor.id}][step-2] ${i + 1}/${urls.length} стр. обработано`);
      }
    }

    // Step 3
    const snap = loadSnapshot(competitor.id);
    if (snap.corrupt) {
      console.error(`[${competitor.id}][step-3] Битый снэпшот — пропускаем конкурента`);
      return { competitor, diff: null, totalPages: currentPages.length, duration: Math.round((Date.now() - t0) / 1000), isFirstRun: false, error: 'Невалидный JSON в файле снэпшота' };
    }
    const isFirstRun = !snap.exists;
    console.log(`[${competitor.id}][step-3] Снэпшот: ${isFirstRun ? 'первый запуск' : (snap.pages!.length + ' стр.')}`);

    // Step 4
    const diffResult = diff(snap.pages ?? [], currentPages, track);
    console.log(`[${competitor.id}][step-4] Diff: +${diffResult.newPages.length} новых, -${diffResult.removedPages.length} удалённых, ${diffResult.changedTitle.length + diffResult.changedH1.length + diffResult.changedDesc.length} изменений`);

    // Step 5
    saveSnapshot(competitor.id, currentPages);

    return { competitor, diff: diffResult, totalPages: currentPages.length, duration: Math.round((Date.now() - t0) / 1000), isFirstRun, error: null };
  } catch (err: any) {
    console.error(`[${competitor.id}] Необработанная ошибка: ${err.message}`);
    return { competitor, diff: null, totalPages: 0, duration: Math.round((Date.now() - t0) / 1000), isFirstRun: false, error: err.message };
  }
}

async function main() {
  const today = new Date().toISOString().split('T')[0];

  if (!process.env.NOTIFY_CHANNEL) throw new Error('NOTIFY_CHANNEL не задан. Проверьте .env');

  let competitors: Competitor[];
  try {
    competitors = loadCompetitors();
  } catch (err: any) {
    fs.appendFileSync(ERROR_LOG, `${new Date().toISOString()} — ${err.message}\n`);
    process.exit(1);
  }

  const only = process.env.ONLY;
  const list = only ? competitors.filter(c => c.id === only) : competitors;
  console.log(`[competitor-monitor] Запуск ${today}, конкурентов: ${list.length}`);

  // Steps 1–6 for each competitor
  const allResults: CompetitorResult[] = [];
  for (const competitor of list) {
    console.log(`\n=== ${competitor.name} (${competitor.id}) ===`);
    allResults.push(await processCompetitor(competitor));
  }

  // Step 7
  const dryRun = process.env.DRY_RUN === 'true';
  const forceReport = process.env.FORCE_REPORT === 'true';
  const totalPages = allResults.reduce((s, r) => s + r.totalPages, 0);
  const withChanges = allResults.filter(r => r.diff?.hasChanges).length;
  const hasAnythingToReport = forceReport || allResults.some(r => !r.isFirstRun && r.error === null && (r.diff?.hasChanges || false));

  if (hasAnythingToReport && !dryRun) {
    const fullReport = formatReport(allResults);
    console.log(`[competitor-monitor] Отправляем отчёт (${fullReport.length} символов)`);
    await sendNotification(fullReport);
  } else if (dryRun && hasAnythingToReport) {
    console.log('[competitor-monitor] DRY_RUN: отчёт не отправлен');
    console.log(formatReport(allResults));
  }

  // Step 8: git commit & push
  if (!dryRun) {
    try {
      const gitStatus = execSync('git status --porcelain data/snapshots/', { cwd: ROOT }).toString().trim();
      if (gitStatus) {
        execSync('git add data/snapshots/', { cwd: ROOT });
        execSync(`git commit -m "chore: snapshot ${today}"`, { cwd: ROOT });
        execSync('git push -u origin claude/beautiful-mendel-m7bbbe', { cwd: ROOT });
        console.log(`[competitor-monitor] Снэпшоты закоммичены и запушены`);
      } else {
        console.log(`[competitor-monitor] Нечего коммитить — снэпшоты не изменились`);
      }
    } catch (err: any) {
      console.error(`[competitor-monitor] Ошибка git: ${err.message}`);
    }
  }

  // Final line
  if (hasAnythingToReport) {
    console.log(`\n[competitor-monitor] ${today} — ${list.length} конкурентов, ${totalPages} страниц, ${withChanges} с изменениями, отчёт → ${process.env.NOTIFY_CHANNEL}.`);
  } else {
    console.log(`\n[competitor-monitor] ${today} — ${list.length} конкурентов, ${totalPages} страниц, изменений нет. Тихий выход.`);
  }
}

main().catch(err => {
  fs.appendFileSync(ERROR_LOG, `${new Date().toISOString()} — FATAL: ${err.stack ?? err.message}\n`);
  console.error(err);
  process.exit(1);
});
