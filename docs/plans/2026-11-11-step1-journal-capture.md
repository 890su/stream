---
project_id: stream
step: 1
status: owner-checks-pending
blocked_by: []
updated: 2026-11-11
---

# Шаг 1 — Журнал и быстрый ввод

> Код готов 2026-11-11. Выкладка, визуальная проверка и проверки владельца на телефоне остаются открытыми.
> Стек, сервер и связь с iCRM решены 2026-11-11 (`decisions.md`). Если когда-нибудь стек
> сменится на Python/FastAPI, меняется только раздел «Стек и файлы»; данные, API, клиент и тесты остаются.

## Цель

С телефона голос, текст, фото и «Поделиться» попадают в журнал событий. Ничего не теряется: без сети запись
ждёт в очереди и уходит позже, повторная отправка не создаёт дубль. Простая хронология последних событий,
чтобы видеть, что всё дошло.

Никакого ИИ, расшифровки, тем и задач — это шаги 2–5.

## Готово, когда (проверяет владелец)

Автоматические проверки реализации находятся в `test/`. Комплект systemd, ночная копия и инструкция —
в `deploy/`. Браузерный хост среды недоступен, визуальная проверка остаётся открытой.

- [ ] Приложение установлено на рабочий стол Android и открывается по HTTPS.
- [ ] Ярлык «Голос» открывает запись сразу; от разблокировки до записи — не больше двух касаний.
- [ ] «Поделиться» из галереи, WhatsApp, браузера кладёт картинку, текст или ссылку в ленту.
- [ ] В режиме полёта записал голосовое и текст → включил сеть → оба в ленте, без дублей.
- [ ] Неделя ежедневного использования без потерь.

## Данные

Одна база SQLite: `data/stream.db`. Медиа — файлы в `data/media/`.

```sql
CREATE TABLE events (
  id              TEXT PRIMARY KEY,          -- uuid, created on the phone
  schema_version  INTEGER NOT NULL,
  source          TEXT NOT NULL,
  author          TEXT NOT NULL,
  ts              TEXT NOT NULL,             -- client time, ISO 8601
  received_at     TEXT NOT NULL,             -- server time, ISO 8601
  kind            TEXT NOT NULL,
  payload         TEXT NOT NULL,             -- JSON
  reply_to        TEXT,
  topic_hint      TEXT,
  body_hash       TEXT NOT NULL              -- sha256 of canonical JSON, for idempotency checks
);
CREATE INDEX events_received ON events(received_at);

-- append-only, enforced by the database itself
CREATE TRIGGER events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;

CREATE TABLE media (
  id          TEXT PRIMARY KEY,              -- sha256 of file content
  mime        TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  path        TEXT NOT NULL,                 -- relative to data/media/
  created_at  TEXT NOT NULL
);
```

Медиа адресуются по sha256 содержимого: повторная загрузка того же файла — тот же id, ничего не дублируется.

## API

| Метод | Путь | Что делает |
|---|---|---|
| `PUT` | `/api/media/:sha256` | Загрузка файла. Проверяет хеш. Уже есть → 200 без записи |
| `GET` | `/api/media/:sha256` | Отдаёт файл |
| `POST` | `/api/events` | Событие по `contracts/event.schema.json`. Новый id → 201. Тот же id и тот же `body_hash` → 200 (повтор). Тот же id, другое тело → 409 |
| `GET` | `/api/events?before=<received_at>&limit=50` | Хронология, новые сверху |
| `POST` | `/share-target` | Приём из «Поделиться» (multipart), если сервис-воркер не перехватил: медиа + событие `source=share`, редирект на `/` |
| `GET` | `/healthz` | Проверка живости |

Правила:
- Всё, что касается базы, — только в модуле хранилища (`src/store/`). Нигде нет UPDATE/DELETE для `events`.
- Событие с `payload.media[]` принимается, только если все медиа уже загружены (иначе 422 — клиент сначала
  грузит файлы).
- Доступ: один владелец. Длинный токен из `.env` (`STREAM_OWNER_TOKEN`), передаётся заголовком
  `Authorization: Bearer`; на телефон вводится один раз и хранится в IndexedDB. Секреты не в репозитории.

## Клиент (PWA)

