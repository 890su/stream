// The feed of cases (CONCEPT.md §2.9): visible messages grouped by their case — the task they belong to; a
// message without a task stays as it is. Ordered by the last message: a case with a new message goes down,
// next to the composer. Pure: no DOM, no storage — tested in node.
import { isOpen, doneStage } from './taskfold.js';
import { chatOf } from './projection.js';
import { phoneLabel } from './phonebubble.js';

// The case a message is shown under: its open task updated last, else the task finished last.
export function caseOf(view, tasksById) {
  const tasks = (view.taskIds ?? []).map((id) => tasksById.get(id)).filter(Boolean);
  const open = tasks.filter(isOpen).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (open.length) return open[0];
  return tasks.sort((a, b) => (b.doneAt ?? b.updatedAt).localeCompare(a.doneAt ?? a.updatedAt))[0] ?? null;
}

// With whom the case is: chat titles and phone contacts of its messages, in order of appearance.
export function withWhom(views) {
  const names = [];
  for (const view of views) {
    const event = view.event;
    const name = chatOf(event)?.title ?? (event.kind === 'call' || event.kind === 'sms' ? phoneLabel(event).who : null);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

const tsOf = (view) => Date.parse(view.event.ts);
// A message the triage has not reached yet follows the message it continues or answers.
const parentOf = (view) => view.continues ?? view.event.reply_to ?? null;

// Messages of one case, oldest first: its own, and untriaged ones that continue or answer them (case screen).
export function caseMembers(task, views) {
  const members = new Set(task.messages);
  const result = [];
  for (const view of [...views].sort((a, b) => tsOf(a) - tsOf(b))) {
    if (view.deleted) continue;
    if (members.has(view.id) || (!view.taskIds?.length && members.has(parentOf(view)))) { members.add(view.id); result.push(view); }
  }
  return result;
}

// Items of the feed, oldest activity first: { kind: 'case', task, views, last, stage } or { kind: 'message', view }.
// `stage` — the fold of a finished case (taskfold.js doneStage), null while it is open.
export function feedItems(visible, tasksById, { now = new Date(), fadeDays = 2, showDone = false } = {}) {
  const cases = new Map();
  const caseByView = new Map();
  const items = [];
  for (const view of [...visible].sort((a, b) => tsOf(a) - tsOf(b))) {
    // An untriaged follow-up joins an open case; after a finished one it stays visible on its own.
    const parent = view.taskIds?.length ? null : caseByView.get(parentOf(view));
    const task = caseOf(view, tasksById) ?? (parent && isOpen(parent) ? parent : null);
    if (task) caseByView.set(view.id, task);
    if (!task) { items.push({ kind: 'message', view, last: tsOf(view) }); continue; }
    let item = cases.get(task.id);
    if (!item) { item = { kind: 'case', task, views: [], last: 0, stage: doneStage([task.id], tasksById, now, fadeDays) }; cases.set(task.id, item); items.push(item); }
    item.views.push(view);
    item.last = Math.max(item.last, tsOf(view));
  }
  for (const item of cases.values()) item.views.sort((a, b) => tsOf(a) - tsOf(b));
  return items.filter((item) => item.kind === 'message' || showDone || item.stage !== 'hidden').sort((a, b) => a.last - b.last);
}

// Messages shown under a case header. `state` — the reader's choice: 'all' (the last `expandLast`), 'none', or
// undefined: an open case shows messages of the last `freshH` hours, a finished one nothing.
export function shownViews(item, state, { now = Date.now(), freshH = 6, expandLast = 10 } = {}) {
  if (state === 'none') return [];
  if (state === 'all') return item.views.slice(-expandLast);
  if (item.stage) return [];
  return item.views.filter((view) => now - tsOf(view) <= freshH * 3_600_000);
}
