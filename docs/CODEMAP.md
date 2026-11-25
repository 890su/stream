# Code map

> Table of contents of the code for agents and maintainers: read this before opening files.
> Update it in the same commit when a file is added, moved, split or changes its job.
> Concept: `CONCEPT.md` (§ refs below). Rule of thumb: one file — one job, up to ~300 lines.

## Data flow in one paragraph

Every input becomes an **event** in an append-only journal (`src/store/store.ts`, SQLite). Sources write events:
the PWA (`/api/events`, outbox on the device), the share target, the Android companion (`/api/phone/*`), the
Telegram bots (`src/telegram/`), WhatsApp linked devices (`src/whatsapp/`) and the Viber bridge (`/api/viber/*`). Owner actions are `correction` events; tasks (with roles: owner, executors, controller, author, watchers, counterparty) are `task_change` events; replies to
Telegram (a recipient chosen in the «кому» row) are events with `payload.data.outbound` that create **actions** (`src/store/actions.ts`) executed by the
bots. The **triage** (`src/tasks/triage.ts`) batches new messages per stream after a quiet window and asks the
planner (AI, `src/tasks/anthropic.ts`) to split them into tasks. Everything shown is a **projection** computed on
the device (`web/projection.js`, `web/taskfold.js`, `web/conversations.js`) — centre in three views («Беседы · Задачи · Лента»), filters left, details right; new events reach all devices through SSE (`/api/live`).

## Server — `src/` (Node 24 runs TypeScript directly)

