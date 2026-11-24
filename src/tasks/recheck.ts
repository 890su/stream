// «✨ Сверить с перепиской» on a record (docs/plans/2026-11-23-conversation-records-design.md «✨ на записи»): the
// conversations the record's messages come from — from the session before its first message to now — go to the
// rechecker with the record and its neighbours; what it says becomes proposals in one `triage_result` with
// `recheck: <task id>`, listed in the card with ✓ ✕ (web/recheck.js). The server applies nothing. A merge's second
// half (closing the duplicate) rides in the proposal's `also`. A new pass withdraws what the last one left waiting.
import type { JournalStore } from '../store/store.ts';
import { isDateTime, type JournalEvent } from '../contracts/validate.ts';
import type { LiveFeed } from '../server/live.ts';
import type { AiDecision } from '../store/ailog.ts';
import { tasksConfig } from '../config.ts';
import { nameId } from '../ids.ts';
import { HttpError } from '../server/errors.ts';
import { foldTasks, isOpen, type Task } from './fold.ts';
import { describe, from, hasForwardOrigin, messageDirection } from './messages.ts';
import { partyOfEvent } from './parties.ts';
import { conversationOf, sessionsOf, before } from './sessions.ts';
import { streamOf } from './streams.ts';
import { ownerRemoved } from './triageapply.ts';
import { systemLinks } from './retriage.ts';
import type { PlanTask } from './planner.ts';
import type { RecheckMessage, RecheckProposal, Rechecker } from './recheckplan.ts';

const MESSAGE_KINDS = new Set(['text', 'voice', 'photo', 'file', 'link', 'call', 'sms']);
const MAX_PROPOSALS = 20;
const running = new Set<string>(); // records being rechecked: a double tap does not ask twice

type Written = { id: string; kind: RecheckProposal['kind']; task_id: string; message_ids: string[]; reason: string; confidence: number; alternatives: string[];
  change: Record<string, unknown>; also?: { task_id: string; change: Record<string, unknown> }[] };

export async function recheck({ store, live, rechecker, taskId }: { store: JournalStore; live: LiveFeed; rechecker: Rechecker; taskId: string }): Promise<{ proposals: number }> {
  const taskEvents = store.triage.taskEvents();
  const tasks = foldTasks(taskEvents, { filedTemplates: tasksConfig.templates.filter((template) => template.filed).map((template) => template.name) });
  const record = tasks.find((task) => task.id === taskId);
  if (!record) throw new HttpError(404, 'Запись не найдена');
  const own = record.messages.map((id) => store.getEvent(id)).filter((event): event is JournalEvent => Boolean(event) && MESSAGE_KINDS.has(event!.kind));
  if (!own.length) throw new HttpError(409, 'У записи нет сообщений — сверять не с чем');
  const budget = tasksConfig.ai.monthly_budget_usd;
  const at = new Date().toISOString();
  if (store.triage.spent(at.slice(0, 7)) >= budget) throw new HttpError(409, `Исчерпан лимит трат на ИИ за месяц (${budget} $)`);
  if (running.has(taskId)) throw new HttpError(409, 'Сверка этой записи уже идёт');
  running.add(taskId);
  try {
    const events = conversationsOf(store, own, new Set(record.messages));
    const ids = new Set(events.map((event) => event.id));
    // In another confirmed record, put there by the owner or kept by him (not a system link he left alone).
    const untouched = new Set(systemLinks(taskEvents, ids).flatMap((link) => link.message_ids.map((id) => `${link.task_id}|${id}`)));
    const elsewhere = (id: string) => tasks.some((task) => task.id !== taskId && !task.unconfirmed && task.status !== 'cancelled' && task.messages.includes(id) && !untouched.has(`${task.id}|${id}`));
    const tasksOf = (id: string) => tasks.filter((task) => task.messages.includes(id)).map((task) => task.id);
    const messages: RecheckMessage[] = [];
    for (const event of events) {
      const view = describe(event, store);
      if (view.deleted || !view.text.trim()) continue;
      messages.push({ id: event.id, time: event.ts, source: streamOf(event), from: from(event), party: partyOfEvent(event), text: view.text.slice(0, 1000), tags: view.tags,
        direction: messageDirection(event), ...(hasForwardOrigin(event) ? { forwarded: true as const } : {}), ...(event.reply_to ? { reply_to: event.reply_to } : {}),
        in_tasks: tasksOf(event.id), in_record: record.messages.includes(event.id), owner_linked_elsewhere: elsewhere(event.id) });
    }
    const others = neighbours(tasks, record, messages);
    const asPlan = planTask(store);
    const earlier = earlierOf(store, taskId, record.messages);
    const output = await rechecker({ now: at, record: asPlan(record), others: others.map(asPlan), messages,
      ...(earlier.rejected.length ? { rejected: earlier.rejected } : {}) }).catch((error: unknown) => {
      throw new HttpError(502, `Сверка не удалась: ${error instanceof Error ? error.message : error}`.slice(0, 300));
    });

    const runId = nameId(`ai-run|recheck|${taskId}|${at}`);
    const price = tasksConfig.ai.price_per_mtok;
    const cost = output.usage ? (output.usage.input_tokens * price.input + output.usage.output_tokens * price.output) / 1e6 : 0;
    if (output.usage) store.triage.addUsage(at.slice(0, 7), output.usage.input_tokens, output.usage.output_tokens, cost);
    store.ailog.run({ id: runId, at, processor: tasksConfig.ai.recheck_processor, model: tasksConfig.ai.model, stream: `task:${taskId}`, messages: messages.length,
      input_tokens: output.usage?.input_tokens ?? 0, output_tokens: output.usage?.output_tokens ?? 0, cost_usd: cost, input: { record: record.id, messages: messages.length }, output: { proposals: output.proposals } });

    const proposals = toProposals(output.proposals, { record, others, messages, removed: ownerRemoved(taskEvents), key: `${taskId}|${at}` });
    const withdrawn = earlier.waiting;
    const result = store.appendEvent({ id: nameId(`recheck-result|${taskId}|${at}`), schema_version: 1, source: 'system', author: 'system', ts: at, kind: 'triage_result',
      payload: { data: { triage: { processor: tasksConfig.ai.recheck_processor, conversation_only: [], recheck: taskId,
        ...(proposals.length ? { proposals } : {}), ...(withdrawn.length ? { withdrawn } : {}) } } } });
    if (result.created) live.publish(result.event);
    if (withdrawn.length) store.ailog.replace(withdrawn, [], at);
    store.ailog.decide(proposals.map((item): AiDecision => ({ id: item.id, run_id: runId, at, kind: 'recheck', task_id: taskId, message_ids: item.message_ids,
      confidence: null, reason: item.reason || null, status: 'pending' })));
    return { proposals: proposals.length };
  } finally { running.delete(taskId); }
}

