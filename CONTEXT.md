---
project_id: stream
project_type: deliverable
status: implementation
aliases: [stream, лента, личный поток событий, life feed, лента событий]
stack: [node24, typescript, node-sqlite, node-http, javascript-pwa]
updated: 2026-11-11
---

# Stream — личная лента событий с ИИ-обработчиком

## What and why

Одна лента, куда всё падает как есть: голосовые, текст, фото, пересланное из других приложений, позже —
почта, мессенджеры, уведомления и звонки. Обработчик (включая ИИ) сам раскладывает это по задачам, расходам,
заявкам и заметкам, задаёт уточняющие вопросы и готовит действия. Владелец не ведёт списки и отчёты — их
собирает система из ленты.

Основа — **неизменяемый журнал событий**. Над ним пересчитываемые слои: нормализация → интерпретация →
действие. От любой задачи или расхода можно дойти до исходного голосового. Задачи — проекция ленты,
встроенный менеджер задач; Todoist и TickTick — резервные коннекторы.

Пользователь один — владелец. Устройство ввода — телефон на Android.

Замысел, модель, контракты и шаги — в `CONCEPT.md`. Это источник истины.

## Current state

**Шаг 1 работает на https://stream.sekond.pl (2026-11-14), ветка `step1-journal-capture`.** Журнал, API,
PWA с офлайн-очередью и мгновенной синхронизацией между устройствами; экран-чат со строкой меток (П1),
правками поверх журнала (изменить, архив, удалить), связями сообщений, темами, левой панелью тем и
меток-фильтров, выделением и экраном темы (`CONCEPT.md` §5). Разбора и ИИ ещё нет — это шаги 2–3.

Приёмка владельцем на телефоне открыта: `docs/plans/2026-11-11-step1-journal-capture.md`, `deploy/DEPLOY.md`.
Агент сам коммитит, пушит и выкладывает каждую правку (`deploy/DEPLOY.md`, «Выкладка агентом без пароля»).
Решения — в `decisions.md`, контракты — в `contracts/`, параметры ввода и метки — в `registry/`.

Исходная постановка задачи — `attachments/previous-notes.txt` (только локально, не в git).
Полная проработка с источниками — документ «Лента: личный поток событий с ИИ-обработчиком»:
https://claude.ai/artifact/2C1D9sLkW141UWgmN5Zco5

## Related projects

| Project | Relation |
|---|---|
| `../icrm` | Своя CRM. Сейчас не связана с лентой; позже — отдельный коннектор (заявки, оплаты, клиенты), см. `decisions.md` |
| `../naserwis-pl` | Бизнес, ради которого в ленте появляются заявки, оферты, отзывы, проверка после заявки |

## Stack and layout

Node 24 запускает TypeScript без сборки; база — `node:sqlite` (`data/stream.db`); HTTP — `node:http`;
клиент — обычный JavaScript без сборщика. Альтернатива на будущее — Python/FastAPI (`decisions.md`).

| Где | Что |
|---|---|
| `contracts/` | JSON Schema контрактов: event, normalized, interpretation, task, action, intent |
| `registry/` | Данные вместо кода: цели (`intents/`), поля (`fields.yaml`), коннекторы (`connectors.yaml`), словарь меток (`tags.json`), параметры ввода (`capture.json`) |
| `golden/` | Эталонный набор: в git — обезличенные примеры, реальные сообщения — `cases.local.jsonl` (вне git) |
| `docs/plans/` | Планы шагов и пакетов |
| `src/` | Сервер, проверка контрактов и правок, SQLite-хранилище, поток `/api/live`, резервная копия |
| `web/` | PWA-клиент без сборщика: один модуль — одна задача (`composer`, `feed`, `projection`, `bubble`, `actions`, `select`, `drawer`, `topicscreen`, `thread`, `picker`, `tagrow`, `outbox`, `live`, `sw.js`…) |
| `test/` | `node --test`: сервер, контракты, проекция ленты, подсказчик меток, синтаксис всех модулей клиента |
| `data/` | База и медиа (локально, не в git) |

