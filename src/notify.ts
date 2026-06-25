import axios from 'axios';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function sendTelegram(messages: string[]): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID не заданы');

  const apiUrl = `https://api.telegram.org/bot${token}/sendMessage`;

  for (let i = 0; i < messages.length; i++) {
    const text = messages[i];
    let attempts = 0;

    while (attempts < 3) {
      try {
        await axios.post(apiUrl, {
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
        console.log(`[notify] Telegram: сообщение ${i + 1}/${messages.length} отправлено (${text.length} символов)`);
        break;
      } catch (err) {
        attempts++;
        const msg = (err as any)?.response?.data?.description || (err as Error).message;
        if (attempts < 3) {
          console.warn(`[notify] Telegram попытка ${attempts} неудачна: ${msg}, ждём 30с...`);
          await delay(30000);
        } else {
          throw new Error(`Telegram: не удалось отправить после 3 попыток: ${msg}`);
        }
      }
    }

    if (i < messages.length - 1) await delay(1000);
  }
}

async function sendSlack(messages: string[]): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) throw new Error('SLACK_WEBHOOK_URL не задан');

  const text = messages.join('\n\n');
  let attempts = 0;

  while (attempts < 3) {
    try {
      await axios.post(webhookUrl, { text });
      console.log(`[notify] Slack: отправлено`);
      return;
    } catch (err) {
      attempts++;
      if (attempts < 3) {
        await delay(30000);
      } else {
        throw new Error(`Slack: не удалось отправить: ${(err as Error).message}`);
      }
    }
  }
}

export async function notify(messages: string[]): Promise<void> {
  const channel = (process.env.NOTIFY_CHANNEL || 'telegram').toLowerCase();

  if (channel === 'telegram') {
    await sendTelegram(messages);
  } else if (channel === 'slack') {
    await sendSlack(messages);
  } else {
    console.log(`[notify] Канал "${channel}" не реализован`);
  }
}
