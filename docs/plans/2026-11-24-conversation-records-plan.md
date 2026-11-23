# Беседа → записи: разбор без тем — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop topics; the triage reads a conversation with the interlocutor's records and returns actions — link (applied), update (proposed), create, create done, ask — and «✨» on a record proposes corrections.

**Architecture:** Revert the 14 topic commits back to v19, keep the journal readable (old `kind`/`offer` fields), migrate topic records in the same deploy. Then grow the existing planner/triage pair (`src/tasks/planner.ts`, `src/tasks/triage.ts`) to v21, with new focused files for the interlocutor's context, apply rules, questions and the record recheck. Three deploys, each usable on its own.

**Tech Stack:** Node 24 + TypeScript run directly (`node --test`), SQLite journal (`src/store`), plain-JS PWA (`web/`, no bundler), Anthropic structured output (`src/tasks/anthropic.ts`).

**Spec:** `docs/plans/2026-11-23-conversation-records-design.md` (approved 2026-11-24).

## Global Constraints

- UI text in Russian, code / identifiers / commits in English; each new file has an English header comment, ≤ ~300 lines (CONTEXT rule 14).
- Journal is append-only: no UPDATE/DELETE of events; every change, migration included, is a new event with a deterministic id (rule 1, 8).
- New `web/*.js` module → `VERSIONED` in `src/server/static.ts` and `web/sw.js` (a test checks).
- Processor of the new triage: `triage-ai-v21` (`registry/tasks.json` `ai.processor`); recheck: `recheck-ai-v1`.
- Contract changes are non-breaking optional fields, each with a `decisions.md` entry (rule 13; `CONTEXT.md` «Контракты»).
- Nothing real in git: `golden/conversations.jsonl` is made up; real cases only in `golden/*.local.jsonl` (rule 15).
- Example cases in the spec are illustrations: instruction rules are written generally, not per example (spec «Решения владельца»).
- v21 ships only if on `pnpm golden` missed tasks ≤ v19 and duplicates < v19 (spec «Эталон»).
- Checks before every commit: `pnpm test`, `pnpm typecheck`. Deploy: commit, push, `ssh srv-150 sudo -n bash /srv/stream/app/deploy/install.sh main`, then `https://stream.sekond.pl/healthz` is ok.

## Review Focus

1. A task the owner named (`owner_titled`) is linked by v21 and must never get a rename proposal applied silently — pinned in Task 6.
2. A link the owner removed with «↩» must not be re-added by the next triage or «✨ Разобрать заново» for the same record — pinned in Task 6.
3. A phone still holding offline `task_change` events with `kind` / `offer` after deploy 1: they are accepted and change nothing — pinned in Task 2.
4. The AI names a `task_id` or a question option that is not among the interlocutor's records: treated as new / option dropped, never written — pinned in Task 6.
5. «🗄» on a conversation with an open question: it leaves the queue and the question stays answerable in the card, not lost — pinned in Task 7.

---

## Deploy 1 — topics gone, the interlocutor's records in context

### Task 1: Concept and decisions first

**Files:**
- Modify: `CONCEPT.md` (Summary, §2.5, §2.8 — replace topic text; add «Записи собеседника», actions table, «всё распределено», вопрос ИИ, повтор после «готово»)
- Modify: `decisions.md` (new entries, dated 2026-11-24)

- [ ] **Step 1:** In `CONCEPT.md` §2.5/§2.8 write the model from the spec sections «Модель», «Разбор беседы», «Очередь — всё распределено», «Сделанная работа» (English, labels in «»). Remove topic wording added by `5cc3a7b`.
- [ ] **Step 2:** `decisions.md` entries: (a) topics dropped, why (owner quote); (b) v15 partly revoked — system `link` applied, content changes proposed; (c) v12 rule revoked — requests of family are tasks; (d) a closed record is not reopened — a repeat is a new record with `repeat_of`; (e) the queue holds a conversation while the AI waits for the owner (record, proposal, question); (f) contract: `task_change` keeps optional `kind`/`offer` (read for migration only), adds optional `repeat_of`; `triage_result` adds optional `questions`.
- [ ] **Step 3:** Commit `Concept: conversation to records, topics dropped`.

### Task 2: Revert topics, keep the journal readable, migrate

