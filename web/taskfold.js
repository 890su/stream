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

// message id -> ids of the tasks it belongs to (for the mark under a message).
export function tasksByMessage(tasks) {
  const map = new Map();
  for (const task of tasks) for (const message of task.messages) map.set(message, [...(map.get(message) ?? []), task.id]);
  return map;
}
