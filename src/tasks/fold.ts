import type { JournalEvent } from '../contracts/validate.ts';

// Tasks as the fold of `task_change` events (CONCEPT.md §2.8). The client folds the same way (web/taskfold.js).

export interface Task {
  id: string; title: string; status: string; assignee: string; person?: string; template?: string; due?: string | null;
  messages: string[]; confidence?: number; processor?: string; proposed?: string | null; created_by: string; created_at: string; updated_at: string;
}

const OPEN = new Set(['inbox', 'todo', 'doing', 'waiting']);
export const isOpen = (task: Task) => OPEN.has(task.status);

export function foldTasks(events: JournalEvent[]): Task[] {
  const tasks = new Map<string, Task>();
  const ordered = events.filter((event) => event.kind === 'task_change')
    .sort((a, b) => a.ts.localeCompare(b.ts) || (a.received_at ?? '').localeCompare(b.received_at ?? ''));
  for (const event of ordered) {
    const id = event.payload.ref!.id;
    const change = event.payload.data!.task as Record<string, any>;
    let task = tasks.get(id);
    if (!task) {
      if (change.op !== 'create') continue;
      task = { id, title: change.title, status: 'todo', assignee: 'me', messages: [], created_by: event.author, created_at: event.ts, updated_at: event.ts };
      tasks.set(id, task);
    }
    for (const key of ['title', 'status', 'assignee', 'person', 'template', 'due', 'confidence', 'processor', 'proposed'] as const) {
      if (change[key] !== undefined) (task as any)[key] = change[key];
    }
    for (const message of change.add ?? []) if (!task.messages.includes(message)) task.messages.push(message);
    if (change.remove) task.messages = task.messages.filter((message) => !change.remove.includes(message));
    task.updated_at = event.ts;
  }
  return [...tasks.values()];
}
