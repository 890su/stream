# Очередь «Новые · Ждут решения · Прочитанные» и переписка задачи с 💬 — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a conversation leaves the queue only by my act or after N quiet days; unread is visible; AI decisions are
not lost on archiving; in the task card 💬 switches «по задаче» (write to several) and «чат» (one person).

**Architecture:** the queue stays a pure projection (`web/queue.js`) over journal events; «прочитано» is a new
correction op `read`; the auto-archive term is an owner setting on the server (`src/ownersettings.ts`), sent in
`/capture-config.json`. Sending to several is N ordinary replies with a shared `outbound.broadcast` id.

**Tech Stack:** Node 24 TypeScript server (no build), plain-JS PWA in `web/` (no bundler), `node --test`.

**Spec:** `docs/plans/2026-11-25-read-queue-and-task-talk-design.md`

## Global Constraints

- UI text in Russian; code, identifiers, commits in English (`CONTEXT.md`).
- One file — one job, up to ~300 lines, an English header comment; a new feature — a new file (`CONTEXT.md` rule 14).
- A new `web/*.js` module goes into `VERSIONED` in `src/server/static.ts` and `web/sw.js` (a test checks).
- Contract changes: `contracts/event.schema.json` + `decisions.md` entry.
- Made-up data only in tests and fixtures; no real names, numbers, messages (`CONTEXT.md` rule 15).
- Concept first: `CONCEPT.md` and `decisions.md` change before code (Task 1, Task 8).
- Full `pnpm test` and `pnpm typecheck` before each commit; on Windows a few server tests may fail with `ETIMEDOUT` in
  parallel — rerun those files with `node --test --test-concurrency=1 <files>`.
- Two deploys: after Task 7 (queue) and after Task 12 (card). Deploy: commit, push, then
  `ssh -i ~/.ssh/id_ed25519 admin890brain@192.168.0.149 'sudo -n /usr/bin/bash /srv/stream/app/deploy/install.sh main'`,
  check `https://stream.sekond.pl/healthz`.
- Values from the spec: auto-archive default **3** days, range 1–30, 0 = never; section titles «Новые», «Ждут решения»,
  «Прочитанные»; sheet buttons «✓ Оставить», «✕ Отказаться», «Потом», «В архив», «Отмена»; input hints «→ Имя · канал»,
  «Сообщение для N: Имя, Имя», «Комментарий к задаче».
- Kept (owner, 2026-11-25): the head toggle «По задаче / Вся переписка с …» (acts like 💬) and the long-press list
  «Кому отправить» on «Отправить» (choosing selects only that person with that channel).

## Review Focus

1. A group chat full of chatter must not flood «Новые»: only replies to me and messages of tasks where I have a role
   count (the existing `matters` rule) — test in Task 3.
2. I replied, but the AI still waits (question / unconfirmed task) → «Ждут решения», not «Прочитанные» — test in Task 3.
3. Auto-archive boundary: exactly N days of quiet archives; `0` never archives; snoozed ones are not archived early —
   test in Task 3.
4. A new incoming message in an archived (or auto-archived) conversation brings it back to «Новые» — test in Task 3.
5. Sending to several when one selected person has no chat or is muted: that person is skipped with a notice, the rest
   get it — test in Task 9.

## Rulings made while planning

- **No `read_since` migration.** «Unread» = incoming after `max(read mark, my last handling)`. My reply, 🗄 and my task
  already count as handling, so on deploy everything handled is read and what waits now stays new — no events needed.
  Cost if wrong: a burst of «новых» on deploy; visible at once, fix is one line.
- `queueOf` keeps `waiting` meaning «on the queue screen (any section)», so `archiveList`/`handledToday` stay as they are.

---

### Task 1: Concept and decisions for the queue

**Files:** Modify `CONCEPT.md` (§2.5 Conversations and tasks, §5 the queue paragraphs), `decisions.md`.

- [ ] **Step 1:** In `CONCEPT.md` §2.5/§5 replace the rule «my reply takes a conversation out» with the three sections,
  «прочитано» (opening = read, stored as `read`), the archive only by 🗄 / my task / N quiet days (default 3, in ⋮),
  AI «finished» no longer archives, and the «Перед архивом — решить» sheet. Point to the design doc.
