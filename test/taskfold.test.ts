import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { foldTasks, tasksByMessage, involvesMe, STATUSES } from '../web/taskfold.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { visibleTasks } from '../web/filters.js';
import { filtersConfig } from '../src/config.ts';

const byId = (id: string) => filtersConfig.filters.find((filter) => filter.id === id);
const anyTask = { all: [] };
const openOnly = { all: [{ field: 'status', op: 'in', value: ['inbox', 'todo', 'doing', 'waiting', 'review', 'deferred'] }] };
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { project } from '../web/projection.js';

// The right panel's view of tasks (CONCEPT.md §2.8). Texts are made up.
const change = (task: string, ts: string, data: Record<string, unknown>, author = 'system') => ({
  id: crypto.randomUUID(), schema_version: 1, source: 'system', author, ts, kind: 'task_change', payload: { ref: { type: 'task', id: task }, data: { task: data } },
});

test('tasks fold from their changes; the panel shows mine by default, others by filter', () => {
  const events = [
    change('t1', '2026-11-17T10:00:00Z', { op: 'create', title: 'Настроить роутер', assignee: 'me', status: 'todo', add: ['m1', 'm2'] }),
    change('t2', '2026-11-17T10:00:01Z', { op: 'create', title: 'Учесть расход', assignee: 'ai', status: 'inbox', add: ['m2'], confidence: 0.4 }),
    change('t1', '2026-11-17T11:00:00Z', { op: 'update', remove: ['m2'], add: ['m3'] }, 'me'),
    change('t3', '2026-11-17T09:00:00Z', { op: 'update', title: 'без создания' }),
    { id: 'm1', schema_version: 1, source: 'app', author: 'me', ts: '2026-11-17T09:59:00Z', kind: 'text', payload: { text: 'роутер' } },
  ];
  const tasks = foldTasks(events);
  assert.equal(tasks.length, 2, 'an update without a creation is ignored');
  assert.deepEqual(tasks.find((t: { id: string }) => t.id === 't1').messages, ['m1', 'm3']);
  assert.deepEqual(visibleTasks(tasks, { filter: byId('mine') }).map((t: { id: string }) => t.id), ['t1']);
  assert.deepEqual(visibleTasks(tasks, { filter: anyTask }).map((t: { id: string }) => t.id), ['t1', 't2'], 'inbox goes last');
  assert.deepEqual(visibleTasks(tasks, { filter: byId('done') }), []);
  assert.deepEqual(tasksByMessage(tasks).get('m2'), ['t2']);
  assert.equal(project(events).length, 1, 'task changes are not feed messages');
});

test('messages of finished tasks: collapsed the day they finish, faded two days, then hidden', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { doneStage } = await import('../web/taskfold.js');
  const tasks = foldTasks([
    change('a', '2026-11-18T08:00:00', { op: 'create', title: 'A', status: 'todo', add: ['m1', 'm2'] }),
    change('a', '2026-11-18T09:00:00', { op: 'update', status: 'done' }),
    change('b', '2026-11-18T08:00:00', { op: 'create', title: 'B', status: 'todo', add: ['m2'] }),
  ]);
  const byId = new Map(tasks.map((task: { id: string }) => [task.id, task]));
  const at = (iso: string) => new Date(iso);
  assert.equal(doneStage(['a'], byId, at('2026-11-18T20:00:00')), 'collapsed');
  assert.equal(doneStage(['a'], byId, at('2026-11-20T10:00:00')), 'faded');
  assert.equal(doneStage(['a'], byId, at('2026-11-21T10:00:00')), 'hidden');
  assert.equal(doneStage(['a', 'b'], byId, at('2026-11-25T10:00:00')), null, 'an open task keeps the message');
  assert.equal(doneStage([], byId, at('2026-11-25T10:00:00')), null);
  const reopened = foldTasks([
    change('a', '2026-11-18T08:00:00', { op: 'create', title: 'A', status: 'done', add: ['m1'] }),
    change('a', '2026-11-18T09:00:00', { op: 'update', status: 'todo' }),
  ]);
  assert.equal(reopened[0].doneAt, undefined, 'reopening clears the finish time');
});

test('the «Задачи» view: due dates, shared filters, history in words', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { dueState, describeChange } = await import('../web/taskfold.js');
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { dayLabel } = await import('../web/days.js');
  const now = new Date(2026, 10, 18, 12);
  const task = (id: string, due: string | null, assignee = 'me') => ({ id, title: id, status: 'todo', assignee, messages: [id], due, updatedAt: `2026-11-18T10:0${id.charCodeAt(0) % 10}:00Z` });
  const tasks = [task('a', '2026-11-18'), task('b', '2026-11-10'), task('c', null), task('d', '2026-12-01', 'ai')];
  assert.deepEqual(tasks.map((t) => dueState(t, now)), ['today', 'overdue', 'none', 'later']);
  assert.deepEqual(visibleTasks(tasks, { filter: { all: [{ field: 'due', op: 'eq', value: 'overdue' }] }, now }).map((t: { id: string }) => t.id), ['b']);
  assert.deepEqual(visibleTasks(tasks, { filter: anyTask, matches: (t: { id: string }) => t.id !== 'a', now }).map((t: { id: string }) => t.id), ['c', 'b', 'd'], 'newest change first');
  const events = [
    change('t9', '2026-11-18T10:00:00Z', { op: 'create', title: 'Камеры', assignee: 'me', status: 'todo', add: ['m1'] }),
    change('t9', '2026-11-18T11:00:00Z', { op: 'update', proposed: 'done', add: ['m2'] }),
    change('t9', '2026-11-18T12:00:00Z', { op: 'update', status: 'done', proposed: null, report: { duration_min: 30, missing: [] } }, 'me'),
  ];
  const [folded] = foldTasks(events);
  assert.deepEqual(folded.history.map((item: { change: Record<string, unknown> }) => describeChange(item.change)), ['создана', '+1 сообщ. · похоже, готово', 'готово · вопрос снят · отчёт']);
  assert.equal(dayLabel(now, now), 'Сегодня');
});

