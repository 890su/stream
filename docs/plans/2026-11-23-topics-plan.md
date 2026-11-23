# Topics in conversations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Messages belong to topics. A topic is a task record with `kind: 'topic'`. The AI files messages into topics and only offers to make one a task. The conversation card head gets a line of topic tiles with 📣 and ×, the messages fold by the chosen topic, and selected messages can be moved to another topic.

**Architecture:**
- `task_change` gains two optional fields, `kind` and `offer`. Both folds (server `src/tasks/fold.ts`, client `web/taskfold.js`) derive `kind` and `offer`, and read the legacy `unconfirmed` as a topic with an offer.
- Every task view asks `isTopic(task)` instead of `task.unconfirmed`.
- Liveness is computed in a pure `web/topiclive.js` from the conversation, `handledAt` and two owner settings, which are served inside `/api/config`.
- The card head line (`web/cardhead.js`) is replaced by `web/topicrow.js`.
- The composer links each sent message to the chosen topic.
- The triage becomes `triage-ai-v20`.

**Tech Stack:** Node 24 strip-only TypeScript, append-only SQLite journal, buildless ESM PWA (`web/`), `node --test`.

**Spec:** `docs/plans/2026-11-23-topics-design.md` (approved by the owner 2026-11-23); `CONCEPT.md` §2.5 «Topics»; `decisions.md` 2026-11-23 «Темы в беседах».

## Global Constraints

- Owner-facing text is in Russian; code, identifiers and commits are in English.
- Every file has a header comment in English; one file does one job, up to ~300 lines.
- Every new `web/*.js` goes into `VERSIONED` in `src/server/static.ts` and `web/sw.js` (a test checks it). Every removed one leaves both.
- The journal stays append-only. `kind` (`'topic' | 'task'`) and `offer` (boolean) are optional `task_change` fields in `contracts/event.schema.json`, an additive change.
- Defaults: `topic_days: 14`, `archive_days: 3`, kept in `registry/conversations.json` under `topics`. The owner's values are integers 1–365, stored in `settings.json` (`OwnerSettings`).
- Owner-facing strings, copied verbatim:
  - topic icons: ◇ topic, ☑ task, ✨ offer;
  - `+ тема…`;
  - System card: `Тема актуальна без сообщений, дней`, `Темы бесед из архива доступны, дней`;
  - topic menu: `Сделать задачей`, `Вернуть в тему`, `Открыть задачу`, `Переименовать`;
  - offer line: `ИИ: сделать задачей?`;
  - topic picker: `Тема…`, `Перенести`, `Добавить`, `+ Новая тема`;
  - cancel reason when a topic loses its last message: `Убрана из бесед`;
  - task view title: `Предложения ИИ`.
- Test data is made up; no real messages, names or numbers in git (rule 15).
- `pnpm test` and `pnpm typecheck` must be green before each commit. One retry is allowed for the known flaky `connect ETIMEDOUT` tests.
- The agent commits and pushes after each task, and deploys after Task 8 and after Task 10:
  - deploy: `ssh -i ~/.ssh/id_ed25519 admin890brain@192.168.0.149 'sudo -n /usr/bin/bash /srv/stream/app/deploy/install.sh main'`;
  - then check https://stream.sekond.pl/healthz.
- Do not stage `docs/BUSINESS-PROCESS-ARCHITECT.md` or `.claude/`. No `git stash`.
- Browser checks run in the preview «stream-preview» on made-up data, at 375 px and 1440 px.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The owner writes into a chosen topic.** Today any owner change confirms a legacy unconfirmed task. Under this plan that rule must not fire for a record with an explicit `kind`: a topic stays a topic (Task 1).
2. **The owner's link to a topic must not take the conversation out of the queue.** Only a link to a task counts in `ownerLinked`, `clearedAt` and `handledAt` (Task 2).
3. **× on a topic whose messages span two conversations.** Only this conversation's messages leave the topic. The topic is cancelled only when none are left (Task 5).
4. **A topic chosen in conversation A must not stay chosen when conversation B opens.** The choice is kept per conversation key (Task 5).
5. **Old records.** A legacy unconfirmed task (`unconfirmed: true`, no `kind`) shows as ◇✨ with its offer. ✓ makes it a task; ✕ keeps it a topic and does not cancel it (Tasks 1 and 5).

