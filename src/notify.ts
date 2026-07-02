import axios from 'axios';
import { CompetitorResult } from './types';
import { buildReport } from './report';

const TELEGRAM_LIMIT = 4096;
const RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 30000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn: () => Promise<void>, label: string): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`[notify] Ошибка отправки (${label}), попытка ${attempt + 1}: ${(err as Error).message}`);
      if (attempt < RETRY_ATTEMPTS) await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastErr;
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

async function sendTelegram(fullReport: string, allResults: CompetitorResult[]): Promise<void> {
  if (fullReport.length <= TELEGRAM_LIMIT) {
    await withRetry(() => sendTelegramMessage(fullReport), 'telegram');
    return;
  }

  const withChanges = allResults.filter((r) => !r.error && !r.isFirstRun && r.diff?.hasChanges);
  for (const result of withChanges) {
    const single = buildReport([result]);
    await withRetry(() => sendTelegramMessage(single), `telegram:${result.competitor.id}`);
  }

  const totalPages = allResults.reduce((sum, r) => sum + r.totalPages, 0);
  const withChangesCount = allResults.filter((r) => r.diff?.hasChanges).length;
  const errors = allResults.filter((r) => r.error).length;
  const summary = [
    '📋 ИТОГО',
    `• Конкурентов обработано: ${allResults.length}`,
    `• Суммарно страниц: ${totalPages}`,
    `• Конкурентов с изменениями: ${withChangesCount}`,
    `• Ошибок при сканировании: ${errors}`,
  ].join('\n');
  await withRetry(() => sendTelegramMessage(summary), 'telegram:summary');
}

async function sendSlack(fullReport: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) throw new Error('SLACK_WEBHOOK_URL не задан');
  await withRetry(() => axios.post(webhookUrl, { text: fullReport }).then(() => undefined), 'slack');
}

async function sendEmail(fullReport: string, date: Date): Promise<void> {
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  const dateStr = date.toISOString().slice(0, 10);
  const html = `<pre>${fullReport.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))}</pre>`;

  await withRetry(
    () =>
      transporter.sendMail({
        from: process.env.SMTP_USER,
        to: process.env.REPORT_EMAIL_TO,
        subject: `[Competitor Monitor] Еженедельный отчёт ${dateStr}`,
        html,
      }),
    'email'
  );
}

export async function sendReport(allResults: CompetitorResult[], date: Date = new Date()): Promise<void> {
  const channel = process.env.NOTIFY_CHANNEL || 'telegram';
  const fullReport = buildReport(allResults, date);

  if (channel === 'telegram') {
    await sendTelegram(fullReport, allResults);
  } else if (channel === 'slack') {
    await sendSlack(fullReport);
  } else if (channel === 'email') {
    await sendEmail(fullReport, date);
  } else {
    throw new Error(`Неизвестный NOTIFY_CHANNEL: ${channel}`);
  }
}
