import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { Competitor, PageMeta, CompetitorResult, TrackField } from './types';
import { crawl } from './crawler';
import { parsePage } from './parser';
import { diff } from './diff';
import { buildReport, shouldSendReport } from './report';
import { notify } from './notify';

dotenv.config();

const SNAPSHOTS_DIR = path.join(__dirname, '..', 'data', 'snapshots');
const COMPETITORS_FILE = path.join(__dirname, '..', 'competitors.json');
const ERROR_LOG = path.join(__dirname, '..', 'data', 'error.log');

function loadCompetitors(): Competitor[] {
  if (!fs.existsSync(COMPETITORS_FILE)) {
    throw new Error(`competitors.json not found at ${COMPETITORS_FILE}`);
  }
  const raw = fs.readFileSync(COMPETITORS_FILE, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('competitors.json must be an array');
  return parsed;
}

function loadSnapshot(id: string): { pages: PageMeta[]; exists: boolean } {
  const file = path.join(SNAPSHOTS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return { pages: [], exists: false };
  const raw = fs.readFileSync(file, 'utf-8');
  try {
    const parsed = JSON.parse(raw);
    return { pages: parsed as PageMeta[], exists: true };
  } catch {
    throw new Error(`Invalid JSON in snapshot ${file}`);
  }
}

function saveSnapshot(id: string, pages: PageMeta[]): void {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  const file = path.join(SNAPSHOTS_DIR, `${id}.json`);
  const prevFile = path.join(SNAPSHOTS_DIR, `${id}.prev.json`);
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, prevFile);
  }
  fs.writeFileSync(file, JSON.stringify(pages, null, 2), 'utf-8');
}

async function processCompetitor(competitor: Competitor): Promise<CompetitorResult> {
  const track: TrackField[] = competitor.track ?? ['title', 'h1', 'description'];
  const delayMs = parseInt(process.env.REQUEST_DELAY_MS ?? '800', 10);
  const startTime = Date.now();
  let totalPages = 0;
  let isFirstRun = false;

  // Step 1 — collect URLs
  let urls: string[];
  try {
    urls = await crawl(competitor, delayMs);
  } catch (err: any) {
    console.error(`[${competitor.id}][step-1] ERROR: ${err.message}`);
    return { competitor, diff: null, totalPages: 0, duration: 0, isFirstRun: false, error: err.message };
  }

  // Step 2 — parse each page
  console.log(`[${competitor.id}][step-2] Parsing ${urls.length} pages`);
  const currentPages: PageMeta[] = [];
  for (const url of urls) {
    await new Promise(r => setTimeout(r, delayMs));
    const meta = await parsePage(url, track);
    if (meta) currentPages.push(meta);
  }
  totalPages = currentPages.length;
  console.log(`[${competitor.id}][step-2] Parsed ${totalPages} pages`);

  // Step 3 — load previous snapshot
  let prevPages: PageMeta[];
  try {
    const snap = loadSnapshot(competitor.id);
    prevPages = snap.pages;
    isFirstRun = !snap.exists;
    if (isFirstRun) console.log(`[${competitor.id}][step-3] First run, no previous snapshot`);
    else console.log(`[${competitor.id}][step-3] Loaded ${prevPages.length} pages from previous snapshot`);
  } catch (err: any) {
    console.error(`[${competitor.id}][step-3] ERROR loading snapshot: ${err.message}, skipping competitor`);
    return { competitor, diff: null, totalPages, duration: Math.round((Date.now() - startTime) / 1000), isFirstRun: false, error: err.message };
  }

  // Step 4 — diff
  const diffResult = diff(prevPages, currentPages, track);
  console.log(`[${competitor.id}][step-4] Diff: +${diffResult.newPages.length} new, -${diffResult.removedPages.length} removed, ${diffResult.changedTitle.length} title changes, ${diffResult.changedH1.length} h1 changes, ${diffResult.changedDesc.length} desc changes`);

  // Step 5 — save snapshot
  saveSnapshot(competitor.id, currentPages);
  console.log(`[${competitor.id}][step-5] Snapshot saved`);

  const duration = Math.round((Date.now() - startTime) / 1000);

  return { competitor, diff: diffResult, totalPages, duration, isFirstRun, error: null };
}