---

### Task 1: `kind` and `offer` in the folds and the contract

**Files:**
- Modify: `src/tasks/fold.ts`, `web/taskfold.js`, `contracts/event.schema.json`
- Create: `web/topickind.js`
- Test: `test/topickind.test.ts` (new), `test/taskfold.test.ts`

**Interfaces:**
- Produces:
  - `Task.kind: 'topic' | 'task'` and `Task.offer: boolean`, both always set after the fold, on server and client;
  - `isTopic(task): boolean` and `isTask(task): boolean`, exported from `web/topickind.js` and from `src/tasks/fold.ts`;
  - `hasOffer(task): boolean`, exported from `web/topickind.js`. It is true for a topic with an offer that is open.

Fold rules, the same on both sides:
- `change.kind` sets `kind` and marks the kind as given. `change.offer` sets `offer`.
- `change.unconfirmed === true` without `change.kind` gives `kind: 'topic'` and `offer: true`.
- `change.unconfirmed === false` gives `kind: 'task'` and `offer: false`.
- An owner change without `kind` or `unconfirmed` turns a record into `task` only if its kind was never given and it is legacy-unconfirmed. This is the old rule.
- No `kind` given anywhere means `task`.

- [ ] **Step 1: Write the failing tests**
  - In `test/topickind.test.ts`:
    - `legacy unconfirmed reads as a topic with an offer`: fold a create with `unconfirmed: true` → `kind === 'topic'`, `offer === true`.
    - `an owner add to an explicit topic keeps it a topic`: create with `kind: 'topic'`, then an owner update `{ add: ['m2'] }` → `kind === 'topic'`.
    - `kind task and back keeps due, roles and items`: create a task with `due` and `items_add`, then update `kind: 'topic'`, then `kind: 'task'` → `due` and `items` are unchanged.
    - `offer false keeps the topic`: create with `{ kind: 'topic', offer: true }`, then update `{ offer: false }` → `kind === 'topic'`, `offer === false`, status still open.
    - `an owner change confirms a legacy unconfirmed task`: legacy `unconfirmed: true`, then an owner update without kind → `kind === 'task'`.
  - In `test/taskfold.test.ts`: the same five cases on `foldTasks` from `web/taskfold.js`.
  - A contract test: an event with `kind: 'topic', offer: true` is valid.
- [ ] **Step 2:** Run `node --test test/topickind.test.ts test/taskfold.test.ts`.
  Expected: FAIL — `kind` is undefined.
- [ ] **Step 3:** Implement the fold rules in both folds. Add `kind` and `offer` to the `task_change` schema. Write `web/topickind.js`. Add it to `VERSIONED`.
- [ ] **Step 4:** Run the same tests, then `pnpm test` and `pnpm typecheck`.
  Expected: PASS.
- [ ] **Step 5:** Commit `Topics: kind and offer on task records`.

### Task 2: topics out of task views; the queue counts only tasks

**Files:**
- Modify the `unconfirmed` read sites listed by `grep -rn unconfirmed web` (except `cardhead.js`, which Task 5 removes, and `topic.js`):
  - `web/viewstate.js`, `web/dayplan.js`, `web/focus.js`, `web/pulse.js`, `web/queue.js`, `web/convlist.js`, `web/magic.js`, `web/app.js`
- Test: `test/viewstate.test.ts`, `test/queue.test.ts`

**Interfaces:**
- Consumes: `isTopic` and `hasOffer` from Task 1.
- Produces: the view `unconfirmed` keeps its id (saved views use it), takes the title `Предложения ИИ`, and matches `hasOffer(task) || task.status === 'inbox'`.

Topics are excluded wherever `task.unconfirmed` excluded before. In `queue.js`:
- `ownerLinked`, `clearedAt` and `handledAt` count an owner `add` only when the record is a task at that moment. Use the fold's current `kind`; this is enough for a ruling.
- The `unfinishedOf` offer becomes `hasOffer(task)`.

