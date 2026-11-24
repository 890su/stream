// The right panel — tasks by days (owner, 2026-11-20; design 2026-11-20 stage 4, a list before a calendar): a day,
// 4 days or 7 days, to see the load at any moment. My open tasks land on the day of their planned start (with its
// time), else their due date, a deferred one on its reminder; overdue ones first. plannerDays is pure (tested in
// node); dayPlan builds the panel's content.
import { isOpen, involvesMe } from './taskfold.js';

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const weekday = new Intl.DateTimeFormat('ru', { weekday: 'short' });
const dayMonth = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' });
export const RANGES = [1, 4, 7];

// When a task is planned: { key (local day), time ('HH:MM' or null) }, or null without a date.
export function whenOf(task) {
  const at = task.status === 'deferred' && task.remindAt ? task.remindAt : task.plan?.start ?? task.due ?? null;
  if (!at) return null;
  const text = String(at);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return { key: text, time: null };
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return { key: dayKey(date), time: `${pad(date.getHours())}:${pad(date.getMinutes())}` };
}

const labelOf = (date, offset) => {
  const name = `${weekday.format(date)} ${dayMonth.format(date)}`;
  return offset === 0 ? `Сегодня, ${name}` : offset === 1 ? `Завтра, ${name}` : name;
};

// The local days an event covers in the shown ones: all-day — from its start to the day before its (exclusive) end;
// timed — the day it starts. With its time ('HH:MM' or null).
function eventDays(event) {
  if (!event.allDay) { const start = new Date(event.start); return { keys: [dayKey(start)], time: `${pad(start.getHours())}:${pad(start.getMinutes())}` }; }
  const keys = [];
  for (let date = new Date(`${event.start}T12:00:00`); dayKey(date) < event.end && keys.length < 60; date.setDate(date.getDate() + 1)) keys.push(dayKey(date));
  return { keys, time: null };
}

// { overdue: [{ task, time, key }], days: [{ key, label, items: [{ task, time } | { event, time }] }] } for `days`
// days from today; `events` — Google Calendar events (/api/calendar), shown among the tasks, never overdue.
export function plannerDays(tasks, { now = new Date(), days = 4, events = [] } = {}) {
  const today = dayKey(now);
  const list = [];
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    list.push({ key: dayKey(date), label: labelOf(date, offset), items: [] });
  }
  const byKey = new Map(list.map((day) => [day.key, day]));
  const overdue = [];
  for (const task of tasks) {
    if (!isOpen(task) || task.filed || task.unconfirmed || !involvesMe(task)) continue; // unconfirmed: the AI's, not yet mine
    const when = whenOf(task);
    if (!when) continue;
    if (when.key < today) overdue.push({ task, time: when.time, key: when.key });
    else byKey.get(when.key)?.items.push({ task, time: when.time });
  }
  for (const event of events) {
    const { keys, time } = eventDays(event);
    for (const key of keys) byKey.get(key)?.items.push({ event, time });
  }
  for (const day of list) day.items.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
  overdue.sort((a, b) => a.key.localeCompare(b.key));
  return { overdue, days: list };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const RANGE_KEY = 'stream.planRange';
export const readRange = () => { try { const value = Number(localStorage.getItem(RANGE_KEY)); return RANGES.includes(value) ? value : 4; } catch { return 4; } };
const writeRange = (value) => { try { localStorage.setItem(RANGE_KEY, String(value)); } catch { /* storage may be blocked */ } };

// The panel: «День · 4 дня · 7 дней», then the days with their tasks and calendar events (grey; a tap opens the event in
// Google); a tap on a task opens it. ctx: { tasks, events, calendars (id -> title), now, onOpenTask(id), redraw() }.
export function dayPlan({ tasks, events = [], calendars = new Map(), now = new Date(), onOpenTask, redraw }) {
  const box = element('div', 'day-plan');
  const range = readRange();
  const tabs = element('div', 'chips day-plan-range');
  for (const value of RANGES) {
    const chip = element('button', `chip ${value === range ? 'on' : 'suggest'}`, value === 1 ? 'День' : `${value} ${value === 4 ? 'дня' : 'дней'}`);
    chip.type = 'button';
    chip.setAttribute('aria-pressed', String(value === range));
    chip.onclick = () => { writeRange(value); redraw(); };
    tabs.append(chip);
  }
  box.append(tabs);
  const { overdue, days } = plannerDays(tasks, { now, days: range, events });
  const eventRow = ({ event, time }) => {
    const node = element(event.link ? 'a' : 'div', 'task-row day-plan-row day-plan-event');
    if (event.link) Object.assign(node, { href: event.link, target: '_blank', rel: 'noopener' });
    node.append(element('span', 'day-plan-time', time ?? 'весь день'), element('span', 'task-title', event.title),
      element('span', 'task-meta', calendars.get(event.calendar) ?? ''));
    return node;
  };
  const row = (item) => {
    if (item.event) return eventRow(item);
    const { task, time, key } = item;
    const node = element('button', `task-row day-plan-row ${task.status}`);
    node.type = 'button';
    // An overdue one shows its date (with the time under it when there is one); a day's row its time.
    const date = key ? dayMonth.format(new Date(`${key}T12:00`)) : null;
    node.append(element('span', 'day-plan-time', date ? [date, time].filter(Boolean).join(' ') : time ?? '—'),
      element('span', 'task-title', task.title), element('span', 'task-meta', task.counterpartyTitle ?? ''));
    node.onclick = () => onOpenTask(task.id);
    return node;
  };
  const group = (title, items, className = '') => {
    const head = element('div', `day-plan-day${className}`);
    head.append(element('span', 'day-plan-label', title), element('span', 'day-plan-count', items.length ? String(items.length) : 'свободно'));
    box.append(head, ...items.map(row));
  };
  if (overdue.length) group('Просрочено', overdue, ' late');
  for (const day of days) group(day.label, day.items);
  box.append(element('p', 'details-meta day-plan-note', 'Мои открытые задачи по сроку или плану и события Google Календаря (серые); задачи без даты здесь нет.'));
  return box;
}
