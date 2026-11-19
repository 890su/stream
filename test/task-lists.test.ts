import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { foldTasks } from '../web/taskfold.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { matchesFilter } from '../web/filters.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { partyOfEvent, partyName, phoneNumber, defaultController as clientController } from '../web/parties.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { delegateOptions } from '../web/taskactions.js';
import { defaultController } from '../src/tasks/parties.ts';
import { filtersConfig } from '../src/config.ts';

// Every open task lands in a list (P14 review). Names and numbers are made up.
const OPEN = ['inbox', 'todo', 'doing', 'waiting', 'review', 'deferred'];
const LISTS = ['mine', 'control', 'team'].map((id) => filtersConfig.filters.find((filter) => filter.id === id));
const now = new Date(2026, 10, 18, 12);
let n = 0;
const create = (data: Record<string, unknown>, author = 'system') => ({
  id: `e${++n}`, schema_version: 1, source: 'system', author, ts: '2026-11-18T09:00:00Z', kind: 'task_change',
  payload: { ref: { type: 'task', id: `t${n}` }, data: { task: { op: 'create', title: 'Дело', ...data } } },
});
const listed = (task: any) => LISTS.some((filter) => matchesFilter(task, filter, { now }));

test('every open, not filed task is in «Мои», «На контроле» or «Команда»', () => {
  const events = [];
  for (const status of OPEN) {
    for (const author of ['me', 'system', 'tg:1']) {
      for (const responsible of ['me', 'tg:2', 'name:Марек']) {
        for (const executors of [[], ['me'], ['ai'], ['system'], ['tg:3'], ['me', 'tg:3']]) {
          const roles = { author, responsible, executors };
          const controller = defaultController(roles);
          assert.equal(clientController(roles), controller, 'server and client agree');
          events.push(create({ status, roles: { ...roles, ...(controller ? { controller } : {}) } }));
        }
      }
    }
    for (const legacy of [{ assignee: 'me' }, { assignee: 'ai' }, { assignee: 'system' }, { assignee: 'person' }, { assignee: 'person', person: 'Марек' }]) {
      events.push(create({ status, ...legacy }));
    }
  }
  const tasks = foldTasks(events);
  const lost = tasks.filter((task: any) => !listed(task)).map((task: any) => JSON.stringify({ status: task.status, roles: task.roles }));
  assert.deepEqual(lost, []);
});

test('client fold: an old person task is controlled by me; the first roles change keeps the old roles', () => {
  const [old] = foldTasks([create({ status: 'todo', assignee: 'person', person: 'Марек' })]);
  assert.deepEqual(old.roles.executors, ['name:Марек']);
  assert.equal(old.roles.responsible, 'me');
  assert.equal(old.roles.controller, 'me');
  assert.ok(matchesFilter(old, LISTS[1], { now }), '«На контроле»');
  const id = `t${n + 1}`;
  const first = create({ status: 'inbox', assignee: 'me' });
  const accept = { ...create({}), id: 'accept', author: 'me', ts: '2026-11-18T10:00:00Z', payload: { ref: { type: 'task', id }, data: { task: { op: 'update', status: 'todo', roles: { executors: ['me'] } } } } };
  const [accepted] = foldTasks([first, accept]);
  assert.equal(accepted.roles.responsible, 'me');
  assert.deepEqual(accepted.roles.executors, ['me']);
  assert.equal(accepted.roles.author, 'system');
});

test('«Новые» and «На контроле» leave filed tasks out', () => {
  const [filed] = foldTasks([create({ status: 'inbox', filed: true, roles: { responsible: 'me', executors: ['ai'], controller: 'me' } })]);
  for (const id of ['new', 'control']) assert.equal(matchesFilter(filed, filtersConfig.filters.find((filter) => filter.id === id), { now }), false, id);
});

const phone = (kind: string, direction: string, number: string, name?: string) => ({ event: { id: `p${++n}`, author: 'me', source: 'android_phone', kind, payload: { data: { [kind]: { direction, number, ...(name ? { name } : {}) } } } } });

