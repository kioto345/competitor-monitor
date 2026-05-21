import axios from 'axios';

const MAX_TELEGRAM_LENGTH = 4096;

async function sendTelegramMessage(text: string, token: string, chatId: string): Promise<void> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await axios.post(url, {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  }, { timeout: 30000 });
}

async function sendWithRetry(fn: () => Promise<void>, retries = 2, delayMs = 30000): Promise<void> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await fn();
      return;
    } catch (err: any) {
      if (attempt === retries) throw err;
      console.warn(`[notify] Send failed (attempt ${attempt + 1}), retrying in ${delayMs/1000}s: ${err.message}`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

export async function sendNotification(report: string): Promise<void> {
  const channel = process.env.NOTIFY_CHANNEL || 'telegram';

  if (channel === 'telegram') {
    const token = process.env.TELEGRAM_BOT_TOKEN!;
    const chatId = process.env.TELEGRAM_CHAT_ID!;

    if (report.length <= MAX_TELEGRAM_LENGTH) {
      await sendWithRetry(() => sendTelegramMessage(report, token, chatId));
    } else {
      // Split by competitor sections
      const sections = report.split(/(?=━━━━━━━━━━━━━━━━━━━━━━━━\n🏢)/);
      const header = sections[0];
      const competitorSections = sections.slice(1);

      // Send header + first chunk
      let currentMessage = header;
      for (const section of competitorSections) {
        if ((currentMessage + section).length <= MAX_TELEGRAM_LENGTH) {
          currentMessage += section;
        } else {
          if (currentMessage.trim()) {
            await sendWithRetry(() => sendTelegramMessage(currentMessage, token, chatId));
            await new Promise(r => setTimeout(r, 1000));
          }
          currentMessage = '━━━━━━━━━━━━━━━━━━━━━━━━\n🏢' + section;
        }
      }
      if (currentMessage.trim()) {
        await sendWithRetry(() => sendTelegramMessage(currentMessage, token, chatId));
      }
    }
  } else if (channel === 'slack') {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL!;
    await sendWithRetry(() => axios.post(webhookUrl, { text: report }, { timeout: 30000 }));
  } else {
    console.log('[notify] Email not implemented, printing report to stdout:\n', report);
  }
}
