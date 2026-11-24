import type { TriageNewTasks } from '../ownersettings.ts';
import { createHash } from 'node:crypto';
import type { JournalStore } from '../store/store.ts';
import type { JournalEvent } from '../contracts/validate.ts';
import type { LiveFeed } from '../server/live.ts';
import type { SourceState } from '../store/status.ts';
import { tasksConfig } from '../config.ts';
import { nameId } from '../ids.ts';
import { stateChanged } from '../server/system.ts';
import { foldTasks } from './fold.ts';
import { describe, from, hasForwardOrigin, messageDirection } from './messages.ts';
import { nameTasks, type Namer } from './namer.ts';
import { foldPeople, foldCounterparties, personOf, peopleOf } from '../contacts/fold.ts';
import { foldProjects, defaultProject } from './projects.ts';
import { partyOfEvent } from './parties.ts';
import type { AiDecision } from '../store/ailog.ts';
import type { PlanInput, PlanMessage, PlanOutput, PlannedQuestion, Planner } from './planner.ts';
import { interlocutorRecords } from './triagecontext.ts';
import { conversationOf, contextSessions, before, sessionsOf } from './sessions.ts';
import { applyPlanned, ownerRemoved, questionsOf, rolesFor } from './triageapply.ts';
import { directiveOf } from './directive.ts';
import { secondLookOf, type SecondLook } from './retriage.ts';
import { streamOf, quietOf } from './streams.ts';

export { streamOf, quietOf }; // where callers have always found them

// Task triage (CONCEPT.md §2.8): new messages wait for a quiet window per stream (a chat, the phone, my own
// notes), then go together to the planner with the interlocutor's records. Since v21 its outcomes are applied by
// triageapply.ts: links to open records at once, content changes proposed, new records, done work and repeats;
// questions when the AI is unsure where messages belong. Messages it leaves out are just conversation.

export const TRIAGE_SOURCE = 'ai_triage';

export class Triage {
  #store: JournalStore;
  #live: LiveFeed;
  #planner: Planner | null;
  #namer: Namer | null;
  #reason: string;
  #timer?: ReturnType<typeof setInterval>;
  #busy = false;
  #chain: Promise<unknown> = Promise.resolve();
  #newTasks: () => TriageNewTasks;

  // `planner` null — triage is off (no AI key); `reason` says why on the System screen.
  // `namer` — titles of tasks the owner made by hand (namer.ts); none — they keep the text they were made from.
  // `newTasks` — how new tasks are made (src/ownersettings.ts, v16): `unconfirmed` waits for the owner's ✓.
  constructor({ store, live, planner, namer = null, reason = 'нет ключа ИИ', newTasks = () => 'confirmed' }: { store: JournalStore; live: LiveFeed; planner: Planner | null; namer?: Namer | null; reason?: string; newTasks?: () => TriageNewTasks }) {
    this.#newTasks = newTasks;
    this.#store = store;
    this.#live = live;
    this.#planner = planner;
    this.#namer = namer;
    this.#reason = reason;
  }

