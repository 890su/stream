---
project_id: stream
status: active
updated: 2026-11-19
---

# Stream — concept

> Source of truth for the idea, the model and the steps: change it first, then code. Decisions with reasons —
> `decisions.md`; open work — `PLAN.md`. Full original study with sources:
> https://claude.ai/artifact/2C1D9sLkW141UWgmN5Zco5
>
> **Language.** This document is in English for agents. **All communication with the owner is in Russian**:
> chat replies, questions, summaries, reports and every UI text. Words in «» are the exact Russian UI labels —
> keep them as they are. Code, identifiers and commit messages are in English.

## Summary

- **What.** One feed where everything lands as is: voice, text, photos, «Поделиться», Telegram BY and PL, calls
  and SMS. The system turns the stream into tasks, expenses, requests and notes. The owner keeps no lists: they
  answer, tap «Готово» and correct the triage.
- **Model.** An append-only event journal; recomputable layers over it: normalization → interpretation → tasks
  and actions. Every task leads back to its source message. Edits, archive, delete and status changes are events too.
- **Screen.** «Беседы» — who I talk to and who owes whom an answer; «Задачи» — what to do («Сегодня»,
  «Разобрать», «Жду», «Контроль»). The message feed is a technical view from the menu. Input is one row at the bottom.
- **How it works.** New messages are triaged in batches after a pause (AI now, scripts later): into a new task,
  an open task or «без дела». Nothing goes out unless the owner sends it. Stream owns the tasks; Google, Planfix,
  Todoist are mirrors.
- **How it grows.** Four extension points — source, intent, connector, automation; rules are data in `registry/`,
  not conditions in code. Every step ends in something used tomorrow; the next one comes after a week of use.

## 1. Why

The owner is disorganized by nature: postpones, piles up unfinished work, keeps no lists or reports, loses goals
and drops projects. The system does not try to change that. It takes the stream as is and itself turns it into
tasks, expenses, requests, summaries and reports.

The main risk is not technical: the system becoming one more project built instead of real work. So every step
ends in something the owner uses the next day (§7).

## 2. Model: a journal and layers over it

The system is an append-only event journal. Conversations, tasks, expenses and replies are derived from it and
can be recomputed.

| Layer | Holds | Changes? | Example |
|---|---|---|---|
| **Event** | the source as is: text, voice, photo, incoming mail, bot reply; source, author, time | never | voice note "paid 120 zł for a cable for Anna" |
| **Normalization** | transcript, text from photos, amounts, dates, people | recomputed by a new processor version | text, 120 PLN, "Anna" |
| **Interpretation** | tasks, intent, fields, tags, confidence | a new version on correction; the old one stays | intent "expense", category "materials", client "Anna", 0.86 |
| **Task** | projection of task events: status, due, roles | state = fold of events | "Buy the cable", due Friday |
| **Action** | what to send where, risk class, status, external ref | status only | "Record expense": done |
| **Conversation** | a chat by channel with its state (§2.5) | computed from the journal | chat with client A in Telegram BY |

Everything the system does is an event in the same journal too: a clarifying question, an action result, a
reminder, an analyst proposal. There is no separate service channel; any report is a filter over the journal.

### 2.1 Four extension points

Growth goes only through these; the core stays untouched.

- **Source** — where events come from: the app, «Поделиться», Telegram, the phone companion, mail, the system.
  It only writes events.
- **Intent** — a kind of intention with a field schema (task, expense, request, note, offer request), described
  as data in `registry/intents/`: schema, AI instruction, examples, thresholds, default action.
- **Connector** — where an action goes: Todoist, TickTick, Planfix, iCRM, mail, Google. Gets a ready action, never
  reads the feed.
- **Automation** — "condition over the feed → new event or action", e.g. two days after «выполнено» a draft
  "is everything working?".

### 2.2 Tags (tag = field)

A tag and a field are one concept (2026-11-11). Three kinds:

| Kind | Example | Carries |
|---|---|---|
| Plain | `#идея` | a mark only |
| With variables | `#расход` → amount, currency, client | field values from `registry/fields.yaml`, filled by triage and sent to connectors; an intent is a tag with variables |
| Link to a project or task | `#stream` | belonging to a project or task (§2.8) |

The dictionary is data in `registry/tags.json`: tag, intent, cue words. The owner creates a plain tag by typing
`#word`. AI never invents variables on the fly: it proposes, the owner accepts, the field enters the dictionary.

**Suggestions while typing.** The row above the input shows suggested tags (off), switched-on tags (lit) and
automatically switched-on tags (marked; one tap turns them off). Ranking: usage frequency (computed from the
journal, not stored), the typed text and cue words. Above the threshold (`registry/tags.json`, now 0.8) a tag
switches on by itself. No tag is "default" anywhere.

**Feedback is training data.** The event keeps `payload.data.tagging`: what was suggested, switched on
automatically, switched on by the owner and switched off by the owner, plus the suggester version. A removed
automatic tag is a classification error, an owner-added one is a miss — examples for step 3 and `golden/`.

### 2.3 Tasks inside the system

A task is a projection of the journal, and since 2026-11-17 the main entity (§2.8). Creation and every change
are `task_change` events; a task list is a query over them. Tasks from voice, client mail and automations share
one list, and each leads to its source. A task and a conversation are different entities linked by messages (§2.5).

**Stream owns the tasks** (2026-11-18, option A). Google Tasks, Google Calendar and Planfix (later Todoist,
TickTick) are mirror connectors. Changes made there return as `task_change` authored by the connector; when one
field changes on both sides, the later wins and the loser stays in the task history; a deletion there becomes a
question to the owner, not a deletion here. Which tasks go where is decided by saved filters (§5) — data.

