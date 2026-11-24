// «✨ Разобрать заново» (owner, 2026-11-23; CONCEPT.md §2.8): the last session of an open conversation goes to the
// triage again, with the sessions before it as context. What the AI decided about those messages and the owner has
// not answered is replaced: its unconfirmed tasks are cancelled by the system, its waiting proposals and questions are
// listed as withdrawn in the new result, its links (v21) the owner has not touched are taken back unless the new look
// makes them again; the AI log marks them `replaced`, so the weekly report sees where the first look failed.
// The owner's own tasks, his links and what he confirmed stay.
import { randomUUID } from 'node:crypto';
import type { JournalStore } from '../store/store.ts';
import type { JournalEvent } from '../contracts/validate.ts';
import type { LiveFeed } from '../server/live.ts';
import { tasksConfig } from '../config.ts';
import { foldTasks, isOpen } from './fold.ts';
import { sessionsOf } from './sessions.ts';
import type { Triage } from './triage.ts';
import { HttpError } from '../server/errors.ts';

const MESSAGE_KINDS = new Set(['text', 'voice', 'photo', 'file', 'link', 'call', 'sms']);

// Proposals and questions (v21) of the triage results still waiting for the owner (as web/proposals.js reads them):
// id -> message ids. A question is answered by an `answer_question` correction.
export function waitingProposals(events: JournalEvent[]): Map<string, string[]> {
  const answered = new Set<string>();
  const linked = new Set<string>();
  for (const event of events) {
    const data = (event.payload.data ?? {}) as { op?: string; proposal?: string; question?: string; task?: { proposal?: string; add?: string[] }; triage?: { withdrawn?: string[] } };
    if (event.kind === 'triage_result') for (const id of data.triage?.withdrawn ?? []) answered.add(id);
    if (event.author !== 'me') continue;
    if (event.kind === 'correction' && data.op === 'reject_proposal' && data.proposal) answered.add(data.proposal);
    if (event.kind === 'correction' && data.op === 'answer_question' && data.question) answered.add(data.question);
    if (event.kind === 'task_change') {
      if (data.task?.proposal) answered.add(data.task.proposal);
      for (const id of data.task?.add ?? []) linked.add(id);
    }
  }
  const waiting = new Map<string, string[]>();
  for (const event of events.filter((item) => item.kind === 'triage_result')) {
    const triage = (event.payload.data?.triage ?? {}) as { proposals?: { id: string; message_ids: string[] }[]; questions?: { id: string; message_ids: string[] }[] };
    for (const proposal of triage.proposals ?? []) if (!answered.has(proposal.id) && !proposal.message_ids.some((id) => linked.has(id))) waiting.set(proposal.id, proposal.message_ids);
    for (const question of triage.questions ?? []) if (!answered.has(question.id)) waiting.set(question.id, question.message_ids);
  }
  return waiting;
}

// The system's links (v21) of `ids` still in their task and not touched by the owner (he put the message in or took
// it out of that task himself): task id -> message ids.
export function systemLinks(events: JournalEvent[], ids: Set<string>): { task_id: string; message_ids: string[] }[] {
  const touched = new Set<string>();
  const links = new Map<string, Set<string>>();
  for (const event of events) {
    const change = event.payload.data?.task as { op?: string; add?: string[]; remove?: string[] } | undefined;
    if (event.kind !== 'task_change' || !change) continue;
    const task = event.payload.ref!.id;
    if (event.author === 'me') for (const id of [...(change.add ?? []), ...(change.remove ?? [])]) touched.add(`${task}|${id}`);
    else if (event.author === 'system' && change.op === 'update') for (const id of change.add ?? []) if (ids.has(id)) links.set(task, new Set([...(links.get(task) ?? []), id]));
  }
  const inTask = new Map(foldTasks(events).map((task) => [task.id, new Set(task.messages)]));
  return [...links].map(([task, found]) => ({ task_id: task, message_ids: [...found].filter((id) => !touched.has(`${task}|${id}`) && inTask.get(task)?.has(id)) }))
    .filter((link) => link.message_ids.length);
}

// `ids` — the open conversation's messages as the card shows them. → what went again and what was replaced.
export async function retriage({ store, live, triage, ids }: { store: JournalStore; live: LiveFeed; triage: Triage; ids: string[] }):
  Promise<{ messages: number; tasks: number; proposals: number; questions: number; links: number; written: number }> {
  const messages = ids.map((id) => store.getEvent(id)).filter((event): event is JournalEvent => Boolean(event) && MESSAGE_KINDS.has(event!.kind) && event!.author !== 'system');
  const batch = (sessionsOf(messages, tasksConfig.session_gap_h * 3_600_000).at(-1) ?? []).slice(-tasksConfig.max_batch);
  if (!batch.length) return { messages: 0, tasks: 0, proposals: 0, questions: 0, links: 0, written: 0 };
  const inBatch = new Set(batch.map((event) => event.id));
  const at = new Date().toISOString();
  // The AI's tasks the owner has not confirmed yet, made from these messages.
  const tasks = foldTasks(store.triage.taskEvents()).filter((task) => task.created_by === 'system' && task.unconfirmed && isOpen(task)
    && task.messages.some((id) => inBatch.has(id)));
  const results = store.triage.results();
  const questionIds = new Set(results.flatMap((result) => ((result.payload.data?.triage ?? {}) as { questions?: { id: string }[] }).questions ?? []).map((question) => question.id));
  const waiting = [...waitingProposals([...results, ...store.triage.taskEvents(), ...correctionsOf(store, inBatch)])]
    .filter(([, messageIds]) => messageIds.some((id) => inBatch.has(id))).map(([id]) => id);
  const links = systemLinks(store.triage.taskEvents(), inBatch);
  // The new look first: if the AI fails, nothing is withdrawn.
  const budget = tasksConfig.ai.monthly_budget_usd;
  if (store.triage.spent(at.slice(0, 7)) >= budget) throw new HttpError(409, `Исчерпан лимит трат на ИИ за месяц (${budget} $)`);
  const written = await triage.run(batch, { again: at, withdrawn: waiting, unlink: links });
  for (const task of tasks) {
    const result = store.appendEvent({ id: randomUUID(), schema_version: 1, source: 'system', author: 'system', ts: at, kind: 'task_change',
      payload: { ref: { type: 'task', id: task.id }, data: { task: { op: 'update', status: 'cancelled', reason: 'Разобрано заново' } } } });
    if (result.created) live.publish(result.event);
  }
  // The links taken back are those no longer in their task: the new look may have made some again.
  const after = new Map(foldTasks(store.triage.taskEvents()).map((task) => [task.id, new Set(task.messages)]));
  const taken = links.map((link) => ({ ...link, message_ids: link.message_ids.filter((id) => !after.get(link.task_id)?.has(id)) })).filter((link) => link.message_ids.length);
  store.ailog.replace(waiting, tasks.map((task) => task.id), at, taken);
  const questions = waiting.filter((id) => questionIds.has(id)).length;
  return { messages: batch.length, tasks: tasks.length, proposals: waiting.length - questions, questions,
    links: taken.reduce((sum, link) => sum + link.message_ids.length, 0), written };
}

// «✕» under a proposal is a correction of the message it is shown under.
const correctionsOf = (store: JournalStore, ids: Set<string>) => [...ids].flatMap((id) => store.triage.corrections(id));
