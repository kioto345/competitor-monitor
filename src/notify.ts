import axios from 'axios';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn: () => Promise<void>, label: string): Promise<void> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fn();
      return;
    } catch (err: any) {
      console.warn(`[notify][${label}] Попытка ${attempt}/${maxAttempts} не удалась: ${err?.message || err}`);
      if (attempt < maxAttempts) {
        await sleep(30000);
      } else {
        throw err;
      }
    }
  }
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

async function sendSlackMessage(text: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error('SLACK_WEBHOOK_URL не задан');
  }
  await axios.post(webhookUrl, { text });
}

async function sendEmail(subject: string, htmlBody: string): Promise<void> {
  const nodemailer = await import('nodemailer');
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const to = process.env.REPORT_EMAIL_TO;

  if (!host || !user || !pass || !to) {
    throw new Error('SMTP_HOST/SMTP_USER/SMTP_PASS/REPORT_EMAIL_TO не заданы');
  }

  const transporter = nodemailer.default.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: user,
    to,
    subject,
    html: htmlBody,
  });
}

function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<pre style="font-family: monospace; white-space: pre-wrap;">${escaped}</pre>`;
}

export async function notify(fullReport: string, splitMessages: string[]): Promise<void> {
  const channel = (process.env.NOTIFY_CHANNEL || '').toLowerCase();

  if (channel === 'telegram') {
    const messages = fullReport.length > 4096 ? splitMessages : [fullReport];
    for (const msg of messages) {
      await withRetry(() => sendTelegramMessage(msg), 'telegram');
    }
    return;
  }

  if (channel === 'slack') {
    await withRetry(() => sendSlackMessage(fullReport), 'slack');
    return;
  }

  if (channel === 'email') {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10);
    const subject = `[Competitor Monitor] Еженедельный отчёт ${dateStr}`;
    await withRetry(() => sendEmail(subject, textToHtml(fullReport)), 'email');
    return;
  }

  throw new Error(`Неизвестный NOTIFY_CHANNEL: "${process.env.NOTIFY_CHANNEL}"`);
}
