// Filters tasks by time or state, responsibility, and location or participant. The left panel's filters
// (docs/plans/2026-11-21-workspace-redesign-design.md): current, active, control, waiting, future, unconfirmed, done,
// cancelled; the older ids stay for saved views. A topic (topickind.js) is in no task view; one the AI offers to make a
// task shows only under «Предложения ИИ» (id `unconfirmed`, kept for saved views).
import { dueState, involvesMe, isOpen } from './taskfold.js';
import { isMineToDo, inWork } from './focus.js';
import { projectScope } from './projects.js';
import { hasOffer, isTopic } from './topickind.js';

export const WHEN = [
  { id: 'current', title: 'Текущие', icon: '⏵' },
  { id: 'waiting', title: 'В ожидании', icon: '⌛' },
  { id: 'future', title: 'Будущие', icon: '⏭' },
  { id: 'unconfirmed', title: 'Предложения ИИ', icon: '?' },
  { id: 'today', title: 'До конца дня', icon: '☀' },
  { id: 'inbox', title: 'Входящие', icon: '📥' },
  { id: 'upcoming', title: 'Предстоящее', icon: '🗓' },
  { id: 'deferred', title: 'Отложено', icon: '⏸' },
  { id: 'all', title: 'Все открытые', icon: '☰' },
  { id: 'done', title: 'Законченные', icon: '✓' },
  { id: 'cancelled', title: 'Отменённые', icon: '✕' },
  { id: 'unreported', title: 'Не учтено', icon: '🧾' },
];
export const WHOSE = [
  { id: 'all', title: 'С моим участием' },
  { id: 'mine', title: 'Делаю я' },
  { id: 'control', title: 'На контроле' },
  { id: 'watch', title: 'Слежу' },
  { id: 'review', title: 'На проверке' },
  { id: 'team', title: 'Команда' },
];
export const DEFAULT_VIEW = { when: 'all', whose: 'mine', where: {} };

// The left panel's filters, in order (docs/plans/2026-11-21-workspace-redesign-design.md).
export const PANEL_FILTERS = [
  { title: 'Текущие', view: { when: 'current', whose: 'all', where: {} } },
  { title: 'Активные', view: { when: 'all', whose: 'mine', where: {} } },
  { title: 'На контроле', view: { when: 'all', whose: 'control', where: {} } },
  { title: 'В ожидании', view: { when: 'waiting', whose: 'all', where: {} } },
  { title: 'Будущие', view: { when: 'future', whose: 'all', where: {} } },
  { title: 'Предложения ИИ', view: { when: 'unconfirmed', whose: 'all', where: {} } },
  { title: 'Законченные', view: { when: 'done', whose: 'all', where: {} } },
  { title: 'Отменённые', view: { when: 'cancelled', whose: 'all', where: {} } },
];

const snoozed = (task, now) => task.status === 'deferred' && Boolean(task.remindAt) && Date.parse(task.remindAt) > now.getTime();

const dayEnd = (now) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();

// `working` — ids of the task in work and the paused ones (focus.js inWork), for «Текущие».
function whenMatch(task, when, now, working) {
  if (when === 'unconfirmed') return hasOffer(task) || (!isTopic(task) && task.status === 'inbox');
  if (isTopic(task)) return false;
  if (when === 'any') return true; // a project's own list: open and closed alike
  if (when === 'done') return task.status === 'done';
  if (when === 'cancelled') return task.status === 'cancelled';
  if (when === 'unreported') return task.status === 'done' && (task.report?.missing?.length ?? 0) > 0; // for the report and the bill
  if (!isOpen(task)) return false;
  switch (when) {
    case 'current': return working.has(task.id);
    case 'waiting': return task.status === 'waiting';
    case 'future': return dueState(task, now) === 'later' || task.status === 'deferred' || (Boolean(task.plan?.start) && Date.parse(task.plan.start) >= dayEnd(now));
    case 'today': return !snoozed(task, now) && (['overdue', 'today'].includes(dueState(task, now)) || Boolean(task.next) || task.status === 'deferred');
    case 'inbox': return task.status === 'inbox';
    case 'upcoming': return dueState(task, now) === 'later';
    case 'deferred': return task.status === 'deferred';
    default: return true; // all
  }
}

