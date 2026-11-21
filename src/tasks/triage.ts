import type { TriageNewTasks } from '../ownersettings.ts';
import { createHash } from 'node:crypto';
import type { JournalStore } from '../store/store.ts';
import type { JournalEvent } from '../contracts/validate.ts';
import type { LiveFeed } from '../server/live.ts';
import type { SourceState } from '../store/status.ts';
import { tasksConfig } from '../config.ts';
import { nameId } from '../ids.ts';
import { stateChanged } from '../server/system.ts';
import { foldTasks, isOpen, type Task } from './fold.ts';
import { describe, from, hasForwardOrigin, messageDirection } from './messages.ts';
import { nameTasks, type Namer } from './namer.ts';
import { counterpartyChange } from './counterparty.ts';
import { foldPeople, foldCounterparties, personOf, peopleOf } from '../contacts/fold.ts';
import { foldProjects, defaultProject, type Project } from './projects.ts';
import { defaultController, isParty, partyOfEvent } from './parties.ts';
import type { AiDecision } from '../store/ailog.ts';
import type { PlanInput, PlanMessage, PlannedTask, Planner } from './planner.ts';

// Task triage (CONCEPT.md §2.8): new messages wait for a quiet window per stream (a chat, the phone, my own
// notes), then go together to the planner, which splits them into new tasks and additions to open ones.
// The outcome is work, material to file, or context kept in the conversation. Missing decisions go to «Разобрать».

export const TRIAGE_SOURCE = 'ai_triage';

// Which stream a message belongs to: messages of one stream share a quiet window.
export function streamOf(event: JournalEvent): string {
  const data = event.payload.data ?? {};
  const telegram = data.telegram as { account: string; chat_id: string } | undefined;
  if (telegram) return `tg|${telegram.account}|${telegram.chat_id}`;
  const outbound = data.outbound as { connector: string; chat_id: string } | undefined;
  const viber = data.viber as { chat: string; phone?: string } | undefined;
  if (viber) return `viber|${viber.phone ?? viber.chat}`;
  if (outbound?.connector === 'viber') return `viber|${outbound.chat_id}`;
  const whatsapp = data.whatsapp as { jid: string; phone?: string } | undefined;
  if (whatsapp) return `whatsapp|${whatsapp.phone ?? whatsapp.jid}`;
  if (outbound?.connector.startsWith('whatsapp_')) return `whatsapp|${outbound.chat_id}`;
  if (outbound) return `tg|${outbound.connector.replace(/^telegram_/, '')}|${outbound.chat_id}`;
  if (event.source === 'android_phone') return 'phone';
  return 'me';
}

// Checklist items and a new title from the planner (CONCEPT.md §2.8): one-line items not already in the task;
// a rename only for an existing task the owner has not named.
export function checklistChange(taskId: string, planned: PlannedTask, task?: Task): Record<string, unknown> {
  const known = new Set((task?.items ?? []).map((item) => item.text.trim().toLowerCase()));
  const items_add: { id: string; text: string }[] = [];
  for (const raw of planned.items ?? []) {
    const text = String(raw).replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!text || known.has(text.toLowerCase())) continue;
    known.add(text.toLowerCase());
    items_add.push({ id: nameId(`item|${taskId}|${text}`), text });
  }
  const rename = planned.rename?.trim().slice(0, 200);
  const title = task && rename && !task.owner_titled && rename !== task.title ? { title: rename } : {};
  return { ...(items_add.length ? { items_add } : {}), ...title };
}

