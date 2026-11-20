# Очередь бесед и левая панель (этап 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The «Беседы» list becomes a queue of what waits for the owner — oldest at the bottom by the input, «⏱ Отложить» and «↥ В конец очереди» on each tile and in an open conversation; the left panel shows only task filters, «Беседы» and favourites.

**Architecture:** A pure `web/queue.js` replaces conversation states: from a conversation's messages, the owner's actions (replies, own task links, `answered`, the new `snooze` / `requeue` corrections) it computes whether the conversation waits and its queue moment. The list, the tile, the view switch, the pulse and the link window read `conversation.queue` instead of `conversation.state`. New correction ops are journal events like `answered`.

**Tech Stack:** Node 24 TypeScript server (no build), buildless ESM PWA in `web/`, `node --test`.

**Spec:** `docs/plans/2026-11-20-queue-and-task-screen-design.md` (stage 1); `CONCEPT.md` §2.5 «The queue», §5.

## Global Constraints

- UI text in Russian; code, identifiers, commits in English (`CONTEXT.md`).
- One file — one job, up to ~300 lines, an English header comment; new behaviour covered by tests (rule 14).
- A new `web/*.js` module goes into `VERSIONED` in `src/server/static.ts` and `web/sw.js` (a test checks it).
- The journal only grows: undo is a new correction (`unsnooze`, `unrequeue`), never an edit.
- Thresholds and presets are data in `registry/`, not code (rule 4).
- No new dependencies.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; the agent pushes and deploys
  (`ssh -i ~/.ssh/id_ed25519 admin890brain@192.168.0.149 'sudo -n bash /srv/stream/app/deploy/install.sh step1-journal-capture'`).
- Do not stage `src/contracts/validate.ts` or `docs/BUSINESS-PROCESS-ARCHITECT.md` (unrelated local changes).

## Rulings taken while planning (the design left them to the builder)

- Queue settings live in `registry/conversations.json` (a `queue` block), not a new `registry/queue.json`: that file
  already reaches the client as `limits.conversations`. `states`, `urgent_tags`, `quiet_days` leave it.
- Undo needs its own ops: `unsnooze` and `unrequeue` (like `answered` / `unanswered`), so «Вернуть» restores the exact
  previous place.
- The app always starts on «Беседы» (the queue is the root); the remembered view is dropped.
- Tags stay in the left panel (they filter tasks too); Лента keeps its source filters — the design speaks of Беседы and
  Задачи only.
- «Избранные» before stage 3 = pinned Telegram recipients (`recipients.items()` with `pinned`), opening `tg:<chat_id>`.

## Review Focus

