// Derives the next occurrence of a recurring task and its lifecycle events.
import type { JournalEvent } from '../contracts/validate.ts';
import { foldTasks, isOpen, type Repeat, type Task } from './fold.ts';
import { nameId } from '../ids.ts';

function advance(value: string, repeat: Repeat): Date {
  const date = new Date(value);
  if (repeat.every === 'day' || repeat.every === 'week') {
    date.setUTCDate(date.getUTCDate() + repeat.n * (repeat.every === 'week' ? 7 : 1));
  } else {
    const day = date.getUTCDate();
    date.setUTCMonth(date.getUTCMonth() + repeat.n * (repeat.every === 'year' ? 12 : 1), 1);
    const last = new Date(date);
    last.setUTCMonth(last.getUTCMonth() + 1, 0);
    date.setUTCDate(Math.min(day, last.getUTCDate()));
  }
  return date;
}

export function nextOccurrence(task: Task, closedAt: Date): Record<string, unknown> | null {
  const repeat = task.repeat;
  if (!repeat) return null;
  const change: Record<string, unknown> = {
    op: 'create', title: task.title, status: 'todo', roles: task.roles, repeat,
    ...(task.template ? { template: task.template, filed: task.filed } : {}),
    ...(task.project ? { project: task.project, section: task.section ?? null } : {}),
    ...(task.counterparty ? { counterparty: task.counterparty } : {}),
    ...(task.note ? { note: task.note } : {}),
    ...(task.muted?.length ? { muted: task.muted } : {}),
  };
  if (task.items.length) change.items_add = task.items.map(({ id, text }) => ({ id, text }));
  if (task.plan) {
    const start = advance(task.plan.start, repeat);
    if (Number.isFinite(+start)) change.plan = { ...task.plan, start: start.toISOString() };
  }
  // Legacy due values were stored as strings without a date format constraint.
  const due = task.due ? advance(task.due, repeat) : null;
  if (due && Number.isFinite(+due)) {
    const iso = due.toISOString();
    change.due = /^\d{4}-\d{2}-\d{2}$/.test(task.due!) ? iso.slice(0, 10) : iso;
  } else if (!change.plan) {
    change.due = advance(closedAt.toISOString(), repeat).toISOString().slice(0, 10);
  }
  return change;
}

const dataOf = (event: JournalEvent) => event.payload.data?.task as Record<string, unknown> | undefined;

export function repeatChange(event: JournalEvent, taskEvents: (id: string) => JournalEvent[]): JournalEvent | null {
  const status = dataOf(event)?.status;
  if (event.kind !== 'task_change' || typeof status !== 'string') return null;
  const id = event.payload.ref!.id;
  const events = taskEvents(id);
  if (events.findLast((item) => dataOf(item)?.status !== undefined)?.id !== event.id) return null;
  const [task] = foldTasks(events);
  const [previous] = foldTasks(events.filter((item) => item.id !== event.id));
  if (!task || previous?.status === task.status) return null;

  const nextId = nameId(`repeat-task|${id}`);
  const nextEvents = taskEvents(nextId);
  const last = nextEvents.at(-1);
  const untouched = nextEvents.every((item, index) => item.author === 'system'
    && (index === 0 ? item.id === nameId(`repeat-create|${id}`) : Object.keys(dataOf(item) ?? {}).length === 2));
  let change: Record<string, unknown> | null = null;
  if (task.status === 'done' && task.repeat) {
    if (!last) change = nextOccurrence(task, new Date(event.ts));
    else if (untouched && dataOf(last)?.status === 'cancelled') change = { op: 'update', status: 'todo' };
  } else if (previous?.status === 'done' && isOpen(task) && last && untouched && dataOf(last)?.status === 'todo') {
    change = { op: 'update', status: 'cancelled' };
  }
  if (!change) return null;
  const ts = new Date(Math.max(Date.parse(event.ts), last ? Date.parse(last.ts) + 1 : 0)).toISOString();
  return {
    id: nameId(last ? `repeat-update|${event.id}` : `repeat-create|${id}`),
    schema_version: 1, source: 'system', author: 'system', ts, kind: 'task_change',
    payload: { ref: { type: 'task', id: nextId }, data: { task: change } },
  };
}
