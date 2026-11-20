// Checks how the task dashboard groups and counts work.
import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { foldTasks } from '../web/taskfold.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { foldProjects, markNext } from '../web/projects.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { importance, pulseBlocks, pulseCount, projectHealth } from '../web/pulse.js';
import { pulseConfig } from '../src/config.ts';

// The pulse — the default of «Задачи» (task manager spec §5). Names, chats and projects are made up.
const now = new Date('2026-11-19T12:00:00');
const config = pulseConfig;
let n = 0;
const at = (iso: string) => new Date(iso).toISOString();
const taskEvent = (id: string, ts: string, data: Record<string, unknown>) => ({
  id: `e${++n}`, schema_version: 1, source: 'system', author: 'system', ts: at(ts), kind: 'task_change',
  payload: { ref: { type: 'task', id }, data: { task: data } },
});
const create = (id: string, data: Record<string, unknown>, ts = '2026-11-19T09:00:00') => taskEvent(id, ts, { op: 'create', title: id, status: 'todo', ...data });
const mine = { responsible: 'me', executors: ['me'] };
const delegated = { responsible: 'me', executors: ['tg:1'], controller: 'me' };
const projectEvent = (id: string, data: Record<string, unknown>) => ({
  id: `e${++n}`, schema_version: 1, source: 'app', author: 'me', ts: at('2026-11-01T09:00:00'), kind: 'project_change',
  payload: { ref: { type: 'project', id }, data: { project: { op: 'create', ...data } } },
});
const blocks = (events: unknown[]) => pulseBlocks({ tasks: foldTasks(events), now, config });
const titles = (list: { title: string }[]) => list.map((item) => item.title);

test('every task lands in exactly one block; team, filed, snoozed and ideas are not on the pulse', () => {
  const b = blocks([
    create('в работе', { status: 'doing', roles: mine }),
    create('на паузе', { roles: mine, resume_note: 'дальше' }),
    create('просрочено', { roles: mine, due: '2026-11-18' }),
    create('завтра', { roles: mine, due: '2026-11-20' }),
    create('разобрать', { status: 'inbox', roles: mine }),
    create('жду адрес', { status: 'waiting', roles: { ...mine, watchers: [] }, waiting_for: { party: 'tg:2', since: at('2026-11-19T08:00:00') } }),
    create('поручено', { roles: delegated }),
    create('потом', { roles: mine }),
    create('команда', { roles: { responsible: 'tg:2', executors: ['tg:3'] } }),
    create('архивное', { roles: mine, filed: true }),
    create('отложено', { status: 'deferred', remind_at: at('2026-11-25T09:00:00'), roles: mine }),
  ]);
  assert.equal(b.work.title, 'в работе');
  assert.deepEqual(titles(b.paused), ['на паузе']);
  assert.deepEqual(titles(b.today), ['просрочено', 'разобрать'], '«До конца дня»: overdue first, tomorrow elsewhere');
  assert.deepEqual(titles(b.watch).sort(), ['жду адрес', 'поручено']);
  assert.deepEqual(titles(b.later), ['завтра', 'потом'], 'tomorrow leads «Дальше»');
  const all = [b.work, ...b.paused, ...b.today, ...b.watch, ...b.later].filter(Boolean).map((task: any) => task.title);
  assert.equal(new Set(all).size, all.length, 'no task twice');
});

test('deadlines keep my tasks in today and tasks I am waiting for in watch', () => {
  const b = blocks([
    create('мой просроченный срок', { roles: mine, due: '2026-11-17' }),
    create('мой срок сегодня', { roles: mine, due: '2026-11-19' }),
    create('жду', { status: 'waiting', roles: mine, due: '2026-11-18' }),
    create('поручено', { roles: delegated, due: '2026-11-18' }),
    create('моя проверка', { status: 'review', roles: delegated }),
  ]);
  assert.deepEqual(titles(b.today), ['мой просроченный срок', 'мой срок сегодня', 'моя проверка']);
  assert.deepEqual(titles(b.watch).sort(), ['жду', 'поручено']);
});

test('a partner\'s doing goes to watch, not to work', () => {
  const b = blocks([create('камеры', { status: 'doing', roles: delegated })]);
  assert.equal(b.work, null);
  assert.deepEqual(titles(b.watch), ['камеры']);
});

