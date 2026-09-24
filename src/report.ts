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

function limitList<T>(items: T[], render: (item: T) => string): string {
  const shown = items.slice(0, MAX_ENTRIES);
  const lines = shown.map(render);
  if (items.length > MAX_ENTRIES) {
    lines.push(`... и ещё ${items.length - MAX_ENTRIES}`);
  }
  return lines.join('\n');
}

function renderCompetitorSection(result: CompetitorResult): string {
  const { competitor, diff, totalPages, duration, isFirstRun, error } = result;
  const lines: string[] = [];
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`🏢 ${competitor.name}  (${hostname(competitor.url)})`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━');
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
    lines.push(
      limitList(diff.newPages, (p) => `• ${p.url} — "${p.title}" | H1: "${p.h1}"`)
    );
    lines.push('');
  }

  if (diff.removedPages.length > 0) {
    lines.push(`🗑️ УДАЛЁННЫЕ СТРАНИЦЫ (${diff.removedPages.length})`);
    lines.push(
      limitList(diff.removedPages, (p) => `• ${p.url} — последний title: "${p.title}"`)
    );
    lines.push('');
  }

  if (diff.changedTitle.length > 0) {
    lines.push(`✏️ ИЗМЕНЕНИЯ TITLE (${diff.changedTitle.length})`);
    lines.push(
      limitList(diff.changedTitle, (c) => `• ${c.url}\n  Было:  "${c.old}"\n  Стало: "${c.new}"`)
    );
    lines.push('');
  }

  if (diff.changedH1.length > 0) {
    lines.push(`✏️ ИЗМЕНЕНИЯ H1 (${diff.changedH1.length})`);
    lines.push(
      limitList(diff.changedH1, (c) => `• ${c.url}\n  Было:  "${c.old}"\n  Стало: "${c.new}"`)
    );
    lines.push('');
  }

  if (diff.changedDesc.length > 0) {
    lines.push(`✏️ ИЗМЕНЕНИЯ DESCRIPTION (${diff.changedDesc.length})`);
    lines.push(
      limitList(diff.changedDesc, (c) => {
        const oldVal = c.old || '(нет описания)';
        const newVal = c.new || '(нет описания)';
        return `• ${c.url}\n  Было:  "${oldVal}"\n  Стало: "${newVal}"`;
      })
    );
    lines.push('');
  }

  lines.push(`Просканировано: ${totalPages} стр. за ${duration} сек.`);
  return lines.join('\n');
}

export function buildReport(results: CompetitorResult[], now: Date = new Date()): string {
  const sections = results.map(renderCompetitorSection);

  const totalPages = results.reduce((sum, r) => sum + r.totalPages, 0);
  const withChanges = results.filter((r) => !r.error && !r.isFirstRun && r.diff?.hasChanges).length;
  const errors = results.filter((r) => r.error).length;

  const header = `📊 Еженедельный мониторинг конкурентов — ${formatDate(now)}`;

  const summary = [
    '━━━━━━━━━━━━━━━━━━━━━━━━',
    '📋 ИТОГО',
    `• Конкурентов обработано: ${results.length}`,
    `• Суммарно страниц: ${totalPages}`,
    `• Конкурентов с изменениями: ${withChanges}`,
    `• Ошибок при сканировании: ${errors}`,
  ].join('\n');

  return [header, '', ...sections, summary].join('\n');
}

export function shouldSendReport(results: CompetitorResult[]): boolean {
  return results.some((r) => !r.error && !r.isFirstRun && r.diff?.hasChanges);
}

export function splitReportByCompetitor(results: CompetitorResult[], now: Date = new Date()): string[] {
  const header = `📊 Еженедельный мониторинг конкурентов — ${formatDate(now)}`;
  const changedResults = results.filter((r) => r.error || r.isFirstRun || r.diff?.hasChanges);

  const messages = changedResults.map((r) => renderCompetitorSection(r));

  const totalPages = results.reduce((sum, r) => sum + r.totalPages, 0);
  const withChanges = results.filter((r) => !r.error && !r.isFirstRun && r.diff?.hasChanges).length;
  const errors = results.filter((r) => r.error).length;

  const summary = [
    '━━━━━━━━━━━━━━━━━━━━━━━━',
    '📋 ИТОГО',
    `• Конкурентов обработано: ${results.length}`,
    `• Суммарно страниц: ${totalPages}`,
    `• Конкурентов с изменениями: ${withChanges}`,
    `• Ошибок при сканировании: ${errors}`,
  ].join('\n');

  return [`${header}\n`, ...messages, summary];
}
