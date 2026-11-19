# Code map

> Table of contents of the code for agents and maintainers: read this before opening files.
> Update it in the same commit when a file is added, moved, split or changes its job.
> Concept: `CONCEPT.md` (§ refs below). Rule of thumb: one file — one job, up to ~300 lines.

## Data flow in one paragraph

Every input becomes an **event** in an append-only journal (`src/store/store.ts`, SQLite). Sources write events:
the PWA (`/api/events`, outbox on the device), the share target, the Android companion (`/api/phone/*`) and the
Telegram bots (`src/telegram/`). Owner actions are `correction` events; tasks (with roles: owner, executors, controller, author, watchers, counterparty) are `task_change` events; replies to
Telegram (a recipient chosen in the «кому» row) are events with `payload.data.outbound` that create **actions** (`src/store/actions.ts`) executed by the
bots. The **triage** (`src/tasks/triage.ts`) batches new messages per stream after a quiet window and asks the
planner (AI, `src/tasks/anthropic.ts`) to split them into tasks. Everything shown is a **projection** computed on
the device (`web/projection.js`, `web/taskfold.js`, `web/conversations.js`) — centre in three views («Беседы · Задачи · Лента»), filters left, details right; new events reach all devices through SSE (`/api/live`).

## Server — `src/` (Node 24 runs TypeScript directly)

