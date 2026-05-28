import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env') });

import { crawl } from './crawler';
import { parsePage } from './parser';
import { diff } from './diff';
import { formatReport } from './report';
import { notify } from './notify';
import { Competitor, PageMeta, CompetitorResult } from './types';

const ROOT = path.join(__dirname, '..');
const SNAPSHOTS_DIR = path.join(ROOT, 'data/snapshots');

function loadCompetitors(): Competitor[] {
  const p = path.join(ROOT, 'competitors.json');
  if (!fs.existsSync(p)) throw new Error('competitors.json not found');
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('empty or invalid array');
    return parsed as Competitor[];
  } catch (err) {
    throw new Error(`Failed to parse competitors.json: ${err}`);
  }
}

function loadSnapshot(id: string): { pages: PageMeta[]; exists: boolean } {
  const p = path.join(SNAPSHOTS_DIR, `${id}.json`);
  if (!fs.existsSync(p)) return { pages: [], exists: false };
  try {
    return { pages: JSON.parse(fs.readFileSync(p, 'utf-8')), exists: true };
  } catch (err) {
    throw new Error(`Corrupt snapshot for ${id}: ${err}`);
  }
}

function saveSnapshot(id: string, pages: PageMeta[]): void {
  const p = path.join(SNAPSHOTS_DIR, `${id}.json`);
  const prev = path.join(SNAPSHOTS_DIR, `${id}.prev.json`);
  if (fs.existsSync(p)) fs.copyFileSync(p, prev);
  fs.writeFileSync(p, JSON.stringify(pages, null, 2), 'utf-8');
}

async function processCompetitor(competitor: Competitor): Promise<CompetitorResult> {
  const startTime = Date.now();
  const track = competitor.track ?? ['title', 'h1', 'description'];
  let isFirstRun = false;
  let prevSnapshot: PageMeta[] = [];

  // Step 3: load previous snapshot
  try {
    const { pages, exists } = loadSnapshot(competitor.id);
    prevSnapshot = pages;
    isFirstRun = !exists;
  } catch (err) {
    const error = String(err);
    console.error(`[${competitor.id}][step-3] ${error}`);
    return { competitor, diff: null, totalPages: 0, duration: 0, isFirstRun: false, error };
  }

  // Step 1: collect URLs
  let urls: string[];
  try {
    urls = await crawl(competitor);
  } catch (err) {
    const error = `Step 1 failed: ${err}`;
    console.error(`[${competitor.id}] ${error}`);
    return { competitor, diff: null, totalPages: 0, duration: 0, isFirstRun, error };
  }

  // Step 2: parse metadata
  console.log(`[${competitor.id}][step-2] Parsing metadata for ${urls.length} pages...`);
  const pages: PageMeta[] = [];
  let parsed = 0;
  for (const url of urls) {
    const meta = await parsePage(url, track);
    if (meta) pages.push(meta);
    parsed++;
    if (parsed % 50 === 0) {
      console.log(`[${competitor.id}][step-2] Progress: ${parsed}/${urls.length} pages parsed`);
    }
  }
  console.log(`[${competitor.id}][step-2] Done: ${pages.length}/${urls.length} pages parsed successfully`);

  // Step 4: diff
  const diffResult = diff(prevSnapshot, pages, track);
  console.log(
    `[${competitor.id}][step-4] new=${diffResult.newPages.length} removed=${diffResult.removedPages.length} ` +
    `changedTitle=${diffResult.changedTitle.length} changedH1=${diffResult.changedH1.length} changedDesc=${diffResult.changedDesc.length}`
  );

  // Step 5: save snapshot
  try {
    saveSnapshot(competitor.id, pages);
    console.log(`[${competitor.id}][step-5] Snapshot saved to data/snapshots/${competitor.id}.json`);
  } catch (err) {
    console.error(`[${competitor.id}][step-5] Error saving snapshot: ${err}`);
  }

  const duration = Math.round((Date.now() - startTime) / 1000);
  console.log(`[${competitor.id}][step-1] Собрано ${pages.length} стр. за ${duration} сек.`);

  return { competitor, diff: diffResult, totalPages: pages.length, duration, isFirstRun, error: null };
}