- [ ] **Step 2:** `decisions.md` entry «2026-11-25 — Очередь: Новые · Ждут решения · Прочитанные; архив — моим действием
  или через N дней», with Why (the salon case in general terms, no names) and the rejected options from the design.
- [ ] **Step 3:** Commit `Concept: queue sections, read mark, auto-archive after quiet days`.

### Task 2: The `read` mark

**Files:** Modify `src/contracts/correction.ts` (`CORRECTION_OPS`), `web/projection.js` (correction switch ~line 123);
Test `test/projection.test.ts`, `test/correction.test.ts`.

**Interfaces:**
- Produces: correction op `'read'` (target — a message id, no extra fields); view fields `read: boolean`,
  `readAt: string` (the correction's ts) on the target view.

- [ ] **Step 1: Failing tests** — `test('a read mark marks its message read', …)`: project `[incoming, correction(read → incoming)]`
  → view `read === true`, `readAt === correction.ts`; the server accepts `{ op: 'read' }` with 201 and rejects an
  unknown op as before.
- [ ] **Step 2:** Run `node --test test/projection.test.ts` → FAIL.
- [ ] **Step 3:** Add `'read'` to `CORRECTION_OPS`; in `project()` `case 'read': view.read = true; view.readAt = correction.ts; break;`
  and default `read: false` in the view literal.
- [ ] **Step 4:** Tests pass. Commit `Correction op read: the owner has seen messages up to this one`.

### Task 3: Queue sections in `queue.js`

**Files:** Modify `web/queue.js` (`queueOf`, `queueList`, header comment); Test `test/queue.test.ts`.

**Interfaces:**
- Consumes: view `read`/`readAt` (Task 2); `config.queue.archive_read_days` (number, Task 4; default **3** when absent).
- Produces: `queueOf(...)` returns, besides today's fields, `section: 'new' | 'decide' | 'read' | null` and
  `unread: number`; `waiting` is true for any non-null section. `queueList(list)` orders by section (new, decide, read),
  inside «new»/«decide» by `moment` ascending (longest waiting first), inside «read» by `moment` ascending (freshest at
  the bottom). New export `SECTION_TITLES = { new: 'Новые', decide: 'Ждут решения', read: 'Прочитанные' }`.

Rules (the spec's, as code decisions):
- `handledAt` for unread: `max(handled, latest readAt-target ts)` where `handled` is today's loop (my message, answered,
  decided, owner-linked, answered call). `unread` = today's `pending` filter applied after that moment.
- `new` — `unread > 0` (snooze logic as today applies to it).
- `decide` — no unread and `unfinishedOf(...)` returns a reason (AI waits, verdict unfinished, task day); `open` as today.
- `read` — no unread, no reason, not cleared after its last message (`clearedAt` < latest message ts or a later
  `requeue`), last activity (`max(last message ts, readAt, my acts)`) at or after `queue.since`, and
  `now - lastActivity < archive_read_days` days (`archive_read_days === 0` — no limit). Its `moment` = last activity,
  lifted by `requeue`. A live snooze hides it (`snoozedUntil`, as today).
- Otherwise `NONE` (archive).

- [ ] **Step 1: Failing tests** (made-up conversations, fixed `now`):
  - `unread incoming → section new, unread = 2`
  - `opened (read mark on the last incoming) → section read, unread = 0`
  - `my reply without a task → section read, not archive` (the spec's main rule)
  - `my reply while an unconfirmed AI task waits → section decide` (Review Focus 2)
  - `verdict finished does not archive: read`
  - `🗄 (answered) → null section; a new incoming after it → new` (Review Focus 4)
  - `read and quiet 3 days → archived; 2 days 23 h → read; archive_read_days 0 → read after 30 days` (Review Focus 3)
  - `a snoozed read conversation is hidden until the snooze ends, then read with moment = snooze end`
  - `group chatter that is not a reply to me → not new` (Review Focus 1)
  - `queueList orders new, decide, read; read freshest last`
- [ ] **Step 2:** `node --test test/queue.test.ts` → the new tests FAIL.
- [ ] **Step 3:** Implement in `queueOf`; keep `queue.js` under ~300 lines — if it grows past, move `taskDayOf`,
  `handledAt`, `myActs` to a new `web/queueacts.js` (add to `VERSIONED`).
- [ ] **Step 4:** All queue and conversations tests pass (adjust old expectations that encoded «reply →
  archive», each with a comment pointing to the decision 2026-11-25). Commit `Queue sections: new, awaiting decision, read; auto-archive after quiet days`.

### Task 4: The auto-archive term as an owner setting

**Files:** Modify `src/ownersettings.ts`, `src/server/http.ts` (`/api/settings/...`, `/capture-config.json`),
`web/settings.js` (the ⋮ dialog), `web/index.html` (the field); Test `test/ownersettings.test.ts`, `test/api.test.ts`.

**Interfaces:**
- Produces: `OwnerSettings#archiveReadDays(): number` (default 3), `setArchiveReadDays(n: number)` (integer 0–30, else
  throws); `POST /api/settings/archive-read-days` `{ value: n }` → 200 / 400 «Нужно число дней от 0 до 30»;
  `/capture-config.json` → `conversations.queue.archive_read_days`.

- [ ] **Step 1: Failing tests:** default 3; saving 5 survives a new `OwnerSettings` on the same file; 31 and 1.5 → 400;
  capture-config carries the saved value.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. In the ⋮ dialog: a number field «Прочитанные беседы — в архив через [3]
  дн. (0 — никогда)»; on change POST, then set `config.conversations.queue.archive_read_days` in memory and redraw.
- [ ] **Step 4:** Tests pass. Commit `Owner setting: read conversations go to the archive after N days`.

### Task 5: The queue screen and the read mark on opening

**Files:** Modify `web/queuehome.js` (section headers), `web/convlist.js` (`tileFacts`: `count` = `queue.unread`;
class `unread` on the tile when `unread > 0`), `web/viewswitch.js` / `web/feed.js` (`waitingCount` = new + decide),
`web/chatview.js` (mark read), `web/feed.css`; Test `test/conversations.test.ts` (tile facts and queue nodes) or a new `test/queuehome.test.ts`.

**Interfaces:**
- Consumes: `section`, `unread`, `SECTION_TITLES` (Task 3); `makeCorrection(id, 'read')` (`web/shared.js`).
- Produces: `readMark(conversation): string | null` in `web/convquick.js` (pure) — the id of the latest incoming view
  when `conversation.queue.unread > 0`, else null.

- [ ] **Step 1: Failing tests:** `tileFacts` shows «2 новых» from `unread`, none when 0; `readMark` returns the latest
  incoming id only with unread; queue nodes carry headers «Новые · 2», «Ждут решения · 1», «Прочитанные» in that order
  and no header for an empty section; the empty-state line «Всё распределено ✓» shows when new and decide are empty
  (read ones still listed under it).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. On opening a conversation (`chatView.open`) and on a live message while
  it is open, queue `makeCorrection(readMark(conversation), 'read')` when not null (one per opening; no toast).
- [ ] **Step 4:** Tests pass; browser check at 375 px on made-up data (three sections, opening moves a tile from
  «Новые» to «Прочитанные»). Commit `Queue screen: sections, unread count, opening marks read`.

### Task 6: «Перед архивом — решить»

**Files:** Create `web/archivesheet.js` (add to `VERSIONED`); Modify `web/convquick.js` (`archive`), `web/chatview.js`
(#chat-archive), `web/screens.css`; Test `test/archivesheet.test.ts`.

**Interfaces:**
- Consumes: `questions`, `proposals` maps and `tasksById` (as `queueOf` gets them), `conversation.tasks`.
- Produces: `archiveDecisions(conversation, { questions, proposals, tasksById }) → [{ kind: 'task' | 'question' | 'proposal', id, title, item }]`
  (pure: unconfirmed open AI tasks, waiting v21+ questions and proposals of this conversation, as `aiWaitOf` sees them);
  `openArchiveSheet(decisions, { keep(item), reject(item), answer(item, option), done(), cancel() })` (DOM).

- [ ] **Step 1: Failing tests** for `archiveDecisions`: an unconfirmed task → one `task` item; a closed one → none; an
  old v20 proposal → none; empty → `[]`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. 🗄 (button and swipe): no decisions → archive as today; else the sheet:
  per item «✓ Оставить» (task: confirm — the same change as ✓ in the head), «✕ Отказаться» (task: reject; proposal:
  `reject_proposal`), a question's options (as `askline.js`), «Потом» (leave it); bottom «В архив» (archives) and
  «Отмена». Esc / outside tap = «Отмена».
- [ ] **Step 4:** Tests pass; browser check (archive with an unconfirmed task: «✓ Оставить» confirms and archives).
  Commit `Archive asks first about the AI's open decisions`.

### Task 7: «Ждут решения ИИ» in Задачи; docs; deploy A

**Files:** Modify `web/viewstate.js` / the «Неподтверждённые» view to add a section «Ждут решения ИИ» listing waiting
questions and proposals with their controls (reuse `askline.js`, `proposals.js`) and a link to the conversation;
`docs/CODEMAP.md`, `PLAN.md`; Test the pure list builder `aiDecisionsList(questions, proposals, tasksById)` in
`test/archivesheet.test.ts` (place it in `web/archivesheet.js`).

- [ ] **Step 1: Failing test:** `aiDecisionsList` returns waiting v21+ items oldest first, skips answered and those on
  closed tasks.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; an answer here does not requeue the conversation.
- [ ] **Step 4:** `pnpm test`, `pnpm typecheck` pass. Update `docs/CODEMAP.md` (queue.js, convquick.js,
  archivesheet.js, ownersettings.ts) and `PLAN.md` (an «In progress — проверки владельца» entry with ❓ for the phone).
- [ ] **Step 5:** Commit, push, deploy, check healthz and that `/v/<hash>/queue.js` contains `SECTION_TITLES`.

---

### Task 8: Concept, decisions and contract for sending to several

**Files:** Modify `CONCEPT.md` §5 (task card), `decisions.md` (supersede «Отправки нескольким сразу нет» of 2026-11-24),
`contracts/event.schema.json` (`outbound.broadcast`); Test `test/api.test.ts` (posting a reply through `/api/events`).

**Interfaces:** Produces `payload.data.outbound.broadcast` — a UUID shared by the replies of one sending.

- [ ] **Step 1: Failing test:** a reply with `outbound.broadcast: <uuid>` is accepted; `broadcast: 'x'` → 400.
- [ ] **Step 2:** FAIL. **Step 3:** Schema property `"broadcast": { "type": "string", "format": "uuid" }` with a
  description; CONCEPT and decisions text per the design (💬, tile per person, channel icon in place of 📣, kept toggle
  and long-press list).
- [ ] **Step 4:** Pass. Commit `Concept and contract: one message to several task participants`.

### Task 9: Pure helpers for the card (`tasktalk.js`)

**Files:** Modify `web/tasktalk.js` (split to `web/taskreach.js` if it passes ~300 lines; add to `VERSIONED`); Test
`test/tasktalk.test.ts`.

**Interfaces:**
- Consumes: `partyConversation`, `replyChats`, `accountTitle`.
- Produces:
  - `partyChat(party, taskViews, conversations, override = null) → chat | null` — `override` (a chat key chosen by long
    press) if it is among the person's reply chats; else the chat of the person's latest message in `taskViews`; else
    the latest of `replyChats(partyConversation(party))`; groups never.
  - `sendTargets(parties, { taskViews, conversations, muted, overrides }) → { chats: chat[], skipped: party[] }` —
    one chat per selected person; muted ones and people without a chat go to `skipped` (Review Focus 5).
  - `threadLabel(view, nameOf, recipients = []) → string` — «Анна → я · TG BY» for theirs, «я → Анна, Пётр» for mine.
  - `broadcastGroups(thread) → thread` — entries of one `outbound.broadcast` merged into one with `recipients` and
    `deliveries` (per chat).
  - `channelIcon(account) → string` — the short mark shown in place of 📣 (TG BY / TG PL / WA / Viber / SMS).
  - `recipientHint(...)` extended: two or more → «Сообщение для N: Имя, Имя».
- [ ] **Step 1: Failing tests** for each export with made-up parties (`tg:501`, `tel:+48600100200`), including Review
  Focus 5 and «a person with TG and WA who last wrote by WA → WA».
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** Pass. Commit `Task talk helpers: a chat per person, targets, labels, broadcasts`.

### Task 10: The composer sends to several

**Files:** Modify `web/composer.js` (move the outbound send into a new `web/outsend.js` to keep `composer.js` from
growing — it is already ~350 lines; add to `VERSIONED`); Test `test/outsend.test.ts`.

**Interfaces:**
- Consumes: `outboundData`, `phoneAnswerable` (`web/outbound.js`), `makeEntry`.
- Produces: `broadcastEntries(chats, { text, tags, tagging, continuation, replyView, config }) → Promise<entry[]>` —
  one entry per chat, each with `outbound.broadcast` = one new UUID when `chats.length > 1` (none for one chat);
  `reply_to_message_id` only for the chat the quoted message is in. Composer API: `composer.chooseMany(chats)` (empty —
  back to the single recipient logic), `composer.hint(text)` unchanged.
- [ ] **Step 1: Failing tests:** two chats → two entries, same broadcast id, each its own connector/chat_id; one chat →
  no broadcast; the quoted Telegram message id only on its own chat.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; the send queues all entries, then clears the input once; a failure on
  one entry leaves the others queued and names the failed person.
- [ ] **Step 4:** Pass. Commit `Composer: one message to several chats as a broadcast`.

### Task 11: The card — 💬, multi-select tiles, channel icon

**Files:** Modify `web/details.js` (talk state), `web/taskdetails.js` (`peopleStrip`, scope), `web/participants.js`
(tile: channel icon in place of 📣, multi-selected look, long press), `web/cardtalk.js` (thread labels, broadcast
bubbles), `web/screens.css`.

**Interfaces:**
- Consumes: Task 9 helpers, `composer.chooseMany` (Task 10), `openRecipientSheet` (`web/recipientsheet.js`) for the
  channel choice.
- Produces talk state `{ scope: 'task' | 'chat', chosen: party[] (task scope), party (chat scope), channels: { [party]: chatKey }, order, swiped }`.

Behaviour (spec): 💬 left of the tiles, on at opening; task scope — tap toggles a person in `chosen` (chosen first in
the row), default `chosen = [last writer]`, none → «Комментарий к задаче»; chat scope — tap opens that person's whole
conversation, exactly one chosen; the head toggle switches the same scope; «Ответить» → `chosen = [that person]`
(chat scope: that person) and quotes; the long-press «Кому отправить» → only that person with that channel; long press
on a tile with 2+ chats → channel sheet; a person without a chat in task scope → toast «нет чата для ответа», not
selected. Opening a person in chat scope marks that conversation read (`readMark`, Task 5).

- [ ] **Step 1:** Write the state transitions as a pure `talkNext(state, action)` in `web/tasktalk.js` (or
  `taskreach.js`) with failing tests: toggle in task scope, single in chat scope, reply, scope switch keeps the last
  chosen person as `party`, comment when none.
- [ ] **Step 2:** FAIL. **Step 3:** Implement `talkNext`, wire the DOM.
- [ ] **Step 4:** Tests pass; browser check at 375 px on made-up data: two selected → hint «Сообщение для 2: …», send →
  two replies in the journal with one broadcast id, one bubble in the thread with two ticks; 💬 off → tap opens the full
  chat. Commit `Task card: 💬 switches task talk and chat; several recipients; channel on the tile`.

### Task 12: Docs and deploy B

- [ ] **Step 1:** `pnpm test`, `pnpm typecheck`.
- [ ] **Step 2:** `docs/CODEMAP.md` (tasktalk/taskreach, outsend, participants, details), `PLAN.md` entry with ❓ for
  the phone; move the queue entry's «проверено» line if the owner already checked.
- [ ] **Step 3:** Commit, push, deploy, check healthz and the served `/v/<hash>/outsend.js`.
