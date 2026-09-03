import axios from 'axios';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 30000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetries(fn: () => Promise<void>, label: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      lastError = err;
      console.warn(`[notify] ${label} attempt ${attempt + 1} failed: ${(err as Error).message}`);
      if (attempt < MAX_RETRIES) {
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
    throw new Error('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set');
  }
  await axios.post(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    },
    { timeout: 15000 }
  );
}

function splitTelegramMessages(fullReport: string, competitorBlocks: string[], summary: string): string[] {
  if (fullReport.length <= 4096) return [fullReport];
  const messages: string[] = [];
  for (const block of competitorBlocks) {
    messages.push(block);
  }
  messages.push(summary);
  return messages;
}

export async function notifyTelegram(fullReport: string, competitorBlocks: string[], summary: string): Promise<void> {
  const messages = splitTelegramMessages(fullReport, competitorBlocks, summary);
  for (const message of messages) {
    await withRetries(() => sendTelegramMessage(message), 'telegram');
  }
}

async function sendSlackMessage(text: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error('SLACK_WEBHOOK_URL not set');
  }
  await axios.post(webhookUrl, { text }, { timeout: 15000 });
}

export async function notifySlack(text: string): Promise<void> {
  await withRetries(() => sendSlackMessage(text), 'slack');
}

export async function notifyEmail(subject: string, htmlBody: string): Promise<void> {
  throw new Error('Email notification not configured in this environment');
}
