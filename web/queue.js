// The queue of conversations (CONCEPT.md §2.5, docs/plans/2026-11-20-queue-and-task-screen-design.md): which
// conversations wait for the owner and since when. Only the owner's actions take a conversation out: a reply, a task
// made or chosen by the owner for its messages (an AI link is not one), the archive mark (`answered`), «⏱ Отложить»
// (`snooze`). Its place is its queue moment — the first waiting message, lifted by «↧» (`requeue`) or by the end of a
// snooze; a new message in a queued conversation does not move it. Pure — no DOM.
import { conversationOf, directionOf } from './conversations.js';
import { involvesMe, isOpen } from './taskfold.js';

const time = (ts) => Date.parse(ts);
const later = (a, b) => (time(b) > time(a) ? b : a);
const NONE = { waiting: false, moment: null, since: null, pending: [], snoozedUntil: null };

// Message ids the owner put into a task (a change authored `me` that adds them) and that are still there: those
// messages are handled. A later `remove` (as «Вернуть» on a task made from a tile does) undoes it.
export function ownerLinked(tasks) {
  const ids = new Set();
  for (const task of tasks) {
    const owned = new Set();
    for (const entry of task.history ?? []) {
      if (entry.author === 'me') for (const id of entry.change?.add ?? []) owned.add(id);
      for (const id of entry.change?.remove ?? []) owned.delete(id);
    }
    for (const id of owned) ids.add(id);
  }
  return ids;
}

// { waiting, moment, since (the first waiting message), pending (waiting messages), snoozedUntil }.
// `conversation` needs key, views (with taskIds), tasks and group; `owner` — ownerLinked of all tasks.
export function queueOf(conversation, { now = new Date(), config, owner = new Set() }) {
  if (conversation.key === 'me' || conversation.key.startsWith('task:')) return NONE;
  const views = conversation.views.filter((view) => !view.deleted).sort((a, b) => time(a.event.ts) - time(b.event.ts));
  const byId = new Map(views.map((view) => [view.id, view]));
  const taskOf = new Map(conversation.tasks.map((task) => [task.id, task]));
  // An own note pulled into a chat or a number (a call description, a reply not sent) is neither an answer nor waiting.
  const note = (view) => conversationOf(view.event) === 'me';
  const answeredCall = (view) => view.event.kind === 'call' && view.event.payload?.data?.call?.direction === 'in';
  // Context-only messages and messages belonging only to filed tasks do not wait for an answer.
  const meaningful = (view) => {
    const tasks = (view.taskIds ?? []).map((id) => taskOf.get(id)).filter(Boolean);
    return tasks.length ? tasks.some((task) => !task.filed) : !view.conversationOnly;
  };
  // In a group, someone else's message matters to me only when it answers mine or is in a task where I have a role.
  const matters = (view) => {
    if (!conversation.group) return true;
    const parent = view.event.reply_to && byId.get(view.event.reply_to);
    if (parent && directionOf(parent.event) === 'out') return true;
    return (view.taskIds ?? []).some((id) => { const task = taskOf.get(id); return task && involvesMe(task); });
  };

  let handled = -Infinity;
  for (const view of views) {
    const mine = directionOf(view.event) === 'out' && !note(view);
    if (mine || view.answered || owner.has(view.id) || answeredCall(view)) handled = Math.max(handled, time(view.event.ts));
  }
  // Messages from before the queue started (`queue.since`) wait for nobody: the history imported with the channels.
  const start = time(config.queue.since);
  const pending = views.filter((view) => time(view.event.ts) > handled && time(view.event.ts) >= start && directionOf(view.event) === 'in'
    && !answeredCall(view) && !note(view) && meaningful(view) && matters(view));
  const open = pending.length ? null : unfinishedOf(conversation, views, start);
  if (!pending.length && !open) return NONE;

  let moment = pending[0]?.event.ts ?? open.moment;
  const requeue = views.flatMap((view) => view.requeues ?? []).filter((ts) => time(ts) > handled).sort((a, b) => time(a) - time(b)).at(-1);
  if (requeue) moment = later(moment, requeue);
  const snooze = views.flatMap((view) => view.snoozes ?? []).filter((item) => time(item.at) > handled).sort((a, b) => time(a.at) - time(b.at)).at(-1);
  if (snooze) {
    const after = pending.find((view) => time(view.event.ts) > time(snooze.at));
    if (after) moment = later(moment, after.event.ts);
    else if (now.getTime() < time(snooze.until)) return { ...NONE, pending, snoozedUntil: snooze.until };
    else moment = later(moment, snooze.until);
  }
  return { waiting: true, moment, since: pending[0]?.event.ts ?? open.moment, pending, snoozedUntil: null, open: open?.reason ?? null };
}

