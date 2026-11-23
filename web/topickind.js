// Topic or task (docs/plans/2026-11-23-topics-design.md): a topic is a task record with `kind: 'topic'` — out of every
// task view; `offer` — the AI offers to make it a task (✓ makes it one, ✕ keeps the topic). The folds set both
// (taskfold.js, src/tasks/fold.ts); no `kind` is a task. Pure.
import { isOpen, foldKind } from './taskfold.js';

export const isTopic = (task) => task?.kind === 'topic';
export const isTask = (task) => Boolean(task) && task.kind !== 'topic';
// An open topic the AI offers to make a task.
export const hasOffer = (task) => isTopic(task) && task.offer === true && isOpen(task);

// The owner's adds made while the record was a task (a link to a topic is no answer — it keeps the conversation in
// the queue); the owner making a topic a task takes all its messages then. `adds` — [{ ts, ids }] in history order;
// `owned` — ids still there (a later remove takes one back).
export function ownerTaskAdds(task) {
  const state = { id: task.id, kind: 'task', offer: false };
  const given = new Set();
  const adds = [];
  const owned = new Set();
  const messages = new Set();
  for (const entry of task.history ?? []) {
    const change = entry.change ?? {};
    const before = state.kind;
    foldKind(state, change, entry.author, given);
    for (const id of change.add ?? []) messages.add(id);
    for (const id of change.remove ?? []) { messages.delete(id); owned.delete(id); }
    if (entry.author !== 'me' || state.kind === 'topic') continue;
    const ids = before === 'topic' ? [...messages] : change.add ?? [];
    if (!ids.length) continue;
    adds.push({ ts: entry.ts, ids });
    for (const id of ids) owned.add(id);
  }
  return { adds, owned };
}
