import { CompetitorResult, PageChange, PageMeta } from './types';

const RUSSIAN_MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const MAX_ENTRIES = 20;
const SEP = '━━━━━━━━━━━━━━━━━━━━━━━━';

function formatDate(d: Date): string {
  return `${d.getDate()} ${RUSSIAN_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function truncate(text: string, max = 120): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function formatNewPages(pages: PageMeta[]): string {
  const shown = pages.slice(0, MAX_ENTRIES);
  const extra = pages.length - shown.length;
  const lines = shown.map(p => {
    const title = p.title || '(без заголовка)';
    const h1 = p.h1 || '(нет H1)';
    return `• ${p.url}\n  "${truncate(title)}" | H1: "${truncate(h1)}"`;
  });
  if (extra > 0) lines.push(`... и ещё ${extra}`);
  return lines.join('\n');
}

function formatRemovedPages(pages: PageMeta[]): string {
  const shown = pages.slice(0, MAX_ENTRIES);
  const extra = pages.length - shown.length;
  const lines = shown.map(p => {
    const title = p.title || '(без заголовка)';
    return `• ${p.url} — последний title: "${truncate(title)}"`;
  });
  if (extra > 0) lines.push(`... и ещё ${extra}`);
  return lines.join('\n');
}

function formatChanges(changes: PageChange[], label: string): string {
  const shown = changes.slice(0, MAX_ENTRIES);
  const extra = changes.length - shown.length;
  const lines = shown.map(c => {
    const oldVal = c.old || '(пусто)';
    const newVal = c.new || '(пусто)';
    return `• ${c.url}\n  Было:  "${truncate(oldVal)}"\n  Стало: "${truncate(newVal)}"`;
  });
  if (extra > 0) lines.push(`... и ещё ${extra}`);
  return lines.join('\n');
}

function buildCompetitorSection(result: CompetitorResult): string {
  const { competitor, diff, totalPages, duration, isFirstRun, error } = result;
  const host = hostname(competitor.url);
  const header = `${SEP}\n🏢 ${competitor.name}  (${host})\n${SEP}`;

  if (error) {
    return `${header}\n\n⚠️ Ошибка: ${error}`;
  }

  if (isFirstRun) {
    return `${header}\n\n🔍 Первый скан: снэпшот сохранён (${totalPages} стр.), отчёт со следующей недели.`;
  }

  if (!diff || !diff.hasChanges) {
    return `${header}\n\n✅ Изменений нет (${totalPages} стр.)`;
  }

  const parts: string[] = [header];

  if (diff.newPages.length > 0) {
    parts.push(`\n🆕 НОВЫЕ СТРАНИЦЫ (${diff.newPages.length})\n${formatNewPages(diff.newPages)}`);
  }
  if (diff.removedPages.length > 0) {
    parts.push(`\n🗑️ УДАЛЁННЫЕ СТРАНИЦЫ (${diff.removedPages.length})\n${formatRemovedPages(diff.removedPages)}`);
  }
  if (diff.changedTitle.length > 0) {
    parts.push(`\n✏️ ИЗМЕНЕНИЯ TITLE (${diff.changedTitle.length})\n${formatChanges(diff.changedTitle, 'title')}`);
  }
  if (diff.changedH1.length > 0) {
    parts.push(`\n✏️ ИЗМЕНЕНИЯ H1 (${diff.changedH1.length})\n${formatChanges(diff.changedH1, 'h1')}`);
  }
  if (diff.changedDesc.length > 0) {
    parts.push(`\n✏️ ИЗМЕНЕНИЯ DESCRIPTION (${diff.changedDesc.length})\n${formatChanges(diff.changedDesc, 'description')}`);
  }

  parts.push(`\nПросканировано: ${totalPages} стр. за ${duration} сек.`);
  return parts.join('\n');
}

export interface ReportOutput {
  messages: string[];
  hasChanges: boolean;
  allFirstRunOrEmpty: boolean;
}

export function buildReport(results: CompetitorResult[]): ReportOutput {
  const date = formatDate(new Date());
  const header = `📊 Еженедельный мониторинг конкурентов — ${date}`;

  const totalPages = results.reduce((s, r) => s + r.totalPages, 0);
  const competitorsWithChanges = results.filter(r => r.diff?.hasChanges).length;
  const errorsCount = results.filter(r => r.error !== null).length;

  const summary = [
    `\n${SEP}`,
    `📋 ИТОГО`,
    `• Конкурентов обработано: ${results.length}`,
    `• Суммарно страниц: ${totalPages}`,
    `• Конкурентов с изменениями: ${competitorsWithChanges}`,
    `• Ошибок при сканировании: ${errorsCount}`,
  ].join('\n');

  const sections = results.map(r => buildCompetitorSection(r));
  const allFirstRunOrEmpty = results.every(r => r.isFirstRun || (!r.diff?.hasChanges && !r.error));
  const hasChanges = competitorsWithChanges > 0 || errorsCount > 0;

  const fullText = [header, ...sections, summary].join('\n\n');

  if (fullText.length <= 4096) {
    return { messages: [fullText], hasChanges, allFirstRunOrEmpty };
  }

  // Split by competitor
  const messages: string[] = [];
  const headerMsg = header;

  for (const section of sections) {
    const msg = `${headerMsg}\n\n${section}`;
    if (msg.length <= 4096) {
      messages.push(msg);
    } else {
      // Section itself is too long, send as-is (Telegram will truncate or we chunk)
      // Chunk by ~4000 chars
      for (let i = 0; i < msg.length; i += 4000) {
        messages.push(msg.slice(i, i + 4000));
      }
    }
  }

  messages.push(`${headerMsg}\n${summary}`);
  return { messages, hasChanges, allFirstRunOrEmpty };
}
