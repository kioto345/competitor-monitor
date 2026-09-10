import { CompetitorResult } from './types';

const MAX_ITEMS_PER_SECTION = 20;

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
  if (items.length <= MAX_ITEMS_PER_SECTION) return { shown: items, extra: 0 };
  return { shown: items.slice(0, MAX_ITEMS_PER_SECTION), extra: items.length - MAX_ITEMS_PER_SECTION };
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

  const { shown: newShown, extra: newExtra } = limitList(diff.newPages);
  if (diff.newPages.length > 0) {
    lines.push(`🆕 НОВЫЕ СТРАНИЦЫ (${diff.newPages.length})`);
    for (const p of newShown) {
      lines.push(`• ${p.url} — "${p.title}" | H1: "${p.h1}"`);
    }
    if (newExtra > 0) lines.push(`... и ещё ${newExtra}`);
    lines.push('');
  }

  const { shown: removedShown, extra: removedExtra } = limitList(diff.removedPages);
  if (diff.removedPages.length > 0) {
    lines.push(`🗑️ УДАЛЁННЫЕ СТРАНИЦЫ (${diff.removedPages.length})`);
    for (const p of removedShown) {
      lines.push(`• ${p.url} — последний title: "${p.title}"`);
    }
    if (removedExtra > 0) lines.push(`... и ещё ${removedExtra}`);
    lines.push('');
  }

  const { shown: titleShown, extra: titleExtra } = limitList(diff.changedTitle);
  if (diff.changedTitle.length > 0) {
    lines.push(`✏️ ИЗМЕНЕНИЯ TITLE (${diff.changedTitle.length})`);
    for (const c of titleShown) {
      lines.push(`• ${c.url}`);
      lines.push(`  Было:  "${c.old}"`);
      lines.push(`  Стало: "${c.new}"`);
    }
    if (titleExtra > 0) lines.push(`... и ещё ${titleExtra}`);
    lines.push('');
  }

  const { shown: h1Shown, extra: h1Extra } = limitList(diff.changedH1);
  if (diff.changedH1.length > 0) {
    lines.push(`✏️ ИЗМЕНЕНИЯ H1 (${diff.changedH1.length})`);
    for (const c of h1Shown) {
      lines.push(`• ${c.url}`);
      lines.push(`  Было:  "${c.old}"`);
      lines.push(`  Стало: "${c.new}"`);
    }
    if (h1Extra > 0) lines.push(`... и ещё ${h1Extra}`);
    lines.push('');
  }

  const { shown: descShown, extra: descExtra } = limitList(diff.changedDesc);
  if (diff.changedDesc.length > 0) {
    lines.push(`✏️ ИЗМЕНЕНИЯ DESCRIPTION (${diff.changedDesc.length})`);
    for (const c of descShown) {
      const oldVal = c.old || '(нет описания)';
      const newVal = c.new || '(нет описания)';
      lines.push(`• ${c.url}`);
      lines.push(`  Было:  "${oldVal}"`);
      lines.push(`  Стало: "${newVal}"`);
    }
    if (descExtra > 0) lines.push(`... и ещё ${descExtra}`);
    lines.push('');
  }

  lines.push(`Просканировано: ${totalPages} стр. за ${duration} сек.`);
  return lines.join('\n');
}

export function shouldSendReport(results: CompetitorResult[]): boolean {
  if (process.env.FORCE_REPORT === 'true') return true;
  return results.some((r) => !r.isFirstRun && !r.error && r.diff && r.diff.hasChanges);
}

export function buildReport(results: CompetitorResult[]): string {
  const lines: string[] = [];
  lines.push(`📊 Еженедельный мониторинг конкурентов — ${formatDate(new Date())}`);
  lines.push('');

  for (const result of results) {
    lines.push(renderCompetitorSection(result));
    lines.push('');
  }

  const totalPages = results.reduce((sum, r) => sum + (r.totalPages || 0), 0);
  const withChanges = results.filter((r) => !r.isFirstRun && !r.error && r.diff && r.diff.hasChanges).length;
  const errors = results.filter((r) => r.error).length;

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('📋 ИТОГО');
  lines.push(`• Конкурентов обработано: ${results.length}`);
  lines.push(`• Суммарно страниц: ${totalPages}`);
  lines.push(`• Конкурентов с изменениями: ${withChanges}`);
  lines.push(`• Ошибок при сканировании: ${errors}`);

  return lines.join('\n');
}

export function buildPerCompetitorMessages(results: CompetitorResult[]): string[] {
  const messages: string[] = [];
  const header = `📊 Еженедельный мониторинг конкурентов — ${formatDate(new Date())}`;

  for (const result of results) {
    if (result.error || result.isFirstRun) continue;
    if (result.diff && result.diff.hasChanges) {
      messages.push(renderCompetitorSection(result));
    }
  }

  const totalPages = results.reduce((sum, r) => sum + (r.totalPages || 0), 0);
  const withChanges = results.filter((r) => !r.isFirstRun && !r.error && r.diff && r.diff.hasChanges).length;
  const errors = results.filter((r) => r.error).length;

  const summary = [
    header,
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━',
    '📋 ИТОГО',
    `• Конкурентов обработано: ${results.length}`,
    `• Суммарно страниц: ${totalPages}`,
    `• Конкурентов с изменениями: ${withChanges}`,
    `• Ошибок при сканировании: ${errors}`,
  ].join('\n');

  return [...messages, summary];
}
