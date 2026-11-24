import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { linkMarks, unlinkEvent } from '../web/linkmark.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { foldTasks } from '../web/taskfold.js';

// «→ «название» ↩» under a message (design 2026-11-23 «Разбор беседы»): the triage's system link to an existing
// record; ↩ is my `task_change` `remove`. Titles are made up.
let n = 0;
const change = (task: string, data: Record<string, unknown>, author = 'system') => ({
  id: `c${++n}`, schema_version: 1, source: author === 'me' ? 'app' : 'system', author, ts: `2026-11-24T10:${String(n).padStart(2, '0')}:00Z`, kind: 'task_change',
  payload: { ref: { type: 'task', id: task }, data: { task: data } },
});
const marks = (events: any[], id: string) => {
  const tasks = foldTasks(events);
  const byId = new Map(tasks.map((task: any) => [task.id, task]));
  const taskIds = tasks.filter((task: any) => task.messages.includes(id)).map((task: any) => task.id);
  return linkMarks({ id, taskIds }, byId);
};

test('only a system link to an existing record shows, with its title', () => {
  const mine = change('t1', { op: 'create', title: 'Принтер Neo Form', status: 'todo', add: ['m0'] }, 'me');
  const link = change('t1', { op: 'update', add: ['m1'] });
  assert.deepEqual(marks([mine, link], 'm1'), [{ taskId: 't1', title: 'Принтер Neo Form' }]);
  assert.deepEqual(marks([mine, link], 'm0'), [], 'my own message of the record is not a system link');
  const made = change('t2', { op: 'create', title: 'Анна: посылка', status: 'todo', add: ['m5'], unconfirmed: true });
  assert.deepEqual(marks([made], 'm5'), [], 'a record the AI made from the message is its offer, not a link');
});

test('a link I removed (↩) or touched myself is not a mark; a system link taken back neither', () => {
  const mine = change('t1', { op: 'create', title: 'Принтер', status: 'todo', add: [] }, 'me');
  const link = change('t1', { op: 'update', add: ['m1'] });
  assert.deepEqual(marks([mine, link, change('t1', { op: 'update', remove: ['m1'] }, 'me')], 'm1'), []);
  assert.deepEqual(marks([mine, link, change('t1', { op: 'update', add: ['m1'] }, 'me')], 'm1'), [], 'linked again by me — my link');
  assert.deepEqual(marks([mine, link, change('t1', { op: 'update', remove: ['m1'] })], 'm1'), [], '«✨ Разобрать заново» took it back');
});

test('↩ writes my task change removing the message', () => {
  const { event } = unlinkEvent('m1', 't1');
  assert.deepEqual([event.kind, event.author, event.payload.ref.id, event.payload.data.task], ['task_change', 'me', 't1', { op: 'update', remove: ['m1'] }]);
});
