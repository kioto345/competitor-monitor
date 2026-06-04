import { CompetitorResult } from './types';

const MAX_PER_SECTION = 20;

function hostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function fmt(items: any[], formatFn: (item: any) => string): string {
  const shown = items.slice(0, MAX_PER_SECTION).map(formatFn).join('\n');
  const extra = items.length > MAX_PER_SECTION ? `\n... и ещё ${items.length - MAX_PER_SECTION}` : '';
  return shown + extra;
}

function formatDate(d: Date): string {
  const months = ['января','февраля','марта','апреля','мая','июня',
                   'июля','августа','сентября','октября','ноября','декабря'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

export function buildReport(results: CompetitorResult[]): string {
  const date = formatDate(new Date());
  const lines: string[] = [`📊 *Еженедельный мониторинг конкурентов — ${date}*\n`];

  let totalPages = 0;
  let withChanges = 0;
  let errors = 0;

  for (const r of results) {
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`🏢 *${r.competitor.name}* (${hostname(r.competitor.url)})`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    totalPages += r.totalPages;

    if (r.error) {
      errors++;
      lines.push(`⚠️ Ошибка: ${r.error}\n`);
      continue;
    }

    if (r.isFirstRun) {
      lines.push(`🔍 Первый скан: снэпшот сохранён (${r.totalPages} стр.), отчёт со следующей недели.\n`);
      continue;
    }

    const d = r.diff!;
    if (!d.hasChanges) {
      lines.push(`✅ Изменений нет (${r.totalPages} стр.)\n`);
      continue;
    }

    withChanges++;

    if (d.newPages.length > 0) {
      lines.push(`🆕 *НОВЫЕ СТРАНИЦЫ (${d.newPages.length})*`);
      lines.push(fmt(d.newPages, p =>
        `• ${p.url} — "${p.title || '(нет заголовка)'}" | H1: "${p.h1 || '(нет)'}"`
      ));
      lines.push('');
    }

    if (d.removedPages.length > 0) {
      lines.push(`🗑️ *УДАЛЁННЫЕ СТРАНИЦЫ (${d.removedPages.length})*`);
      lines.push(fmt(d.removedPages, p =>
        `• ${p.url} — последний title: "${p.title || '(нет)'}"`
      ));
      lines.push('');
    }

    if (d.changedTitle.length > 0) {
      lines.push(`✏️ *ИЗМЕНЕНИЯ TITLE (${d.changedTitle.length})*`);
      lines.push(fmt(d.changedTitle, c =>
        `• ${c.url}\n  Было:  "${c.old}"\n  Стало: "${c.new}"`
      ));
      lines.push('');
    }

    if (d.changedH1.length > 0) {
      lines.push(`✏️ *ИЗМЕНЕНИЯ H1 (${d.changedH1.length})*`);
      lines.push(fmt(d.changedH1, c =>
        `• ${c.url}\n  Было:  "${c.old}"\n  Стало: "${c.new}"`
      ));
      lines.push('');
    }

    if (d.changedDesc.length > 0) {
      lines.push(`✏️ *ИЗМЕНЕНИЯ DESCRIPTION (${d.changedDesc.length})*`);
      lines.push(fmt(d.changedDesc, c =>
        `• ${c.url}\n  Было:  "${c.old || '(нет описания)'}"\n  Стало: "${c.new || '(нет описания)'}"`
      ));
      lines.push('');
    }

    lines.push(`Просканировано: ${r.totalPages} стр. за ${r.duration} сек.\n`);
  }

  lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`📋 *ИТОГО*`);
  lines.push(`• Конкурентов обработано: ${results.length}`);
  lines.push(`• Суммарно страниц: ${totalPages}`);
  lines.push(`• Конкурентов с изменениями: ${withChanges}`);
  lines.push(`• Ошибок при сканировании: ${errors}`);

  return lines.join('\n');
}

export function shouldSendReport(results: CompetitorResult[]): boolean {
  return results.some(r => !r.isFirstRun && !r.error && r.diff?.hasChanges);
}
