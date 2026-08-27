import axios from 'axios';
import { CompetitorResult } from './types';
import { buildCompetitorSection } from './report';

const TELEGRAM_MAX_LEN = 4096;
const RETRY_COUNT = 2;
const RETRY_DELAY_MS = 30000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn: () => Promise<void>, label: string): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`[notify] ${label} failed (attempt ${attempt + 1}/${RETRY_COUNT + 1}): ${(err as Error)?.message ?? err}`);
      if (attempt < RETRY_COUNT) {
        await delay(RETRY_DELAY_MS);
      }
    }
  }
  throw lastErr;
}

async function sendTelegramMessage(botToken: string, chatId: string, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  await axios.post(url, {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  }, { timeout: 15000 });
}

export async function sendTelegramReport(
  botToken: string,
  chatId: string,
  fullReport: string,
  header: string,
  results: CompetitorResult[]
): Promise<void> {
  if (fullReport.length <= TELEGRAM_MAX_LEN) {
    await withRetry(() => sendTelegramMessage(botToken, chatId, fullReport), 'telegram (single message)');
    return;
  }

  await withRetry(() => sendTelegramMessage(botToken, chatId, header), 'telegram (header)');

  for (const result of results) {
    if (result.error || result.isFirstRun || !result.diff?.hasChanges) continue;
    const section = buildCompetitorSection(result);
    if (section.length <= TELEGRAM_MAX_LEN) {
      await withRetry(() => sendTelegramMessage(botToken, chatId, section), `telegram (${result.competitor.id})`);
    } else {
      const chunks = chunkText(section, TELEGRAM_MAX_LEN);
      for (const chunk of chunks) {
        await withRetry(() => sendTelegramMessage(botToken, chatId, chunk), `telegram (${result.competitor.id} chunk)`);
      }
    }
  }

  const totalPages = results.reduce((sum, r) => sum + (r.totalPages || 0), 0);
  const withChanges = results.filter((r) => r.diff && r.diff.hasChanges && !r.isFirstRun && !r.error).length;
  const errors = results.filter((r) => r.error).length;
  const summary = [
    '━━━━━━━━━━━━━━━━━━━━━━━━',
    '📋 ИТОГО',
    `• Конкурентов обработано: ${results.length}`,
    `• Суммарно страниц: ${totalPages}`,
    `• Конкурентов с изменениями: ${withChanges}`,
    `• Ошибок при сканировании: ${errors}`,
  ].join('\n');
  await withRetry(() => sendTelegramMessage(botToken, chatId, summary), 'telegram (summary)');
}

function chunkText(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt <= 0) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

export async function sendSlackReport(webhookUrl: string, text: string): Promise<void> {
  await withRetry(async () => {
    await axios.post(webhookUrl, { text }, { timeout: 15000 });
  }, 'slack');
}

export async function sendEmailReport(
  smtp: { host: string; port: number; user: string; pass: string },
  to: string,
  subject: string,
  htmlBody: string
): Promise<void> {
  const nodemailer = await import('nodemailer');
  await withRetry(async () => {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: { user: smtp.user, pass: smtp.pass },
    });
    await transporter.sendMail({
      from: smtp.user,
      to,
      subject,
      html: htmlBody,
    });
  }, 'email');
}
