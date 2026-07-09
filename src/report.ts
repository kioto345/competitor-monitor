import { CompetitorResult } from './types';

const MAX_ENTRIES = 20;

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

function truncated<T>(items: T[], render: (item: T) => string): string {
  const shown = items.slice(0, MAX_ENTRIES).map(render).join('\n');
  const rest = items.length - MAX_ENTRIES;
  return rest > 0 ? `${shown}\n... и ещё ${rest}` : shown;
}

function renderCompetitor(result: CompetitorResult): string {
  const { competitor, diff, totalPages, duration, isFirstRun, error } = result;
  const lines: string[] = [];
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`🏢 ${competitor.name}  (${hostname(competitor.url)})`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━');

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
    lines.push('');
    lines.push(`🆕 НОВЫЕ СТРАНИЦЫ (${diff.newPages.length})`);
    lines.push(truncated(diff.newPages, (p) => `• ${p.url} — "${p.title}" | H1: "${p.h1}"`));
  }

  if (diff.removedPages.length > 0) {
    lines.push('');
    lines.push(`🗑️ УДАЛЁННЫЕ СТРАНИЦЫ (${diff.removedPages.length})`);
    lines.push(truncated(diff.removedPages, (p) => `• ${p.url} — последний title: "${p.title}"`));
  }

  if (diff.changedTitle.length > 0) {
    lines.push('');
    lines.push(`✏️ ИЗМЕНЕНИЯ TITLE (${diff.changedTitle.length})`);
    lines.push(
      truncated(diff.changedTitle, (c) => `• ${c.url}\n  Было:  "${c.old}"\n  Стало: "${c.new}"`)
    );
  }

  if (diff.changedH1.length > 0) {
    lines.push('');
    lines.push(`✏️ ИЗМЕНЕНИЯ H1 (${diff.changedH1.length})`);
    lines.push(
      truncated(diff.changedH1, (c) => `• ${c.url}\n  Было:  "${c.old}"\n  Стало: "${c.new}"`)
    );
  }

  if (diff.changedDesc.length > 0) {
    lines.push('');
    lines.push(`✏️ ИЗМЕНЕНИЯ DESCRIPTION (${diff.changedDesc.length})`);
    lines.push(
      truncated(diff.changedDesc, (c) => {
        const oldVal = c.old || '(нет описания)';
        const newVal = c.new || '(нет описания)';
        return `• ${c.url}\n  Было:  "${oldVal}"\n  Стало: "${newVal}"`;
      })
    );
  }

  lines.push('');
  lines.push(`Просканировано: ${totalPages} стр. за ${duration} сек.`);

  return lines.join('\n');
}

export function shouldSendReport(results: CompetitorResult[]): boolean {
  return results.some((r) => !r.isFirstRun && !r.error && r.diff?.hasChanges);
}

export function buildReport(results: CompetitorResult[], date: Date = new Date()): string {
  const lines: string[] = [];
  lines.push(`📊 Еженедельный мониторинг конкурентов — ${formatDate(date)}`);
  lines.push('');

  for (const result of results) {
    lines.push(renderCompetitor(result));
    lines.push('');
  }

  const totalPages = results.reduce((sum, r) => sum + r.totalPages, 0);
  const withChanges = results.filter((r) => !r.isFirstRun && !r.error && r.diff?.hasChanges).length;
  const errors = results.filter((r) => r.error).length;

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('📋 ИТОГО');
  lines.push(`• Конкурентов обработано: ${results.length}`);
  lines.push(`• Суммарно страниц: ${totalPages}`);
  lines.push(`• Конкурентов с изменениями: ${withChanges}`);
  lines.push(`• Ошибок при сканировании: ${errors}`);

  return lines.join('\n');
}

export function buildCompetitorReports(results: CompetitorResult[]): string[] {
  return results.filter((r) => !r.isFirstRun && !r.error && r.diff?.hasChanges).map((r) => renderCompetitor(r));
}
