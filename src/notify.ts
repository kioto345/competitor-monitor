import axios from 'axios';

const delay = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

async function sendTelegramChunk(token: string, chatId: string, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await axios.post(url, { chat_id: chatId, text });
      return;
    } catch (err: any) {
      const desc = err.response?.data?.description ?? err.message;
      console.warn(`[notify] Попытка ${attempt}/3 не удалась: ${desc}`);
      if (attempt < 3) await delay(30000);
      else throw new Error(`Telegram: ${desc}`);
    }
  }
}

async function sendTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID не заданы');

  const MAX = 4096;
  if (text.length <= MAX) {
    await sendTelegramChunk(token, chatId, text);
    return;
  }

  // Split on competitor section boundaries (━━━ lines)
  const SEP = '━━━━━━━━━━━━━━━━━━━━━━━━';
  const parts = text.split('\n' + SEP);
  let chunk = '';

  for (let i = 0; i < parts.length; i++) {
    const piece = (i === 0 ? '' : '\n' + SEP) + parts[i];
    if (chunk.length + piece.length > MAX && chunk.length > 0) {
      await sendTelegramChunk(token, chatId, chunk.trim());
      await delay(1000);
      chunk = (i === 0 ? '' : SEP) + parts[i];
    } else {
      chunk += piece;
    }
  }
  if (chunk.trim()) {
    await sendTelegramChunk(token, chatId, chunk.trim());
  }
}

export async function sendNotification(text: string): Promise<void> {
  const channel = (process.env.NOTIFY_CHANNEL ?? 'telegram').toLowerCase();

  switch (channel) {
    case 'telegram':
      await sendTelegram(text);
      break;
    case 'slack': {
      const webhookUrl = process.env.SLACK_WEBHOOK_URL;
      if (!webhookUrl) throw new Error('SLACK_WEBHOOK_URL не задан');
      await axios.post(webhookUrl, { text });
      break;
    }
    default:
      throw new Error(`Неизвестный канал уведомлений: ${channel}`);
  }

  console.log(`[notify] Отчёт отправлен в ${channel}`);
}