**Files:**
- Revert: commits `cbb09b9`…`2c2e9ca` (`git revert --no-commit cbb09b9^..2c2e9ca`)
- Modify: `src/contracts/task.ts` (task_change still allows `kind: 'topic'|'task'`, `offer: boolean`)
- Modify: `src/tasks/fold.ts:91-92` and `web/taskfold.js` (same rule): an owner change whose only keys are `kind`, `offer`, `proposal` does not clear `unconfirmed`
- Create: `src/tasks/topicsgone.ts`
- Modify: `src/main.ts` (run the migration once at start, after the store opens)
- Modify: `src/store/ailog.ts` (`replaceKinds(kinds: string[], at: string): number` — pending decisions of those kinds → `replaced`)
- Modify: `web/cardhead.js` (remove the «задача» switch, `toggle` and its `on.toggle`), its caller and CSS
- Test: `test/topicsgone.test.ts`, `test/validation.test.ts`, `test/taskfold.test.ts`

**Interfaces:**
- Produces: `migrateTopics({ store, live, at }: { store: JournalStore; live: LiveFeed; at: string }): { tasks: number; cancelled: number; unconfirmed: number }`

- [ ] **Step 1: Revert** — run the revert; resolve nothing by hand except `PLAN.md` / `docs/CODEMAP.md` (take the pre-topic text; they are rewritten in Task 4). `pnpm test` must pass on the reverted tree before going on (topic tests are gone with the revert).
- [ ] **Step 2: Failing tests**

```ts
test('old task_change events with kind and offer still validate', ...)      // validateEvent(...{ kind:'topic', offer:true }) ok
test('an owner change of only kind/offer does not confirm an AI task', ...) // fold: unconfirmed stays true
test('migrateTopics: AI topic with offer → unconfirmed task', ...)          // event id `topics-gone|<task>`, change { op:'update', kind:'task', unconfirmed:true }
test('migrateTopics: other AI topics → cancelled «Темы убраны»', ...)      // status 'cancelled', reason 'Темы убраны', even if the owner replied into them
test('migrateTopics: a topic the owner created stays an open task', ...)    // no event
test('migrateTopics twice writes nothing new', ...)                         // second run → { tasks:0, ... }
test('pending AI log decisions topic/topic_link/propose_task → replaced', ...)
```

- [ ] **Step 3:** Implement. A topic = last `kind` in the record's `task_change` events is `'topic'` (read raw events, the fold no longer knows topics). `created_by === 'me'` → skip.
- [ ] **Step 4:** `pnpm test`, `pnpm typecheck` — PASS.
- [ ] **Step 5:** Commit `Topics reverted; topic records migrate to tasks or close`.

### Task 3: The interlocutor's records in the triage context

**Files:**
- Create: `src/tasks/triagecontext.ts`
- Modify: `src/tasks/triage.ts` (replace the global `open` / `closed` selection, ~lines 150-158 after revert)
- Modify: `registry/tasks.json` (`"others_in_context": 10`), `src/config.ts` type
- Test: `test/triagecontext.test.ts`

**Interfaces:**
- Produces:

```ts
export interface Interlocutor { key: string; parties: Set<string>; counterparties: Set<string> }
export function interlocutorRecords(tasks: Task[], who: Interlocutor, keysOf: (task: Task) => Set<string>,
  { now, reopenDays, others }: { now: number; reopenDays: number; others: number }): { open: Task[]; closed: Task[] }
```

`keysOf` — conversation keys (`conversationOf`) of a record's messages; a record is the interlocutor's when (a) `keysOf(task).has(who.key)`, (b) any role party ∈ `who.parties`, (c) `task.counterparty ∈ who.counterparties`. `open` = theirs open + up to `others` most recently updated open records of others; `closed` = theirs closed within `reopenDays`. No limit of 40 for theirs.

- [ ] **Step 1: Failing tests**

```ts
test('an old open task of this client is in context although 50 others changed later', ...)
test('a task found by role party and one by counterparty are both in', ...)
test('others are capped at 10 and are only open ones', ...)
test('closed ones only within reopen_days and only the interlocutor\'s', ...)
```

- [ ] **Step 2:** Implement; in `triage.ts` build `Interlocutor` from the batch (`conversationOf(batch[0])`, parties of batch + context messages except `me`, counterparties via `personOf` / `peopleOf` from the directory).
- [ ] **Step 3:** `pnpm test` — PASS (existing `test/triage.test.ts` must not need changes beyond the context shape).
- [ ] **Step 4:** Commit `Triage sees the interlocutor's records, not the last 40 of everyone`.

### Task 4: Golden runner and conversation cases; deploy 1

**Files:**
- Create: `src/tasks/goldenscore.ts` (pure), `scripts/golden.ts`, `golden/conversations.jsonl`
- Modify: `package.json` (`"golden": "node --disable-warning=ExperimentalWarning scripts/golden.ts"`), `golden/README.md`
- Modify: `docs/CODEMAP.md`, `PLAN.md`
- Test: `test/goldenscore.test.ts`

