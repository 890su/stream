// Tasks as the fold of task_change events (CONCEPT.md §2.8); the server folds the same way (src/tasks/fold.ts).
// Pure: no DOM, no storage — tested in node.
import { partyOf, ROLE_KEYS } from './parties.js';

const OPEN = new Set(['inbox', 'todo', 'doing', 'waiting', 'review', 'deferred']);
export const isOpen = (task) => OPEN.has(task.status);

export const ASSIGNEES = { me: 'Я', ai: 'ИИ', system: 'Система', person: 'Человек' };
export const STATUSES = { inbox: 'разобрать', todo: 'сделать', doing: 'в работе', waiting: 'ждёт', review: 'на проверке', deferred: 'отложено', done: 'готово', cancelled: 'отменено' };

const order = (a, b) => a.ts.localeCompare(b.ts) || (a.received_at ?? '￿').localeCompare(b.received_at ?? '￿');

const emptyRoles = () => ({ author: null, responsible: null, executors: [], controller: null, watchers: [], counterparty: null });

// A task whose changes never carried roles: who does it comes from the old `assignee` / `person` fields.
function legacyRoles(task) {
  const executors = task.assignee === 'person' ? (task.person ? [`name:${task.person}`] : []) : [task.assignee];
  return { ...emptyRoles(), author: partyOf(task.createdBy), responsible: 'me', executors };
}

// The old display field, derived: the kind of the first executor.
const kindOf = (party) => (party === 'me' || party === 'ai' || party === 'system' ? party : 'person');

// I am in any role of the task.
export const involvesMe = (task) => ROLE_KEYS.some((key) => [task.roles[key]].flat().includes('me'));

// `filedTemplates` — names of templates marked `filed` in the config: such tasks are filed away, not worked on.
export function foldTasks(events, { filedTemplates = [] } = {}) {
  const tasks = new Map();
  const hasRoles = new Set();
  const filedGiven = new Set();
  for (const event of events.filter((item) => item.kind === 'task_change').sort(order)) {
    const id = event.payload?.ref?.id;
    const change = event.payload?.data?.task ?? {};
    let task = tasks.get(id);
    if (!task) {
      if (change.op !== 'create') continue;
      task = { id, title: change.title, status: 'todo', assignee: 'me', roles: emptyRoles(), filed: false, messages: [], history: [], createdBy: event.author, createdAt: event.ts, updatedAt: event.ts };
      tasks.set(id, task);
    }
    for (const key of ['title', 'status', 'assignee', 'person', 'template', 'due', 'confidence', 'processor', 'note', 'proposed', 'report', 'plan', 'promise']) {
      if (change[key] !== undefined) task[key] = change[key];
    }
    if (change.waiting_for !== undefined) task.waitingFor = change.waiting_for;
    if (change.remind_at !== undefined) task.remindAt = change.remind_at;
    if (change.filed !== undefined) { task.filed = change.filed; filedGiven.add(id); }
    if (change.roles) {
      hasRoles.add(id);
      for (const key of ROLE_KEYS) {
        if (change.roles[key] !== undefined) task.roles[key] = change.roles[key] ?? (key === 'executors' || key === 'watchers' ? [] : null);
      }
    }
    // When the task was finished: the feed folds its messages away by this age (CONCEPT.md §2.8).
    if (change.status !== undefined) task.doneAt = OPEN.has(change.status) ? undefined : event.ts;
    for (const message of change.add ?? []) if (!task.messages.includes(message)) task.messages.push(message);
    if (change.remove) task.messages = task.messages.filter((message) => !change.remove.includes(message));
    task.history.push({ ts: event.ts, author: event.author, change });
    task.updatedAt = event.ts;
  }
  for (const task of tasks.values()) {
    if (!hasRoles.has(task.id)) task.roles = legacyRoles(task);
    else if (!task.roles.author) task.roles.author = partyOf(task.createdBy);
    if (task.roles.executors.length) task.assignee = kindOf(task.roles.executors[0]);
    if (!filedGiven.has(task.id)) task.filed = !!task.template && filedTemplates.includes(task.template);
  }
  return [...tasks.values()];
}

const dayOf = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// A task's due date against today: 'today' | 'overdue' | 'none' | 'later'.
export function dueState(task, now = new Date()) {
  if (!task.due) return 'none';
  const day = String(task.due).slice(0, 10);
  const today = dayOf(now);
  return day === today ? 'today' : day < today ? 'overdue' : 'later';
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

// One line of a task's history: what this change did, in words.
export function describeChange(change) {
  if (change.op === 'create') return `создана${change.status && change.status !== 'todo' ? ` · ${STATUSES[change.status]}` : ''}`;
  const parts = [];
  if (change.title) parts.push(`название: ${change.title}`);
  if (change.status) parts.push(STATUSES[change.status] ?? change.status);
  if (change.assignee) parts.push(`исполнитель: ${ASSIGNEES[change.assignee] ?? change.assignee}`);
  if (change.due !== undefined) parts.push(change.due ? `срок: ${change.due}` : 'без срока');
  if (change.add?.length) parts.push(`+${change.add.length} сообщ.`);
  if (change.remove?.length) parts.push(`−${change.remove.length} сообщ.`);
  if (change.proposed === 'done') parts.push('похоже, готово');
  if (change.proposed === null) parts.push('вопрос снят');
  if (change.report) parts.push('отчёт');
  return parts.join(' · ') || 'изменена';
}

// Open questions «О каком деле?» (CONCEPT.md §2.8): message id -> { task, alternatives } from the latest handler
// change that added the message with alternatives; gone once the owner adds or removes that message anywhere.
export function questionsByMessage(events) {
  const questions = new Map();
  for (const event of events.filter((item) => item.kind === 'task_change').sort(order)) {
    const change = event.payload?.data?.task ?? {};
    const touched = [...(change.add ?? []), ...(change.remove ?? [])];
    if (event.author === 'me') { for (const id of touched) questions.delete(id); continue; }
    if (change.alternatives?.length) for (const id of change.add ?? []) questions.set(id, { task: event.payload.ref.id, alternatives: change.alternatives });
  }
  return questions;
}

// message id -> ids of the tasks it belongs to (for the mark under a message).
export function tasksByMessage(tasks) {
  const map = new Map();
  for (const task of tasks) for (const message of task.messages) map.set(message, [...(map.get(message) ?? []), task.id]);
  return map;
}