  #health(state: SourceState, detail: string | null) {
    const month = new Date().toISOString().slice(0, 7);
    const week = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const info = { model: tasksConfig.ai.model, spent_usd: Number(this.#store.triage.spent(month).toFixed(4)), budget_usd: tasksConfig.ai.monthly_budget_usd, quiet_s: tasksConfig.quiet_s, quiet_s_by_stream: tasksConfig.quiet_s_by_stream,
      decisions: this.#store.ailog.stats(week), new_tasks: this.#newTasks() }; // the AI log over 7 days and the mode, for the System card
    const previous = this.#store.status.pulse(TRIAGE_SOURCE, state, detail, info, new Date().toISOString());
    stateChanged(this.#store, this.#live, TRIAGE_SOURCE, state, previous, detail);
  }

  // Groups of one conversation (v19: as in the queue — sessions.ts) whose newest message is older than the quiet
  // window of its channel, each cut to max_batch.
  ready(now = Date.now()): JournalEvent[][] {
    const since = new Date(now - tasksConfig.lookback_h * 3_600_000).toISOString();
    const conversations = new Map<string, JournalEvent[]>();
    for (const event of this.#store.triage.pending(since)) {
      const key = conversationOf(event);
      conversations.set(key, [...(conversations.get(key) ?? []), event]);
    }
    return [...conversations.values()]
      // A message the owner tagged with a directive tag (directive.ts) does not wait for the quiet window (v21).
      .filter((events) => now - Date.parse(events.at(-1)!.received_at!) >= quietOf(streamOf(events.at(-1)!)) * 1000
        || events.some((event) => directiveOf(describe(event, this.#store).tags).length))
      .map((events) => events.slice(0, tasksConfig.max_batch));
  }

  // `again` — a second look (`secondLook`): a fresh key for the same messages, run once per key; `withdrawn` — the
  // proposals and questions it replaces, listed in the new result (web/proposals.js); `unlink` — the system links it
  // takes back, unless the new look links them again; `cancel` — the AI's unconfirmed records it replaces (not shown).
  async run(batch: JournalEvent[], { again, withdrawn = [], unlink = [], cancel = [] }: SecondLook & { again?: string } = {}): Promise<number> {
    const tasks = foldTasks(this.#store.triage.taskEvents(), { filedTemplates: tasksConfig.templates.filter((template) => template.filed).map((template) => template.name) });
    const projects = foldProjects(this.#store.triage.projectEvents()).filter((project) => project.status === 'active');
    const directory = this.#store.triage.contactEvents();
    const people = foldPeople(directory);
    const counterparties = foldCounterparties(directory);
    const taskOf = (id: string) => tasks.filter((task) => task.messages.includes(id)).map((task) => task.id);
    const snippet = (id: string) => { const event = this.#store.getEvent(id); return event ? describe(event, this.#store).text.slice(0, 160) : ''; };
    const asContext = (task: (typeof tasks)[number]) => {
      const events = task.messages.slice(-5).map((id) => this.#store.getEvent(id)).filter((event): event is JournalEvent => Boolean(event));
      return { id: task.id, title: task.title, assignee: task.assignee, roles: task.roles, status: task.status, recent: task.messages.slice(-3).map(snippet),
        chats: [...new Set(events.map(streamOf))], last_at: events.at(-1)?.ts ?? task.updated_at, project: task.project ?? null,
        items: task.items.map((item) => ({ text: item.text, done: item.done })), owner_titled: task.owner_titled };
    };
    const toMessage = (event: JournalEvent, text: string, tags: string[], directive: string[] = []): PlanMessage => {
      const continuation = event.payload.data?.continuation as { target: string; on: boolean } | undefined;
      const linked = [event.reply_to, continuation?.on ? continuation.target : undefined].filter(Boolean) as string[];
      return {
        id: event.id, time: event.ts, source: streamOf(event), from: from(event), party: partyOfEvent(event), text, tags,
        direction: messageDirection(event), ...(hasForwardOrigin(event) ? { forwarded: true } : {}),
        ...(event.reply_to ? { reply_to: event.reply_to } : {}), ...(continuation?.on ? { continues: continuation.target } : {}),
        in_tasks: [...new Set([event.id, ...linked].flatMap(taskOf))],
        default_project: defaultProject(projects, streamOf(event))?.id ?? null,
        person: personOf(partyOfEvent(event), people)?.name ?? null, ...(directive.length ? { directive } : {}),
      };
    };
    const messages: PlanMessage[] = [];
    const skipped: string[] = [];
    if (!batch[0]?.received_at) return 0;
    for (const event of batch) {
      const view = describe(event, this.#store);
      if (view.deleted || !view.text.trim()) { skipped.push(event.id); continue; }
      messages.push(toMessage(event, view.text.slice(0, 2000), view.tags, directiveOf(view.tags)));
    }
    // Context (v19, sessions.ts): the conversation's messages before this batch, from the last session back as many
    // sessions as the AI asks for; a batch alone may not say what it is about.
    const stream = streamOf(batch[0]!);
    const key = conversationOf(batch[0]!);
    const inBatch = new Set(batch.map((event) => event.id));
    const start = [...batch].sort((a, b) => (before(a, b) ? -1 : 1))[0]!;
    const recent = this.#store.triage.messages(new Date(Date.now() - tasksConfig.history_days * 86_400_000).toISOString());
    const history = recent.filter((event) => !inBatch.has(event.id) && conversationOf(event) === key && before(event, start));
    // A record's conversation keys come from its own messages (any age), looked up once and only when needed.
    const keyCache = new Map<string, string | null>();
    const keyOf = (id: string) => {
      if (!keyCache.has(id)) { const found = this.#store.getEvent(id); keyCache.set(id, found ? conversationOf(found) : null); }
      return keyCache.get(id)!;
    };
    const contextAt = (steps: number) => {
      const { events, more } = contextSessions(history, { gapMs: tasksConfig.session_gap_h * 3_600_000, steps, limit: tasksConfig.session_messages });
      const context = events.map((event) => ({ event, view: describe(event, this.#store) }))
        .filter(({ view }) => !view.deleted && view.text.trim())
        .map(({ event, view }) => toMessage(event, view.text.slice(0, 1000), view.tags));
      return { context, more: more && steps < tasksConfig.earlier_max };
    };
    let steps = 0;
    let { context, more } = contextAt(steps);
    const at = new Date().toISOString();
    if (!messages.length) { this.#store.triage.mark(skipped, 0, at); return 0; }
    // The interlocutor's records (triagecontext.ts): the parties of the batch and its context, their counterparties.
    const parties = new Set([...messages, ...context].map((message) => message.party).filter((party) => party !== 'me'));
    const theirCounterparties = new Set([...parties].flatMap((party) => personOf(party, people)?.roles.map((role) => role.counterparty) ?? []));
    const { open, closed } = interlocutorRecords(tasks.filter((task) => !cancel.includes(task.id)), { key, parties, counterparties: theirCounterparties },
      (task) => new Set(task.messages.map(keyOf).filter((item): item is string => Boolean(item))),
      { now: Date.now(), reopenDays: tasksConfig.reopen_days, others: tasksConfig.others_in_context });
    const base: Omit<PlanInput, 'context' | 'earlier_available'> = {
      now: at, job_days: tasksConfig.job_days, projects: projects.map(({ id, title, kind, sections, scope }) => ({ id, title, kind, scope, sections })),
      templates: tasksConfig.templates.filter((template) => !template.legacy),
      counterparties: counterparties.filter((item) => item.status === 'active').map(({ id, kind, title, address, side }) => ({ id, kind, title, address, side,
        people: peopleOf(id, people).map(({ person, title: job }) => (job ? `${person.name} (${job})` : person.name)) })),
      open_tasks: open.map(asContext),
      closed_tasks: closed.map(asContext),
      messages,
    };
    const batchIds = new Set(messages.map((message) => message.id));
    const batchKey = createHash('sha256').update([...batchIds].sort().join(',') + (again ? `|again|${again}` : '')).digest('hex').slice(0, 16);
    const resultId = nameId(`triage-result|${batchKey}`);
    if (again && this.#store.getEvent(resultId)) return 0; // this second look ran already
    const price = tasksConfig.ai.price_per_mtok;
    const ask = async (input: PlanInput, id: string): Promise<{ output: PlanOutput; cost: number }> => {
      const output = await this.#planner!(input);
      const cost = output.usage ? (output.usage.input_tokens * price.input + output.usage.output_tokens * price.output) / 1e6 : 0;
      if (output.usage) this.#store.triage.addUsage(at.slice(0, 7), output.usage.input_tokens, output.usage.output_tokens, cost);
      // The AI log (src/store/ailog.ts): every run — what the AI was shown and answered, a step back included.
      const { usage, ...answer } = output;
      this.#store.ailog.run({ id, at, processor: tasksConfig.ai.processor, model: tasksConfig.ai.model, stream, messages: messages.length,
        input_tokens: usage?.input_tokens ?? 0, output_tokens: usage?.output_tokens ?? 0, cost_usd: cost, input, output: answer });
      return { output, cost };
    };
    let runId = nameId(`ai-run|${batchKey}`); // the run whose answer is used: decisions point to it
    let { output } = await ask({ ...base, context, earlier_available: more }, runId);
    // The last session did not say what the new messages are about: the session before it, at most earlier_max times.
    while (output.need_earlier && more) {
      steps += 1;
      ({ context, more } = contextAt(steps));
      runId = nameId(`ai-run|${batchKey}|${steps}`);
      ({ output } = await ask({ ...base, context, earlier_available: more }, runId));
    }
    const filedTemplates = new Set(tasksConfig.templates.filter((template) => template.filed).map((template) => template.name));
    const prior = this.#store.getEvent(resultId);
    const stored = prior?.payload.data?.triage as { conversation_only: string[] } | undefined;
    const conversationOnly = new Set((stored?.conversation_only ?? output.conversation_only).filter((id) => batchIds.has(id)));
    this.#store.ailog.prune(new Date(Date.parse(at) - tasksConfig.ai_log.keep_days * 86_400_000).toISOString());
    const decisions: AiDecision[] = [];
    const decide = (key: string, kind: AiDecision['kind'], taskId: string | null, ids: string[], confidence: number | null, reason: string | null, status: AiDecision['status'] = 'auto', id = nameId(`ai-decision|${batchKey}|${key}`)) =>
      decisions.push({ id, run_id: runId, at, kind, task_id: taskId, message_ids: ids, confidence, reason: reason?.slice(0, 500) ?? null, status });
    if (conversationOnly.size) decide('conversation_only', 'conversation_only', null, [...conversationOnly], null, null);
    const rolesOf = rolesFor([...messages, ...context]);
    let written = 0;
    const write = (id: string, taskId: string, change: Record<string, unknown>) => {
      try {
        const result = this.#store.appendEvent({ id, schema_version: 1, source: 'system', author: 'system', ts: at, kind: 'task_change', payload: { ref: { type: 'task', id: taskId }, data: { task: change } } });
        if (result.created) { this.#live.publish(result.event); written += 1; }
      } catch (error) { console.error('Triage: task change rejected', error instanceof Error ? error.message : error); }
    };
    // Links a second look takes back (retriage.ts): one it makes again stays as it is.
    const unlinked = new Map(unlink.map((link) => [link.task_id, new Set(link.message_ids)]));
    const proposals: Record<string, unknown>[] = [];
    const ctx = { batchKey, batchIds, conversationOnly, open: new Map(open.map((task) => [task.id, task])), closed: new Map(closed.map((task) => [task.id, task])),
      removed: ownerRemoved(this.#store.triage.taskEvents()), unlinked, projects, counterparties, filedTemplates, newTasks: this.#newTasks(), roles: rolesOf,
      directed: new Set(messages.filter((message) => message.directive?.includes('#поручить')).map((message) => message.id)), knownPerson: (party: string) => Boolean(personOf(party, people)) };
    const asked: PlannedQuestion[] = []; // questions the rules make themselves (#поручить without one known person)
    output.tasks.forEach((planned, index) => {
      const confidence = Math.max(0, Math.min(1, planned.confidence));
      const reason = planned.reason?.trim().slice(0, 500) || null;
      for (const applied of applyPlanned(planned, { ...ctx, index })) {
        if (applied.kind === 'question') asked.push(applied.question);
        else if (applied.kind === 'proposal') {
          // Content of an existing record is only proposed (v15): the owner answers ✓ ✕.
          const id = nameId(`proposal|${batchKey}|${index}`);
          proposals.push({ id, task_id: applied.task_id, message_ids: applied.message_ids, reason: reason ?? '', confidence, alternatives: [], change: { op: 'update', ...applied.change } });
          decide(`${index}|update`, 'update', applied.task_id, applied.message_ids, confidence, reason, 'pending', id);
        } else if (applied.kind === 'link') {
          const taken = unlinked.get(applied.task_id);
          const add = applied.add.filter((id) => !taken?.delete(id)); // a withdrawn link made again: still in the task
          if (add.length) write(nameId(`task-change|${batchKey}|${index}`), applied.task_id, { op: 'update', add, ...(reason ? { reason } : {}) });
          decide(String(index), planned.filed ? 'filed' : 'link', applied.task_id, applied.add, confidence, reason);
        } else {
          write(nameId(`task-change|${batchKey}|${index}`), applied.task_id, applied.change);
          decide(String(index), planned.filed ? 'filed' : 'create', applied.task_id, applied.change.add as string[], confidence, reason);
        }
      }
    });
    for (const [taskId, ids] of unlinked) if (ids.size) write(nameId(`unlink|${batchKey}|${taskId}`), taskId, { op: 'update', remove: [...ids], reason: 'Разобрано заново' });
    for (const taskId of cancel) write(nameId(`withdraw|${batchKey}|${taskId}`), taskId, { op: 'update', status: 'cancelled', reason: 'Разобрано заново' });
    if (again) this.#store.ailog.replace(withdrawn, cancel, at, [...unlinked].filter(([, ids]) => ids.size).map(([task_id, ids]) => ({ task_id, message_ids: [...ids] })));
    const questions = questionsOf([...(output.questions ?? []), ...asked], { batchKey, batchIds, known: new Set([...open, ...closed].map((task) => task.id)) });
    for (const question of questions) decide(question.id, 'question', null, question.message_ids, null, question.text, 'pending', question.id);
    // What stays in the conversation, what is proposed and whether the conversation is over (on the batch's last
    // message — web/queue.js): one triage result per batch, written once, always.
    if (!prior) {
      const lastMessage = batch.filter((event) => batchIds.has(event.id)).sort((a, b) => a.ts.localeCompare(b.ts)).at(-1)!.id;
      const unfinished = typeof output.unfinished === 'string' && output.unfinished.trim() ? output.unfinished.trim().slice(0, 200) : null;
      const result = this.#store.appendEvent({
        id: resultId, schema_version: 1, source: 'system', author: 'system', ts: at, kind: 'triage_result',
        payload: { data: { triage: { processor: tasksConfig.ai.processor, messages: [...batchIds], conversation_only: [...conversationOnly], last_message: lastMessage, unfinished,
          ...(proposals.length ? { proposals } : {}), ...(questions.length ? { questions } : {}), ...(again ? { again: true, withdrawn } : {}) } } },
      });
      if (result.created) { this.#live.publish(result.event); written += proposals.length + questions.length; }
    }
    this.#store.ailog.decide(decisions);
    this.#store.triage.mark([...batchIds, ...skipped], written, at);
    return written;
  }

  async tick(now = Date.now()): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    await this.locked(() => this.#round(now)).finally(() => { this.#busy = false; });
  }

  async #round(now: number): Promise<void> {
    try {
      if (!this.#planner) { this.#health('login_required', this.#reason); return; }
      const month = new Date(now).toISOString().slice(0, 7);
      if (this.#store.triage.spent(month) >= tasksConfig.ai.monthly_budget_usd) { this.#health('error', `исчерпан лимит трат на ИИ за месяц ($${tasksConfig.ai.monthly_budget_usd})`); return; }
      for (const batch of this.ready(now)) await this.run(batch);
      if (this.#namer) await nameTasks({ store: this.#store, live: this.#live, namer: this.#namer, now,
        tasks: foldTasks(this.#store.triage.taskEvents(), { filedTemplates: tasksConfig.templates.filter((template) => template.filed).map((template) => template.name) }) });
      this.#health('ok', null);
    } catch (error) {
      console.error('Triage failed', error instanceof Error ? error.message : error);
      this.#health('error', `разбор не удался: ${error instanceof Error ? error.message : error}`.slice(0, 300));
    }
  }

  // A directive tag added to a message already triaged (directive.ts): its session goes to the AI again at once, once
  // per `cause` (the tag correction). → task changes, proposals and questions written.
  async rerun(messageId: string, cause = messageId): Promise<number> {
    const message = this.#store.getEvent(messageId);
    if (!message || !this.#planner || this.#store.triage.spent(new Date().toISOString().slice(0, 7)) >= tasksConfig.ai.monthly_budget_usd) return 0;
    const key = conversationOf(message);
    const conversation = this.#store.triage.messages(new Date(Date.now() - tasksConfig.history_days * 86_400_000).toISOString()).filter((event) => conversationOf(event) === key);
    const session = sessionsOf(conversation, tasksConfig.session_gap_h * 3_600_000).find((events) => events.some((event) => event.id === messageId)) ?? [message];
    const start = Math.max(0, Math.min(session.findIndex((event) => event.id === messageId), session.length - tasksConfig.max_batch));
    return this.secondLook(session.slice(start, start + tasksConfig.max_batch), `rerun|${cause}`);
  }

  // A second look at a batch (rerun, «✨ Разобрать заново»): what the AI decided about it and the owner has not answered
  // is replaced (retriage.ts `secondLookOf`). Under the lock, so a round cannot take the same messages meanwhile.
  secondLook(batch: JournalEvent[], again: string): Promise<number> {
    return this.locked(async () => this.run(batch, { again, ...secondLookOf(this.#store, batch) }));
  }

  // One look at a time — a round, a rerun, a second look: two at once could make records for the same messages twice.
  locked<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#chain.then(work);
    this.#chain = next.catch(() => undefined);
    return next;
  }

  // Whether there is an AI to ask (a key): «Разобрать заново» needs one.
  get canRun(): boolean { return Boolean(this.#planner); }

  // A new AI key entered on the System screen (src/server/connectors.ts): the next round uses it.
  use(planner: Planner | null, namer: Namer | null): void { this.#planner = planner; this.#namer = namer; }

  start(everyMs = 10_000): void { void this.tick(); this.#timer = setInterval(() => void this.tick(), everyMs); this.#timer.unref(); }
  stop(): void { clearInterval(this.#timer); }
}
