import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { Competitor, PageMeta, CompetitorResult, TrackField } from './types';
import { crawl } from './crawler';
import { parsePage } from './parser';
import { diff } from './diff';
import { formatReport } from './report';
import { sendNotification } from './notify';

dotenv.config();

const SNAPSHOT_DIR = path.join(__dirname, '..', 'data', 'snapshots');
const DELAY = parseInt(process.env.REQUEST_DELAY_MS || '800', 10);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadCompetitors(): Competitor[] {
  const configPath = path.join(__dirname, '..', 'competitors.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('competitors.json not found');
  }
  const raw = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(raw) as Competitor[];
}

function loadSnapshot(id: string): { pages: PageMeta[]; exists: boolean } {
  const snapshotPath = path.join(SNAPSHOT_DIR, `${id}.json`);
  if (!fs.existsSync(snapshotPath)) {
    return { pages: [], exists: false };
  }
  try {
    const raw = fs.readFileSync(snapshotPath, 'utf-8');
    const pages = JSON.parse(raw) as PageMeta[];
    return { pages, exists: true };
  } catch (err: any) {
    throw new Error(`Invalid JSON in snapshot ${id}.json: ${err.message}`);
  }
}

function saveSnapshot(id: string, pages: PageMeta[]): void {
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }
  const snapshotPath = path.join(SNAPSHOT_DIR, `${id}.json`);
  const prevPath = path.join(SNAPSHOT_DIR, `${id}.prev.json`);

  // Backup existing
  if (fs.existsSync(snapshotPath)) {
    fs.copyFileSync(snapshotPath, prevPath);
  }

  fs.writeFileSync(snapshotPath, JSON.stringify(pages, null, 2), 'utf-8');
}

async function processCompetitor(competitor: Competitor): Promise<CompetitorResult> {
  const startTime = Date.now();
  const track: TrackField[] = competitor.track ?? ['title', 'h1', 'description'];

  // Handle ONLY env variable
  const only = process.env.ONLY;
  if (only && competitor.id !== only) {
    return {
      competitor,
      diff: null,
      totalPages: 0,
      duration: 0,
      isFirstRun: false,
      error: 'skipped (ONLY filter)',
    };
  }

  try {
    // Step 1: Collect URLs
    const urls = await crawl(competitor);

    // Step 2: Parse each page
    console.log(`[${competitor.id}][step-2] Parsing ${urls.length} pages...`);
    const currentPages: PageMeta[] = [];
    for (const url of urls) {
      const meta = await parsePage(url, track);
      if (meta) {
        currentPages.push(meta);
      }
      await sleep(DELAY);
    }
    console.log(`[${competitor.id}][step-2] Parsed ${currentPages.length} pages.`);

    // Step 3: Load previous snapshot
    let prevPages: PageMeta[] = [];
    let isFirstRun = false;

    try {
      const snapshot = loadSnapshot(competitor.id);
      prevPages = snapshot.pages;
      isFirstRun = !snapshot.exists;
    } catch (err: any) {
      console.error(`[${competitor.id}][step-3] Error loading snapshot: ${err.message}, skipping competitor.`);
      return {
        competitor,
        diff: null,
        totalPages: currentPages.length,
        duration: Math.round((Date.now() - startTime) / 1000),
        isFirstRun: false,
        error: err.message,
      };
    }

    // Step 4: Diff
    console.log(`[${competitor.id}][step-4] Comparing snapshots...`);
    const diffResult = diff(prevPages, currentPages, track);
    console.log(`[${competitor.id}][step-4] New: ${diffResult.newPages.length}, Removed: ${diffResult.removedPages.length}, Changed title: ${diffResult.changedTitle.length}, H1: ${diffResult.changedH1.length}, Desc: ${diffResult.changedDesc.length}`);

    // Step 5: Save snapshot
    console.log(`[${competitor.id}][step-5] Saving snapshot...`);
    saveSnapshot(competitor.id, currentPages);

    const duration = Math.round((Date.now() - startTime) / 1000);
    console.log(`[${competitor.id}] Done in ${duration}s. Pages: ${currentPages.length}.`);

    return {
      competitor,
      diff: diffResult,
      totalPages: currentPages.length,
      duration,
      isFirstRun,
      error: null,
    };
  } catch (err: any) {
    console.error(`[${competitor.id}] Error: ${err.message}`);
    const duration = Math.round((Date.now() - startTime) / 1000);
    return {
      competitor,
      diff: null,
      totalPages: 0,
      duration,
      isFirstRun: false,
      error: err.message,
    };
  }
}

async function main(): Promise<void> {
  const date = new Date();
  console.log(`[competitor-monitor] Starting run at ${date.toISOString()}`);

  // Load competitors
  let competitors: Competitor[];
  try {
    competitors = loadCompetitors();
  } catch (err: any) {
    console.error(`Fatal: ${err.message}`);
    process.exit(1);
  }

  if (competitors.length === 0) {
    console.error('Fatal: competitors.json is empty');
    process.exit(1);
  }

  // Process each competitor
  const allResults: CompetitorResult[] = [];
  for (const competitor of competitors) {
    console.log(`\n[competitor-monitor] Processing competitor: ${competitor.name} (${competitor.id})`);
    const result = await processCompetitor(competitor);
    allResults.push(result);
  }

  // Step 7: Generate and send report
  const dryRun = process.env.DRY_RUN === 'true';
  const forceReport = process.env.FORCE_REPORT === 'true';

  const report = formatReport(allResults, date);

  if (report) {
    if (dryRun) {
      console.log('\n[DRY_RUN] Report (not sent):\n', report);
    } else {
      console.log('[competitor-monitor] Sending report...');
      try {
        await sendNotification(report);
        console.log('[competitor-monitor] Report sent successfully.');
      } catch (err: any) {
        console.error(`[competitor-monitor] Failed to send report: ${err.message}`);
        // Log to error.log
        const errorLogPath = path.join(__dirname, '..', 'data', 'error.log');
        fs.appendFileSync(errorLogPath, `${date.toISOString()} - Failed to send report: ${err.message}\n${err.stack}\n`);
      }
    }
  } else {
    console.log('[competitor-monitor] No changes detected, skipping report.');
  }

  // Step 8: Summary
  const total = allResults.reduce((sum, r) => sum + r.totalPages, 0);
  const withChanges = allResults.filter(r => r.diff?.hasChanges).length;
  const channel = process.env.NOTIFY_CHANNEL || 'telegram';
  const dateStr = date.toISOString().split('T')[0];

  if (report && !dryRun) {
    console.log(`\n[competitor-monitor] ${dateStr} — ${allResults.length} конкурентов, ${total} страниц, ${withChanges} с изменениями, отчёт → ${channel}.`);
  } else {
    console.log(`\n[competitor-monitor] ${dateStr} — ${allResults.length} конкурентов, ${total} страниц, изменений нет. Тихий выход.`);
  }
}

main().catch(err => {
  const errorLogPath = path.join(__dirname, '..', 'data', 'error.log');
  const msg = `${new Date().toISOString()} - Unhandled error: ${err.message}\n${err.stack}\n`;
  fs.appendFileSync(errorLogPath, msg);
  console.error('Fatal unhandled error:', err);
  process.exit(1);
});
