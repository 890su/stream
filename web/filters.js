// Saved task filters (registry/filters.json, P14): a filter is data — `all` / `any` lists of conditions — and
// `matchesFilter` evaluates it against a folded task. A filter may also carry `pinned` (a chip on top of Задачи),
// `order` and `sections` (each a condition list; tasklist.js). Pure: no DOM, no storage — tested in node.
//
// Condition: { field, op, value? }, or a nested group { all: [...] } / { any: [...] } as an element of a list.
// Fields: status, role.<key> (role.executors / role.watchers are arrays), involves_me, due, filed,
//   report_missing (array of unfilled report fields), updated_days (whole days since the last change),
//   idea (in a project's «ideas» section), next (an open task in the «next» section of an active goal project, CONCEPT.md §2.11),
//   snoozed (deferred and its `remind_at` still ahead — hidden until then, back by itself after).
//   `due` values: today, overdue, none, later, and `week` — due today or within the next 7 days
//   (today .. today + 7, inclusive; overdue and later dates are not «week»).
// Ops: eq, ne, in, not_in, includes, excludes, empty, not_empty, lte, gte. The owner is the party `me`.
// An unknown field or op makes the condition (and so a filter relying on it) match nothing; it never throws.
import { ROLE_KEYS } from './parties.js';
import { dueState, involvesMe } from './taskfold.js';

const DAY = 86_400_000;
const dayStart = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

// Whether the task's due date falls into one named bucket.
function dueIs(task, bucket, now) {
  if (bucket === 'week') {
    if (!task.due) return false;
    const days = Math.round((dayStart(new Date(`${String(task.due).slice(0, 10)}T00:00:00`)) - dayStart(now)) / DAY);
    return days >= 0 && days <= 7;
  }
  return dueState(task, now) === bucket;
}

// { known, value } for a field name.
function read(task, field, now) {
  if (field.startsWith('role.')) {
    const key = field.slice(5);
    return ROLE_KEYS.includes(key) ? { known: true, value: task.roles?.[key] ?? null } : { known: false };
  }
  switch (field) {
    case 'status': return { known: true, value: task.status };
    case 'involves_me': return { known: true, value: involvesMe(task) };
    case 'filed': return { known: true, value: !!task.filed };
    case 'due': return { known: true, due: true, value: dueState(task, now) };
    case 'report_missing': return { known: true, value: task.report?.missing ?? [] };
    case 'next': return { known: true, value: Boolean(task.next) }; // a next action of a project (projects.js)
    case 'idea': return { known: true, value: Boolean(task.idea) }; // in a project's «ideas» section
    case 'snoozed': return { known: true, value: task.status === 'deferred' && Boolean(task.remindAt) && Date.parse(task.remindAt) > now.getTime() };
    case 'updated_days': return { known: true, value: Math.floor((now.getTime() - Date.parse(task.updatedAt)) / DAY) };
    default: return { known: false };
  }
}

const isEmpty = (value) => value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length);
const list = (value) => (Array.isArray(value) ? value : [value]);

function evaluate(task, condition, now) {
  if (condition.all) return condition.all.every((item) => evaluate(task, item, now));
  if (condition.any) return condition.any.some((item) => evaluate(task, item, now));
  const field = read(task, String(condition.field), now);
  if (!field.known) return false;
  const { value } = field;
  const wanted = condition.value;
  const same = (item) => (field.due ? dueIs(task, item, now) : item === value);
  switch (condition.op) {
    case 'eq': return same(wanted);
    case 'ne': return !same(wanted);
    case 'in': return list(wanted).some(same);
    case 'not_in': return !list(wanted).some(same);
    case 'includes': return Array.isArray(value) ? value.includes(wanted) : false;
    case 'excludes': return Array.isArray(value) ? !value.includes(wanted) : false;
    case 'empty': return isEmpty(value);
    case 'not_empty': return !isEmpty(value);
    case 'lte': return typeof value === 'number' && value <= wanted;
    case 'gte': return typeof value === 'number' && value >= wanted;
    default: return false;
  }
}

// Does the task satisfy every `all` condition and, when `any` is present, at least one `any` condition.
export function matchesFilter(task, filter, { now = new Date() } = {}) {
  try {
    if (!filter) return false;
    const all = filter.all ?? [];
    const any = filter.any ?? [];
    return all.every((item) => evaluate(task, item, now)) && (!any.length || any.some((item) => evaluate(task, item, now)));
  } catch {
    return false;
  }
}

// The «Задачи» list: tasks matching `filter` and the shared `matches(task)` (contact, tags). Order: `due` — by due
// date, undated last; default — «разобрать» last, then newest change first.
export function visibleTasks(tasks, { filter = { all: [] }, matches = () => true, now = new Date() } = {}) {
  const shown = tasks.filter((task) => matchesFilter(task, filter, { now }) && matches(task));
  if (filter.order === 'due') return shown.sort((a, b) => (a.due ? String(a.due) : '￿').localeCompare(b.due ? String(b.due) : '￿') || b.updatedAt.localeCompare(a.updatedAt));
  return shown.sort((a, b) => (a.status === 'inbox') - (b.status === 'inbox') || b.updatedAt.localeCompare(a.updatedAt));
}