test('«О каком деле?»: asked when the handler adds with alternatives, gone once the owner answers', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { questionsByMessage } = await import('../web/taskfold.js');
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { questionOptions } = await import('../web/question.js');
  const events = [
    change('ta', '2026-11-18T10:00:00Z', { op: 'create', title: 'Wi-Fi', add: ['m0'] }),
    change('tb', '2026-11-18T10:01:00Z', { op: 'create', title: 'Камеры', status: 'done', add: ['m9'] }),
    change('ta', '2026-11-18T11:00:00Z', { op: 'update', add: ['m1', 'm2'], alternatives: ['tb'] }),
    change('tb', '2026-11-18T11:05:00Z', { op: 'update', add: ['m2'] }, 'me'),
  ];
  const questions = questionsByMessage(events);
  assert.deepEqual([...questions.keys()], ['m1'], 'm2 is answered by the owner');
  const tasks = foldTasks(events);
  const byId = new Map(tasks.map((task: { id: string }) => [task.id, task]));
  const asked = questionOptions({ id: 'm1', taskIds: ['ta'] }, questions.get('m1'), byId);
  assert.deepEqual(asked.options.map((o: { id: string; current: boolean; open: boolean }) => [o.id, o.current, o.open]), [['ta', true, true], ['tb', false, false]]);
  assert.equal(questionOptions({ id: 'm1', taskIds: ['ta'] }, { task: 'ta', alternatives: ['gone'] }, byId), null, 'nothing to choose between');
});

// Roles (CONCEPT.md, P14). Names are made up.
const create = (data: Record<string, unknown>, id = 't1') => change(id, '2026-11-18T08:00:00Z', { op: 'create', status: 'todo', ...data });

test('old tasks get roles from assignee', () => {
  const [task] = foldTasks([create({ title: 'Отвезти роутер', assignee: 'person', person: 'Марек' })]);
  assert.deepEqual(task.roles.executors, ['name:Марек']);
  assert.equal(task.roles.responsible, 'me');
  assert.equal(task.roles.author, 'system');
  const [ai] = foldTasks([create({ title: 'Записать', assignee: 'ai' })]);
  assert.deepEqual(ai.roles.executors, ['ai']);
  const [nameless] = foldTasks([create({ title: 'X', assignee: 'person' })]);
  assert.deepEqual(nameless.roles.executors, []);
});

test('roles merge by key; null clears; assignee stays derived', () => {
  const [task] = foldTasks([
    create({ title: 'Проверить', roles: { responsible: 'me' } }),
    change('t1', '2026-11-18T09:00:00Z', { op: 'update', roles: { executors: ['tg:4242'], controller: 'me' } }),
    change('t1', '2026-11-18T10:00:00Z', { op: 'update', roles: { controller: null } }),
  ]);
  assert.equal(task.roles.responsible, 'me');
  assert.deepEqual(task.roles.executors, ['tg:4242']);
  assert.equal(task.roles.controller, null);
  assert.equal(task.assignee, 'person');
});

test('a team task without me is not mine; review and deferred are open', () => {
  const tasks = foldTasks([
    create({ title: 'Чужая', status: 'review', roles: { responsible: 'tg:1', executors: ['tg:2'] } }, 'a'),
    create({ title: 'Моя', status: 'deferred', roles: { watchers: ['me'] } }, 'b'),
  ]);
  const [a, b] = tasks;
  assert.equal(involvesMe(a), false);
  assert.equal(involvesMe(b), true);
  assert.equal(visibleTasks(tasks, { filter: openOnly }).length, 2);
  assert.equal(STATUSES.review, 'на проверке');
  assert.equal(STATUSES.deferred, 'отложено');
});

test('extra fields fold; filed comes from the change or the template', () => {
  const [task, other] = foldTasks([
    create({ title: 'Дневник', template: 'diary', waiting_for: { party: 'tg:1', since: '2026-11-18T08:00:00Z' }, plan: { duration_min: 20 }, remind_at: '2026-11-19T07:00:00Z', promise: { by: 'me', due: '2026-11-20' } }),
    create({ title: 'Иное', template: 'other', filed: true }, 't2'),
  ], { filedTemplates: ['diary'] });
  assert.equal(task.filed, true);
  assert.equal(task.waitingFor.party, 'tg:1');
  assert.equal(task.plan.duration_min, 20);
  assert.equal(task.remindAt, '2026-11-19T07:00:00Z');
  assert.equal(task.promise.due, '2026-11-20');
  assert.equal(other.filed, true);
  assert.equal(foldTasks([create({ title: 'Z', template: 'diary' })])[0].filed, false);
});