// The project a planned task goes to (CONCEPT.md §2.11): the planner's project if it is active, else the source's
// default; a section only of that project (an idea without one goes to its «ideas» section). A task that already has
// a project keeps it; filed outcomes get none. When unsure — `project_options` for the owner to choose.
export function projectChange(planned: PlannedTask, task: Task | undefined, projects: Project[]): Record<string, unknown> {
  if (planned.filed || task?.project) return {};
  const byId = new Map(projects.map((project) => [project.id, project]));
  const options = [...new Set(planned.project_options ?? [])].filter((id) => byId.has(id)).slice(0, 3);
  // Only the planner's choice by the project's scope: the source alone puts nothing into a project (owner, 2026-11-20).
  const chosen = (planned.project && byId.get(planned.project)) || null;
  if (!chosen) return options.length ? { project_options: options } : {};
  const section = chosen.sections.find((item) => item.id === planned.section);
  return { project: chosen.id, section: section?.id ?? null };
}

// Quiet window of a stream in seconds: by its kind (`tg`, `phone`, `me`), else the default.
export function quietOf(stream: string): number {
  return tasksConfig.quiet_s_by_stream[stream.split('|')[0]!] ?? tasksConfig.quiet_s;
}

// A report draft from what the conversation says was done (task manager spec §11): only valid fields — a known
// currency, sums and minutes not below zero, the result line up to 500 characters. A task the owner already
// reported on keeps its report. Closing stays the owner's: «Задача выполнена?» → «Да» keeps these values.
export function reportDraft(planned: PlannedTask, task?: Task): { report?: Record<string, unknown> } {
  const draft = planned.report;
  if (!draft || (task as { report?: unknown } | undefined)?.report) return {};
  const report: Record<string, unknown> = {};
  const note = draft.note?.trim();
  if (note) report.note = note.slice(0, 500);
  for (const key of ['duration_min', 'cost', 'expenses'] as const) {
    const value = draft[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) report[key] = key === 'duration_min' ? Math.round(value) : value;
  }
  if ((report.cost !== undefined || report.expenses !== undefined) && draft.currency && tasksConfig.currencies.includes(draft.currency)) report.currency = draft.currency;
  return Object.keys(report).length ? { report } : {};
}

export class Triage {
  #store: JournalStore;
  #live: LiveFeed;
  #planner: Planner | null;
  #namer: Namer | null;
  #reason: string;
  #timer?: ReturnType<typeof setInterval>;
  #busy = false;
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

  // Groups whose newest message is older than the quiet window, each cut to max_batch.
  ready(now = Date.now()): JournalEvent[][] {
    const since = new Date(now - tasksConfig.lookback_h * 3_600_000).toISOString();
    const streams = new Map<string, JournalEvent[]>();
    for (const event of this.#store.triage.pending(since)) {
      const key = streamOf(event);
      streams.set(key, [...(streams.get(key) ?? []), event]);
    }
    return [...streams.entries()]
      .filter(([stream, events]) => now - Date.parse(events.at(-1)!.received_at!) >= quietOf(stream) * 1000)
      .map(([, events]) => events)
      .map((events) => events.slice(0, tasksConfig.max_batch));
  }

