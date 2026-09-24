import axios from 'axios';

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
      console.warn(`[notify] ${label} failed (attempt ${attempt + 1}/${RETRY_ATTEMPTS + 1}): ${(err as Error)?.message || err}`);
      if (attempt < RETRY_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
  throw lastErr;
}

async function sendTelegramMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set');
  }
  await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
  }, { timeout: 15000 });
}

export async function sendTelegram(messages: string[]): Promise<void> {
  for (const msg of messages) {
    if (msg.length <= 4096) {
      await withRetry(() => sendTelegramMessage(msg), 'telegram');
    } else {
      for (let i = 0; i < msg.length; i += 4000) {
        await withRetry(() => sendTelegramMessage(msg.slice(i, i + 4000)), 'telegram');
      }
    }
  }
}

export async function sendSlack(text: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error('SLACK_WEBHOOK_URL not set');
  }
  await withRetry(async () => {
    await axios.post(webhookUrl, { text }, { timeout: 15000 });
  }, 'slack');
}

export async function sendEmail(subject: string, html: string): Promise<void> {
  const nodemailer = require('nodemailer');
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const to = process.env.REPORT_EMAIL_TO;
  if (!host || !user || !pass || !to) {
    throw new Error('SMTP_HOST, SMTP_USER, SMTP_PASS or REPORT_EMAIL_TO not set');
  }
  const transporter = nodemailer.createTransport({ host, port, auth: { user, pass } });
  await withRetry(async () => {
    await transporter.sendMail({ from: user, to, subject, html });
  }, 'email');
}

export async function notify(channel: string, reportText: string, splitMessages: string[]): Promise<void> {
  if (channel === 'telegram') {
    if (reportText.length > 4096) {
      await sendTelegram(splitMessages);
    } else {
      await sendTelegram([reportText]);
    }
  } else if (channel === 'slack') {
    await sendSlack(reportText);
  } else if (channel === 'email') {
    const date = new Date().toISOString().slice(0, 10);
    await sendEmail(`[Competitor Monitor] Еженедельный отчёт ${date}`, `<pre>${reportText}</pre>`);
  } else {
    throw new Error(`Unknown NOTIFY_CHANNEL: ${channel}`);
  }
}