- [ ] **Step 1: Write the failing tests**
  - `a topic is in no task view`: a topic record shows in neither `current` nor `active`.
  - `Предложения ИИ lists topics with an offer`.
  - `an owner link to a topic keeps the conversation waiting`: an incoming message, then an owner `task_change add` of it into a topic → `queue.waiting === true`.
  - `an owner link to a task still clears it`: the existing behaviour, kept.
- [ ] **Step 2:** Run `node --test test/viewstate.test.ts test/queue.test.ts`.
  Expected: the new tests FAIL.
- [ ] **Step 3:** Replace the reads. Change the queue counters.
- [ ] **Step 4:** Run `pnpm test`.
  Expected: PASS.
- [ ] **Step 5:** Commit `Topics stay out of task views and do not clear the queue`.

### Task 3: topic settings (server, config, System screen)

**Files:**
- Modify: `registry/conversations.json` (`"topics": { "topic_days": 14, "archive_days": 3 }`), `src/config.ts` (type), `src/ownersettings.ts`, `src/server/http.ts`, `web/system.js`, `web/feed.js`
- Create: `web/topicsettings.js`
- Test: `test/ownersettings.test.ts` (extend or create), `test/topicsettings.test.ts`

**Interfaces:**
- Produces:
  - `OwnerSettings.topics(defaults): { topic_days: number; archive_days: number }`;
  - `OwnerSettings.setTopics(value)`, which throws `Нужно topic_days и archive_days — целые от 1 до 365` on bad input;
  - `POST /api/settings/topics {topic_days, archive_days}`, which answers 400 with that text on bad input;
  - `/api/config` serves `conversations.topics` as the owner's values over the defaults;
  - `topicSettingsForm(values, onSave): HTMLElement` in `web/topicsettings.js`;
  - pure `parseTopicSettings(form): { topic_days, archive_days } | null`;
  - `feed.queueConfig().topics`.

The System screen renders the form as its own section «Темы», above the journal. After a save it dispatches `topics-config` with the values; `feed.js` merges them into `limits.conversations.topics` and redraws.

- [ ] **Step 1: Write the failing tests**
  - `topics fall back to the registry defaults` → 14 and 3.
  - `setTopics rejects 0 and 400`.
  - `POST /api/settings/topics saves and /api/config serves them`.
  - `parseTopicSettings reads two integers`.
- [ ] **Step 2:** Run the tests.
  Expected: FAIL.
- [ ] **Step 3:** Implement everything above. Add `topicsettings.js` to `VERSIONED`.
- [ ] **Step 4:** Run `pnpm test` and `pnpm typecheck`.
  Expected: PASS.
- [ ] **Step 5:** Commit `Topic lifetimes on the System screen`.

### Task 4: liveness and the default topic (pure)

**Files:**
- Create: `web/topiclive.js`
- Test: `test/topiclive.test.ts`

**Interfaces:**
- Consumes:
  - `handledAt(conversation)` from `web/queue.js`;
  - `isTopic` and `isTask`;
  - `config.topics`.
- Produces:
  - `liveTopics(conversation, { now, topics, lastAt }): Task[]`. It returns the open topics and tasks of `conversation.tasks`; filed records are excluded. Order: tasks first, then topics, each by latest message, newest first.
    - Topic liveness: `lastAt(topic)` is within `topic_days`, and the conversation waits or `now − handledAt(conversation) ≤ archive_days`.
    - An open task is always live.
    - `lastAt(task) → ISO` is the newest message time of the record, supplied by the caller from feed views.
  - `defaultTopic(conversation, live): string | null`: the live record of the newest non-deleted message, else `null`.
  - `pickable(conversations, { now, topics, lastAt }): { here: Task[], other: Task[], tasks: Task[] }`. It is used by Task 7 for the current conversation key passed as `here`.

- [ ] **Step 1: Write the failing tests**
  - `a topic silent for 15 days is not live` (with `topic_days` 14).
  - `a topic of a conversation archived 4 days ago is not live` (with `archive_days` 3).
  - `a waiting conversation keeps a 10-day topic live`.
  - `an open task is live whatever its age`.
  - `the default is the topic of the newest message`.
  - `no live topic of the newest message → null`.
