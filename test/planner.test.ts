import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { plannerDays } from '../web/dayplan.js';

// The right panel — tasks by days (owner, 2026-11-20: a day, 4 days, 7 days to see the load; a calendar later).
const now = new Date(2026, 10, 20, 9, 0); // Fri 20 Nov, local time
const task = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, status: 'todo', filed: false, roles: { responsible: 'me', executors: ['me'] }, ...extra });

test('open tasks of mine land on their day: a planned start with its time, else the due date; the range is the chosen days', () => {
  const tasks = [
    task('today-due', { due: '2026-11-20' }),
    task('today-planned', { plan: { start: new Date(2026, 10, 20, 14, 30).toISOString(), duration_min: 60 } }),
    task('tomorrow', { due: '2026-11-21T10:00' }),
    task('in-five-days', { due: '2026-11-25' }),
    task('done', { due: '2026-11-20', status: 'done' }),
    task('filed', { due: '2026-11-20', filed: true }),
    task('not-mine', { due: '2026-11-20', roles: { responsible: 'tg:7', executors: ['tg:8'] } }),
    task('no-date'),
  ];
  const four = plannerDays(tasks, { now, days: 4 });
  assert.deepEqual(four.days.map((day: any) => day.key), ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23']);
  assert.deepEqual(four.days[0].items.map((item: any) => [item.task.id, item.time]), [['today-due', null], ['today-planned', '14:30']]);
  assert.deepEqual(four.days[1].items.map((item: any) => [item.task.id, item.time]), [['tomorrow', '10:00']]);
  assert.equal(four.days[0].label, 'Сегодня, пт 20 нояб.');
  assert.equal(four.days[1].label, 'Завтра, сб 21 нояб.');
  assert.equal(plannerDays(tasks, { now, days: 7 }).days[5].items[0].task.id, 'in-five-days');
  assert.equal(plannerDays(tasks, { now, days: 1 }).days.length, 1);
});

test('overdue ones come first as their own group; a deferred task waits on its reminder day', () => {
  const result = plannerDays([
    task('late', { due: '2026-11-18' }),
    task('snoozed', { status: 'deferred', remindAt: new Date(2026, 10, 21, 9, 0).toISOString() }),
  ], { now, days: 4 });
  assert.deepEqual(result.overdue.map((item: any) => item.task.id), ['late']);
  assert.deepEqual(result.days[1].items.map((item: any) => [item.task.id, item.time]), [['snoozed', '09:00']]);
});

test('calendar events land on their local days among the tasks: all-day on every day they span, timed by time; overdue holds none', () => {
  const events = [
    { id: 'e1', calendar: 'family@group', title: 'Отпуск', start: '2026-11-21', end: '2026-11-23', allDay: true, link: null },
    { id: 'e2', calendar: 'anna@example.com', title: 'Встреча', start: new Date(2026, 10, 20, 11, 0).toISOString(), end: new Date(2026, 10, 20, 12, 0).toISOString(), allDay: false, link: 'https://g/e2' },
    { id: 'e3', calendar: 'anna@example.com', title: 'Вчера', start: '2026-11-19', end: '2026-11-20', allDay: true, link: null },
  ];
  const result = plannerDays([task('today-planned', { plan: { start: new Date(2026, 10, 20, 14, 30).toISOString(), duration_min: 60 } }), task('early', { plan: { start: new Date(2026, 10, 20, 9, 0).toISOString(), duration_min: 30 } })], { now, days: 4, events });
  assert.deepEqual(result.days[0].items.map((item: any) => [item.task?.id ?? item.event.id, item.time]), [['early', '09:00'], ['e2', '11:00'], ['today-planned', '14:30']]);
  assert.deepEqual(result.days[1].items.map((item: any) => item.event?.id), ['e1']);
  assert.deepEqual(result.days[2].items.map((item: any) => item.event?.id), ['e1'], 'all-day spans to its exclusive end');
  assert.deepEqual(result.days[3].items, []);
  assert.equal(result.overdue.length, 0);
});

test('an unconfirmed task stays out of the day plan', () => {
  const tasks = [task('real', { due: '2026-11-20' }), task('ai', { due: '2026-11-20', unconfirmed: true })];
  assert.deepEqual(plannerDays(tasks, { now, days: 1 }).days[0].items.map((item: any) => item.task.id), ['real']);
});
