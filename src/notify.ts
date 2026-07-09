import axios from 'axios';
import { CompetitorResult } from './types';
import { buildReport, buildCompetitorReports } from './report';

const TELEGRAM_LIMIT = 4096;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn: () => Promise<void>, label: string): Promise<void> {
  const attempts = 3;
  for (let i = 1; i <= attempts; i++) {
    try {
      await fn();
      return;
    } catch (err: any) {
      console.warn(`[notify] ${label} attempt ${i} failed: ${err?.message || err}`);
      if (i < attempts) await sleep(30000);
      else throw err;
    }
  }
}

async function sendTelegramMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID не заданы');

  await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
  });
}

async function sendSlack(text: string): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) throw new Error('SLACK_WEBHOOK_URL не задан');
  await axios.post(webhook, { text });
}

async function sendEmail(subject: string, html: string): Promise<void> {
  throw new Error(`Email transport not implemented (would send: "${subject}")`);
}

export async function sendReport(results: CompetitorResult[], date: Date = new Date()): Promise<void> {
  const channel = process.env.NOTIFY_CHANNEL || 'telegram';
  const fullReport = buildReport(results, date);

  if (channel === 'telegram') {
    if (fullReport.length > TELEGRAM_LIMIT) {
      const perCompetitor = buildCompetitorReports(results);
      for (const chunk of perCompetitor) {
        await withRetry(() => sendTelegramMessage(chunk), 'telegram');
      }
      const totalPages = results.reduce((sum, r) => sum + r.totalPages, 0);
      const withChanges = results.filter((r) => !r.isFirstRun && !r.error && r.diff?.hasChanges).length;
      const errors = results.filter((r) => r.error).length;
      const summary = [
        `📊 Еженедельный мониторинг конкурентов — итого`,
        `• Конкурентов обработано: ${results.length}`,
        `• Суммарно страниц: ${totalPages}`,
        `• Конкурентов с изменениями: ${withChanges}`,
        `• Ошибок при сканировании: ${errors}`,
      ].join('\n');
      await withRetry(() => sendTelegramMessage(summary), 'telegram-summary');
    } else {
      await withRetry(() => sendTelegramMessage(fullReport), 'telegram');
    }
  } else if (channel === 'slack') {
    await withRetry(() => sendSlack(fullReport), 'slack');
  } else if (channel === 'email') {
    const dateStr = date.toISOString().slice(0, 10);
    const html = `<pre>${fullReport.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`;
    await withRetry(() => sendEmail(`[Competitor Monitor] Еженедельный отчёт ${dateStr}`, html), 'email');
  } else {
    throw new Error(`Неизвестный NOTIFY_CHANNEL: ${channel}`);
  }
}
