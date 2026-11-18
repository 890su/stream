# Code map

> Table of contents of the code for agents and maintainers: read this before opening files.
> Update it in the same commit when a file is added, moved, split or changes its job.
> Concept: `CONCEPT.md` (§ refs below). Rule of thumb: one file — one job, up to ~300 lines.

## Data flow in one paragraph

Every input becomes an **event** in an append-only journal (`src/store/store.ts`, SQLite). Sources write events:
the PWA (`/api/events`, outbox on the device), the share target, the Android companion (`/api/phone/*`) and the
Telegram bots (`src/telegram/`). Owner actions are `correction` events; tasks are `task_change` events; replies to
Telegram are events with `payload.data.outbound` that create **actions** (`src/store/actions.ts`) executed by the
bots. The **triage** (`src/tasks/triage.ts`) batches new messages per stream after a quiet window and asks the
planner (AI, `src/tasks/anthropic.ts`) to split them into tasks. Everything shown is a **projection** computed on
the device (`web/projection.js`, `web/taskfold.js`); new events reach all devices through SSE (`/api/live`).

## Server — `src/` (Node 24 runs TypeScript directly)

| File | Job | Key exports |
|---|---|---|
| `main.ts` | entry: `.env`, store, HTTP, bots, triage | — |
| `config.ts` | registry files loaded at start | `captureConfig`, `tagConfig`, `telegramConfig`, `tasksConfig` |
| `ids.ts` | name-based UUIDs (idempotent ids) | `nameId` |
| `backup.ts` | nightly copy of DB and media | — |
| **contracts/** | | |
| `validate.ts` | Event type + JSON Schema interpreter | `JournalEvent`, `validateEvent` |
| `correction.ts` | owner corrections: ops, link targets | `CORRECTION_OPS`, `checkCorrection*` |
| `tagging.ts` / `phone.ts` / `telegram.ts` / `task.ts` | kind-specific payload rules | `check*` |
| **server/** | | |
| `http.ts` | auth, routing, starts bots and triage | `createApp` |
| `events.ts` | `/api/events` POST/GET | `events` |
| `media.ts` | `/api/media/<sha256>` | `media` |
| `share.ts` | Android share target | `share` |
| `phone.ts` | `/api/phone/*` calls, SMS, notes (§8.1) | `phone`, `phoneEventId` |
| `system.ts` | `/api/system`, retries, trust; state notes | `system`, `stateChanged`, `actionChanged`, `watchSilence` |
| `live.ts` | SSE `/api/live` | `LiveFeed` |
| `static.ts` | versioned client files `/v/<build>/` | `VERSIONED`, `staticFile` |
| `body.ts`, `errors.ts` | request body, JSON reply, `HttpError` | |
| **store/** | | |
| `store.ts` | events (append-only), media, derived stores | `JournalStore` |
| `schema.sql` | tables: events, media, actions, source_status, tg_*, triaged, ai_usage | |
| `actions.ts` | outbound actions: create from event, take, finish, retry | `ActionStore` |
| `status.ts` | pulse / state of sources (System screen) | `StatusStore` |
| `telegram.ts` | exclusions, forward origin, albums, 24 h window | `TelegramQueries` |
| `connections.ts` | bot connections, owner trust, groups | `ConnectionStore` |
| `triage.ts` | pending messages, task events, AI spending | `TriageStore` |
| **telegram/** (§8.2) | | |
| `bot.ts` | one account bot: `getUpdates` loop, update handling, sending replies, health | `TelegramBot`, `sendError` |
| `convert.ts` | Bot API message → ingest item (files, forwards, service text) | `toItem` |
| `ingest.ts` | item → journal event: ids, authors, replies, edits, deletions, echoes | `ingest`, `markDeleted` |
| **tasks/** (§2.8) | | |
| `planner.ts` | planner interface, output schema, instructions | `Planner`, `PLAN_SCHEMA` |
| `triage.ts` | quiet window per stream (from its last message), batches with earlier messages of the conversation as context, an outcome for every message (filed = done at once, missed → «Разобрать»), budget | `Triage`, `streamOf` |
| `anthropic.ts` | AI planner (Claude Haiku 5.5, structured output) | `anthropicPlanner` |
| `fold.ts` | tasks as fold of `task_change` (server side) | `foldTasks`, `isOpen` |

## Client — `web/` (plain ES modules, no bundler; new module → `VERSIONED` in `src/server/static.ts` and `web/sw.js`)

| File | Job |
|---|---|
| `index.html` | markup of the single screen, dialogs and panels |
| `styles.css` → `feed.css` → `panels.css` → `screens.css` | styles, loaded in this order (cascade) |
| `app.js` | entry: wires everything, message action dispatch |
| `settings.js` | status line, settings dialog, service worker registration |
| `feed.js` | renders the feed: bursts, topic lines, day pills, filters, folded finished tasks, paging |
| `projection.js` | pure: events → message views (corrections, delivery), sources, chats, topics |
| `bubble.js` | one message bubble (text, media, meta, task mark) |
| `phonebubble.js` / `tgbubble.js` | call/SMS and Telegram blocks inside a bubble |
| `composer.js` | input: text, voice, files, tags, modes (reply, edit, continue, → Telegram) |
| `outbound.js` | pure: Telegram reply data, 24 h window |
| `tagrow.js` / `suggest.js` | tag row above the input; tag suggestions |
| `actions.js` | tap / long press / context menu → action panel and ops |
| `select.js` / `bulk.js` | selection mode; bulk actions on the selection |
| `drawer.js` | left panel: topics, sources, «Завершённые», tags |
| `taskfold.js` | pure: tasks from `task_change`, filters, done stages |
| `taskpanel.js` | right panel «Задачи»: list, filters, task card |
| `chatview.js` | one messenger chat in the feed, «Не отслеживать» |
| `system.js` | System screen: sources, connections, sends, exclusions |
| `topicscreen.js` / `thread.js` / `picker.js` | topic screen; history window; link picker |
| `shared.js` | builders of entries: message, share, correction, task change |
| `outbox.js` / `sync.js` / `db.js` | device queue, sending, IndexedDB |
| `live.js` | SSE client with reconnect |
| `voice.js` | voice recorder |
| `sw.js` | service worker: shell cache, share target, background sync |

## Data instead of code — `registry/`, `contracts/`

| File | What |
|---|---|
| `contracts/event.schema.json` | Event v1 (kinds, payload.data: call, sms, telegram, outbound, action, system, task, tagging, continuation) |
| `contracts/*.schema.json` | Action, Task, Interpretation, Normalized, Intent |
| `registry/capture.json` | input limits, MIME types, page sizes |
| `registry/tags.json` | tag dictionary and suggestion threshold |
| `registry/telegram.json` | Telegram accounts, file limit, reply window |
| `registry/tasks.json` | triage: quiet window (default and per stream kind), AI model and budget, task templates (`filed` — file and close), fallback «Разобрать», done folding |
| `registry/connectors.yaml`, `intents/`, `fields.yaml` | connectors, intents, fields (for step 3) |

## Elsewhere

| Path | What |
|---|---|
| `android/` | «Stream · телефон» (Kotlin): call log and SMS sync, after-call note (§8.1, `deploy/PHONE.md`) |
| `deploy/` | Dockerfile, compose, `install.sh` (agent deploys with `sudo -n`), guides `DEPLOY.md`, `PHONE.md`, `TELEGRAM.md` |
| `test/` | `node --test`: one file per area (api, phone, telegram-bot, triage, taskfold, projection, …) |
| `golden/` | reference messages (real ones only in `*.local.*`, outside git) |
| `docs/plans/` | active package plans; `docs/archive/` — done plans, superseded decisions, old Done items |
