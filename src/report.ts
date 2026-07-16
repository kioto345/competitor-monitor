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

function truncated<T>(items: T[], render: (item: T) => string): string {
  const shown = items.slice(0, MAX_ENTRIES);
  const lines = shown.map(render);
  if (items.length > MAX_ENTRIES) {
    lines.push(`... и ещё ${items.length - MAX_ENTRIES}`);
  }
  return lines.join('\n');
}

function renderNewPage(page: PageMeta): string {
  return `• ${page.url} — "${page.title}" | H1: "${page.h1}"`;
}

function renderRemovedPage(page: PageMeta): string {
  return `• ${page.url} — последний title: "${page.title}"`;
}

function renderChange(change: PageChange): string {
  return `• ${change.url}\n  Было:  "${change.old}"\n  Стало: "${change.new}"`;
}

function renderCompetitorSection(result: CompetitorResult): string {
  const { competitor, diff, totalPages, duration, isFirstRun, error } = result;
  const lines: string[] = [];
  lines.push(SEPARATOR);
  lines.push(`🏢 ${competitor.name}  (${hostnameOf(competitor.url)})`);
  lines.push(SEPARATOR);
  lines.push('');

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
    lines.push(truncated(diff.newPages, renderNewPage));
    lines.push('');
  }

  if (diff.removedPages.length > 0) {
    lines.push(`🗑️ УДАЛЁННЫЕ СТРАНИЦЫ (${diff.removedPages.length})`);
    lines.push(truncated(diff.removedPages, renderRemovedPage));
    lines.push('');
  }

  if (diff.changedTitle.length > 0) {
    lines.push(`✏️ ИЗМЕНЕНИЯ TITLE (${diff.changedTitle.length})`);
    lines.push(truncated(diff.changedTitle, renderChange));
    lines.push('');
  }

  if (diff.changedH1.length > 0) {
    lines.push(`✏️ ИЗМЕНЕНИЯ H1 (${diff.changedH1.length})`);
    lines.push(truncated(diff.changedH1, renderChange));
    lines.push('');
  }

  if (diff.changedDesc.length > 0) {
    lines.push(`✏️ ИЗМЕНЕНИЯ DESCRIPTION (${diff.changedDesc.length})`);
    lines.push(truncated(diff.changedDesc, renderChange));
    lines.push('');
  }

  lines.push(`Просканировано: ${totalPages} стр. за ${duration} сек.`);

  return lines.join('\n');
}

export function buildReport(results: CompetitorResult[], now: Date = new Date()): string {
  const lines: string[] = [];
  lines.push(`📊 Еженедельный мониторинг конкурентов — ${formatDate(now)}`);
  lines.push('');

  for (const result of results) {
    lines.push(renderCompetitorSection(result));
    lines.push('');
  }

  const total = results.reduce((sum, r) => sum + r.totalPages, 0);
  const withChanges = results.filter((r) => !r.error && !r.isFirstRun && r.diff?.hasChanges).length;
  const errors = results.filter((r) => r.error).length;

  lines.push(SEPARATOR);
  lines.push('📋 ИТОГО');
  lines.push(`• Конкурентов обработано: ${results.length}`);
  lines.push(`• Суммарно страниц: ${total}`);
  lines.push(`• Конкурентов с изменениями: ${withChanges}`);
  lines.push(`• Ошибок при сканировании: ${errors}`);

  return lines.join('\n');
}

export function shouldSendReport(results: CompetitorResult[]): boolean {
  return results.some((r) => !r.isFirstRun && !r.error && r.diff?.hasChanges);
}