**Interfaces:**
- Produces:

```ts
export interface GoldenCase { id: string; records: PlanTask[]; context: PlanMessage[]; messages: PlanMessage[];
  expect: { create?: { message_ids: string[]; template?: string; done?: boolean }[]; link?: { task_id: string; message_ids: string[] }[];
            nothing?: string[]; ask?: boolean } }
export interface GoldenScore { cases: number; missed: number; extra: number; duplicates: number; wrong_link: number; asked: number }
export function scoreCase(expected: GoldenCase['expect'], output: PlanOutput): Omit<GoldenScore, 'cases'>
```

missed — an expected create/link whose messages are in no output task; extra — an output create holding only `nothing` messages; duplicates — an output create (`task_id: null`) holding messages expected as `link`; wrong_link — linked to another `task_id`; asked — `questions` non-empty (v21; 0 for v19).

- [ ] **Step 1:** Failing tests for `scoreCase` — one per counter, with tiny hand-made outputs.
- [ ] **Step 2:** Implement `scoreCase`; `scripts/golden.ts` reads `golden/conversations.jsonl` and `golden/*.local.jsonl` if present, builds `PlanInput` (now = case time), calls `anthropicPlanner(process.env.ANTHROPIC_API_KEY)`, prints per-case line and totals + `usage` cost; exits 1 without a key.
- [ ] **Step 3:** Write ≥ 8 made-up cases covering: a family request to send something; a family request to call; remote work asked, done, «готово» in one session (create done); work talk with no request (nothing); a continuation of an open record (link, no create); a repeat after a closed record (create with repeat_of in v21; in v19 scored as link-or-create); a vague message between two open records (ask); a tagged `#задача` message inside chatter.
- [ ] **Step 4:** Run `pnpm golden` against the current (v19) prompt; write the totals into `PLAN.md` as the baseline.
- [ ] **Step 5:** Update `docs/CODEMAP.md` (new files, topics gone) and `PLAN.md` (topics item replaced by this work, «❓» for the owner). Commit, push, deploy, check `/healthz`; on the server confirm the migration counts in the log.

## Deploy 2 — triage v21

### Task 5: Planner v21 — output and instruction

**Files:**
- Modify: `src/tasks/planner.ts`, `registry/tasks.json` (`ai.processor: "triage-ai-v21"`)
- Test: `test/planner.test.ts`

**Interfaces:**
- Produces (added to `PlanOutput` / `PlannedTask` / `PlanMessage`):

```ts
PlanMessage.directive?: string[]        // owner tags that order the triage (registry/tags.json "directive": true)
PlannedTask.repeat_of?: string | null   // a closed record this repeats (new record, never a reopen)
PlanOutput.questions: PlannedQuestion[]
export interface PlannedQuestion { message_ids: string[]; text: string; options: { label: string; task_id: string | null; title: string | null; template: string | null; nothing: boolean }[] }
```

Instruction rules (replace the v12/v17/v20 exception list; keep v10 title rule, v17 free consultation, v18 `unfinished`, v19 `need_earlier`): continuation → existing record first; request / promise / agreed visit → task whoever asks; doubt task-vs-nothing → task (unconfirmed by mode); doubt which record → question with 2–3 options; request + execution inside the conversation → `task_id:null, done:true, report`; closed record asked again → new task with `repeat_of`; money → template `money`; notes / ideas only from my own input unless tagged; directive tag → must yield its kind or a question; no mandatory outcome per message; `conversation_only` — what needs no reply.

- [ ] **Step 1:** Failing tests: `PLAN_SCHEMA` requires `questions` (array, options shape); instruction text contains the rules by key phrases (`продолжение`, `repeat_of`, `не обязательно`), no longer contains `лишняя задача хуже пропущенной`.
- [ ] **Step 2:** Implement; `pnpm test` — PASS.
- [ ] **Step 3:** `pnpm golden` with v21; compare to the baseline. Gate: missed ≤ baseline and duplicates < baseline, else revise the instruction and rerun (do not continue to Task 6 until the gate holds). Record totals in `PLAN.md`.
- [ ] **Step 4:** Commit `Triage v21: records from the conversation, questions when unsure`.

### Task 6: Applying v21 — link, proposals, done work, repeats, questions, directive tags

