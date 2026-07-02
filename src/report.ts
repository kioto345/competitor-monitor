import { CompetitorResult } from './types';

const MAX_ITEMS = 20;

function hostname(url: string): string {
  try {
    return new URL(url).host;
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

function listSection(title: string, items: string[]): string {
  if (items.length === 0) return '';
  const shown = items.slice(0, MAX_ITEMS);
  let out = `${title} (${items.length})\n`;
  out += shown.map((i) => `• ${i}`).join('\n');
  if (items.length > MAX_ITEMS) {
    out += `\n... и ещё ${items.length - MAX_ITEMS}`;
  }
  return out + '\n';
}

function competitorSection(result: CompetitorResult): string {
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

  const newPagesLines = diff.newPages.map(
    (p) => `${p.url} — "${p.title}" | H1: "${p.h1}"`
  );
  const removedPagesLines = diff.removedPages.map(
    (p) => `${p.url} — последний title: "${p.title}"`
  );

  lines.push(listSection('🆕 НОВЫЕ СТРАНИЦЫ', newPagesLines).trimEnd());
  if (newPagesLines.length) lines.push('');

  lines.push(listSection('🗑️ УДАЛЁННЫЕ СТРАНИЦЫ', removedPagesLines).trimEnd());
  if (removedPagesLines.length) lines.push('');

  if (diff.changedTitle.length > 0) {
    const shown = diff.changedTitle.slice(0, MAX_ITEMS);
    lines.push(`✏️ ИЗМЕНЕНИЯ TITLE (${diff.changedTitle.length})`);
    for (const c of shown) {
      lines.push(`• ${c.url}`);
      lines.push(`  Было:  "${c.old}"`);
      lines.push(`  Стало: "${c.new}"`);
    }
    if (diff.changedTitle.length > MAX_ITEMS) {
      lines.push(`... и ещё ${diff.changedTitle.length - MAX_ITEMS}`);
    }
    lines.push('');
  }

  if (diff.changedH1.length > 0) {
    const shown = diff.changedH1.slice(0, MAX_ITEMS);
    lines.push(`✏️ ИЗМЕНЕНИЯ H1 (${diff.changedH1.length})`);
    for (const c of shown) {
      lines.push(`• ${c.url}`);
      lines.push(`  Было:  "${c.old}"`);
      lines.push(`  Стало: "${c.new}"`);
    }
    if (diff.changedH1.length > MAX_ITEMS) {
      lines.push(`... и ещё ${diff.changedH1.length - MAX_ITEMS}`);
    }
    lines.push('');
  }

  if (diff.changedDesc.length > 0) {
    const shown = diff.changedDesc.slice(0, MAX_ITEMS);
    lines.push(`✏️ ИЗМЕНЕНИЯ DESCRIPTION (${diff.changedDesc.length})`);
    for (const c of shown) {
      lines.push(`• ${c.url}`);
      lines.push(`  Было:  "${c.old || '(нет описания)'}"`);
      lines.push(`  Стало: "${c.new || '(нет описания)'}"`);
    }
    if (diff.changedDesc.length > MAX_ITEMS) {
      lines.push(`... и ещё ${diff.changedDesc.length - MAX_ITEMS}`);
    }
    lines.push('');
  }

  lines.push(`Просканировано: ${totalPages} стр. за ${duration} сек.`);

  return lines.join('\n');
}

export function buildReport(allResults: CompetitorResult[], date: Date = new Date()): string {
  const lines: string[] = [];
  lines.push(`📊 Еженедельный мониторинг конкурентов — ${formatDate(date)}`);
  lines.push('');

  for (const result of allResults) {
    lines.push(competitorSection(result));
    lines.push('');
  }

  const totalPages = allResults.reduce((sum, r) => sum + r.totalPages, 0);
  const withChanges = allResults.filter((r) => r.diff?.hasChanges).length;
  const errors = allResults.filter((r) => r.error).length;

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('📋 ИТОГО');
  lines.push(`• Конкурентов обработано: ${allResults.length}`);
  lines.push(`• Суммарно страниц: ${totalPages}`);
  lines.push(`• Конкурентов с изменениями: ${withChanges}`);
  lines.push(`• Ошибок при сканировании: ${errors}`);

  return lines.join('\n');
}

export function shouldSendReport(allResults: CompetitorResult[]): boolean {
  return allResults.some((r) => !r.error && !r.isFirstRun && r.diff?.hasChanges);
}