test('client partyOfEvent and phoneNumber: incoming phone events are the caller', () => {
  assert.equal(phoneNumber('0048 600-100-200'), '+48600100200');
  assert.equal(phoneNumber(' +48 (600) 100 200 '), '+48600100200');
  assert.equal(phoneNumber('600 100 200'), '600100200');
  assert.equal(partyOfEvent(phone('sms', 'in', '+48 600 100 200').event), 'tel:+48600100200');
  assert.equal(partyOfEvent(phone('call', 'missed', '600100200').event), 'name:600100200');
  assert.equal(partyOfEvent(phone('call', 'out', '+48600100200').event), 'me');
  assert.equal(partyOfEvent({ author: 'contact:tg:pl:42', kind: 'text', payload: {} }), 'tg:42');
});

test('callers are offered for «Поручить…» and «Жду…»; one partyName for every place', () => {
  const views = [phone('sms', 'in', '+48 600 100 200', 'Ян'), phone('call', 'out', '+48600100300'),
    { event: { author: 'contact:tg:by:5', payload: { data: { telegram: { chat_id: '5', chat_type: 'private', chat_title: 'Анна Тестова', from_name: 'Анна' } } } } },
    { event: { author: 'contact:tg:by:7', payload: { data: { telegram: { chat_id: '-900', chat_type: 'group', chat_title: 'Монтажники', from_name: 'Марек' } } } } }];
  assert.deepEqual(delegateOptions(views).map((option: { party: string; name: string }) => `${option.party}=${option.name}`),
    ['tel:+48600100200=Ян', 'tg:5=Анна Тестова', 'tg:7=Марек']);
  assert.equal(partyName('group:tg:-900', views), 'Монтажники');
  assert.equal(partyName('tel:+48600100300', views), '+48600100300');
  assert.equal(partyName(null, views), '');
});

test('a task row names its executor, else the responsible, unless the list is «Мои»', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { rowParts } = await import('../web/tasklist.js');
  const [legacy] = foldTasks([create({ status: 'todo', assignee: 'person', person: 'Марек' })]);
  const [theirs] = foldTasks([create({ status: 'todo', roles: { responsible: 'tg:5', executors: [] } })]);
  const views = [{ event: { author: 'contact:tg:by:5', payload: { data: { telegram: { chat_id: '5', chat_type: 'private', chat_title: 'Анна Тестова' } } } } }];
  assert.ok(rowParts(legacy, [], { showAssignee: true, now }).includes('Марек'));
  assert.ok(!rowParts(legacy, [], { showAssignee: false, now }).includes('Марек'));
  assert.ok(rowParts(theirs, views, { showAssignee: true, now }).includes('Анна Тестова'));
});

test('the «Задачи» list groups by the most used tag or by the first person; the rest goes last', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { groupsOf } = await import('../web/tasklist.js');
  const view = (tags: string[], chat?: string) => ({ tags, event: { kind: 'text', author: chat ? 'contact:tg:by:1' : 'me', payload: chat ? { data: { telegram: { account: 'by', chat_id: '1', chat_title: chat } } } : {} } });
  const views: Record<string, any[]> = { a: [view(['#stream', '#идея']), view(['#stream'])], b: [view(['#дом'], 'Жена')], c: [view([])], d: [view(['#дом'], 'Жена')] };
  const tasks = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const byTags = groupsOf(tasks, 'tags', (task: any) => views[task.id]);
  assert.deepEqual(byTags.map((group: any) => [group.title, group.tasks.map((task: any) => task.id)]), [['#дом', ['b', 'd']], ['#stream', ['a']], ['Без метки', ['c']]]);
  const byPeople = groupsOf(tasks, 'people', (task: any) => views[task.id]);
  assert.deepEqual(byPeople.map((group: any) => group.title), ['Жена', 'Мои заметки']);
});
