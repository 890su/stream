import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { foldTasks, visibleTasks, tasksByMessage } from '../web/taskfold.js';
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
  assert.deepEqual(visibleTasks(tasks).map((t: { id: string }) => t.id), ['t1']);
  assert.deepEqual(visibleTasks(tasks, { who: 'all' }).map((t: { id: string }) => t.id), ['t1', 't2'], 'inbox goes last');
  assert.deepEqual(visibleTasks(tasks, { who: 'me', done: true }), []);
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