  async run(batch: JournalEvent[]): Promise<number> {
    const tasks = foldTasks(this.#store.triage.taskEvents(), { filedTemplates: tasksConfig.templates.filter((template) => template.filed).map((template) => template.name) });
    const open = tasks.filter(isOpen).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, tasksConfig.open_tasks_in_context);
    // Finished cases may come back: the triage sees those closed in the last reopen_days (CONCEPT.md §2.8).
    const closedSince = new Date(Date.now() - tasksConfig.reopen_days * 86_400_000).toISOString();
    const closed = tasks.filter((task) => !isOpen(task) && task.updated_at >= closedSince)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, tasksConfig.closed_tasks_in_context);
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
    const toMessage = (event: JournalEvent, text: string, tags: string[]): PlanMessage => {
      const continuation = event.payload.data?.continuation as { target: string; on: boolean } | undefined;
      const linked = [event.reply_to, continuation?.on ? continuation.target : undefined].filter(Boolean) as string[];
      return {
        id: event.id, time: event.ts, source: streamOf(event), from: from(event), party: partyOfEvent(event), text, tags,
        direction: messageDirection(event), ...(hasForwardOrigin(event) ? { forwarded: true } : {}),
        ...(event.reply_to ? { reply_to: event.reply_to } : {}), ...(continuation?.on ? { continues: continuation.target } : {}),
        in_tasks: [...new Set([event.id, ...linked].flatMap(taskOf))],
        default_project: defaultProject(projects, streamOf(event))?.id ?? null,
        person: personOf(partyOfEvent(event), people)?.name ?? null,
      };
    };
    const messages: PlanMessage[] = [];
    const skipped: string[] = [];
    const first = batch[0]?.received_at;
    if (!first) return 0;
    const since = new Date(Date.parse(first) - tasksConfig.lookback_h * 3_600_000).toISOString();
    for (const event of batch) {
      const view = describe(event, this.#store);
      if (view.deleted || !view.text.trim()) { skipped.push(event.id); continue; }
      messages.push(toMessage(event, view.text.slice(0, 2000), view.tags));
    }
    // Earlier messages of this conversation: a talk with pauses longer than the quiet window is split into
    // batches, and a batch alone may not say what it is about.
    const stream = streamOf(batch[0]!);
    const context = this.#store.triage.triaged(since)
      .filter((event) => event.received_at! < first && streamOf(event) === stream)
      .map((event) => ({ event, view: describe(event, this.#store) }))
      .filter(({ view }) => !view.deleted && view.text.trim())
      .slice(-tasksConfig.context_messages)
      .map(({ event, view }) => toMessage(event, view.text.slice(0, 500), view.tags));
    const at = new Date().toISOString();
    if (!messages.length) { this.#store.triage.mark(skipped, 0, at); return 0; }
    const input: PlanInput = {
      now: at, job_days: tasksConfig.job_days, projects: projects.map(({ id, title, kind, sections, scope }) => ({ id, title, kind, scope, sections })),
      templates: tasksConfig.templates.filter((template) => !template.legacy),
      counterparties: counterparties.filter((item) => item.status === 'active').map(({ id, kind, title, address, side }) => ({ id, kind, title, address, side,
        people: peopleOf(id, people).map(({ person, title: job }) => (job ? `${person.name} (${job})` : person.name)) })),
      open_tasks: open.map(asContext),
      closed_tasks: closed.map(asContext),
      context,
      messages,
    };
    const output = await this.#planner!(input);
    const price = tasksConfig.ai.price_per_mtok;
    const cost = output.usage ? (output.usage.input_tokens * price.input + output.usage.output_tokens * price.output) / 1e6 : 0;
    if (output.usage) this.#store.triage.addUsage(at.slice(0, 7), output.usage.input_tokens, output.usage.output_tokens, cost);
    const batchIds = new Set(messages.map((message) => message.id));
    const openIds = new Set(open.map((task) => task.id));
    const closedById = new Map(closed.map((task) => [task.id, task]));
    const known = new Set([...openIds, ...closedById.keys()]);
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const filedTemplates = new Set(tasksConfig.templates.filter((template) => template.filed).map((template) => template.name));
    const batchKey = createHash('sha256').update([...batchIds].sort().join(',')).digest('hex').slice(0, 16);
    const resultId = nameId(`triage-result|${batchKey}`);
    const prior = this.#store.getEvent(resultId);
    const stored = prior?.payload.data?.triage as { conversation_only: string[] } | undefined;
    const conversationOnly = new Set((stored?.conversation_only ?? output.conversation_only).filter((id) => batchIds.has(id)));
    // The AI log (src/store/ailog.ts): the run — what the AI was shown and answered — and each decision with its reason.
    const runId = nameId(`ai-run|${batchKey}`);
    const { usage, ...answer } = output;
    this.#store.ailog.run({ id: runId, at, processor: tasksConfig.ai.processor, model: tasksConfig.ai.model, stream, messages: messages.length,
      input_tokens: usage?.input_tokens ?? 0, output_tokens: usage?.output_tokens ?? 0, cost_usd: cost, input, output: answer });
    this.#store.ailog.prune(new Date(Date.parse(at) - tasksConfig.ai_log.keep_days * 86_400_000).toISOString());
    const decisions: AiDecision[] = [];
    const decide = (key: string, kind: AiDecision['kind'], taskId: string | null, ids: string[], confidence: number | null, reason: string | null, status: AiDecision['status'] = 'auto', id = nameId(`ai-decision|${batchKey}|${key}`)) =>
      decisions.push({ id, run_id: runId, at, kind, task_id: taskId, message_ids: ids, confidence, reason: reason?.slice(0, 500) ?? null, status });
    if (conversationOnly.size) decide('conversation_only', 'conversation_only', null, [...conversationOnly], null, null);
    // Changes of existing tasks are only proposed (docs/plans/2026-11-21-ai-proposals-design.md): the owner answers.
    const proposals: Record<string, unknown>[] = [];
    const covered = new Set(output.tasks.flatMap((planned) => planned.message_ids));
    const missed = [...batchIds].filter((id) => !conversationOnly.has(id) && !covered.has(id));
    const outcomes: PlannedTask[] = [...output.tasks];
    let fallback: PlannedTask | null = null; // the «Разобрать» task for messages the AI left out
    if (missed.length) {
      outcomes.push(fallback = { task_id: null, title: tasksConfig.unsorted.title, responsible: 'me', executors: [], author: null, template: null, due: null,
        message_ids: missed, confidence: 0, note: tasksConfig.unsorted.note, filed: false, done: false, alternatives: [] });
    }
    // Parties the planner may name: the owner, AI, the system and everyone who wrote in this batch or its context;
    // a `name:` party is a person without an account and passes. Anything else is made up and dropped.
    const allowed = new Set(['me', 'ai', 'system', ...messages.map((message) => message.party), ...context.map((message) => message.party)]);
    const valid = (party: unknown): party is string => isParty(party) && (allowed.has(party) || party.startsWith('name:'));
    const partyOfMessage = new Map([...messages, ...context].map((message) => [message.id, message.party]));
    const rolesOf = (planned: PlannedTask, add: string[]) => {
      const template = tasksConfig.templates.find((item) => item.name === planned.template);
      const executors = template?.filed ? [template.assignee] : [...new Set(planned.executors.filter(valid))];
      const responsible = template?.filed ? 'me' : valid(planned.responsible) ? planned.responsible : 'me';
      const author = valid(planned.author) ? planned.author : partyOfMessage.get(add[0]!);
      // Work I hand to others, or ask someone else to answer for, is under my control («На контроле»).
      const controller = defaultController({ author, responsible, executors });
      return { ...(author ? { author } : {}), responsible, executors, ...(controller ? { controller } : {}) };
    };
    let written = 0;
    outcomes.forEach((planned, index) => {
      const add = planned.message_ids.filter((id) => batchIds.has(id) && !conversationOnly.has(id));
      if (!add.length) return;
      const target = planned.task_id && known.has(planned.task_id) ? planned.task_id : null;
      // A closed case the messages continue comes back to work; a filed one (diary, note) just gets the message —
      // but work asked about a filed note (a request, items) is a task of its own: the note stays as it was.
      const isFiled = (id: string) => closedById.has(id) && (filedTemplates.has(closedById.get(id)!.template ?? '') || Boolean(closedById.get(id)!.filed));
      const existing = target && isFiled(target) && !planned.filed ? null : target;
      const filedTask = existing && isFiled(existing);
      const reopened = existing && closedById.has(existing) && !planned.filed && !filedTask ? { status: 'todo' } : {};
      const alternatives = [...new Set(planned.alternatives ?? [])].filter((id) => known.has(id) && id !== existing).slice(0, 3);
      const asked = alternatives.length ? { alternatives } : {};
      const taskId = existing ?? nameId(`task|${batchKey}|${index}`);
      const confidence = Math.max(0, Math.min(1, planned.confidence));
      const reason = planned.reason?.trim() || null;
      // «Готово» does not close a task: the card «Задача выполнена?» asks the owner (CONCEPT.md §2.9).
      const proposal = planned.done && !planned.filed ? { proposed: 'done', ...reportDraft(planned, existing ? taskById.get(existing) : undefined) } : {};
      const checklist = checklistChange(taskId, planned, existing ? taskById.get(existing) : undefined);
      const placed = { ...projectChange(planned, existing ? taskById.get(existing) : undefined, projects),
        ...counterpartyChange(planned, existing ? taskById.get(existing) : undefined, counterparties) };
      // An existing task — a proposal, applied when the owner accepts it; a filed note gets its filed message as before.
      if (existing && !(filedTask && planned.filed)) {
        const id = nameId(`proposal|${batchKey}|${index}`);
        proposals.push({ id, task_id: existing, message_ids: add, reason: (reason ?? '').slice(0, 500), confidence, alternatives,
          change: { op: 'update', add, ...reopened, ...proposal, ...checklist, ...placed } });
        decide(String(index), 'link', existing, add, confidence, reason, 'pending', id);
        return;
      }
      decide(String(index), existing || planned.filed ? 'filed' : planned === fallback ? 'unsorted' : 'create',
        taskId, add, confidence, reason);
      const change: Record<string, unknown> = existing
        ? { op: 'update', add, confidence, processor: tasksConfig.ai.processor, ...reopened, ...proposal, ...asked, ...checklist, ...placed, ...(reason ? { reason: reason.slice(0, 500) } : {}) }
        : {
          op: 'create', title: planned.title.trim().slice(0, 200) || 'Без названия', roles: rolesOf(planned, add),
          status: confidence < tasksConfig.low_confidence ? 'inbox' : planned.filed ? 'done' : 'todo',
          add, confidence, processor: tasksConfig.ai.processor, ...proposal, ...asked, ...checklist, ...placed,
          // v16: a new task waits for the owner unless he chose «ИИ создаёт сразу»; filed notes and «Разобрать» never wait.
          ...(this.#newTasks() === 'unconfirmed' && !planned.filed && planned !== fallback ? { unconfirmed: true } : {}),
          ...(planned.template ? { template: planned.template } : {}),
          ...(planned.due ? { due: planned.due } : {}), ...(planned.note ? { note: planned.note } : {}),
          ...(reason ? { reason: reason.slice(0, 500) } : {}),
        };
      try {
        const result = this.#store.appendEvent({
          id: nameId(`task-change|${batchKey}|${index}`), schema_version: 1, source: 'system', author: 'system', ts: at, kind: 'task_change',
          payload: { ref: { type: 'task', id: taskId }, data: { task: change } },
        });
        if (result.created) { this.#live.publish(result.event); written += 1; }
      } catch (error) { console.error('Triage: task change rejected', error instanceof Error ? error.message : error); }
    });
    // What stays in the conversation and what is proposed: one triage result per batch (written once).
    if ((conversationOnly.size || proposals.length) && !prior) {
      const result = this.#store.appendEvent({
        id: resultId, schema_version: 1, source: 'system', author: 'system', ts: at, kind: 'triage_result',
        payload: { data: { triage: { processor: tasksConfig.ai.processor, conversation_only: [...conversationOnly], ...(proposals.length ? { proposals } : {}) } } },
      });
      if (result.created) { this.#live.publish(result.event); written += proposals.length; }
    }
    this.#store.ailog.decide(decisions);
    this.#store.triage.mark([...batchIds, ...skipped], written, at);
    return written;
  }

  async tick(now = Date.now()): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
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
    } finally { this.#busy = false; }
  }

  // A new AI key entered on the System screen (src/server/connectors.ts): the next round uses it.
  use(planner: Planner | null, namer: Namer | null): void { this.#planner = planner; this.#namer = namer; }

  start(everyMs = 10_000): void { void this.tick(); this.#timer = setInterval(() => void this.tick(), everyMs); this.#timer.unref(); }
  stop(): void { clearInterval(this.#timer); }
}