// The record's conversations from the session before its first message there to now, oldest first; at most
// max_batch × 3 messages. Over the bound: the record's own first (its newest, when they alone are too many), then each
// conversation's session before the record's first message there (so one busy chat cannot crowd out another), then
// the newest of the rest.
function conversationsOf(store: JournalStore, own: JournalEvent[], inRecord: Set<string>): JournalEvent[] {
  const first = [...own].sort((a, b) => (before(a, b) ? -1 : 1))[0]!;
  const since = new Date(Date.parse(first.received_at ?? first.ts) - tasksConfig.history_days * 86_400_000).toISOString();
  const keys = new Set(own.map(conversationOf));
  const byKey = new Map<string, JournalEvent[]>();
  for (const event of store.triage.messages(since)) {
    const key = conversationOf(event);
    if (keys.has(key)) byKey.set(key, [...(byKey.get(key) ?? []), event]);
  }
  const taken = new Map(own.map((event) => [event.id, event]));
  const lead = new Set<string>(); // the session before the record's first one, per conversation
  for (const history of byKey.values()) {
    const sessions = sessionsOf(history, tasksConfig.session_gap_h * 3_600_000);
    const start = sessions.findIndex((session) => session.some((event) => inRecord.has(event.id)));
    if (start > 0) for (const event of sessions[start - 1]!) if (!inRecord.has(event.id)) lead.add(event.id);
    for (const event of sessions.slice(Math.max(0, start - 1)).flat()) taken.set(event.id, event);
  }
  const byTime = (a: JournalEvent, b: JournalEvent) => (before(a, b) ? -1 : 1);
  const all = [...taken.values()].sort(byTime);
  const cap = tasksConfig.max_batch * 3;
  if (all.length <= cap) return all;
  const newest = (events: JournalEvent[], room: number) => (room > 0 ? events.slice(-room) : []);
  const keep = new Set(newest([...own].sort(byTime), cap).map((event) => event.id));
  for (const event of newest(all.filter((item) => lead.has(item.id)), cap - keep.size)) keep.add(event.id);
  for (const event of newest(all.filter((item) => !keep.has(item.id) && !inRecord.has(item.id)), cap - keep.size)) keep.add(event.id);
  return all.filter((event) => keep.has(event.id));
}

