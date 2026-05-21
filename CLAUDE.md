# Competitor Monitor — инструкции агента

Ты агент еженедельного мониторинга сайтов конкурентов.
Запускаешься каждый **четверг** автоматически через Claude Code Routines.
Работаешь автономно, без вмешательства пользователя.
Обрабатываешь **всех конкурентов последовательно** за один запуск.

---

## Конфигурация

### Переменные окружения (`.env` или Claude Code Routines → Environment)

```
NOTIFY_CHANNEL=telegram          # telegram | slack | email
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
SLACK_WEBHOOK_URL=...
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
REPORT_EMAIL_TO=you@example.com
REQUEST_DELAY_MS=800             # пауза между запросами внутри одного сайта
```

### Список конкурентов — `competitors.json`

Все конкуренты описаны в файле `competitors.json` в корне проекта.
Именно этот файл — единственное место, где добавляют, убирают или настраивают конкурентов.

```json
[
  {
    "id": "competitor-a",
    "name": "Competitor A",
    "url": "https://competitor-a.com",
    "maxPages": 300,
    "maxDepth": 3,
    "track": ["title", "h1", "description"]
  },
  {
    "id": "competitor-b",
    "name": "Competitor B",
    "url": "https://competitor-b.com",
    "maxPages": 500,
    "maxDepth": 4,
    "track": ["title", "h1"]
  },
  {
    "id": "competitor-c",
    "name": "Competitor C",
    "url": "https://competitor-c.com",
    "maxPages": 200,
    "maxDepth": 2,
    "track": ["title", "h1", "description"]
  }
]
```

Поля на каждого конкурента:

| Поле | Обязательное | Описание |
|---|---|---|
| `id` | да | Уникальный slug. Используется как имя файла снэпшота: `data/snapshots/{id}.json` |
| `name` | да | Человекочитаемое название для отчёта |
| `url` | да | Базовый URL сайта (без trailing slash) |
| `maxPages` | нет | Макс. страниц при краулинге (default: 300) |
| `maxDepth` | нет | Макс. глубина рекурсивного краулера (default: 3) |
| `track` | нет | Какие поля отслеживать: `title`, `h1`, `description` (default: все три) |

Если `.env` не найден или `competitors.json` отсутствует / невалиден — сообщи об ошибке и останови выполнение.

---

## Порядок выполнения

Для **каждого конкурента** из `competitors.json` последовательно выполняй шаги 1–6.
После обработки всех конкурентов — шаг 7 (сводный отчёт) и шаг 8 (завершение).

---

### Шаг 1 — Сбор URL сайта конкурента

1. Загрузи `{competitor.url}/sitemap.xml`.
   - Если sitemap найден и содержит URL — используй его. Поддерживай sitemap index (вложенные sitemap-файлы).
   - Если sitemap недоступен или пуст — запусти рекурсивный краулер:
     - Стартуй с главной страницы `competitor.url`.
     - Переходи только по внутренним ссылкам (тот же домен).
     - Глубина не более `competitor.maxDepth`.
     - Не более `competitor.maxPages` страниц суммарно.
     - Пропускай: якорные ссылки (`#`), mailto:, tel:, файлы (`.pdf`, `.jpg`, `.png`, `.zip` и т.д.).
2. Между запросами делай паузу `REQUEST_DELAY_MS` мс.
3. Итог: массив уникальных URL для этого конкурента.

Инструмент: `src/crawler.ts` → `crawl(competitor): Promise<string[]>`

---

### Шаг 2 — Извлечение метаданных каждой страницы

Для каждого URL из шага 1 загрузи страницу и извлеки поля из `competitor.track`:

| Поле | Что брать |
|---|---|
| `title` | Текст тега `<title>` |
| `description` | Содержимое `<meta name="description" content="...">` |
| `h1` | Текст **первого** `<h1>` на странице |
| `url` | Нормализованный URL (без trailing slash, lowercase схема+хост) |
| `scannedAt` | ISO-строка текущего времени |

Если поле отсутствует — пиши `""`. Поля не из `competitor.track` — пиши `""` и не включай в diff.
При HTTP-ошибке или таймауте — логируй предупреждение, пропускай страницу, продолжай.

Инструмент: `src/parser.ts` → `parsePage(url, track): Promise<PageMeta>`

