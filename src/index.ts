import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { crawl } from './crawler';
import { parsePage } from './parser';
import { diff } from './diff';
import { buildSummaryReport, shouldSendReport } from './report';
import { sendTelegramReport, sendSlackReport, sendEmailReport } from './notify';
import { Competitor, CompetitorResult, PageMeta, TrackField } from './types';

const ROOT = path.resolve(__dirname, '..');
const SNAPSHOTS_DIR = path.join(ROOT, 'data', 'snapshots');
const ERROR_LOG = path.join(ROOT, 'data', 'error.log');
const COMPETITORS_FILE = path.join(ROOT, 'competitors.json');

const DEFAULT_TRACK: TrackField[] = ['title', 'h1', 'description'];

function loadEnv(): void {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function fatal(message: string): never {
  console.error(`[competitor-monitor] FATAL: ${message}`);
  process.exit(1);
}

function loadCompetitors(): Competitor[] {
  if (!fs.existsSync(COMPETITORS_FILE)) {
    fatal('competitors.json не найден.');
  }
  let raw: string;
  try {
    raw = fs.readFileSync(COMPETITORS_FILE, 'utf-8');
  } catch (err) {
    fatal(`не удалось прочитать competitors.json: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw!);
  } catch (err) {
    fatal(`competitors.json содержит невалидный JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    fatal('competitors.json пуст или не является массивом.');
  }
  return parsed as Competitor[];
}

function loadPrevSnapshot(competitorId: string): { pages: PageMeta[] | null; isFirstRun: boolean; error: string | null } {
  const snapshotPath = path.join(SNAPSHOTS_DIR, `${competitorId}.json`);
  if (!fs.existsSync(snapshotPath)) {
    return { pages: [], isFirstRun: true, error: null };
  }
  try {
    const raw = fs.readFileSync(snapshotPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { pages: null, isFirstRun: false, error: 'снэпшот повреждён (не массив)' };
    }
    return { pages: parsed as PageMeta[], isFirstRun: false, error: null };
  } catch (err) {
    return { pages: null, isFirstRun: false, error: `невалидный JSON в снэпшоте: ${(err as Error).message}` };
  }
}

function saveSnapshot(competitorId: string, pages: PageMeta[]): void {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  const snapshotPath = path.join(SNAPSHOTS_DIR, `${competitorId}.json`);
  const prevPath = path.join(SNAPSHOTS_DIR, `${competitorId}.prev.json`);

  if (fs.existsSync(snapshotPath)) {
    fs.copyFileSync(snapshotPath, prevPath);
  }

  fs.writeFileSync(snapshotPath, JSON.stringify(pages, null, 2), 'utf-8');
}

async function processCompetitor(competitor: Competitor, requestDelayMs: number, only: string | null): Promise<CompetitorResult> {
  const startTime = Date.now();
  const track = competitor.track && competitor.track.length > 0 ? competitor.track : DEFAULT_TRACK;

  if (only && competitor.id !== only) {
    return {
      competitor,
      diff: null,
      totalPages: 0,
      duration: 0,
      isFirstRun: false,
      error: null,
    };
  }

  const prevSnapshot = loadPrevSnapshot(competitor.id);
  if (prevSnapshot.error) {
    console.error(`[${competitor.id}] Ошибка загрузки снэпшота: ${prevSnapshot.error}. Пропуск конкурента.`);
    return {
      competitor,
      diff: null,
      totalPages: 0,
      duration: (Date.now() - startTime) / 1000,
      isFirstRun: false,
      error: prevSnapshot.error,
    };
  }

  try {
    const step1Start = Date.now();
    const urls = await crawl(competitor, requestDelayMs);
    console.log(`[${competitor.id}][step-1] Собрано ${urls.length} URL за ${Math.round((Date.now() - step1Start) / 1000)} сек.`);

    const currentPages: PageMeta[] = [];
    const step2Start = Date.now();
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const page = await parsePage(url, track);
      if (page) currentPages.push(page);
      if (i < urls.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, requestDelayMs));
      }
    }
    console.log(`[${competitor.id}][step-2] Извлечено метаданных для ${currentPages.length}/${urls.length} страниц за ${Math.round((Date.now() - step2Start) / 1000)} сек.`);

    console.log(`[${competitor.id}][step-3] Предыдущий снэпшот: ${prevSnapshot.isFirstRun ? 'отсутствует (первый запуск)' : `${prevSnapshot.pages!.length} страниц`}.`);

    const diffResult = diff(prevSnapshot.pages ?? [], currentPages, track);
    console.log(`[${competitor.id}][step-4] Diff: +${diffResult.newPages.length} -${diffResult.removedPages.length} title:${diffResult.changedTitle.length} h1:${diffResult.changedH1.length} desc:${diffResult.changedDesc.length}`);

    saveSnapshot(competitor.id, currentPages);
    console.log(`[${competitor.id}][step-5] Снэпшот сохранён (${currentPages.length} страниц).`);

    const duration = Math.round((Date.now() - startTime) / 1000);

    return {
      competitor,
      diff: diffResult,
      totalPages: currentPages.length,
      duration,
      isFirstRun: prevSnapshot.isFirstRun,
      error: null,
    };
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    console.error(`[${competitor.id}] Ошибка обработки: ${message}`);
    return {
      competitor,
      diff: null,
      totalPages: 0,
      duration: Math.round((Date.now() - startTime) / 1000),
      isFirstRun: false,
      error: message,
    };
  }
}

