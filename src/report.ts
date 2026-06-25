import { CompetitorResult } from './types';

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function hostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function truncate<T>(arr: T[], limit: number = 20): { items: T[]; extra: number } {
  if (arr.length <= limit) return { items: arr, extra: 0 };
  return { items: arr.slice(0, limit), extra: arr.length - limit };
}

function buildCompetitorSection(result: CompetitorResult): string {
  const { competitor, diff, totalPages, duration, isFirstRun, error } = result;
  const lines: string[] = [];

  lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`🏢 <b>${esc(competitor.name)}</b>  (${esc(hostname(competitor.url))})`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push('');

  if (error) {
    lines.push(`⚠️ Ошибка: ${esc(error)}`);
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
    const { items, extra } = truncate(diff.newPages);
    lines.push(`🆕 <b>НОВЫЕ СТРАНИЦЫ (${diff.newPages.length})</b>`);
    for (const p of items) {
      const t = esc(p.title || '(нет заголовка)');
      const h = esc(p.h1 || '(нет H1)');
      lines.push(`• ${esc(p.url)} — "${t}" | H1: "${h}"`);
    }
    if (extra > 0) lines.push(`... и ещё ${extra}`);
    lines.push('');
  }

  if (diff.removedPages.length > 0) {
    const { items, extra } = truncate(diff.removedPages);
    lines.push(`🗑️ <b>УДАЛЁННЫЕ СТРАНИЦЫ (${diff.removedPages.length})</b>`);
    for (const p of items) {
      lines.push(`• ${esc(p.url)} — последний title: "${esc(p.title || '(нет заголовка)')}"`);
    }
    if (extra > 0) lines.push(`... и ещё ${extra}`);
    lines.push('');
  }

  if (diff.changedTitle.length > 0) {
    const { items, extra } = truncate(diff.changedTitle);
    lines.push(`✏️ <b>ИЗМЕНЕНИЯ TITLE (${diff.changedTitle.length})</b>`);
    for (const c of items) {
      lines.push(`• ${esc(c.url)}`);
      lines.push(`  Было:  "${esc(c.old || '(пусто)')}"`);
      lines.push(`  Стало: "${esc(c.new || '(пусто)')}"`);
    }
    if (extra > 0) lines.push(`... и ещё ${extra}`);
    lines.push('');
  }

  if (diff.changedH1.length > 0) {
    const { items, extra } = truncate(diff.changedH1);
    lines.push(`✏️ <b>ИЗМЕНЕНИЯ H1 (${diff.changedH1.length})</b>`);
    for (const c of items) {
      lines.push(`• ${esc(c.url)}`);
      lines.push(`  Было:  "${esc(c.old || '(пусто)')}"`);
      lines.push(`  Стало: "${esc(c.new || '(пусто)')}"`);
    }
    if (extra > 0) lines.push(`... и ещё ${extra}`);
    lines.push('');
  }

  if (diff.changedDesc.length > 0) {
    const { items, extra } = truncate(diff.changedDesc);
    lines.push(`✏️ <b>ИЗМЕНЕНИЯ DESCRIPTION (${diff.changedDesc.length})</b>`);
    for (const c of items) {
      lines.push(`• ${esc(c.url)}`);
      lines.push(`  Было:  "${esc(c.old || '(нет описания)')}"`);
      lines.push(`  Стало: "${esc(c.new || '(нет описания)')}"`);
    }
    if (extra > 0) lines.push(`... и ещё ${extra}`);
    lines.push('');
  }

  lines.push(`Просканировано: ${totalPages} стр. за ${duration} сек.`);
  lines.push('');

  return lines.join('\n');
}

export function buildReport(allResults: CompetitorResult[], date: string): string[] {
  const messages: string[] = [];
  const header = `📊 <b>Еженедельный мониторинг конкурентов — ${date}</b>\n\n`;

  let current = header;

  for (const result of allResults) {
    const section = buildCompetitorSection(result);
    if (current.length + section.length > 3800) {
      messages.push(current.trim());
      current = section;
    } else {
      current += section;
    }
  }

  const processed = allResults.filter(r => !r.error).length;
  const totalPages = allResults.reduce((s, r) => s + r.totalPages, 0);
  const withChanges = allResults.filter(r => r.diff?.hasChanges && !r.isFirstRun).length;
  const errors = allResults.filter(r => r.error).length;

  const summary = [
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `📋 <b>ИТОГО</b>`,
    `• Конкурентов обработано: ${processed}`,
    `• Суммарно страниц: ${totalPages}`,
    `• Конкурентов с изменениями: ${withChanges}`,
    `• Ошибок при сканировании: ${errors}`,
  ].join('\n');

  if (current.length + summary.length > 3800) {
    messages.push(current.trim());
    messages.push(summary);
  } else {
    current += summary;
    messages.push(current.trim());
  }

  return messages;
}
