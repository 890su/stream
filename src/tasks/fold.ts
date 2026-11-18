import type { JournalEvent } from '../contracts/validate.ts';
import { partyOf, ROLE_KEYS } from './parties.ts';

// Tasks as the fold of `task_change` events (CONCEPT.md §2.8, P14 roles). The client folds the same way (web/taskfold.js).

export interface Roles {
  author: string | null; responsible: string | null; executors: string[]; controller: string | null; watchers: string[]; counterparty: string | null;
}

export interface Task {
  id: string; title: string; status: string; assignee: string; person?: string; template?: string; due?: string | null;
  roles: Roles; waiting_for?: unknown; plan?: unknown; remind_at?: string | null; promise?: unknown; filed: boolean;
  messages: string[]; confidence?: number; processor?: string; proposed?: string | null; created_by: string; created_at: string; updated_at: string;
}

const OPEN = new Set(['inbox', 'todo', 'doing', 'waiting', 'review', 'deferred']);
export const isOpen = (task: Task) => OPEN.has(task.status);

const emptyRoles = (): Roles => ({ author: null, responsible: null, executors: [], controller: null, watchers: [], counterparty: null });

// A task whose changes never carried roles: who does it comes from the old `assignee` / `person` fields.
function legacyRoles(task: Task): Roles {
  const executors = task.assignee === 'person' ? (task.person ? [`name:${task.person}`] : []) : [task.assignee];
  return { ...emptyRoles(), author: partyOf(task.created_by), responsible: 'me', executors };
}

// The old display field, derived: the kind of the first executor.
const kindOf = (party: string) => (party === 'me' || party === 'ai' || party === 'system' ? party : 'person');

// `filedTemplates` — names of templates marked `filed` in the config: such tasks are filed away, not worked on.
export function foldTasks(events: JournalEvent[], { filedTemplates = [] as string[] } = {}): Task[] {
  const tasks = new Map<string, Task>();
  const hasRoles = new Set<string>();
  const filedGiven = new Set<string>();
  const ordered = events.filter((event) => event.kind === 'task_change')
    .sort((a, b) => a.ts.localeCompare(b.ts) || (a.received_at ?? '').localeCompare(b.received_at ?? ''));
  for (const event of ordered) {
    const id = event.payload.ref!.id;
    const change = event.payload.data!.task as Record<string, any>;
    let task = tasks.get(id);
    if (!task) {
      if (change.op !== 'create') continue;
      task = { id, title: change.title, status: 'todo', assignee: 'me', roles: emptyRoles(), filed: false, messages: [], created_by: event.author, created_at: event.ts, updated_at: event.ts };
      tasks.set(id, task);
    }
    for (const key of ['title', 'status', 'assignee', 'person', 'template', 'due', 'confidence', 'processor', 'proposed', 'waiting_for', 'plan', 'remind_at', 'promise'] as const) {
      if (change[key] !== undefined) (task as any)[key] = change[key];
    }
    if (change.filed !== undefined) { task.filed = change.filed; filedGiven.add(id); }
    if (change.roles) {
      hasRoles.add(id);
      for (const key of ROLE_KEYS) {
        if (change.roles[key] !== undefined) (task.roles as any)[key] = change.roles[key] ?? (key === 'executors' || key === 'watchers' ? [] : null);
      }
    }
    for (const message of change.add ?? []) if (!task.messages.includes(message)) task.messages.push(message);
    if (change.remove) task.messages = task.messages.filter((message) => !change.remove.includes(message));
    task.updated_at = event.ts;
  }
  for (const task of tasks.values()) {
    if (!hasRoles.has(task.id)) task.roles = legacyRoles(task);
    else if (!task.roles.author) task.roles.author = partyOf(task.created_by);
    if (task.roles.executors.length) task.assignee = kindOf(task.roles.executors[0]!);
    if (!filedGiven.has(task.id)) task.filed = !!task.template && filedTemplates.includes(task.template);
  }
  return [...tasks.values()];
}