- **`manifest.json`**: `display: standalone`; `shortcuts` — «Голос» (`/?mode=voice`), «Текст», «Фото»;
  `share_target` — `POST /share-target`, `multipart/form-data`, поля `title`, `text`, `url`, `files`
  (image/*, audio/*, application/pdf).
- **Сервис-воркер**: кеширует оболочку приложения; перехватывает `POST /share-target` и кладёт данные в
  очередь, чтобы «Поделиться» работало и без сети.
- **Один экран-чат** (решение 2026-11-11, `CONCEPT.md` §5): лента сообщений сверху, строка ввода снизу.
  Слева от строки — кнопка меток (быстрый набор из `registry/capture.json` → `payload.tags`), справа —
  скрепка (камера, галерея, файл) и кнопка голоса (MediaRecorder, `audio/webm;codecs=opus`; нажать — запись,
  удерживать и отпустить — отправить). При тексте или вложении кнопка голоса становится «Отправить».
  Отправка — мгновенно в очередь.
- **Очередь (outbox)** в IndexedDB: событие + файлы. `id = crypto.randomUUID()` в момент создания.
  Синхронизация при `online`, при возврате в приложение и по таймеру с нарастающей паузой. Порядок: сначала
  медиа (`PUT`), потом событие (`POST`). 200 и 201 — удалить из очереди; 409 — показать ошибку, не удалять.
- **Лента**: пузыри сообщений, новые внизу, разделители дат; у каждого время и статус («в очереди» / «принято» /
  ошибка); голос проигрывается, фото показывается в пузыре, более старые подгружаются при прокрутке вверх.
- Интерфейс на русском.

## Стек и файлы

Решение — `decisions.md`, 2026-11-11.
Как в iCRM: Node 24 запускает TypeScript без сборки, `node:sqlite`, `node:http`, клиент — обычный JavaScript
без фреймворка и сборщика. Зависимости для работы — ноль; для разработки — `typescript` для проверки типов.

| Файл | Ответственность |
|---|---|
| `src/main.ts` | запуск сервера, чтение `.env` |
| `src/store/schema.sql` | схема из раздела «Данные» |
| `src/store/store.ts` | единственное место, знающее о базе: `appendEvent`, `listEvents`, `putMedia`, `getMedia` |
| `src/contracts/validate.ts` | проверка события по `contracts/event.schema.json` (v1) |
| `src/server/http.ts` | маршрутизация, токен, раздача `web/` |
| `src/server/events.ts` | `/api/events` |
| `src/server/media.ts` | `/api/media` |
| `src/server/share.ts` | `/share-target` |
| `web/index.html`, `web/app.js` | рамка и переключение экранов |
| `web/capture.js` | запись голоса, текст, фото |
| `web/outbox.js` | очередь в IndexedDB и синхронизация |
| `web/feed.js` | хронология |
| `web/sw.js`, `web/manifest.json` | PWA, ярлыки, «Поделиться» |
| `test/*.test.ts` | тесты (`node --test`) |

Команды: `pnpm start`, `pnpm test`, `pnpm typecheck` — как в iCRM.

## Тесты

- Журнал: UPDATE и DELETE по `events` падают на уровне базы.
- `POST /api/events`: новый id → 201; повтор того же тела → 200 и одна строка в базе; тот же id с другим
  телом → 409.
- Валидация: неизвестный `kind`, отсутствующий `ts`, лишнее поле → 400 с понятной ошибкой.
- Медиа: неверный хеш → 400; повторная загрузка → 200, файл один.
- Событие со ссылкой на незагруженное медиа → 422.
- Хронология: порядок по `received_at` убыванию, пагинация `before` без пропусков и повторов.
- Без токена → 401.

## Развёртывание

Решение — `decisions.md`, 2026-11-11 «Сервер и HTTPS».

- Разработка: `pnpm start` на ПК, `http://127.0.0.1:3790`. Для проверки на телефоне до развёртывания —
  временный `cloudflared tunnel --url http://127.0.0.1:3790` (даёт HTTPS-адрес на время сессии).
- Рабочий сервер: srv-150, каталог `~/services/stream` (`git clone` из GitHub, вне зеркала Google Drive),
  порт только на `127.0.0.1:3790`, наружу — существующий Cloudflare Tunnel, `https://stream.sekond.pl`.
- Настройки — `.env` на сервере (не в git): `STREAM_OWNER_TOKEN`, `PORT`, `DATA_DIR`. В репозитории —
  `.env.example` без значений.
- Данные: `DATA_DIR` (по умолчанию `data/`): `stream.db` и `media/`. Ночная копия базы
  (`sqlite3 .backup` или `VACUUM INTO`) и медиа.
- Файлы шага: `deploy/DEPLOY.md` (по шаблону `00_system/standards/project-template/deploy/DEPLOY.md`),
  `deploy/docker-compose.yml` или `deploy/stream.service` — что проще поддерживать на srv-150.
- `GET /healthz` — проверка после выкладки.

## Не входит

Расшифровка и OCR, ИИ, темы, задачи, напоминания, нативная оболочка, несколько пользователей.
