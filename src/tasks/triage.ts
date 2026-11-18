import { createHash } from 'node:crypto';
import type { JournalStore } from '../store/store.ts';
import type { JournalEvent } from '../contracts/validate.ts';
import type { LiveFeed } from '../server/live.ts';
import type { SourceState } from '../store/status.ts';
import { tasksConfig } from '../config.ts';
import { nameId } from '../ids.ts';
import { stateChanged } from '../server/system.ts';
import { foldTasks, isOpen } from './fold.ts';
import type { PlanInput, PlanMessage, Planner } from './planner.ts';

// Task triage (CONCEPT.md §2.8): new messages wait for a quiet window per stream (a chat, the phone, my own
// notes), then go together to the planner, which splits them into new tasks and additions to open ones.
// Every message gets an outcome (§2.8 «Разобрать — тоже задача»): an open task, an addition to one, or a task
// created already done because it only had to be filed (diary, plan, note, chatter). A message the planner
// left out becomes «Разобрать» for the owner, so nothing is dropped silently.

export const TRIAGE_SOURCE = 'ai_triage';

// Which stream a message belongs to: messages of one stream share a quiet window.
export function streamOf(event: JournalEvent): string {
  const data = event.payload.data ?? {};
  const telegram = data.telegram as { account: string; chat_id: string } | undefined;
  if (telegram) return `tg|${telegram.account}|${telegram.chat_id}`;
  const outbound = data.outbound as { connector: string; chat_id: string } | undefined;
  if (outbound) return `tg|${outbound.connector.replace(/^telegram_/, '')}|${outbound.chat_id}`;
  if (event.source === 'android_phone') return 'phone';
  return 'me';
}

// Quiet window of a stream in seconds: by its kind (`tg`, `phone`, `me`), else the default.
export function quietOf(stream: string): number {
  return tasksConfig.quiet_s_by_stream[stream.split('|')[0]!] ?? tasksConfig.quiet_s;
}

function describe(event: JournalEvent, store: JournalStore): { text: string; tags: string[]; deleted: boolean } {
  let text = event.payload.text ?? '';
  let tags = event.payload.tags ?? [];
  let deleted = false;
  for (const correction of store.triage.corrections(event.id)) {
    const op = correction.payload.data?.op;
    if (op === 'edit') { text = correction.payload.text ?? text; tags = correction.payload.tags ?? tags; }
    if (op === 'delete') deleted = true;
    if (op === 'restore') deleted = false;
  }
  const data = event.payload.data ?? {};
  const call = data.call as { direction: string; duration_s?: number; name?: string; number?: string } | undefined;
  if (call) text = `[звонок ${call.direction}${call.duration_s ? `, ${call.duration_s} с` : ''}, ${call.name || call.number || 'скрытый номер'}]`;
  const media = event.payload.media ?? [];
  if (event.kind === 'voice') text = `[голосовое без расшифровки]${text ? ` ${text}` : ''}`;
  else if (media.length && !text) text = `[${event.kind === 'photo' ? 'фото' : 'файл'} без подписи]`;
  return { text, tags, deleted };
}

function from(event: JournalEvent): string {
  if (event.author === 'me') return 'владелец';
  const telegram = event.payload.data?.telegram as { from_name?: string; chat_title?: string } | undefined;
  return telegram?.from_name || telegram?.chat_title || event.author;
}

export class Triage {
  #store: JournalStore;
  #live: LiveFeed;
  #planner: Planner | null;
  #reason: string;
  #timer?: ReturnType<typeof setInterval>;
  #busy = false;

  // `planner` null — triage is off (no AI key); `reason` says why on the System screen.
  constructor({ store, live, planner, reason = 'нет ключа ИИ' }: { store: JournalStore; live: LiveFeed; planner: Planner | null; reason?: string }) {
    this.#store = store;
    this.#live = live;
    this.#planner = planner;
    this.#reason = reason;
  }