test('watch alerts: delegated with no change for a day or more', () => {
  const b = blocks([
    create('молчит', { roles: delegated }, '2026-11-17T09:00:00'),
    create('свежее', { roles: delegated }, '2026-11-19T09:00:00'),
  ]);
  assert.deepEqual(titles(b.watchAlerts), ['молчит']);
});

test('money outranks a plain task with the same due; the order inside a block follows importance', () => {
  const [plain, money] = foldTasks([create('обычное', { roles: mine, due: '2026-11-20' }), create('заявка', { roles: mine, due: '2026-11-20', template: 'lead' })]);
  assert.ok(importance(money, { now, config }) > importance(plain, { now, config }));
  const b = blocks([create('обычное', { roles: mine, due: '2026-11-20' }), create('заявка', { roles: mine, due: '2026-11-20', template: 'lead' })]);
  assert.deepEqual(titles(b.later), ['заявка', 'обычное']);
});

test('project health: overdue red, a goal without a next step yellow, moving green; 7-day counts', () => {
  const projectEvents = [
    projectEvent('pr', { title: 'Поток', kind: 'stream' }),
    projectEvent('pg', { title: 'Сайт', kind: 'goal', sections: [{ id: 'next', title: 'Следующее', role: 'next' }] }),
    projectEvent('pm', { title: 'Переезд', kind: 'goal', sections: [{ id: 'next', title: 'Следующее', role: 'next' }] }),
  ];
  const projects = foldProjects(projectEvents);
  const tasks = markNext(foldTasks([
    create('горит', { roles: mine, project: 'pr', due: '2026-11-18' }),
    create('сделано', { roles: mine, project: 'pr', status: 'done' }, '2026-11-18T10:00:00'),
    create('старое', { roles: mine, project: 'pr', status: 'done' }, '2026-11-01T10:00:00'),
    create('идея', { roles: mine, project: 'pg' }),
    create('шаг', { roles: mine, project: 'pm', section: 'next' }),
  ]), projects);
  const health = (id: string) => projectHealth(projects.find((p: any) => p.id === id), tasks, { now, config });
  assert.deepEqual(
    (({ done7, new7, open, overdue, health: h }) => ({ done7, new7, open, overdue, h }))(health('pr')),
    { done7: 1, new7: 2, open: 1, overdue: 1, h: 'red' },
  );
  assert.equal(health('pg').health, 'yellow');
  assert.equal(health('pm').health, 'green');
  assert.equal(health('pm').next.title, 'шаг');
  const b = pulseBlocks({ tasks, projects, now, config });
  assert.deepEqual(b.projects.map((item: any) => item.project.title), ['Поток', 'Сайт', 'Переезд']);
});

test('the task counter counts due and new work for today without counting conversations', () => {
  const tasks = foldTasks([create('просрочено', { roles: mine, due: '2026-11-18' }),
    create('разобрать', { roles: mine, status: 'inbox' }), create('потом', { roles: mine })]);
  const legacyInput = { tasks, now, config, conversations: [{ key: 'tg:5', queue: { waiting: true, moment: at('2026-11-19T08:00:00') } }] };
  const b = pulseBlocks(legacyInput);
  assert.equal(pulseCount(b), 2);
  assert.equal(Object.hasOwn(b, 'hot'), false);
});

test('paused tasks with due dates and active reminders come back to today', () => {
  const b = blocks([
    create('в работе', { status: 'doing', roles: mine }),
    create('пауза', { roles: mine, resume_note: 'дальше' }),
    create('пауза и отложено', { status: 'deferred', remind_at: at('2026-11-25T09:00:00'), roles: mine, resume_note: 'дальше' }),
    create('пауза и жду', { status: 'waiting', roles: mine, resume_note: 'дальше' }),
    create('пауза и срок сегодня', { roles: mine, resume_note: 'дальше', due: '2026-11-19' }),
    create('напоминание пришло', { status: 'deferred', remind_at: at('2026-11-19T08:00:00'), roles: mine }),
  ]);
  assert.deepEqual(titles(b.paused), ['пауза']);
  assert.deepEqual(titles(b.watch), ['пауза и жду']);
  assert.deepEqual(titles(b.today), ['пауза и срок сегодня', 'напоминание пришло']);
});
