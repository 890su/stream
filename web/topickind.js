// Topic or task (docs/plans/2026-11-23-topics-design.md): a topic is a task record with `kind: 'topic'` — out of every
// task view; `offer` — the AI offers to make it a task (✓ makes it one, ✕ keeps the topic). The folds set both
// (taskfold.js, src/tasks/fold.ts); no `kind` is a task. Pure.
import { isOpen, foldKind } from './taskfold.js';

export const isTopic = (task) => task?.kind === 'topic';
export const isTask = (task) => Boolean(task) && task.kind !== 'topic';
// An open topic the AI offers to make a task.
export const hasOffer = (task) => isTopic(task) && task.offer === true && isOpen(task);

// The owner's adds made while the record was a task (a link to a topic is no answer — it keeps the conversation in
// the queue): `adds` — [{ ts, ids }] in history order; `owned` — ids still there (a later remove takes one back).
export function ownerTaskAdds(task) {
  const state = { id: task.id, kind: 'task', offer: false };
  const given = new Set();
  const adds = [];
  const owned = new Set();
  for (const entry of task.history ?? []) {
    const change = entry.change ?? {};
    foldKind(state, change, entry.author, given);
    if (entry.author === 'me' && state.kind !== 'topic' && change.add?.length) {
      adds.push({ ts: entry.ts, ids: change.add });
      for (const id of change.add) owned.add(id);
    }
    for (const id of change.remove ?? []) owned.delete(id);
  }
  return { adds, owned };
}