- [ ] **Step 2:** Run the tests.
  Expected: FAIL (no module).
- [ ] **Step 3:** Implement. Add the module to `VERSIONED`.
- [ ] **Step 4:** Run the tests.
  Expected: PASS.
- [ ] **Step 5:** Commit `Which topics are live in a conversation`.

### Task 5: the topic row in the card head

**Files:**
- Create: `web/topicrow.js`
- Modify: `web/chatview.js` (replaces `topicLine`, `topicActs`), `web/feed.css` or `web/screens.css` (row styles), `web/app.js` (`setupMagic.topic`)
- Delete: `web/cardhead.js` and its test, if one exists. The `reasonOf` export moves into `topicrow.js`. Remove the file from `VERSIONED`.
- Test: `test/topicrow.test.ts`

**Interfaces:**
- Consumes: `liveTopics`, `defaultTopic`, `isTopic` and `hasOffer`.
- Produces:
  - Pure helpers:
    - `rowOrder(live, chosenId): Task[]`, with the chosen record first;
    - `tileOf(task, chosen): { icon, title, end: '📣' | '×' }`, where icon is `☑` for a task, `◇✨` for a topic with an offer, `◇` for other topics;
    - `removeChanges(topic, conversation): [{ id, change }]`. It removes this conversation's message ids from the topic. It adds `status: 'cancelled', reason: 'Убрана из бесед'` only when the record is a topic and no other messages remain.
  - DOM: `topicRow({ live, chosen, expanded, on }): HTMLElement`, where `on` is `{ choose(id|null), remove(task), menu(task), confirm(task), reject(task), create(title), expand(open) }`.

Behaviour:
- Collapsed, the row scrolls horizontally (`overflow-x: auto`). `▸`/`▾` switches it to a column.
- A tap on a tile's title chooses it; a tap on the chosen title gives `choose(null)`.
- A tap on the chosen tile's icon opens a menu:
  - `Сделать задачей` → `{ kind: 'task', offer: false }`;
  - `Вернуть в тему` → `{ kind: 'topic' }`;
  - `Открыть задачу` (tasks only);
  - `Переименовать` → a prompt-free inline input, then `{ title }`.
- The offer line under the row for the chosen topic: `ИИ: сделать задачей? ✓ ✕ · Почему: …`. ✓ → `{ kind: 'task', offer: false }`; ✕ → `{ offer: false }`.
- `+ тема…` creates `{ op: 'create', kind: 'topic', title, add: <waiting ids, else none> }` and chooses it. If the title is empty, the existing AI namer names it.
- Every act notifies with `Вернуть`.
- `chatview` keeps `chosen` per conversation key (a `Map`). The default comes from `defaultTopic` until the owner chooses.

- [ ] **Step 1: Write the failing tests**
  - `the chosen topic is first and gets 📣, others ×`.
  - `× removes only this conversation's messages`: the topic also has a message from another conversation → one change with `remove` and no `status`.
  - `× on the last messages cancels a topic but not a task`.
  - `a legacy unconfirmed task shows ◇✨`.
- [ ] **Step 2:** Run `node --test test/topicrow.test.ts`.
  Expected: FAIL.
- [ ] **Step 3:** Implement `topicrow.js` and wire it into `chatview.js`. Delete `cardhead.js`. Update `VERSIONED`.
- [ ] **Step 4:** Run `pnpm test` and `pnpm typecheck`.
  Expected: PASS.
- [ ] **Step 5:** Commit `The line of topics in the conversation card`.

### Task 6: the composer writes into the chosen topic; cuts by topic

**Files:**
- Modify: `web/composer.js`, `web/chatview.js`, `web/topic.js` (`cutSegments`), `web/feed.js`, `web/bubble.js` (topic caption), the styles
- Test: `test/topic.test.ts`, `test/composer-topic.test.ts` (if the composer is not node-testable, the pure part goes into `topic.js`)