async function sendNotifications(results: CompetitorResult[]): Promise<string> {
  const channel = process.env.NOTIFY_CHANNEL || 'telegram';
  const dryRun = process.env.DRY_RUN === 'true';
  const forceReport = process.env.FORCE_REPORT === 'true';

  const shouldSend = forceReport || shouldSendReport(results);
  if (!shouldSend) {
    return channel;
  }

  const report = buildSummaryReport(results);
  const header = report.split('\n').slice(0, 2).join('\n');

  if (dryRun) {
    console.log('--- DRY RUN: отчёт не отправлен ---');
    console.log(report);
    return channel;
  }

  if (channel === 'telegram') {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) {
      console.error('[notify] TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID не заданы. Отчёт не отправлен.');
      return channel;
    }
    await sendTelegramReport(botToken, chatId, report, header, results);
  } else if (channel === 'slack') {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
      console.error('[notify] SLACK_WEBHOOK_URL не задан. Отчёт не отправлен.');
      return channel;
    }
    await sendSlackReport(webhookUrl, report);
  } else if (channel === 'email') {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, REPORT_EMAIL_TO } = process.env;
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !REPORT_EMAIL_TO) {
      console.error('[notify] SMTP переменные не заданы. Отчёт не отправлен.');
      return channel;
    }
    const date = new Date().toISOString().slice(0, 10);
    const html = `<pre>${report.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`;
    await sendEmailReport(
      { host: SMTP_HOST, port: Number(SMTP_PORT) || 587, user: SMTP_USER, pass: SMTP_PASS },
      REPORT_EMAIL_TO,
      `[Competitor Monitor] Еженедельный отчёт ${date}`,
      html
    );
  }

  return channel;
}

function gitCommitAndPush(): void {
  try {
    const status = execSync('git status --porcelain -- data/snapshots/', { cwd: ROOT, encoding: 'utf-8' });
    if (!status.trim()) {
      console.log('[git] Нечего коммитить.');
      return;
    }
    execSync('git add data/snapshots/', { cwd: ROOT });
    const date = new Date().toISOString().slice(0, 10);
    execSync(`git commit -m "chore: snapshot ${date}"`, { cwd: ROOT });
    execSync('git push -u origin HEAD', { cwd: ROOT, stdio: 'inherit' });
    console.log('[git] Снэпшоты закоммичены и запушены.');
  } catch (err) {
    console.error(`[git] Ошибка коммита/пуша: ${(err as Error).message}`);
    throw err;
  }
}

async function main(): Promise<void> {
  loadEnv();

  const only = process.env.ONLY || null;
  const requestDelayMs = Number(process.env.REQUEST_DELAY_MS) || 800;

  const competitors = loadCompetitors();

  const allResults: CompetitorResult[] = [];
  for (const competitor of competitors) {
    if (only && competitor.id !== only) continue;
    const result = await processCompetitor(competitor, requestDelayMs, only);
    allResults.push(result);
  }

  if (allResults.length === 0) {
    fatal(`Не найдено конкурентов для обработки (ONLY=${only}).`);
  }

  const channel = await sendNotifications(allResults);

  const anyChanges = allResults.some((r) => r.diff && r.diff.hasChanges && !r.isFirstRun && !r.error);
  const dryRun = process.env.DRY_RUN === 'true';

  if (!dryRun) {
    gitCommitAndPush();
  }

  const date = new Date().toISOString().slice(0, 10);
  const totalPages = allResults.reduce((sum, r) => sum + r.totalPages, 0);
  const withChanges = allResults.filter((r) => r.diff && r.diff.hasChanges && !r.isFirstRun && !r.error).length;

  if (anyChanges) {
    console.log(`[competitor-monitor] ${date} — ${allResults.length} конкурентов, ${totalPages} страниц, ${withChanges} с изменениями, отчёт → ${channel}.`);
  } else {
    console.log(`[competitor-monitor] ${date} — ${allResults.length} конкурентов, ${totalPages} страниц, изменений нет. Тихий выход.`);
  }
}

main().catch((err) => {
  const stack = err?.stack ?? String(err);
  try {
    fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
    fs.appendFileSync(ERROR_LOG, `[${new Date().toISOString()}] ${stack}\n`);
  } catch {
    // ignore
  }
  console.error(stack);
  process.exit(1);
});
