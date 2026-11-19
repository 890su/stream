// Swipes on a «Беседы» row (CONCEPT.md §5, 2026-11-19): right-to-left — «Отвечено» (a correction on the latest
// message; «Вернуть» takes it back); left-to-right — the conversation's task: the most urgent open one, or a new
// task of mine from its latest incoming message («Вернуть» cancels it). pickTask and the message choices are pure.
import { swipe } from './swipe.js';
import { makeCorrection, makeTaskChange, ownTask } from './shared.js';
import { isOpen, dueState } from './taskfold.js';
import { snippet } from './projection.js';
import { directionOf } from './conversations.js';

const live = (conversation) => conversation.views.filter((view) => !view.deleted);

// The message «Отвечено» is put on: the latest one of the conversation.
export const anchorOf = (conversation) => live(conversation).at(-1) ?? null;

// The message a new task starts from: the latest incoming one, else the latest.
export const sourceOf = (conversation) => live(conversation).filter((view) => directionOf(view.event) === 'in').at(-1) ?? anchorOf(conversation);

// The task a swipe opens: overdue, due today, waiting for a decision, then the most recently changed.
export function pickTask(conversation, now = new Date()) {
  const rank = (task) => {
    const due = dueState(task, now);
    return due === 'overdue' ? 0 : due === 'today' ? 1 : ['inbox', 'review'].includes(task.status) ? 2 : 3;
  };
  return conversation.tasks.filter((task) => isOpen(task) && !task.filed)
    .sort((a, b) => rank(a) - rank(b) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0] ?? null;
}

export function createConvQuick({ queue, notify, openTask }) {
  const fail = (error) => notify(error.message);

  function answered(conversation) {
    const anchor = anchorOf(conversation);
    if (!anchor) return;
    queue(makeCorrection(anchor.id, 'answered'))
      .then(() => notify(`Отвечено: «${conversation.title}»`, { label: 'Вернуть', run: () => queue(makeCorrection(anchor.id, 'unanswered')).catch(fail) }))
      .catch(fail);
  }

  async function task(conversation) {
    const existing = pickTask(conversation);
    if (existing) { openTask(existing.id); return; }
    const source = sourceOf(conversation);
    if (!source) return;
    const id = crypto.randomUUID();
    try { await queue(makeTaskChange(id, ownTask(snippet(source).slice(0, 120), source.id))); } catch (error) { fail(error); return; }
    openTask(id);
    notify(`Задача из беседы «${conversation.title}»`, { label: 'Вернуть', run: () => queue(makeTaskChange(id, { op: 'update', status: 'cancelled' })).catch(fail) });
  }

  // Adds both swipes to a conversation row.
  const decorate = (row, conversation) => swipe(row, { right: 'task', left: 'answered', onRight: () => task(conversation), onLeft: () => answered(conversation) });

  return { decorate };
}
