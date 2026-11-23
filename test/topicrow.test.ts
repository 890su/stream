import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { rowOrder, tileOf, removeChanges, reasonOf } from '../web/topicrow.js';

// The line of topics in the conversation card (topics design 2026-11-23). Titles are made up.
const record = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, kind: 'topic', offer: false, status: 'todo', messages: [], ...extra });

test('the chosen topic is first and gets 📣, the others ×', () => {
  const live = [record('a'), record('b'), record('c')];
  assert.deepEqual(rowOrder(live, 'b').map((task: { id: string }) => task.id), ['b', 'a', 'c']);
  assert.deepEqual(rowOrder(live, null).map((task: { id: string }) => task.id), ['a', 'b', 'c']);
  assert.equal(tileOf(record('b'), true).end, '📣');
  assert.equal(tileOf(record('a'), false).end, '×');
});

test('icons: ☑ a task, ◇✨ a topic with an offer, ◇ a topic', () => {
  assert.equal(tileOf(record('t', { kind: 'task' }), false).icon, '☑');
  assert.equal(tileOf(record('o', { offer: true }), false).icon, '◇✨');
  assert.equal(tileOf(record('p'), false).icon, '◇');
});

test('× removes only this conversation\'s messages; the topic stays while others remain', () => {
  const topic = record('принтер', { messages: ['m1', 'm2', 'x9'] });
  const conversation = { views: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] };
  assert.deepEqual(removeChanges(topic, conversation), [{ id: 'принтер', change: { op: 'update', remove: ['m1', 'm2'] } }]);
});

test('× on the last messages cancels a topic but not a task', () => {
  const conversation = { views: [{ id: 'm1' }] };
  assert.deepEqual(removeChanges(record('тема', { messages: ['m1'] }), conversation),
    [{ id: 'тема', change: { op: 'update', remove: ['m1'], status: 'cancelled', reason: 'Убрана из бесед' } }]);
  assert.deepEqual(removeChanges(record('дело', { kind: 'task', messages: ['m1'] }), conversation), [{ id: 'дело', change: { op: 'update', remove: ['m1'] } }]);
});

test('a legacy unconfirmed task (folded) shows ◇✨', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { foldTasks } = await import('../web/taskfold.js');
  const [task] = foldTasks([{ id: 'e1', schema_version: 1, source: 'system', author: 'system', ts: '2026-11-21T10:00:00Z', kind: 'task_change',
    payload: { ref: { type: 'task', id: 'u1' }, data: { task: { op: 'create', title: 'Сайт', add: ['m1'], unconfirmed: true } } } }]);
  assert.equal(tileOf(task, false).icon, '◇✨');
});

test('why the AI made it: the reason of its first change, else its note', () => {
  assert.equal(reasonOf({ history: [{ change: { op: 'create' } }, { change: { reason: 'тот же сайт' } }], note: 'заметка' }), 'тот же сайт');
  assert.equal(reasonOf({ history: [], note: 'заметка' }), 'заметка');
  assert.equal(reasonOf({}), '');
});
