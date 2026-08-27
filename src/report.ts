import { CompetitorResult } from './types';

const MAX_ITEMS = 20;

function esc(s: string): string {
  return s || '';
}

function formatDate(d: Date): string {
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function limitList<T>(items: T[]): { shown: T[]; extra: number } {
  if (items.length <= MAX_ITEMS) return { shown: items, extra: 0 };
  return { shown: items.slice(0, MAX_ITEMS), extra: items.length - MAX_ITEMS };
}

export function buildCompetitorSection(result: CompetitorResult): string {
  const { competitor, diff, totalPages, duration, isFirstRun, error } = result;
  const lines: string[] = [];

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`🏢 ${competitor.name}  (${hostname(competitor.url)})`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');

  if (error) {
    lines.push(`⚠️ Ошибка: ${error}`);
    lines.push('');
    return lines.join('\n');
  }

  if (isFirstRun) {
    lines.push(`🔍 Первый скан: снэпшот сохранён (${totalPages} стр.), отчёт со следующей недели.`);
    lines.push('');
    return lines.join('\n');
  }

  if (!diff || !diff.hasChanges) {
    lines.push(`✅ Изменений нет (${totalPages} стр.)`);
    lines.push('');
    return lines.join('\n');
  }

  if (diff.newPages.length > 0) {
    const { shown, extra } = limitList(diff.newPages);
    lines.push(`🆕 НОВЫЕ СТРАНИЦЫ (${diff.newPages.length})`);
    for (const p of shown) {
      lines.push(`• ${p.url} — "${esc(p.title)}" | H1: "${esc(p.h1)}"`);
    }
    if (extra > 0) lines.push(`... и ещё ${extra}`);
    lines.push('');
  }

  if (diff.removedPages.length > 0) {
    const { shown, extra } = limitList(diff.removedPages);
    lines.push(`🗑️ УДАЛЁННЫЕ СТРАНИЦЫ (${diff.removedPages.length})`);
    for (const p of shown) {
      lines.push(`• ${p.url} — последний title: "${esc(p.title)}"`);
    }
    if (extra > 0) lines.push(`... и ещё ${extra}`);
    lines.push('');
  }

  if (diff.changedTitle.length > 0) {
    const { shown, extra } = limitList(diff.changedTitle);
    lines.push(`✏️ ИЗМЕНЕНИЯ TITLE (${diff.changedTitle.length})`);
    for (const c of shown) {
      lines.push(`• ${c.url}`);
      lines.push(`  Было:  "${esc(c.old)}"`);
      lines.push(`  Стало: "${esc(c.new)}"`);
    }
    if (extra > 0) lines.push(`... и ещё ${extra}`);
    lines.push('');
  }

  if (diff.changedH1.length > 0) {
    const { shown, extra } = limitList(diff.changedH1);
    lines.push(`✏️ ИЗМЕНЕНИЯ H1 (${diff.changedH1.length})`);
    for (const c of shown) {
      lines.push(`• ${c.url}`);
      lines.push(`  Было:  "${esc(c.old)}"`);
      lines.push(`  Стало: "${esc(c.new)}"`);
    }
    if (extra > 0) lines.push(`... и ещё ${extra}`);
    lines.push('');
  }

  if (diff.changedDesc.length > 0) {
    const { shown, extra } = limitList(diff.changedDesc);
    lines.push(`✏️ ИЗМЕНЕНИЯ DESCRIPTION (${diff.changedDesc.length})`);
    for (const c of shown) {
      lines.push(`• ${c.url}`);
      lines.push(`  Было:  "${c.old || '(нет описания)'}"`);
      lines.push(`  Стало: "${c.new || '(нет описания)'}"`);
    }
    if (extra > 0) lines.push(`... и ещё ${extra}`);
    lines.push('');
  }

  lines.push(`Просканировано: ${totalPages} стр. за ${duration} сек.`);
  lines.push('');

  return lines.join('\n');
}

export function buildSummaryReport(results: CompetitorResult[], date: Date = new Date()): string {
  const lines: string[] = [];

  lines.push(`📊 Еженедельный мониторинг конкурентов — ${formatDate(date)}`);
  lines.push('');

  for (const result of results) {
    lines.push(buildCompetitorSection(result));
  }

  const totalPages = results.reduce((sum, r) => sum + (r.totalPages || 0), 0);
  const withChanges = results.filter((r) => r.diff && r.diff.hasChanges && !r.isFirstRun && !r.error).length;
  const errors = results.filter((r) => r.error).length;

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('📋 ИТОГО');
  lines.push(`• Конкурентов обработано: ${results.length}`);
  lines.push(`• Суммарно страниц: ${totalPages}`);
  lines.push(`• Конкурентов с изменениями: ${withChanges}`);
  lines.push(`• Ошибок при сканировании: ${errors}`);

  return lines.join('\n');
}

export function shouldSendReport(results: CompetitorResult[]): boolean {
  return results.some((r) => !r.isFirstRun && !r.error && r.diff && r.diff.hasChanges);
}
