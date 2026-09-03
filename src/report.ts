import { CompetitorResult, PageChange } from './types';

const MAX_ENTRIES = 20;
const DIVIDER = '━━━━━━━━━━━━━━━━━━━━━━━━';

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function formatDate(d: Date): string {
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function formatChangeSection(heading: string, changes: PageChange[]): string[] {
  const lines: string[] = [heading];
  const shown = changes.slice(0, MAX_ENTRIES);
  for (const c of shown) {
    lines.push(`• ${c.url}`);
    lines.push(`  Было:  "${c.old || '(нет описания)'}"`);
    lines.push(`  Стало: "${c.new || '(нет описания)'}"`);
  }
  if (changes.length > MAX_ENTRIES) {
    lines.push(`... и ещё ${changes.length - MAX_ENTRIES}`);
  }
  lines.push('');
  return lines;
}

function formatCompetitorBlock(result: CompetitorResult): string {
  const { competitor, diff, totalPages, duration, isFirstRun, error } = result;
  const lines: string[] = [];
  lines.push(DIVIDER);
  lines.push(`🏢 ${competitor.name}  (${hostname(competitor.url)})`);
  lines.push(DIVIDER);
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
    const shown = diff.newPages.slice(0, MAX_ENTRIES);
    for (const p of shown) {
      lines.push(`• ${p.url} — "${p.title}" | H1: "${p.h1}"`);
    }
    if (diff.newPages.length > MAX_ENTRIES) {
      lines.push(`... и ещё ${diff.newPages.length - MAX_ENTRIES}`);
    }
    lines.push('');
  }

  if (diff.removedPages.length > 0) {
    lines.push(`🗑️ УДАЛЁННЫЕ СТРАНИЦЫ (${diff.removedPages.length})`);
    const shown = diff.removedPages.slice(0, MAX_ENTRIES);
    for (const p of shown) {
      lines.push(`• ${p.url} — последний title: "${p.title}"`);
    }
    if (diff.removedPages.length > MAX_ENTRIES) {
      lines.push(`... и ещё ${diff.removedPages.length - MAX_ENTRIES}`);
    }
    lines.push('');
  }

  if (diff.changedTitle.length > 0) {
    lines.push(...formatChangeSection(`✏️ ИЗМЕНЕНИЯ TITLE (${diff.changedTitle.length})`, diff.changedTitle));
  }

  if (diff.changedH1.length > 0) {
    lines.push(...formatChangeSection(`✏️ ИЗМЕНЕНИЯ H1 (${diff.changedH1.length})`, diff.changedH1));
  }

  if (diff.changedDesc.length > 0) {
    lines.push(...formatChangeSection(`✏️ ИЗМЕНЕНИЯ DESCRIPTION (${diff.changedDesc.length})`, diff.changedDesc));
  }

  lines.push(`Просканировано: ${totalPages} стр. за ${duration} сек.`);

  return lines.join('\n');
}

export function hasReportableChanges(results: CompetitorResult[]): boolean {
  return results.some((r) => r.error || (!r.isFirstRun && r.diff && r.diff.hasChanges));
}

export function formatReportText(results: CompetitorResult[]): string {
  const date = formatDate(new Date());
  const blocks: string[] = [`📊 Еженедельный мониторинг конкурентов — ${date}`, ''];

  let totalPages = 0;
  let withChanges = 0;
  let errors = 0;

  for (const result of results) {
    totalPages += result.totalPages;
    if (result.error) errors++;
    else if (!result.isFirstRun && result.diff && result.diff.hasChanges) withChanges++;

    blocks.push(formatCompetitorBlock(result));
    blocks.push('');
  }

  blocks.push(DIVIDER);
  blocks.push('📋 ИТОГО');
  blocks.push(`• Конкурентов обработано: ${results.length}`);
  blocks.push(`• Суммарно страниц: ${totalPages}`);
  blocks.push(`• Конкурентов с изменениями: ${withChanges}`);
  blocks.push(`• Ошибок при сканировании: ${errors}`);

  return blocks.join('\n');
}

export function buildReport(results: CompetitorResult[]): string | null {
  if (!hasReportableChanges(results)) return null;
  return formatReportText(results);
}

export function buildCompetitorMessage(result: CompetitorResult): string {
  return formatCompetitorBlock(result);
}
