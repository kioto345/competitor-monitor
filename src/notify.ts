import axios from 'axios';
import nodemailer from 'nodemailer';
import { CompetitorResult } from './types';
import { formatCompetitorBlock, formatHeader, formatReport, formatSummary } from './report';

const TELEGRAM_LIMIT = 4096;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn: () => Promise<void>, label: string): Promise<void> {
  const attempts = 3;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await fn();
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`[notify] Попытка ${i + 1}/${attempts} для ${label} не удалась: ${(err as Error).message || err}`);
      if (i < attempts - 1) {
        await sleep(30000);
      }
    }
  }
  throw lastErr;
}

async function sendTelegramMessage(text: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    throw new Error('TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID не заданы');
  }
  await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
  });
}

async function sendTelegram(report: string, allResults: CompetitorResult[], date: Date): Promise<void> {
  if (report.length <= TELEGRAM_LIMIT) {
    await withRetry(() => sendTelegramMessage(report), 'telegram');
    return;
  }

  const withChanges = allResults.filter((r) => !r.error && !r.isFirstRun && r.diff?.hasChanges);
  const header = formatHeader(date);

  await withRetry(() => sendTelegramMessage(header), 'telegram (заголовок)');

  for (const result of withChanges) {
    const block = formatCompetitorBlock(result);
    await withRetry(() => sendTelegramMessage(block), `telegram (${result.competitor.id})`);
  }

  const summary = formatSummary(allResults);
  await withRetry(() => sendTelegramMessage(summary), 'telegram (итого)');
}

async function sendSlack(report: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error('SLACK_WEBHOOK_URL не задан');
  }
  await withRetry(async () => {
    await axios.post(webhookUrl, { text: report });
  }, 'slack');
}

async function sendEmail(report: string, date: Date): Promise<void> {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, REPORT_EMAIL_TO } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !REPORT_EMAIL_TO) {
    throw new Error('Не заданы переменные SMTP_HOST/SMTP_USER/SMTP_PASS/REPORT_EMAIL_TO');
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const dateStr = date.toISOString().slice(0, 10);
  const html = `<pre>${report.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;

  await withRetry(async () => {
    await transporter.sendMail({
      from: SMTP_USER,
      to: REPORT_EMAIL_TO,
      subject: `[Competitor Monitor] Еженедельный отчёт ${dateStr}`,
      html,
    });
  }, 'email');
}

export async function sendReport(allResults: CompetitorResult[], date: Date = new Date()): Promise<void> {
  const channel = (process.env.NOTIFY_CHANNEL || 'telegram').toLowerCase();
  const report = formatReport(allResults, date);

  if (channel === 'telegram') {
    await sendTelegram(report, allResults, date);
  } else if (channel === 'slack') {
    await sendSlack(report);
  } else if (channel === 'email') {
    await sendEmail(report, date);
  } else {
    throw new Error(`Неизвестный NOTIFY_CHANNEL: ${channel}`);
  }
}
