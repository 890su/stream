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