- **Now:** title, source messages, roles (§2.8), statuses, due, plan, reminder, promise, a checklist (§2.8).
- **Later:** recurring tasks, boards on the same filters, subtasks with their own roles and dates, time tracking,
  weekly report.
- **Not doing:** collaboration inside the app (partners act through the task bot), own attachments (links to events only).

Before adding a task feature, check whether a mirror or a registry process (§2.10) already covers it.

### 2.4 Reply, edit, archive, delete

The journal is immutable, so every owner action on a message is a **new event**; the feed shows the result and
the source can always be opened.

| Action | Written to the journal | Shown in the feed |
|---|---|---|
| Reply | a new message with `reply_to` | quote of the source above the reply; the reply stays in its conversation and tasks |
| Edit | `kind: correction`, `payload.ref` → source, `data.op: edit`, new `text` and `tags` | new text, «изменено»; older versions in the history |
| Archive / unarchive | `correction`, `op: archive` / `unarchive` | hidden from the feed, visible with «Архив» on |
| Delete / restore | `correction`, `op: delete` / `restore` | gone everywhere; can be undone for a few seconds |

- Only a plain message can be edited, not another correction. Media are not edited — only text and tags.
- Of several corrections the latest by time wins.
- «Удалить» withdraws, it does not erase: the source stays in the journal and backups. Erasing personal data on
  request is a separate decision when needed.
- Corrections travel through the same device queue and live stream as messages.

**How a correction reaches triage, tasks, connectors and automations** (from step 3; now only the journal):

| Already happened | Edit | Delete | Archive |
|---|---|---|---|
| Interpretation | new version from the new text (`supersedes`) | marked withdrawn | no change |
| Class A action not yet done | rebuilt from the new version | cancelled (`rejected`) | no change |
| Class A action done (task, expense) | compensating connector action: update | compensating action: cancel (task → `cancelled`, expense → reversal) | no change |
| Class B draft | prepared again, waits for «да» | cancelled | no change |
| Class C already sent out | not undone; question «Отправлено до правки. Отправить исправление?» | not undone; question «Отправлено клиенту. Что сделать?» | no change |
| Scheduled automation | reads the **current** projection when it fires | cancelled if the source is withdrawn | fires as usual |

- Each connector operation declares in `registry/connectors.yaml` how it is undone or updated (`undo`, `update`)
  or that it is `irreversible: true`.
- A compensating action's idempotency key is "correction id + original action id": a repeated edit never sends a
  second fix.
- A task made from a message lives by its own events: archiving the message does not touch it; deleting the
  message proposes to cancel the task but never cancels silently if the task has its own changes.

### 2.5 Conversations and tasks (2026-11-18, P14)

**A conversation and a task are different entities.** A conversation is a chat with people; a task is something
to do. Messages link them: a task references messages (`add` / `remove`), and a task's conversations are those of
its messages. One conversation can hold several tasks; one task can span several conversations (a client's
request and the job given to a partner).

**Conversation** — a projection of the journal with no events of its own.
- Key — the channel: a personal chat or group in Telegram (per account), a phone number (calls and SMS), the
  task-bot chat, the owner's own «Я» (notes, AI commands). One person's conversations merge across channels once
  the contact directory exists (P7); before that — by Telegram user id.
- Participants have no roles; roles belong to tasks (§2.8).
- **State** is computed; thresholds are data (`registry/conversations.json`):

| State | When |
|---|---|
| urgent («срочно») | a linked open task is due today or overdue, or an urgency tag |
| mine («ждёт меня») | the last meaningful message is incoming and unanswered, or a linked task needs my action (new, review) |
| theirs («жду ответа») | the last message is mine, or a linked task waits for a participant |
| quiet | none of the above, with open tasks or messages younger than `quiet_days` |
| done | all linked tasks closed and no unanswered incoming for `quiet_days` |

- Order: urgent → mine → theirs (newest first inside) → quiet → done (folded).
- «ждёт меня» uses the triage outcome, not just the last message: an incoming "ok, thanks" filed as «без дела»
  waits for nothing. In a group a message waits for me only when addressed to me or part of my task. My reply in
  any channel of the conversation is an answer.
- **«Отвечено»** (2026-11-19): the owner can mark a conversation answered even when the last message is not
  theirs — a `correction` with `op: answered` on its latest message (`unanswered` undoes it). Messages up to that
  one, and tasks of the conversation with no message after it, no longer make it «ждёт меня» or «жду ответа»; a
  new message after the mark brings the state back. Urgency by due date stays.
- Inside a conversation: messages of all its channels, plaques of its tasks on top (status, executor, due). A
  reply goes through the chosen channel (the input row, §2.9); each message shows to whom, where and when.

**Message links** (2026-11-14) — hints for triage, from reliable to guessed:
1. explicit owner signals: «продолжить» on a message, «связать…» while typing, «Связать» / «Отделить»
   (`link` / `unlink` corrections), a reply;
2. cues in text without AI: shared phone, address, client, project; continuation words;
3. AI triage aware of open tasks.

An owner link beats automation; an automatic link is a recomputable layer with a processor version. Time alone is
not a link. Two matters in one message give two tasks (§2.8); the source stays unchanged.

**Counterparties and contacts** — with a directory. Its structure (a separate store, many-to-many with job
titles, contact details whose owner can change, Google sync) is open (`decisions.md`, P7). Until P7 a "person" is
a minimal record (name, Telegram user id, number) from chats and the task bot. Matching by content: one
candidate — linked; two or three — offered to choose; ambiguous or not found — stored as said (name or number);
an unknown number creates a new person.

