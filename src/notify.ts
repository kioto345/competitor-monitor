import axios from 'axios';
import { buildReport, buildPerCompetitorMessages } from './report';
import { CompetitorResult } from './types';

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
      console.warn(`[notify] ${label} attempt ${attempt + 1} failed: ${(err as any)?.message ?? err}`);
      if (attempt < RETRY_ATTEMPTS) {
        await delay(RETRY_DELAY_MS);
      }
    }
  }
  throw lastErr;
}

async function sendTelegramMessage(text: string, token: string, chatId: string): Promise<void> {
  await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
  }, { timeout: 15000 });
}

async function notifyTelegram(results: CompetitorResult[]): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set');
  }

  const full = buildReport(results);
  const messages = full.length > TELEGRAM_MESSAGE_LIMIT ? buildPerCompetitorMessages(results) : [full];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    await withRetries(() => sendTelegramMessage(msg, token, chatId), `telegram message ${i + 1}/${messages.length}`);
  }
}

async function notifySlack(results: CompetitorResult[]): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error('SLACK_WEBHOOK_URL not set');
  }
  const text = buildReport(results);
  await withRetries(async () => {
    await axios.post(webhookUrl, { text }, { timeout: 15000 });
  }, 'slack message');
}

async function notifyEmail(results: CompetitorResult[]): Promise<void> {
  throw new Error('email notification channel is not implemented in this environment');
}

export async function sendReport(results: CompetitorResult[]): Promise<void> {
  const channel = process.env.NOTIFY_CHANNEL || 'telegram';

  if (process.env.DRY_RUN === 'true') {
    console.log('[notify] DRY_RUN=true — отчёт не отправлен, вывод в stdout:');
    console.log(buildReport(results));
    return;
  }

  switch (channel) {
    case 'telegram':
      await notifyTelegram(results);
      break;
    case 'slack':
      await notifySlack(results);
      break;
    case 'email':
      await notifyEmail(results);
      break;
    default:
      throw new Error(`Unknown NOTIFY_CHANNEL: ${channel}`);
  }
}
