# Беседы слева, дашборд, одна карточка (две выкладки) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The conversation queue, the contacts and the task filters live in the left panel behind a row of icons; the centre opens on a bottom-up dashboard; a conversation and a task are one card with a topic line, cuts by task and ✨; AI-made tasks can wait unconfirmed.

**Architecture:** Deploy 1 is navigation only. `feed.js` gets a `home` mode and loses the queue branch, the queue moves to a drawer module, and the view switch goes. Deploy 2 adds `unconfirmed` to `task_change`, plus a server owner setting that the triage (v16) reads. The open conversation and the open task are rendered by one card module in the centre, which replaces `#chat-bar`, `#task-screen` and the ◐ mode.

**Tech Stack:** Node 24 strip-only TypeScript, append-only SQLite journal, buildless ESM PWA (`web/`), `node --test`.

**Spec:** `docs/plans/2026-11-21-workspace-redesign-design.md`

## Global Constraints

- Owner-facing text in Russian; code, identifiers and commits in English; header comment in English on every file; one file — one job, up to ~300 lines.
- Every new `web/*.js` goes into `VERSIONED` in `src/server/static.ts` and `web/sw.js` (a test checks it).
- The journal stays append-only. A contract change is additive (`unconfirmed`) and gets a `decisions.md` entry.
- Test data is made up; no real messages, names or numbers in git (rule 15).
- `pnpm test` and `pnpm typecheck` must be green before each commit. A retry is allowed for the known flaky `connect ETIMEDOUT` tests.
- The agent commits, pushes and deploys each deploy: `ssh -i ~/.ssh/id_ed25519 admin890brain@192.168.0.149 'sudo -n bash /srv/stream/app/deploy/install.sh main'`, then check https://stream.sekond.pl/healthz.
- Do not stage `docs/BUSINESS-PROCESS-ARCHITECT.md` or `.claude/`. No `git stash`.
- Browser checks run in the preview «stream-preview» (port 3791, made-up data) at 375 px and 1440 px. Restart the preview after client changes and front the tab (`tabs_select`).
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Queue in the drawer on a phone.** Opening the panel, scrolling up into «Архив», tapping a tile, then the system back must return to the same tile in the panel. The queue must not jump on a live message (rowOnScreen pin against the drawer scroller) — Task 3.
2. **Root and back.** From a conversation, a task list or a task card, the system back ends on the dashboard and never leaves the app. A reload with an old `history.state` (`view`, `conversation`, `task`) lands on the dashboard — Task 6.
3. **Unconfirmed leaks.** An `unconfirmed` task must not appear in the dashboard, day plan, counters or any filter except «Неподтверждённые». It must not take a conversation out of the queue — Task 8.
4. **Old events.** Tasks without `unconfirmed` (all existing ones) stay real, and an owner edit of an unconfirmed task confirms it, except the toggle's own `unconfirmed: true` — Task 8.
5. **Reply target.** In the card, after a swipe to another interlocutor, the composer recipient is that chat. The tile row reorders only on the first keystroke, and an off switch (tap on the chosen tile) still makes a note — Task 13.

---

# Deploy 1 — navigation

### Task 1: the task filters of the panel

**Files:**
- Modify: `web/viewstate.js` (WHEN, WHOSE, `whenMatch`, `whoseMatch`, `applyView`)
- Modify: `web/viewpanel.js` (`SHORTCUTS`, `taskShortcuts`)
- Test: `test/viewstate.test.ts`

**Interfaces:**
- Produces: the WHEN ids `current`, `waiting`, `future`, `unconfirmed`, `cancelled` (new). `done` now means status `done` only. `today`, `inbox`, `upcoming`, `deferred`, `all` and `unreported` stay for saved views. WHOSE gets `control`. `DEFAULT_VIEW` = `{ when: 'all', whose: 'mine', where: {} }`. `pulse` is removed from WHEN, and a stored view with `when: 'pulse'` reads as DEFAULT_VIEW (`viewstore.js` load path).
- Produces: `taskShortcuts(tasks, data)` → 8 rows `{ view, title, count }` in this order: Текущие `{when:'current'}`, Активные `{when:'all', whose:'mine'}`, На контроле `{when:'all', whose:'control'}`, В ожидании `{when:'waiting'}`, Будущие `{when:'future'}`, Неподтверждённые `{when:'unconfirmed'}`, Законченные `{when:'done'}`, Отменённые `{when:'cancelled'}`.

