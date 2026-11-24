// «→ «название» ↩» under a message (docs/plans/2026-11-23-conversation-records-design.md «Разбор беседы»): the
// v21 triage put the message into an existing record by itself — a system `task_change` `update` adding it. The
// title opens the record; «↩» takes the message out by my `task_change` `remove` (the triage never adds back a
// message I took out). A link I touched myself (removed, or added again) is mine, not a mark. linkMarks and
// unlinkEvent are pure; linkMarkBlock builds the DOM, setupLinkMarks handles «↩» anywhere.
import { makeTaskChange } from './shared.js';

// The system links of a message to records it is still in: [{ taskId, title }]. `view` — { id, taskIds }.
export function linkMarks(view, tasksById) {
  const marks = [];
  for (const taskId of view.taskIds ?? []) {
    const task = tasksById.get(taskId);
    if (!task || !(task.messages ?? []).includes(view.id)) continue;
    let linked = false;
    let touched = false;
    for (const entry of task.history ?? []) {
      const change = entry.change ?? {};
      const names = (change.add ?? []).includes(view.id) || (change.remove ?? []).includes(view.id);
      if (entry.author === 'me' && names) touched = true;
      else if (entry.author === 'system' && change.op === 'update' && (change.add ?? []).includes(view.id)) linked = true;
    }
    if (linked && !touched) marks.push({ taskId, title: task.title });
  }
  return marks;
}

// «↩»: my change taking the message out of the record.
export const unlinkEvent = (messageId, taskId) => makeTaskChange(taskId, { op: 'update', remove: [messageId] });

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The marks under a bubble (bubble.js); `view.links` — linkMarks.
export function linkMarkBlock(view) {
  const box = element('div', 'link-marks');
  for (const mark of view.links) {
    const line = element('span', 'link-mark');
    const title = element('button', 'link-mark-title', `→ «${mark.title}»`);
    title.type = 'button';
    title.dataset.taskOpen = mark.taskId; // opens the record (details.js)
    title.setAttribute('aria-label', `ИИ добавил в «${mark.title}». Открыть`);
    const undo = element('button', 'link-mark-undo', '↩');
    undo.type = 'button';
    undo.dataset.unlinkTask = mark.taskId;
    undo.setAttribute('aria-label', `Убрать сообщение из «${mark.title}»`);
    line.append(title, undo);
    box.append(line);
  }
  return box;
}

// «↩» anywhere (feed, details). `queue(entry)` — the outbox; `getTask(id)` — for the title in the toast.
export function setupLinkMarks({ queue, notify, getTask = () => null }) {
  document.body.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-unlink-task]');
    if (!button) return;
    event.stopPropagation();
    const messageId = button.closest('[data-id]')?.dataset.id;
    const taskId = button.dataset.unlinkTask;
    if (!messageId) return;
    try {
      await queue(unlinkEvent(messageId, taskId));
      notify(`Сообщение убрано из «${getTask(taskId)?.title ?? 'записи'}»`);
    } catch (error) { notify(error.message); }
  }, true);
}
