import { CompetitorResult } from './types';

const MAX_ITEMS = 20;

function clamp<T>(items: T[], format: (item: T) => string): string {
  const shown = items.slice(0, MAX_ITEMS).map(format).join('\n');
  const extra = items.length > MAX_ITEMS ? `\n... и ещё ${items.length - MAX_ITEMS}` : '';
  return shown + extra;
}

export function formatReport(allResults: CompetitorResult[], dateStr: string): string {
  const lines: string[] = [];

  lines.push(`📊 Еженедельный мониторинг конкурентов — ${dateStr}\n`);

  for (const result of allResults) {
    let hostname = result.competitor.url;
    try { hostname = new URL(result.competitor.url).hostname; } catch {}

    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`🏢 ${result.competitor.name}  (${hostname})`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    if (result.error) {
      lines.push(`⚠️ Ошибка: ${result.error}\n`);
      continue;
    }

    if (result.isFirstRun) {
      lines.push(`🔍 Первый скан: снэпшот сохранён (${result.totalPages} стр.), отчёт со следующей недели.\n`);
      continue;
    }

    const d = result.diff!;

    if (!d.hasChanges) {
      lines.push(`✅ Изменений нет (${result.totalPages} стр.)\n`);
      continue;
    }

    if (d.newPages.length > 0) {
      lines.push(`🆕 НОВЫЕ СТРАНИЦЫ (${d.newPages.length})`);
      lines.push(clamp(d.newPages, p =>
        `• ${p.url} — "${p.title || '(нет заголовка)'}" | H1: "${p.h1 || '(нет h1)'}"`
      ));
      lines.push('');
    }

    if (d.removedPages.length > 0) {
      lines.push(`🗑️ УДАЛЁННЫЕ СТРАНИЦЫ (${d.removedPages.length})`);
      lines.push(clamp(d.removedPages, p =>
        `• ${p.url} — последний title: "${p.title || '(нет заголовка)'}"`
      ));
      lines.push('');
    }

    if (d.changedTitle.length > 0) {
      lines.push(`✏️ ИЗМЕНЕНИЯ TITLE (${d.changedTitle.length})`);
      lines.push(clamp(d.changedTitle, c =>
        `• ${c.url}\n  Было:  "${c.old}"\n  Стало: "${c.new}"`
      ));
      lines.push('');
    }

    if (d.changedH1.length > 0) {
      lines.push(`✏️ ИЗМЕНЕНИЯ H1 (${d.changedH1.length})`);
      lines.push(clamp(d.changedH1, c =>
        `• ${c.url}\n  Было:  "${c.old}"\n  Стало: "${c.new}"`
      ));
      lines.push('');
    }

    if (d.changedDesc.length > 0) {
      lines.push(`✏️ ИЗМЕНЕНИЯ DESCRIPTION (${d.changedDesc.length})`);
      lines.push(clamp(d.changedDesc, c => {
        const oldVal = c.old || '(нет описания)';
        const newVal = c.new || '(нет описания)';
        return `• ${c.url}\n  Было:  "${oldVal}"\n  Стало: "${newVal}"`;
      }));
      lines.push('');
    }

    lines.push(`Просканировано: ${result.totalPages} стр. за ${result.duration} сек.\n`);
  }

  const processed = allResults.filter(r => !r.error).length;
  const totalPages = allResults.reduce((sum, r) => sum + r.totalPages, 0);
  const withChanges = allResults.filter(r => !r.isFirstRun && r.diff?.hasChanges).length;
  const errors = allResults.filter(r => !!r.error).length;

  lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`📋 ИТОГО`);
  lines.push(`• Конкурентов обработано: ${processed}`);
  lines.push(`• Суммарно страниц: ${totalPages}`);
  lines.push(`• Конкурентов с изменениями: ${withChanges}`);
  lines.push(`• Ошибок при сканировании: ${errors}`);

  return lines.join('\n');
}
