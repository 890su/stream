// Actions on a «Беседы» queue tile (CONCEPT.md §5, docs/plans/2026-11-20-queue-and-task-screen-design.md):
// swipe right-to-left — to the archive (`answered` on the latest message; a new message brings it back); swipe
// left-to-right — the task: confirms the one the AI chose for what waits (the owner's link takes it out of the queue),
// opens the owner's own, or makes one from what waits; «⏱» — `snooze`, «↥» — `requeue`, «+ задача…» — a new task
// of mine with everything that waits. Each with «Вернуть» in the toast where it can be undone. swipePlan and the
// message choices are pure.
import { swipe } from './swipe.js';
import { makeCorrection, makeTaskChange, ownTask } from './shared.js';
import { snippet } from './projection.js';
import { directionOf } from './conversations.js';
import { pickTask, tileTask } from './convlist.js';

export { pickTask };

const live = (conversation) => conversation.views.filter((view) => !view.deleted);

// The message the queue marks go on: the latest one of the conversation.
export const anchorOf = (conversation) => live(conversation).at(-1) ?? null;

// The message a new task starts from: the latest incoming one, else the latest.
export const sourceOf = (conversation) => live(conversation).filter((view) => directionOf(view.event) === 'in').at(-1) ?? anchorOf(conversation);

const pendingIds = (conversation) => (conversation.queue?.pending ?? []).map((view) => view.id);

// What a swipe right does: { type: 'confirm', task, add } | { type: 'open', task } | { type: 'create', source, add }.
export function swipePlan(conversation, now = new Date()) {
  const chosen = tileTask(conversation, now);
  if (chosen?.guessed) return { type: 'confirm', task: chosen.task, add: pendingIds(conversation) };
  if (chosen) return { type: 'open', task: chosen.task };
  const add = pendingIds(conversation);
  return { type: 'create', source: sourceOf(conversation), add: add.length ? add : [sourceOf(conversation)?.id].filter(Boolean) };
}

export function createConvQuick({ queue, notify, openTask }) {
  const fail = (error) => notify(error.message);
  const mark = (conversation, op, undo, text, options = {}) => {
    const anchor = anchorOf(conversation);
    if (!anchor) return Promise.resolve();
    return queue(makeCorrection(anchor.id, op, options))
      .then(() => notify(text, { label: 'Вернуть', run: () => queue(makeCorrection(anchor.id, undo)).catch(fail) }))
      .catch(fail);
  };

  const archive = (conversation) => mark(conversation, 'answered', 'unanswered', `В архиве: «${conversation.title}»`);
  const snooze = (conversation, until) => mark(conversation, 'snooze', 'unsnooze', `Отложено до ${new Date(until).toLocaleString('ru', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}: «${conversation.title}»`, { until });
  const requeue = (conversation) => mark(conversation, 'requeue', 'unrequeue', `В конце очереди: «${conversation.title}»`);

  // A task of mine titled by the owner, with everything that waits.
  async function newTask(conversation, title) {
    const plan = swipePlan({ ...conversation, tasks: [] });
    if (!plan.add.length) return;
    const id = crypto.randomUUID();
    const change = { ...ownTask(title, plan.add[0]), add: plan.add };
    try { await queue(makeTaskChange(id, change)); } catch (error) { fail(error); return; }
    // «Вернуть» cancels the task and takes the messages out of it: the conversation is back in its place.
    notify(`Задача: «${title}»`, { label: 'Вернуть', run: () => queue(makeTaskChange(id, { op: 'update', status: 'cancelled', remove: plan.add })).catch(fail) });
  }

  async function task(conversation) {
    const plan = swipePlan(conversation);
    if (plan.type === 'open') { openTask(plan.task.id); return; }
    if (plan.type === 'confirm') {
      try { await queue(makeTaskChange(plan.task.id, { op: 'update', add: plan.add })); } catch (error) { fail(error); return; }
      notify(`В задаче «${plan.task.title}»`);
      return;
    }
    if (!plan.source) return;
    const id = crypto.randomUUID();
    try { await queue(makeTaskChange(id, { ...ownTask(snippet(plan.source).slice(0, 120), plan.source.id), add: plan.add })); } catch (error) { fail(error); return; }
    openTask(id);
    notify(`Задача из беседы «${conversation.title}»`, { label: 'Вернуть', run: () => queue(makeTaskChange(id, { op: 'update', status: 'cancelled', remove: plan.add })).catch(fail) });
  }

  // Adds both swipes to a tile.
  const decorate = (row, conversation) => swipe(row, { right: 'task', left: 'archive', labels: { right: { icon: '☑', text: 'Задача' }, left: { icon: '🗄', text: 'В архив' } }, onRight: () => task(conversation), onLeft: () => archive(conversation) });

  return { decorate, archive, snooze, requeue, newTask };
}