Запуск: `pnpm install`, создать `.env` по `.env.example` (`STREAM_OWNER_TOKEN` — не короче 32 символов),
затем `pnpm start` (http://127.0.0.1:3790). Файлы клиента отдаются по адресу сборки `/v/<build>/`; новый модуль
`web/*.js` нужно добавить в список `VERSIONED` в `src/server/static.ts` (это проверяет тест).
Проверки: `pnpm test`, `pnpm typecheck`.

## Deployment

server: srv-150 (192.168.0.149, WireGuard 10.0.0.1)
server_path: /srv/stream (app, data, backups, .env); пользователь `stream`; compose-проект `stream`
domain: https://stream.sekond.pl (локальный конфиг Cloudflare Tunnel на srv-150)
port: 127.0.0.1:3790
deploy: `sudo bash /srv/stream/app/deploy/install.sh [ref]` — см. `deploy/DEPLOY.md`; агент — `sudo -n` без пароля, только этот скрипт
health_check: https://stream.sekond.pl/healthz
secrets_ref: `/srv/stream/.env` — `STREAM_OWNER_TOKEN`
repo: https://github.com/890su/stream

## Development rules

1. **Исходник неизменяем.** Журнал событий только дополняется. Исправление — новое событие и новая версия
   интерпретации, старая остаётся.
2. **Производное пересчитываемо.** Любой слой выше событий можно удалить и собрать заново. Каждая запись хранит
   имя и версию обработчика и модель.
3. **Четыре точки расширения:** источник, цель, коннектор, автоматизация. Не ложится ни в одну — это
   изменение ядра и запись в `decisions.md`.
4. **Данные вместо кода.** Цели, поля, примеры, пороги, шаблоны — в `registry/`. В конвейере нет условий под
   конкретного клиента, сервис или фразу.
5. **Правило трёх.** Автоматизация пишется после того, как ситуация встретилась в ленте три раза.
6. **Коннектор слеп.** Получает действие по контракту, возвращает результат. Ленту не читает, ИИ не вызывает.
7. **Свои задачи — у себя, внешнее — зеркало.** Задачи — проекция ленты. Внешний менеджер получает копию
   через коннектор, ссылка хранится в действии.
8. **Идемпотентность.** У события и действия есть ключ. Повтор не создаёт дубль и не шлёт второе сообщение.
9. **ИИ за одним интерфейсом:** `interpret(event, context) → Interpretation`. Провайдер меняется настройкой.
10. **Один процесс, одна база.** Без микросервисов, очередей и векторных баз, пока нет измеренной причины.
11. **Эталонный набор.** Любая смена модели или инструкции прогоняется по `golden/`.
12. **Шаг = польза.** Каждый шаг заканчивается тем, чем владелец пользуется завтра. Следующий шаг — после
    недели реального использования предыдущего.
13. **Сначала концепция, потом код.** Меняется замысел — сначала правится `CONCEPT.md`, затем код.
14. **Простая доработка.** Один файл — одна ответственность (ориентир до 300 строк). Новая возможность —
    новым файлом. Поведение покрыто тестами.
15. **Система отдельно от содержания.** В git идут только система, структура и логика: код, контракты,
    схемы, правила, общие словари и обезличенные примеры. Содержание и частности в git не идут: сообщения
    владельца, клиенты и контрагенты, контакты и телефоны, семья, суммы и расходы, эталонные разборы реальных
    сообщений, справочники с настоящими именами. Они живут в данных (`data/`, база на сервере) и в локальных
    файлах вне git (`*.local.*`). Пример в документе или тесте — всегда вымышленный.

## Navigation

| Need | Open |
|---|---|
| Concept, model, steps | `CONCEPT.md` |
| Current tasks | `PLAN.md` |
| Decisions and reasons | `decisions.md` |
| Step 1 plan | `docs/plans/2026-11-11-step1-journal-capture.md` |
| Data contracts | `contracts/*.schema.json` |
| Intents, fields, connectors | `registry/` |
| Reference messages | `golden/` |
| Original request | `attachments/previous-notes.txt` |

## Agent Rules

- Read `CONTEXT.md`, `PLAN.md` and `CONCEPT.md` before starting.
- `CONCEPT.md` is the source of truth; change it first, then code.
- Follow «Development rules» above.
- Contracts in `contracts/` are versioned; a breaking change needs a new version and a `decisions.md` entry.
- Update `PLAN.md` after completed work; durable decisions → `decisions.md`.
- Do not edit `ROADMAP.md` unless explicitly asked.
- User-facing text (UI, questions, summaries): Russian. Code, identifiers, commit messages: English.

## Do not

- Do not store secrets in project files; use `.env` (not committed) and `secrets_ref`.
- Do not add UPDATE/DELETE paths for events.
- Do not hard-code client-, service- or phrase-specific branches in the pipeline — add registry data instead.
- Do not read `.library/`, `node_modules/`, `dist/`, `.git/`, `data/`.
- Do not commit content: real messages, client or contact names, phone numbers, family or money details.
  Only system, structure and logic go to git (rule 15); real data stays in `data/` and `*.local.*` files.