| File | Job | Key exports |
|---|---|---|
| `switches.ts` | connections switched off and on from the System screen (`switches.json` in the data volume); off keeps every setting | `ConnectorSwitches`, `CONNECTORS` |
| `ownersettings.ts` | the owner's settings from the System screen (`settings.json` in the data volume): how the AI makes new tasks — `unconfirmed` (default) or `confirmed`; `POST /api/settings/triage-new-tasks` | `OwnerSettings`, `TriageNewTasks` |
| `secrets.ts` | keys entered on the System screen (Google client, bot tokens): `secrets.json` in the data volume (600), over .env, never sent back, applied at once | `SecretStore`, `SECRETS` |
| `main.ts` | entry: `.env`, store, HTTP, bots, WhatsApp (`STREAM_WA_<ACCOUNT>_ENABLED`), triage | — |
| `config.ts` | registry files loaded at start | `captureConfig`, `tagConfig`, `telegramConfig`, `whatsappConfig`, `tasksConfig`, `conversationsConfig`, `filtersConfig` |
| `ids.ts` | name-based UUIDs (idempotent ids) | `nameId` |
| `backup.ts` | nightly copy of DB and media | — |
| **contracts/** | | |
| `validate.ts` | Event type + JSON Schema interpreter | `JournalEvent`, `validateEvent` |
| `correction.ts` | owner corrections: ops (incl. the queue's `snooze` with `until`, `requeue` and their undo, and `read`), link targets | `CORRECTION_OPS`, `checkCorrection*` |
| `tagging.ts` / `phone.ts` / `telegram.ts` / `viber.ts` / `whatsapp.ts` / `task.ts` | kind-specific payload rules (task: closing report by the registry; Viber and WhatsApp: replies by phone only) | `check*`, `whatsappAccountOf` |
| **server/** | | |
| `http.ts` | auth, routing (incl. «✨» — `/api/triage/again`, `/api/tasks/:id/recheck`), starts bots, WhatsApp clients and triage | `createApp` |
| `events.ts` | `/api/events` POST/GET; tells `http.ts` of each new event (a directive tag added after triage reruns its session) | `events` |
| `media.ts` | `/api/media/<sha256>` | `media` |
| `share.ts` | Android share target | `share` |
| `phone.ts` | `/api/phone/*` calls, SMS, notes (§8.1); SMS out — `actions/next` (held up to 50 s, the phone's pulse; a send not confirmed in 10 min fails) and `actions/<id>` (the phone's report) | `phone`, `phoneEventId` |
| `viber.ts` | `/api/viber/*` for the Viber bridge on the agent desktop: messages, pulse, reply actions one by one, hello (deploy/DESKTOP.md) | `viber`, `viberMessage` |
| `secrets.ts` | `/api/secrets`: the keys of the System screen — list what is set (never a value), set one, remove one | `secretsRoute` |
| `connectors.ts` | the connections running in the server — Telegram bots, WhatsApp clients, the triage, Google — started, stopped and restarted by keys and switches; switching is written to the feed | `createConnections` |
| `google.ts` | Google Calendar routes: `/api/google/connect` (sign-in URL), `/api/google/callback` (no owner token — a signed state), `/api/calendar` (accounts, calendars, events for «План»), show/hide a calendar, forget an account; the connector's health | `createGoogle` |
| `whatsapp.ts` | `/api/whatsapp/<account>/qr`: the linking QR as a PNG while WhatsApp waits (System screen) | `whatsappQr` |
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
| `triage.ts` | pending messages, all messages since a time (sessions), task events, context-only results, AI spending | `TriageStore` |
| `ailog.ts` | the AI log: triage runs (input and output gzipped, wiped after `ai_log.keep_days`) and decisions with reasons; the owner's answers settle them as they are appended (`observe`); week numbers (`stats`) | `AiLog` |
| **telegram/** (§8.2) | | |
| `bot.ts` | one account bot: `getUpdates` loop, update handling, sending (personal chats via business connection, groups as the bot), health | `TelegramBot`, `sendError` |
| `convert.ts` | Bot API message → ingest item (files, forwards, service text) | `toItem` |
| `ingest.ts` | item → journal event: ids, authors, replies, edits, deletions, echoes | `ingest`, `markDeleted` |
| **whatsapp/** (deploy/WHATSAPP.md) | Baileys as a linked device on the owner's number, in this process | |
| `client.ts` | one account: connection and reconnects (an unscanned QR waits quietly until the System screen asks, `requestQr`), QR and pulse as the channel's state, incoming and own messages, the last `history_h` of the history sent at linking, replies by phone (never twice) | `WhatsAppClient` |
| `convert.ts` | Baileys message → item: personal chats only, phone from the address, `remoteJidAlt` or the LID cache, files | `toItem`, `bareJid`, `phoneOfJid` |
| `ingest.ts` | item → journal event (id by WhatsApp message id and direction) | `toEvent` |
| `socket.ts` | the only file importing Baileys: auth state, no online presence, quiet logger | `createSocket`, `updateOf` |
| `types.ts` | the narrow shapes the rest works with (`WaSocket`, `WaMessage`, `WaItem`) | types |
| **google/** (deploy/GOOGLE.md) | Google Calendar: the owner's own Google client, two accounts | |
| `oauth.ts` | signed state, sign-in URL, code → tokens, refresh tokens per account in the data volume (mode 600), access tokens cached; revoked → `NeedsLogin` | `GoogleAccounts`, `authUrl`, `exchangeCode`, `signState` |
| `calendar.ts` | the poll: calendar lists and events of the visible calendars over `window_days`, a shared calendar once, shown/hidden kept in `settings.json`, last good events kept on errors | `CalendarPoller`, `normalizeEvent` |
| **tasks/** (§2.8) | | |
| `planner.ts` | planner interface, structured results and the instruction (v21): tasks (a repeat of a closed record — `repeat_of`), optional `conversation_only` ids, `questions` when unsure where messages belong; directive tags on messages | `Planner`, `PLAN_SCHEMA` |
| `streams.ts` | which stream a message belongs to and the quiet window of a stream | `streamOf`, `quietOf` |
| `triage.ts` | batches per conversation (`sessions.ts`) after the quiet window of its channel (none for a message with a directive tag), the last session of the conversation as context and the one before on the AI's `need_earlier` (v19, at most `earlier_max`), the interlocutor's records (`triagecontext.ts`), directive tags on messages; writes what `triageapply.ts` decides (task changes, proposals, questions in the `triage_result`), every run and decision into the AI log, budget; `rerun` — a session again after a directive tag or my answer in words to a question (planner `owner_answers`), `secondLook` (also for «✨»), one look at a time (`locked`) | `Triage`, `streamOf`, `quietOf` (re-exported) |
| `triageapply.ts` | v21 rules per planned outcome: an open record — system `link` (not messages the owner took out) and a proposal of content only (items, title unless owner-named, due, «done» with report, project, counterparty); a closed one — only a link, a new record only on the AI's `repeat_of`; done work — a done record with its report draft, never unconfirmed and not made twice (`doneWork`); unknown `task_id` — new; questions with known options only; roles of new records; `#поручить` — one known person as the executor and the AI's `draft` in the new record (a proposal on an open one), else a question with the known people that fit, «Сделаю сам», «Не поручать» (`knownPerson`, `candidates`, `directed`); executors by name resolved (`rolesFor` `resolve`) | `applyPlanned`, `questionsOf`, `ownerRemoved`, `rolesFor`, `checklistChange`, `projectChange`, `reportDraft` |
| `directive.ts` | the owner's orders to the triage: directive tags (`registry/tags.json` `directive`) the owner put (not `tagging.auto` unless kept in an edit); a correction that adds one to a triaged message; an answer in words to a question → its session again | `directiveOf`, `directivesOf`, `directiveAdded`, `ownerAnswerOf` |
| `assignee.ts` | `#поручить` executors by name: the directory's people with a conversation a name fits, one → that person's party, several → question options | `peopleNamed`, `resolveExecutor`, `candidatesFor` |
| `retriage.ts` | «✨ Разобрать заново»: the open conversation's last session to the triage again; the AI's unconfirmed tasks, waiting proposals and questions there are replaced (cancelled by the system / `withdrawn` in the new result, `replaced` in the AI log) and its links (v21 only: no `processor`) the owner has not touched taken back, after the new look succeeds | `retriage`, `secondLookOf`, `waitingProposals`, `systemLinks` |
| `recheckplan.ts` | «✨ Сверить с перепиской» (recheck-ai-v1): what the rechecker is shown (the record, its neighbours, its conversations with `in_record` / `owner_linked_elsewhere`) and answers (`add`, `remove`, `rename`, `due`, `items`, `status`, `merge`), the schema without unions (`restoreRecheck` maps "" to null), the instruction | `Rechecker`, `RECHECK_SCHEMA`, `RECHECK_INSTRUCTIONS`, `restoreRecheck` |
| `recheck.ts` | the record's conversations from the session before its first message (≤ `max_batch` × 3: its own, then each conversation's session before it, then the newest) to the rechecker, with what the owner rejected before; its answer → proposals of one `triage_result` with `recheck` (a merge closes the duplicate in `also`; unknown targets dropped; messages the owner put elsewhere never `add`); nothing applied; budget, AI log (`recheck` decisions), a new pass withdraws its waiting ones; `POST /api/tasks/:id/recheck` | `recheck`, `toProposals` |
| `triagecontext.ts` | which records the triage shows the AI: all of the interlocutor's (by conversation, role party, counterparty), closed within `reopen_days`, plus `others_in_context` recent open ones of others | `interlocutorRecords`, `Interlocutor` |
| `sessions.ts` | pure: the triage's conversation of a message (as in the queue: a chat, one number across calls, SMS, Viber, WhatsApp, my notes), sessions split by `session_gap_h`, the last session and steps back (`contextSessions`) | `conversationOf`, `sessionsOf`, `contextSessions` |
| `anthropic.ts` | AI planner (Claude Haiku 5.5, structured output), the rechecker of «✨ Сверить с перепиской» and the namer of hand-made tasks | `anthropicPlanner`, `anthropicRechecker`, `anthropicNamer` |
| `namer.ts` | titles «Контрагент: суть» (`TITLE_RULE`, shared with the planner); tasks the owner made by hand are named once by AI after 10 s unless he named them | `nameTasks`, `unnamed`, `TITLE_RULE` |
| `messages.ts` | planner message context: text after edits, sender, direction and forward metadata | `describe`, `from`, `messageDirection`, `hasForwardOrigin` |
| `fold.ts` | tasks as fold of `task_change` (server side, checklist `items`, `owner_titled`, recurring settings); old tasks get roles from `assignee` | `foldTasks`, `isOpen` |
| `repeat.ts` | advances dates and derives create, cancel and restore events for the next occurrence; the store writes them with the original task change | `nextOccurrence`, `repeatChange` |
| `projects.ts` | projects as fold of `project_change` (server side), the default project of a stream (`defaultProject`, by `sources`) | `foldProjects`, `defaultProject` |
| **contacts/** (P7) | | |
| `fold.ts` | people and counterparties as folds of `contact_change` / `counterparty_change`; points `tel:` / `tg:` | `foldPeople`, `foldCounterparties`, `personOf`, `peopleOf` |
| `parties.ts` | parties and roles: pattern, author → party, incoming call / SMS → caller, phone number form, default controller (client copy `web/parties.js`) | `isParty`, `partyOf`, `partyOfEvent`, `phoneNumber`, `defaultController` |

## Client — `web/` (plain ES modules, no bundler; new module → `VERSIONED` in `src/server/static.ts` and `web/sw.js`)

| File | Job |
|---|---|
| `index.html` | markup of the single screen, dialogs and panels |
| `styles.css` → `feed.css` → `panels.css` → `screens.css` → `wide.css` | styles, loaded in this order (cascade); `wide.css` — three columns from 1100 px |
| `layout.js` | the wide-screen breakpoint the panels follow (docked or sliding); none in node tests |
| `app.js` | entry: wires everything, message action dispatch, view changes (old saved views map to new), the link window's context |
| `viewswitch.js` | the views of the centre and the system back: the conversation queue is the root (`backTarget` — the view under a conversation, else home; `toHome`); the view title in the top bar (`viewTitle`: the queue — «Ждут решения: N»; `setupViewTitle`). No switch by the input since 2026-11-21 |
| `settings.js` | status line, settings dialog (token, copying it to another device), service worker registration |
| `feed.js` | the centre: home (the conversation queue, queuehome.js; back from a conversation on the same tile), «Сейчас» (the dashboard), one conversation (task plaques + messages in a row), Задачи (task rows by the panel's filter), Лента (bursts, chain lines); the open conversation doubles as the contact filter in Задачи and Лента |
| `dashboard.js` | the dashboard («▶ Сейчас» in the panel's «Задачи»), top-down like the queue: in work on top («Готово», «Пауза») or «Вернуться к…», paused under it, next in the order of «До конца дня» under them (`dashboardOrder`, `dashboardNodes`) |
| `feedpage.js` | where the centre's messages come from: media files (object URLs) and journal pages (refresh, older history; `fill` back to `queue.since` at once, `hasOlder`) |
| `queuehome.js` | the conversation queue on the main screen: waiting tiles with the longest waiting on top (the AI's questions passed on for «❓ …»), the folded «Архив» under them; empty — «Всё распределено ✓ · разобрано сегодня: N» (`createQueueHome`) |
| `contactspanel.js` | the address book of the left panel: «Я · мои записи» first, always (the `me` conversation); folded «Избранные» (pinned chats), people alphabetically with the latest conversation of any point, search by name or digits that also finds conversations (`contactList`, `contactsNodes`) |
| `convarchive.js` / `scrollpin.js` | the folded «Архив» under the queue: the last handled conversations five at a time, «Загрузить ещё» and growing on scroll down (`createArchive`); keeping the row read across a redraw (`rowOnScreen`, `putBack`) |
| `tasklist.js` / `days.js` | the «Задачи» view: the head of a list opened from the left panel («← Пульт», name, grouping — `listHead`), sections of a list (`sectionsOf`, `listCount`) or groups by tag / person (`groupsOf`), a task row (mark, title, facts with checklist progress, due word — `dueLabel`); day pill labels |
| `taskview.js` | the «Задачи» centre by the view: the pulse of its tasks, one project by its sections, or a list by dates / tags / people (`taskViewNodes`) |
| `viewstate.js` | pure: the view of «Задачи» — when (`WHEN`: current, waiting, future, unconfirmed, done, cancelled and older ones) · whose (`WHOSE`, with `control`) · where (project, counterparty, person); the panel's filters `PANEL_FILTERS`; `applyView`, `countsFor`, `viewTitle`, `dueGroups`; an unconfirmed task only under «Неподтверждённые» |
| `viewstore.js` | device storage of the current view and «Мои виды»; listeners redraw (`viewStore`) |
| `viewpanel.js` | «▶ Сейчас» (the dashboard) and the panel's eight task filters with counts (`taskShortcuts`), project tree, expandable filters and saved views |
| `pulse.js` | pure: the blocks the dashboard draws — in work, paused, today (incl. overdue work), watch with alerts, projects, later; `pulseBlocks`, `importance`, `projectHealth`, `pulseCount` |
| `focus.js` | pure: one task of mine in work (`inWork`, `isMineToDo`), «▶ В работу» / «Пауза» changes with `resume_note` (`startWork`, `pauseWork`, `resumeNoteOf`), `workedMinutes` from the status history |
| `contacts.js` | pure: the directory (mirror of `src/contacts/fold.ts`), `markCounterparties` (titles for rows) |
| `counterpartyline.js` | «Контрагент» / «Кто контрагент?» in task details: options, «+ Создать» by the hint, «+ Новый» (organization or address, side), linking the author with a job title |
| `personcard.js` / `counterpartycard.js` | the directory's cards in the right panel: fields edited in place, job titles, open tasks; side and archive of a counterparty |
| `projects.js` | pure: projects from `project_change` (`foldProjects`), tree with counts, scope, sections of a project, next actions (`markNext` sets `task.next`, `task.projectTitle`) |
| `projectview.js` / `projectpanel.js` | one project's header (kind, status, «Нет следующего шага», «Изменить») and section heads with «+»; the project tree in the left panel and «Проект» in task details |
| `checklist.js` | checklist editing, circled add button and «Отдельной задачей» |
| `taskbar.js` | one action bar for a task: ✓ Готово · ▶ В работу · 🕒 Когда · 👤 Поручить · 💬 Ответить · ⋯ Ещё with a second level (`barActions`, `moreActions`, `actionBar`, `personForm`) |
| `tasksheet.js` | the sheet a long press (right click) on a task row opens: title + action bar; `barContext` for the card too |
| `participants.js` | participant tiles, role editing, muting and removal; `taskParties` splits owner, AI and system from contacts, the task tile body selects the conversation, the icon edits roles |
| `participantpicker.js` | participant dialog anchored to the card's plus; pinned and frequent entries in an empty search, all matching eligible contacts and conversations on input |
| `taskcard.js` / `cardtalk.js` | card contact links and folding sections; inline conversation lookup, recent and swipe order (a swiped-to tile goes leftmost once typing starts — `frontOrder`), whose conversation the card shows (`pickParty`: null — the comments), the people of the task's conversations (`messageParties`), the task's comments (`commentViews`), the task's conversation in a row (its own messages marked), activity timelines |
| `topic.js` | pure: a conversation's tasks for its head — empty, unconfirmed or real (`topicOf`); messages are not folded by task any more (2026-11-24) |
| `tasktalk.js` | pure: the task card «По задаче» — the task's messages of every conversation by time with one neighbour each side as folded context (`taskThread`), the long-press recipients of a card (`recipientOptions`), the input's recipient line (`recipientHint`) |
| `recipientsheet.js` | the long-press list «Кому отправить» over the input row (`openRecipientSheet`) |
| `cardhead.js` | the topic line of a card: the AI's waiting questions (askline.js) on top, «+ задача…», the AI's offer «ИИ: «…»» with ✓ ✕ and «Почему», the task (`topicLine` — without a topic, as in «Я», only the questions; `reasonOf`) |
| `askline.js` | the AI's question (v21 `ask`): «❓ текст», options as buttons, «Своими словами…» (`askLine`); pure — `askChoices` (an option naming an unknown record dropped), `answerEvents` (a link — my task change adding the messages, a new record — my task (`answerTaskId`), nothing; an option's `executor` / `draft` (#поручить) go into the record; then the `answer_question` correction on the latest message; event ids from the question, so a repeat is the same event), the first answer locks the line, `conversationQuestions` (newest first), `shortAsk` (the tile) |
| `taskdraft.js` | the AI's draft of an assignment (`#поручить`, task `draft`): `pendingDraft` — an open task with a draft for someone of the open conversation not yet sent (my message equal to it or starting with it) or cleared (`draft: ''`); `draftLine` — «Черновик поручения: «задача»» with ✕; `draftCard` — the draft with «Скопировать» in the task card (taskdetails.js); no draft for a conversation without a reply chat; chatview.js puts the text into the input (`composer.prefill`), never sends it |
| `linkmark.js` | «→ «название» ↩» under a message: the v21 triage's system links (an `update` `add` with no `processor`) to existing records I have not touched (`linkMarks`); «↩» — my `task_change` `remove` (`unlinkEvent`, `setupLinkMarks`); `linkMarkBlock` for bubble.js |
| `magic.js` | ✨ at the right of the tags row: «Создать задачу», «Завершить задачу», «Разобрать заново» (`POST /api/triage/again`); «Подсказать ответ», «Перевести» — «скоро» (`magicItems`, `setupMagic`) |
| `taskchips.js` | editable planned start, duration, deadline and repeat beside project and counterparty (`taskChips`, `chipFacts`) |
| `dayplan.js` | the right panel by default: my open tasks by days — «День · 4 дня · 7 дней», overdue first — and Google Calendar events grey among them (`plannerDays`, `dayPlan`) |
| `system.js` / `systemcards.js` | the System screen by cards: «Требуют внимания», Каналы, Сервисы — dot, state, last heard, on/off switch; opened — keys, QR, bot accounts, Google, failed sends; the journal below (`systemGroups`, `cardFacts`, `card`) |
| `keysbox.js` | keys on the System screen: a hidden field per key, «задан, …последние 4», «Заменить», «Удалить» (`keyFacts`, `keyRows`) |
| `googlebox.js` | Google on the System screen: «Подключить Google», accounts with «Отключить», a switch per calendar; the toast after the sign-in (`calendarToggles`, `googleNotice`) |
| `taskquick.js` | acting where a task is seen: the «Готово» mark, swipe right (done) / left («Когда?» due chips), every change with «Вернуть» in the toast (`act`, `done`); «▶ В работу» / «Пауза» of the pulse (`start`, `pause` — several tasks, one «Вернуть») |
| `swipe.js` | a horizontal swipe on a list item (task rows, plaques, conversation rows), only from the middle column: follow, arm, act; not a tap; with a mouse (`peek`) the pointer at an edge shows that side's action and a press runs it (`peekSide`) |
| `peoplerow.js` | the line of interlocutors over the input of an open conversation: one tile per chat that can be answered (`replyChats`), the chosen one leftmost with 📣 gets the reply (`rowOrder`); `conversationTask`, `chatParties` |
| `swipezones.js` | screen swipes by columns 25 / 50 / 25: tabs Беседы · Задачи, the left panel before them, the right one after; in the right panel — the card's tabs, close before the first (`zoneOf`, `swipeAction`) |
| `convquick.js` | actions on a queue tile: swipe left — the snooze tiles (snoozetiles.js); an archive tile either way — back to the queue (`decorateArchived`, `requeue`); right — confirm the AI's task, open the owner's or make one from what waits (`swipePlan`); ⏱ `snooze`, 🗄 `answered`, ↧ `requeue`, «+ задача…» (`newTask`), each with «Вернуть»; `anchorOf`, `sourceOf` |
| `question.js` | «О каком деле?» under a message: options from the triage's alternatives, the owner's pick moves or confirms; since v15 also «ИИ предлагает в задачу» with the reason, «+ Новое дело», «✕ Ни с чем» |
| `proposals.js` | pure: the AI's waiting proposals by message (`proposalsByMessage`: an owner answer, `reject_proposal` or a hand link settles one; a recheck's are not there), their options (`proposalOptions`), ✓ as events — the change and every `also`, ids from the proposal (`acceptEvents`) |
| `recheck.js` | «✨ Сверить с перепиской» in the task card: the recheck's waiting proposals by record (`recheckProposals`), their labels (`recheckLabel`), ✕ (`rejectEvent`), the list with ✓ ✕ (`recheckList`), the request and its toast (`runRecheck`, `recheckToast`) |
| `questions.js` | pure: the AI's waiting questions (v21 `ask`) by message (`aiQuestionsByMessage`: the owner's `answer_question` correction or a later result's `withdrawn` settles one; 🗄 does not); `fromV21` |
| `donecard.js` | card «Задача выполнена?» (triage's `proposed: done`): «Да, готово» closes in one tap, «Ещё нет»; «Заполнить отчёт» on a closed task fills the missing fields; pure report parsing |
| `backclose.js` | the system back closes what is open on top (link window, attach menu, message actions, dialogs) instead of leaving the app: history entries per window (`createBackStack`, `watchDialogs`) |
| `holdrender.js` | redraws of the left panel, details and centre wait while an input or a list of choices there is in use (`holdRender`, `holding`) |
| `motion.js` | smooth show / hide / fold (grow, shrink, reveal, conceal, play) with a timer fallback |
| `snooze.js` / `snoozetiles.js` | «⏱ Отложить»: choices by the time of day (`snoozeOptions`), the popover (`snoozeMenu`), a date from the system picker; the row in place of a left-swiped queue tile: dials ⏱ minutes and 🌗 / 📅 — one time wheel through the parts of the days ahead (`swipeChoices`, `timeSlots`, `turnIndex`, `turnDay`; `snoozeTiles`: the row of dials holds the finger, a dialled wheel spreads over the three places; «🗄», «↧», «✕») |
| `convlist.js` / `convtasks.js` | a tile of the queue: four lines (kind · channel — contact; the task or «+ задача…»; two lines of the last message, edge to edge), the time at the end of the title line (no buttons: swipes), a small line «ждёт · новых · контрагент · метки» — or «❓ …», the AI's newest waiting question, read from the questions directly (`tileFacts`, `tileTask`, `pickTask`, `convRow`); task plaques on top of a conversation (the «Готово» mark and swipes, status, executor, due) |
| `projection.js` | pure: events → message views (corrections — `read` marks its message `read`/`readAt`, `answer_question` marks its message `decided`, delivery, context-only results), sources, chats, topics |
| `bubble.js` | one message bubble (text, media, meta, task mark, the triage's link marks — linkmark.js) |
| `phonebubble.js` / `tgbubble.js` | call/SMS and Telegram blocks inside a bubble |
| `composer.js` / `draftfiles.js` | input: text, voice, tags, recipient, modes (reply, edit, continue); attachments of the draft (checks, previews) |
| `outbound.js` | pure: reply data for Telegram (24 h window), Viber, WhatsApp and SMS (by phone only, `phoneAnswerable`; an SMS is sent by the phone companion) |
| `tagrow.js` / `suggest.js` | tags in the row above the input (`ordered()` for the link window); tag suggestions |
| `linkwindow.js` | the link window of the «связь» button: Метки · Контакты · Беседы · Задачи, likely first (`likelyConversations`, `likelyTasks`), strips and pages, a section on the whole window |
| `linkstate.js` | the conversation or task the next message goes into: its chip, continuation, recipient, adding to the task once sent |
| `recipients.js` | recipients: address book, the chosen one's chip, items and pins for the Контакты section |
| `actions.js` | tap / long press / context menu → action panel and ops |
| `select.js` / `bulk.js` | selection mode; bulk actions on the selection |
| `drawer.js` / `favourites.js` | the left panel: two bodies by the icons at its foot — Задачи («Сейчас», filters, projects, tags; in the Лента — «Завершённые» and sources), Контакты (contactspanel.js), the mode kept on the device (`panelMode`); sliding on a phone, a column on a wide screen; pinned chats (`favourites`) and conversation lookup (`searchConversations`) |
| `taskfold.js` | pure: tasks from `task_change` (with history, roles, checklist — `foldItems`, `itemsProgress`, `ownerTitled`), due state, a task's messages (`taskMembers`), the task a message leads to (`taskOfMessage`) |
| `filters.js` | pure: saved task filters (`registry/filters.json`) — `matchesFilter` (fields incl. `snoozed`), `visibleTasks` |
| `conversations.js` / `queue.js` | pure: messages → conversations (one per chat or number), each with `queue` — waiting for the owner and since when, or `open` — not over by the triage verdict or an unconfirmed AI task (`queueOf`: only the owner's reply, own task link, `answered`, `snooze` take it out; while the AI waits — a question «ИИ спрашивает», a proposal «ИИ предлагает правку», an unconfirmed record «ИИ предлагает задачу» — the reply does not, `answered` does (questions and proposals only from v21+, `fromV21` in `questions.js`); a message linked only to closed or filed records waits for nothing; «Я · мои записи» (`me`) waits only for the AI; the day of a task of mine brings it back; a `requeue` later than any handling brings it back from the archive and cancels a snooze; `requeue` and a snooze's end lift its moment; nothing before `queue.since` waits), `queueList` (newest moment on top), `archiveList` / `handledAt` (the archive above the queue, the last handled first), `handledToday` («разобрано сегодня: N» — out of the queue, with an act of mine today), an answer to the AI's question handles its messages (`decided`), `ownerLinked`; `isArchived`; `conversationKeys` (an own note joins the conversation it continues or answers; else a note in a task of its own → `task:<id>` (not while a v21+ AI record of it is unconfirmed); a split message and its chain → `split:<id>`); `withWhom` |
| `details.js` / `taskdetails.js` | the task card as a conversation (2026-11-22): the head (title, dates and counterparty, cuts «Описание · Чеклист · Подробности», one open at a time), the conversation with the chosen interlocutor or the comments, the interlocutors at the bottom; what the input continues (`topicLast`); the right panel: the day plan, a message, a person, a counterparty |
| `taskactions.js` | pure: actions a task offers by status (`actionsFor`; «Готово» in every open status), the change of each (`changeFor`, `closeChange` — done at once, report fields to `missing`), its undo (`undoOf`), due chips, delegate and «Жду…» options (callers included) |
| `parties.js` | pure: parties and roles (mirror of `src/tasks/parties.ts`) and `partyName` — a party in words for rows, plaques and details |
| `chatview.js` | the head of a conversation's card: who and the channel (a tap — the person), the topic line (cardhead.js) and its acts with «Вернуть», «ждёт …» with ⏱ ↥ 🗄 and «≡», the folded details («Контакт», «В Telegram», «Не отслеживать»); «назад» (also the system back) or × (filter elsewhere), reply recipient or else a continuation of the last message |
| `system.js` | System screen: sources, connections, sends, exclusions |
| `versioncard.js` / `picker.js` | versions of a message (left to right); link picker |
| `shared.js` | builders of entries: message, share, correction (also `answer_question`: `question`, `option` or `answer` words), task change (both take a stable `id` / `ts`), the owner's own task (`ownTask`); `nameUuid` — a stable id from a key |
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
| `registry/tags.json` | tag dictionary and suggestion threshold; `directive` tags order the triage (v21) |
| `registry/telegram.json` | Telegram accounts, file limit, reply window, address book (frequency days, row size) |
| `registry/whatsapp.json` | WhatsApp accounts (connector `whatsapp_<account>`), file limit, oldest live message written, history window at linking, reconnect ceiling, QR refresh, pulse |
| `registry/tasks.json` | triage settings and rules on actions vs context, task templates, report fields, card settings |
| `registry/conversations.json` | the queue: `since` (its start date), «⏱ Отложить» presets by the time of day |
| `registry/filters.json` | saved task filters: conditions over roles, status, due, report, `snoozed`; `pinned` chips, `sections`; first («Пульт», `view: 'pulse'`) is the default |
| `registry/pulse.json` | dashboard settings and weights, plus `hot_wait_hours` for highlighting wait time on conversation tiles |
| `registry/connectors.yaml`, `intents/`, `fields.yaml` | connectors, intents, fields (for step 3) |

## Elsewhere

| Path | What |
|---|---|
| `docs/BUSINESS-PROCESS-ARCHITECT.md` | Business process analysis, modeling and local BPMN tool setup |
| `android/` | «Stream · телефон» (Kotlin): call log and SMS sync, after-call note, SMS out (`SmsSender` — the SIM of the number's last SMS; `SmsEcho` keeps its own sent SMS out of the sync; `ReportWorker`), always on the line (`LinkService` — a foreground service holding the waiting request and watching the SMS store and call log; `BootReceiver`) (§8.1, `deploy/PHONE.md`) |
| `deploy/` | Dockerfile, compose, `install.sh` (agent deploys with `sudo -n`), guides `DEPLOY.md`, `PHONE.md`, `TELEGRAM.md`, `DESKTOP.md`, `WHATSAPP.md` |
| `deploy/desktop/` | agent desktop on srv-150 (Openbox, noVNC, Viber): image, compose, `viber-send` / `viber-whois` (search by phone or name, the chat checked by its title menu), `viber-selftest`, `viber-health`, `viber-bridge` (Viber ⇄ Stream), `viber-read-out` + `viber_outgoing.py` (the owner's own outgoing messages, copied from the chat window), `notify-log` (desktop notifications → JSON lines) |
| `test/` | `node --test`: one file per area (api, phone, telegram-bot, triage, taskfold, projection, …) |
| `test/taskchips.test.ts` / `test/repeat.test.ts` | card date labels and recurring task events through the API |
| `test/participantpicker.test.ts` | picker suggestion ordering, search and supported task participant ids |
| `golden/` | reference messages (real ones only in `*.local.*`, outside git) |
| `golden/triage-information.jsonl` | synthetic task versus conversation-only triage cases |
| `golden/conversations.jsonl` · `scripts/golden.ts` · `src/tasks/goldenscore.ts` | conversation-to-records golden cases (real ones in `conversations.local.jsonl`), the runner `pnpm golden` (real AI, prints misses / extras / duplicates / cost), pure parsing and scoring |
| `docs/plans/` | active package plans; `archive/` (local, outside git) — done plans, superseded decisions, old Done items |