### 2.6 Field blocks

A tag with variables (§2.2) is assembled from **field blocks** — registry data, not code:

| Block | Fields | Values come from |
|---|---|---|
| Trip | from, to, transport, start, duration, distance | message times ("leaving", "arrived"), words ("by car"), habits, later maps |
| Work | start, end, duration, remote or on site | "arrived" → "finished" |
| Payment | amount, form, account, prepaid / paid / debt | text; missing — evening summary |
| Purchase items | list: what, how many, price | receipt photo (step 2) |
| Fuel | litres, price per litre, amount, mileage | receipt photo; mileage asked if not entered for long |
| Wellbeing | mood, energy (1–5) | one-tap scales with a diary tag |

- Example: an on-site request = trip + work + payment + trip back.
- The owner fills no forms: values come from text, message times, habits and directories; whatever is missing is
  collected in one list in the evening summary, not asked on the spot.
- A new block only by the rule of three. Money stays minimal: income with «оплачено / долг» and an account;
  "who owes me" is a filter. No double-entry bookkeeping.

### 2.7 Processing, reprocessing and message versions (2026-11-14)

The source never changes; everything else is a layer named and versioned by its processor, so old messages can be
run through a new rule.

| Layer | Does |
|---|---|
| Clean text | dictation typos, punctuation, formatting; one form for phones, amounts, dates |
| Entities | minutes, kilometres, amounts with currency, phones, relative dates |
| Classification | kind of record, tags, fields |
| Links | conversation and tasks, what it continues, counterparty and contact |

**Three ways to run, one mechanism:** automatically when a rule or processor version changes (free layers — the
whole feed; AI layers — new and recent messages within the spending limit); one message — «Обработать заново» in
its actions; a batch — «Обработать всё показанное» in the filters, with a count and cost estimate first.

- Owner edits beat automation: reprocessing never overwrites them, a disagreement comes as a proposal.
- Nothing changes silently: a batch ends with a service entry "reprocessed N, changed M" with rollback.
- Text cleanup never changes meaning: amounts, names and phones change only in format.
- What was done from an old interpretation is updated by §2.4.
- A new rule first passes the golden set; if it got worse, no mass reprocessing.

**In the feed** a message is shown **processed**, not raw. A message with history or links has a history icon; it
opens the message details on the right (§5): versions swipe left and right down to the source (each says what it
is and when), next to the message's tasks. No swipe on a message in the feed: tap — action panel, long press —
selection (§5). "Linked" means the reply chain and messages of shared tasks.

### 2.8 Tasks — the main entity; batch triage (2026-11-17)

A message is raw material; the task is why it came. Everything to be done with messages becomes a task, and the
feed holds its sources. Creation and every change are `task_change` events (§2.3).

**A task has** a title, roles, a status, dates, a template (what to do — registry data), source messages (many to
many), triage confidence and its creator (triage with processor version, or the owner).

**Parties:** `me`, `ai`, `system`, `tg:<user id>`, `tel:<+digits>`, `group:tg:<chat id>` (a Telegram group as a
team), `name:<as said>` (known by name only, until P7). One Telegram user is one party across BY, PL and the task
bot. P7 will merge `tg:`, `tel:` and `name:` of one person.

**Roles** — all optional except the responsible:

| Role | Who | Default |
|---|---|---|
| author | who asked | author of the source message; my own promise — me |
| responsible | answers for the result | me if the task came to me; otherwise whom the chat asks |
| executors | who does it (several) | empty until accepted or delegated |
| controller | who checks | the responsible if the executor is someone else; me if I delegated (author me, responsible not me) |
| watchers | who is informed | conversation participants I forwarded to |
| counterparty | organization | the author's organization (P7) or chosen |

An executor can be any party: me, AI (text fixes, classification, fields), the system (a script or connector:
diary, accounting, plan), a person (through the bot, waiting for «принял»).

**Tasks without me** (2026-11-18). Triage creates tasks in every tracked chat, also where I have no role (a client
asks a partner, a partner asks another). Responsible and executor are the people in the chat, I am a watcher. Such
tasks are in the «Команда» filter only: not in my lists, they do not make a conversation «ждёт меня» and send me
no reminders.

**Statuses:** `inbox` (new, needs a decision) → `todo` (accepted) → `doing` → `waiting` (`waiting_for`: party and
date) → `review` (an executor reported, waits for checking) → `done`; plus `deferred` (until a date) and
`cancelled`. «Учтено» is a filter, not a status: `done` with no gaps in the report.

**Dates:** `due` (date or date-time), `plan` (start and duration — for Calendar), `remind_at`. **Promise:** who
promised what by when, with the quoted message. "I'll do it tomorrow" — a task for me with a due date; someone's
"I'll send the address tonight" — a `waiting` task with `waiting_for` = that person. **External copies:**
`external_refs` — ids in Google and Planfix with a sync version. Old single-assignee `task_change` events are still read.

**One-tap transitions** (in Stream and in the bot):

| Action | Change |
|---|---|
| «Принять» | executor me, `todo` |
| «Поручить…» | executor a person, team or AI; controller me; the assignment message goes out after «да» |
| «Принял» (executor) | `todo` for the executor |
| «Отложить до…» | `deferred`, `remind_at` |
| «Жду…» | `waiting`, `waiting_for` |
| «Готово» (any open status, a new task too) / «Проверил» | `done` at once; report fields of the template go to `report.missing` for the evening summary (§2.9) |
| «Готово» reported by an executor via the bot (stage 3) | `review`, a check task for me |
| Due | today / tomorrow / this week / a date |

