import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { matchesFilter, visibleTasks } from '../web/filters.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { foldTasks } from '../web/taskfold.js';
import { filtersConfig } from '../src/config.ts';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { sectionsOf, listCount, dueLabel, rowParts } from '../web/tasklist.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { personParty } from '../web/taskdetails.js';

// Saved task filters are registry data (P14). Names and tasks are made up.
const now = new Date(2026, 10, 18, 12);
let n = 0;
const make = (title: string, change: Record<string, unknown> = {}) => foldTasks([{
  id: `e${++n}`, schema_version: 1, source: 'system', author: 'system', ts: '2026-11-18T09:00:00Z', kind: 'task_change',
  payload: { ref: { type: 'task', id: `t${n}` }, data: { task: { op: 'create', title, status: 'todo', ...change } } },
}])[0];
const filter = (id: string) => filtersConfig.filters.find((item) => item.id === id);
const ids = (tasks: any[], id: string) => visibleTasks(tasks, { filter: filter(id), now }).map((task: any) => task.title);

test('«Мои»: roles decide, not the derived assignee', () => {
  const tasks = [
    make('сам', { roles: { responsible: 'me', executors: ['me'] } }),
    make('поручил и сам', { roles: { responsible: 'me', executors: ['tg:1', 'me'] } }),
    make('поручил напарнику', { roles: { responsible: 'me', executors: ['tg:1'] } }),
    make('без исполнителя', { roles: { responsible: 'me' } }),
    make('чужая', { roles: { responsible: 'tg:2', executors: ['tg:3'] } }),
    make('архивная', { roles: { responsible: 'me', executors: ['me'] }, filed: true }),
    make('закрытая', { status: 'done', roles: { responsible: 'me', executors: ['me'] } }),
  ];
  assert.deepEqual(ids(tasks, 'mine').sort(), ['без исполнителя', 'поручил и сам', 'сам']);
});

test('«На контроле» takes tasks handed to a partner, not mine; «Команда» only tasks without me', () => {
  const tasks = [
    make('поручено', { roles: { responsible: 'me', executors: ['tg:1'], controller: 'me' } }),
    make('моё под контролем', { roles: { responsible: 'me', executors: ['me'], controller: 'me' } }),
    make('между своими', { roles: { responsible: 'tg:2', executors: ['tg:3'] } }),
    make('закрыто', { status: 'done', roles: { responsible: 'me', executors: ['tg:1'], controller: 'me' } }),
  ];
  assert.deepEqual(ids(tasks, 'control'), ['поручено']);
  assert.deepEqual(ids(tasks, 'team'), ['между своими']);
});

test('«Не учтено»: done tasks whose report has missing fields; «Просрочено» is ordered by due date', () => {
  const tasks = [
    make('с пробелами', { status: 'done', roles: { responsible: 'me' }, report: { missing: ['cost'] } }),
    make('полный', { status: 'done', roles: { responsible: 'me' }, report: { missing: [] } }),
    make('без отчёта', { status: 'done', roles: { responsible: 'me' } }),
    make('позже', { roles: { responsible: 'me' }, due: '2026-11-17' }),
    make('раньше', { roles: { responsible: 'me' }, due: '2026-11-10' }),
  ];
  assert.deepEqual(ids(tasks, 'unreported'), ['с пробелами']);
  assert.deepEqual(ids(tasks, 'overdue'), ['раньше', 'позже']);
});

test('due week is today through seven days ahead; updated_days, ne, not_in, lte, gte', () => {
  const week = { all: [{ field: 'due', op: 'eq', value: 'week' }] };
  const dues: Array<[string | null, boolean]> = [['2026-11-17', false], ['2026-11-18', true], ['2026-11-25', true], ['2026-11-26', false], [null, false]];
  for (const [due, expected] of dues) assert.equal(matchesFilter(make('x', { due }), week, { now }), expected, String(due));
  const task = make('x', { status: 'doing', roles: { responsible: 'me' } });
  const check = (conditions: unknown[]) => matchesFilter(task, { all: conditions }, { now });
  assert.equal(check([{ field: 'status', op: 'ne', value: 'done' }, { field: 'status', op: 'not_in', value: ['done', 'cancelled'] }]), true);
  assert.equal(check([{ field: 'updated_days', op: 'lte', value: 2 }]), true);
  assert.equal(check([{ field: 'updated_days', op: 'gte', value: 2 }]), false);
  assert.equal(check([{ field: 'role.watchers', op: 'empty' }, { field: 'role.counterparty', op: 'empty' }]), true);
});

test('an unknown field or op matches nothing and never throws', () => {
  const task = make('x', { roles: { responsible: 'me' } });
  for (const condition of [{ field: 'colour', op: 'eq', value: 'red' }, { field: 'colour', op: 'ne', value: 'red' }, { field: 'role.boss', op: 'empty' }, { field: 'status', op: 'resembles', value: 'todo' }, { field: 'status' }, {}]) {
    assert.equal(matchesFilter(task, { all: [condition] }, { now }), false, JSON.stringify(condition));
    assert.equal(matchesFilter(task, { any: [condition] }, { now }), false);
  }
  assert.equal(matchesFilter(task, undefined, { now }), false);
});