function whoseMatch(task, whose) {
  const delegated = task.roles?.controller === 'me' && (task.roles.executors?.length ?? 0) > 0 && !task.roles.executors.includes('me');
  switch (whose) {
    case 'mine': return isMineToDo(task);
    case 'control': return delegated && task.status !== 'waiting';
    case 'watch': return task.status === 'waiting' || (delegated && task.status !== 'review');
    case 'review': return task.status === 'review' && task.roles?.controller === 'me';
    case 'team': return !involvesMe(task);
    default: return involvesMe(task);
  }
}

function whereMatch(task, where, { projects = [], people = [] }) {
  if (where.project && !projectScope(projects, where.project).has(task.project)) return false;
  if (where.counterparty && task.counterparty !== where.counterparty) return false;
  if (where.person) {
    const points = new Set(people.find((person) => person.id === where.person)?.points ?? []);
    if (!Object.values(task.roles ?? {}).flat().some((party) => points.has(party))) return false;
  }
  return true;
}

// The tasks of a view (filed ones never).
export function applyView(tasks, view, ctx = {}) {
  const now = ctx.now ?? new Date();
  const where = view.where ?? {};
  const focus = view.when === 'current' ? inWork(tasks) : null;
  const working = new Set(focus ? [focus.current, ...focus.paused].filter(Boolean).map((task) => task.id) : []);
  const shown = tasks.filter((task) => !task.filed && whenMatch(task, view.when, now, working) && whoseMatch(task, view.whose) && whereMatch(task, where, ctx));
  if (view.when === 'upcoming') return shown.sort((a, b) => String(a.due).localeCompare(String(b.due)));
  if (view.when === 'done' || view.when === 'cancelled') return shown.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return shown;
}

// How many tasks each option of an axis would show, the other axes kept: Map(option id → count).
export function countsFor(tasks, view, axis, ctx = {}) {
  const options = axis === 'when' ? WHEN : WHOSE;
  return new Map(options.map((option) => [option.id, applyView(tasks, { ...view, [axis]: option.id }, ctx).length]));
}

export const isDefaultView = (view) => view.when === DEFAULT_VIEW.when && view.whose === DEFAULT_VIEW.whose && !Object.values(view.where ?? {}).some(Boolean);

// The view in words: «Все открытые · Слежу · ▸ Проект · ◆ Контрагент · Человек».
export function viewTitle(view, { projects = [], counterparties = [], people = [] } = {}) {
  const where = view.where ?? {};
  const panel = !Object.values(where).some(Boolean) && PANEL_FILTERS.find((item) => item.view.when === view.when && item.view.whose === view.whose);
  if (panel) return panel.title;
  return [
    WHEN.find((item) => item.id === view.when)?.title,
    view.whose !== 'all' ? WHOSE.find((item) => item.id === view.whose)?.title : '',
    where.project ? `▸ ${projects.find((item) => item.id === where.project)?.title ?? 'проект'}` : '',
    where.counterparty ? `◆ ${counterparties.find((item) => item.id === where.counterparty)?.title ?? 'контрагент'}` : '',
    where.person ? people.find((item) => item.id === where.person)?.name ?? 'человек' : '',
  ].filter(Boolean).join(' · ');
}

const DAY = 86_400_000;
const dayStart = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

// A list by dates: Просрочено · Сегодня · Завтра · На этой неделе · Позже · Без срока (empty groups left out).
export function dueGroups(tasks, now = new Date()) {
  const groups = [['overdue', 'Просрочено'], ['today', 'Сегодня'], ['tomorrow', 'Завтра'], ['week', 'На этой неделе'], ['later', 'Позже'], ['none', 'Без срока']]
    .map(([id, title]) => ({ id, title, tasks: [] }));
  const byId = new Map(groups.map((group) => [group.id, group]));
  const sunday = dayStart(now) + ((7 - now.getDay()) % 7) * DAY;
  for (const task of tasks) {
    const state = dueState(task, now);
    if (state !== 'later') { byId.get(state).tasks.push(task); continue; }
    const day = dayStart(new Date(`${String(task.due).slice(0, 10)}T00:00:00`));
    byId.get(day - dayStart(now) === DAY ? 'tomorrow' : day <= sunday ? 'week' : 'later').tasks.push(task);
  }
  for (const group of groups) group.tasks.sort((a, b) => String(a.due ?? '').localeCompare(String(b.due ?? '')));
  return groups.filter((group) => group.tasks.length);
}
