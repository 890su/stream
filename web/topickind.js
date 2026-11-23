// Topic or task (docs/plans/2026-11-23-topics-design.md): a topic is a task record with `kind: 'topic'` — out of every
// task view; `offer` — the AI offers to make it a task (✓ makes it one, ✕ keeps the topic). The folds set both
// (taskfold.js, src/tasks/fold.ts); no `kind` is a task. Pure.
import { isOpen } from './taskfold.js';

export const isTopic = (task) => task?.kind === 'topic';
export const isTask = (task) => Boolean(task) && task.kind !== 'topic';
// An open topic the AI offers to make a task.
export const hasOffer = (task) => isTopic(task) && task.offer === true && isOpen(task);
