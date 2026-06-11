import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

import { Competitor, CompetitorResult, PageMeta, TrackField } from './types';
import { crawl } from './crawler';
import { parsePage } from './parser';
import { diff } from './diff';
import { buildReport } from './report';
import { sendNotification } from './notify';

const SNAPSHOTS_DIR = path.resolve(__dirname, '..', 'data', 'snapshots');
const ERROR_LOG = path.resolve(__dirname, '..', 'data', 'error.log');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadCompetitors(): Competitor[] {
  const jsonPath = path.resolve(__dirname, '..', 'competitors.json');
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`competitors.json not found at ${jsonPath}`);
  }
  const raw = fs.readFileSync(jsonPath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('competitors.json must be a non-empty array');
  }
  return parsed as Competitor[];
}

function loadSnapshot(competitorId: string): { pages: PageMeta[]; exists: boolean } {
  const snapshotPath = path.join(SNAPSHOTS_DIR, `${competitorId}.json`);
  if (!fs.existsSync(snapshotPath)) {
    return { pages: [], exists: false };
  }
  try {
    const raw = fs.readFileSync(snapshotPath, 'utf-8');
    const parsed = JSON.parse(raw) as PageMeta[];
    return { pages: parsed, exists: true };
  } catch (err) {
    throw new Error(`Invalid snapshot JSON for ${competitorId}: ${err}`);
  }
}

function saveSnapshot(competitorId: string, pages: PageMeta[]): void {
  const snapshotPath = path.join(SNAPSHOTS_DIR, `${competitorId}.json`);
  const backupPath = path.join(SNAPSHOTS_DIR, `${competitorId}.prev.json`);

  if (fs.existsSync(snapshotPath)) {
    fs.copyFileSync(snapshotPath, backupPath);
  }

  fs.writeFileSync(snapshotPath, JSON.stringify(pages, null, 2), 'utf-8');
}

function formatDuration(ms: number): string {
  return (ms / 1000).toFixed(1);
}