**Interfaces:**
- Consumes: the `chosen` state from Task 5.
- Produces:
  - `composer.setTopic(id | null)`. After a message is queued, if a topic is set and «связь» did not attach a task, the composer queues `makeTaskChange(id, { op: 'update', add: [entryId] })` as the owner.
  - `cutSegments(views, { focus, all, dim, ... })`: with `all` and `focus`, every message is open, and open segments carry `dim: Set<id>` of the messages outside `focus`.
  - `topicCaption(view, tasksById, focus): string | null`: the title of the view's first live record other than `focus`. It is shown under a bubble when `all` is on or nothing is chosen.

In the conversation, `feed.js` passes `focus: chosen` (it was `null`), so the messages of the chosen topic stay open and the others fold. The «≡» button toggles `all`.

- [ ] **Step 1: Write the failing tests**
  - `with a topic chosen, other messages fold`.
  - `all with focus opens everything and dims the rest`.
  - `waiting messages never fold` (kept).
  - `topicCaption names the other topic`.
- [ ] **Step 2:** Run `node --test test/topic.test.ts`.
  Expected: FAIL.
- [ ] **Step 3:** Implement. `chatview` calls `composer.setTopic(chosen)` on every sync and `setTopic(null)` when it leaves.
- [ ] **Step 4:** Run `pnpm test`.
  Expected: PASS.
- [ ] **Step 5:** Commit `Messages go into the chosen topic; the card folds by it`.

### Task 7: move or add selected messages to a topic

**Files:**
- Create: `web/topicpicker.js`
- Modify: `web/bulk.js` (action `Тема…`), the long-press message menu (`web/actions.js`) for a single message
- Test: `test/topicpicker.test.ts`

**Interfaces:**
- Consumes: `pickable` from Task 4 and `makeTaskChange`.
- Produces:
  - Pure `moveChanges(views, targetId, mode: 'move' | 'add', tasksById): [{ id, change }]`:
    - `add`: one `add` into the target;
    - `move`: also one `remove` per other record now holding any of the views. A topic left with no messages gets `status: 'cancelled', reason: 'Убрана из бесед'`; a task does not.
  - DOM: `openTopicPicker({ views, groups, onPick(targetId | { title }, mode) })`. Sections: «Эта беседа», «Другие темы», «Задачи», then search by title, then `+ Новая тема`. Buttons: `Перенести`, `Добавить`.
  - A new topic is `{ op: 'create', kind: 'topic', title, add: ids }`.
- Every act notifies with `Вернуть` (the reverse changes).

- [ ] **Step 1: Write the failing tests**
  - `move takes the messages out of every other record`.
  - `add leaves them where they were`.
  - `move empties a topic → cancelled; a task stays`.
- [ ] **Step 2:** Run the tests.
  Expected: FAIL.
- [ ] **Step 3:** Implement. Add the module to `VERSIONED`.
- [ ] **Step 4:** Run `pnpm test`.
  Expected: PASS.
- [ ] **Step 5:** Commit `Selected messages move to another topic`.

### Task 8: browser check and deploy 1 (UI without the new triage)

- [ ] Run the preview on made-up data at 375 px and 1440 px. Check:
  - the row collapses, scrolls and unfolds;
  - 📣 and ×;
  - a message written with a topic chosen lands in it, and the conversation stays in the queue until the reply;
  - «≡» dims;
  - the move picker works;
  - a legacy unconfirmed task shows ◇✨;
  - the System card «Темы» saves.
- [ ] Update `docs/CODEMAP.md` (new modules, `cardhead.js` gone) and `PLAN.md` (an item «Темы в беседах» with ❓ checks for the owner).
- [ ] Commit, push and deploy. Check `/healthz` and that `/topicrow.js` is served.

### Task 9: triage v20 — topics first, a task only offered

**Files:**
- Modify: `src/tasks/planner.ts`, `src/tasks/triage.ts`, `src/store/ailog.ts`, `src/tasks/retriage.ts`, `registry/tasks.json` (`processor: "triage-ai-v20"`, a `topics` block or read `conversationsConfig.topics`), `web/systemcards.js` (stats lines)
- Test: `test/triage.test.ts`, `test/planner.test.ts`, `test/retriage.test.ts`, `test/systemcards.test.ts`, `test/anthropic-planner.test.ts`