1. A new message in a queued conversation must not move it (owner's example: the 11th stays 11th) — Task 2 test.
2. Phone conversations: an answered incoming call is not waiting, a missed one is; an outgoing call or SMS is a reply — Task 2 test.
3. A snoozed conversation returns at once, on top, when a new incoming message arrives — Task 2 test.
4. «Вернуть» after ⏱ or ↥ restores the previous place, not «now» — Task 1 and Task 2 tests.
5. Old history (Telegram months, WhatsApp 2 days, Viber) must not flood the queue: `max_age_days` — Task 2 test.

---

### Task 1: `snooze`, `unsnooze`, `requeue`, `unrequeue` corrections

**Files:**
- Modify: `src/contracts/correction.ts` (`CORRECTION_OPS`, `checkCorrectionShape`)
- Modify: `web/projection.js` (the correction switch)
- Test: `test/correction.test.ts`, `test/projection.test.ts`

**Interfaces:**
- Produces: on a projected view — `view.snoozes: {at: string, until: string}[]` (ordered by correction ts; `unsnooze` pops the last) and `view.requeues: string[]` (correction ts; `unrequeue` pops the last). Both default to `[]`.
- Produces: `makeCorrection(targetId, 'snooze', { until })` in `web/shared.js` puts `until` into `payload.data`.

- [ ] **Step 1: Failing tests.** `correction.test.ts`: `snooze` without `data.until` → 400 «Отложить можно только до даты и времени (until)»; `until` not parseable by `Date.parse` → same 400; `requeue`, `unsnooze`, `unrequeue` without data → accepted. `projection.test.ts`: two `snooze` then `unsnooze` on one message → `view.snoozes` has the first only, with `at` = the correction ts and its `until`; `requeue` twice then `unrequeue` → `view.requeues` = [first ts].
- [ ] **Step 2: Run** `node --test test/correction.test.ts test/projection.test.ts` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Add the four ops to `CORRECTION_OPS`; `until` check in `checkCorrectionShape`; projection cases; `until` option in `makeCorrection`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `Queue: snooze and requeue corrections with their undo`.

### Task 2: the queue — `web/queue.js`

**Files:**
- Create: `web/queue.js`
- Modify: `web/conversations.js` (attach `queue`, drop `conversationState`, state ordering and `config.states`), `registry/conversations.json`, `src/config.ts` (the type), `src/server/static.ts`, `web/sw.js`
- Test: `test/queue.test.ts` (new); `test/conversations.test.ts` (state tests replaced)

**Interfaces:**
- Consumes: Task 1 view fields; `directionOf`, `conversationOf` from `web/conversations.js`; `foldTasks` history entries `{ts, author, change}`.
- Produces:
  - `ownerLinked(tasks) → Set<string>` — message ids added to a task by a change authored `me` (create or update).
  - `queueOf(conversation, { now, config, owner }) → { waiting: boolean, moment: string|null, since: string|null, pending: View[], snoozedUntil: string|null }`.
  - `queueList(conversations) → Conversation[]` — waiting ones, `moment` newest first (top of the screen), ties by `key`.
  - `conversations(...)` returns each conversation with `queue` (and no `state`).
- Registry: `registry/conversations.json` → `{ "version": 2, "queue": { "max_age_days": 7, "snooze": { "minutes": [15, 60, 180], "noon": { "hour": 12, "until_hour": 11 }, "evening": { "hour": 18, "until_hour": 17 }, "tomorrow_day": { "hour": 13, "from_hour": 17 }, "morning": { "hour": 9 } } } }`.

**Algorithm of `queueOf`** (the spec's rules; the order of steps matters):
1. Own notes (`key` `me`, `task:…`) never wait.
2. Handling point `H` — the latest ts among: my message that is not a note (direction `out`); a message with `answered`; a message in `owner`; an answered incoming call (call direction `in`).
3. `pending` — messages after `H`, direction `in` except answered calls, meaningful (not only in filed tasks) and mattering in a group (the rules moved from `conversationState`), not own notes. None → not waiting.
4. `moment` = first pending ts; the latest `requeues` entry later than `H` lifts it (`max`).
5. The latest snooze later than `H` (by `at`): a pending message after its `at` → moment = max(moment, that message's ts); else `now < until` → not waiting, `snoozedUntil = until`; else moment = max(moment, until).
6. `now − moment > max_age_days` → not waiting.

- [ ] **Step 1: Failing tests** in `test/queue.test.ts` (made-up names), each one assertion group:
  - `a new message in a queued conversation keeps its moment` — moment stays the first incoming's ts after a second incoming.
  - `order: oldest moment at the end of queueList; a newcomer goes first` — three conversations, the one whose first waiting is newest is `[0]`.
  - `my reply, the archive mark or an owner task link close what came before; a later incoming waits again`.
  - `an AI link does not take a conversation out of the queue` — `task_change` authored `system` with `add`.
  - `calls: missed waits, answered does not, my outgoing call answers`.
  - `requeue lifts the moment to its time; unrequeue restores the first incoming's ts`.
  - `snooze hides until "until", then waits with moment = until; unsnooze restores the old moment`.
  - `a new incoming during a snooze brings it back at once with that message's ts`.
  - `older than max_age_days does not wait; a requeue within the window does`.
  - `a group waits only for a message answering me or in my task` (moved from conversations tests).
- [ ] **Step 2: Run** `node --test test/queue.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `web/queue.js`; `conversations()` attaches `queue: queueOf(...)` (owner set built once from `tasks`), sorts by `last` (newest first) — the list order is `queueList`'s job. Remove `conversationState`; its other users are fixed in Task 3 and Task 5. Replace the state tests in `test/conversations.test.ts` with keys/channels/archive ones that remain true; delete the urgency tests (owner: no urgency order).
- [ ] **Step 4: Run** `node --test test/queue.test.ts test/conversations.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `Queue: conversations wait by the owner's actions, not by states`.

### Task 3: state consumers read the queue

**Files:**
- Modify: `web/viewswitch.js` (`waiting` = `conversation.queue.waiting`), `web/pulse.js` (`waitingHours` from `queue.moment`), `web/linkwindow.js` (rank: open one, then waiting by moment, then recent; sub-line without state words)
- Test: `test/viewswitch.test.ts`, `test/pulse.test.ts`

**Interfaces:**
- Consumes: `conversation.queue` (Task 2).
- Produces: `counterFor` unchanged signature; in Задачи its count = number of waiting conversations (the queue length).

- [ ] **Step 1: Failing tests.** Fixtures change from `state: 'mine'` to `queue: { waiting: true, moment }`: the switch on Задачи counts waiting ones; the pulse puts a conversation waiting 3 h (with `hot_wait_hours` 2) into «Горит» and one waiting 1 h not; a snoozed one (`waiting: false`) never.
- [ ] **Step 2: Run** `node --test test/viewswitch.test.ts test/pulse.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the three reads.
- [ ] **Step 4: Run** the same — Expected: PASS; then `pnpm test` — every remaining `state` user fails loudly or passes; fix the rest here.
- [ ] **Step 5: Commit** `Queue: the switch, the pulse and the link window read the queue`.

### Task 4: snooze choices — `web/snooze.js`

**Files:**
- Create: `web/snooze.js` (pure `snoozeOptions` + the small popover DOM `snoozeMenu`)
- Modify: `src/server/static.ts`, `web/sw.js`
- Test: `test/snooze.test.ts`

**Interfaces:**
- Produces: `snoozeOptions(now: Date, config) → { key, icon, label, until: string }[]` in this order: `15m`, `1h`, `3h`, then `noon` (only before `noon.until_hour`), `evening` (only before `evening.until_hour`), `tomorrow_day` (only from `tomorrow_day.from_hour`), `morning` (next day at `morning.hour`, always); `snoozeMenu(anchor, { now, config, onPick(until), onDate() })` — a popover with these icons and «📅».
- Labels: «15 мин», «1 ч», «3 ч», «в полдень», «вечером», «завтра днём», «утром», «📅 дата».

- [ ] **Step 1: Failing tests:** at 09:30 → keys `15m,1h,3h,noon,evening,morning`, noon until = today 12:00, morning = tomorrow 09:00; at 12:30 → no `noon`; at 17:30 → `tomorrow_day` (tomorrow 13:00), no `evening`; `until` values are ISO strings in the device's local time.
- [ ] **Step 2: Run** `node --test test/snooze.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `Queue: snooze choices by the time of day`.

### Task 5: the queue tile and the list

**Files:**
- Modify: `web/convlist.js` (rewrite: `tileFacts`, `convRow`; drop `splitDone`, `foldRow`, `STATE_LABELS`), `web/feed.js` (the Беседы list: `queueList`, scrolled to the bottom, no folds; the empty text), `web/convquick.js` (swipe right on a tile), `web/screens.css`
- Test: `test/conversations.test.ts` (row facts), `test/convquick.test.ts`

**Interfaces:**
- Consumes: `queueOf` result, `ownerLinked`, `snoozeMenu` (Task 4), `makeCorrection` (Task 1), `makeTaskChange`, `ownTask` (`web/shared.js`).
- Produces:
  - `tileFacts(conversation, now, config) → { kind: 'chat'|'group'|'phone'|'me', channel: string, title, task: {id, title, guessed: boolean}|null, snippet, when, waited: string, hot: boolean, count: number, counterparty: string|null, tags: string[] }` — `channel` short names `TG BY`, `TG PL`, `WA PL`, `Viber`, `SMS`/`Тел`; `task` = the most urgent open non-filed task holding a pending message (`guessed: true`), else the latest open non-filed task of the conversation (`guessed: false`), else null; `waited` like «2 ч», «3 дн»; `hot` = waited ≥ `pulse.hot_wait_hours`; `tags` — at most two of the pending messages.
  - `convRow(conversation, { onOpen, onTask, onNewTask(title), onSnooze(until), onRequeue, decorate })`.
- Tile (four lines and a small fifth, spec sketch): line 1 icon · channel — title, time on the right; line 2 the task title (with «?» when guessed; tap → `onTask`) or an input «+ задача…» (Enter → `onNewTask`); lines 3–4 the last message clamped to two lines; on the right under the time ⏱ and ↥ spanning three lines; line 5 small: `ждёт 2 ч · 3 новых · Контрагент · #метка`.
- Actions (all with a toast «Вернуть»): ⏱ → `snooze` on the latest message (undo `unsnooze`); ↥ → `requeue` (undo `unrequeue`); «+ задача…» → `ownTask(title, …)` with `add` = all pending ids (undo — cancel); swipe right → guessed task: `task_change update` by me with `add` = pending ids (confirms it; no «Вернуть» — `remove` would also drop the AI's link), owner task: open it, none: new task from pending as now.

- [ ] **Step 1: Failing tests:** `tileFacts` for a TG PL chat with two pending messages and an AI-linked task → channel `TG PL`, task guessed, count 2, waited «3 ч», hot with `hot_wait_hours` 2; a phone conversation → kind `phone`; no task → `task: null`. `convquick`: swipe right on a guessed task queues an update authored `me` with `add` = pending ids.
- [ ] **Step 2: Run** `node --test test/conversations.test.ts test/convquick.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the tile, the list (render `queueList` top→bottom, after render scroll the list to its end; keep the scroll on live redraws unless the owner is at the bottom), swipes, CSS (tile at 375 px: no horizontal scroll, buttons ≥ 40 px).
- [ ] **Step 4: Run** the same, then `pnpm test` and `pnpm typecheck` — Expected: PASS.
- [ ] **Step 5: Check in the browser** (preview, 375 px, made-up data): the oldest tile at the bottom by the input; ⏱ hides a tile and «Вернуть» brings it back to the same place; ↥ moves it to the top; a new message to a queued conversation leaves it in place.
- [ ] **Step 6: Commit** `Queue: the list is the queue — four-line tiles with snooze and to-the-end`.

### Task 6: the open conversation bar — ⏱ ↥ 🗄

**Files:**
- Modify: `web/index.html` (`#chat-bar`: buttons `#chat-snooze`, `#chat-requeue`, `#chat-archive`), `web/chatview.js`, `web/screens.css`
- Test: `test/shell.test.ts` (the buttons exist with Russian `aria-label`s «Отложить», «В конец очереди», «В архив»)

**Interfaces:**
- Consumes: `snoozeMenu` (Task 4), `makeCorrection` (Task 1), `anchorOf` (`web/convquick.js`).

- [ ] **Step 1: Failing test** in `shell.test.ts` for the three buttons.
- [ ] **Step 2: Run** `node --test test/shell.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement:** each writes its correction on the conversation's latest message, shows the toast with «Вернуть», then `leave()` to the list; leaving without an action writes nothing (owner, 2026-11-20).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `Queue: snooze, to-the-end and archive in an open conversation`.

### Task 7: left panel, the switch icon, the root and «назад»

**Files:**
- Modify: `web/drawer.js` (Беседы and Задачи: task filters always; «Беседы» button on top; «Избранные» — pinned recipients — instead of the contacts list; no «Завершённые» chip; Лента keeps sources), `web/viewswitch.js` + `web/index.html` (icon instead of the word; `aria-label` keeps words), `web/app.js` (start on Беседы; system back from Задачи with nothing open → Беседы), `web/viewpanel.js` only if the button must live inside its layouts
- Test: `test/viewswitch.test.ts` (label → icon), `test/backclose.test.ts` or a new pure `rootBack(mode, overlays) → 'conversations'|null` test

**Interfaces:**
- Consumes: `recipients.items()` (`pinned`, `chat_id`) from `web/recipients.js`.
- Produces: `favourites(items) → { key: 'tg:<chat_id>', title }[]` (pure, in `drawer.js` or a small `web/favourites.js` if `drawer.js` would pass ~300 lines).

- [ ] **Step 1: Failing tests:** `favourites` keeps pinned only, keys `tg:<chat_id>`; `rootBack('tasks', 0)` → `'conversations'`, `rootBack('conversations', 0)` → null (the system leaves the app), any overlay → null (overlays close first).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck` — Expected: PASS.
- [ ] **Step 5: Browser check** at 375 px: the panel opens with «Беседы», task filters, favourites; back from Задачи lands on the queue; the switch is an icon with its counter.
- [ ] **Step 6: Commit** `Queue: the left panel is task filters, «Беседы» and favourites; the queue is the root`.

### Task 8: docs, deploy, live check

**Files:**
- Modify: `docs/CODEMAP.md` (`queue.js`, `snooze.js`, changed rows), `PLAN.md` (stage 1 done, owner checks), `decisions.md` (the four ops and the version 2 of `registry/conversations.json`), `CONCEPT.md` §5 left panel paragraph (the stage shipped)

- [ ] **Step 1:** Update the docs.
- [ ] **Step 2:** `pnpm test` and `pnpm typecheck` — Expected: all pass.
- [ ] **Step 3:** Commit `Queue: docs`, push, deploy; `https://stream.sekond.pl/healthz` → ok.
- [ ] **Step 4:** Count on production (no message content): how many conversations wait, the oldest moment — the queue is not flooded by old history.
