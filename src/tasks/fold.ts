// Projects tasks from append-only task changes for the server.
import type { JournalEvent } from '../contracts/validate.ts';
import { defaultController, partyOf, ROLE_KEYS, LIST_ROLES } from './parties.ts';

// Tasks as the fold of `task_change` events (CONCEPT.md §2.8, P14 roles). The client folds the same way (web/taskfold.js).

export interface Roles {
  author: string | null; responsible: string | null; executors: string[]; controller: string | null; watchers: string[]; counterparty: string | null;
  members: string[]; // plain participants, without a role (2026-11-19)
}

export type Repeat = { every: 'day' | 'week' | 'month' | 'year'; n: number };

export interface Task {
  id: string; title: string; status: string; assignee: string; person?: string; template?: string; due?: string | null;
  roles: Roles; waiting_for?: unknown; plan?: { start: string; duration_min: number } | null; remind_at?: string | null; promise?: unknown; filed: boolean;
  messages: string[]; confidence?: number; processor?: string; proposed?: string | null; created_by: string; created_at: string; updated_at: string;
  project?: string | null; section?: string | null; project_options?: string[]; // CONCEPT.md §2.11
  resume_note?: string; // where the owner stopped (task manager spec 5.4)
  report?: Record<string, unknown>; // the closing report or its draft from the conversation
  counterparty?: string | null; counterparty_options?: string[]; counterparty_hint?: string | null; // contacts design §6
  muted?: string[]; // participants switched off: answers from the task do not go to them (2026-11-19)
  kind: 'topic' | 'task'; offer: boolean; // topics design 2026-11-23: a topic is out of task views; offer — the AI offers a task
  legacy?: boolean; // the record was made unconfirmed by the AI before topics (design 2026-11-21)
  repeat?: Repeat | null;
  note?: string;
  items: ChecklistItem[]; owner_titled: boolean; // the checklist (CONCEPT.md §2.8); the owner gave the title
}

export interface ChecklistItem { id: string; text: string; done: boolean }

const OPEN = new Set(['inbox', 'todo', 'doing', 'waiting', 'review', 'deferred']);
export const isOpen = (task: Task) => OPEN.has(task.status);
export const isTopic = (task: Pick<Task, 'kind'>) => task.kind === 'topic';

// Topic or task — as web/taskfold.js foldKind: `kind` sets it; the legacy `unconfirmed` reads as a topic with an offer
// (true) or a task (false); an owner change confirms a legacy unconfirmed record unless its kind was given.
function foldKind(task: Task, change: Record<string, any>, author: string, kindGiven: Set<string>): void {
  if (change.kind !== undefined) { task.kind = change.kind; kindGiven.add(task.id); }
  if (change.offer !== undefined) task.offer = change.offer;
  if (change.unconfirmed !== undefined) {
    task.legacy = change.unconfirmed;
    if (change.kind === undefined) { task.kind = change.unconfirmed ? 'topic' : 'task'; task.offer = change.unconfirmed; }
  } else if (author === 'me' && task.legacy && !kindGiven.has(task.id)) {
    task.legacy = false; task.kind = 'task'; task.offer = false;
  }
}

const emptyRoles = (): Roles => ({ author: null, responsible: null, executors: [], controller: null, watchers: [], counterparty: null, members: [] });

// A task whose changes never carried roles: who does it comes from the old `assignee` / `person` fields. I am
// responsible; work handed to someone else (a person, AI, the system) is under my control («На контроле»).
function legacyRoles(task: Task): Roles {
  const executors = task.assignee === 'person' ? (task.person ? [`name:${task.person}`] : []) : [task.assignee];
  const roles = { ...emptyRoles(), author: partyOf(task.created_by), responsible: 'me', executors };
  return { ...roles, members: [], controller: defaultController(roles) };
}

// The old display field, derived: the kind of the first executor.
const kindOf = (party: string) => (party === 'me' || party === 'ai' || party === 'system' ? party : 'person');

// Checklist changes, in place: add (once per id), set (done, text), remove.
export function foldItems(items: ChecklistItem[], change: Record<string, any>): void {
  for (const item of change.items_add ?? []) if (!items.some((known) => known.id === item.id)) items.push({ id: item.id, text: item.text, done: false });
  for (const update of change.items_set ?? []) {
    const item = items.find((known) => known.id === update.id);
    if (item && update.done !== undefined) item.done = update.done;
    if (item && update.text !== undefined) item.text = update.text;
  }
  if (change.items_remove) items.splice(0, items.length, ...items.filter((item) => !change.items_remove.includes(item.id)));
}

// `filedTemplates` — names of templates marked `filed` in the config: such tasks are filed away, not worked on.
export function foldTasks(events: JournalEvent[], { filedTemplates = [] as string[] } = {}): Task[] {
  const tasks = new Map<string, Task>();
  const hasRoles = new Set<string>();
  const filedGiven = new Set<string>();
  const kindGiven = new Set<string>();
  const ordered = events.filter((event) => event.kind === 'task_change')
    .sort((a, b) => a.ts.localeCompare(b.ts) || (a.received_at ?? '').localeCompare(b.received_at ?? ''));
  for (const event of ordered) {
    const id = event.payload.ref!.id;
    const change = event.payload.data!.task as Record<string, any>;
    let task = tasks.get(id);
    if (!task) {
      if (change.op !== 'create') continue;
      task = { id, title: change.title, status: 'todo', assignee: 'me', roles: emptyRoles(), filed: false, messages: [], items: [], owner_titled: false, kind: 'task', offer: false, created_by: event.author, created_at: event.ts, updated_at: event.ts };
      tasks.set(id, task);
    }
    for (const key of ['title', 'status', 'assignee', 'person', 'template', 'due', 'confidence', 'processor', 'proposed', 'waiting_for', 'plan', 'remind_at', 'promise', 'project', 'section', 'project_options', 'resume_note', 'report', 'counterparty', 'counterparty_options', 'counterparty_hint', 'muted', 'repeat', 'note'] as const) {
      if (change[key] !== undefined) (task as any)[key] = change[key];
    }
    if (change.filed !== undefined) { task.filed = change.filed; filedGiven.add(id); }
    if (change.roles) {
      // The first roles change of an old task merges into its old roles, not into empty ones.
      if (!hasRoles.has(id) && change.op !== 'create') task.roles = legacyRoles(task);
      hasRoles.add(id);
      for (const key of ROLE_KEYS) {
        if (change.roles[key] !== undefined) (task.roles as any)[key] = change.roles[key] ?? (LIST_ROLES.has(key) ? [] : null);
      }
    }
    for (const message of change.add ?? []) if (!task.messages.includes(message)) task.messages.push(message);
    if (change.remove) task.messages = task.messages.filter((message) => !change.remove.includes(message));
    foldItems(task.items, change);
    if (change.op === 'update' && change.title !== undefined && event.author === 'me' && !change.proposal) task.owner_titled = true; // an accepted AI rename stays the AI's
    foldKind(task, change, event.author, kindGiven);
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