**Interfaces:**
- Consumes: `isTopic` from `src/tasks/fold.ts` and the owner `topics()` settings.
- Produces:
  - `PlannedTask.work: boolean`, required in the schema;
  - `PlanTask.kind: 'topic' | 'task'`;
  - `DecisionKind` gains `'topic' | 'topic_link' | 'propose_task'`;
  - `ailog.observe` settles `propose_task`:
    - `accepted` on an owner `kind: 'task'`;
    - `rejected` on an owner `offer: false`;
    - `undone` on cancel.

Rules in `run()`:
- `open` takes open tasks and live topics. Server liveness is the newest message event `ts` within `topic_days`; the archive condition is client-only (ruling, see below).
- **New item:**
  - `kind: 'topic'`;
  - with `work`, in mode `unconfirmed`, `offer: true` plus a `propose_task` decision, status `pending`;
  - with `work`, in mode `confirmed`, `kind: 'task'` and decision `create`;
  - without `work`, `kind: 'topic'` and decision `topic`.
  - Filed records and the «Разобрать» fallback are `kind: 'task'`, as before.
- **Target is a topic:** a direct system `task_change` with `add` and decision `topic_link`, status `auto`.
- **Target is a task:** a proposal (v15), unchanged.
- `conversation_only` stays, for messages that fit no topic (greetings before any subject).

Instructions (`PLAN_INSTRUCTIONS`):
- Every message goes to a topic in `open_tasks` with `kind: 'topic'`, to a task, or to a new topic named by `TITLE_RULE`.
- `work: true` follows the v17 rules for when work grew (выезд, удалённое подключение, настройка, заказ, счёт, оферта, an owner promise to do it later). Consultations and talk are `work: false`.
- The conversation_only bullets become «the topic they continue».
- `unfinished` is covered only by a task or a topic with `work`.

Retriage: it also withdraws system-made topics the owner never touched (no `author: 'me'` entry in the history) and open `propose_task` offers. Both are `replaced` in the AI log.

- [ ] **Step 1: Write the failing tests**
  - `a new subject without work becomes a topic, no offer`.
  - `a new subject with work becomes a topic with an offer` (mode unconfirmed).
  - `confirmed mode makes a task at once`.
  - `a message continuing a topic is added to it directly`.
  - `a message continuing a task is still only proposed`.
  - `processor is triage-ai-v20; the schema requires work`.
  - `retriage withdraws untouched AI topics, keeps touched ones`.
  - `owner kind task accepts the propose_task decision`.
- [ ] **Step 2:** Run `node --test test/triage.test.ts test/retriage.test.ts`.
  Expected: FAIL.
- [ ] **Step 3:** Implement. Update the `CONCEPT.md` §2.8 batch triage paragraph to v20.
- [ ] **Step 4:** Run `pnpm test` and `pnpm typecheck`.
  Expected: PASS.
- [ ] **Step 5:** Commit `Triage v20 files messages into topics and offers tasks`.

### Task 10: queue tile, docs, deploy 2

**Files:**
- Modify: `web/convlist.js` (`tileFacts`): the tile shows the record of the newest message (`◇ title` or `☑ title`), plus `+N тем` when more than one is live.
- Modify: `docs/CODEMAP.md`, `PLAN.md`, `decisions.md` (only if a ruling changed the design).
- Test: `test/convlist.test.ts` (or the existing tile test): `the tile names the topic of the newest message`.

- [ ] Write the test (it fails), implement, then run `pnpm test`.
- [ ] Do a browser check of the tile at 375 px.
- [ ] Commit, push and deploy. Check `/healthz`.

## Rulings made while planning

- Server-side liveness for the triage uses only `topic_days`: the server does not compute `handledAt`. If this is wrong, the AI may see a topic of a long-archived conversation. That is harmless, because it only offers a link target.
- `offer` is a new field, not a reuse of `proposed`, which already means «proposed done».
- The design's `moved` outcome in the AI log is folded into `undone` (a removal), because a move is a remove plus an add in separate changes. If this is wrong, the weekly report cannot tell «moved» from «undone».
- The view id `unconfirmed` is kept for saved views; only its title and match change.
- A new topic made with `+ тема…` when nothing waits has no messages. It shows in the row only while it is chosen, until the first message lands in it.