**Act where the task is seen** (2026-11-19). Task rows and task plaques in a conversation have a round mark on the
left: tap — «Готово». Swipe right — «Готово» too; swipe left — «Когда?» (today, tomorrow, this week, a date). A tap
on the row opens details. Every action shows a toast with «Вернуть» for a few seconds; undo is a new `task_change`
restoring the previous values. The same
actions work as text or voice in «Я»: "move the call to Anna to Friday".

**Batch triage.** After a message the triage waits for a quiet window (`registry/tasks.json`: `quiet_s`, now 60 s;
`quiet_s_by_stream` for chats, now 180 s) counted from the last message of that conversation; each new message
restarts it. Then everything new is triaged together, with up to `context_messages` (now 20) earlier messages of
the same conversation from the last day as context. **A batch is a window, not one task:** each message goes to
zero, one or several tasks, including open ones (a clarification of an old task); two matters in one message give
two tasks. **Triage is a task too:** every new message has a default «разобрать» task (executor AI, later a
script). Its outcome: close at once by filing it (wellbeing → diary, a system idea → the project plan, "ok" and
chatter → «без дела»), attach to an open task, or create a task for me, the system or a person. A message without a
triage outcome is untriaged. Owner corrections (move to another task, merge, cancel) are events and golden examples.

**Which task a message belongs to** (2026-11-18). Triage sees all open tasks (latest changed,
`open_tasks_in_context`) with their last messages, chats and last activity, plus tasks closed or cancelled within
`reopen_days` (now 30).
- A message that clearly continues a closed task reopens it (`todo`) and joins it; filed tasks (diary, note,
  «без дела») are not reopened, the message just joins.
- Several likely tasks: the message goes to the most likely one, and under it appears «О каком деле?» with the
  chosen one (✓), up to three alternatives and «Новое дело». A tap moves the message (a closed task reopens);
  tapping the chosen one confirms. The answer is a task event and a golden example.

**AI now, scripts later.** The AI does all triage for now (`registry/tasks.json`: model, spending limit, templates
with instructions). A repeated scenario (rule of three, §9) gets its own script; then AI is called only for unclear
cases: no tags, low confidence, several candidate tasks. The same applies to tags and message links.

**Three shapes of work** (2026-11-19, a trial — the owner decides after using it):
- **A job** — one task with a **checklist**. In a work chat (Telegram BY / PL, phone) new requests of the same
  person about the same matter become items of their open job task: "install the program", then "also this", an
  hour later "I forgot that". A job closed within `job_days` (registry) that the person writes about again ("it
  broke again") comes back to work with a new item. When a job grows past one action, triage renames it to a
  general title ("Client A: computer setup"). One report per job.
- **Separate tasks** — the owner's own notes and personal chats (family, friends): each matter is its own task
  with its own date, grouped by tags and people in the «Задачи» view (§5), never folded into one.
- **A list** — one message that enumerates things ("buy a cable, connectors and ties") is one task with a checklist.

Triage chooses the shape from the source, the open and recently closed tasks and their items. A checklist item
is text with «сделано»; it has no roles or dates. Items live in `task_change` (`items_add`, `items_set`,
`items_remove`). Triage never renames a task the owner named. The owner corrects: «Отдельной задачей» on an item
makes it a task of its own; «В дело…» on a task moves it into another task's checklist (the moved task is
cancelled). Corrections are golden examples.

**Filed outcomes stay tasks** with `filed`: they do not affect conversation state and are excluded from default
filters, processes and mirrors.

**Task list** — the «Задачи» view (§5): saved filter «Сегодня» by default; a tap opens task details on the right.
«Сделать задачей» is in the message action panel.

### 2.9 Recipients; closing a task (2026-11-18)