// No message waits, yet the conversation is not over (owner, 2026-11-21): the latest triage verdict says the other side
// still waits for me and no task covers it, or an AI task waits for ✓ or ✕. My reply does not end it; the archive mark,
// a task of mine for its messages or a later verdict «finished» does. → { reason, moment (the last incoming) } or null.
function unfinishedOf(conversation, views, start) {
  const ids = new Set(views.map((view) => view.id));
  let cleared = -Infinity;
  for (const view of views) if (view.answered && view.answeredAt) cleared = Math.max(cleared, time(view.answeredAt));
  for (const task of conversation.tasks) {
    for (const entry of task.history ?? []) if (entry.author === 'me' && (entry.change?.add ?? []).some((id) => ids.has(id))) cleared = Math.max(cleared, time(entry.ts));
  }
  const lastIn = views.filter((view) => directionOf(view.event) === 'in').at(-1);
  const at = (ts) => (lastIn ? lastIn.event.ts : ts);
  const offer = conversation.tasks.find((task) => task.unconfirmed && isOpen(task) && time(task.createdAt) > cleared);
  if (offer) return { reason: 'ИИ предлагает задачу', moment: at(offer.createdAt) };
  const verdict = views.filter((view) => view.verdict).at(-1)?.verdict;
  if (!verdict?.unfinished || time(verdict.ts) <= cleared || time(verdict.ts) < start) return null;
  return { reason: verdict.unfinished, moment: at(verdict.ts) };
}

// The waiting conversations as the screen shows them top to bottom: the longest waiting first, the newest moment
// last (owner, 2026-11-21: the most important on top).
export function queueList(list) {
  return list.filter((item) => item.queue?.waiting).sort((a, b) => time(a.queue.moment) - time(b.queue.moment) || a.key.localeCompare(b.key));
}

// When the owner last dealt with a conversation: its latest message (a reply is one), the archive mark, a snooze, a
// task of theirs taking its messages — whichever is latest.
export function handledAt(conversation) {
  const ids = new Set(conversation.views.map((view) => view.id));
  let at = conversation.last;
  for (const view of conversation.views) {
    if (view.answered && view.answeredAt) at = later(at, view.answeredAt);
    for (const item of view.snoozes ?? []) at = later(at, item.at);
  }
  for (const task of conversation.tasks) {
    for (const entry of task.history ?? []) if (entry.author === 'me' && (entry.change?.add ?? []).some((id) => ids.has(id))) at = later(at, entry.ts);
  }
  return at;
}

// The archive above the queue (owner, 2026-11-21): the conversations that wait for nothing (read, answered, archived,
// snoozed), each with `handledAt`, the last handled first — the screen shows it nearest the «Архив» divider. Own
// notes («Заметки», a task's notes) are not conversations with anyone and stay out.
export function archiveList(list) {
  return list.filter((item) => !item.queue?.waiting && item.key !== 'me' && !item.key.startsWith('task:'))
    .map((item) => ({ ...item, handledAt: handledAt(item) }))
    .sort((a, b) => time(b.handledAt) - time(a.handledAt) || a.key.localeCompare(b.key));
}
