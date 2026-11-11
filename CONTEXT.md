---
project_id: stream
project_type: deliverable
status: concept
aliases: [stream, лента, личный поток событий, life feed, лента событий]
stack: [tbd]
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

**Шаг 1 начат (2026-11-11).** Решены стек, сервер и связь с iCRM (`decisions.md`). Контракты — в
`contracts/`, стартовые цели — в `registry/`. План шага 1 — `docs/plans/2026-11-11-step1-journal-capture.md`.

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
| `registry/` | Данные вместо кода: цели (`intents/`), словарь полей (`fields.yaml`), коннекторы (`connectors.yaml`) |
| `golden/` | Эталонный набор реальных сообщений с правильным разбором |
| `docs/plans/` | Планы шагов |
| `src/` | Сервер (появится на шаге 1) |
| `web/` | PWA-клиент (появится на шаге 1) |
| `data/` | База и медиа (локально, не в git) |

Запуск: `pnpm install`, `pnpm start` (http://127.0.0.1:3790), `pnpm test`, `pnpm typecheck` — появятся на шаге 1.

## Deployment

server: srv-150
server_path: ~/services/stream (git clone, вне зеркала Google Drive)
domain: stream.sekond.pl (Cloudflare Tunnel)
port: 127.0.0.1:3790
health_check: https://stream.sekond.pl/healthz
secrets_ref: `.env` на сервере — `STREAM_OWNER_TOKEN`
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