// Other records the rechecker may point to: those holding messages of these conversations, and open ones of the same
// people or counterparty; closed ones only within reopen_days. Newest first, at most 30.
function neighbours(tasks: Task[], record: Task, messages: RecheckMessage[]): Task[] {
  const ids = new Set(messages.map((message) => message.id));
  const parties = new Set(messages.map((message) => message.party).filter((party) => !['me', 'ai', 'system'].includes(party)));
  const since = new Date(Date.now() - tasksConfig.reopen_days * 86_400_000).toISOString();
  const roleParties = ({ roles }: Task) => [roles.author, roles.responsible, roles.controller, ...roles.executors, ...roles.watchers, ...roles.members];
  return tasks.filter((task) => task.id !== record.id && task.status !== 'cancelled' && (isOpen(task) || task.updated_at >= since)
    && (task.messages.some((id) => ids.has(id)) || roleParties(task).some((party) => party !== null && parties.has(party))
      || (record.counterparty != null && task.counterparty === record.counterparty)))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 30);
}

const planTask = (store: JournalStore) => (task: Task): PlanTask => {
  const events = task.messages.slice(-5).map((id) => store.getEvent(id)).filter((event): event is JournalEvent => Boolean(event));
  return { id: task.id, title: task.title, assignee: task.assignee, roles: task.roles, status: task.status, project: task.project ?? null,
    recent: events.slice(-3).map((event) => describe(event, store).text.slice(0, 160)), chats: [...new Set(events.map(streamOf))], last_at: events.at(-1)?.ts ?? task.updated_at,
    items: task.items.map((item) => ({ text: item.text, done: item.done })), owner_titled: task.owner_titled };
};

// A full date (a real day) or an ISO date-time, nothing after it.
const isDue = (value: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) { const day = new Date(`${value}T00:00:00Z`); return !Number.isNaN(day.getTime()) && day.toISOString().startsWith(value); }
  return isDateTime(value);
};
const line = (value: string | null, max = 200) => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// The rechecker's answer → proposals the owner answers ✓ ✕. Ids only from the input; an unknown target drops the
// proposal; a message the owner put elsewhere or took out of the record is never proposed for `add`.
// `removed` — task id → messages the owner took out of it (triageapply.ts `ownerRemoved`): never proposed back there.
export function toProposals(answer: RecheckProposal[], { record, others, messages, removed: removedBy, key }:
  { record: Task; others: Task[]; messages: RecheckMessage[]; removed: Map<string, Set<string>>; key: string }): Written[] {
  const removed = removedBy.get(record.id) ?? new Set<string>();
  const shown = new Map(messages.map((message) => [message.id, message]));
  const known = new Map(others.map((task) => [task.id, task]));
  const inRecord = new Set(record.messages);
  const written: Written[] = [];
  answer.slice(0, MAX_PROPOSALS * 2).forEach((item, index) => {
    const cited = [...new Set(item.message_ids ?? [])].filter((id) => shown.has(id));
    const target = item.target_task_id ? known.get(item.target_task_id) : undefined;
    if (item.target_task_id && !target) return;
    let change: Record<string, unknown> | null = null;
    let also: Written['also'];
    let ids = cited;
    if (item.kind === 'add') {
      ids = cited.filter((id) => !inRecord.has(id) && !shown.get(id)!.owner_linked_elsewhere && !removed.has(id));
      if (ids.length) change = { add: ids };
    } else if (item.kind === 'remove') {
      ids = cited.filter((id) => inRecord.has(id));
      if (ids.length) change = { remove: ids };
      const moving = target ? ids.filter((id) => !removedBy.get(target.id)?.has(id) && !target.messages.includes(id)) : [];
      if (change && moving.length) also = [{ task_id: target!.id, change: { op: 'update', add: moving } }];
    } else if (item.kind === 'rename') {
      const title = line(item.value);
      if (title && title !== record.title) change = { title };
    } else if (item.kind === 'due') {
      const due = item.value?.trim() ?? null;
      if (due === null ? record.due : isDue(due) && due !== record.due) change = { due };
    } else if (item.kind === 'items') {
      const text = line(item.value);
      if (text && !record.items.some((known) => known.text.trim().toLowerCase() === text.toLowerCase())) change = { items_add: [{ id: nameId(`item|${record.id}|${text}`), text }] };
    } else if (item.kind === 'status') {
      const note = line(item.value, 500);
      if (isOpen(record) && record.proposed !== 'done') change = { proposed: 'done', ...(note && !record.report ? { report: { note } } : {}) };
    } else if (item.kind === 'merge' && target && isOpen(target)) {
      ({ change, ids } = mergeChange(record, target, removed));
      also = [{ task_id: target.id, change: { op: 'update', status: 'cancelled', reason: `Склеено с «${record.title}»`.slice(0, 500) } }];
    }
    if (!change || written.length >= MAX_PROPOSALS) return;
    // A recheck proposal has no confidence of its own (the owner asked for it): 1 keeps the triage_result shape.
    written.push({ id: nameId(`recheck|${key}|${index}`), kind: item.kind, task_id: record.id, message_ids: ids, reason: line(item.reason, 500),
      confidence: 1, alternatives: [], change: { op: 'update', ...change }, ...(also ? { also } : {}) });
  });
  return written;
}