async function main() {
  const onlyId = process.env.ONLY;
  const dryRun = process.env.DRY_RUN === 'true';
  const forceReport = process.env.FORCE_REPORT === 'true';

  let competitors: Competitor[];
  try {
    competitors = loadCompetitors();
  } catch (err) {
    console.error(`Fatal: ${err}`);
    process.exit(1);
  }

  if (onlyId) {
    competitors = competitors.filter(c => c.id === onlyId);
    if (competitors.length === 0) {
      console.error(`Fatal: competitor '${onlyId}' not found`);
      process.exit(1);
    }
  }

  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });

  const allResults: CompetitorResult[] = [];

  for (const competitor of competitors) {
    console.log(`\n=== [${competitor.id}] ${competitor.name} ===`);
    try {
      const result = await processCompetitor(competitor);
      allResults.push(result);
    } catch (err) {
      console.error(`[${competitor.id}] Unexpected error: ${err}`);
      allResults.push({ competitor, diff: null, totalPages: 0, duration: 0, isFirstRun: false, error: String(err) });
    }
  }

  // Step 7: report
  const allSilent = allResults.every(r => r.isFirstRun || (!r.diff?.hasChanges && !r.error));
  const now = new Date();
  const dateDisplay = now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const dateIso = now.toISOString().slice(0, 10);

  if (!allSilent || forceReport) {
    const report = formatReport(allResults, dateDisplay);
    if (dryRun) {
      console.log('\n[DRY_RUN] Report:\n' + report);
    } else {
      try {
        await notify(report);
        console.log(`\n[step-7] Report sent via ${process.env.NOTIFY_CHANNEL || 'telegram'}`);
      } catch (err) {
        console.error(`[step-7] Failed to send report: ${err}`);
        const logPath = path.join(ROOT, 'data/error.log');
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.appendFileSync(logPath, `${new Date().toISOString()} REPORT_SEND_ERROR: ${err}\n`);
      }
    }
  }

  // Step 8: git commit & push
  const totalPages = allResults.reduce((sum, r) => sum + r.totalPages, 0);
  const withChanges = allResults.filter(r => !r.isFirstRun && r.diff?.hasChanges).length;
  const channel = process.env.NOTIFY_CHANNEL || 'telegram';

  if (!dryRun) {
    const { execSync } = require('child_process');
    try {
      execSync('git add data/snapshots/', { cwd: ROOT, stdio: 'pipe' });
      const status = execSync('git status --porcelain', { cwd: ROOT }).toString().trim();
      if (status) {
        execSync(`git commit -m "chore: snapshot ${dateIso}"`, { cwd: ROOT, stdio: 'inherit' });
        execSync('git push -u origin HEAD', { cwd: ROOT, stdio: 'inherit' });
        console.log(`[step-8] Snapshots committed and pushed`);
      } else {
        console.log(`[step-8] Nothing to commit`);
      }
    } catch (err) {
      console.error(`[step-8] Git error: ${err}`);
    }
  }

  if (allSilent && !forceReport) {
    console.log(`\n[competitor-monitor] ${dateIso} — ${competitors.length} конкурентов, ${totalPages} страниц, изменений нет. Тихий выход.`);
  } else {
    console.log(`\n[competitor-monitor] ${dateIso} — ${competitors.length} конкурентов, ${totalPages} страниц, ${withChanges} с изменениями, отчёт → ${channel}.`);
  }
}

main().catch(err => {
  console.error('Unhandled error:', err);
  const logPath = path.join(ROOT, 'data/error.log');
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${new Date().toISOString()} FATAL: ${err.stack || err}\n`);
  } catch {}
  process.exit(1);
});