---

### Шаг 3 — Загрузка предыдущего снэпшота

Читай файл `data/snapshots/{competitor.id}.json`.

- Файл существует → парси как `PageMeta[]`.
- Файла нет (первый запуск для этого конкурента) → считай снэпшот пустым `[]`, запомни что это инициализация.
- Файл есть, но невалидный JSON → логируй ошибку, **пропусти этого конкурента** (не перезаписывай битый снэпшот), продолжай со следующим.

---

### Шаг 4 — Сравнение (diff)

Сравни текущий скан с предыдущим снэпшотом. Ключ — `url`.
Учитывай только поля из `competitor.track`.

```
newPages       — URL есть в текущем, нет в предыдущем
removedPages   — URL есть в предыдущем, нет в текущем
changedTitle   — изменился title (только если "title" в track)
changedH1      — изменился h1 (только если "h1" в track)
changedDesc    — изменилось description (только если "description" в track)
```

Инструмент: `src/diff.ts` → `diff(prev, curr, track): DiffResult`

---

### Шаг 5 — Сохранение снэпшота

Запиши текущий скан в `data/snapshots/{competitor.id}.json` (JSON, 2 пробела).
Перед записью создай резервную копию `data/snapshots/{competitor.id}.prev.json`.

Сохраняй снэпшот **всегда** — даже если нет изменений, даже при первом запуске.

---

### Шаг 6 — Накопление результатов

Добавь результат этого конкурента в общий массив `allResults`:

```typescript
allResults.push({
  competitor,         // объект из competitors.json
  diff,               // DiffResult
  totalPages,         // сколько страниц просканировано
  duration,           // секунд потрачено
  isFirstRun,         // true если снэпшота не было
  error,              // null или строка с ошибкой если конкурент был пропущен
})
```

Переходи к следующему конкуренту.

---

### Шаг 7 — Сводный отчёт

После обработки всех конкурентов сформируй и отправь **один сводный отчёт**.

#### Формат отчёта (Markdown)

```
📊 Еженедельный мониторинг конкурентов — {DD Month YYYY}

━━━━━━━━━━━━━━━━━━━━━━━━
🏢 {competitor.name}  ({hostname})
━━━━━━━━━━━━━━━━━━━━━━━━

🆕 НОВЫЕ СТРАНИЦЫ ({count})
• {url} — "{title}" | H1: "{h1}"
  ...

🗑️ УДАЛЁННЫЕ СТРАНИЦЫ ({count})
• {url} — последний title: "{title}"
  ...

✏️ ИЗМЕНЕНИЯ TITLE ({count})
• {url}
  Было:  "{old}"
  Стало: "{new}"
  ...

✏️ ИЗМЕНЕНИЯ H1 ({count})
• {url}
  Было:  "{old}"
  Стало: "{new}"
  ...

✏️ ИЗМЕНЕНИЯ DESCRIPTION ({count})
• {url}
  Было:  "{old}"
  Стало: "{new}"
  ...

Просканировано: {totalPages} стр. за {duration} сек.

━━━━━━━━━━━━━━━━━━━━━━━━
🏢 {следующий конкурент}
...

━━━━━━━━━━━━━━━━━━━━━━━━
📋 ИТОГО
• Конкурентов обработано: {N}
• Суммарно страниц: {total}
• Конкурентов с изменениями: {M}
• Ошибок при сканировании: {errors}
```

Правила формирования:

- Если у конкурента нет изменений — пиши только имя и строку `✅ Изменений нет ({totalPages} стр.)`.
- Если конкурент был на первом запуске — пиши `🔍 Первый скан: снэпшот сохранён ({totalPages} стр.), отчёт со следующей недели.`
- Если конкурент был пропущен из-за ошибки — пиши `⚠️ Ошибка: {error}`.
- Если `description` пустая — пиши `(нет описания)`.
- Каждый раздел ограничен **20 записями**. Если больше — добавь `... и ещё {N}`.
- Разделители `━━━` между конкурентами для читаемости.

#### Отправка

В зависимости от `NOTIFY_CHANNEL`:

