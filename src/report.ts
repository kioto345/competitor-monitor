import { CompetitorResult } from './types';

function formatDate(date: Date): string {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${date.getDate().toString().padStart(2,'0')} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function hostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function limitList(items: string[], max = 20): string {
  if (items.length <= max) return items.join('\n');
  return items.slice(0, max).join('\n') + `\n... и ещё ${items.length - max}`;
}

export function formatReport(results: CompetitorResult[], date: Date): string | null {
  // Check if all competitors are first run or have no changes
  const allSilent = results.every(r => r.isFirstRun || (!r.error && r.diff && !r.diff.hasChanges));
  if (allSilent) return null;

  const lines: string[] = [];
  lines.push(`📊 Еженедельный мониторинг конкурентов — ${formatDate(date)}`);
  lines.push('');

  for (const result of results) {
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(`🏢 ${result.competitor.name}  (${hostname(result.competitor.url)})`);
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('');

    if (result.error) {
      lines.push(`⚠️ Ошибка: ${result.error}`);
      lines.push('');
      continue;
    }

    if (result.isFirstRun) {
      lines.push(`🔍 Первый скан: снэпшот сохранён (${result.totalPages} стр.), отчёт со следующей недели.`);
      lines.push('');
      continue;
    }

    const d = result.diff!;
    if (!d.hasChanges) {
      lines.push(`✅ Изменений нет (${result.totalPages} стр.)`);
      lines.push('');
      continue;
    }

    if (d.newPages.length > 0) {
      lines.push(`🆕 НОВЫЕ СТРАНИЦЫ (${d.newPages.length})`);
      const items = d.newPages.map(p => `• ${p.url} — "${p.title || '(нет title)'}" | H1: "${p.h1 || '(нет h1)'}"`);
      lines.push(limitList(items));
      lines.push('');
    }

    if (d.removedPages.length > 0) {
      lines.push(`🗑️ УДАЛЁННЫЕ СТРАНИЦЫ (${d.removedPages.length})`);
      const items = d.removedPages.map(p => `• ${p.url} — последний title: "${p.title || '(нет title)'}"`);
      lines.push(limitList(items));
      lines.push('');
    }

    if (d.changedTitle.length > 0) {
      lines.push(`✏️ ИЗМЕНЕНИЯ TITLE (${d.changedTitle.length})`);
      const items = d.changedTitle.map(c => `• ${c.url}\n  Было:  "${c.old}"\n  Стало: "${c.new}"`);
      lines.push(limitList(items));
      lines.push('');
    }

    if (d.changedH1.length > 0) {
      lines.push(`✏️ ИЗМЕНЕНИЯ H1 (${d.changedH1.length})`);
      const items = d.changedH1.map(c => `• ${c.url}\n  Было:  "${c.old}"\n  Стало: "${c.new}"`);
      lines.push(limitList(items));
      lines.push('');
    }

    if (d.changedDesc.length > 0) {
      lines.push(`✏️ ИЗМЕНЕНИЯ DESCRIPTION (${d.changedDesc.length})`);
      const items = d.changedDesc.map(c => `• ${c.url}\n  Было:  "${c.old || '(нет описания)'}"\n  Стало: "${c.new || '(нет описания)'}"`);
      lines.push(limitList(items));
      lines.push('');
    }

    lines.push(`Просканировано: ${result.totalPages} стр. за ${result.duration} сек.`);
    lines.push('');
  }

  const total = results.reduce((sum, r) => sum + r.totalPages, 0);
  const withChanges = results.filter(r => r.diff?.hasChanges).length;
  const errors = results.filter(r => r.error).length;

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('📋 ИТОГО');
  lines.push(`• Конкурентов обработано: ${results.length}`);
  lines.push(`• Суммарно страниц: ${total}`);
  lines.push(`• Конкурентов с изменениями: ${withChanges}`);
  lines.push(`• Ошибок при сканировании: ${errors}`);

  return lines.join('\n');
}
