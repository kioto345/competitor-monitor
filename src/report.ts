import { CompetitorResult, TrackField } from './types';

function formatDate(d: Date): string {
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function cap<T>(list: T[], max = 20): { items: T[]; extra: number } {
  return list.length <= max
    ? { items: list, extra: 0 }
    : { items: list.slice(0, max), extra: list.length - max };
}

export function formatCompetitorSection(result: CompetitorResult): string {
  const { competitor, diff, totalPages, duration, isFirstRun, error } = result;
  let hostname = '';
  try { hostname = new URL(competitor.url).hostname; } catch {}

  const track: TrackField[] = competitor.track ?? ['title', 'h1', 'description'];
  let s = '';
  s += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  s += `🏢 ${competitor.name}  (${hostname})\n`;
  s += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (error) {
    s += `⚠️ Ошибка: ${error}\n\n`;
    return s;
  }

  if (isFirstRun) {
    s += `🔍 Первый скан: снэпшот сохранён (${totalPages} стр.), отчёт со следующей недели.\n\n`;
    return s;
  }

  if (!diff || !diff.hasChanges) {
    s += `✅ Изменений нет (${totalPages} стр.)\n\n`;
    return s;
  }

  if (diff.newPages.length > 0) {
    const { items, extra } = cap(diff.newPages);
    s += `🆕 НОВЫЕ СТРАНИЦЫ (${diff.newPages.length})\n`;
    for (const p of items) {
      s += `• ${p.url} — "${p.title || '(нет заголовка)'}" | H1: "${p.h1 || '(нет h1)'}"\n`;
    }
    if (extra > 0) s += `  ... и ещё ${extra}\n`;
    s += '\n';
  }

  if (diff.removedPages.length > 0) {
    const { items, extra } = cap(diff.removedPages);
    s += `🗑️ УДАЛЁННЫЕ СТРАНИЦЫ (${diff.removedPages.length})\n`;
    for (const p of items) {
      s += `• ${p.url} — последний title: "${p.title || '(нет заголовка)'}"\n`;
    }
    if (extra > 0) s += `  ... и ещё ${extra}\n`;
    s += '\n';
  }

  if (track.includes('title') && diff.changedTitle.length > 0) {
    const { items, extra } = cap(diff.changedTitle);
    s += `✏️ ИЗМЕНЕНИЯ TITLE (${diff.changedTitle.length})\n`;
    for (const c of items) {
      s += `• ${c.url}\n  Было:  "${c.old}"\n  Стало: "${c.new}"\n`;
    }
    if (extra > 0) s += `  ... и ещё ${extra}\n`;
    s += '\n';
  }

  if (track.includes('h1') && diff.changedH1.length > 0) {
    const { items, extra } = cap(diff.changedH1);
    s += `✏️ ИЗМЕНЕНИЯ H1 (${diff.changedH1.length})\n`;
    for (const c of items) {
      s += `• ${c.url}\n  Было:  "${c.old}"\n  Стало: "${c.new}"\n`;
    }
    if (extra > 0) s += `  ... и ещё ${extra}\n`;
    s += '\n';
  }

  if (track.includes('description') && diff.changedDesc.length > 0) {
    const { items, extra } = cap(diff.changedDesc);
    s += `✏️ ИЗМЕНЕНИЯ DESCRIPTION (${diff.changedDesc.length})\n`;
    for (const c of items) {
      const oldD = c.old || '(нет описания)';
      const newD = c.new || '(нет описания)';
      s += `• ${c.url}\n  Было:  "${oldD}"\n  Стало: "${newD}"\n`;
    }
    if (extra > 0) s += `  ... и ещё ${extra}\n`;
    s += '\n';
  }

  s += `Просканировано: ${totalPages} стр. за ${duration} сек.\n\n`;
  return s;
}

export function formatSummary(results: CompetitorResult[]): string {
  const processed = results.filter(r => !r.error).length;
  const totalPages = results.reduce((sum, r) => sum + r.totalPages, 0);
  const withChanges = results.filter(r => r.diff?.hasChanges).length;
  const errors = results.filter(r => r.error !== null).length;

  let s = `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  s += `📋 ИТОГО\n`;
  s += `• Конкурентов обработано: ${processed}\n`;
  s += `• Суммарно страниц: ${totalPages}\n`;
  s += `• Конкурентов с изменениями: ${withChanges}\n`;
  s += `• Ошибок при сканировании: ${errors}\n`;
  return s;
}

export function formatReport(results: CompetitorResult[]): string {
  const date = formatDate(new Date());
  let report = `📊 Еженедельный мониторинг конкурентов — ${date}\n\n`;
  for (const result of results) {
    report += formatCompetitorSection(result);
  }
  report += formatSummary(results);
  return report;
}