**The row above the input** (2026-11-19, replaces «#» on the left and «кому» on the right):
- left — the only button, round «связь»: it opens the **link window** (below);
- then chips of what the next message carries: the chosen conversation or task, the recipient, switched-on and
  suggested tags (§2.2); × or a tap removes a chosen item;
- right — the view switch with a counter (§5);
- replying to a chat message chooses its contact as the recipient; nobody chosen — a note to myself, nothing goes
  out. Each recipient is its own send (class C) with a status under the reply; for now one recipient per message;
- a personal chat accepts text only and only within the 24-hour window (§8.2): such a recipient is struck out, and
  sending offers «Открыть» the chat in Telegram.

**Link window** — one popup with sections **Метки · Контакты · Беседы · Задачи**. In each section the most likely
items come first and a swipe left shows the less likely ones; long items (contacts, conversations, tasks) go in
pages, swiped left and right. A tap on a section title expands it to the whole window with «назад» left of the
title (search and the full list there; «+ новая метка» in Метки, the pin star in Контакты). Choosing:
- a tag — switches it on or off for the next message;
- a contact — the recipient;
- a conversation — the next message goes into it: it continues the conversation's last message, and a chat's
  contact becomes the recipient;
- a task — the next message is added to that task when sent.
Likely first: tags by the suggester (§2.2); contacts pinned, then frequent; conversations — the open one, then
«срочно» and «ждёт меня», then recent; tasks — the open one, those of the open conversation, «Сегодня», then
recently changed. The window stays on screen; nothing navigates away.

**Address book** — the start of P7: contacts and groups one can write to (personal Telegram chats, groups with the
bot; later phones and mail) — the Контакты section of the link window: pinned first, then the most frequent (from
the journal, `address_book.frequent_days` in `registry/telegram.json`). A group is a recipient too, e.g. the
partners' work group for new requests. Untracked chats and foreign groups are not in it. Pin — the star in the
expanded section (with search); pinning is a `pin` / `unpin` correction on a message of that chat.

**Closing — one tap, report later** (2026-11-19). «Готово» closes at once; no report form on closing — it
punished the owner for doing the work. Report fields required by the template go to `report.missing`: such tasks
are in «Не учтено» and the evening summary.
- When triage sees "done" about a task it does not close it silently: it sets `proposed: done` («готово?» on the
  plaque and row), and task details and its last message show «Задача выполнена?» with «Да» (closes like
  «Готово») and «Ещё нет» (drops the question).
- «Заполнить отчёт» in a closed task with gaps: fields from the template (`report_fields`, the template's `report`,
  else `report_default`): start, duration (90, 1:30, 1,5 ч), price, costs with currency, tags, a one-line result.
  Empty fields stay in `missing`. Prefilling from text and message times — with step 3.

### 2.10 Processes, task bot, mirrors (P14 stages 3–7)

Later stages, one at a time after a week of using the previous one; details and open questions in
`docs/plans/2026-11-18-p14-conversations-tasks-design.md`.
- **Processes** — rules as data (`registry/processes.json`): a task filter + a timer from a field + an action
  (remind me, ask me with a draft to people, raise the conversation, add to the summary), with spam protection
  (frequency, daily limit, quiet hours). Nothing goes to people without «да».
- **Task bot** — a separate bot: the owner gets reminders and questions with buttons; partners get assignments
  with «Принять» / «Не могу» and a report.
- **Mirrors** — Google Tasks, Calendar, Planfix (§2.3).

## 3. Pipeline

A message is saved first and processed after: if AI is down or wrong, nothing is lost.

1. **Intake.** The event is written, the owner sees «принято». No AI, instant.
2. **Normalization.** Voice → text, photo → text; amounts, dates, names found.
3. **Task.** A reply stays with its source's task. Otherwise triage finds a matching open task (time is a hint)
   or creates one; two matters give two tasks (§2.8).
4. **Intent and fields.** One `interpret()` call returns an Interpretation by schema.
5. **Decision.** By confidence and risk class: do, propose or ask.
6. **Execution.** A connector runs the action; the result with a link returns to the journal as an event.
7. **Correction.** An owner edit is a new event and a new interpretation version; edits accumulate as examples.

### 3.1 Confidence and risk class

| Class | Examples | High (≥0.85) | Medium (0.6–0.85) | Low (<0.6) |
|---|---|---|---|---|
| **A.** Internal, reversible | tag, task link, expense record, task | do | do, marked «проверь» | ask |
| **B.** Draft going out | reply to a client, offer draft | prepare, wait for «да» | prepare, wait for «да» | ask |
| **C.** Irreversible, outside | send to a client, review reply, invoice | only after confirmation | only after confirmation | not prepared |

The model's own number is poorly calibrated. Real confidence per intent is the share of interpretations accepted
without edits. Class C becomes automatic only for template messages and only after 20 confirmations in a row
without edits.

### 3.2 Clarifying questions

One question at a time, with buttons, inside the conversation. No answer within a day — the question moves to the
evening summary and the event stays a note. Processing never blocks on it.

### 3.3 Starting intents

MVP: task, expense, request, note, «не определено». Later: income, idea, reminder, document request, assistant
command. «Не определено» is a legitimate intent; its share is the main signal of what is missing.

## 4. Contracts

Versioned JSON Schemas in `contracts/`; modules talk only through them. A breaking change needs a new schema
version and a `decisions.md` entry.

| Contract | Written by | Read by | Required fields |
|---|---|---|---|
| Event | sources | pipeline, client | id, source, author, ts, kind, payload, reply_to |
| Normalized | pipeline | pipeline, client | event_id, text, entities, processor, version |
| Interpretation | pipeline via AI, owner | client, dispatcher | event_id, topic_id, intent, fields, tags, confidence, version |
| Task | dispatcher, owner | client, connectors | id, topic_id, title, status, due, priority, remind_at, source_event_id, external_refs |
| Action | dispatcher, automations | connectors | id, connector, operation, params, risk_class, status, idempotency_key, external_ref |
| Intent | owner via the registry | pipeline | name, schema, instruction, examples, thresholds, default_action |

Today tasks live as `task_change` events in Event v1 (`payload.data.task`: roles, status, dates, `proposed`,
`report`, `alternatives`). `topic_id` in Interpretation and Task v1 is legacy from the "topics" model; both schemas
are to be brought to §2.5 / §2.8 with step 3 (new versions).

## 5. Interface: our own app

Input, feed and tasks live in one app: a PWA installed on Android; later the same code in a native shell for
notifications and calls (§8). Telegram is not an input channel; it is a source of the two accounts' chats (§8.2).

**One screen: centre, filters left, details right** (2026-11-18):

| Where | Question | What |
|---|---|---|
| Centre | what am I looking at | «Беседы» or «Задачи» (switch in the input row); the technical «Лента» from the ⋮ menu |
| Left | how to narrow it | filters per view (the filter icon in the top bar) |
| Right | what is this | details of what was tapped: a task, a conversation or a message |
| Bottom | what to say | the input row, always there; above it the tags and recipients row (§2.9) |

- **Top bar** (2026-11-19): the name of the current view and the network status; on the right — filter (with the
  number of active filters), «Архив», ⋮. No tabs: the views switch in the input row.
- **View switch** — the button at the right end of the input row: «Задачи» on Беседы, «Беседы» on Задачи and Лента.
  Its counter belongs to the open context: the Беседы list — tasks for «Сегодня»; an open conversation — its open
  tasks (a tap shows Задачи filtered by it); the Задачи list — conversations «срочно» and «ждёт меня»; an open task —
  its conversations in those states (a tap opens the first of them, or its first conversation).
- **«Беседы»** — the conversation list by state (§2.5): urgent → mine → theirs → quiet → done. A row: title, last
  message, channel badge, open tasks count, state. A tap opens the conversation: messages and its task plaques on
  top; the input writes into it. Default view. **Swipes on a row:** right-to-left — «Отвечено» (§2.5); left-to-right —
  open the conversation's task (the most urgent open one) or, if it has none, make a task from its latest message
  and open it. Each with «Вернуть» in the toast.
- **«Задачи»** — a compact list of rows chosen by a saved filter. On top — chips of the main lists with counts:
  «Сегодня · Разобрать · Жду · Контроль · Ещё…» (`pinned` in `registry/filters.json`); «Ещё…» opens all lists on the
  left. Default «Сегодня»: my open tasks in sections «Просрочено · Сегодня · Проверить · Разобрать · Дальше»
  (`sections`, data; «Дальше» folded). Waiting — in «Жду», delegated — in «Контроль»; a deferred task is hidden until
  its date and returns by itself. A row: the «Готово» mark, title, with whom and what, checklist progress (2/5); due on the right. The
  last chip groups the list: «По срокам» (sections, default), «По меткам», «По людям»; the choice is remembered on
  the device.
- **«Лента»** — all messages in a row like a chat, newest at the bottom; for analysis and history (filters by tags,
  sources, people, dates; later an AI analyst selection, §9). Opened from ⋮ → «Лента сообщений» (2026-11-19);
  back — «Беседы» or «Задачи». The chosen view (Беседы or Задачи) is remembered per device; Лента is not.

**Saved task filters are data**: conditions over task fields and conversation state (field, operator, value;
and / or). System filters in `registry/filters.json`: «Сегодня», «Разобрать», «Жду» (waiting on people, involves
me), «Контроль» (I control, someone else executes, open), «Все мои», «Просрочено», «На проверке», «Команда» (tasks
without me), «Не учтено», «Готовые». The owner saves own ones from the left panel as events. Lists, a future board,
the morning three, process rules and mirrors all select tasks with the same filters.

**Left panel.** Shared across views and kept on switching: contacts and tags (with counts; selected tags filter —
a message must carry all, a task through at least one message). Per view: Беседы — state, channel,
«Завершённые»; Задачи — saved filters, role, status, due; Лента — sources, «Завершённые» (messages of finished
tasks, hidden by default). Projects become a filter with project link tags (P3). While a filter is on, the top bar
shows a reset button. **«Архив»** in the top bar works for all views (archived messages paler), off by default.
The panel sits between the top bar and the input row; opened only by the filter icon (no opening swipe — horizontal
swipes belong to rows), closed by a swipe right-to-left, the backdrop or «назад».

**Right panel** opens only on a tap: a task plaque, a task row, the task or history icon under a message, the
title over a message. A swipe left-to-right closes it.
- **Task:** title (tap — rename), status and actions (§2.8, «Готово» closes at once, §2.9; «Отменить»,
  «Вернуть», «В дело…»), due next to the actions, the checklist (tick, add, «Отдельной задачей»), roles in one
  folded line, triage note and confidence, report, «Задача
  выполнена?», the task's messages (× removes from the task), its conversations, change history.
- **Message:** versions down to the source, tags, where from and when, its tasks (tap — task details) or
  «Сделать задачей». Under a message, when triage is unsure — «О каком деле?» (§2.8).
- On a phone the panels slide over the list between the top bar and the input row. From 1100 px all three are
  visible as columns (with a hint while nothing is selected).

**Input.** Right of the field — the paper clip (photo, file) and the voice button, which becomes «Отправить» once
text or a file is there. Tags chosen in the row are saved in the event (`payload.tags`) as a hint for triage. One
feed for all devices: what is written on the phone appears on the computer at once and back. A new device connects
with the owner token: on the old one ⋮ → Доступ → «Скопировать токен», on the new one paste and «Сохранить»; the
token is never shown on screen.

**Input faster than a messenger:** at most two taps from unlock to recording. A home-screen shortcut opens voice
recording; «Поделиться» from any app sends text, a link or a screenshot; offline, the record stays on the phone and
goes later (the phone makes the event id, so a resend never duplicates). Later in the native shell: a widget and a
quick-settings tile.

**Message actions** (2026-11-14). A short tap opens the action panel (reply, edit, link, copy, archive, delete);
on a computer also «⋯» and right click. A long press (or Ctrl/Shift+click) starts selection: further taps add
messages, and instead of the input a bar for the selection appears (link, tag, copy, archive, delete); «Назад» or ×
ends it. In selection the tag row acts on all selected: «привязать», «отвязать», and tags (a tap adds the tag to all;
if all have it — removes).

**Message link picker** — for «Связать» in the action panel and a single selection (the input row uses the link
window, §2.9): search, open tasks, recent messages and «Выбрать в ленте» (a banner shows the mode, «Назад» cancels).

**Messages** (2026-11-14):
- Only linked messages share one bubble with thin dividers: a continuation right under what it continues; each
  part keeps its own time, actions and history.
- A **chain line** over a linked message: on the first — «N ниже ›»; on the others — «‹ N выше · N ниже ›», the last
  without «›». Arrows go to the neighbour in the chain; a tap opens task details of that message (or the message's
  own details). It shows links, not topics.
- Under a message on the left, icons without labels: «продолжить»; «отвязать» if the next message is linked to
  this one; «связать». On the right — time and the history icon.
- Long text is cut with «Показать полностью»; photos are thumbnails, a tap opens full screen.

**No jumps** (2026-11-18): everything that expands, collapses, appears or leaves does so smoothly (task plaques,
list rows, folded «Завершённые», panels, the link window, details, toasts; a new message slides in from below). The
system "reduce motion" setting turns animation off.

**«Система» screen** (2026-11-17) — the record of everything that works without the owner, instead of a separate
automation tool: sources, connectors and automations, each with a state (working / silent / error / needs login),
the last signal and event, queue, errors per day, and a log of runs and actions with results. Telegram bots and
the companion send a pulse; a lost pulse or login is a service message in the feed, and so is its return. Source
exclusions («Не отслеживать») and their return are here too. The pulse is current state in its own table, not the
journal; only state transitions go to the journal.

## 6. AI

Everything behind one interface `interpret(event, context) → Interpretation`; the provider is a setting.

- **Stream** (each event, triage): a cheap API model with a spending limit (~$10/month) — now Claude Haiku 5.5.
  Estimate: 100 events/day ≈ $2–5/month; voice transcription ≈ $0.005/min.
- **Heavy work** (weekly analysis, offer drafts, code): the owner's subscriptions through headless CLIs
  (`claude -p`, `codex exec`, `grok -p`) — for the owner only, never shared.
- Before sending clients' messages to a free tier of any provider, check its data-use terms.

## 7. Steps

Each step ends in something usable; the next one comes after a week of use.

### MVP

| # | Step | Done when |
|---|---|---|
| 0 | Constitution repo, golden set | contracts and registry exist; 50 real messages in `golden/` |
| 1 | Journal and fast input | PWA on the phone; voice, text, photo, «Поделиться», offline queue; nothing is lost |
| 2 | Normalization | voice and photos become text |
| 3 | Interpretation | intent, fields, tags, confidence; ≥80% of the golden set without edits |
| 4 | Feed | conversations, tasks, filters, «верно» / «исправить» |
| 5 | Tasks | projection from the feed, views, Web Push reminders |
| 6 | Rituals | morning three, evening summary |

Pulled ahead of the plan because the owner needed them: phone calls and SMS (§8.1), Telegram BY and PL (§8.2),
tasks with roles and AI triage (§2.8). Still outside the MVP: external task managers, Planfix, iCRM, offers, reviews.

### After the MVP (order by value for naserwis.pl)

| # | Stage | Extension point |
|---|---|---|
| 1 | Finance from the feed: expense and income log, monthly export | automation + report |
| 2 | Requests and clients in a CRM: iCRM or Planfix connector (Planfix REST API — paid plan only; `silent=true`) | connector |
| 3 | Check after a job: two days after «выполнено» — "is everything working?", then a review request | automation, class B |
| 4 | Mail: Gmail API or IMAP | source + connector |
| 5 | Offers on request: templates and prices in the registry, a draft from the client conversation | intent + document connector |
| 6 | Google reviews: API by application, profile ≥60 days; fallback — notification mails | source + connector |
| 7 | More messengers: WhatsApp BY / PL, Viber, IP telephony — like §8.2 | source + connector |
| 8 | Android companion: reading notifications (§8) | source |

## 8. Phone: Android companion

| Capability | How |
|---|---|
| See push notifications of all apps | notification listener; access enabled by hand |
| Reply in a messenger from a notification | the notification's «Ответить» |
| Call log and SMS, "what was it?" after a call | call log and SMS permissions, a notification with a reply field (§8.1) |
| Recording a call | usually unavailable to third-party apps; dictate the outcome |

Limits: since Android 15 notifications with one-time codes are hidden from such apps; an app outside the store
needs «Разрешить ограниченные настройки» by hand; exclude it from battery saving. Never published on Google Play —
a personal tool. Other people's messages are their personal data: store only tracked chats, the rest is turned off
with «Не отслеживать» (§8.2).

### 8.1 Calls and SMS in the journal (2026-11-17)

Every incoming, outgoing and missed call and every SMS is an event; after a call the owner describes what it was
about and how it ended. The PWA cannot see the call log or SMS, so events come from a separate source
`android_phone`.

- **Call** — `kind: call`: direction (incoming, outgoing, missed, rejected), number, name from the phone's
  contacts, start and duration. What the phone did not give stays empty; the event is still written.
- **SMS** — `kind: sms`: direction (in, sent), number, name, time; the text is `payload.text`, so tags, links and
  triage work as for any message. Classic SMS only (RCS chats and MMS are invisible to third-party apps). Senders
  with a letter name (banks, delivery, services — codes and alerts) are not saved by default; exceptions are set
  in the companion.
- **Call note** — an ordinary continuation message of the call (`continuation`): it joins the call's conversation
  and tasks and is triaged like any text. A call without a note is an evening-summary item (step 6).
- **In the feed** a call is a bubble «📞 Входящий · 4 мин · name or number» with «Описать»; an SMS — «✉ Входящее SMS
  · name or number» with the text. Someone else's SMS text is never edited.
- **Right after a call** the phone shows «О чём был звонок?» with a reply field; the answer goes in as the note.
  No notification after an SMS — the text is already there.
- **Server intake** — `/api/phone/*` with a separate phone token that can only write calls, SMS and notes. The id
  is built from number, time (and SMS text): a resend never duplicates.
- A number is linked to a directory contact later (P7). Numbers, names and SMS texts are personal data: database
  only, never git.

**Companion «Stream · телефон»** — a small separate Kotlin app; Stream stays a PWA. After a call and on an incoming
SMS it checks the call log and SMS, sends what is new (offline — a queue), shows the after-call notification, and
re-checks every 15 minutes (so sent SMS and anything missed still arrive). Almost no screen of its own: server
address, phone token, permissions, SMS exceptions. Built to move into a shared Stream shell (TWA) if one icon is
needed; notification reading goes there later (§8).

### 8.2 Telegram: two accounts' chats in the feed (2026-11-17)

The owner has two Telegram accounts: BY (work in Belarus) and PL (work in Poland). They hold clients and requests,
partners (personal and in groups), suppliers and subcontractors who get unsuitable jobs, and also family, friends
and acquaintances. Everything relevant must reach the feed, and a reply must go from the feed to the same chat from
the same account.

**Connected officially, through bots** (instead of a login "as one more device"). Each account has its bot —
«Stream BY» and «Stream PL». The owner connects it in Telegram: «Настройки → Telegram для бизнеса → Чат-боты»
(no Premium needed). The Stream server reads both bots' updates and sends replies through them — no extra
processes or logins; bot tokens are secrets in `.env`. Anyone who knows a bot's name could connect it, so **a
foreign connection does nothing** until the owner confirms it on the «Система» screen.

| Chat | How it reaches the feed | How to drop it |
|---|---|---|
| Personal chat | via the bot connection; which chats the bot sees is chosen in Telegram (all / selected, exceptions) | «Не отслеживать» in Stream; undo on «Система» |
| Group | the account's bot added as a member (visible as «Stream BY / PL») | remove the bot or «Не отслеживать» |
| Channel, Saved Messages, Telegram service chat | never | — |

- **«Не отслеживать» ≠ «В архив».** Archive hides one message but keeps and triages it. «Не отслеживать» stops
  writing that chat: no storage, no triage cost. What was written stays in the journal; Stream offers to archive it.
- **No history.** A bot sees messages only from the moment it is connected or added; Telegram does not give it old
  chats. After server downtime of up to a day the missed updates still arrive.

**Journal.** Incoming and own messages (also those written in Telegram itself) are ordinary `text`, `voice`,
`photo`, `file` events with `source: telegram`: own — `author: me`, others — `author: contact:…`.
`payload.data.telegram` holds the account (`by` / `pl`), chat, its kind and title, sender, message number, what it
replies to and where it was forwarded from. Voice, video notes, photos and documents up to 20 MB are downloaded
(voice is transcribed in step 2); larger ones — «файл не скачан». An edit in Telegram is a correction over the
source; a deletion is marked «удалено в Telegram», the message does not disappear.
- **The account sets the sphere:** BY bot — work BY, PL bot — work PL. Personal life (family, friends) is separated
  by contact roles (P7) and triage, not by settings.
- **Forwarding to a subcontractor** links itself to the original request: Telegram gives the author and time of the
  original message, so the forward becomes its continuation.

**In the feed** a bubble headed «Telegram BY · name» (in a group «group · author»); tasks from chats are built by
links and triage (§2.8); the left panel filters by source (mine, Telegram BY, Telegram PL, phone).

**Reply from Stream.** The recipient is chosen in the input row or the link window (§2.9); replying to a chat message preselects it.
Sending is the confirmation (class C, connector `telegram_by` / `telegram_pl`, operation `send_message`). In a
personal chat the reply goes as the account. No recipient — a note to myself; nothing leaves by accident. From
step 3 AI prepares a draft (class B).
- **24-hour window.** A bot can reply only in a chat with an incoming message within the last 24 hours; otherwise
  Stream says so at once and offers «Открыть чат в Telegram».
- **In a group** the bot writes as itself («Stream BY» / «Stream PL»), not as the owner — fine for sending a request
  to the partners' group; to write as yourself — «Открыть чат в Telegram».
- A repeat never sends twice; if the server fell during sending, the reply is marked «проверьте в Telegram» instead
  of being sent again.

**Limits.** Secret chats are out of reach. Bots only read and send replies on the owner's command — no mass
messaging. People's messages are personal data: only on our server, never in git; AI triage follows §6.

## 9. Growth through an AI analyst

Once a week an analyst reads an export of the feed and the registry (through contracts, not the database) and
puts proposals into the feed — ready registry edits the owner accepts or rejects.

| Signal | Proposal |
|---|---|
| many «не определено» with similar meaning | a new intent with schema and examples |
| one field is often fixed by hand | a corrected instruction or a new field |
| the same thing done by hand three times | an automation |
| one service mentioned often | a connector or source |
| a conversation silent >7 days with open tasks | «закрыть, отложить или следующий шаг?» |
| 20 confirmations in a row without edits | raise the auto-execution threshold |

Against procrastination — three rituals over the feed: morning (three things), evening (summary, untriaged,
questions, «Не учтено»), week (forgotten things resurfacing, client promises without a mark).

## 10. Postponed and not doing

- Microservices, queues, a vector database — until there is a measured reason.
- Several users in the app: one owner; partners take part only through the task bot.
- Recording calls ourselves.
- Publishing the apps in stores.

## 11. Open questions

- Contact and counterparty directory (P7): store, Google sync, overlap with iCRM — `decisions.md`.
- Planfix: a plan with API access for the mirror (P14 stage 7).
- The naserwis.pl Google profile: is it verified and since when (for reviews).