- **telegram** — `sendMessage`, `parse_mode=Markdown`. Если текст > 4096 символов — разбей по конкурентам: отдельное сообщение на каждого, у кого есть изменения, затем итоговое сообщение.
- **slack** — POST на `SLACK_WEBHOOK_URL` с `{"text": "..."}`.
- **email** — Subject: `[Competitor Monitor] Еженедельный отчёт {дата}`. Body: HTML.

При ошибке отправки — ещё 2 попытки с паузой 30 секунд.

**Не отправляй отчёт**, если все конкуренты либо на первом запуске, либо без изменений — тихий выход.

Инструменты: `src/report.ts`, `src/notify.ts`

---

### Шаг 8 — Git-коммит и завершение

Закоммить и запушить все изменённые снэпшоты:

```bash
git add data/snapshots/
git commit -m "chore: weekly snapshot $(date +%Y-%m-%d)"
git push
```

Если нечего коммитить — пропусти без ошибки.

Выведи в stdout итоговую строку:

```
[competitor-monitor] {дата} — {N} конкурентов, {total} страниц, {M} с изменениями, отчёт → {channel}.
```

Или при отсутствии изменений:

```
[competitor-monitor] {дата} — {N} конкурентов, {total} страниц, изменений нет. Тихий выход.
```

---

## Структура файлов проекта

```
competitor-monitor/
├── CLAUDE.md                     ← этот файл
├── competitors.json              ← список конкурентов (редактировать здесь)
├── .env                          ← секреты (не коммитить, добавить в .gitignore)
├── package.json
├── tsconfig.json
├── data/
│   └── snapshots/
│       ├── competitor-a.json     ← снэпшот конкурента A
│       ├── competitor-a.prev.json
│       ├── competitor-b.json
│       ├── competitor-b.prev.json
│       └── ...
└── src/
    ├── index.ts                  ← точка входа: читает competitors.json, запускает шаги 1–8
    ├── crawler.ts                ← шаг 1: сбор URL
    ├── parser.ts                 ← шаг 2: извлечение метаданных
    ├── diff.ts                   ← шаг 4: сравнение снэпшотов
    ├── report.ts                 ← шаг 7: форматирование сводного отчёта
    ├── notify.ts                 ← шаг 7: отправка
    └── types.ts                  ← общие типы
```

---

## Типы данных (справка)

```typescript
// types.ts

export type TrackField = 'title' | 'h1' | 'description';

export interface Competitor {
  id: string;
  name: string;
  url: string;
  maxPages?: number;   // default 300
  maxDepth?: number;   // default 3
  track?: TrackField[]; // default ['title', 'h1', 'description']
}

export interface PageMeta {
  url: string;
  title: string;
  description: string;
  h1: string;
  scannedAt: string; // ISO 8601
}

export interface PageChange {
  url: string;
  old: string;
  new: string;
}

export interface DiffResult {
  newPages: PageMeta[];
  removedPages: PageMeta[];
  changedTitle: PageChange[];
  changedH1: PageChange[];
  changedDesc: PageChange[];
  hasChanges: boolean;
}

export interface CompetitorResult {
  competitor: Competitor;
  diff: DiffResult | null;
  totalPages: number;
  duration: number;       // секунды
  isFirstRun: boolean;
  error: string | null;
}
```

---

## Правила поведения

- **Не останавливайся** при ошибке одного конкурента — логируй, пропускай, продолжай остальных.
- **Не модифицируй** файлы за пределами `data/snapshots/`.
- **Не открывай** браузер с UI — только headless режим.
- **Не кэшируй** страницы на диск, работай в памяти.
- **Логируй** каждый шаг в stdout: `[competitor-a][step-1] Собрано 143 URL за 12 сек.`
- **При необработанной ошибке** — запиши stacktrace в `data/error.log`, завершись с кодом 1.
- **Добавление нового конкурента** — только через `competitors.json`. Не менять код.

---

## Запуск вручную (для тестирования)

```bash
# Полный прогон всех конкурентов
npx ts-node src/index.ts

# Только один конкурент
ONLY=competitor-a npx ts-node src/index.ts

# Без отправки уведомлений
DRY_RUN=true npx ts-node src/index.ts

# Принудительно отправить отчёт (даже если нет изменений)
FORCE_REPORT=true npx ts-node src/index.ts

# Комбинировать
ONLY=competitor-b DRY_RUN=true npx ts-node src/index.ts
```
