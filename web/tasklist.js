// The «Задачи» view in the centre (CONCEPT.md §5): one compact row per task, like a task manager. A tap opens
// the task's details on the right. Filters (assignee, status, due, contact, tags) come from the left panel.
import { STATUSES, dueState } from './taskfold.js';
import { withWhom } from './conversations.js';
import { partyName } from './parties.js';

const day = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' });

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The facts of a row, in order. Who does it — the first executor, else the responsible — is shown in every list
// but «Мои» (`showAssignee`). Pure (tested in node).
export function rowParts(task, views, { showAssignee = false, now = new Date() } = {}) {
  const parts = [STATUSES[task.status] ?? task.status];
  if (task.proposed === 'done') parts.push('готово?');
  const who = task.roles?.executors?.[0] ?? task.roles?.responsible;
  if (showAssignee && who) parts.push(partyName(who, views));
  const whom = withWhom(views).slice(0, 2).join(', ');
  if (whom) parts.push(whom);
  if (task.due) parts.push(`${dueState(task, now) === 'overdue' ? 'просрочено, ' : ''}до ${day.format(new Date(task.due))}`);
  parts.push(`${task.messages.length} сообщ.`);
  if (task.confidence !== undefined && task.confidence < 0.6) parts.push('проверьте');
  return parts;
}

// `views` — the task's messages (for «с кем» and names); `onOpen(id)` — show its details; `showAssignee` — not «Мои».
export function taskRow(task, views, { onOpen, showAssignee }) {
  const row = element('button', `task-row ${task.status}${task.proposed === 'done' ? ' proposed' : ''}`);
  row.type = 'button';
  row.dataset.task = task.id;
  row.append(element('span', 'task-title', task.title), element('span', 'task-meta', rowParts(task, views, { showAssignee }).join(' · ')));
  row.onclick = () => onOpen(task.id);
  return row;
}

export function emptyTasks(filter) {
  return element('div', 'empty', `Задач в списке «${filter.title}» нет.`);
}