test('the registry: the pulse first, then the lists of the left panel; ids are unique', () => {
  assert.deepEqual(filtersConfig.filters.slice(0, 5).map((item) => item.title), ['Пульт', 'Сегодня', 'Разобрать', 'Жду', 'Контроль']);
  assert.equal(new Set(filtersConfig.filters.map((item) => item.id)).size, filtersConfig.filters.length);
});

test('«Сегодня»: my open tasks by sections; waiting, delegated, team and snoozed tasks stay out', () => {
  const mine = { roles: { responsible: 'me', executors: ['me'] } };
  const tasks = [
    make('просрочено', { ...mine, due: '2026-11-16' }),
    make('на сегодня', { ...mine, due: '2026-11-18' }),
    make('проснулась', { ...mine, status: 'deferred', remind_at: '2026-11-18T08:00:00.000Z' }),
    make('спит', { ...mine, status: 'deferred', remind_at: '2026-11-20T08:00:00.000Z' }),
    make('проверить', { status: 'review', roles: { responsible: 'me', executors: ['tg:1'], controller: 'me' } }),
    make('новая', { status: 'inbox', roles: { responsible: 'me' } }),
    make('проверяют меня', { status: 'review', roles: { responsible: 'tg:5', executors: ['me'], controller: 'tg:5' } }),
    make('потом', { ...mine, due: '2026-11-25' }),
    make('без срока', mine),
    make('жду', { ...mine, status: 'waiting' }),
    make('поручено', { roles: { responsible: 'me', executors: ['tg:1'], controller: 'me' } }),
    make('чужая', { roles: { responsible: 'tg:2', executors: ['tg:3'] } }),
    make('новая чужая', { status: 'inbox', roles: { responsible: 'tg:2' } }),
  ];
  const today = filter('today');
  const shown = visibleTasks(tasks, { filter: today, now });
  const sections = sectionsOf(shown, today, now).map((section: any) => [section.id, section.tasks.map((task: any) => task.title)]);
  assert.deepEqual(sections, [
    ['overdue', ['просрочено']], ['today', ['на сегодня', 'проснулась']], ['review', ['проверить']], ['new', ['новая']], ['later', ['потом', 'проверяют меня', 'без срока']]]);
  assert.equal(listCount(shown, today, now), 5, '«Дальше» is folded and not counted');
  assert.deepEqual(ids(tasks, 'waiting'), ['жду']);
  assert.deepEqual(ids(tasks, 'new'), ['новая']);
});

test('«Жду» and «На проверке» only with me; a list without sections is one section', () => {
  const tasks = [
    make('жду от напарника', { status: 'waiting', roles: { responsible: 'me', executors: ['me'] } }),
    make('ждут между собой', { status: 'waiting', roles: { responsible: 'tg:2', executors: ['tg:3'] } }),
    make('проверяю', { status: 'review', roles: { responsible: 'me', executors: ['tg:1'], controller: 'me' } }),
    make('проверяют сами', { status: 'review', roles: { responsible: 'tg:2', executors: ['tg:3'] } }),
  ];
  assert.deepEqual(ids(tasks, 'waiting'), ['жду от напарника']);
  assert.deepEqual(ids(tasks, 'review'), ['проверяю']);
  const all = sectionsOf(tasks, filter('team'), now);
  assert.equal(all.length, 1);
  assert.equal(all[0].title, null);
});

test('row words: due date as a word, facts without «сделать» and message counts', () => {
  assert.equal(dueLabel({ due: null }, now), null);
  assert.deepEqual(dueLabel({ status: 'todo', due: '2026-11-17' }, now), { text: 'просрочено', state: 'overdue' });
  assert.deepEqual(dueLabel({ status: 'todo', due: '2026-11-18' }, now), { text: 'сегодня', state: 'today' });
  assert.deepEqual(dueLabel({ status: 'todo', due: '2026-11-19' }, now), { text: 'завтра', state: 'later' });
  assert.equal(dueLabel({ status: 'todo', due: '2026-11-21' }, now).state, 'later');
  assert.equal(dueLabel({ status: 'done', due: '2026-11-10' }, now), null, 'a closed task is never «просрочено»');
  const task = make('x', { roles: { responsible: 'me' } });
  assert.deepEqual(rowParts(task, []), []);
  assert.deepEqual(rowParts({ ...task, status: 'waiting', proposed: 'done', confidence: 0.4 }, []), ['ждёт', 'готово?', 'проверьте']);
});

test('«Другой…»: a typed number is a phone party, anything else a name', () => {
  assert.equal(personParty(' +48 500-100-200 '), 'tel:+48500100200');
  assert.equal(personParty('Ян'), 'name:Ян');
  assert.equal(personParty('   '), null);
});

test('the first saved filter is the pulse — the default of «Задачи» (task manager spec §5)', () => {
  assert.equal(filtersConfig.filters[0]?.id, 'pulse');
  assert.equal((filtersConfig.filters[0] as { view?: string }).view, 'pulse');
});