  #health(state: SourceState, detail: string | null) {
    const month = new Date().toISOString().slice(0, 7);
    const info = { model: tasksConfig.ai.model, spent_usd: Number(this.#store.triage.spent(month).toFixed(4)), budget_usd: tasksConfig.ai.monthly_budget_usd, quiet_s: tasksConfig.quiet_s, quiet_s_by_stream: tasksConfig.quiet_s_by_stream };
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
    const taskOf = (id: string) => tasks.filter((task) => task.messages.includes(id)).map((task) => task.id);
    const snippet = (id: string) => { const event = this.#store.getEvent(id); return event ? describe(event, this.#store).text.slice(0, 160) : ''; };
    const asContext = (task: (typeof tasks)[number]) => {
      const events = task.messages.slice(-5).map((id) => this.#store.getEvent(id)).filter((event): event is JournalEvent => Boolean(event));
      return { id: task.id, title: task.title, assignee: task.assignee, status: task.status, recent: task.messages.slice(-3).map(snippet),
        chats: [...new Set(events.map(streamOf))], last_at: events.at(-1)?.ts ?? task.updated_at };
    };
    const toMessage = (event: JournalEvent, text: string, tags: string[]): PlanMessage => {
      const continuation = event.payload.data?.continuation as { target: string; on: boolean } | undefined;
      const linked = [event.reply_to, continuation?.on ? continuation.target : undefined].filter(Boolean) as string[];
      return {
        id: event.id, time: event.ts, source: streamOf(event), from: from(event), text, tags,
        ...(event.reply_to ? { reply_to: event.reply_to } : {}), ...(continuation?.on ? { continues: continuation.target } : {}),
        in_tasks: [...new Set([event.id, ...linked].flatMap(taskOf))],
      };
    };
    const messages: PlanMessage[] = [];
    const skipped: string[] = [];
    for (const event of batch) {
      const view = describe(event, this.#store);
      if (view.deleted || !view.text.trim()) { skipped.push(event.id); continue; }
      messages.push(toMessage(event, view.text.slice(0, 2000), view.tags));
    }
    // Earlier messages of this conversation: a talk with pauses longer than the quiet window is split into
    // batches, and a batch alone may not say what it is about.
    const stream = streamOf(batch[0]!);
    const first = batch[0]!.received_at!;
    const since = new Date(Date.parse(first) - tasksConfig.lookback_h * 3_600_000).toISOString();
    const context = this.#store.triage.triaged(since)
      .filter((event) => event.received_at! < first && streamOf(event) === stream)
      .map((event) => ({ event, view: describe(event, this.#store) }))
      .filter(({ view }) => !view.deleted && view.text.trim())
      .slice(-tasksConfig.context_messages)
      .map(({ event, view }) => toMessage(event, view.text.slice(0, 500), view.tags));
    const at = new Date().toISOString();
    if (!messages.length) { this.#store.triage.mark(skipped, 0, at); return 0; }
    const input: PlanInput = {
      now: at, templates: tasksConfig.templates,
      open_tasks: open.map(asContext),
      closed_tasks: closed.map(asContext),
      context,
      messages,
    };
    const output = await this.#planner!(input);
    if (output.usage) {
      const price = tasksConfig.ai.price_per_mtok;
      this.#store.triage.addUsage(at.slice(0, 7), output.usage.input_tokens, output.usage.output_tokens,
        (output.usage.input_tokens * price.input + output.usage.output_tokens * price.output) / 1e6);
    }
    const batchIds = new Set(messages.map((message) => message.id));
    const openIds = new Set(open.map((task) => task.id));
    const closedById = new Map(closed.map((task) => [task.id, task]));
    const known = new Set([...openIds, ...closedById.keys()]);
    const filedTemplates = new Set(tasksConfig.templates.filter((template) => template.filed).map((template) => template.name));
    const batchKey = createHash('sha256').update([...batchIds].sort().join(',')).digest('hex').slice(0, 16);
    const covered = new Set(output.tasks.flatMap((planned) => planned.message_ids));
    const missed = [...batchIds].filter((id) => !covered.has(id));
    const outcomes = [...output.tasks];
    if (missed.length) {
      outcomes.push({ task_id: null, title: tasksConfig.unsorted.title, assignee: 'me', person: null, template: null, due: null,
        message_ids: missed, confidence: 0, note: tasksConfig.unsorted.note, filed: false, done: false, alternatives: [] });
    }
    let written = 0;
    outcomes.forEach((planned, index) => {
      const add = planned.message_ids.filter((id) => batchIds.has(id));
      if (!add.length) return;
      const existing = planned.task_id && known.has(planned.task_id) ? planned.task_id : null;
      // A closed case the messages continue comes back to work; a filed one (diary, note) just gets the message.
      const filedTask = existing && closedById.has(existing) && filedTemplates.has(closedById.get(existing)!.template ?? '');
      const reopened = existing && closedById.has(existing) && !planned.filed && !filedTask ? { status: 'todo' } : {};
      const alternatives = [...new Set(planned.alternatives ?? [])].filter((id) => known.has(id) && id !== existing).slice(0, 3);
      const asked = alternatives.length ? { alternatives } : {};
      const taskId = existing ?? nameId(`task|${batchKey}|${index}`);
      const confidence = Math.max(0, Math.min(1, planned.confidence));
      // «Готово» does not close a task: the card «Задача выполнена?» asks the owner (CONCEPT.md §2.9).
      const proposal = planned.done && !planned.filed ? { proposed: 'done' } : {};
      const change: Record<string, unknown> = existing
        ? { op: 'update', add, confidence, processor: tasksConfig.ai.processor, ...reopened, ...proposal, ...asked }
        : {
          op: 'create', title: planned.title.trim().slice(0, 200) || 'Без названия', assignee: planned.assignee,
          status: confidence < tasksConfig.low_confidence ? 'inbox' : planned.filed ? 'done' : 'todo',
          add, confidence, processor: tasksConfig.ai.processor, ...proposal, ...asked,
          ...(planned.person ? { person: planned.person } : {}), ...(planned.template ? { template: planned.template } : {}),
          ...(planned.due ? { due: planned.due } : {}), ...(planned.note ? { note: planned.note } : {}),
        };
      try {
        const result = this.#store.appendEvent({
          id: nameId(`task-change|${batchKey}|${index}`), schema_version: 1, source: 'system', author: 'system', ts: at, kind: 'task_change',
          payload: { ref: { type: 'task', id: taskId }, data: { task: change } },
        });
        if (result.created) { this.#live.publish(result.event); written += 1; }
      } catch (error) { console.error('Triage: task change rejected', error instanceof Error ? error.message : error); }
    });
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
      this.#health('ok', null);
    } catch (error) {
      console.error('Triage failed', error instanceof Error ? error.message : error);
      this.#health('error', `разбор не удался: ${error instanceof Error ? error.message : error}`.slice(0, 300));
    } finally { this.#busy = false; }
  }

  start(everyMs = 10_000): void { void this.tick(); this.#timer = setInterval(() => void this.tick(), everyMs); this.#timer.unref(); }
  stop(): void { clearInterval(this.#timer); }
}
