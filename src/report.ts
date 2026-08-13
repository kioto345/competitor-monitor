import { CompetitorResult } from './types';

const SECTION_LIMIT = 20;

function hostnameOf(url: string): string {
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

function limitList<T>(items: T[]): { shown: T[]; extra: number } {
  if (items.length <= SECTION_LIMIT) return { shown: items, extra: 0 };
  return { shown: items.slice(0, SECTION_LIMIT), extra: items.length - SECTION_LIMIT };
}

function renderCompetitorSection(result: CompetitorResult): string {
  const { competitor, diff, totalPages, duration, isFirstRun, error } = result;
  const lines: string[] = [];
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`🏢 ${competitor.name}  (${hostnameOf(competitor.url)})`);
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
    const { shown, extra } = limitList(diff.newPages);
    lines.push(`🆕 НОВЫЕ СТРАНИЦЫ (${diff.newPages.length})`);
    for (const p of shown) {
      lines.push(`• ${p.url} — "${p.title}" | H1: "${p.h1}"`);
    }
    if (extra > 0) lines.push(`... и ещё ${extra}`);
    lines.push('');
  }

  if (diff.removedPages.length > 0) {
    const { shown, extra } = limitList(diff.removedPages);
    lines.push(`🗑️ УДАЛЁННЫЕ СТРАНИЦЫ (${diff.removedPages.length})`);
    for (const p of shown) {
      lines.push(`• ${p.url} — последний title: "${p.title}"`);
    }
    if (extra > 0) lines.push(`... и ещё ${extra}`);
    lines.push('');
  }

  if (diff.changedTitle.length > 0) {
    const { shown, extra } = limitList(diff.changedTitle);
    lines.push(`✏️ ИЗМЕНЕНИЯ TITLE (${diff.changedTitle.length})`);
    for (const c of shown) {
      lines.push(`• ${c.url}`);
      lines.push(`  Было:  "${c.old}"`);
      lines.push(`  Стало: "${c.new}"`);
    }
    if (extra > 0) lines.push(`... и ещё ${extra}`);
    lines.push('');
  }

  if (diff.changedH1.length > 0) {
    const { shown, extra } = limitList(diff.changedH1);
    lines.push(`✏️ ИЗМЕНЕНИЯ H1 (${diff.changedH1.length})`);
    for (const c of shown) {
      lines.push(`• ${c.url}`);
      lines.push(`  Было:  "${c.old}"`);
      lines.push(`  Стало: "${c.new}"`);
    }
    if (extra > 0) lines.push(`... и ещё ${extra}`);
    lines.push('');
  }

  if (diff.changedDesc.length > 0) {
    const { shown, extra } = limitList(diff.changedDesc);
    lines.push(`✏️ ИЗМЕНЕНИЯ DESCRIPTION (${diff.changedDesc.length})`);
    for (const c of shown) {
      const oldVal = c.old || '(нет описания)';
      const newVal = c.new || '(нет описания)';
      lines.push(`• ${c.url}`);
      lines.push(`  Было:  "${oldVal}"`);
      lines.push(`  Стало: "${newVal}"`);
    }
    if (extra > 0) lines.push(`... и ещё ${extra}`);
    lines.push('');
  }

  lines.push(`Просканировано: ${totalPages} стр. за ${duration} сек.`);

  return lines.join('\n');
}

export function buildReport(allResults: CompetitorResult[], date: Date = new Date()): string {
  const sections: string[] = [];
  sections.push(`📊 Еженедельный мониторинг конкурентов — ${formatDate(date)}`);
  sections.push('');

  for (const result of allResults) {
    sections.push(renderCompetitorSection(result));
    sections.push('');
  }

  const totalPages = allResults.reduce((sum, r) => sum + r.totalPages, 0);
  const withChanges = allResults.filter((r) => !r.error && !r.isFirstRun && r.diff?.hasChanges).length;
  const errors = allResults.filter((r) => r.error).length;

  sections.push('━━━━━━━━━━━━━━━━━━━━━━━━');
  sections.push('📋 ИТОГО');
  sections.push(`• Конкурентов обработано: ${allResults.length}`);
  sections.push(`• Суммарно страниц: ${totalPages}`);
  sections.push(`• Конкурентов с изменениями: ${withChanges}`);
  sections.push(`• Ошибок при сканировании: ${errors}`);

  return sections.join('\n');
}

export function shouldSendReport(allResults: CompetitorResult[]): boolean {
  if (process.env.FORCE_REPORT === 'true') return true;
  return allResults.some((r) => !r.error && !r.isFirstRun && r.diff?.hasChanges);
}

export function splitReportByCompetitor(allResults: CompetitorResult[], date: Date = new Date()): string[] {
  const messages: string[] = [];
  const withChanges = allResults.filter((r) => !r.error && !r.isFirstRun && r.diff?.hasChanges);

  for (const result of withChanges) {
    messages.push(renderCompetitorSection(result));
  }

  const totalPages = allResults.reduce((sum, r) => sum + r.totalPages, 0);
  const errors = allResults.filter((r) => r.error).length;

  const summary = [
    `📊 Еженедельный мониторинг конкурентов — ${formatDate(date)}`,
    '',
    '📋 ИТОГО',
    `• Конкурентов обработано: ${allResults.length}`,
    `• Суммарно страниц: ${totalPages}`,
    `• Конкурентов с изменениями: ${withChanges.length}`,
    `• Ошибок при сканировании: ${errors}`,
  ].join('\n');

  messages.push(summary);
  return messages;
}