**Files:**
- Create: `src/tasks/triageapply.ts` (the per-outcome rules taken out of `triage.ts`)
- Modify: `src/tasks/triage.ts`, `src/contracts/task.ts` (`repeat_of?: string`), `registry/tags.json` (`"directive": true` on `#задача`, `#расход`, `#заметка`, `#идея`; add `#доход` intent `money`, `#поручить`), `src/tasks/retriage.ts` (also withdraw untouched system links and open questions of the batch)
- Modify: `src/server/events.ts` or the tag-correction path: a directive tag added to an already triaged message marks its session for an immediate run (`triage.rerun(messageId)`)
- Test: `test/triage.test.ts`, `test/triageapply.test.ts`, `test/retriage.test.ts`

**Interfaces:**
- Consumes: `PlanOutput` v21 (Task 5), `interlocutorRecords` (Task 3).
- Produces:

```ts
export type Applied =
  | { kind: 'link'; task_id: string; add: string[] }                                  // system task_change, applied
  | { kind: 'proposal'; task_id: string; message_ids: string[]; change: Record<string, unknown> } // in triage_result.proposals
  | { kind: 'create'; task_id: string; change: Record<string, unknown> }               // incl. done work and repeats
export function applyPlanned(planned: PlannedTask, ctx: ApplyContext): Applied[]
triage_result.payload.data.triage.questions?: { id: string; message_ids: string[]; text: string; options: PlannedQuestion['options'] }[]
Triage.rerun(messageId: string): Promise<number>
```

Rules: open non-filed target → `link` (add only messages not in it and not removed by the owner from it before) + `proposal` with only content keys (`items_*`, `rename`→`title` unless `owner_titled`, `due`, `proposed:'done'` + report, project, counterparty) when any; closed non-filed target → `create` with `repeat_of`; `task_id:null` + `done` → `create` with `status:'done'`, `report` draft, template; no «Разобрать» fallback task; unknown `task_id` → `create`; question options with unknown `task_id` dropped, a question with < 2 options dropped. A link the owner removed = an owner `task_change` with `remove` containing that message for that task.

- [ ] **Step 1: Failing tests** (scripted planner, made-up texts)

```ts
test('a continuation is linked at once and its new item is only proposed', ...)
test('an owner-titled task gets no title change even if the AI renames', ...)
test('a message the owner removed from a task is not linked back to it', ...)
test('a closed task asked again → a new unconfirmed task with repeat_of', ...)
test('work done in the conversation → a done task with a report draft', ...)
test('messages the AI left out create no «Разобрать» task', ...)
test('an unknown task_id becomes a new task; unknown options are dropped', ...)
test('questions are written in the triage result with ids', ...)
test('a directive tag added after triage reruns that session once', ...)
test('«Разобрать заново» withdraws untouched system links and open questions', ...)
```

- [ ] **Step 2:** Implement; `triage.ts` must end ≤ ~300 lines.
- [ ] **Step 3:** `pnpm test`, `pnpm typecheck` — PASS.
- [ ] **Step 4:** Commit `Triage v21 applies links, proposes changes, records done work and repeats`.

### Task 7: The queue — «всё распределено»

**Files:**
- Modify: `web/queue.js` (`unfinishedOf`, the `'me'` early return), `web/conversations.js` if questions need to reach the conversation
- Create: `web/questions.js` (pure: `questionsByMessage(events)` — waiting questions, answered by a `correction` `answer_question` from the owner or withdrawn by a later result)
- Modify: `src/contracts/correction.ts` (op `answer_question` with `question`, `option` index or `text`)
- Test: `test/queue.test.ts`, `test/questions.test.ts`, `test/correction.test.ts`

**Interfaces:**
- Produces: `questionsByMessage(events: JournalEvent[]): Map<string, { id: string; text: string; options: object[]; messageIds: string[] }>`; `queueOf(...).open` reasons add `'ИИ спрашивает'` and `'ИИ предлагает правку'`.

- [ ] **Step 1: Failing tests**

```ts
test('my reply does not take a conversation out while a question waits', ...)
test('a waiting update proposal holds the conversation', ...)
test('a done-work record does not hold the conversation', ...)
test('🗄 takes it out; the question stays in questionsByMessage', ...)
test('the «Я» conversation waits while an AI record or question from it waits, else not', ...)
test('answer_question validates option index or text', ...)
```

- [ ] **Step 2:** Implement; `pnpm test` — PASS.
- [ ] **Step 3:** Commit `The queue holds a conversation while the AI waits for me`.

### Task 8: Screens — link mark, question line, «Всё распределено ✓», «Я» in contacts; deploy 2

