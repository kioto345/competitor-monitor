import { CompetitorResult, PageChange, PageMeta } from './types';

const MONTHS_RU = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const MAX_ENTRIES = 20;
const SEPARATOR = '━━━━━━━━━━━━━━━━━━━━━━━━';

function formatDate(date: Date): string {
  return `${date.getDate()} ${MONTHS_RU[date.getMonth()]} ${date.getFullYear()}`;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function limitList<T>(items: T[]): { shown: T[]; extra: number } {
  if (items.length <= MAX_ENTRIES) return { shown: items, extra: 0 };
  return { shown: items.slice(0, MAX_ENTRIES), extra: items.length - MAX_ENTRIES };
}

function formatNewPages(pages: PageMeta[]): string {
  const { shown, extra } = limitList(pages);
  const lines = shown.map((p) => `• ${p.url} — "${p.title}" | H1: "${p.h1}"`);
  if (extra > 0) lines.push(`... и ещё ${extra}`);
  return lines.join('\n');
}

function formatRemovedPages(pages: PageMeta[]): string {
  const { shown, extra } = limitList(pages);
  const lines = shown.map((p) => `• ${p.url} — последний title: "${p.title}"`);
  if (extra > 0) lines.push(`... и ещё ${extra}`);
  return lines.join('\n');
}

function formatChanges(changes: PageChange[]): string {
  const { shown, extra } = limitList(changes);
  const lines = shown.map((c) => `• ${c.url}\n  Было:  "${c.old}"\n  Стало: "${c.new}"`);
  if (extra > 0) lines.push(`... и ещё ${extra}`);
  return lines.join('\n');
}

export function formatCompetitorBlock(result: CompetitorResult): string {
  const { competitor, diff, totalPages, duration, isFirstRun, error } = result;
  const lines: string[] = [SEPARATOR, `🏢 ${competitor.name}  (${hostnameOf(competitor.url)})`, SEPARATOR, ''];

  if (error) {
    lines.push(`⚠️ Ошибка: ${error}`);
    return lines.join('\n');
  }

  if (isFirstRun) {
    lines.push(`🔍 Первый скан: снэпшот сохранён (${totalPages} стр.), отчёт со следующей недели.`);
    return lines.join('\n');
  }

  if (!diff || !diff.hasChanges) {
    lines.push(`✅ Изменений нет (${totalPages} стр.)`);
    return lines.join('\n');
  }

  if (diff.newPages.length > 0) {
    lines.push(`🆕 НОВЫЕ СТРАНИЦЫ (${diff.newPages.length})`);
    lines.push(formatNewPages(diff.newPages));
    lines.push('');
  }
  if (diff.removedPages.length > 0) {
    lines.push(`🗑️ УДАЛЁННЫЕ СТРАНИЦЫ (${diff.removedPages.length})`);
    lines.push(formatRemovedPages(diff.removedPages));
    lines.push('');
  }
  if (diff.changedTitle.length > 0) {
    lines.push(`✏️ ИЗМЕНЕНИЯ TITLE (${diff.changedTitle.length})`);
    lines.push(formatChanges(diff.changedTitle));
    lines.push('');
  }
  if (diff.changedH1.length > 0) {
    lines.push(`✏️ ИЗМЕНЕНИЯ H1 (${diff.changedH1.length})`);
    lines.push(formatChanges(diff.changedH1));
    lines.push('');
  }
  if (diff.changedDesc.length > 0) {
    lines.push(`✏️ ИЗМЕНЕНИЯ DESCRIPTION (${diff.changedDesc.length})`);
    lines.push(formatChanges(diff.changedDesc));
    lines.push('');
  }

  lines.push(`Просканировано: ${totalPages} стр. за ${duration} сек.`);

  return lines.join('\n');
}

export function formatHeader(date: Date = new Date()): string {
  return `📊 Еженедельный мониторинг конкурентов — ${formatDate(date)}`;
}

export function formatSummary(allResults: CompetitorResult[]): string {
  const totalPages = allResults.reduce((sum, r) => sum + r.totalPages, 0);
  const withChanges = allResults.filter((r) => !r.error && !r.isFirstRun && r.diff?.hasChanges).length;
  const errors = allResults.filter((r) => r.error).length;

  return [
    SEPARATOR,
    '📋 ИТОГО',
    `• Конкурентов обработано: ${allResults.length}`,
    `• Суммарно страниц: ${totalPages}`,
    `• Конкурентов с изменениями: ${withChanges}`,
    `• Ошибок при сканировании: ${errors}`,
  ].join('\n');
}

export function formatReport(allResults: CompetitorResult[], date: Date = new Date()): string {
  const blocks = allResults.map(formatCompetitorBlock);
  return [formatHeader(date), '', ...blocks, '', formatSummary(allResults)].join('\n');
}

export function shouldSendReport(allResults: CompetitorResult[]): boolean {
  return allResults.some((r) => !r.error && !r.isFirstRun && r.diff?.hasChanges);
}