- [ ] **Step 1: Write the failing tests.** Extend the made-up task set with `t('в работе', { status: 'doing' })`, `t('пауза', { resumeNote: 'на шаге 2' })`, `t('план', { plan: { start: '2026-11-22T09:00:00' } })`, `t('отменено', { status: 'cancelled' })` and `t('ии', { unconfirmed: true })`. Then add:
  - `test('panel filters: current, waiting, future, unconfirmed, done, cancelled')`:
    - `ids({when:'current'})` = `['в работе','пауза']`;
    - `ids({when:'waiting'})` = `['жду']`;
    - `ids({when:'future'})` ⊇ `['через неделю','отложено','план']` and excludes `'сегодня'`;
    - `ids({when:'unconfirmed'})` = `['ии','новое']` (inbox counts);
    - `ids({when:'done'})` = `['готово']`;
    - `ids({when:'cancelled'})` = `['отменено']`.
  - `test('control: delegated and review, not waiting')`: `ids({when:'all', whose:'control'})` = `['поручено','проверить']`.
  - `test('an unconfirmed task shows only under «Неподтверждённые»')`: `'ии'` is in no `ids(...)` of the other WHEN ids.
  - `test('eight shortcuts in the panel order')`: the titles of `taskShortcuts(tasks, data)` equal the list above.
