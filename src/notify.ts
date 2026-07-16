import axios from 'axios';
import nodemailer from 'nodemailer';
import { CompetitorResult } from './types';
import { buildReport } from './report';

const TELEGRAM_MAX_LENGTH = 4096;
const RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 30000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn: () => Promise<void>, label: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      lastError = err;
      console.warn(`[notify] Попытка ${attempt + 1} для ${label} не удалась: ${(err as Error).message}`);
      if (attempt < RETRY_ATTEMPTS) {
        await delay(RETRY_DELAY_MS);
      }
    }
  }
  throw lastError;
}

async function sendTelegramMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error('TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID не заданы');
  }
  await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
  });
}

async function sendTelegram(fullReport: string, results: CompetitorResult[], now: Date): Promise<void> {
  if (fullReport.length <= TELEGRAM_MAX_LENGTH) {
    await withRetry(() => sendTelegramMessage(fullReport), 'telegram (сводка)');
    return;
  }

  for (const result of results) {
    if (result.error || result.isFirstRun || result.diff?.hasChanges) {
      const singleReport = buildReport([result], now);
      await withRetry(
        () => sendTelegramMessage(singleReport),
        `telegram (${result.competitor.id})`
      );
    }
  }

  const total = results.reduce((sum, r) => sum + r.totalPages, 0);
  const withChanges = results.filter((r) => !r.error && !r.isFirstRun && r.diff?.hasChanges).length;
  const errors = results.filter((r) => r.error).length;
  const summary = [
    `📋 ИТОГО — ${now.toLocaleDateString('ru-RU')}`,
    `• Конкурентов обработано: ${results.length}`,
    `• Суммарно страниц: ${total}`,
    `• Конкурентов с изменениями: ${withChanges}`,
    `• Ошибок при сканировании: ${errors}`,
  ].join('\n');
  await withRetry(() => sendTelegramMessage(summary), 'telegram (итог)');
}

async function sendSlack(fullReport: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error('SLACK_WEBHOOK_URL не задан');
  }
  await withRetry(async () => {
    await axios.post(webhookUrl, { text: fullReport });
  }, 'slack');
}

async function sendEmail(fullReport: string, now: Date): Promise<void> {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, REPORT_EMAIL_TO } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !REPORT_EMAIL_TO) {
    throw new Error('SMTP-параметры или REPORT_EMAIL_TO не заданы');
  }
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT ?? 587),
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  const dateStr = now.toLocaleDateString('ru-RU');
  const html = `<pre>${fullReport.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`;

  await withRetry(async () => {
    await transporter.sendMail({
      from: SMTP_USER,
      to: REPORT_EMAIL_TO,
      subject: `[Competitor Monitor] Еженедельный отчёт ${dateStr}`,
      html,
    });
  }, 'email');
}

export async function notify(results: CompetitorResult[], now: Date = new Date()): Promise<void> {
  const channel = (process.env.NOTIFY_CHANNEL || 'telegram').toLowerCase();
  const fullReport = buildReport(results, now);

  if (channel === 'telegram') {
    await sendTelegram(fullReport, results, now);
  } else if (channel === 'slack') {
    await sendSlack(fullReport);
  } else if (channel === 'email') {
    await sendEmail(fullReport, now);
  } else {
    throw new Error(`Неизвестный NOTIFY_CHANNEL: ${channel}`);
  }
}
