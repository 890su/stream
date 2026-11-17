// Tasks as the fold of task_change events (CONCEPT.md §2.8); the server folds the same way (src/tasks/fold.ts).
// Pure: no DOM, no storage — tested in node.

const OPEN = new Set(['inbox', 'todo', 'doing', 'waiting']);
export const isOpen = (task) => OPEN.has(task.status);

export const ASSIGNEES = { me: 'Я', ai: 'ИИ', system: 'Система', person: 'Человек' };
export const STATUSES = { inbox: 'разобрать', todo: 'сделать', doing: 'в работе', waiting: 'ждёт', done: 'готово', cancelled: 'отменено' };

const order = (a, b) => a.ts.localeCompare(b.ts) || (a.received_at ?? '￿').localeCompare(b.received_at ?? '￿');

export function foldTasks(events) {
  const tasks = new Map();
  for (const event of events.filter((item) => item.kind === 'task_change').sort(order)) {
    const id = event.payload?.ref?.id;
    const change = event.payload?.data?.task ?? {};
    let task = tasks.get(id);
    if (!task) {
      if (change.op !== 'create') continue;
      task = { id, title: change.title, status: 'todo', assignee: 'me', messages: [], createdBy: event.author, createdAt: event.ts, updatedAt: event.ts };
      tasks.set(id, task);
    }
    for (const key of ['title', 'status', 'assignee', 'person', 'template', 'due', 'confidence', 'processor', 'note']) {
      if (change[key] !== undefined) task[key] = change[key];
    }
    // When the task was finished: the feed folds its messages away by this age (CONCEPT.md §2.8).
    if (change.status !== undefined) task.doneAt = OPEN.has(change.status) ? undefined : event.ts;
    for (const message of change.add ?? []) if (!task.messages.includes(message)) task.messages.push(message);
    if (change.remove) task.messages = task.messages.filter((message) => !change.remove.includes(message));
    task.updatedAt = event.ts;
  }
  return [...tasks.values()];
}

// The panel's list: `who` — 'me' | 'ai' | 'system' | 'person' | 'all'; `done` — show finished instead of open.
export function visibleTasks(tasks, { who = 'me', done = false } = {}) {
  return tasks
    .filter((task) => (who === 'all' || task.assignee === who) && (done ? !isOpen(task) : isOpen(task)))
    .sort((a, b) => (a.status === 'inbox') - (b.status === 'inbox') || b.updatedAt.localeCompare(a.updatedAt));
}

const dayStart = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

// How the feed shows a message whose tasks are all finished: 'collapsed' on the day the last one finished,
// 'faded' for `fadeDays` more days, then 'hidden'. null — no tasks, or one is still open.
export function doneStage(taskIds, tasksById, now = new Date(), fadeDays = 2) {
  const tasks = (taskIds ?? []).map((id) => tasksById.get(id)).filter(Boolean);
  if (!tasks.length || tasks.some(isOpen)) return null;
  const finished = Math.max(...tasks.map((task) => Date.parse(task.doneAt ?? task.updatedAt)));
  const days = Math.round((dayStart(now) - dayStart(new Date(finished))) / 86_400_000);
  return days <= 0 ? 'collapsed' : days <= fadeDays ? 'faded' : 'hidden';
}

// message id -> ids of the tasks it belongs to (for the mark under a message).
export function tasksByMessage(tasks) {
  const map = new Map();
  for (const task of tasks) for (const message of task.messages) map.set(message, [...(map.get(message) ?? []), task.id]);
  return map;
}
