// A conversation's tasks for its head (docs/plans/2026-11-21-workspace-redesign-design.md): empty, unconfirmed (the
// AI's offer) or real. Filed notes and closed tasks are not counted. The cuts that folded a conversation's messages by
// task are gone (owner, 2026-11-24): messages run in a row. Pure — no DOM.
import { isOpen } from './taskfold.js';
import { byUrgency } from './convlist.js';

// { state: 'empty' | 'unconfirmed' | 'task', tasks } — open tasks of the conversation, real ones first by urgency.
export function topicOf(conversation, now = new Date()) {
  const open = (conversation.tasks ?? []).filter((task) => isOpen(task) && !task.filed);
  const real = open.filter((task) => !task.unconfirmed).sort(byUrgency(now));
  const offered = open.filter((task) => task.unconfirmed).sort(byUrgency(now));
  return { state: real.length ? 'task' : offered.length ? 'unconfirmed' : 'empty', tasks: [...real, ...offered] };
}