| File | Job | Key exports |
|---|---|---|
| `main.ts` | entry: `.env`, store, HTTP, bots, triage | — |
| `config.ts` | registry files loaded at start | `captureConfig`, `tagConfig`, `telegramConfig`, `tasksConfig`, `conversationsConfig`, `filtersConfig` |
| `ids.ts` | name-based UUIDs (idempotent ids) | `nameId` |
| `backup.ts` | nightly copy of DB and media | — |
| **contracts/** | | |
| `validate.ts` | Event type + JSON Schema interpreter | `JournalEvent`, `validateEvent` |
| `correction.ts` | owner corrections: ops, link targets | `CORRECTION_OPS`, `checkCorrection*` |
| `tagging.ts` / `phone.ts` / `telegram.ts` / `task.ts` | kind-specific payload rules (task: closing report by the registry) | `check*` |
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
| `recipients.ts` | address book of the «кому» row: chats, bot groups, pins, frequency, 24 h window (`/api/recipients`) | `RecipientQueries` |
| `triage.ts` | pending messages, task events, AI spending | `TriageStore` |
| **telegram/** (§8.2) | | |
| `bot.ts` | one account bot: `getUpdates` loop, update handling, sending (personal chats via business connection, groups as the bot), health | `TelegramBot`, `sendError` |
| `convert.ts` | Bot API message → ingest item (files, forwards, service text) | `toItem` |
| `ingest.ts` | item → journal event: ids, authors, replies, edits, deletions, echoes | `ingest`, `markDeleted` |
| **tasks/** (§2.8) | | |
| `planner.ts` | planner interface, output schema, instructions | `Planner`, `PLAN_SCHEMA` |
| `triage.ts` | quiet window per stream (from its last message), batches with earlier messages of the conversation as context, open and recently closed cases (reopened when continued), alternatives when unsure, an outcome for every message (filed = done at once, missed → «Разобрать»), checklist items into a job and its general title (`checklistChange`), budget | `Triage`, `streamOf`, `checklistChange` |
| `anthropic.ts` | AI planner (Claude Haiku 5.5, structured output) | `anthropicPlanner` |
| `fold.ts` | tasks as fold of `task_change` (server side, checklist `items`, `owner_titled`); old tasks get roles from `assignee` | `foldTasks`, `isOpen` |
| `parties.ts` | parties and roles: pattern, author → party, incoming call / SMS → caller, phone number form, default controller (client copy `web/parties.js`) | `isParty`, `partyOf`, `partyOfEvent`, `phoneNumber`, `defaultController` |

## Client — `web/` (plain ES modules, no bundler; new module → `VERSIONED` in `src/server/static.ts` and `web/sw.js`)

| File | Job |
|---|---|
| `index.html` | markup of the single screen, dialogs and panels |
| `styles.css` → `feed.css` → `panels.css` → `screens.css` → `wide.css` | styles, loaded in this order (cascade); `wide.css` — three columns from 1100 px |
| `layout.js` | the wide-screen breakpoint the panels follow (docked or sliding) |
| `app.js` | entry: wires everything, message action dispatch, view changes (old saved views map to new), the link window's context |
| `viewswitch.js` | the «Беседы» / «Задачи» button at the right of the input row and its counter (`counterFor`); the view title in the top bar |
| `settings.js` | status line, settings dialog (token, copying it to another device), service worker registration |
| `feed.js` | the centre in three views: Беседы (the list; an open conversation — task plaques + messages in a row), Задачи (task rows by a saved filter), Лента (bursts, chain lines); the open conversation doubles as the contact filter |
| `feedpage.js` | where the centre's messages come from: media files (object URLs) and journal pages (refresh, older history) |
| `tasklist.js` / `days.js` | the «Задачи» view: list chips (`pinned`) and the grouping chip, sections of a list (`sectionsOf`, `listCount`) or groups by tag / person (`groupsOf`), a task row (mark, title, facts with checklist progress, due word — `dueLabel`); day pill labels |
| `checklist.js` | the checklist in task details: tick, add, «Отдельной задачей», «В дело…» (this task as an item of another) |
| `taskquick.js` | acting where a task is seen: the «Готово» mark, swipe right (done) / left («Когда?» due chips), every change with «Вернуть» in the toast (`act`, `done`) |
| `swipe.js` | a horizontal swipe on a list item (task rows, plaques, conversation rows): follow, arm, act; not a tap |
| `convquick.js` | swipes on a «Беседы» row: left — «Отвечено» (`answered` correction), right — its most urgent task or a new one (`pickTask`, `anchorOf`, `sourceOf`) |
| `question.js` | «О каком деле?» under a message: options from the triage's alternatives, the owner's pick moves or confirms |
| `donecard.js` | card «Задача выполнена?» (triage's `proposed: done`): «Да, готово» closes in one tap, «Ещё нет»; «Заполнить отчёт» on a closed task fills the missing fields; pure report parsing |
| `motion.js` | smooth show / hide / fold (grow, shrink, reveal, conceal, play) with a timer fallback |
| `convlist.js` / `convtasks.js` | a row of the «Беседы» list (state label, channels, open tasks) and the «Завершённые · N» fold; task plaques on top of a conversation (the «Готово» mark and swipes, status, executor, due) |
| `projection.js` | pure: events → message views (corrections, delivery), sources, chats, topics |
| `bubble.js` | one message bubble (text, media, meta, task mark) |
| `phonebubble.js` / `tgbubble.js` | call/SMS and Telegram blocks inside a bubble |
| `composer.js` / `draftfiles.js` | input: text, voice, tags, recipient, modes (reply, edit, continue); attachments of the draft (checks, previews) |
| `outbound.js` | pure: Telegram reply data, 24 h window |
| `tagrow.js` / `suggest.js` | tags in the row above the input (`ordered()` for the link window); tag suggestions |
| `linkwindow.js` | the link window of the «связь» button: Метки · Контакты · Беседы · Задачи, likely first (`likelyConversations`, `likelyTasks`), strips and pages, a section on the whole window |
| `linkstate.js` | the conversation or task the next message goes into: its chip, continuation, recipient, adding to the task once sent |
| `recipients.js` | recipients: address book, the chosen one's chip, items and pins for the Контакты section |
| `actions.js` | tap / long press / context menu → action panel and ops |
| `select.js` / `bulk.js` | selection mode; bulk actions on the selection |
| `drawer.js` | left panel (opened by the filter icon; closed by a swipe) — filters by view: contacts (conversations) and tags (shared), «Завершённые» (Беседы, Лента), sources (Лента), saved filters (Задачи) |
| `taskfold.js` | pure: tasks from `task_change` (with history, roles, checklist — `foldItems`, `itemsProgress`, `ownerTitled`), due state, a task's messages (`taskMembers`), the task a message leads to (`taskOfMessage`) |
| `filters.js` | pure: saved task filters (`registry/filters.json`) — `matchesFilter` (fields incl. `snoozed`), `visibleTasks` |
| `conversations.js` | pure: messages → conversations (one per chat or number), state urgent / mine / theirs / quiet / done (an `answered` mark quiets what precedes it), order from the registry; `conversationKeys` (an own note joins the conversation it continues or answers); `withWhom` |
| `details.js` / `taskdetails.js` | right panel «Подробности»: a task (actions and due first, roles folded, «Другой…» typed in place, report, messages, folded history) or a message (versions, tasks) |
| `taskactions.js` | pure: actions a task offers by status (`actionsFor`; «Готово» in every open status), the change of each (`changeFor`, `closeChange` — done at once, report fields to `missing`), its undo (`undoOf`), due chips, delegate and «Жду…» options (callers included) |
| `parties.js` | pure: parties and roles (mirror of `src/tasks/parties.ts`) and `partyName` — a party in words for rows, plaques and details |
| `chatview.js` | the bar of an open conversation: title, «назад» to the list (Беседы, also the system back via a history entry) or × (filter elsewhere), reply recipient or else a continuation of the last message, «Не отслеживать» |
| `system.js` | System screen: sources, connections, sends, exclusions |
| `versioncard.js` / `picker.js` | versions of a message (left to right); link picker |
| `shared.js` | builders of entries: message, share, correction, task change, the owner's own task (`ownTask`) |
| `outbox.js` / `sync.js` / `db.js` | device queue, sending, IndexedDB |
| `live.js` | SSE client with reconnect |
| `voice.js` | voice recorder |
| `sw.js` | service worker: shell cache, share target, background sync |

## Data instead of code — `registry/`, `contracts/`

| File | What |
|---|---|
| `contracts/event.schema.json` | Event v1 (kinds, payload.data: call, sms, telegram, outbound, action, system, task (+ proposed, report, alternatives), tagging, continuation) |
| `contracts/*.schema.json` | Action, Task, Interpretation, Normalized, Intent |
| `registry/capture.json` | input limits, MIME types, page sizes |
| `registry/tags.json` | tag dictionary and suggestion threshold |
| `registry/telegram.json` | Telegram accounts, file limit, reply window, address book (frequency days, row size) |
| `registry/tasks.json` | triage: quiet window (default and per stream kind), AI model and budget, task templates (`filed` — file and close), fallback «Разобрать», closing reports (`report_fields`, per-template `report`, currencies) |
| `registry/conversations.json` | conversations: quiet days, urgent tags, order of states |
| `registry/filters.json` | saved task filters: conditions over roles, status, due, report, `snoozed`; `pinned` chips, `sections`; first («Сегодня») is the default |
| `registry/connectors.yaml`, `intents/`, `fields.yaml` | connectors, intents, fields (for step 3) |

## Elsewhere

| Path | What |
|---|---|
| `android/` | «Stream · телефон» (Kotlin): call log and SMS sync, after-call note (§8.1, `deploy/PHONE.md`) |
| `deploy/` | Dockerfile, compose, `install.sh` (agent deploys with `sudo -n`), guides `DEPLOY.md`, `PHONE.md`, `TELEGRAM.md` |
| `test/` | `node --test`: one file per area (api, phone, telegram-bot, triage, taskfold, projection, …) |
| `golden/` | reference messages (real ones only in `*.local.*`, outside git) |
| `docs/plans/` | active package plans; `archive/` (local, outside git) — done plans, superseded decisions, old Done items |
