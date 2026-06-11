import axios from 'axios';

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function sendTelegramMessage(token: string, chatId: string, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await axios.post(url, {
        chat_id: chatId,
        text,
      });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < 3) {
        console.warn(`[notify] Telegram send failed (attempt ${attempt}): ${msg}. Retrying in 30s...`);
        await delay(30000);
      } else {
        throw new Error(`Telegram send failed after 3 attempts: ${msg}`);
      }
    }
  }
}

async function sendSlack(webhookUrl: string, text: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await axios.post(webhookUrl, { text });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < 3) {
        console.warn(`[notify] Slack send failed (attempt ${attempt}): ${msg}. Retrying in 30s...`);
        await delay(30000);
      } else {
        throw new Error(`Slack send failed after 3 attempts: ${msg}`);
      }
    }
  }
}

export async function sendNotification(messages: string[]): Promise<void> {
  const channel = process.env.NOTIFY_CHANNEL ?? 'telegram';

  if (channel === 'telegram') {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required');
    for (const msg of messages) {
      await sendTelegramMessage(token, chatId, msg);
    }
  } else if (channel === 'slack') {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) throw new Error('SLACK_WEBHOOK_URL is required');
    await sendSlack(webhookUrl, messages.join('\n\n---\n\n'));
  } else if (channel === 'email') {
    console.warn('[notify] Email channel not fully implemented; skipping');
  } else {
    throw new Error(`Unknown NOTIFY_CHANNEL: ${channel}`);
  }
}
