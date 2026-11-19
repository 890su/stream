import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { foldProjects, markNext, projectTree, projectScope, projectSections, defaultSections } from '../web/projects.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { matchesFilter } from '../web/filters.js';
import { filtersConfig } from '../src/config.ts';
import { fixture } from './helpers.ts';

// Projects (CONCEPT.md §2.11). Names are made up.
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';
let n = 0;
const change = (id: string, project: Record<string, unknown>) => ({ id: `e${++n}`, schema_version: 1, source: 'app', author: 'me', ts: `2026-11-19T10:00:${String(n).padStart(2, '0')}.000Z`, kind: 'project_change', payload: { ref: { type: 'project', id }, data: { project } } });
const task = (id: string, extra: Record<string, unknown> = {}) => ({ id, status: 'todo', filed: false, roles: { executors: ['me'], responsible: 'me' }, updatedAt: '2026-11-19T10:00:00Z', ...extra });

test('projects fold from changes; a missing parent or a loop goes to the top', () => {
  const projects = foldProjects([
    change(P1, { op: 'create', title: 'Работа', kind: 'stream' }),
    change(P2, { op: 'create', title: 'Сайт', kind: 'goal', parent: P1, sections: defaultSections('goal') }),
    change(P3, { op: 'create', title: 'Переезд', parent: '44444444-4444-4444-8444-444444444444' }),
    change(P1, { op: 'update', parent: P2 }),
    change(P2, { op: 'update', status: 'paused' }),
  ]);
  const byId = new Map<string, any>(projects.map((item: any) => [item.id, item]));
  assert.equal(byId.get(P2).status, 'paused');
  assert.equal(byId.get(P3).parent, null, 'unknown parent');
  assert.ok(byId.get(P1).parent === null || byId.get(P2).parent === null, 'a loop is broken');
});

test('the tree counts open tasks of a project and its children; done projects only with all', () => {
  const projects = foldProjects([
    change(P1, { op: 'create', title: 'Работа' }),
    change(P2, { op: 'create', title: 'Беларусь', parent: P1 }),
    change(P3, { op: 'create', title: 'Старое' }), change(P3, { op: 'update', status: 'done' }),
  ]);
  const tasks = [task('a', { project: P1 }), task('b', { project: P2 }), task('c', { project: P2, status: 'done' })];
  assert.deepEqual(projectTree(projects, tasks).map((row: any) => [row.project.title, row.depth, row.open]), [['Работа', 0, 2], ['Беларусь', 1, 1]]);
  assert.equal(projectTree(projects, tasks, { all: true }).length, 3);
  assert.deepEqual([...projectScope(projects, P1)].sort(), [P1, P2].sort());
});

test('a next action of an active goal project is in «Сегодня»; a paused one or another section is not', () => {
  const goal = foldProjects([change(P1, { op: 'create', title: 'Сайт', kind: 'goal', sections: defaultSections('goal') })]);
  const tasks = markNext([task('a', { project: P1, section: 'next' }), task('b', { project: P1, section: 'ideas' }), task('c', { project: P1, section: 'next', status: 'done' })], goal);
  assert.deepEqual(tasks.map((item: any) => item.next), [true, false, false]);
  const today = filtersConfig.filters.find((item) => item.id === 'today')!;
  assert.ok(matchesFilter(tasks[0], today.sections!.find((section) => section.id === 'next')!));
  const paused = foldProjects([change(P1, { op: 'create', title: 'Сайт', kind: 'goal', status: 'paused', sections: defaultSections('goal') })]);
  assert.equal(markNext([task('a', { project: P1, section: 'next' })], paused)[0].next, false);
});

test('a project shows its tasks by sections, loose tasks first', () => {
  const [project] = foldProjects([change(P1, { op: 'create', title: 'Сайт', kind: 'goal', sections: defaultSections('goal') })]);
  const sections = projectSections(project, [task('a', { section: 'next' }), task('b'), task('c', { section: 'gone' })]);
  assert.deepEqual(sections.map((section: any) => [section.title, section.tasks.map((item: any) => item.id)]), [['Без раздела', ['b', 'c']], ['Идеи', []], ['Следующее', ['a']], ['Позже', []]]);
});

test('the server accepts a project change and a task in a project; refuses a self parent or a wrong ref', async () => {
  const f = await fixture();
  const post = (body: unknown) => f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const event = (body: Record<string, unknown>) => ({ ...body, id: crypto.randomUUID(), ts: new Date().toISOString() });
  try {
    assert.equal((await post(event(change(P1, { op: 'create', title: 'Сайт', kind: 'goal', sections: defaultSections('goal') })))).status, 201);
    assert.equal((await post(event(change(P1, { op: 'update', parent: P1 })))).status, 400);
    assert.equal((await post(event(change(P2, { op: 'create' })))).status, 400, 'a title is needed');
    assert.equal((await post(event({ ...change(P2, { op: 'create', title: 'x' }), payload: { ref: { type: 'task', id: P2 }, data: { project: { op: 'create', title: 'x' } } } }))).status, 400);
    const taskChange = { id: crypto.randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: new Date().toISOString(), kind: 'task_change', payload: { ref: { type: 'task', id: P3 }, data: { task: { op: 'create', title: 'Макет', project: P1, section: 'next' } } } };
    assert.equal((await post(taskChange)).status, 201);
  } finally { await f.stop(); }
});

test('a task in a project\'s ideas is an idea and stays out of «Сегодня»', () => {
  const goal = foldProjects([change(P1, { op: 'create', title: 'Сайт', kind: 'goal', sections: defaultSections('goal'), sources: ['tg:by'] })]);
  assert.deepEqual(goal[0].sources, ['tg:by']);
  const [idea, loose] = markNext([task('a', { project: P1, section: 'ideas', roles: { executors: ['me'], responsible: 'me' } }), task('b', { roles: { executors: ['me'], responsible: 'me' } })], goal);
  assert.equal(idea.idea, true);
  const today = filtersConfig.filters.find((item) => item.id === 'today')!;
  assert.equal(matchesFilter(idea, today), false);
  assert.equal(matchesFilter(loose, today), true);
});