- [ ] **Step 2:** Run `node --test test/viewstate.test.ts`. Expected: FAIL (unknown `when` ids return all, titles differ).
- [ ] **Step 3: Implement.**
  - `current` uses `inWork(tasks)` from `focus.js`, computed once per `applyView` call and passed into `whenMatch` as a Set of ids.
  - `future`: open and (`dueState === 'later'`, or status `deferred`, or `plan.start` after today's end).
  - `unconfirmed`: `task.unconfirmed === true || status === 'inbox'`.
  - Every other WHEN id excludes `task.unconfirmed === true`.
  - `control`: the existing `delegated` (review included), and status not `waiting`.
  - Update the existing tests that asserted `pulse`, the old `done` and the old shortcut titles.
- [ ] **Step 4:** Run `node --test test/viewstate.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Task filters of the panel: current, active, control, waiting, future, unconfirmed, done, cancelled`.

### Task 2: the dashboard

**Files:**
- Create: `web/dashboard.js`
- Modify: `web/feed.js` (MODES gets `'home'`; the `home` branch renders `dashboardNodes`; `readsDown()` is false for `home`, so it scrolls to the bottom)
- Test: `test/dashboard.test.ts`

**Interfaces:**
- Consumes: `pulseBlocks({ tasks, projects, now, config })` → `{ work, paused, today }` (`pulse.js`); `taskRow`; `quick.start/pause/done`.
- Produces: `dashboardOrder(blocks)` → a top-to-bottom array `[{ kind: 'next'|'paused'|'work', task }]` = `today` reversed (the nearest next is lowest), then `paused` reversed, then `work`. `dashboardNodes(ctx)` → DOM nodes. `ctx` is pulseNodes' ctx: `{ tasks, viewsOf, now, quick, config, onOpen }`. The `work` card has «Готово» and «⏸ Пауза». With no work, the newest paused task becomes a «Вернуться к…» card at the bottom. When nothing is shown, a single `.empty` «Всё спокойно.» is drawn.

- [ ] **Step 1:** Write `test('bottom-up: work last, paused above it, next above them, the nearest next lowest')` with made-up blocks `{ work: W, paused: [P1, P2], today: [N1, N2, N3] }`. Assert that `dashboardOrder(...)` maps to `['N3','N2','N1','P2','P1','W']` with kinds `next×3, paused×2, work`. Also `test('no work: nothing marked work; empty blocks → []')`.
- [ ] **Step 2:** Run `node --test test/dashboard.test.ts`. Expected: FAIL — module not found.
- [ ] **Step 3:** Implement `dashboard.js`. Move the work and «Вернуться к» card code from `pulseview.js` into it (`pulseview.js` is no longer used by the centre — delete the file and its VERSIONED entry and drop the `pulse` branch of `taskview.js`). Add `dashboard.js` to VERSIONED and wire the `home` branch in feed.js. `pulseTotal` stays for counters.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Dashboard in the centre: in work at the bottom, paused and next above it`.

### Task 3: the queue in the left panel

**Files:**
- Create: `web/queuepanel.js`
- Modify: `web/feed.js` (remove the queue branch, `archive`, `listPin` and `inQueue`; mode `conversations` is entered only with a key, and `openConversation(null)` goes to `home`; return `loadOlder` and `hasOlder`)
- Modify: `web/convarchive.js` only if the scroller assumption breaks (it takes a scroller already)

**Interfaces:**
- Consumes: `convRow`, `queueList`, `archiveList`, `createArchive({ scroller, list, render, active, hasOlder, loadOlder })`, `rowOnScreen` / `putBack`, `snoozeMenu`, `feed.conversations()`, `feed.tagFilter()`, `feed.queueConfig()`.
- Produces: `createQueuePanel({ box, scroller, feed, convQuick, onOpen(key), onOpenTask(id), hotHours })` → `{ render({ reveal }), shown() }`. `render` keeps the row on screen (pin before `replaceChildren`, `putBack` after). On the first show it scrolls to the bottom. `box` is the queue container inside `.drawer-body`, and `scroller` is `.drawer-body`.

- [ ] **Step 1:** There is no pure logic of its own: the queue logic stays in the tested `queue.js` and `convlist.js`. The test is a browser check, written down before coding:
  - open the panel at 375 px;
  - tap «🗄 Архив», then «Загрузить ещё»;
  - tap a waiting tile — the panel closes and the conversation opens;
  - press back — the panel reopens on the same tile;
  - append a live message to another conversation — the tile you were reading does not move.
- [ ] **Step 2:** Run `pnpm test`. Expected: the current suite is green before the change (baseline).
- [ ] **Step 3:** Implement `queuepanel.js` and remove the queue from feed.js. Keep `test/queue.test.ts` and `test/conversations.test.ts` untouched — they must still pass.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: PASS. Then run the browser check from Step 1. Expected: every point holds.
- [ ] **Step 5:** Commit with the message `The conversation queue moves into the left panel`.

### Task 4: the contacts list

**Files:**
- Create: `web/contactspanel.js`
- Test: `test/contactspanel.test.ts`

**Interfaces:**
- Consumes: `feed.people()` (each item has `{ id, name, points, status }`, `contacts.js`) and `feed.conversations()` (each item has `{ key, title, last, points? }`); `conversationParty` / `partyConversation` (`cardtalk.js`) map a point to a conversation.
- Produces:
  - `contactList(people, conversations, query = '')` → `[{ id, name, phone, key, last }]`:
    - not deleted;
    - sorted by `name.localeCompare(…, 'ru')`;
    - `query` matches the name (case-insensitive) or the digits of a point;
    - `key` is the latest conversation of any point, or null.
  - `contactsNodes({ list, onOpen(contact) })` → search input plus rows.

- [ ] **Step 1:** Write the tests:
  - `test('alphabetical, deleted left out, latest conversation of any point')`: made-up people «Яна» `tel:+48500000001`, «Анна» `tg:501` and `tel:+48500000002`, «Борис» deleted; two conversations for Анна with `last` values. Expect names `['Анна','Яна']` and Анна's `key` = the newer one.
  - `test('search by name part or by digits')`: `'ан'` → Анна; `'0001'` → Яна; `'+48 500'` → both.
- [ ] **Step 2:** Run `node --test test/contactspanel.test.ts`. Expected: FAIL — module not found.
- [ ] **Step 3:** Implement and add the file to VERSIONED.
- [ ] **Step 4:** Run `node --test test/contactspanel.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Contacts list for the left panel`.

### Task 5: the panel modes

**Files:**
- Modify: `web/index.html` (drawer body: `#panel-conversations` with favourites, search and `#queue-box`; `#panel-contacts`; `#panel-tasks` with `#drawer-mode` and the tags; footer `nav.panel-modes` with three flat SVG buttons `data-panel="conversations|contacts|tasks"`, labels «Беседы», «Контакты», «Задачи»; `#drawer-button` icon → a panel icon, label «Беседы, контакты, задачи»)
- Modify: `web/drawer.js` (shell, modes and drag only; favourites and conversation search move to `queuepanel.js` — this keeps drawer.js under 300 lines)
- Modify: `web/panels.css`, `web/wide.css`
- Test: `test/drawerstate.test.ts` for the pure helper

**Interfaces:**
- Produces: `panelMode(stored)` → `'conversations'|'contacts'|'tasks'` (unknown or missing → `'conversations'`), in `web/drawer.js` as an export, stored under `localStorage['stream.panelMode']`.
- Produces: `drawer.show(mode)`, which opens the panel in a mode (the dashboard has no link to it yet; used by Task 6).
- In the Лента (`feed.mode() === 'feed'`), the tasks body shows the sources as today.
- A contact tap: `onContact(key)` if `key`, and the person card on the right (`details.openPerson(id)`) in both cases.
- A filter tap: `onTasks()`, then close on a phone.

- [ ] **Step 1:** Write `test('panel mode: stored value or conversations')`: `panelMode('contacts')` = `'contacts'`, `panelMode(null)` = `'conversations'`, `panelMode('pulse')` = `'conversations'`.
- [ ] **Step 2:** Run it. Expected: FAIL — export missing.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: PASS. Browser check at 375 and 1440 px: the three icons switch the bodies, the choice survives a reload, and on wide screens the panel is docked with the queue visible.
- [ ] **Step 5:** Commit with the message `Left panel modes: conversations, contacts, tasks`.

### Task 6: no view switch, the dashboard is the root

**Files:**
- Modify: `web/viewswitch.js` (remove `counterFor`, `switchIcon` and the button; keep the view title — TITLES `home: 'Сейчас'`, `conversations` = conversation title is set by chatview, `tasks: 'Задачи'`, `feed: 'Лента'`; `rootBack(mode, state)` → true when `mode !== 'home'` and `state` is not the mode's own entry; rename `toQueue` → `toHome`)
- Modify: `web/index.html` (remove `#view-switch`), `web/app.js` (`setupViews`: start in `home`, `go('home')` is the root, popstate → `go('home')`; swipe zones get `tabs: { index: () => 0, count: () => 1, go }`)
- Test: `test/viewswitch.test.ts`

- [ ] **Step 1:** Rewrite the tests:
  - `test('back lands on the dashboard from a list, a conversation or the Лента')`: `rootBack('tasks', null)` = true, `rootBack('conversations', null)` = true, `rootBack('home', null)` = false, `rootBack('tasks', { view: 'tasks' })` = false.
  - `test('toHome pops a view entry')`.
  - Delete the counter tests.
- [ ] **Step 2:** Run `node --test test/viewswitch.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Also remove the `.view-switch` CSS.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: PASS. Browser check of Review Focus 2: back from a conversation, a list, a task card and the Лента; a reload with an old state.
- [ ] **Step 5:** Commit with the message `No view switch by the input; the dashboard is the root`.

### Task 7: docs and deploy 1

**Files:** `CONCEPT.md` §5 (the new layout table, the left panel modes, the dashboard, no switch; mark what deploy 2 replaces), `docs/CODEMAP.md` (new files; remove `pulseview.js` and the switch rows), `PLAN.md` (a new «In progress» entry; update the queue entry: the queue now lives in the panel), `decisions.md` (the layout decision with the owner's words), `CONTEXT.md` «Сейчас».

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** Run `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 3:** Commit with the message `Docs: left panel modes and the dashboard`, then push and deploy.
- [ ] **Step 4:** Run `curl -s https://stream.sekond.pl/healthz`. Expected: `ok`. Open the production page and confirm the dashboard loads (read-only, no clicks that send).

---

# Deploy 2 — one card, unconfirmed tasks, ✨

### Task 8: `unconfirmed` in the contract and the folds

**Files:**
- Modify: `contracts/event.schema.json` (task item: `unconfirmed`: boolean), `src/contracts/validate.ts` if task fields are listed there
- Modify: `src/tasks/fold.ts`, `web/taskfold.js` (keep `unconfirmed` from `create`; an owner (`author: 'me'`) `task_change` without `unconfirmed` sets it false; `unconfirmed` given explicitly wins)
- Modify: `web/pulse.js` (`eligible` and `inWork` exclude unconfirmed), `web/dayplan.js` (`plannerDays` excludes them), `web/conversations.js` / `web/convlist.js` (`tileTask` does not show an unconfirmed task as the conversation's task; the queue is unchanged)
- Modify: `src/store/ailog.ts` (`observe`: an owner change with `unconfirmed: false` on an `auto` create → `accepted`; `status: cancelled` → `undone`, as now)
- Test: `test/taskfold.test.ts`, `test/task-lists.test.ts` (server fold), `test/pulse.test.ts`, `test/ailog.test.ts`, `test/conversations.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - `test('an AI-made task with unconfirmed stays so until the owner touches it')`:
    - a system create with `unconfirmed: true` → `task.unconfirmed === true`;
    - an owner `update` with `{ title }` → false;
    - an owner `update` with `{ unconfirmed: true }` → true;
    - a create without the field → `undefined`, treated as real.
    - Mirror the same cases in the server fold test.
  - `test('pulse and the day plan leave unconfirmed tasks out')`.
  - `test('the owner confirming an AI task settles its create as accepted')`.
  - `test('a tile shows no unconfirmed task as its task')`.
- [ ] **Step 2:** Run each file. Expected: FAIL.
- [ ] **Step 3:** Implement, and add the `decisions.md` entry for the field.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Unconfirmed tasks: contract field, folds, kept out of the pulse and the plan`.

### Task 9: the AI mode setting and triage v16

**Files:**
- Create: `src/ownersettings.ts`
- Modify: `src/main.ts`, `src/server/http.ts` (route), `src/server/system.ts` (the ai_triage item `info.new_tasks`), `src/tasks/triage.ts`, `registry/tasks.json` (`processor: triage-ai-v16`), `src/config.ts` if typed
- Test: `test/ownersettings.test.ts`, `test/triage.test.ts`, `test/api.test.ts`

**Interfaces:**
- Produces: `class OwnerSettings(file)` with `triageNewTasks(): 'unconfirmed'|'confirmed'` (default `'unconfirmed'`) and `setTriageNewTasks(value)`. It is stored in `<data>/settings.json` with the same atomic write as `src/switches.ts`.
- Produces: `POST /api/settings/triage-new-tasks` with the body `{ value: 'unconfirmed'|'confirmed' }` → 200 `{ ok: true }`. A bad value → 400 «Нужно value: unconfirmed или confirmed». It is owner-token protected like `/api/connectors/*`.
- Consumes in `Triage`: a `newTasks: () => 'unconfirmed'|'confirmed'` dependency. In `unconfirmed`, every create it writes (not filed, not unsorted) carries `unconfirmed: true`.

- [ ] **Step 1:** Write the tests:
  - the settings file round-trip and its default;
  - the route accepts the two values and rejects others;
  - `test('triage v16 creates unconfirmed tasks unless the owner chose confirmed')` — two runs with the dependency switched; filed creates never carry the flag.
- [ ] **Step 2:** Run the three files. Expected: FAIL.
- [ ] **Step 3:** Implement. Update CONTEXT.md «Сейчас» to `triage-ai-v16`.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Triage v16: new AI tasks wait unconfirmed unless the owner chose otherwise`.

### Task 10: the choice on the System card

**Files:**
- Modify: `web/system.js`, `web/systemcards.js`
- Test: `test/systemcards.test.ts`

**Interfaces:**
- Produces: `triageModeChoice(value)` → `[{ value: 'unconfirmed', title: 'ИИ предлагает — я подтверждаю', on }, { value: 'confirmed', title: 'ИИ создаёт сразу', on }]`, shown in the «Разбор задач (ИИ)» card under «Новые задачи». A tap POSTs the route and re-reads `/api/system`.

- [ ] **Step 1:** Write `test('the triage mode choice marks the current value; unknown → unconfirmed')`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm test`. Expected: PASS. Browser check: switching the choice survives a reload.
- [ ] **Step 5:** Commit with the message `System card: how the AI makes new tasks`.

### Task 11: topics and cuts — pure

**Files:**
- Create: `web/topic.js`
- Test: `test/topic.test.ts`

**Interfaces:**
- Produces: `topicOf(conversation)` → `{ state: 'empty'|'unconfirmed'|'task', tasks }`, where `tasks` are the conversation's open tasks:
  - real tasks first, by `pickTask` urgency (`convlist.js`), then the unconfirmed ones;
  - `state` = `'task'` if any real task, else `'unconfirmed'` if any, else `'empty'`.
- Produces: `waitingSince(conversation)` → the ts of the first incoming message after my last message, or null.
- Produces: `cutSegments(views, { focus = null, tasksById, open = new Set(), all = false })` → `[{ kind: 'open', views } | { kind: 'cut', taskId, title, views, open }]`:
  - consecutive messages of one topic are merged;
  - a message's topic is its first open task id, or null;
  - with `focus` (task mode): messages of `focus` are open, others are cuts;
  - without `focus` (conversation mode): messages with no task are open, each task's run is a cut;
  - `open` (a Set of `taskId|firstViewId`) and `all` unfold cuts — such a segment has `open: true`;
  - a message of several tasks including `focus` is open.

- [ ] **Step 1:** Write the tests with made-up views and tasks:
  - `test('conversation mode: task runs fold, loose messages stay open')`;
  - `test('task mode: the focus task open, others fold, a shared message is open')`;
  - `test('opened cuts and «all» unfold, the run is kept')`;
  - `test('topic state: empty, unconfirmed, task; real tasks first')`;
  - `test('waiting since the first incoming after my last message')`.
- [ ] **Step 2:** Run `node --test test/topic.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement and add the file to VERSIONED.
- [ ] **Step 4:** Run the file. Expected: PASS.
- [ ] **Step 5:** Commit with the message `Topics and cuts of a conversation`.

### Task 12: the card in conversation mode

**Files:**
- Create: `web/card.js` (the card's nodes), `web/cardhead.js` (head, topic line, facts and actions)
- Modify: `web/feed.js` (the conversation branch renders `cardNodes` instead of `convTasks` plaques and plain bursts: head → topic line → facts → folded details → people row → segments rendered through the existing `renderGroup`, a cut as `.cut` with `data-cut`), `web/chatview.js` (no `#chat-bar`: its ⏱ ↥ 🗄, «Контакт», «В Telegram», «Не отслеживать» move into the head and the details; it keeps the composer steering), `web/index.html` (remove `#chat-bar`), `web/feed.css`
- Delete: `web/convtasks.js` if nothing else uses it (check `grep`), together with its VERSIONED entry and test

**Interfaces:**
- Consumes: `topicOf`, `waitingSince`, `cutSegments` (Task 11); `snoozeMenu`; `convQuick.snooze/requeue`; the archive correction (`answered`); `setupPeopleRow`.
- Produces: `cardHead({ conversation, topic, now, on: { person, openTask(id), newTask(title), confirm(task), reject(task), toggle(task, on), snooze(anchor), requeue, archive } })` → nodes.
  - The topic line has three states, by the design:
    - «+ задача…»;
    - «ИИ: «Название»» ✓ ✕ plus «Почему: …» from `task.note`;
    - title chips with a `role="switch"` «задача» toggle at the end.
  - Writes:
    - ✓ → `{ op: 'update', unconfirmed: false }`;
    - ✕ → `{ op: 'update', status: 'cancelled' }`;
    - the toggle off → `{ op: 'update', unconfirmed: true }`;
    - the toggle on, on an empty topic → the existing `ownTask` create from the waiting messages.
- Produces: the details fold — a round button with a corner arrow (`aria-expanded`). Closed by default in conversation mode; the state is per card for the session.
- Produces: the cut line — centred small text with thin rules on both sides, «Название · 3». An open cut gets the `.cut-open` tinted block. Taps toggle `open` in feed state keyed per conversation.

- [ ] **Step 1:** Tests: `cardHead` is DOM — its decisions are in `topic.js` (Task 11). Write the browser check first: a made-up conversation with no task, one with an unconfirmed task and one with two tasks. Check:
  - ✓ confirms, and the line changes to the title;
  - ✕ empties it;
  - the toggle off makes it unconfirmed;
  - ⏱ ↥ 🗄 act with «Вернуть»;
  - cuts fold and unfold;
  - the queue in the panel is unchanged by the AI's link.
- [ ] **Step 2:** Run `pnpm test`. Expected: green baseline.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: PASS. Then run the browser check at 375 px.
- [ ] **Step 5:** Commit with the message `One card: a conversation with its topic line, quick actions and cuts`.

### Task 13: the card in task mode and the interlocutor swipe

**Files:**
- Modify: `web/details.js` (`openTask(id)` opens the card in the centre with `focus = id`, instead of `#task-screen`; the right panel keeps planner, message, person and counterparty; `leaveTask` returns to where the card was opened from), `web/taskdetails.js` (exports the fields block for the card's details: chips, description, checklist, folded «Подробности»; the people rows move to the card's tile row), `web/card.js`, `web/feed.js` (a `task` focus with a selected party: the conversation of that party, `partyConversation` from `cardtalk.js`), `web/cardtalk.js` (remove the ◐ `readMode`/`fold` and `talkItems` dim mode — replaced by cuts; keep `cardOrder`, `pagerOrder`, `bindTalkSwipe`), `web/index.html` (remove `#task-screen`), `web/peoplerow.js` (tile row with horizontal scroll, ＋ and ≡ at the right end)
- Test: `test/cardtalk.test.ts` (update), `test/peoplerow.test.ts`

**Interfaces:**
- Produces: in task mode the details are open, and the people row shows the task's participants (`taskParties`). A swipe in the middle of the feed (`bindTalkSwipe`) moves to the next or previous party and changes head and feed. The chosen tile moves leftmost only on the composer's first `input` event after the swipe: `rowOrder(chats, chosenKey, { typed })` — when `typed` is false, the order is kept.
- Produces: «≡» flips `all` for `cutSegments`.

- [ ] **Step 1:** Write `test('the swiped-to tile moves leftmost only once typing starts')` in `test/peoplerow.test.ts` (`rowOrder` with `typed: false` keeps the order; `true` puts the chosen one first). Update the cardtalk tests that covered the dim mode — delete those cases.
- [ ] **Step 2:** Run both files. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: PASS. Browser check of Review Focus 5:
  - a task with two made-up interlocutors: a swipe changes head and feed, the composer recipient follows, the first keystroke reorders the tiles;
  - a tap on the chosen tile switches it off and the composer writes a note;
  - back returns to the list or dashboard it came from.
- [ ] **Step 5:** Commit with the message `The card in task mode: details open, interlocutors by swipe`.

### Task 14: ✨ in the tags row

**Files:**
- Create: `web/magic.js`
- Modify: `web/composer.js` or `web/tagrow.js` (the ✨ button `.row-end` where `#view-switch` was), `web/feed.css`
- Test: `test/magic.test.ts`

**Interfaces:**
- Produces: `magicItems({ topic })` → `[{ id, title, enabled }]`:
  - `create` «Создать задачу» — enabled when the topic is empty or unconfirmed;
  - `finish` «Завершить задачу» — enabled when a real open task is in focus or first;
  - `suggest` «Подсказать ответ» and `translate` «Перевести» — `enabled: false`, title suffix « · скоро».
- `setupMagic({ button, topic(), on: { create, finish } })` opens a small menu anchored to the button (like `snoozeMenu`).
- `create` = the toggle on (Task 12); `finish` = `quick.done(task)`.

- [ ] **Step 1:** Write `test('✨ offers create on an empty or unconfirmed topic, finish on a task; the AI items are «скоро»')`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement and add the file to VERSIONED.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: PASS. Browser check: the menu opens at 375 px and stays inside the screen.
- [ ] **Step 5:** Commit with the message `✨ in the tags row: create or finish a task; AI items to come`.

### Task 15: docs, review, deploy 2

**Files:** `CONCEPT.md` §2.8 (unconfirmed tasks, the mode) and §5 (one card), `docs/CODEMAP.md`, `decisions.md` (one card; the mode setting), `PLAN.md` (the deploy 2 entry with ❓ for the owner's week), `CONTEXT.md`.

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** Do a whole-branch review of `git diff <deploy-1 commit>..HEAD` against the spec and the Review Focus. Fix Critical and Important findings test-first.
- [ ] **Step 3:** Run `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 4:** Commit, push, deploy. Run `curl -s https://stream.sekond.pl/healthz` and expect `ok`. Read `/api/system` (owner) and confirm `ai_triage` shows `processor triage-ai-v16` and `new_tasks: unconfirmed`.
