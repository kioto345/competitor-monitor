import axios from 'axios';

const TELEGRAM_MESSAGE_LIMIT = 4096;
const RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 30000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetries(fn: () => Promise<void>, label: string): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`[notify] Попытка ${attempt + 1} не удалась для ${label}: ${(err as Error)?.message}`);
      if (attempt < RETRY_ATTEMPTS) {
        await delay(RETRY_DELAY_MS);
      }
    }
  }
  throw lastErr;
}

async function sendTelegramMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error('TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID не заданы');
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await axios.post(url, {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  });
}

function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf('\n', limit);
    if (cut <= 0) cut = limit;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

export async function sendTelegram(messages: string[]): Promise<void> {
  for (const message of messages) {
    const chunks = chunkText(message, TELEGRAM_MESSAGE_LIMIT);
    for (const chunk of chunks) {
      await withRetries(() => sendTelegramMessage(chunk), 'telegram');
    }
  }
}

export async function sendSlack(text: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error('SLACK_WEBHOOK_URL не задан');
  }
  await withRetries(async () => {
    await axios.post(webhookUrl, { text });
  }, 'slack');
}

export async function sendEmail(subject: string, htmlBody: string): Promise<void> {
  const moduleName = 'nodemailer';
  let nodemailer: any;
  try {
    nodemailer = require(moduleName);
  } catch {
    throw new Error('nodemailer не установлен, email-уведомления недоступны');
  }
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const to = process.env.REPORT_EMAIL_TO;
  if (!host || !user || !pass || !to) {
    throw new Error('SMTP_HOST, SMTP_USER, SMTP_PASS или REPORT_EMAIL_TO не заданы');
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  await withRetries(async () => {
    await transporter.sendMail({
      from: user,
      to,
      subject,
      html: htmlBody,
    });
  }, 'email');
}

export async function notify(channel: string, reportMarkdown: string, splitMessages: string[], date: Date): Promise<void> {
  if (channel === 'telegram') {
    if (reportMarkdown.length > 4096) {
      await sendTelegram(splitMessages);
    } else {
      await sendTelegram([reportMarkdown]);
    }
  } else if (channel === 'slack') {
    await sendSlack(reportMarkdown);
  } else if (channel === 'email') {
    const dateStr = date.toISOString().slice(0, 10);
    const html = `<pre>${reportMarkdown.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`;
    await sendEmail(`[Competitor Monitor] Еженедельный отчёт ${dateStr}`, html);
  } else {
    throw new Error(`Неизвестный NOTIFY_CHANNEL: ${channel}`);
  }
}
