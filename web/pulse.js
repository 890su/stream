// Groups tasks for the «Задачи» dashboard and scores their importance.
// Blocks: in work and paused (focus.js), «До конца дня», «Слежу», «Проекты», «Дальше». Every task is in one block,
// checked top-down; order inside a block is a computed importance (spec §4.5), weights in registry/pulse.json.
// Pure: no DOM — tested in node; pulseview.js draws it.
import { dueState, involvesMe, isOpen } from './taskfold.js';
import { inWork, isMineToDo } from './focus.js';

// Used when the capture config has no `pulse` (an old cached config): the values of registry/pulse.json v1.
export const PULSE_DEFAULTS = { rows: 4, hot_wait_hours: 2, watch_alert_days: 1, stale_days: 7, paused_remind_hours: 2, money_templates: ['lead', 'money'],
  weights: { hot: 1000, money: 300, blocks: 200, due_soon: 100, stale_per_day: 5 } };

const DAY = 86_400_000;
const daysSince = (iso, now) => Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / DAY));
const dayOf = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const isTomorrow = (task, now) => Boolean(task.due) && String(task.due).slice(0, 10) === dayOf(new Date(now.getTime() + DAY));
const dueNow = (task, now) => ['overdue', 'today'].includes(dueState(task, now));
const snoozed = (task, now) => task.status === 'deferred' && Boolean(task.remindAt) && Date.parse(task.remindAt) > now.getTime();
const checksMine = (task) => task.status === 'review' && task.roles?.controller === 'me';
// Someone else does it and I control it, or I wait for someone.
const watched = (task) => task.status === 'waiting'
  || (task.roles?.controller === 'me' && task.roles.executors?.length > 0 && !task.roles.executors.includes('me'));

// How much a task matters now: the sum of the weights that apply.
export function importance(task, { now = new Date(), config }) {
  const w = config.weights;
  let score = 0;
  if (dueNow(task, now)) score += w.hot;
  if (task.template && config.money_templates.includes(task.template)) score += w.money;
  if (checksMine(task)) score += w.blocks;
  if (isTomorrow(task, now)) score += w.due_soon;
  score += w.stale_per_day * Math.min(30, daysSince(task.updatedAt, now));
  return score;
}

const byImportance = (now, config) => (a, b) => importance(b, { now, config }) - importance(a, { now, config })
  || (a.due ? String(a.due) : '￿').localeCompare(b.due ? String(b.due) : '￿');

// A project's movement over 7 days and its health (spec §7).
export function projectHealth(project, tasks, { now = new Date(), config }) {
  const own = tasks.filter((task) => task.project === project.id && !task.filed);
  const recent = (iso) => Boolean(iso) && now.getTime() - Date.parse(iso) <= 7 * DAY;
  const open = own.filter(isOpen);
  const overdue = open.filter((task) => dueState(task, now) === 'overdue').length;
  const last = [project.updatedAt, ...own.map((task) => task.updatedAt)].sort().at(-1);
  const staleDays = daysSince(last, now);
  const next = open.find((task) => task.next) ?? null;
  const health = overdue > 0 ? 'red'
    : (project.kind === 'goal' && !next) || staleDays >= config.stale_days ? 'yellow' : 'green';
  return {
    project, done7: own.filter((task) => task.status === 'done' && recent(task.doneAt)).length,
    new7: own.filter((task) => recent(task.createdAt)).length, open: open.length, overdue, staleDays, next, health,
  };
}

const HEALTH_ORDER = { red: 0, yellow: 1, green: 2 };

export function pulseBlocks({ tasks, projects = [], now = new Date(), config }) {
  const order = byImportance(now, config);
  const focus = inWork(tasks);
  const current = focus.current;
  const paused = focus.paused.filter((task) => !dueNow(task, now)); // a paused task with a deadline today goes to «До конца дня»
  const taken = new Set([current, ...paused].filter(Boolean).map((task) => task.id));
  const eligible = tasks.filter((task) => !taken.has(task.id) && isOpen(task) && !task.filed && !task.idea
    && !snoozed(task, now) && involvesMe(task));
  const today = [];
  const watch = [];
  const later = [];
  for (const task of eligible) {
    const mineOrNew = isMineToDo(task) || task.status === 'inbox';
    const forToday = mineOrNew && task.status !== 'waiting'
      && (dueNow(task, now) || task.next || task.status === 'inbox' || task.status === 'deferred');
    if (forToday || checksMine(task)) today.push(task);
    else if (watched(task)) watch.push(task);
    else if (isMineToDo(task)) later.push(task);
  }
  watch.sort(order);
  return {
    work: current, paused,
    today: today.sort(order), watch,
    watchAlerts: watch.filter((task) => daysSince(task.updatedAt, now) >= config.watch_alert_days),
    projects: projects.filter((project) => project.status === 'active')
      .map((project) => projectHealth(project, tasks, { now, config }))
      .sort((a, b) => HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] || a.project.title.localeCompare(b.project.title)),
    later: later.sort(order),
  };
}

// The dashboard counter shows actionable tasks for today.
export const pulseCount = (blocks) => blocks.today.length;