async function main() {
  const only = process.env.ONLY;
  const dryRun = process.env.DRY_RUN === 'true';
  const forceReport = process.env.FORCE_REPORT === 'true';
  const channel = process.env.NOTIFY_CHANNEL ?? 'telegram';

  let competitors: Competitor[];
  try {
    competitors = loadCompetitors();
    if (only) competitors = competitors.filter(c => c.id === only);
    if (competitors.length === 0) throw new Error(`No competitors found (ONLY=${only})`);
    console.log(`[competitor-monitor] Processing ${competitors.length} competitor(s)`);
  } catch (err: any) {
    console.error(`[competitor-monitor] FATAL: ${err.message}`);
    process.exit(1);
  }

  const allResults: CompetitorResult[] = [];

  for (const competitor of competitors) {
    console.log(`\n[${competitor.id}] Starting...`);
    try {
      const result = await processCompetitor(competitor);
      allResults.push(result);
    } catch (err: any) {
      console.error(`[${competitor.id}] UNEXPECTED ERROR: ${err.message}`);
      allResults.push({
        competitor, diff: null, totalPages: 0, duration: 0, isFirstRun: false, error: err.message
      });
    }
  }

  // Step 7 — build and send report
  const report = buildReport(allResults);
  const needsSend = forceReport || shouldSendReport(allResults);

  if (needsSend && !dryRun) {
    console.log(`\n[step-7] Sending report via ${channel}`);
    try {
      await notify(channel, report);
    } catch (err: any) {
      console.error(`[step-7] Failed to send report: ${err.message}`);
    }
  } else if (dryRun) {
    console.log(`\n[step-7] DRY_RUN — report not sent. Preview:\n${report}`);
  } else {
    console.log(`\n[step-7] No changes detected, silent exit`);
  }

  // Step 8 — git commit
  const totalPages = allResults.reduce((s, r) => s + r.totalPages, 0);
  const withChanges = allResults.filter(r => !r.isFirstRun && !r.error && r.diff?.hasChanges).length;
  const date = new Date().toISOString().slice(0, 10);

  if (!dryRun) {
    const { execSync } = require('child_process');
    try {
      const status = execSync('git status --porcelain data/snapshots/', { cwd: path.join(__dirname, '..') }).toString().trim();
      if (status) {
        execSync('git add data/snapshots/', { cwd: path.join(__dirname, '..') });
        execSync(`git commit -m "chore: snapshot ${date}"`, { cwd: path.join(__dirname, '..') });
        execSync('git push -u origin HEAD', { cwd: path.join(__dirname, '..') });
        console.log(`[step-8] Committed and pushed snapshots`);
      } else {
        console.log(`[step-8] Nothing to commit`);
      }
    } catch (err: any) {
      console.error(`[step-8] Git error: ${err.message}`);
    }
  }

  // Final output
  if (needsSend) {
    console.log(`\n[competitor-monitor] ${date} — ${competitors.length} конкурентов, ${totalPages} страниц, ${withChanges} с изменениями, отчёт → ${channel}.`);
  } else {
    console.log(`\n[competitor-monitor] ${date} — ${competitors.length} конкурентов, ${totalPages} страниц, изменений нет. Тихий выход.`);
  }
}

main().catch(err => {
  const errorLog = path.join(__dirname, '..', 'data', 'error.log');
  const msg = `${new Date().toISOString()} FATAL: ${err.stack || err.message}\n`;
  try { fs.appendFileSync(errorLog, msg); } catch {}
  console.error(msg);
  process.exit(1);
});
