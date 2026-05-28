import axios from 'axios';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function sendTelegramMessage(text: string, botToken: string, chatId: string): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  let lastErr: any;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await axios.post(url, { chat_id: chatId, text }, { timeout: 30000 });
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) {
        console.warn(`[notify] Telegram send failed (attempt ${attempt}/3), retrying in 30s...`);
        await sleep(30000);
      }
    }
  }

  throw lastErr;
}

function splitByCompetitors(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  const sections = text.split(/(?=━━━━━━━━━━━━━━━━━━━━━━━━)/);

  let current = '';
  for (const section of sections) {
    if (current.length + section.length > maxLen) {
      if (current.trim()) chunks.push(current.trim());
      current = section;
    } else {
      current += section;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  // If any single section is still too long, split by newlines
  const result: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= maxLen) {
      result.push(chunk);
    } else {
      const lines = chunk.split('\n');
      let cur = '';
      for (const line of lines) {
        if (cur.length + line.length + 1 > maxLen) {
          if (cur.trim()) result.push(cur.trim());
          cur = line;
        } else {
          cur = cur ? cur + '\n' + line : line;
        }
      }
      if (cur.trim()) result.push(cur.trim());
    }
  }

  return result;
}

export async function notify(text: string): Promise<void> {
  const channel = process.env.NOTIFY_CHANNEL || 'telegram';

  if (channel === 'telegram') {
    const botToken = process.env.TELEGRAM_BOT_TOKEN!;
    const chatId = process.env.TELEGRAM_CHAT_ID!;

    if (!botToken || !chatId) {
      throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set');
    }

    const MAX_LEN = 4096;
    const chunks = text.length <= MAX_LEN ? [text] : splitByCompetitors(text, MAX_LEN);

    for (let i = 0; i < chunks.length; i++) {
      await sendTelegramMessage(chunks[i], botToken, chatId);
      if (i < chunks.length - 1) await sleep(1000);
    }
  } else if (channel === 'slack') {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL!;
    if (!webhookUrl) throw new Error('SLACK_WEBHOOK_URL must be set');
    await axios.post(webhookUrl, { text }, { timeout: 30000 });
  } else {
    throw new Error(`Unknown NOTIFY_CHANNEL: ${channel}`);
  }
}