**Files:**
- Create: `web/linkmark.js` (under a message: «→ «название» ↩» for system links; ↩ writes owner `task_change` `remove`), `web/askline.js` («❓ текст» + option buttons + «Своими словами…»; an answer writes `answer_question` and the chosen change: link / create / nothing)
- Modify: `web/bubble.js` (link mark), `web/cardhead.js` and `web/convlist.js` (question line where «ИИ: «…»» is; tile shows «❓ …»), `web/queuehome.js` (empty — «Всё распределено ✓ · разобрано сегодня: N»; not empty — title «Ждут решения: N»), the contacts panel (first row «Я · мои записи»), `src/server/static.ts` + `web/sw.js` (`VERSIONED`)
- Test: `test/askline.test.ts`, `test/linkmark.test.ts`, `test/service-worker.test.ts` (existing check)

- [ ] **Step 1:** Failing tests for the pure parts: `askChoices(question, tasksById)` (labels, dropped unknown), `answerEvents(question, choice)` → the events written; `linkMarks(view, tasksById, events)` → only system links not removed.
- [ ] **Step 2:** Implement; `pnpm test`, `pnpm typecheck` — PASS.
- [ ] **Step 3:** Browser check at 375 and 1440 px on made-up data (`pnpm start` with a temporary `DATA_DIR`): a question on a tile, answering it moves the conversation out, «↩» on a link, empty queue screen.
- [ ] **Step 4:** Update `docs/CODEMAP.md`, `PLAN.md` (v21 golden totals, «❓» for the owner); commit, push, deploy, `/healthz`.

## Deploy 3 — «✨» on a record, assignment draft

### Task 9: «✨ Сверить с перепиской» on a record

**Files:**
- Create: `src/tasks/recheckplan.ts` (input/output types, `RECHECK_SCHEMA`, instruction), `src/tasks/recheck.ts` (gathers conversations, calls, writes one `triage_result` with `recheck: <task id>` and `proposals`), `web/recheck.js` (list of proposals in the card with ✓ ✕)
- Modify: `src/tasks/anthropic.ts` (`anthropicRechecker(apiKey, baseURL?): Rechecker`), `src/server/http.ts` (`POST /api/tasks/:id/recheck` → 200 `{ proposals: n }`, 409 without a key or over budget), `web/taskdetails.js` (button «✨ Сверить с перепиской»), `VERSIONED` + `web/sw.js`
- Test: `test/recheck.test.ts`, `test/recheckview.test.ts`

**Interfaces:**
- Produces:

```ts
export interface RecheckInput { now: string; record: PlanTask; others: PlanTask[]; messages: (PlanMessage & { in_record: boolean; owner_linked_elsewhere: boolean })[] }
export interface RecheckProposal { kind: 'add' | 'remove' | 'rename' | 'due' | 'items' | 'status' | 'merge'; message_ids: string[]; value: string | null; target_task_id: string | null; reason: string }
export type Rechecker = (input: RecheckInput) => Promise<{ proposals: RecheckProposal[]; usage?: { input_tokens: number; output_tokens: number } }>
export function recheck({ store, live, rechecker, taskId }: {...}): Promise<{ proposals: number }>
```

Messages: the record's conversations from the session before its first message to now (`sessionsOf`, `contextSessions`), ≤ `max_batch` × 3. Each proposal becomes a `triage_result` proposal `{ id, task_id, message_ids, reason, change, also? }`; `merge` → `change` adds the duplicate's messages and items, `also: [{ task_id: <dup>, change: { op:'update', status:'cancelled', reason:'Склеено с «…»' } }]`. Nothing applied by the server. Owner-linked messages of other records are never proposed for `add`.

- [ ] **Step 1: Failing tests** (scripted rechecker): proposals written, none applied; owner-titled record gets a rename only as a proposal; `merge` carries `also`; unknown `target_task_id` dropped; accepting in `web/recheck.js` writes `change` and every `also`.
- [ ] **Step 2:** Implement; `pnpm test`, `pnpm typecheck` — PASS.
- [ ] **Step 3:** Commit `«✨» on a record proposes corrections from its conversations`.

### Task 10: `#поручить` — a draft to the person; deploy 3

**Files:**
- Modify: `src/tasks/triageapply.ts` (directive `#поручить` with a named person → `create` with `executors: [<party>]` and `draft: <text>` in the task change), `web/composer.js` (a draft waiting for that party opens in the input of the conversation with them, not sent)
- Test: `test/triageapply.test.ts`, `test/outbound.test.ts` or the composer test that exists

- [ ] **Step 1:** Failing tests: a `#поручить` message names a known person → task with that executor and a draft; unknown person → a question; nothing is sent (no outbound action written).
- [ ] **Step 2:** Implement; `pnpm test`, `pnpm typecheck` — PASS.
- [ ] **Step 3:** Browser check on made-up data; `docs/CODEMAP.md`, `PLAN.md`; commit, push, deploy, `/healthz`.
