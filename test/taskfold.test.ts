import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { foldTasks, tasksByMessage, involvesMe, STATUSES, itemsProgress } from '../web/taskfold.js';
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

test('a message leads to its first open task, else its latest; a task gathers untriaged follow-ups', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { taskOfMessage, taskMembers } = await import('../web/taskfold.js');
  const tasks = foldTasks([
    change('a', '2026-11-18T08:00:00', { op: 'create', title: 'A', status: 'todo', add: ['m1', 'm2'] }),
    change('a', '2026-11-18T09:00:00', { op: 'update', status: 'done' }),
    change('b', '2026-11-18T08:00:00', { op: 'create', title: 'B', status: 'todo', add: ['m2'] }),
    change('c', '2026-11-18T10:00:00', { op: 'create', title: 'C', status: 'cancelled', add: ['m1'] }),
  ]);
  const byId = new Map(tasks.map((task: { id: string }) => [task.id, task]));
  assert.equal(taskOfMessage({ taskIds: ['a', 'b'] }, byId).id, 'b', 'the open one');
  assert.equal(taskOfMessage({ taskIds: ['a', 'c'] }, byId).id, 'c', 'among finished: the one changed last');
  assert.equal(taskOfMessage({ taskIds: [] }, byId), null);
  const view = (id: string, ts: string, extra: Record<string, unknown> = {}) => ({ id, taskIds: [], event: { id, ts, payload: {} }, ...extra });
  const views = [view('m3', '2026-11-18T11:00:00', { continues: 'm2' }), view('m1', '2026-11-18T07:00:00', { taskIds: ['a'] }), view('m2', '2026-11-18T07:30:00', { taskIds: ['a'] }), view('x', '2026-11-18T07:45:00')];
  assert.deepEqual(taskMembers(tasks.find((task: { id: string }) => task.id === 'a'), views).map((item: { id: string }) => item.id), ['m1', 'm2', 'm3']);
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

test('a checklist folds from item changes; an owner rename marks the title as named', () => {
  const at = (minute: number) => `2026-11-19T10:0${minute}:00.000Z`;
  const ev = (ts: string, task: Record<string, unknown>, author = 'system') => ({ id: crypto.randomUUID(), schema_version: 1, source: author === 'me' ? 'app' : 'system', author, ts, kind: 'task_change', payload: { ref: { type: 'task', id: 'job' }, data: { task } } });
  const [task] = foldTasks([
    ev(at(1), { op: 'create', title: 'Установить программу', items_add: [{ id: 'i1', text: 'установить программу' }] }),
    ev(at(2), { op: 'update', title: 'Клиент А: настройка компьютера', items_add: [{ id: 'i2', text: 'настроить почту' }, { id: 'i1', text: 'дубль' }] }),
    ev(at(3), { op: 'update', items_set: [{ id: 'i1', done: true }, { id: 'i2', text: 'настроить почту и календарь' }] }),
    ev(at(4), { op: 'update', items_add: [{ id: 'i3', text: 'лишнее' }], items_remove: ['i3'] }),
  ]);
  assert.deepEqual(task.items, [{ id: 'i1', text: 'установить программу', done: true }, { id: 'i2', text: 'настроить почту и календарь', done: false }]);
  assert.equal(itemsProgress(task), '1/2');
  assert.equal(task.ownerTitled, false, 'triage renamed it');
  const [named] = foldTasks([ev(at(1), { op: 'create', title: 'x' }), ev(at(2), { op: 'update', title: 'Моё название' }, 'me')]);
  assert.equal(named.ownerTitled, true);
});

test('resume note is folded and cleared', () => {
  const events = [
    change('t1', '2026-11-19T10:00:00Z', { op: 'create', title: 'Сеть у клиента', status: 'doing' }),
    change('t1', '2026-11-19T10:30:00Z', { op: 'update', status: 'todo', resume_note: 'проверить Wi-Fi' }, 'me'),
  ];
  assert.equal(foldTasks(events)[0].resumeNote, 'проверить Wi-Fi');
  events.push(change('t1', '2026-11-19T11:00:00Z', { op: 'update', status: 'doing', resume_note: '' }, 'me'));
  assert.equal(foldTasks(events)[0].resumeNote, '');
});

test('plain participants (members) and switched-off ones (muted) fold on the client and the server alike', async () => {
  const { foldTasks: serverFold } = await import('../src/tasks/fold.ts');
  const events = [
    create({ title: 'Созвон', roles: { responsible: 'me', members: ['tg:8'] } }),
    change('t1', '2026-11-18T09:00:00Z', { op: 'update', roles: { members: ['tg:8', 'tg:9'] }, muted: ['tg:9'] }),
    change('t1', '2026-11-18T10:00:00Z', { op: 'update', roles: { members: null } }),
  ];
  const [client] = foldTasks(events);
  const [server] = serverFold(events as any);
  for (const task of [client, server] as any[]) {
    assert.deepEqual(task.roles.members, [], 'null clears a list role');
    assert.deepEqual(task.muted, ['tg:9']);
  }
});

// Unconfirmed tasks (design 2026-11-21): an AI-made task waits for the owner; any owner change confirms it, except
// a change of only the legacy kind/offer/proposal keys (topics were dropped 2026-11-24). Without the field a task is real.
test('an AI-made task with unconfirmed stays so until the owner touches it', async () => {
  const fold = (events: unknown[]) => foldTasks(events)[0];
  const made = change('u1', '2026-11-21T10:00:00Z', { op: 'create', title: 'Сайт: правки', status: 'todo', unconfirmed: true });
  assert.equal(fold([made]).unconfirmed, true);
  assert.equal(fold([made, change('u1', '2026-11-21T10:01:00Z', { op: 'update', note: 'разбор' })]).unconfirmed, true, 'the AI\'s own change does not confirm');
  assert.equal(fold([made, change('u1', '2026-11-21T10:02:00Z', { op: 'update', title: 'Сайт: правки меню' }, 'me')]).unconfirmed, false);
  assert.equal(fold([made, change('u1', '2026-11-21T10:02:00Z', { op: 'update', unconfirmed: false }, 'me'), change('u1', '2026-11-21T10:03:00Z', { op: 'update', unconfirmed: true }, 'me')]).unconfirmed, true);
  assert.equal(fold([change('u2', '2026-11-21T10:00:00Z', { op: 'create', title: 'Старое' })]).unconfirmed, undefined);
  const { foldTasks: serverFold } = await import('../src/tasks/fold.ts');
  const server = (events: unknown[]) => serverFold(events as any)[0]!.unconfirmed;
  assert.equal(server([made]), true);
  assert.equal(server([made, change('u1', '2026-11-21T10:02:00Z', { op: 'update', due: '2026-11-22' }, 'me')]), false);
  assert.equal(server([change('u2', '2026-11-21T10:00:00Z', { op: 'create', title: 'Старое' })]), undefined);
});

test('an owner change of only kind/offer/proposal does not confirm an AI task', async () => {
  const made = change('u3', '2026-11-21T10:00:00Z', { op: 'create', title: 'Сайт: правки', status: 'todo', unconfirmed: true });
  const { foldTasks: serverFold } = await import('../src/tasks/fold.ts');
  for (const data of [{ op: 'update', kind: 'task' }, { op: 'update', kind: 'topic', offer: false }, { op: 'update', offer: true, proposal: crypto.randomUUID() }]) {
    const events = [made, change('u3', '2026-11-21T10:05:00Z', data, 'me')];
    assert.equal(foldTasks(events)[0].unconfirmed, true, JSON.stringify(data));
    assert.equal(serverFold(events as any)[0]!.unconfirmed, true, JSON.stringify(data));
  }
  const touched = [made, change('u3', '2026-11-21T10:05:00Z', { op: 'update', kind: 'task', note: 'x' }, 'me')];
  assert.equal(foldTasks(touched)[0].unconfirmed, false, 'any other key confirms');
});