// The duplicate's messages and items move into the record (a done item stays done).
function mergeChange(record: Task, dup: Task, removed: Set<string>): { change: Record<string, unknown>; ids: string[] } {
  const ids = dup.messages.filter((id) => !record.messages.includes(id) && !removed.has(id));
  const have = new Set(record.items.map((item) => item.text.trim().toLowerCase()));
  const moved = dup.items.filter((item) => !have.has(item.text.trim().toLowerCase())).map((item) => ({ id: nameId(`item|${record.id}|${item.text}`), text: item.text, done: item.done }));
  const done = moved.filter((item) => item.done).map((item) => ({ id: item.id, done: true }));
  return { ids, change: { ...(ids.length ? { add: ids } : {}), ...(moved.length ? { items_add: moved.map(({ id, text }) => ({ id, text })) } : {}), ...(done.length ? { items_set: done } : {}) } };
}

// Earlier rechecks of this record: proposals still waiting for the owner (no ✓ — an owner change naming it, no ✕ — a
// `reject_proposal`, not withdrawn) — the new pass replaces them; and the ones he rejected — shown to the AI so it does
// not offer them again. ✕ is a correction of the proposal's first message or of one of the record's (web/recheck.js).
function earlierOf(store: JournalStore, taskId: string, recordMessages: string[]): { waiting: string[]; rejected: { kind: string; value: string }[] } {
  const withdrawn = new Set<string>();
  const mine: Written[] = [];
  for (const result of store.triage.results()) {
    const triage = result.payload.data?.triage as { recheck?: string; withdrawn?: string[]; proposals?: Written[] } | undefined;
    for (const id of triage?.withdrawn ?? []) withdrawn.add(id);
    if (triage?.recheck === taskId) mine.push(...triage.proposals ?? []);
  }
  if (!mine.length) return { waiting: [], rejected: [] };
  const accepted = new Set<string>();
  for (const event of store.triage.taskEvents()) {
    const proposal = (event.payload.data?.task as { proposal?: string } | undefined)?.proposal;
    if (event.author === 'me' && proposal) accepted.add(proposal);
  }
  const rejected = new Set<string>();
  for (const id of new Set([...recordMessages, ...mine.flatMap((item) => item.message_ids)])) {
    for (const correction of store.triage.corrections(id)) {
      const data = correction.payload.data as { op?: string; proposal?: string } | undefined;
      if (correction.author === 'me' && data?.op === 'reject_proposal' && data.proposal) rejected.add(data.proposal);
    }
  }
  return {
    waiting: mine.map((item) => item.id).filter((id) => !withdrawn.has(id) && !accepted.has(id) && !rejected.has(id)),
    rejected: mine.filter((item) => rejected.has(item.id)).slice(-20).map((item) => ({ kind: item.kind, value: valueOf(item) })),
  };
}

// What a written proposal said, in a few words (for the AI: «do not offer this again»).
function valueOf(item: Written): string {
  const change = item.change as { title?: string; due?: string | null; items_add?: { text: string }[]; report?: { note?: string }; add?: string[]; remove?: string[] };
  if (item.kind === 'rename') return change.title ?? '';
  if (item.kind === 'due') return change.due ?? '';
  if (item.kind === 'items') return change.items_add?.map((entry) => entry.text).join('; ') ?? '';
  if (item.kind === 'status') return change.report?.note ?? '';
  if (item.kind === 'merge') return item.also?.[0]?.task_id ?? '';
  return (change.add ?? change.remove ?? item.message_ids).join(',');
}
