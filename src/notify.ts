import axios from 'axios';

const TELEGRAM_API = 'https://api.telegram.org';
const MAX_MSG_LENGTH = 4096;
const RETRY_DELAY_MS = 30000;

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function sendTelegramMessage(token: string, chatId: string, text: string): Promise<void> {
  const url = `${TELEGRAM_API}/bot${token}/sendMessage`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await axios.post(url, {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
      }, { timeout: 30000 });
      return;
    } catch (err: any) {
      console.warn(`  [notify] Telegram attempt ${attempt}/3 failed: ${err.message}`);
      if (attempt < 3) await sleep(RETRY_DELAY_MS);
    }
  }
  throw new Error('Failed to send Telegram message after 3 attempts');
}

function splitReport(report: string, maxLen: number): string[] {
  if (report.length <= maxLen) return [report];
  const chunks: string[] = [];
  const sections = report.split('\n━━━━━━━━━━━━━━━━━━━━━━━━');
  let current = '';
  for (const section of sections) {
    const part = (current ? '\n━━━━━━━━━━━━━━━━━━━━━━━━' : '') + section;
    if ((current + part).length > maxLen && current) {
      chunks.push(current);
      current = section;
    } else {
      current += part;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function notify(channel: string, report: string): Promise<void> {
  if (channel === 'telegram') {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set');
    const chunks = splitReport(report, MAX_MSG_LENGTH);
    for (const chunk of chunks) {
      await sendTelegramMessage(token, chatId, chunk);
      if (chunks.length > 1) await sleep(1000);
    }
    console.log(`[notify] Sent ${chunks.length} Telegram message(s)`);

  } else if (channel === 'slack') {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) throw new Error('SLACK_WEBHOOK_URL not set');
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await axios.post(webhookUrl, { text: report }, { timeout: 30000 });
        console.log('[notify] Sent Slack message');
        return;
      } catch (err: any) {
        console.warn(`  [notify] Slack attempt ${attempt}/3 failed: ${err.message}`);
        if (attempt < 3) await sleep(RETRY_DELAY_MS);
      }
    }
    throw new Error('Failed to send Slack message after 3 attempts');

  } else {
    throw new Error(`Unknown channel: ${channel}`);
  }
}
