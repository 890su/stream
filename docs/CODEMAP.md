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
| `triage.ts` | quiet window per stream (from its last message), batches with earlier messages of the conversation as context, open and recently closed cases (reopened when continued), alternatives when unsure, an outcome for every message (filed = done at once, missed → «Разобрать»), checklist items into a job and its general title (`checklistChange`), the project and section of a task (`projectChange`: the planner's, else the source default, else options), budget | `Triage`, `streamOf`, `checklistChange`, `projectChange` |
| `anthropic.ts` | AI planner (Claude Haiku 5.5, structured output) and the namer of hand-made tasks | `anthropicPlanner`, `anthropicNamer` |
| `namer.ts` | titles «Контрагент: суть» (`TITLE_RULE`, shared with the planner); tasks the owner made by hand are named once by AI after 10 s unless he named them | `nameTasks`, `unnamed`, `TITLE_RULE` |
| `messages.ts` | a journal message as the AI reads it: text after edits, a call or file in words, who it is from | `describe`, `from` |
| `fold.ts` | tasks as fold of `task_change` (server side, checklist `items`, `owner_titled`); old tasks get roles from `assignee` | `foldTasks`, `isOpen` |
| `projects.ts` | projects as fold of `project_change` (server side), the default project of a stream (`defaultProject`, by `sources`) | `foldProjects`, `defaultProject` |
| **contacts/** (P7) | | |
| `fold.ts` | people and counterparties as folds of `contact_change` / `counterparty_change`; points `tel:` / `tg:` | `foldPeople`, `foldCounterparties`, `personOf`, `peopleOf` |
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
| `tasklist.js` / `days.js` | the «Задачи» view: the head of a list opened from the left panel («← Пульт», name, grouping — `listHead`), sections of a list (`sectionsOf`, `listCount`) or groups by tag / person (`groupsOf`), a task row (mark, title, facts with checklist progress, due word — `dueLabel`); day pill labels |
| `taskview.js` | the «Задачи» centre by the view: the pulse of its tasks, one project by its sections, or a list by dates / tags / people (`taskViewNodes`) |
| `viewstate.js` | pure: the view of «Задачи» — when (`WHEN`) · whose (`WHOSE`) · where (project, counterparty, person); `applyView`, `countsFor`, `viewTitle`, `dueGroups` |
| `viewstore.js` | the view kept on the device: current view, «Мои виды», panel layout; listeners redraw (`viewStore`, `LAYOUTS`) |
| `viewpanel.js` | the left panel of «Задачи»: three layouts over one view — «Оси», «Списки» (TickTick), «Дерево» (Things) — and the gear ⚙ at the bottom |
| `pulse.js` / `pulseview.js` | the pulse — the default of «Задачи»: pure blocks (`pulseBlocks`: in work, paused, hot incl. conversations waiting for me, today, watch with alerts, projects, later), `importance`, `projectHealth`, `pulseCount`; and its DOM (`pulseNodes`) |
| `focus.js` | pure: one task of mine in work (`inWork`, `isMineToDo`), «▶ В работу» / «Пауза» changes with `resume_note` (`startWork`, `pauseWork`, `resumeNoteOf`), `workedMinutes` from the status history |
| `contacts.js` | pure: the directory (mirror of `src/contacts/fold.ts`), `markCounterparties` (titles for rows) |
| `counterpartyline.js` | «Контрагент» / «Кто контрагент?» in task details: options, «+ Создать» by the hint, «+ Новый» (organization or address, side), linking the author with a job title |
| `personcard.js` / `counterpartycard.js` | the directory's cards in the right panel: fields edited in place, job titles, open tasks; side and archive of a counterparty |
| `projects.js` | pure: projects from `project_change` (`foldProjects`), tree with counts, scope, sections of a project, next actions (`markNext` sets `task.next`, `task.projectTitle`) |
| `projectview.js` / `projectpanel.js` | one project's header (kind, status, «Нет следующего шага», «Изменить») and section heads with «+»; the project tree in the left panel and «Проект» in task details |
| `checklist.js` | the checklist in task details: tick, add, «Отдельной задачей», «В дело…» (this task as an item of another) |
| `taskbar.js` | one action bar for a task: ✓ Готово · ▶ В работу · 🕒 Когда · 👤 Поручить · 💬 Ответить · ⋯ Ещё with a second level (`barActions`, `moreActions`, `actionBar`, `personForm`) |
| `tasksheet.js` | the sheet a long press (right click) on a task row opens: title + action bar; `barContext` for the card too |
| `participants.js` | «Участники» tab of the task card: tiles 👤 · role · name · × in a cloud of up to four rows (more — sideways), the icon picks the role, the name switches the participant off (`muted`), «+» adds a plain participant (`roles.members`), the counterparty as a tile; `participants`, `toggleRole`, `removeParticipant`, `toggleMuted` |
| `taskcard.js` | the top of the task card (`headline`, `nextStep`, `contactLinks` — call and map), folding sections (`section`) and the card's tabs Переписка · Участники · Подробности · Лог (`cardTabs`, remembered on the device) |
| `taskquick.js` | acting where a task is seen: the «Готово» mark, swipe right (done) / left («Когда?» due chips), every change with «Вернуть» in the toast (`act`, `done`); «▶ В работу» / «Пауза» of the pulse (`start`, `pause` — several tasks, one «Вернуть») |
| `swipe.js` | a horizontal swipe on a list item (task rows, plaques, conversation rows), only from the middle column: follow, arm, act; not a tap |
| `peoplerow.js` | the participants line of an open conversation over the tags: the card's tiles in one sideways line, the conversation's task edited (`conversationTask`), read-only without a task (`chatParties`) |
| `swipezones.js` | screen swipes by columns 25 / 50 / 25: tabs Беседы · Задачи, the left panel before them, the right one after; in the right panel — the card's tabs, close before the first (`zoneOf`, `swipeAction`) |
| `convquick.js` | swipes on a «Беседы» row: left — to the archive (`answered` correction), right — its most urgent task or a new one (`pickTask`, `anchorOf`, `sourceOf`) |
| `question.js` | «О каком деле?» under a message: options from the triage's alternatives, the owner's pick moves or confirms |
| `donecard.js` | card «Задача выполнена?» (triage's `proposed: done`): «Да, готово» closes in one tap, «Ещё нет»; «Заполнить отчёт» on a closed task fills the missing fields; pure report parsing |
| `backclose.js` | the system back closes what is open on top (link window, attach menu, message actions, dialogs) instead of leaving the app: history entries per window (`createBackStack`, `watchDialogs`) |
| `holdrender.js` | redraws of the left panel, details and centre wait while an input or a list of choices there is in use (`holdRender`, `holding`) |
| `motion.js` | smooth show / hide / fold (grow, shrink, reveal, conceal, play) with a timer fallback |
| `convlist.js` / `convtasks.js` | a row of the «Беседы» list (state label, channels, open tasks) and the «Завершённые · N» / «Архив · N» folds (`foldRow`); task plaques on top of a conversation (the «Готово» mark and swipes, status, executor, due) |
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
| `conversations.js` | pure: messages → conversations (one per chat or number), state urgent / mine / theirs / quiet / done (an `answered` mark archives the conversation until a newer message — `isArchived`), order from the registry; `conversationKeys` (an own note joins the conversation it continues or answers; else a note in a task of its own → `task:<id>`; a split message and its chain → `split:<id>`); `withWhom` |
| `details.js` / `taskdetails.js` | right panel «Подробности»: a task (actions and due first, roles folded, «Другой…» typed in place, report, messages, folded history) or a message (versions, tasks) |
| `taskactions.js` | pure: actions a task offers by status (`actionsFor`; «Готово» in every open status), the change of each (`changeFor`, `closeChange` — done at once, report fields to `missing`), its undo (`undoOf`), due chips, delegate and «Жду…» options (callers included) |
| `parties.js` | pure: parties and roles (mirror of `src/tasks/parties.ts`) and `partyName` — a party in words for rows, plaques and details |
| `chatview.js` | the bar of an open conversation: title, «назад» to the list (Беседы, also the system back via a history entry) or × (filter elsewhere), reply recipient or else a continuation of the last message, «+ Задача» (a task for the conversation), «Не отслеживать» |
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
| `registry/filters.json` | saved task filters: conditions over roles, status, due, report, `snoozed`; `pinned` chips, `sections`; first («Пульт», `view: 'pulse'`) is the default |
| `registry/pulse.json` | the pulse: rows per block, `hot_wait_hours`, `watch_alert_days`, `stale_days`, `paused_remind_hours`, money templates, importance weights |
| `registry/connectors.yaml`, `intents/`, `fields.yaml` | connectors, intents, fields (for step 3) |

## Elsewhere

| Path | What |
|---|---|
| `android/` | «Stream · телефон» (Kotlin): call log and SMS sync, after-call note (§8.1, `deploy/PHONE.md`) |
| `deploy/` | Dockerfile, compose, `install.sh` (agent deploys with `sudo -n`), guides `DEPLOY.md`, `PHONE.md`, `TELEGRAM.md`, `DESKTOP.md` |
| `deploy/desktop/` | agent desktop on srv-150 (Openbox, noVNC, Viber): image, compose, `viber-send` (scripted send with an OCR check of the chat), `notify-log` (desktop notifications → JSON lines) |
| `test/` | `node --test`: one file per area (api, phone, telegram-bot, triage, taskfold, projection, …) |
| `golden/` | reference messages (real ones only in `*.local.*`, outside git) |
| `docs/plans/` | active package plans; `archive/` (local, outside git) — done plans, superseded decisions, old Done items |