async function processCompetitor(competitor: Competitor): Promise<CompetitorResult> {
  const startTime = Date.now();
  const track: TrackField[] = competitor.track ?? ['title', 'h1', 'description'];

  // Step 1: Crawl URLs
  let urls: string[];
  try {
    urls = await crawl(competitor);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      competitor,
      diff: null,
      totalPages: 0,
      duration: parseFloat(formatDuration(Date.now() - startTime)),
      isFirstRun: false,
      error: `Step 1 (crawl) failed: ${msg}`,
    };
  }

  if (urls.length === 0) {
    return {
      competitor,
      diff: null,
      totalPages: 0,
      duration: parseFloat(formatDuration(Date.now() - startTime)),
      isFirstRun: false,
      error: 'Step 1: no URLs found',
    };
  }

  // Step 2: Parse each page
  console.log(`[${competitor.id}][step-2] Parsing ${urls.length} pages...`);
  const currentPages: PageMeta[] = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (i % 50 === 0 && i > 0) {
      console.log(`[${competitor.id}][step-2] Progress: ${i}/${urls.length}`);
    }
    const meta = await parsePage(url, track);
    if (meta) currentPages.push(meta);
  }
  console.log(`[${competitor.id}][step-2] Parsed ${currentPages.length}/${urls.length} pages.`);

  // Step 3: Load previous snapshot
  let prevPages: PageMeta[];
  let isFirstRun: boolean;
  try {
    const { pages, exists } = loadSnapshot(competitor.id);
    prevPages = pages;
    isFirstRun = !exists;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${competitor.id}][step-3] Error loading snapshot: ${msg}. Skipping.`);
    return {
      competitor,
      diff: null,
      totalPages: currentPages.length,
      duration: parseFloat(formatDuration(Date.now() - startTime)),
      isFirstRun: false,
      error: `Step 3 (snapshot): ${msg}`,
    };
  }

  if (isFirstRun) {
    console.log(`[${competitor.id}][step-3] First run, no previous snapshot.`);
  } else {
    console.log(`[${competitor.id}][step-3] Loaded ${prevPages.length} pages from previous snapshot.`);
  }

  // Step 4: Diff
  console.log(`[${competitor.id}][step-4] Computing diff...`);
  const diffResult = diff(prevPages, currentPages, track);
  console.log(
    `[${competitor.id}][step-4] new=${diffResult.newPages.length}, removed=${diffResult.removedPages.length}, ` +
    `changedTitle=${diffResult.changedTitle.length}, changedH1=${diffResult.changedH1.length}, changedDesc=${diffResult.changedDesc.length}`,
  );

  // Step 5: Save snapshot
  console.log(`[${competitor.id}][step-5] Saving snapshot (${currentPages.length} pages)...`);
  saveSnapshot(competitor.id, currentPages);
  console.log(`[${competitor.id}][step-5] Snapshot saved.`);

  const duration = parseFloat(formatDuration(Date.now() - startTime));
  console.log(`[${competitor.id}] Done in ${duration} sec.`);

  return {
    competitor,
    diff: diffResult,
    totalPages: currentPages.length,
    duration,
    isFirstRun,
    error: null,
  };
}

async function run(): Promise<void> {
  ensureDir(SNAPSHOTS_DIR);

  let competitors: Competitor[];
  try {
    competitors = loadCompetitors();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[competitor-monitor] FATAL: ${msg}`);
    process.exit(1);
  }

  const onlyFilter = process.env.ONLY;
  if (onlyFilter) {
    competitors = competitors.filter(c => c.id === onlyFilter);
    if (competitors.length === 0) {
      console.error(`[competitor-monitor] No competitor found with id "${onlyFilter}"`);
      process.exit(1);
    }
  }

  console.log(`[competitor-monitor] Starting run for ${competitors.length} competitor(s)...`);

  const allResults: CompetitorResult[] = [];

  // Steps 1-6: Process each competitor sequentially
  for (const competitor of competitors) {
    console.log(`\n[competitor-monitor] === Processing: ${competitor.name} (${competitor.id}) ===`);
    const result = await processCompetitor(competitor);
    allResults.push(result);
  }

  // Step 7: Generate and send report
  const { messages, hasChanges, allFirstRunOrEmpty } = buildReport(allResults);

  const dryRun = process.env.DRY_RUN === 'true';
  const forceReport = process.env.FORCE_REPORT === 'true';
  const channel = process.env.NOTIFY_CHANNEL ?? 'telegram';

  const shouldSend = forceReport || (hasChanges && !allFirstRunOrEmpty);

  if (shouldSend && !dryRun) {
    console.log(`\n[competitor-monitor][step-7] Sending report (${messages.length} message(s)) via ${channel}...`);
    try {
      await sendNotification(messages);
      console.log('[competitor-monitor][step-7] Report sent successfully.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[competitor-monitor][step-7] Failed to send report: ${msg}`);
    }
  } else if (dryRun) {
    console.log('\n[competitor-monitor][step-7] DRY_RUN mode — skipping notification. Report preview:');
    messages.forEach((m, i) => {
      console.log(`\n--- Message ${i + 1} ---\n${m}`);
    });
  } else {
    console.log('\n[competitor-monitor][step-7] No changes to report. Silent exit.');
  }

  // Step 8: Git commit and push
  const date = new Date().toISOString().slice(0, 10);
  const snapshotFiles = fs.readdirSync(SNAPSHOTS_DIR)
    .filter(f => f.endsWith('.json') && !f.endsWith('.prev.json'))
    .map(f => path.join(SNAPSHOTS_DIR, f));

  if (snapshotFiles.length > 0) {
    const { execSync } = await import('child_process');
    try {
      execSync('git add data/snapshots/', { stdio: 'inherit' });
      const statusOutput = execSync('git status --porcelain data/snapshots/').toString().trim();

      if (statusOutput) {
        execSync(`git commit -m "chore: snapshot ${date}"`, { stdio: 'inherit' });
        execSync('git push -u origin claude/beautiful-mendel-brw6br', { stdio: 'inherit' });
        console.log(`[competitor-monitor][step-8] Snapshots committed and pushed.`);
      } else {
        console.log('[competitor-monitor][step-8] Nothing to commit.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[competitor-monitor][step-8] Git error: ${msg}`);
    }
  }

  // Final summary line
  const totalPages = allResults.reduce((s, r) => s + r.totalPages, 0);
  const competitorsWithChanges = allResults.filter(r => r.diff?.hasChanges).length;

  if (allFirstRunOrEmpty && !hasChanges) {
    console.log(`\n[competitor-monitor] ${date} — ${competitors.length} конкурентов, ${totalPages} страниц, изменений нет. Тихий выход.`);
  } else {
    console.log(`\n[competitor-monitor] ${date} — ${competitors.length} конкурентов, ${totalPages} страниц, ${competitorsWithChanges} с изменениями, отчёт → ${channel}.`);
  }
}

run().catch(err => {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : '';
  const logEntry = `[${new Date().toISOString()}] FATAL: ${msg}\n${stack}\n`;
  ensureDir(path.dirname(ERROR_LOG));
  fs.appendFileSync(ERROR_LOG, logEntry);
  console.error(logEntry);
  process.exit(1);
});
